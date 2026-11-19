import type { EvenementShopify } from '../../web/lib/partage/shopify-messages';

/**
 * LA RÈGLE « LE PARCOURS EST-IL ENCORE VOULU ? » D'UN PARCOURS SHOPIFY (menu « Scénario », lot 5, décisions 4 et 15).
 * L'exécuteur la lit à chaque reprise et à chaque réponse d'un parcours d'événement (`parcoursEncoreVoulu`) : faux, le
 * parcours se clôt sans rien envoyer ni passer à l'équipe.
 *
 * Plus voulu : la boutique absente, coupée ou en pause ; la ligne de l'événement éteinte ou absente ; pour le panier
 * abandonné, le panier qui n'est plus ouvert (une commande est née de lui, décision 4 : la même lecture que la relance,
 * `panierOuvert`). Toute autre origine (une autre source, un sujet que ce lot ne connaît pas) reste voulue, sans rien lire.
 */

/** Ce que la règle lit de la boutique : le magasin passé ENTIER (ses méthodes lisent `this`, jamais détachées). */
export interface LecturesParcoursShopify {
  etatPourParcours(tenantId: string, domaine: string, evenement: EvenementShopify): Promise<{
    boutique: 'absente' | 'coupee' | 'pause' | 'active';
    ligneActive: boolean;
  }>;
  panierOuvert(tenantId: string, jeton: string): Promise<boolean>;
}

/**
 * Le sujet d'une origine (celui de la clé d'idempotence du circuit : `shopify:<domaine>:<sujet>:<référence>`) et
 * l'événement de sa ligne.
 */
const EVENEMENT_DU_SUJET: Readonly<Record<string, EvenementShopify>> = {
  'orders/paid': 'order_paid',
  'fulfillments/create': 'order_fulfilled',
  'checkouts/abandoned': 'checkout_abandoned',
};

export async function parcoursShopifyEncoreVoulu(store: LecturesParcoursShopify, tenantId: string, origine: string): Promise<boolean> {
  const [source, domaine, sujet, ...reste] = origine.split(':');
  const reference = reste.join(':');
  if (source !== 'shopify' || !domaine || !sujet || reference === '') return true;
  const evenement = EVENEMENT_DU_SUJET[sujet];
  if (evenement === undefined) return true;
  const etat = await store.etatPourParcours(tenantId, domaine, evenement);
  if (etat.boutique !== 'active' || !etat.ligneActive) return false;
  if (evenement === 'checkout_abandoned') return store.panierOuvert(tenantId, reference);
  return true;
}
