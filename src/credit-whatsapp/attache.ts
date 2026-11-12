import { SignJWT } from 'jose';
import { z } from 'zod';
import { journaliser } from '../lib/journal';
import type { LigneCredit } from './lignes.pg';

/**
 * LA LIGNE DE CRÉDIT DU PARTENAIRE, ATTACHÉE PAR SON API (plan `2026-11-12-credit-whatsapp-attache-par-l-api.md`). Le
 * compte WhatsApp connecté par la fenêtre du partenaire lui est partagé, mais sa ligne ne s'y attache qu'à NOTRE demande
 * (essai réel 236, puis sa réponse du 2026-11-11) : nous en payons la consommation, donc nous seuls décidons quels comptes
 * y sont branchés. Trois appels sur un compte WhatsApp : attacher (`PUT`), retirer (`DELETE`), vérifier (`GET`), chacun
 * avec un jeton JWT HS256 signé du secret qu'il nous a remis (`iss` = notre émetteur, `aud` = `whatsapp-cloud`).
 *
 * Les réponses lues ici sont celles MESURÉES le 2026-11-12 sur le compte de test de l'essai 236 : `{"ok":1}` pour
 * attacher (aussi sur un compte déjà attaché) et retirer, `{"ok":1,"data":{"wabaId","creditLineAdded"}}` pour vérifier,
 * `500 {"ok":0,"error":"Credit line is not attached to this WABA"}` quand il n'y a plus rien à retirer, une erreur de
 * Graph enveloppée pour un compte inconnu. L'adresse, l'émetteur et le secret sont des variables d'environnement
 * (`LIGNE_PARTENAIRE_*`) : ni le partenaire ni son adresse ne s'écrivent dans le dépôt, et le jeton ne se journalise pas.
 */

/** Attacher a pris jusqu'à 11 s à la mesure : un délai large, que l'appelant attend. */
export const DELAI_ATTACHE_MS = 30_000;
const AUDIENCE = 'whatsapp-cloud';
const VALIDITE_JETON_S = 300;
/** Ce que répond un retrait quand la ligne n'est déjà plus attachée : l'état voulu, pas une panne. */
const PLUS_RIEN_A_RETIRER = /credit line is not attached/i;

export interface ConfigAttache {
  /** L'adresse de la ligne de crédit chez le partenaire (`LIGNE_PARTENAIRE_URL`). */
  url: string;
  /** Notre émetteur chez lui, le `iss` du jeton (`LIGNE_PARTENAIRE_EMETTEUR`). */
  emetteur: string;
  /** Le secret qui signe le jeton (`LIGNE_PARTENAIRE_SECRET`, secrète). */
  secret: string;
}

/** Les trois gestes sur un compte WhatsApp ; chacun lève avec sa cause, jamais un succès inventé. */
export interface AttacheLigne {
  attacher(wabaId: string): Promise<void>;
  /** `deja_absente` : la ligne n'était plus attachée, ce qui est l'état voulu. */
  retirer(wabaId: string): Promise<'retiree' | 'deja_absente'>;
  /** `true` : la ligne du partenaire est attachée à ce compte. */
  verifier(wabaId: string): Promise<boolean>;
}

const SUCCES = z.object({ ok: z.literal(1) }).passthrough();
const ETAT = z.object({ ok: z.literal(1), data: z.object({ creditLineAdded: z.boolean() }).passthrough() }).passthrough();
const ECHEC = z.object({ ok: z.literal(0), error: z.unknown() }).passthrough();
const ERREUR_GRAPH = z.object({ error: z.object({ message: z.string() }).passthrough() }).passthrough();

/** La cause d'un refus en texte court : leur message, ou celui de Graph qu'il enveloppe. */
function causeDuRefus(corps: unknown): string {
  const e = ECHEC.safeParse(corps);
  if (!e.success) return 'réponse illisible';
  if (typeof e.data.error === 'string') return e.data.error;
  const graph = ERREUR_GRAPH.safeParse(e.data.error);
  return graph.success ? graph.data.error.message : 'erreur sans message';
}

const enSucces = (statut: number): boolean => statut >= 200 && statut < 300;

export function creerAttacheLigne(c: ConfigAttache, o: { fetch?: typeof fetch; delaiMs?: number } = {}): AttacheLigne {
  const appeler = o.fetch ?? fetch;
  const cle = new TextEncoder().encode(c.secret);

  async function jeton(): Promise<string> {
    const maintenant = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(c.emetteur)
      .setAudience(AUDIENCE)
      .setIssuedAt(maintenant)
      .setExpirationTime(maintenant + VALIDITE_JETON_S)
      .sign(cle);
  }

  async function appel(methode: 'GET' | 'PUT' | 'DELETE', wabaId: string): Promise<{ statut: number; corps: unknown }> {
    const url = methode === 'GET' ? `${c.url}?waba_id=${encodeURIComponent(wabaId)}` : c.url;
    let r: Response;
    try {
      r = await appeler(url, {
        method: methode,
        headers: { authorization: `Bearer ${await jeton()}`, ...(methode === 'GET' ? {} : { 'content-type': 'application/json' }) },
        ...(methode === 'GET' ? {} : { body: JSON.stringify({ wabaId }) }),
        signal: AbortSignal.timeout(o.delaiMs ?? DELAI_ATTACHE_MS),
      });
    } catch (err) {
      throw new Error(`API du partenaire injoignable : ${err instanceof Error ? err.message : String(err)}`);
    }
    const texte = await r.text();
    let corps: unknown;
    try { corps = JSON.parse(texte); } catch { corps = undefined; }
    return { statut: r.status, corps };
  }

  const refus = (statut: number, corps: unknown): Error =>
    new Error(`HTTP ${statut} : ${corps === undefined ? 'réponse illisible' : causeDuRefus(corps)}`);

  return {
    async verifier(wabaId) {
      const { statut, corps } = await appel('GET', wabaId);
      const etat = ETAT.safeParse(corps);
      if (enSucces(statut) && etat.success) return etat.data.data.creditLineAdded;
      throw enSucces(statut) ? new Error(`HTTP ${statut} : réponse illisible`) : refus(statut, corps);
    },
    async attacher(wabaId) {
      const { statut, corps } = await appel('PUT', wabaId);
      if (enSucces(statut) && SUCCES.safeParse(corps).success) return;
      throw refus(statut, corps);
    },
    async retirer(wabaId) {
      const { statut, corps } = await appel('DELETE', wabaId);
      if (enSucces(statut) && SUCCES.safeParse(corps).success) return 'retiree';
      if (PLUS_RIEN_A_RETIRER.test(causeDuRefus(corps))) return 'deja_absente';
      throw refus(statut, corps);
    },
  };
}

/** La ligne n'est tenue pour attachée que VÉRIFIÉE : une attache que la vérification dément lève. */
export async function attacherEtVerifier(a: AttacheLigne, wabaId: string): Promise<void> {
  await a.attacher(wabaId);
  if (!(await a.verifier(wabaId))) throw new Error('la ligne n’est pas attachée après la demande (vérification du partenaire)');
}

/** Le cycle de l'option : ce que la fin et la reprise lisent et appellent. `attache` nulle : rien n'est configuré. */
export interface DepsCycleAttache {
  lignes: {
    arreterLesLignesDeLOption(tenantId: string): Promise<number>;
    relancerLesLignesDeLOption(tenantId: string): Promise<number>;
    lignesDeLEspace(tenantId: string): Promise<ReadonlyArray<Pick<LigneCredit, 'wabaId' | 'origine' | 'arreteeLe'>>>;
  };
  attache: AttacheLigne | null;
  /** L'alerte à Julien (Telegram) ; une propriété : elle se transmet détachée. */
  alerter: (texte: string) => Promise<void>;
}

/** Les comptes WhatsApp des lignes de l'option, arrêtées ou en service, chacun une fois. */
function comptesDeLOption(lignes: ReadonlyArray<Pick<LigneCredit, 'wabaId' | 'origine' | 'arreteeLe'>>, arretees: boolean): string[] {
  const comptes = lignes
    .filter((l) => l.origine === 'option' && (l.arreteeLe !== null) === arretees)
    .map((l) => l.wabaId)
    .filter((w): w is string => w !== null);
  return [...new Set(comptes)];
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Retire l'attache d'un compte SANS lever : le geste qui l'a demandée (un arrêt, un retrait) est déjà fait, et notre garde
 * coupe les envois d'une ligne arrêtée ou retirée. Une panne se journalise et alerte Julien : la ligne du partenaire
 * resterait attachée, et sa consommation à notre charge.
 */
export async function retirerLAttacheSansLever(
  d: Pick<DepsCycleAttache, 'attache' | 'alerter'>, tenantId: string, wabaId: string, quand: string,
): Promise<void> {
  if (d.attache === null) return;
  try {
    await d.attache.retirer(wabaId);
  } catch (err) {
    journaliser('error', 'ligne_partenaire_retrait_impossible', { tenantId, wabaId, err: message(err) });
    await d.alerter(`${quand} : espace ${tenantId}, la ligne du partenaire n’a pas pu être retirée du compte WhatsApp ${wabaId} (${message(err)}). À retirer à la main, sinon sa consommation reste à notre charge.`).catch(() => undefined);
  }
}

/**
 * La fin de l'option (fin de droit, webhook de Stripe) : nos lignes de l'option s'arrêtent, puis l'attache de chaque
 * compte arrêté se retire. Rend le nombre de lignes arrêtées, comme avant ; ne lève que si l'arrêt lui-même lève.
 */
export async function arreterLesLignesEtLeursAttaches(d: DepsCycleAttache, tenantId: string): Promise<number> {
  const n = await d.lignes.arreterLesLignesDeLOption(tenantId);
  if (n === 0 || d.attache === null) return n;
  try {
    for (const waba of comptesDeLOption(await d.lignes.lignesDeLEspace(tenantId), true)) {
      await retirerLAttacheSansLever(d, tenantId, waba, 'Fin de l’option Crédit WhatsApp');
    }
  } catch (err) {
    journaliser('error', 'ligne_partenaire_retrait_impossible', { tenantId, err: message(err) });
    await d.alerter(`Fin de l’option Crédit WhatsApp : espace ${tenantId}, les lignes du partenaire n’ont pas pu être relues pour être retirées (${message(err)}). À retirer à la main.`).catch(() => undefined);
  }
  return n;
}

/**
 * La reprise de l'option : nos lignes de l'option repartent, puis chaque compte en service se rattache, vérifié. Une
 * panne alerte : la ligne est en service sans l'attache, et Meta refusera ses modèles jusqu'au rattachement.
 */
export async function relancerLesLignesEtLeursAttaches(d: DepsCycleAttache, tenantId: string): Promise<number> {
  const n = await d.lignes.relancerLesLignesDeLOption(tenantId);
  if (n === 0 || d.attache === null) return n;
  try {
    for (const waba of comptesDeLOption(await d.lignes.lignesDeLEspace(tenantId), false)) {
      try {
        await attacherEtVerifier(d.attache, waba);
      } catch (err) {
        journaliser('error', 'ligne_partenaire_rattache_impossible', { tenantId, wabaId: waba, err: message(err) });
        await d.alerter(`Reprise de l’option Crédit WhatsApp : espace ${tenantId}, la ligne du partenaire n’a pas pu être rattachée au compte WhatsApp ${waba} (${message(err)}). Meta refusera ses modèles : la reposer dans /ops.`).catch(() => undefined);
      }
    }
  } catch (err) {
    journaliser('error', 'ligne_partenaire_rattache_impossible', { tenantId, err: message(err) });
    await d.alerter(`Reprise de l’option Crédit WhatsApp : espace ${tenantId}, les lignes n’ont pas pu être relues pour rattacher celle du partenaire (${message(err)}). À rattacher à la main.`).catch(() => undefined);
  }
  return n;
}
