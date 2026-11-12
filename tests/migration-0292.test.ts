import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0292 : la ligne « Désabonnement WhatsApp » des choix HubSpot (plan `2026-11-12-stop-vers-hubspot.md`). Allumée par
 * défaut, comme le contact injoignable, et ajoutée sans réécrire la table (défaut constant).
 */
const SQL = readFileSync(new URL('../db/migrations/0292_hubspot_stop.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');

describe('migration 0292', () => {
  it('🔴 la colonne ALLUMÉE par défaut, posée sous un plafond de verrou', () => {
    expect(instructions).toEqual([
      "set local lock_timeout = '5s'",
      'alter table tenant_settings add column if not exists hubspot_stop boolean not null default true',
    ]);
  });

  it('se joue dans une transaction (aucune directive hors transaction)', () => {
    expect(veutHorsTransaction(SQL)).toBe(false);
  });
});
