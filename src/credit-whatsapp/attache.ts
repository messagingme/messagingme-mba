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

/**
 * Un compte WhatsApp que le partenaire ne voit pas (erreur Graph 100/33, mesurée le 2026-11-12 sur un compte inconnu, au
 * retrait comme à la lecture) : jamais partagé avec lui, ou son accès retiré. Sa ligne ne peut ni s'y attacher ni en être
 * retirée par son API, et réessayer n'y change rien : c'est ce qui la sépare d'une panne.
 */
export class CompteInconnuDuPartenaire extends Error {}

/**
 * Meta refuse l'attache parce que le compte « is already using a payment method » (relevé par l'alerte de l'essai réel
 * 258, le 2026-11-13, sur un compte de messagerie tout juste créé par la fenêtre) : un moyen de paiement que l'API
 * du partenaire ne tient pas pour sa ligne, puisqu'elle répond `{"ok":1}` à une attache déjà faite par elle (mesuré le
 * 2026-11-12). Ce PUT n'a donc rien attaché.
 */
export class MoyenDePaiementEnPlace extends Error {}
const DEJA_UN_MOYEN_DE_PAIEMENT = /already using a payment method/i;

const SUCCES = z.object({ ok: z.literal(1) }).passthrough();
const ETAT = z.object({ ok: z.literal(1), data: z.object({ creditLineAdded: z.boolean() }).passthrough() }).passthrough();
const ECHEC = z.object({ ok: z.literal(0), error: z.unknown() }).passthrough();
// Le code et le sous-code se lisent sans contrainte de type, et FACULTATIFS : Zod 4 exige une clé `z.unknown()` nue, et
// la plupart des erreurs de Graph n'ont pas de sous-code. Un format inattendu ne doit jamais faire perdre le message.
const ERREUR_GRAPH = z.object({
  error: z.object({ message: z.string(), code: z.unknown().optional(), error_subcode: z.unknown().optional() }).passthrough(),
}).passthrough();

/** L'erreur Graph 100/33 que le partenaire enveloppe : l'objet n'existe pas, ou il n'a pas le droit de le lire. */
function compteInconnu(corps: unknown): boolean {
  const e = ECHEC.safeParse(corps);
  const graph = e.success ? ERREUR_GRAPH.safeParse(e.data.error) : null;
  return graph?.success === true && graph.data.error.code === 100 && graph.data.error.error_subcode === 33;
}

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

  const refus = (statut: number, corps: unknown): Error => {
    const cause = corps === undefined ? 'réponse illisible' : causeDuRefus(corps);
    const texte = `HTTP ${statut} : ${cause}`;
    if (compteInconnu(corps)) return new CompteInconnuDuPartenaire(texte);
    return DEJA_UN_MOYEN_DE_PAIEMENT.test(cause) ? new MoyenDePaiementEnPlace(texte) : new Error(texte);
  };

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

/**
 * La ligne n'est tenue pour attachée que VÉRIFIÉE : une attache que la vérification dément lève.
 *
 * 🔴 Une attache refusée ou coupée se RELIT avant de conclure (essai réel 258, le 2026-11-13) : la ligne a pu être
 * là avant nous, ou ce PUT l'avoir faite malgré la panne. Conclure sans relire faisait retirer à la pose une ligne
 * peut-être en place, et le compte se retrouvait sans aucun moyen de paiement jusqu'à une pose à la main dans /ops.
 * Refusée parce que Meta voit déjà un moyen de paiement que le partenaire ne tient pas pour sa ligne, elle se retire par
 * son API (« plus rien à retirer » est un succès), puis se redemande UNE fois : c'est l'enchaînement qui l'a attachée ce
 * jour-là, à la main. Un compte que le partenaire ne voit pas ne se relit pas : rien n'a pu s'y attacher.
 */
export async function attacherEtVerifier(a: AttacheLigne, wabaId: string): Promise<void> {
  try {
    await a.attacher(wabaId);
  } catch (err) {
    if (err instanceof CompteInconnuDuPartenaire) throw err;
    // Une relecture en panne ne dit rien : la cause du refus remonte, pas la sienne.
    if (await a.verifier(wabaId).catch(() => false)) return;
    if (!(err instanceof MoyenDePaiementEnPlace)) throw err;
    const retrait = await a.retirer(wabaId);
    // Ce que le retrait a trouvé dit, la prochaine fois, si la ligne était déjà là (retirée) ou s'il s'agit d'autre chose.
    journaliser('warn', 'ligne_partenaire_moyen_de_paiement_en_place', { wabaId, retrait });
    await a.attacher(wabaId);
  }
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
 * Retire l'attache d'un compte SANS lever, quand plus rien ne doit la porter : nos lignes de l'option arrêtées (la garde
 * refuse les envois d'une ligne arrêtée), ou notre pose qui n'a pas abouti (l'attache a pu se faire quand même). Rend
 * `true` quand le partenaire confirme (retirée, ou déjà absente) ; une panne se journalise, alerte Julien et rend `false` :
 * sa ligne resterait attachée, et les envois de ce compte payés par lui, donc par nous, sans débit. 🔴 Jamais pour retirer
 * NOTRE ligne : retirée, la garde ignore le numéro et ses envois partent sans provision ; le retrait de /ops retire donc
 * la sienne d'abord, et garde la nôtre si elle ne part pas (relecture du lot de l'attache, rouge 2).
 */
export async function retirerLAttacheSansLever(
  d: Pick<DepsCycleAttache, 'attache' | 'alerter'>, tenantId: string, wabaId: string, quand: string,
): Promise<boolean> {
  if (d.attache === null) return true;
  try {
    await d.attache.retirer(wabaId);
    return true;
  } catch (err) {
    journaliser('error', 'ligne_partenaire_retrait_impossible', { tenantId, wabaId, err: message(err) });
    await d.alerter(`${quand} : espace ${tenantId}, la ligne du partenaire n’a pas pu être retirée du compte WhatsApp ${wabaId} (${message(err)}). À retirer à la main, sinon sa consommation reste à notre charge.`).catch(() => undefined);
    return false;
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
      await retirerLAttacheSansLever(d, tenantId, waba, 'Fin de l’option Ligne de crédit');
    }
  } catch (err) {
    journaliser('error', 'ligne_partenaire_retrait_impossible', { tenantId, err: message(err) });
    await d.alerter(`Fin de l’option Ligne de crédit : espace ${tenantId}, les lignes du partenaire n’ont pas pu être relues pour être retirées (${message(err)}). À retirer à la main.`).catch(() => undefined);
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
        await d.alerter(`Reprise de l’option Ligne de crédit : espace ${tenantId}, la ligne du partenaire n’a pas pu être rattachée au compte WhatsApp ${waba} (${message(err)}). Meta refusera ses modèles : la reposer dans /ops.`).catch(() => undefined);
      }
    }
  } catch (err) {
    journaliser('error', 'ligne_partenaire_rattache_impossible', { tenantId, err: message(err) });
    await d.alerter(`Reprise de l’option Ligne de crédit : espace ${tenantId}, les lignes n’ont pas pu être relues pour rattacher celle du partenaire (${message(err)}). À rattacher à la main.`).catch(() => undefined);
  }
  return n;
}
