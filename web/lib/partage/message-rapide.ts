/**
 * Les bornes du bloc « message rapide », celles de WhatsApp. Une seule source pour l'éditeur de la console, le moteur
 * qui envoie (`src/workflow/envois-bloc.ts`) et le compilateur des scénarios de l'API : une borne recopiée dérive, et
 * ce que l'un accepte, l'autre le refuserait à l'envoi.
 */

/** Réponses rapides d'un message interactif : trois au plus chez Meta. */
export const MAX_REPONSES_RAPIDES = 3;

/** Le titre d'une réponse rapide : 20 caractères au plus chez Meta. */
export const MAX_TEXTE_REPONSE_RAPIDE = 20;

/**
 * Avec des réponses rapides ou un bouton de lien, le message part en interactif, dont Meta borne le corps à 1 024
 * caractères ; avec un fichier sans bouton, le texte devient sa légende, bornée de même. Au-delà, Meta rejette le
 * message entier.
 */
export const TEXTE_MAX_AVEC_FICHIER_OU_BOUTON = 1024;

/** Sans fichier ni bouton, un texte simple : 4 096 caractères au plus chez Meta. */
export const TEXTE_MAX_SIMPLE = 4096;
