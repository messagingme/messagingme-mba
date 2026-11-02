import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0269 : la pièce reçue par un bloc Question (spec du 2026-11-02). Ce que la migration doit tenir, et que seul son texte
 * peut dire avant qu'elle ne passe en production : une pièce par contact et par champ (la clé, sur laquelle l'écriture
 * fait son upsert), les cascades avec l'espace et la fiche, des longueurs bornées, et AUCUN moyen d'accéder au fichier
 * dans la table (ni adresse, ni jeton : le lien se fabrique à l'appel).
 */
const SQL = readFileSync(new URL('../db/migrations/0269_pieces_question.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL).map(sansCommentaires).map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()).filter((i) => i !== '');
const table = instructions.find((i) => i.startsWith('create table if not exists pieces_question ')) ?? '';

describe('migration 0269', () => {
  it('🔴 dans une transaction, sous un délai de verrou, sans accent grave', () => {
    expect(veutHorsTransaction(SQL)).toBe(false);
    expect(SQL).not.toContain('`');
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(instructions).toHaveLength(2);
  });

  it('🔴 une pièce par contact et par champ, effacée avec l’espace et la fiche', () => {
    expect(table).toContain('primary key (tenant_id, contact_id, cle_champ)');
    expect(table).toContain('tenant_id uuid not null references tenants(id) on delete cascade');
    expect(table).toContain('contact_id uuid not null references contacts(id) on delete cascade');
  });

  it('🔴 des longueurs bornées, et rien qui ouvre le fichier', () => {
    expect(table).toContain('cle_champ text not null check (char_length(cle_champ) between 1 and 200)');
    expect(table).toContain('meta_message_id text not null check (char_length(meta_message_id) between 1 and 200)');
    expect(table).toContain('mention text not null check (char_length(mention) between 1 and 200)');
    expect(table).not.toMatch(/\b(url|lien|jeton|token)\b/);
  });
});
