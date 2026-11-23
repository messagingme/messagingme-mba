import type { ContactFieldFilter } from './contact-filters';

/**
 * Les critères de segment (spec du 2026-10-31) : commandes Shopify, dépense, dernière commande, activité, pays. Module
 * pur partagé par la console, le serveur et l'outil MCP : les bornes vivent ici une fois, la console les met dans ses
 * champs, le serveur les applique, le schéma MCP les annonce.
 *
 * 🔴 ILS VOYAGENT DANS `fieldFilters`, sous des clés réservées et l'opérateur `segment`, JAMAIS dans un membre neuf de
 * `ContactFilters` (la règle des filtres d'analyse, `src/crm/filtre-fiche.ts`) : un serveur plus ancien IGNORERAIT un
 * membre neuf, et un brouillon de campagne repris pendant un retour arrière de l'API partirait à tout l'espace. Un
 * serveur ancien qui reçoit `segment_commandes` le cherche dans le jsonb des champs perso, où il n'est jamais : il ne
 * trouve personne. Les clés sont réservées (`estCleReservee`) : aucun champ perso ne peut les prendre.
 */

export const OP_SEGMENT = 'segment' as const;

export const CLES_SEGMENT = {
  commandes: 'segment_commandes',
  depense: 'segment_depense',
  derniereCommande: 'segment_derniere_commande',
  /** Segments Shopify enrichis, lot 3 : les lignes des commandes payées. */
  achete: 'segment_achete',
  pasAchete: 'segment_pas_achete',
  reassort: 'segment_reassort',
  /**
   * Segments Shopify enrichis, lot 4 : les deux boutons prêts, valeur `true` et rien d'autre. Un message reçu (ou un
   * clic attribué) connu, et aucune commande enregistrée pour la fiche dans l'espace.
   */
  ecritSansCommande: 'segment_ecrit_sans_commande',
  clicSansCommande: 'segment_clic_sans_commande',
  actif: 'segment_actif',
  inactif: 'segment_inactif',
  pays: 'segment_pays',
} as const;
export type CleSegment = (typeof CLES_SEGMENT)[keyof typeof CLES_SEGMENT];

const TOUTES: readonly string[] = Object.values(CLES_SEGMENT);
export function estCleSegment(cle: unknown): cle is CleSegment {
  return typeof cle === 'string' && TOUTES.includes(cle);
}

/** Les critères qui lisent les commandes Shopify : sans boutique, l'outil MCP les refuse et la console ne les montre pas. */
export const CLES_COMMANDES: readonly CleSegment[] = [
  CLES_SEGMENT.commandes, CLES_SEGMENT.depense, CLES_SEGMENT.derniereCommande,
  CLES_SEGMENT.achete, CLES_SEGMENT.pasAchete, CLES_SEGMENT.reassort,
  CLES_SEGMENT.ecritSansCommande, CLES_SEGMENT.clicSansCommande,
];
export const CLES_ACTIVITE: readonly CleSegment[] = [CLES_SEGMENT.actif, CLES_SEGMENT.inactif];

/** Au moins `min`, au plus `max`, l'un ou l'autre ou les deux. */
export interface Plage { min?: number; max?: number }
/** Une plage comptée sur les `jours` derniers jours, ou depuis le début du suivi sans `jours`. */
export interface PlageSurJours extends Plage { jours?: number }

/**
 * Un produit visé (lot 3) : par son identifiant Shopify (toutes ses variantes), ou par un SKU (une variante). Les cartes
 * cadeaux n'entrent jamais dans ces critères (décision de Julien du 2026-11-23).
 */
export type ProduitVise = { produit: string } | { sku: string };
/** « A acheté » (TOUS ces produits) ou « n'a pas acheté » (AUCUN), sur les `jours` derniers jours ou depuis le début du suivi. */
export interface AchatsVises { produits: ProduitVise[]; jours?: number }
/** Le réassort : le dernier achat de CE produit, il y a au moins `min` et au plus `max` jours ; exige un achat connu. */
export type Reassort = ProduitVise & Plage;

/** Bornes d'une donnée cliente, refusées au-delà (jamais tronquées : un critère tronqué vise une autre population). */
export const BORNES_SEGMENTS = {
  joursMax: 3650, commandesMax: 1000, depenseMax: 10_000_000, paysMax: 20, produitsMax: 20, skuMax: 255,
} as const;

/** Ce que l'API sait cibler pour un espace (`GET /tenants/:id/contacts/segments`). */
export interface SuiviSegmentsVue {
  boutique: { devise: string | null; commandesDepuis: string; coupeeLe: string | null } | null;
  /** Depuis quand l'activité (message reçu, clic attribué) est complète ; avant, seul ce qui restait conservé. */
  activiteCompleteDepuis: string;
  /**
   * L'API sait cibler par produit (lot 3). 🔴 Absent d'une API plus ancienne : la console ne propose alors aucun critère
   * produit, qu'une telle API chercherait dans les champs perso, où il n'est jamais (personne ne serait trouvé).
   */
  produits?: boolean;
  /**
   * Le compte de chaque bouton prêt (lot 4), le bouton SEUL, jamais croisé avec les autres filtres (décision de Julien du
   * 2026-11-23). Présent seulement avec une boutique et quand les deux comptes ont pu se lire : absent, la console ne
   * montre aucun bouton (sauf un bouton déjà posé, pour qu'on puisse le retirer).
   */
  boutons?: BoutonsSansCommandeVue;
}

/** Le compte des deux boutons prêts : les fiches qui ont écrit (ou cliqué) sans aucune commande enregistrée. */
export interface BoutonsSansCommandeVue { ecritSansCommande: number; clicSansCommande: number }

/** Un produit déjà vu dans les commandes de l'espace, pour choisir un critère (`GET .../contacts/segments/produits`). */
export interface ProduitVuVue {
  /** Nul pour une ligne sans produit (sur mesure, produit supprimé) : elle ne se vise que par son SKU. */
  produitId: string | null;
  sku: string | null;
  titre: string;
  varianteTitre: string | null;
  /** Le nombre de commandes qui le portent : la recherche range les plus achetés d'abord. */
  commandes: number;
}

/** Une plage posée : au moins une borne. */
export function plagePosee(p: Plage | undefined): boolean {
  return p !== undefined && (p.min !== undefined || p.max !== undefined);
}

/**
 * Un critère de segment dans la forme du fil : sa valeur en JSON (une plage, des jours, des pays, des produits, ou `true`
 * pour un bouton prêt).
 */
export function filtreSegment(cle: CleSegment, valeur: PlageSurJours | number | string[] | AchatsVises | Reassort | true): ContactFieldFilter {
  return { key: cle, op: OP_SEGMENT, value: JSON.stringify(valeur) };
}

/** La valeur JSON d'un critère de segment des filtres, ou `undefined` (absent ou illisible). */
export function valeurSegment(filtres: readonly ContactFieldFilter[] | undefined, cle: CleSegment): unknown {
  const f = (filtres ?? []).find((x) => x.key === cle && x.op === OP_SEGMENT);
  if (!f) return undefined;
  try { return JSON.parse(f.value) as unknown; } catch { return undefined; }
}
