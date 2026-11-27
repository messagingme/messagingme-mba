import type { SourceAppel } from './sources';
import { construireCible } from './http-cible';
import { jetonsOAuth, type FournisseurJetons } from './jeton-oauth';
import { transportConnecteurHttp, type TransportConnecteurHttp } from './transport-connecteur-http';

export interface EprouverSourceDeps {
  sources: {
    pourAppel(tenantId: string, id: string): Promise<SourceAppel | null>;
    marquerEpreuve(tenantId: string, id: string, ok: boolean, erreur?: string): Promise<void>;
  };
  /** Le transport complet, injecté dans les tests. Défaut : résolution et connexion publiques de production. */
  transportHttp?: TransportConnecteurHttp;
  /** Défaut : le fournisseur de production, le même que le résolveur. */
  jetons?: FournisseurJetons;
}

export interface ResultatEpreuve { ok: boolean; httpStatus?: number; erreur?: string }

const INTERNE = 'cette adresse n est pas joignable depuis notre infrastructure';

/**
 * Éprouver une source : un appel réel, et le résultat écrit sur la ligne. Seul moyen de voir un jeton mort
 * avant qu'un contact ne le découvre. Passe par les mêmes gardes que le résolveur (`construireCible`), sinon
 * l'épreuve validerait une adresse que l'appel refusera.
 */
/** Un système déclaré sans sa clé (0331) : rien ne part, et l'épreuve le dit. */
const SANS_SECRET = 'aucun secret enregistré : collez-le sur la page Connecteurs API, puis éprouvez à nouveau';

export function creerEprouverSource(deps: EprouverSourceDeps): (tenant: string, id: string, chemin: string) => Promise<ResultatEpreuve> {
  const transportHttp = deps.transportHttp ?? transportConnecteurHttp;
  const jetons = deps.jetons ?? jetonsOAuth;
  return async (tenant, id, chemin) => {
    const src = await deps.sources.pourAppel(tenant, id);
    // 🔴 `kind === 'http'` ici aussi, pas seulement sur la route : une garde posée au montage ne tient que
    // tant qu'aucun second appelant n'apparaît.
    if (!src || src.kind !== 'http') return { ok: false, erreur: 'source introuvable' };
    const cible = construireCible({ baseUrl: src.baseUrl, binding: { methode: 'GET', chemin }, args: {} });
    if (!cible.ok) return { ok: false, erreur: cible.raison };
    // Sans sa clé (un brouillon déclaré depuis Claude, B10, livraison 4a), rien ne part : l'épreuve le dit au lieu
    // d'appeler sans authentification, ou de prendre le mot de passe absent pour un refus du serveur d'autorisation.
    if (src.authKind !== 'none' && !src.authSecret) {
      await deps.sources.marquerEpreuve(tenant, id, false, SANS_SECRET);
      return { ok: false, erreur: SANS_SECRET };
    }
    // Même construction d'en-têtes que l'appel réel, sinon l'épreuve dirait « ça répond » d'une source que
    // les appels ne savent pas authentifier.
    const auth = await jetons.entetes(src);
    if (!auth.ok) {
      const erreur = auth.erreur === 'auth' ? 'connexion refusée (identifiant ou mot de passe)' : 'jeton indisponible';
      await deps.sources.marquerEpreuve(tenant, id, false, erreur);
      return { ok: false, erreur };
    }
    const headers = auth.entetes;
    const transporte = await transportHttp.executer({
      url: cible.url,
      methode: 'GET',
      entetes: headers,
      corps: null,
      // Le délai couvre aussi la résolution DNS, comme pour le bouton d'essai de la requête.
      signal: AbortSignal.timeout(10_000),
      lecture: { nature: 'aucune' },
    });
    if (transporte.nature === 'adresse_refusee') {
      await deps.sources.marquerEpreuve(tenant, id, false, 'adresse non joignable');
      return { ok: false, erreur: INTERNE };
    }
    if (transporte.nature === 'redirection_refusee') {
      await deps.sources.marquerEpreuve(tenant, id, false, 'redirection refusée');
      return { ok: false, erreur: 'le système du client a redirigé l’appel, ce qui n’est pas accepté sur un connecteur' };
    }
    if (transporte.nature !== 'reponse') {
      await deps.sources.marquerEpreuve(tenant, id, false, 'injoignable');
      return { ok: false, erreur: 'systeme injoignable' };
    }
    const auth401 = transporte.httpStatus === 401 || transporte.httpStatus === 403;
    if (auth401) jetons.oublier(id);
    const ok = transporte.httpStatus >= 200 && transporte.httpStatus < 300;
    await deps.sources.marquerEpreuve(tenant, id, ok, auth401 ? 'authentification refusee' : `HTTP ${transporte.httpStatus}`);
    return {
      ok,
      httpStatus: transporte.httpStatus,
      ...(ok ? {} : { erreur: auth401 ? 'authentification refusee' : `HTTP ${transporte.httpStatus}` }),
    };
  };
}
