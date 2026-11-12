import { texteDe } from '../lib/erreur';
import { DELAI_STOP_MS, ReconsentRequiredError } from './hubspot-service';

/**
 * LE DÉSABONNEMENT WHATSAPP VERS HUBSPOT (plan `docs/superpowers/plans/2026-11-12-stop-vers-hubspot.md`, décisions de
 * Julien du 2026-11-12). Chaque passage du consentement d'une fiche, un STOP comme un réabonnement, s'annonce ici après
 * le `commit` (`PgContactStore`) ; la file `hubspot-stop` relit alors l'ÉTAT enregistré et le pose sur les fiches
 * HubSpot du numéro (flag `stop` du connecteur : la case « MM - WhatsApp désabonné » et sa date). On pousse un état,
 * jamais un événement : un rejeu, un doublon ou deux annonces dans le désordre finissent sur l'état du moment, tant que
 * la file est consommée un job à la fois (`src/worker.ts`).
 * Le résumé de conversation porte aussi la case (`stopPourAnalyse`), dans le seul sens « désabonné ».
 */

/** La file, déclarée ici et importée par `names.ts` : le nom d'une file ne s'écrit qu'une fois. */
export const FILE_HUBSPOT_STOP = 'hubspot-stop';

/** Combien de fiches voyagent dans un job : chacune coûte un appel au connecteur, qui peut durer `DELAI_STOP_MS`. */
export const TAILLE_LOT_HUBSPOT_STOP = 20;

/** Le job : un espace, et les `wa_id` dont le consentement vient de changer. */
export interface JobHubspotStop {
  tenantId: string;
  waIds: string[];
}

/** Les lots d'une annonce : dédupliqués, sans vide, découpés sans rien perdre. */
export function lotsHubspotStop(waIds: readonly string[]): string[][] {
  const uniques = [...new Set(waIds.map((w) => w.trim()).filter((w) => w !== ''))];
  const lots: string[][] = [];
  for (let i = 0; i < uniques.length; i += TAILLE_LOT_HUBSPOT_STOP) lots.push(uniques.slice(i, i + TAILLE_LOT_HUBSPOT_STOP));
  return lots;
}

/**
 * L'échéance d'un lot pour pg-boss : chaque fiche peut attendre le connecteur `DELAI_STOP_MS`, plus une minute de marge.
 * Au défaut (15 min), un lot lent serait rejoué en parallèle de lui-même.
 */
export function echeanceDuLotStop(taille: number): number {
  return Math.ceil((taille * DELAI_STOP_MS) / 1000) + 60;
}

export interface DepsAnnonceHubspotStop {
  /** Met un lot en file. Peut lever : l'annonce l'absorbe. */
  enfiler(job: JobHubspotStop, opts: { expireInSeconds: number }): Promise<void>;
  log?(message: string): void;
}

/**
 * L'annonce, appelée par `PgContactStore` après un passage du consentement. 🔴 Ne lève jamais : le consentement est déjà
 * enregistré, et une file indisponible ferait sinon rendre 500 à la route qui vient de l'écrire.
 */
export function creerAnnonceHubspotStop(deps: DepsAnnonceHubspotStop) {
  return async (tenantId: string, waIds: readonly string[]): Promise<void> => {
    for (const lot of lotsHubspotStop(waIds)) {
      try {
        await deps.enfiler({ tenantId, waIds: lot }, { expireInSeconds: echeanceDuLotStop(lot.length) });
      } catch (err) {
        deps.log?.(`hubspot-stop: ${lot.length} changements de consentement non annonces pour ${tenantId}: ${texteDe(err)}`);
      }
    }
  };
}

/**
 * Ajoute l'annonce HubSpot à celle d'un désabonnement (connecteur API du client, signaux), sans que la première puisse
 * empêcher la seconde.
 */
export function annoncerAussiAHubspot(
  annonce: (tenantId: string, waIds: string[], messageDuStop?: string) => Promise<void>,
  hubspot: (tenantId: string, waIds: readonly string[]) => Promise<void>,
): (tenantId: string, waIds: string[], messageDuStop?: string) => Promise<void> {
  return async (tenantId, waIds, messageDuStop) => {
    try {
      await annonce(tenantId, waIds, messageDuStop);
    } finally {
      await hubspot(tenantId, waIds);
    }
  };
}

/** Le consentement enregistré d'une fiche, tel que `PgContactStore.consentementParWaId` le rend. */
export interface ConsentementDeFiche {
  phoneE164: string | null;
  desabonne: boolean;
  optOutAt: string | null;
}

export interface DepsTravailHubspotStop {
  /** L'espace a allumé « Désabonnement WhatsApp » (choix HubSpot, relu à l'exécution, jamais porté par le job). */
  actif(tenantId: string): Promise<boolean>;
  /** Le consentement enregistré de la fiche, relu à l'exécution. */
  consentement(tenantId: string, waId: string): Promise<ConsentementDeFiche | null>;
  /** Pose l'état chez le connecteur (`poserStopHubspot`). */
  poser(tenantId: string, e164: string, valeur: boolean, date: string | null): Promise<'ecrit' | 'contact_inconnu' | 'non_relie'>;
  log?(message: string): void;
}

/** Payload valide ? Lu défensivement : le job vient de la base, pas du compilateur. */
function lireJob(data: unknown): JobHubspotStop | null {
  if (data === null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.tenantId !== 'string' || d.tenantId === '') return null;
  if (!Array.isArray(d.waIds)) return null;
  return { tenantId: d.tenantId, waIds: d.waIds.filter((w): w is string => typeof w === 'string' && w.trim() !== '') };
}

/** Un numéro E.164 : le seul que le flag `stop` joint (un BSUID n'en est pas un). */
const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Le travail : pour chaque fiche du lot, relire son consentement et le poser chez HubSpot. Rien quand le réglage est
 * éteint, ni pour une fiche disparue, sans numéro (un contact connu par son seul BSUID : le connecteur cherche par
 * téléphone) ou d'un numéro hors E.164 (le connecteur le refuserait à chaque rejeu). Aucun portail relié : le reste du
 * lot non plus. Un portail qui demande un re-consentement est journalisé et laissé : le rejouer ne le réparerait pas.
 * 🔴 Une fiche en échec n'arrête pas les suivantes : un numéro qui échoue à chaque appel (porté par cent fiches HubSpot,
 * par exemple) priverait sinon de leur case, à chaque rejeu, toutes celles qui le suivent dans le lot. Le lot les tente
 * toutes, puis lève s'il y a eu un échec : pg-boss le rejoue en entier (reposer un état ne change rien), puis la DLQ,
 * visible de `/ops` (le modèle de `creerTravailPousseeOptOut`).
 */
export function creerTravailHubspotStop(deps: DepsTravailHubspotStop) {
  return async (data: unknown): Promise<void> => {
    const job = lireJob(data);
    if (job === null) throw new Error('hubspot-stop : payload invalide (tenantId/waIds manquant)');
    if (job.waIds.length === 0 || !(await deps.actif(job.tenantId))) return;
    const echecs: string[] = [];
    for (const waId of job.waIds) {
      try {
        const c = await deps.consentement(job.tenantId, waId);
        if (!c?.phoneE164 || !E164.test(c.phoneE164)) continue;
        if ((await deps.poser(job.tenantId, c.phoneE164, c.desabonne, c.desabonne ? c.optOutAt : null)) === 'non_relie') return;
      } catch (err) {
        if (err instanceof ReconsentRequiredError) {
          deps.log?.(`hubspot-stop: le portail de ${job.tenantId} demande un re-consentement, ${job.waIds.length} etats non poses`);
          return;
        }
        echecs.push(`${waId}: ${texteDe(err)}`);
      }
    }
    if (echecs.length > 0) {
      deps.log?.(`hubspot-stop: ${echecs.length}/${job.waIds.length} etats non poses pour ${job.tenantId} (${echecs.slice(0, 3).join(' | ')})`);
      throw new Error(`hubspot-stop : ${echecs.length} etat(s) non pose(s) sur ${job.waIds.length}`);
    }
  };
}

/**
 * La case que porte le résumé de conversation (décision de Julien du 2026-11-12) : `{ date? }` quand le contact est
 * désabonné ET que l'espace a allumé « Désabonnement WhatsApp », `null` sinon. Jamais « réabonné » par cette voie : une
 * analyse construite avant un STOP et écrite après ne doit pas pouvoir le défaire. Rien pour un contact connu par son
 * seul BSUID : le flag `stop`, seul à décocher la case, ne le joindrait pas.
 */
export function stopPourAnalyse(deps: Pick<DepsTravailHubspotStop, 'actif' | 'consentement'>) {
  return async (tenantId: string, contactE164: string): Promise<{ date?: string } | null> => {
    if (!E164.test(contactE164) || !(await deps.actif(tenantId))) return null;
    const c = await deps.consentement(tenantId, contactE164.slice(1));
    if (!c?.desabonne) return null;
    return c.optOutAt ? { date: c.optOutAt } : {};
  };
}
