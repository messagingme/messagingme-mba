/**
 * LA JOIGNABILITÉ WHATSAPP DES COMMANDES SHOPIFY (segments Shopify enrichis, lot 2b ; spec
 * `docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`, « Performance Lab, commandes expédiées et messages
 * livrés »). La réponse de `GET /tenants/:tenantId/stats/joignabilite`, partagée par le serveur qui la calcule
 * (`src/shopify/joignabilite.pg.ts`) et la console qui l'affiche (`@/lib/joignabilite-shopify`). Module PUR.
 *
 * ⚠️ À NE PAS CONFONDRE avec `./joignabilite` (la mémoire de joignabilité d'UN contact, sa péremption).
 *
 * Sur la période (date d'EXPÉDITION, jour de Paris), les commandes réelles expédiées (au moins un `fulfillments/create`,
 * une commande en deux colis compte une fois) se répartissent en cinq parts SANS RECOUVREMENT, la première qui s'applique
 * gagne : livrée (au moins un message de confirmation ou d'expédition `delivered` ou `read`), échec avec contact supprimé
 * (un 131026 dont la fiche a été supprimée), sans numéro, numéro invalide ou fixe, en attente (le reste, un `sent` compris).
 * 🔴 `livrees + supprimees + sansNumero + invalides + enAttente = expediees`, toujours : le serveur le construit ainsi.
 */
export interface JoignabiliteShopify {
  /** Commandes réelles expédiées sur la période (les commandes de test sont à part). */
  expediees: number;
  /** Messages livrés ou lus (confirmations et avis d'expédition) de ces commandes : peut dépasser `livrees`. */
  messagesLivres: number;
  livrees: number;
  supprimees: number;
  sansNumero: number;
  invalides: number;
  enAttente: number;
  /** Les commandes de TEST expédiées sur la période : annoncées à part, jamais dans le taux. */
  testExpediees: number;
}
