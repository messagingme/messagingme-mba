/**
 * Ce que l'onglet « Shopify » de la fiche contact reçoit (`GET /tenants/:id/contacts/:contactId/shopify`, plan
 * 2026-11-16). Module pur partagé : le serveur le rend, la console le lit.
 *
 * Les montants sont des décimaux en TEXTE, sommés par Postgres (jamais par un flottant), dans la devise de la commande.
 * `boutique` nulle : l'espace n'a pas de boutique, rien d'autre n'est lu.
 */
export type SourceVenteVue = 'campagne' | 'relance_panier' | 'commande_payee' | 'commande_expediee' | 'scenario' | 'agent' | 'agent_meta';

/** Une ligne de commande (segments Shopify enrichis, lot 3) : sans prix, la dépense reste celle de la commande. */
export interface LigneCommandeVue {
  titre: string;
  varianteTitre: string | null;
  sku: string | null;
  /** La quantité au paiement (les remboursements ne sont pas déduits). */
  quantite: number;
  carteCadeau: boolean;
}

export interface CommandeShopifyVue {
  commandeId: string;
  payeeLe: string;
  /** Nul pour une commande connue par sa seule expédition. */
  montant: string | null;
  devise: string | null;
  test: boolean;
  /** Ce que WhatsApp a rapporté de cette commande, ou `null` si elle ne lui est pas attribuée. */
  attribution: { source: SourceVenteVue; campagne: string | null; preuve: 'panier' | 'utm' | null } | null;
  /**
   * Ses lignes, dans l'ordre de Shopify (lot 3). ABSENT : une API plus ancienne, ou des lignes qui ne se lisent pas en
   * base ; l'écran n'en dit alors rien, jamais « aucun produit ». Vide : une commande reçue avant ce lot.
   */
  lignes?: LigneCommandeVue[];
  /** Le corps portait plus de lignes que le plafond (250) : la liste est incomplète. */
  lignesTronquees?: boolean;
}

export interface PanierShopifyVue {
  ouvertLe: string;
  relanceLe: string | null;
  fermeLe: string | null;
  /** L'issue de la relance (`envoye`, ou la raison d'un abandon), `null` tant qu'aucune n'est partie. */
  issue: string | null;
}

export interface AchatsShopifyVue {
  boutique: { nom: string | null; domaine: string; devise: string | null; commandesDepuis: string; coupeeLe: string | null } | null;
  /**
   * Toutes ses commandes, test compris, la dépense dans la devise de la boutique : la règle des filtres « Achats et
   * activité » qui ciblent ce client, pour que la fiche et le filtre disent le même nombre.
   */
  resume: { commandes: number; commandesTest: number; depense: string; derniereLe: string | null };
  /** Ce que WhatsApp a rapporté, commandes de test exclues (la règle du chiffre attribué), par devise. */
  rapporte: Array<{ devise: string; montant: string; prouve: string; commandes: number }>;
  /** Les plus récentes d'abord, 100 au plus ; `resume` compte toutes les autres. */
  commandes: CommandeShopifyVue[];
  /** Les paniers de son numéro, les plus récents d'abord ; purgés à 7 jours. */
  paniers: PanierShopifyVue[];
}

/** Les bornes de la lecture, partagées pour que l'écran dise « les 100 plus récentes ». */
export const BORNES_ACHATS = { commandes: 100, paniers: 20, joursPaniers: 7 } as const;
