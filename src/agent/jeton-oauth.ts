import { createHash } from 'node:crypto';
import { enTetesAuthSource } from './http-cible';
import type { SourceAppel } from './sources';
import { transportConnecteurHttp, type TransportConnecteurHttp } from './transport-connecteur-http';

/**
 * LES EN-TÊTES D'AUTHENTIFICATION D'UNE SOURCE, jeton OAuth compris (plan 2026-11-25, essai Everial).
 *
 * Une source `oauth_password` ne porte pas de jeton : elle porte un identifiant et un mot de passe, et le jeton se
 * demande au serveur d'autorisation du client (`grant_type=password`), puis expire. Ce module le demande, le garde EN
 * MÉMOIRE jusqu'à son échéance (moins une marge), et le pose en `Authorization: Bearer`. Les autres modes passent par
 * `enTetesAuthSource`, inchangé : un seul point d'entrée pour le résolveur et l'épreuve de source.
 *
 * 🔴 Le jeton et le mot de passe ne sortent jamais d'ici : ni journal, ni erreur, ni base. Une erreur ne dit que sa
 * catégorie (`auth`, `indispo`, `interne`, `illisible`), que l'appelant traduit en message sûr.
 * 🔴 La demande passe par le transport des connecteurs : adresse publique vérifiée à la résolution ET à la connexion,
 * redirection refusée, lecture bornée. Le mot de passe ne part donc jamais vers l'intérieur du réseau.
 *
 * Le cache est par copie de l'API (pas en base) : au pire, chaque copie demande son propre jeton. Il est rangé par
 * source et invalidé par l'EMPREINTE de la configuration (adresse, client, identifiant, scope, mot de passe) : un mot de
 * passe changé à l'écran ne réutilise pas le jeton de l'ancien.
 */

export type RefusJeton = 'auth' | 'indispo' | 'interne' | 'illisible';

export type EnTetesSource =
  | { ok: true; entetes: Record<string, string> }
  | { ok: false; erreur: RefusJeton };

export interface FournisseurJetons {
  /** Les en-têtes d'authentification de la source, quel que soit son mode. */
  entetes(source: SourceAppel): Promise<EnTetesSource>;
  /** Le système du client a refusé le jeton (401, 403) : le prochain appel en redemande un. */
  oublier(sourceId: string): void;
}

/** Retirée de la durée annoncée : un jeton qui expire pendant l'appel ferait répondre 401 pour rien. */
export const MARGE_JETON_MS = 30_000;
/** Quand le serveur ne dit pas combien de temps vaut le jeton. */
export const DUREE_JETON_DEFAUT_MS = 60_000;
/** Délai de la demande de jeton, indépendant de celui de l'appel qui l'attend (la demande est partagée). */
export const DELAI_JETON_MS = 10_000;
/** Une réponse de jeton tient en quelques kilo-octets ; au-delà, ce n'est pas un serveur d'autorisation. */
const MAX_OCTETS_JETON = 64 * 1024;
/**
 * Un identifiant ou un mot de passe refusé n'est pas redemandé avant ce délai : chaque contact d'un scénario
 * redemanderait sinon un jeton, et un serveur Keycloak verrouille le compte après quelques échecs (relecture du lot).
 */
export const PAUSE_APRES_REFUS_MS = 60_000;
/** Plafond du cache par copie : au-delà, il repart de zéro (chaque source redemande un jeton, rien de plus). */
const MAX_JETONS = 1000;

export interface DepsJetons {
  transport?: TransportConnecteurHttp;
  maintenant?: () => number;
}

function empreinte(source: SourceAppel): string {
  const o = source.oauth;
  return createHash('sha256')
    .update(JSON.stringify([o?.tokenUrl, o?.clientId, o?.username, o?.scope, source.authSecret]))
    .digest('hex');
}

export function creerFournisseurJetons(deps: DepsJetons = {}): FournisseurJetons {
  const transport = deps.transport ?? transportConnecteurHttp;
  const maintenant = deps.maintenant ?? Date.now;
  const caches = new Map<string, { empreinte: string; jeton: string; expireA: number }>();
  const refus = new Map<string, { empreinte: string; jusqua: number }>();
  const enVol = new Map<string, { empreinte: string; promesse: Promise<{ ok: true; jeton: string } | { ok: false; erreur: RefusJeton }> }>();

  async function demander(source: SourceAppel, cle: string): Promise<{ ok: true; jeton: string } | { ok: false; erreur: RefusJeton }> {
    const o = source.oauth!;
    const formulaire = new URLSearchParams({
      grant_type: 'password',
      client_id: o.clientId,
      username: o.username,
      password: source.authSecret ?? '',
    });
    if (o.scope !== '') formulaire.set('scope', o.scope);
    const r = await transport.executer({
      url: o.tokenUrl,
      methode: 'POST',
      entetes: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      corps: formulaire.toString(),
      signal: AbortSignal.timeout(DELAI_JETON_MS),
      lecture: { nature: 'texte', maxOctets: MAX_OCTETS_JETON },
    });
    if (r.nature === 'adresse_refusee') return { ok: false, erreur: 'interne' };
    if (r.nature !== 'reponse') return { ok: false, erreur: r.nature === 'corps_trop_gros' || r.nature === 'corps_interrompu' ? 'illisible' : 'indispo' };
    // Keycloak rend 401 sur un mauvais mot de passe et 400 (`invalid_grant`, `unauthorized_client`) sur un compte ou un
    // client refusé : dans les deux cas, ce sont les identifiants du connecteur qui sont en cause.
    if (r.httpStatus === 400 || r.httpStatus === 401 || r.httpStatus === 403) {
      if (refus.size >= MAX_JETONS) refus.clear();
      refus.set(cle, { empreinte: empreinte(source), jusqua: maintenant() + PAUSE_APRES_REFUS_MS });
      return { ok: false, erreur: 'auth' };
    }
    if (r.httpStatus < 200 || r.httpStatus >= 300) return { ok: false, erreur: 'indispo' };
    let corps: unknown;
    try { corps = JSON.parse(r.texte ?? ''); } catch { return { ok: false, erreur: 'illisible' }; }
    const c = (corps ?? {}) as { access_token?: unknown; expires_in?: unknown };
    // Le jeton part dans un en-tête : un retour à la ligne y fabriquerait un second en-tête.
    if (typeof c.access_token !== 'string' || c.access_token === '' || /[^\x21-\x7e]/.test(c.access_token)) {
      return { ok: false, erreur: 'illisible' };
    }
    const dureeMs = typeof c.expires_in === 'number' && Number.isFinite(c.expires_in) && c.expires_in > 0
      ? c.expires_in * 1000 : DUREE_JETON_DEFAUT_MS;
    if (caches.size >= MAX_JETONS) caches.clear();
    // Un jeton plus court que la marge sert quand même à l'appel qui l'a demandé, sans être gardé.
    if (dureeMs > MARGE_JETON_MS) caches.set(cle, { empreinte: empreinte(source), jeton: c.access_token, expireA: maintenant() + dureeMs - MARGE_JETON_MS });
    return { ok: true, jeton: c.access_token };
  }

  return {
    async entetes(source) {
      if (source.authKind !== 'oauth_password') return { ok: true, entetes: enTetesAuthSource(source) };
      if (!source.oauth || !source.authSecret) return { ok: false, erreur: 'auth' };
      const cle = source.id;
      const e = empreinte(source);
      const refuse = refus.get(cle);
      // Une configuration changée (mot de passe corrigé à l'écran) lève la pause aussitôt.
      if (refuse && refuse.empreinte === e && refuse.jusqua > maintenant()) return { ok: false, erreur: 'auth' };
      const garde = caches.get(cle);
      let jeton: string;
      if (garde && garde.empreinte === e && garde.expireA > maintenant()) {
        jeton = garde.jeton;
      } else {
        // Une seule demande en vol par source : un scénario lancé sur cent contacts ne demande pas cent jetons.
        let vol = enVol.get(cle);
        if (!vol || vol.empreinte !== e) {
          const promesse = demander(source, cle).finally(() => { if (enVol.get(cle)?.promesse === promesse) enVol.delete(cle); });
          vol = { empreinte: e, promesse };
          enVol.set(cle, vol);
        }
        const r = await vol.promesse;
        if (!r.ok) return r;
        jeton = r.jeton;
      }
      return { ok: true, entetes: { accept: 'application/json', authorization: `Bearer ${jeton}` } };
    },
    oublier(sourceId) {
      caches.delete(sourceId);
    },
  };
}

/** Le fournisseur de production, partagé par le résolveur et l'épreuve de source. */
export const jetonsOAuth = creerFournisseurJetons();
