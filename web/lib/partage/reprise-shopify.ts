/**
 * LE RATTRAPAGE DES COMMANDES SHOPIFY (segments Shopify enrichis, lot 5), vu par la console et l'outil MCP : l'aperçu
 * avant le lancement, puis l'état de la dernière reprise. Module pur partagé : le serveur le rend, la console le lit.
 * Aucun numéro ni aucune commande : des comptes seulement.
 */

export type StatutReprise = 'en_attente' | 'en_cours' | 'termine' | 'refuse' | 'erreur';

/** Les comptes d'un rattrapage : commandes payées lues, rattachées à une fiche, déjà connues, sans fiche, sans numéro. */
export interface ComptesRepriseVue { lues: number; rattachees: number; deja: number; sansFiche: number; sansNumero: number }

/** L'aperçu, avant tout lancement : ce que le rattrapage ferait, sans rien écrire. */
export interface ApercuRepriseVue {
  /** Le début de la fenêtre lue : les commandes CRÉÉES depuis (Shopify limite à 60 jours). */
  fenetreDebut: string;
  /** Les commandes payées lues (payées, remboursées en tout ou partie). */
  lues: number;
  /** Déjà connues (reçues au fil de l'eau) : elles gardent leur fiche et reçoivent leurs lignes de produits. */
  deja: number;
  /** Inconnues, au numéro d'une fiche de l'espace : elles s'y rattacheraient. */
  rattachables: number;
  /** Inconnues, au numéro utilisable d'aucune fiche : comptées, jamais gardées. */
  sansFiche: number;
  /** Inconnues, sans numéro utilisable (absent, invalide ou fixe). */
  sansNumero: number;
  /** Écartées : créées dans la fenêtre mais jamais payées (en attente, annulées). */
  ecartees: number;
  /** `false` : le temps de l'aperçu n'a pas suffi à tout lire ; les comptes sont partiels, jamais un total. */
  complet: boolean;
}

/** L'état de la dernière reprise de l'espace. */
export interface RepriseShopifyVue {
  id: string;
  statut: StatutReprise;
  /** Une reprise vivante dont rien n'a bougé depuis 15 minutes : son worker est mort, un relancement la close. */
  interrompue: boolean;
  fenetreDebut: string;
  commenceLe: string;
  finiLe: string | null;
  comptes: ComptesRepriseVue;
  erreur: string | null;
}
