import { ApiError, request } from './http';
import { pointsDeCourbe, type IssuePaiement, type PointCredit } from './api-credit';

/**
 * LE CRÉDIT WHATSAPP, côté navigateur (plan du Crédit WhatsApp, tâche 11) : ce que lit l'onglet de la page Offre, et
 * l'ouverture d'un achat. La facture d'un achat passe par la route du Crédit IA (`ouvrirFacture`, `api-credit.ts`) : les
 * deux achats vivent dans la même table de paiements.
 *
 * 🔴 AUCUNE ÉCRITURE DE SOLDE ICI : seul le webhook signé de Stripe crédite. Le retour de la page de paiement relit.
 */

/** Les quatre achats, du plus petit au plus grand (`OFFRES_WHATSAPP`, `src/stripe/offres-whatsapp.ts`). */
export type OffreWhatsapp = 'wa_50' | 'wa_100' | 'wa_250' | 'wa_500';

/**
 * Une ligne de l'historique, telle que le serveur la rend : `envois` agrège les messages d'un jour, `achat` est un
 * paiement (sa session Stripe dans `reference`), `regularisation` une correction ; une raison inconnue (une version plus
 * récente du serveur) s'affiche telle quelle.
 */
export interface LigneCreditWhatsapp {
  id: string;
  raison: string;
  deltaMicroEur: number;
  /** AAAA-MM-JJ : le jour des envois agrégés, ou d'une régularisation. */
  jour: string | null;
  at: string;
  /** Les messages du jour (envois seulement). */
  messages: number | null;
  reference: string | null;
  /** Ce paiement a une facture chez Stripe : c'est ce qui offre le lien. */
  facture: boolean;
}

/**
 * L'option du Crédit WhatsApp (lot 4a, 30 € HT par numéro et par mois) telle que l'onglet la lit. Une place est un numéro :
 * `places` est ce que Stripe a relu payé, `couverts` les numéros déjà branchés sur le Crédit WhatsApp par l'option (un
 * retrait ne passe pas sous leur nombre).
 */
export interface OptionCreditWhatsapp {
  /** En vente pour cet espace (un Pro ou un Business, le prix posé chez Stripe) : sinon l'onglet n'en parle pas. */
  disponible: boolean;
  prixHtCentimes: number;
  placesMax: number;
  places: number;
  couverts: number;
  /** `null` sans option ; `en_retard` : un renouvellement impayé que Stripe relance encore. */
  statut: 'actif' | 'en_retard' | 'resilie' | null;
  /** La fin programmée (une résiliation demandée au portail de Stripe), ISO ; `null` sinon. */
  finPrevueLe: string | null;
  /**
   * La formule de l'espace est payée, par la règle du serveur qui garde la prise de l'option (révision du 2026-11-04) :
   * faux pendant un essai, Pro comme Business, et l'onglet explique alors l'essai au lieu de vendre. Une API d'avant ce
   * champ le rend absent : lu vrai, l'ancien écran (sa prise refuserait de toute façon pendant un essai).
   */
  formulePayee: boolean;
  /**
   * Tous les numéros de l'espace gardent l'application WhatsApp Business (lot B, décision 8) : aucun ne passera sur le
   * Crédit WhatsApp, et le paiement de l'option le dit. Faux sur une API d'avant ce champ.
   */
  avecApplication: boolean;
}

/** Une API d'avant l'option (la console part avant l'API) : rien en vente, rien de pris. */
export const SANS_OPTION: OptionCreditWhatsapp = {
  disponible: false, prixHtCentimes: 0, placesMax: 0, places: 0, couverts: 0, statut: null, finPrevueLe: null, formulePayee: true,
  avecApplication: false,
};

/** Ce que lit l'onglet. Montants en micro-euros ; un prix se montre tout compris, jamais un taux. */
export interface VueCreditWhatsapp {
  /**
   * Une Entreprise : le Crédit WhatsApp est illimité, facturé selon son contrat (décision du 2026-11-02). L'onglet montre
   * « Illimité » et la consommation du mois à la place du solde, sans rien à acheter. Absent sur une API plus ancienne
   * (la console part avant l'API) : lu comme faux.
   */
  illimite: boolean;
  soldeMicroEur: number;
  /** Ce qu'ont coûté les messages du mois en cours ; 0 sur une API plus ancienne. */
  consommationDuMoisMicroEur: number;
  /** Le prix d'un message vers la France, par catégorie ; `null` tant qu'aucune grille de prix n'est en vigueur. */
  prixFrance: Array<{ categorie: string; prixMicroEur: number }> | null;
  franchiseServiceParNumero: number;
  achat: {
    /** Les prix de Stripe sont posés : sinon, l'écran dit « pas encore disponible ». */
    disponible: boolean;
    /** `ok`, `free`, `open_bar` ou `sans_ligne` : le même verdict que le refus de la route d'achat. */
    permis: string;
    offres: Array<{ offre: OffreWhatsapp; htCentimes: number }>;
  };
  /** Toutes les lignes de l'espace sont arrêtées : plus rien ne part, recharger n'y changerait rien. */
  ligneArretee: boolean;
  historique: LigneCreditWhatsapp[];
  /** La courbe de 90 jours (lot C) ; vide sur une API plus ancienne. */
  serie: PointCredit[];
  /** L'option ; `SANS_OPTION` sur une API plus ancienne. */
  option: OptionCreditWhatsapp;
}

/** Un compte qu'on affiche : un entier positif, zéro sinon (un corps inattendu n'invente pas de places). */
const compte = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);

function lireOption(v: unknown): OptionCreditWhatsapp {
  if (typeof v !== 'object' || v === null) return SANS_OPTION;
  const o = v as Record<string, unknown>;
  return {
    disponible: o.disponible === true,
    prixHtCentimes: compte(o.prixHtCentimes),
    placesMax: compte(o.placesMax),
    places: compte(o.places),
    couverts: compte(o.couverts),
    statut: o.statut === 'actif' || o.statut === 'en_retard' || o.statut === 'resilie' ? o.statut : null,
    finPrevueLe: typeof o.finPrevueLe === 'string' ? o.finPrevueLe : null,
    formulePayee: o.formulePayee !== false,
    avecApplication: o.avecApplication === true,
  };
}

/**
 * La vue de l'onglet. Un historique ou des offres absents deviennent des listes vides : un corps inattendu (un proxy,
 * une API d'une autre version) ne doit pas faire tomber l'écran entier. Un solde absent, lui, est une erreur : un zéro
 * inventé dirait « épuisé » à un espace qui a du crédit.
 */
export async function getCreditWhatsapp(tenantId: string): Promise<VueCreditWhatsapp> {
  const r = await request<Partial<VueCreditWhatsapp> | null>(`/tenants/${tenantId}/credit-whatsapp`);
  if (r === null || typeof r !== 'object' || typeof r.soldeMicroEur !== 'number') throw new Error('réponse inattendue');
  const achat = r.achat;
  return {
    illimite: r.illimite === true,
    soldeMicroEur: r.soldeMicroEur,
    consommationDuMoisMicroEur: typeof r.consommationDuMoisMicroEur === 'number' ? r.consommationDuMoisMicroEur : 0,
    prixFrance: Array.isArray(r.prixFrance) ? r.prixFrance : null,
    franchiseServiceParNumero: typeof r.franchiseServiceParNumero === 'number' ? r.franchiseServiceParNumero : 0,
    achat: {
      disponible: achat?.disponible === true,
      permis: typeof achat?.permis === 'string' ? achat.permis : 'ok',
      offres: Array.isArray(achat?.offres) ? achat.offres : [],
    },
    ligneArretee: r.ligneArretee === true,
    historique: Array.isArray(r.historique) ? r.historique : [],
    serie: pointsDeCourbe(r.serie),
    option: lireOption(r.option),
  };
}

/**
 * Prend l'option pour `places` numéros et rend l'adresse de la page de paiement de Stripe. 404 (route pas encore
 * déployée) et 503 (prix pas posé) veulent dire « pas encore disponible » ; tout autre refus remonte avec le message du
 * serveur (formule, option déjà prise). `connecter` (lot B) : depuis les cartes « Qui paie vos messages à Meta ? »,
 * Stripe ramène sur Connecter WhatsApp ; sans elle, sur l'onglet (le corps d'avant, qu'une API stricte accepte).
 */
export async function ouvrirOptionWhatsapp(tenantId: string, places: number, origine?: 'connecter'): Promise<IssuePaiement> {
  try {
    const r = await request<{ url: string }>(`/tenants/${tenantId}/credit-whatsapp/option`, {
      method: 'POST',
      body: JSON.stringify(origine ? { places, origine } : { places }),
    });
    return { url: r.url };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 503)) return { indisponible: true };
    throw err;
  }
}

/**
 * L'état du Crédit WhatsApp de l'espace pour les cartes « Qui paie vos messages à Meta ? » (`etatLigneCredit` du serveur,
 * lot B) : `free`, `essai` (la formule n'est pas encore payée), `a_prendre`, `en_attente` (option payée, ligne pas
 * encore posée), `active` ou `arretee`.
 */
export type EtatLigne = 'free' | 'essai' | 'a_prendre' | 'en_attente' | 'active' | 'arretee';
const ETATS_LIGNE: readonly EtatLigne[] = ['free', 'essai', 'a_prendre', 'en_attente', 'active', 'arretee'];

export interface VueEtatLigne {
  etat: EtatLigne;
  /** L'option se prend en ligne : sinon la carte est grisée, « sur demande ». */
  enVente: boolean;
  /** Tous les numéros de l'espace gardent l'application : le paiement de l'option le dit (décision 8). */
  avecApplication: boolean;
}

/**
 * Lit cet état (`GET /tenants/:tenantId/credit-whatsapp/etat`). `null` quand il ne se lit pas : la route pas encore
 * déployée (404, la console part avant l'API), fermée à l'offre (402, une Free), ou un état inconnu ; la carte reste alors
 * neutre. Une vente illisible vaut fausse : jamais un bouton de paiement inventé.
 */
export async function lireEtatLigne(tenantId: string): Promise<VueEtatLigne | null> {
  try {
    const r = await request<Record<string, unknown> | null>(`/tenants/${tenantId}/credit-whatsapp/etat`);
    const etat = r?.etat;
    if (typeof etat !== 'string' || !(ETATS_LIGNE as readonly string[]).includes(etat)) return null;
    return { etat: etat as EtatLigne, enVente: r?.enVente === true, avecApplication: r?.avecApplication === true };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 402 || err.status === 404)) return null;
    throw err;
  }
}

/**
 * Change les places de l'option, de `depuis` (ce que l'écran a lu : une vue périmée est refusée) à `cible`. Un ajout se
 * paie au prorata avant de compter ; un retrait ne passe pas sous les numéros branchés. Rend les places relues chez Stripe.
 */
export function changerPlacesOption(tenantId: string, depuis: number, cible: number): Promise<{ places: number }> {
  return request(`/tenants/${tenantId}/credit-whatsapp/option`, { method: 'PATCH', body: JSON.stringify({ depuis, cible }) });
}

/** La page de la facture d'un numéro en plus dont le paiement n'a pas abouti (402 `paiement_place_incomplet`), ou `null`. */
export function factureDeLaPlace(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 402) return null;
  const c = err.corps;
  if (typeof c !== 'object' || c === null) return null;
  const { code, url } = c as { code?: unknown; url?: unknown };
  return code === 'paiement_place_incomplet' && typeof url === 'string' && url.startsWith('https://') ? url : null;
}

/**
 * Ouvre un achat et rend l'adresse de la page de paiement. 404 (route pas encore déployée : la console part avant
 * l'API) et 503 (prix de Stripe pas posés) veulent dire « pas encore disponible » ; tout autre refus remonte avec le
 * message du serveur (formule, numéro arrêté).
 */
export async function ouvrirAchatWhatsapp(tenantId: string, offre: OffreWhatsapp): Promise<IssuePaiement> {
  try {
    const r = await request<{ url: string }>(`/tenants/${tenantId}/credit-whatsapp/achat`, {
      method: 'POST',
      body: JSON.stringify({ offre }),
    });
    return { url: r.url };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 503)) return { indisponible: true };
    throw err;
  }
}

/** Un achat dont Stripe a émis la facture : la ligne offre le lien « Facture ». */
export function aUneFactureWhatsapp(m: LigneCreditWhatsapp): m is LigneCreditWhatsapp & { reference: string } {
  return m.raison === 'achat' && typeof m.reference === 'string' && m.reference !== '' && m.facture === true;
}
