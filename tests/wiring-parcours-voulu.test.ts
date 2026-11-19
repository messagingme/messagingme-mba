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
  it('🔴 la vraie règle Shopify, le magasin passé ENTIER, et un parcours ordinaire qui ne la lit jamais', () => {
    expect(sansCommentaires).toMatch(/const shopifyPourParcours = new PgShopifyStore\(deps\.pool, config\.ENCRYPTION_KEY\)/);
    expect(sansCommentaires).toMatch(
      /parcoursEncoreVoulu: \(tenant, run\) =>\s*run\.evenement === null \? Promise\.resolve\(true\) : parcoursShopifyEncoreVoulu\(shopifyPourParcours, tenant, run\.evenement\.origine\)/,
    );
    expect(sansCommentaires).not.toMatch(/parcoursEncoreVoulu: async \(\) => true/);
  });
});
