/**
 * Les offres d'achat du Crédit WhatsApp (plan du Crédit WhatsApp, tâche 10) : ce qu'on vend, et ce que chacune crédite.
 *
 * Même règle que les recharges du crédit IA (`offres.ts`) : le client ne choisit jamais un montant, seulement une offre
 * de cette liste ; le prix Stripe de chacune vit dans la configuration (`STRIPE_PRIX_WA_*`), le crédit qu'elle donne vit
 * ICI et se DÉRIVE du prix hors taxe (50 € payés hors taxe donnent 50 € de Crédit WhatsApp, la TVA s'ajoute au paiement).
 * Le webhook ne crédite qu'après avoir recoupé ce montant avec ce que Stripe dit avoir encaissé.
 */

/** De la plus petite à la plus grande : l'onglet et `buy_credit` les présentent dans cet ordre. */
export const OFFRES_WHATSAPP = ['wa_50', 'wa_100', 'wa_250', 'wa_500'] as const;
export type OffreWhatsapp = typeof OFFRES_WHATSAPP[number];

/** La métadonnée `produit` de la session Checkout : c'est elle qui aiguille l'avis de Stripe vers ce crédit-ci. */
export const PRODUIT_CREDIT_WHATSAPP = 'credit_whatsapp';

const HT_CENTIMES: Readonly<Record<OffreWhatsapp, number>> = {
  wa_50: 5_000,
  wa_100: 10_000,
  wa_250: 25_000,
  wa_500: 50_000,
};

/** Ce que Stripe doit avoir encaissé hors taxe, en centimes d'euro (`amount_subtotal` de la session). */
export function htCentimesWhatsapp(offre: OffreWhatsapp): number {
  return HT_CENTIMES[offre];
}

/** Le crédit accordé, en micro-euros : un centime hors taxe vaut dix mille micro-euros de crédit. */
export function creditDeLOffreWhatsapp(offre: OffreWhatsapp): number {
  return HT_CENTIMES[offre] * 10_000;
}
