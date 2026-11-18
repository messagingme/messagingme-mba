import { z } from 'zod';
import { schemaVariables } from '../api/variables';

/**
 * L'ÉVÉNEMENT D'UN PARCOURS (menu « Scénario », lot 4, spec décisions 21, 28 et 29 ; migrations 0297 et 0298).
 *
 * Un parcours né d'un événement (Shopify d'abord) porte d'où il vient (`origine` : la boutique, l'événement, sa référence)
 * et les données de l'événement (`variables`, dont des liens à clé d'accès : jamais sur la fiche, jamais au journal ni
 * dans un log). `null` = un parcours ordinaire. Une seule place d'événement active par contact, tenue par l'index unique
 * de 0298. Les variables s'effacent à la fin du parcours, l'origine reste.
 */
export interface EvenementDuParcours {
  origine: string;
  variables: Record<string, string>;
}

/** Longueur maximale d'une origine (la boutique, l'événement et sa référence). */
export const ORIGINE_MAX = 200;

/**
 * Plafond d'attente d'un parcours d'événement (décision 29) : une attente sans échéance propre (template à boutons sans
 * délai, message à boutons, formulaire, question sans délai) se clôt d'elle-même après lui, sans rien envoyer. Sans lui,
 * le parcours garderait à vie la place unique du contact.
 */
export const PLAFOND_ATTENTE_EVENEMENT_MS = 72 * 3600 * 1000;

const schemaEvenement = z.object({
  origine: z.string().min(1).max(ORIGINE_MAX),
  // Absentes d'un parcours terminé : elles ont été effacées à sa fin (décision 28).
  variables: schemaVariables.optional(),
});

/**
 * Relit le jsonb `workflow_runs.evenement`, une entrée non fiable : `safeParse`, jamais `as`. Une valeur illisible fait
 * lire le parcours comme ordinaire, et se journalise SANS la valeur (elle peut porter des liens à clé d'accès).
 */
export function lireEvenement(brut: unknown, runId: string): EvenementDuParcours | null {
  if (brut === null || brut === undefined) return null;
  const lu = schemaEvenement.safeParse(brut);
  if (!lu.success) {
    // eslint-disable-next-line no-console
    console.error(`workflow_runs ${runId}: evenement illisible, le parcours est lu comme ordinaire`);
    return null;
  }
  return { origine: lu.data.origine, variables: lu.data.variables ?? {} };
}
