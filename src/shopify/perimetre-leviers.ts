import { PREFIXE_ENVOI_API } from '../api/cible-rcs';
import { PREFIXE_LIGNE_HUBSPOT } from '../hubspot-workflow/envoi';
import { LIGNE_RELANCE_PANIER, PREFIXE_LIGNE_SHOPIFY } from './attribution';

/**
 * LES LEVIERS DE VENTE, UNE SEULE DÉFINITION (spec docs/superpowers/specs/2026-11-06-roi-shopify-design.md).
 *
 * 🔴 LE COÛT ET LE CHIFFRE PARLENT DES MÊMES MESSAGES. L'attribution (`TOUCHES`, `src/shopify/ventes.pg.ts`) ne prend
 * pour touche qu'un envoi de campagne (relance de panier comprise, sans les confirmations et expéditions Shopify, les
 * envois `[API]` ni les lignes HubSpot) ou un message sortant d'un scénario, de l'agent IA ou de l'agent de Meta. Le coût
 * du ROI (`src/shopify/cout-leviers.pg.ts`) compte exactement ce périmètre : s'il en comptait plus, le ROI d'une source
 * mentirait vers le bas ; moins, vers le haut. Les deux requêtes interpolent les fragments d'ici, et
 * `tests/shopify-perimetre-leviers.test.ts` vérifie qu'elles le font.
 *
 * Les fragments sont du SQL à interpoler : `k` et `m` sont des alias de la requête appelante, les paramètres des
 * marqueurs (`$6`) qu'elle lie aux valeurs de `VALEURS_CAMPAGNE_LEVIER`, dans cet ordre. Jamais une valeur d'utilisateur.
 */

/** Les quatre valeurs que lie la condition des campagnes, dans l'ordre de `MarqueursCampagne`. */
export const VALEURS_CAMPAGNE_LEVIER = {
  relance: LIGNE_RELANCE_PANIER,
  shopify: PREFIXE_LIGNE_SHOPIFY,
  api: PREFIXE_ENVOI_API,
  hubspot: PREFIXE_LIGNE_HUBSPOT,
} as const;

export interface MarqueursCampagne { relance: string; shopify: string; api: string; hubspot: string }

/** Une campagne levier : la relance de panier par son nom, ou toute campagne hors des préfixes des lignes techniques. */
export function campagneLevier(k: string, p: MarqueursCampagne): string {
  return `(${k}.name = ${p.relance} or not (starts_with(${k}.name, ${p.shopify}) or starts_with(${k}.name, ${p.api}) `
    + `or starts_with(${k}.name, ${p.hubspot})))`;
}

/** La source d'une campagne levier : la relance de panier est une source à elle seule. */
export function sourceDeCampagne(k: string, relance: string): string {
  return `case when ${k}.name = ${relance} then 'relance_panier' else 'campagne' end`;
}

/** Les origines de message qui sont des leviers : le scénario, l'agent IA, l'agent de Meta. */
export const ORIGINES_LEVIER = ['scenario', 'ia', 'mba'] as const;

/** Un message sortant d'une origine levier. */
export function origineLevier(m: string): string {
  return `${m}.origin in (${ORIGINES_LEVIER.map((o) => `'${o}'`).join(', ')})`;
}

/**
 * LA LIGNE SHOPIFY D'UN MESSAGE DE SCÉNARIO (menu « Scénario », lot 5, décision 32) : le bloc qui l'a envoyé (la mesure
 * `workflow_node_events`, par son identifiant Meta) appartient au scénario d'une ligne, et le message est alors une touche
 * de l'automation de cette ligne, jamais d'une campagne à scénario que l'heuristique de rattachement lui prêterait. Une
 * jointure latérale qui rend `evenement` (null hors ligne) sous `alias` ; `tenant`, l'espace de la requête appelante.
 */
export function ligneDuMessage(m: string, tenant: string, alias: string): string {
  return `left join lateral (select l.evenement from workflow_node_events e `
    + `join shopify_lignes l on l.tenant_id = e.tenant_id and l.workflow_id = e.workflow_id `
    + `where ${m}.origin = 'scenario' and e.meta_message_id = ${m}.meta_message_id and e.tenant_id = ${tenant} and e.kind = 'sent' `
    + `limit 1) ${alias} on true`;
}

/** La source de l'automation d'une ligne : le panier en relance de panier, les commandes sous leur nom (décision 32). */
export function sourceDeLaLigne(alias: string): string {
  return `case ${alias}.evenement when 'checkout_abandoned' then 'relance_panier' when 'order_paid' then 'commande_payee' `
    + `when 'order_fulfilled' then 'commande_expediee' end`;
}

/** La source d'un message levier, par son origine. */
export function sourceDeLOrigine(m: string): string {
  return `case ${m}.origin when 'scenario' then 'scenario' when 'ia' then 'agent' else 'agent_meta' end`;
}
