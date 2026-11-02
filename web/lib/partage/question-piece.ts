/**
 * La pièce attendue par un bloc Question (spec `docs/superpowers/specs/2026-11-02-question-fichier-champ-design.md`) :
 * ce que la console coche et ce que le moteur lit, écrit une fois pour les deux.
 */

/** Les genres de fichier qu'un bloc Question peut attendre, dans l'ordre où la console les propose. */
export const GENRES_PIECE = ['photo', 'pdf', 'document', 'video', 'vocal'] as const;
export type GenrePiece = (typeof GENRES_PIECE)[number];

/** Cochés à l'activation de l'attente : une pièce d'identité arrive en photo ou en PDF. */
export const GENRES_PAR_DEFAUT: readonly GenrePiece[] = ['photo', 'pdf'];

/** La poignée de la sortie « Fichier reçu ». Une arête qui la porte est la suite d'une pièce acceptée. */
export const SORTIE_FICHIER = 'fichier';
