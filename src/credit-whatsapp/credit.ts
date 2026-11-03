import type { CategorieMeta } from './grille';

/**
 * LE CRÉDIT WHATSAPP (spec `docs/superpowers/specs/2026-10-30-credit-whatsapp-design.md`, migration 0264) : le solde
 * prépayé d'un espace dont un numéro est sur la ligne de crédit du partenaire, distinct du crédit IA.
 *
 * 🔴 TOUT S'ARRÊTE À ZÉRO : un envoi part si le solde, une fois sa provision prise, reste positif ou nul. La provision
 * se prend AVANT l'appel à Meta et atomiquement (deux envois simultanés ne passent pas sur le même centime) ; elle est
 * rendue sur un refus net de Meta ou un accusé « non facturable », corrigée sur une catégorie reclassée, gardée sur un
 * doute (la régularisation tranche sur les volumes de Meta). Une Entreprise (illimitée, décision du 2026-11-02, migration
 * 0266) provisionne sans condition et sans toucher au solde : sa provision est marquée `illimite`, rien n'est refusé, tout
 * est compté, Julien facture après coup.
 *
 * Invariant tenu par la base et vérifié en intégration : solde = somme des mouvements − somme des provisions PRÉPAYÉES
 * non rendues (une provision illimitée n'y entre pas).
 */

/**
 * Ce qui fait bouger un solde, hors des envois (qui sont des provisions). La liste vit ici et pas en base, comme celle
 * du crédit IA (`src/agent/credits.ts`).
 *   - `achat` : un paiement Stripe, crédité par le webhook, une fois par session Checkout ;
 *   - `recharge_auto` : une facture de recharge automatique payée, une fois par facture ;
 *   - `regularisation` : l'écart du jour entre le coût recalculé sur les volumes de Meta et ce qui a été provisionné,
 *     une ligne par jour, remplacée à chaque passe.
 */
export type RaisonMouvementWa = 'achat' | 'recharge_auto' | 'regularisation';

export interface ProvisionDemandee {
  tenantId: string;
  /** Le numéro qui envoie (identifiant Meta, `phone_numbers.id`). */
  phoneNumberId: string;
  /** Pays ISO du destinataire, `null` sans numéro. */
  pays: string | null;
  categorie: CategorieMeta;
  /** Le prix du message, commission comprise (`prixMessage`). Zéro pour un service dans la franchise du numéro. */
  montantMicroEur: number;
  /** Illimité (toute Entreprise) : la provision s'écrit, marquée, sans regarder ni toucher le solde. */
  openBar: boolean;
  /**
   * La commission qui a chiffré ce message : la régularisation du jour chiffre les volumes de Meta avec elle, pas avec
   * celle du moment de la passe (relecture du lot E).
   */
  commissionPct: number;
}

/**
 * `soldeApresMicroEur` : le solde juste après CE débit, lu dans la même instruction (l'alerte du solde bas s'y compare).
 * Pour une provision illimitée, le solde intact : rien n'a été débité, et la garde n'alerte pas.
 */
export type IssueProvision = { ok: true; provisionId: string; soldeApresMicroEur: number } | { ok: false; soldeMicroEur: number };

/**
 * Une ligne de l'historique montré au client. Les envois s'agrègent par jour de Paris (`raison: 'envois'`, `messages`
 * comptés) ; les achats et les régularisations sont des lignes à part. 🔴 Sans note : la note d'un mouvement est interne.
 */
export interface LigneHistoriqueWa {
  /** L'identifiant du mouvement, ou `envois:AAAA-MM-JJ` pour l'agrégat d'un jour. */
  id: string;
  raison: 'envois' | RaisonMouvementWa | string;
  deltaMicroEur: number;
  /** 'AAAA-MM-JJ', le jour de Paris (des envois comme d'une régularisation), `null` pour un achat. */
  jour: string | null;
  at: string;
  /** Les messages du jour (envois seulement). */
  messages: number | null;
  /** Le paiement Stripe d'un achat ou d'une recharge, `null` ailleurs. */
  reference: string | null;
  /** Ce paiement a une facture chez Stripe : c'est ce qui offre le lien « Facture » (comme au Crédit IA). */
  facture: boolean;
}

/** Une provision telle que `/ops` la montre (l'essai réel : chaque envoi au prix de la grille, rendu ou corrigé). */
export interface ProvisionVue {
  id: string;
  creeLe: string;
  phoneNumberId: string;
  wamid: string | null;
  pays: string | null;
  categorie: CategorieMeta;
  montantMicroEur: number;
  etat: 'provisionne' | 'rendu' | 'ajuste';
  livreLe: string | null;
  /** Une provision illimitée (Entreprise, 0266) : le solde ne l'a pas payée, elle va au montant à facturer. */
  illimite: boolean;
}

/** Le premier jour d'un mois 'AAAA-MM', pour compter la franchise de service d'un numéro (mois civil UTC). */
export function debutDuMois(mois: string): string {
  if (!/^\d{4}-\d{2}$/.test(mois)) throw new Error(`mois invalide : ${mois}`);
  return `${mois}-01`;
}
