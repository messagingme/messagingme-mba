import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * LE CÂBLAGE DE « LE PARCOURS EST-IL ENCORE VOULU ? » (menu « Scénario », lot 5, décisions 4 et 15), LU DANS LA SOURCE.
 * Le lot 4 l'avait câblé inerte (« toujours voulu ») ; un retour à l'inerte, ou un magasin passé par méthode détachée (qui
 * perdrait son `this` sans erreur de compilation), laisserait vivre les parcours d'une boutique en pause ou d'un panier
 * commandé : seul ce test le verrait.
 */
const source = readFileSync(new URL('../src/workflow/wiring.ts', import.meta.url), 'utf8');
const sansCommentaires = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('câblage de la règle « encore voulu » des parcours d’événement', () => {
  it('🔴 les vraies règles Shopify et HubSpot, les magasins passés ENTIERS, et un parcours ordinaire qui ne les lit jamais', () => {
    expect(sansCommentaires).toMatch(/const shopifyPourParcours = new PgShopifyStore\(deps\.pool, config\.ENCRYPTION_KEY\)/);
    // Lot 6b : une origine `hubspot:` relit sa ligne (épinglé jusque-là à la seule règle Shopify, changé délibérément).
    expect(sansCommentaires).toMatch(/const lignesHubspotPourParcours = new PgLignesHubspot\(deps\.pool\)/);
    expect(sansCommentaires).toMatch(
      /parcoursEncoreVoulu: \(tenant, run\) =>\s*run\.evenement === null \? Promise\.resolve\(true\)\s*: run\.evenement\.origine\.startsWith\(prefixeHubspot\(\)\) \? parcoursHubspotEncoreVoulu\(lignesHubspotPourParcours, tenant, run\.evenement\.origine\)\s*: parcoursShopifyEncoreVoulu\(shopifyPourParcours, tenant, run\.evenement\.origine\)/,
    );
    expect(sansCommentaires).not.toMatch(/parcoursEncoreVoulu: async \(\) => true/);
  });
});
