import { ApiError, request } from './http';
import type { IssuePaiement } from './api-credit';

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

/** Ce que lit l'onglet. Montants en micro-euros ; un prix se montre tout compris, jamais un taux. */
export interface VueCreditWhatsapp {
  soldeMicroEur: number;
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
    soldeMicroEur: r.soldeMicroEur,
    prixFrance: Array.isArray(r.prixFrance) ? r.prixFrance : null,
    franchiseServiceParNumero: typeof r.franchiseServiceParNumero === 'number' ? r.franchiseServiceParNumero : 0,
    achat: {
      disponible: achat?.disponible === true,
      permis: typeof achat?.permis === 'string' ? achat.permis : 'ok',
      offres: Array.isArray(achat?.offres) ? achat.offres : [],
    },
    ligneArretee: r.ligneArretee === true,
    historique: Array.isArray(r.historique) ? r.historique : [],
  };
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
