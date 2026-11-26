/**
 * LE RATTRAPAGE DES COMMANDES SHOPIFY (segments Shopify enrichis, lots 5 et 5b), vu par la console et l'outil MCP : l'aperçu
 * avant le lancement, puis l'état de la dernière reprise. Module pur partagé : le serveur le rend, la console le lit.
 * Aucun numéro ni aucune commande : des comptes seulement.
 *
 * 🔴 Les comptes des fiches créées (`fichesCreees`, `fichesACreer`, `horsPlafond`, `placesLibres`) n'existent que depuis le
 * lot 5b : une API plus ancienne ne les rend pas, et ne crée aucune fiche. La console ne les montre, et ne promet une
 * création, que s'ils sont là.
 */

export type StatutReprise = 'en_attente' | 'en_cours' | 'termine' | 'refuse' | 'erreur';

/**
 * Les comptes d'un rattrapage : commandes payées lues, rattachées à une fiche (déjà là ou créée par lui), déjà connues,
 * sans fiche gardée (le contact a été supprimé de l'espace, un numéro en STOP ou refusé par WhatsApp, ou seule la
 * livraison porte un numéro), sans numéro utilisable ; les fiches créées (une par acheteur), et les commandes non gardées
 * faute de place dans la limite de contacts de l'offre.
 */
export interface ComptesRepriseVue {
  lues: number; rattachees: number; deja: number; sansFiche: number; sansNumero: number;
  /** Absent d'une API d'avant le lot 5b. */
  fichesCreees?: number;
  /** Absent d'une API d'avant le lot 5b. */
  horsPlafond?: number;
}

/**
 * La fenêtre du rattrapage (lot 7a) : 24 mois (`longue`) hors Free quand l'app de la boutique a `read_all_orders`,
 * sinon 60 jours, et pourquoi pas plus : `free` (l'offre Pro l'ouvre), `sans_droit` (l'app n'a pas `read_all_orders`).
 */
export interface FenetreRattrapageVue { longue: boolean; limite: 'free' | 'sans_droit' | null }

/** L'aperçu, avant tout lancement : ce que le rattrapage ferait, sans rien écrire. */
export interface ApercuRepriseVue {
  /** Le début de la fenêtre lue : les commandes CRÉÉES depuis (60 jours, ou 24 mois, cf. `fenetre`). */
  fenetreDebut: string;
  /** La fenêtre et sa raison. Absente d'une API d'avant le lot 7a (60 jours, sans raison dite). */
  fenetre?: FenetreRattrapageVue;
  /** Les commandes payées lues (payées, remboursées en tout ou partie). */
  lues: number;
  /** Déjà connues (reçues au fil de l'eau) : elles gardent leur fiche et reçoivent leurs lignes de produits. */
  deja: number;
  /** Inconnues, qu'il rattacherait : à la fiche de leur numéro, ou à celle qu'il créerait pour leur acheteur. */
  rattachables: number;
  /** Les fiches d'acheteurs qu'il créerait, une par numéro, dans les places de l'offre. Absent d'une API d'avant le lot 5b. */
  fichesACreer?: number;
  /** Les commandes qu'il ne garderait pas, la limite de contacts de l'offre étant atteinte. Absent avant le lot 5b. */
  horsPlafond?: number;
  /** Les places que l'offre laisse ; `null` : sans limite. Absent d'une API d'avant le lot 5b. */
  placesLibres?: number | null;
  /**
   * Ces fiches prendraient les DERNIÈRES places d'une offre qui compte tous les contacts : ensuite, un client inconnu qui
   * écrirait le premier n'entrerait plus. Absent d'une API d'avant le lot 5b.
   */
  remplitLesPlaces?: boolean;
  /**
   * Inconnues, au numéro utilisable dont la fiche ne serait pas créée : le contact a été supprimé de l'espace, un numéro en
   * STOP ou refusé par WhatsApp, ou seule la livraison porte un numéro (un cadeau : son destinataire n'entre pas).
   */
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
