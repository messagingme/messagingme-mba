import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0291 : les PDF propres à un contact, recopiés de HubSpot (plan `docs/superpowers/plans/2026-11-12-pdf-par-contact-
 * hubspot.md`, lot A). Ce que seul son texte peut dire avant la production : une transaction sous délai de verrou, une
 * table neuve rangée par numéro, la cascade de l'espace, et la cohérence entre une ligne vivante et une ligne que la
 * purge RGPD a marquée.
 */
const SQL = readFileSync(new URL('../db/migrations/0291_documents_contact.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL).map(sansCommentaires).map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()).filter((i) => i !== '');

describe('migration 0291', () => {
  it('🔴 dans une transaction, sous un délai de verrou, sans accent grave', () => {
    expect(veutHorsTransaction(SQL)).toBe(false);
    expect(SQL).not.toContain('`');
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
  });

  it('🔴 une table NEUVE : elle ne touche à aucune table existante, sauf la référence à tenants', () => {
    const autres = instructions.slice(1).filter((i) => !i.startsWith('create table if not exists documents_contact')
      && !i.startsWith('create index if not exists documents_contact_'));
    expect(autres).toEqual([]);
    expect(instructions.join(' ')).toContain('tenant_id uuid not null references tenants(id) on delete cascade');
  });

  it('🔴 rangée par numéro, clé (espace, code), et la purge marquée efface numéro et nom', () => {
    const table = instructions.find((i) => i.startsWith('create table if not exists documents_contact')) ?? '';
    expect(table).toContain('primary key (tenant_id, code)');
    expect(table).toContain('wa_id text,');
    expect(table).toContain('(a_effacer_le is null and wa_id is not null) or (a_effacer_le is not null and wa_id is null and nom is null)');
  });
});
