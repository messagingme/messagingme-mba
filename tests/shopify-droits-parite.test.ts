import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * LES DROITS DE L'APP SHOPIFY, UNE SEULE LISTE (segments Shopify enrichis, lot 7d) : la carte de la console
 * (`DROITS_SHOPIFY`, l'app créée à la main) et le `shopify.app.toml` de la skill du plugin (l'app créée par la CLI) sont
 * la même app. Un droit ajouté d'un côté sans l'autre ferait qu'une boutique branchée par une voie n'aurait pas ce que le
 * code attend. Lus en texte : le composant de la console ne s'importe pas côté serveur.
 * 🔴 Un droit n'y entre qu'une fois MESURÉ sur une vraie app : un droit que Shopify refuserait ferait échouer la
 * publication de l'app de chaque nouveau marchand (`read_customer_merge`, mesuré le 2026-11-27 sur l'app de démo).
 */
const lire = (chemin: string): string => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const liste = (texte: string, motif: RegExp, ou: string): string[] => {
  const m = motif.exec(texte);
  if (!m) throw new Error(`liste des droits introuvable dans ${ou}`);
  return m[1]!.split(',').map((d) => d.trim()).sort();
};

describe('les droits de l’app Shopify', () => {
  it('🔴 la carte de la console et la skill du plugin demandent exactement les mêmes', () => {
    const console_ = liste(lire('web/components/ShopifyBrancher.tsx'), /export const DROITS_SHOPIFY = '([^']+)'/, 'ShopifyBrancher.tsx');
    const skill = liste(lire('plugin/skills/shopify/SKILL.md'), /^scopes = "([^"]+)"$/m, 'la skill shopify');
    expect(console_.length).toBeGreaterThan(0);
    expect(console_).toEqual(skill);
    expect(console_).toContain('read_customer_merge');
  });
});
