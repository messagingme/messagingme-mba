/**
 * L'INSCRIPTION PAR E-MAIL PROUVÉE PAR UN LIEN (lot identité B, 2026-11-05), lue au même endroit par le serveur
 * (`src/auth/routes.ts`, qui envoie le lien et le consomme) et par la console (l'écran « lien envoyé » et la page du
 * lien, qui citent sa durée et lisent ses refus). Aucun import : le fichier passe tel quel des deux côtés.
 *
 * Une adresse inconnue ne crée plus rien à la demande : un lien part, et l'identité, l'espace et la session naissent
 * au clic, l'adresse prouvée. Le nom de l'espace, le mot de passe et l'accord Meta se donnent sur la page du lien, par
 * la personne qui a reçu l'e-mail, jamais par celle qui a rempli le formulaire.
 */

/** Combien de temps le lien reste valable (décision de Julien du 2026-11-05) : une boîte relevée le soir. */
export const DUREE_LIEN_INSCRIPTION_MS = 24 * 60 * 60 * 1000;

/** La même durée en heures, pour les textes (e-mail et écrans). */
export const HEURES_LIEN_INSCRIPTION = DUREE_LIEN_INSCRIPTION_MS / (60 * 60 * 1000);

/**
 * Les refus de la confirmation, que la page du lien distingue. Jamais un 401 : la console viderait une autre session
 * ouverte dans le même navigateur.
 * - `lien_invalide` (400) : échu, déjà servi, remplacé par la confirmation d'un autre lien de la même adresse, ou inconnu ;
 * - `adresse_connue` (409) : l'adresse a reçu une identité entre la demande et le clic (Google, invitation, autre lien).
 */
export const REFUS_INSCRIPTION = {
  lienInvalide: 'lien_invalide',
  adresseConnue: 'adresse_connue',
} as const;

export type RefusInscription = (typeof REFUS_INSCRIPTION)[keyof typeof REFUS_INSCRIPTION];
