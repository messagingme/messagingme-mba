import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0309 : `contacts.nee_de` (segments Shopify enrichis, lot 2a). Une colonne nullable sans défaut et son CHECK fermé, dans
 * une transaction, `lock_timeout` en tête. Non bloquante : le code la pose au mieux et le job qui la lit échoue sans rien
 * supprimer tant qu'elle manque.
 */
const SQL = readFileSync(new URL('../db/migrations/0309_contacts_nee_de.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');

describe('migration 0309', () => {
  it('🔴 le plafond d’attente du verrou vient en tête, dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('🔴 une colonne nullable SANS défaut (aucune réécriture), son CHECK nommé et fermé à la seule valeur écrite', () => {
    expect(instructions).toEqual([
      "set local lock_timeout = '5s'",
      "alter table contacts add column if not exists nee_de text constraint contacts_nee_de_check check (nee_de in ('shopify'))",
    ]);
    expect(sansCommentaires(SQL)).not.toMatch(/default|not null/i);
  });
});
