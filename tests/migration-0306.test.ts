import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0306 : la relance de panier avec agent IA (plan 2026-11-20, lot 1). Elle élargit le CHECK de `shopify_lignes.evenement`
 * (créé en ligne par 0299, son nom lu en base de production avant le déploiement) : AVANT, poussée SEULE ; l'ancien code
 * n'écrit aucune valeur neuve.
 */
const SQL = readFileSync(new URL('../db/migrations/0306_shopify_ligne_agent.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');

describe('migration 0306', () => {
  it('🔴 le plafond d’attente du verrou vient en tête, dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('🔴 l’ancien CHECK retiré SANS if exists (un nom faux fait échouer), recréé sous le même nom en sur-ensemble', () => {
    expect(instructions).toEqual([
      "set local lock_timeout = '5s'",
      'alter table shopify_lignes drop constraint shopify_lignes_evenement_check',
      'alter table shopify_lignes add constraint shopify_lignes_evenement_check check (evenement in '
        + "('order_paid', 'order_fulfilled', 'checkout_abandoned', 'checkout_abandoned_agent'))",
    ]);
    expect(sansCommentaires(SQL)).not.toMatch(/if exists/i);
  });
});
