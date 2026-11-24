import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0318 : les comptes des fiches d'acheteurs du rattrapage (segments Shopify enrichis, lot 5b). Deux colonnes ajoutées à
 * `shopify_reprises`, au défaut constant (métadonnées seules), dans une transaction, `lock_timeout` en tête. NON
 * BLOQUANTE, `migration=avant` : l'ancien code ne les nomme pas, le neuf les lit et les écrit. Des comptes seulement.
 */
const SQL = readFileSync(new URL('../db/migrations/0318_shopify_reprises_fiches.sql', import.meta.url), 'utf8');
const MAGASIN = readFileSync(new URL('../src/shopify/reprises.pg.ts', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');

describe('migration 0318', () => {
  it('🔴 le plafond d’attente du verrou vient en tête, dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('🔴 deux colonnes ajoutées à la seule table des reprises, au défaut constant, sous des contraintes nommées ; rien d’autre', () => {
    expect(instructions.slice(1)).toEqual([
      'alter table shopify_reprises add column if not exists fiches_creees integer not null default 0 constraint shopify_reprises_fiches_creees_check check (fiches_creees >= 0)',
      'alter table shopify_reprises add column if not exists hors_plafond integer not null default 0 constraint shopify_reprises_hors_plafond_check check (hors_plafond >= 0)',
    ]);
    expect(sansCommentaires(SQL)).not.toMatch(/drop |create /i);
  });

  it('🔴 aucune donnée personnelle : des comptes seulement', () => {
    expect(sansCommentaires(SQL)).not.toMatch(/phone|telephone|e164|\bnom\b|name|adresse|address|email|commande_id|contact_id/i);
  });

  it('le magasin des reprises lit et écrit les deux comptes', () => {
    expect(MAGASIN).toMatch(/fiches_creees/);
    expect(MAGASIN).toMatch(/hors_plafond/);
  });
});
