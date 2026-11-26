import { z } from 'zod';
import { schemaVariables } from '../api/variables';
import type { WorkflowGraph } from './graph';

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
  /**
   * Lot 5 : l'identifiant Meta du premier message (le template que le moteur de campagne a fait accepter), et le bloc
   * qui l'a envoyé. Un clic n'atteint le parcours sur ce bloc que s'il cite CE message : le premier message d'un
   * événement frère (même bloc, parcours non né, place prise) n'est pas le sien. L'échec de sa livraison clôt le parcours.
   * Absents d'un parcours né avant le lot 5, ou d'un saut.
   */
  messageId?: string;
  noeudDepart?: string;
  /**
   * Lot 5 : le parcours a été clos parce que son premier message n'a pas été livré. Une nouvelle tentative d'envoi peut
   * alors faire naître un parcours de la même origine ; un parcours terminé normalement, jamais.
   */
  premierNonLivre?: boolean;
}

/** Longueur maximale d'un identifiant de message de Meta ou d'un bloc gardé avec l'événement. */
const REPERE_MAX = 200;

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
  messageId: z.string().min(1).max(REPERE_MAX).optional(),
  noeudDepart: z.string().min(1).max(REPERE_MAX).optional(),
  premierNonLivre: z.boolean().optional(),
});

/**
 * L'événement passe-t-il le schéma qui le relira (lot 5, jaune de 4a) ? Une origine trop longue ou une variable hors du
 * schéma se relirait « ordinaire » (`lireEvenement`) tout en tenant la place unique en base : un tel événement n'est
 * jamais écrit.
 */
export function evenementValide(evenement: EvenementDuParcours): boolean {
  return schemaEvenement.safeParse(evenement).success;
}

/** L'événement sans ses variables : ce qu'écrit un parcours qui se termine, ou qui naît déjà terminé (décision 28). */
export function sansVariables(evenement: EvenementDuParcours): Omit<EvenementDuParcours, 'variables'> {
  const { variables: _effacees, ...reste } = evenement;
  return reste;
}

/**
 * Les variables d'un parcours d'événement telles que le TEXTE d'un message les lit (lot 4, décision 28) : sous le préfixe de
 * leur origine, `{{shopify.checkout_url}}`, pour ne jamais se confondre avec un champ de la fiche du même nom (la console
 * nomme les champs sans point). Rien pour un parcours ordinaire.
 */
export function variablesDuTexte(evenement: EvenementDuParcours | null): Record<string, string> {
  if (evenement === null) return {};
  const prefixe = evenement.origine.split(':')[0] ?? '';
  if (prefixe === '') return {};
  return Object.fromEntries(Object.entries(evenement.variables).map(([k, v]) => [`${prefixe}.${k}`, v]));
}

/** Une donnée d'événement lue par le TEXTE d'un bloc (`variablesDuTexte`) : `{{shopify.numero_commande}}`. */
const CLE_DU_TEXTE = /\{\{\s*((?:shopify|hubspot)\.[A-Za-z0-9_]+)\s*\}\}/g;

/**
 * Les données d'un événement que ce graphe lit, hors des variables du template d'ouverture (`ouverture`, l'identifiant de
 * son bloc) : une campagne les remplace par les siennes (`firstTemplateParams`). Sert à refuser une campagne sur un
 * scénario Shopify ou HubSpot (Julien, 2026-11-26) qui les lit plus loin : une campagne n'a pas d'événement derrière
 * elle, un template y échouerait pour chaque contact et un texte partirait avec un trou (`renderText` rend '').
 */
export function donneesDEvenementLues(graph: WorkflowGraph, ouverture: string | null): string[] {
  const lues = new Set<string>();
  for (const n of graph.nodes) {
    for (const m of JSON.stringify(n.data ?? {}).matchAll(CLE_DU_TEXTE)) lues.add(m[1]!);
    if (n.type !== 'template' || n.id === ouverture || !Array.isArray(n.data.variables)) continue;
    for (const v of n.data.variables as unknown[]) {
      const s = (v as { source?: { type?: unknown; key?: unknown } } | null)?.source;
      if (s?.type === 'variable' && typeof s.key === 'string') lues.add(s.key);
    }
  }
  return [...lues];
}

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
  // 🔴 L'événement ENTIER (relecture de 5a) : sans `messageId` ni `noeudDepart`, l'exécuteur ne reconnaissait plus le clic
  // sur le premier message d'un événement frère, et sans `premierNonLivre` une relecture effaçait la marque.
  const { origine, variables, messageId, noeudDepart, premierNonLivre } = lu.data;
  return {
    origine, variables: variables ?? {},
    ...(messageId !== undefined ? { messageId } : {}),
    ...(noeudDepart !== undefined ? { noeudDepart } : {}),
    ...(premierNonLivre !== undefined ? { premierNonLivre } : {}),
  };
}
