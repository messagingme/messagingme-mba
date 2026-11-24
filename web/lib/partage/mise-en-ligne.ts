/**
 * LE OUI DE MISE EN LIGNE (lot 1 du CSM virtuel, B2) : ce que la page de la console montre d'une mise en ligne, tel que
 * l'API le rend (`src/mise-en-ligne/mise-en-ligne.ts`, `vueDe`). Un seul contrat pour les deux bouts : le serveur et la
 * page l'importent d'ici, une dérive ne compile pas.
 */

export const TYPES_ACTION = ['publier', 'restaurer', 'repondeur'] as const;
export type TypeAction = (typeof TYPES_ACTION)[number];

/** Le résultat d'une action, une fois exécutée : `programme` = la publication attend la validation d'un template par Meta. */
export type ResultatAction =
  | { ok: true; etat: 'publie' | 'programme' | 'branche' }
  | { ok: false; code: string; message: string };

/**
 * `proposee` : le bouton attend le clic ; `expiree` : 24 heures sont passées ; `en_cours` ; `interrompue` : une panne l'a
 * arrêtée, un nouveau clic la reprend après la dernière action faite ; `faite` ; `echouee` : une action a été refusée,
 * la suite n'est pas partie.
 */
export type EtatVue = 'proposee' | 'expiree' | 'en_cours' | 'interrompue' | 'faite' | 'echouee';

/** Jamais les graphes : ce qui sera publié est résumé par le récapitulatif, écrit par le serveur. */
export interface VueMiseEnLigne {
  id: string;
  libelle: string;
  recapitulatif: string[];
  etat: EtatVue;
  expireLe: string;
  accepteeLe: string | null;
  termineeLe: string | null;
  actions: Array<{ type: TypeAction; scenario: string; nom: string; version?: number; resultat: ResultatAction | null }>;
}
