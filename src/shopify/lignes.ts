import type { EvenementShopify } from './donnees';

/**
 * LES LIGNES SHOPIFY (menu « Scénario », lot 5, migration 0299) : une ligne par événement et par espace, son scénario du
 * rayon `shopify` et son interrupteur. Elle remplace `shopify_messages` comme source de ce que le circuit envoie : quand
 * l'événement arrive, le circuit envoie le premier bloc PUBLIÉ de son scénario (`./premier-bloc.ts`), et le parcours
 * d'événement naît dessus.
 */
export interface LigneShopify {
  evenement: EvenementShopify;
  workflowId: string;
  actif: boolean;
  modifieLe: string;
}

/**
 * Le nom de l'automation d'un événement, et du scénario de sa ligne (unique dans le rayon `shopify` de l'espace) : la
 * console, `get_shopify_state` et le refus de supprimer un scénario tenu par une ligne le disent.
 */
export const NOM_DU_SCENARIO: Readonly<Record<EvenementShopify, string>> = {
  order_paid: 'Commande payée',
  order_fulfilled: 'Commande expédiée',
  checkout_abandoned: 'Panier abandonné',
};

/**
 * Le sujet du webhook de chaque événement : celui de la clé d'idempotence d'aujourd'hui, et donc celui de l'origine d'un
 * parcours (`shopify:<domaine>:<sujet>:<référence>`), que la règle « encore voulu » relit (`./parcours-voulu.ts`).
 */
export const SUJET_DE_L_EVENEMENT: Readonly<Record<EvenementShopify, string>> = {
  order_paid: 'orders/paid',
  order_fulfilled: 'fulfillments/create',
  checkout_abandoned: 'checkouts/abandoned',
};

/**
 * Le début des origines d'une boutique, ou d'une de ses lignes : ce que l'arrêt des parcours d'événement compare
 * (`starts_with`, `arreterParcours({ prefixe })`). Il finit par `:`, pour qu'une boutique n'en recouvre jamais une autre
 * dont le domaine commencerait pareil.
 */
export function prefixeShopify(domaine: string, evenement?: EvenementShopify): string {
  return evenement === undefined ? `shopify:${domaine}:` : `shopify:${domaine}:${SUJET_DE_L_EVENEMENT[evenement]}:`;
}

/** L'origine du parcours d'un événement : la clé d'idempotence de son envoi, mot pour mot. */
export function origineShopify(domaine: string, evenement: EvenementShopify, reference: string): string {
  return `${prefixeShopify(domaine, evenement)}${reference}`;
}
