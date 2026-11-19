import { journaliser } from '../lib/journal';
import { messageDe } from '../lib/erreur';
import { supprimerUnModele, type DepsGestionModeles } from '../templates/gestion';
import { DELAI_PANIER_MAX, DELAI_PANIER_MIN, EVENEMENTS_DISPONIBLES, estEvenementShopify } from './donnees';
import type { Issue, Refus } from './gestion';
import type { PgShopifyStore } from './store.pg';
import type { PgModelesDeBloc } from '../workflow/modeles-de-bloc.pg';
import type { PgWorkflowStore } from '../workflow/store.pg';

/**
 * CE QUI RESTE DE L'ANCIEN ASSISTANT DES MESSAGES SHOPIFY (conception 2026-10-22) depuis que chaque message est le premier
 * bloc d'un scénario (menu « Scénario », lot 5) : l'assistant, son activation à l'approbation de Meta et son filet sont
 * retirés ; restent le MÉNAGE différé de ses modèles et le réglage du délai que l'écran d'avant envoie encore.
 *
 * Le ménage (demande de Julien, 2026-10-23) : chaque texte de l'assistant créait un NOUVEAU modèle chez Meta. Celui qu'un
 * geste remplaçait, s'il avait été créé par l'assistant, est supprimé chez Meta : sinon chaque retouche en laissait un de
 * plus dans l'écran Modèles, sous le plafond de modèles du compte.
 *
 * 🔴 LA SUPPRESSION EST DIFFÉRÉE (relecture du lot) : un geste ne fait que PROGRAMMER un travail (`oublierPlusTard`, file
 * `FILE_OUBLI_MODELE`), qui relit tout un quart d'heure plus tard (`traiterOubli`). Supprimée tout de suite, la version
 * remplacée ferait échouer les envois qui l'ont lue juste avant (une confirmation de commande en vol, un lot de relances
 * réclamé). Le travail sort aussi l'appel à Meta de la file des messages entrants.
 *
 * La même file sert le ménage des TEMPLATES DE BLOC d'un scénario d'automation (spec § 5.1, menu « Scénario », lot 5) :
 * un travail `type: 'bloc'`, programmé à la mise en ligne (`programmerMenage`, `src/workflow/modeles-de-bloc.ts`).
 */

/** Supprimer un modèle chez Meta, toutes langues : `supprimerUnModele` (garde des campagnes actives), traduite. */
export type SupprimerModele = (tenantId: string, nom: string) => Promise<{ ok: true } | { ok: false; message: string }>;

/** La file du ménage différé (`BASE_QUEUES`), consommée par le worker. */
export const FILE_OUBLI_MODELE = 'shopify-oubli-modele';
/** Le délai avant la suppression : plus long que tout envoi en vol (un lot de relances se vide en moins d'une minute). */
export const DELAI_OUBLI_MS = 15 * 60_000;
/** Un refus (une campagne active s'en sert) se retente toutes les heures, six fois au plus, puis s'abandonne. */
export const REESSAI_OUBLI_MS = 60 * 60_000;
export const ESSAIS_OUBLI = 6;

/**
 * Un travail du ménage. Sans `type` : un modèle de l'ancien assistant (son nom le dit). `type: 'bloc'` : un template écrit
 * depuis un bloc d'un scénario d'automation, avec sa langue pour relire sa marque (sa ligne de `modeles_de_bloc`).
 */
export interface JobOubli { tenantId: string; modele: string; essai: number; type?: 'bloc'; langue?: string }
/** Enfiler un travail du ménage à son heure (`queue.enqueue` avec `startAfter`, lié par le câblage). */
export type ProgrammerOubli = (job: JobOubli, quand: Date) => Promise<void>;

/** La mise en service de l'assistant : aucun de ses modèles n'est plus ancien. */
const DEBUT_ASSISTANT = Date.UTC(2026, 9, 22);
const NOM_DE_L_ASSISTANT = /^shopify_(order_paid|order_fulfilled|checkout_abandoned)_([0-9a-z]{8})$/;

/**
 * Le modèle a-t-il été créé par l'assistant ? Son nom EXACT : `shopify_<événement>_<horodatage en base 36>`, et cet
 * horodatage tombe entre la mise en service de l'assistant et maintenant (plus un jour de marge). 🔴 C'est la seule garde
 * qui dit « créé par l'assistant » : un nom choisi par le marchand ou par Claude Code (`commande_payee`,
 * `shopify_order_paid_v2`, `shopify_order_paid_20261023`, qui décodé tombe en 1974) n'est jamais supprimé.
 */
export function estModeleDeLAssistant(nom: string, maintenant: number = Date.now()): boolean {
  const m = NOM_DE_L_ASSISTANT.exec(nom);
  if (!m) return false;
  const quand = parseInt(m[2]!, 36);
  return quand >= DEBUT_ASSISTANT && quand <= maintenant + 24 * 3600_000;
}

/** La suppression de l'écran Modèles, liée par le câblage du worker : un refus ou une panne devient un message. */
export function suppressionDesModeles(deps: Pick<DepsGestionModeles, 'repo' | 'meta' | 'indices'>): SupprimerModele {
  return async (tenantId, nom) => {
    try {
      const issue = await supprimerUnModele(deps, tenantId, nom);
      if ('refus' in issue) return { ok: false, message: issue.refus.error };
      return issue.res.success ? { ok: true } : { ok: false, message: 'Meta n’a pas confirmé la suppression' };
    } catch (err) {
      return { ok: false, message: String(messageDe(err)) };
    }
  };
}

/**
 * Programmer l'oubli d'un modèle que ce geste remplace. Rien si le nom n'est pas celui de l'assistant, ou si c'est le
 * modèle qu'on vient de brancher (`garde`). Un enfilement qui échoue se journalise et ne bloque pas le geste : le
 * modèle reste simplement dans l'écran Modèles.
 */
export async function oublierPlusTard(
  deps: { programmerOubli: ProgrammerOubli; maintenant?: () => number },
  tenantId: string, modele: string | null | undefined, garde: string,
): Promise<void> {
  const maintenant = (deps.maintenant ?? Date.now)();
  if (!modele || modele === garde || !estModeleDeLAssistant(modele, maintenant)) return;
  try {
    await deps.programmerOubli({ tenantId, modele, essai: 0 }, new Date(maintenant + DELAI_OUBLI_MS));
  } catch (err) {
    journaliser('warn', 'shopify_modele_oubli_non_programme', { tenantId, modele, raison: String(messageDe(err)) });
  }
}

/** Ce que le travail du ménage relit avant de supprimer. */
export interface DepsOubli {
  store: Pick<PgShopifyStore, 'messages' | 'attentes'>;
  /** La marque d'un template de bloc : sa ligne de `modeles_de_bloc`. */
  blocs: Pick<PgModelesDeBloc, 'desModeles'>;
  /** Un graphe de l'espace (publié, brouillon ou programmé, tous rayons) nomme-t-il encore ce template ? */
  scenarios: Pick<PgWorkflowStore, 'nommeLeModele'>;
  supprimerModele: SupprimerModele;
  programmerOubli: ProgrammerOubli;
  maintenant?: () => number;
}

/**
 * Le travail du ménage (worker) : relire, puis supprimer le modèle s'il ne sert plus. Un modèle de l'assistant : rien s'il
 * est ENCORE branché à un message ou attendu par une préparation. Un template de bloc : rien sans sa marque, ni s'il est
 * ENCORE nommé par un graphe de l'espace (relus au moment même : un geste a pu le remettre entre-temps). La suppression
 * garde les campagnes actives ; un refus se retente une heure plus tard, `ESSAIS_OUBLI` fois au plus.
 */
export async function traiterOubli(deps: DepsOubli, donnees: unknown): Promise<'supprime' | 'garde' | 'reessai' | 'abandon' | 'ignore'> {
  const j = donnees as Partial<JobOubli> | null;
  if (!j || typeof j.tenantId !== 'string' || typeof j.modele !== 'string' || typeof j.essai !== 'number') return 'ignore';
  const maintenant = (deps.maintenant ?? Date.now)();
  if (j.type === 'bloc') {
    if (typeof j.langue !== 'string') return 'ignore';
    if ((await deps.blocs.desModeles(j.tenantId, [{ modele: j.modele, langue: j.langue }])).length === 0) return 'ignore';
    if (await deps.scenarios.nommeLeModele(j.tenantId, j.modele)) return 'garde';
  } else {
    if (!estModeleDeLAssistant(j.modele, maintenant)) return 'ignore';
    const [messages, attentes] = await Promise.all([deps.store.messages(j.tenantId), deps.store.attentes(j.tenantId)]);
    if (messages.some((m) => m.modele === j.modele) || attentes.some((a) => a.modele === j.modele)) return 'garde';
  }
  const r = await deps.supprimerModele(j.tenantId, j.modele);
  if (r.ok) {
    journaliser('info', 'shopify_modele_oublie', { tenantId: j.tenantId, modele: j.modele });
    return 'supprime';
  }
  if (j.essai + 1 < ESSAIS_OUBLI) {
    const suite: JobOubli = j.type === 'bloc' ? { type: 'bloc', tenantId: j.tenantId, modele: j.modele, langue: j.langue, essai: j.essai + 1 } : { tenantId: j.tenantId, modele: j.modele, essai: j.essai + 1 };
    await deps.programmerOubli(suite, new Date(maintenant + REESSAI_OUBLI_MS));
    journaliser('info', 'shopify_modele_oubli_reporte', { tenantId: j.tenantId, modele: j.modele, raison: r.message, essai: j.essai + 1 });
    return 'reessai';
  }
  journaliser('warn', 'shopify_modele_oubli_abandonne', { tenantId: j.tenantId, modele: j.modele, raison: r.message });
  return 'abandon';
}

const refus = (statut: Refus['statut'], message: string): Refus => ({ ok: false, statut, message });

export interface Reglage {
  evenement: unknown;
  delaiMinutes?: unknown;
}

/**
 * Le délai de la relance, sans repasser par Meta : l'écran d'avant l'envoie encore. Il vaut pour la ligne du panier
 * (menu « Scénario », lot 5), qui lit le même délai de la boutique.
 */
export async function reglerMessage(
  deps: { store: Pick<PgShopifyStore, 'lire' | 'reglerDelaiPanier'> }, tenantId: string, r: Reglage,
): Promise<Issue<Record<string, never>>> {
  if (!estEvenementShopify(r.evenement)) return refus(400, `evenement : un de ${EVENEMENTS_DISPONIBLES.join(', ')}.`);
  const boutique = await deps.store.lire(tenantId);
  if (boutique === null) return refus(409, 'Aucune boutique Shopify n’est branchée.');
  if (r.delaiMinutes !== undefined) {
    if (r.evenement !== 'checkout_abandoned') return refus(400, 'delaiMinutes : seulement pour la relance de panier.');
    if (typeof r.delaiMinutes !== 'number' || !Number.isInteger(r.delaiMinutes) || r.delaiMinutes < DELAI_PANIER_MIN || r.delaiMinutes > DELAI_PANIER_MAX) {
      return refus(400, `delaiMinutes : un nombre entier de minutes, de ${DELAI_PANIER_MIN} à ${DELAI_PANIER_MAX}.`);
    }
  }
  if (typeof r.delaiMinutes === 'number') await deps.store.reglerDelaiPanier(tenantId, r.delaiMinutes);
  return { ok: true, valeur: {} };
}
