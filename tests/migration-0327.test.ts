import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';
import { BORNES_SEGMENTS, MOTIF_ID_COLLECTION } from '../web/lib/partage/segments';
import { NOM_SEGMENT_MAX, REQUETE_SEGMENT_MAX } from '../src/shopify/segments-lues';

/**
 * 0327 : les segments natifs Shopify et leurs membres (segments Shopify enrichis, lot 6c), appliquée seule le 2026-11-25 et
 * relue en base. Ce que seul le texte tient ensuite : dans une transaction, sous un délai de verrou (les clés étrangères
 * verrouillent `tenants` et `contacts`, lus et écrits par le chemin chaud) ; les bornes des colonnes sont celles du code
 * qui les écrit (un nom de segment coupé à 255, une requête à 5 000, un identifiant en chiffres) ; les cascades. Le
 * résultat en base : `tests/integration/shopify-segments.integration.test.ts`.
 */
const SQL = readFileSync(new URL('../db/migrations/0327_shopify_segments.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL).map(sansCommentaires).map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()).filter((i) => i !== '');

describe('migration 0327', () => {
  it('🔴 dans une transaction, sous un délai de verrou, sans accent grave ; deux tables et l’index de la cascade', () => {
    expect(veutHorsTransaction(SQL)).toBe(false);
    expect(SQL).not.toContain('`');
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(instructions.slice(1).map((i) => i.split(' (')[0])).toEqual([
      'create table if not exists shopify_segments', 'create table if not exists shopify_segment_membres',
      'create index if not exists shopify_segment_membres_contact on shopify_segment_membres',
    ]);
  });

  it('🔴 les bornes des colonnes sont celles du code qui les écrit', () => {
    expect(MOTIF_ID_COLLECTION).toBe('^\\d{1,19}$');
    expect(SQL).toContain("check (segment_id ~ '^[0-9]{1,19}$')");
    expect(SQL).toContain(`check (char_length(nom) between 1 and ${NOM_SEGMENT_MAX})`);
    expect(SQL).toContain(`check (char_length(requete) <= ${REQUETE_SEGMENT_MAX})`);
    expect(BORNES_SEGMENTS.segmentsShopifyMax).toBe(20);
  });

  it('🔴 les appartenances cascadent avec la fiche, avec le segment ; le segment avec l’espace', () => {
    expect(instructions[2]).toContain('contact_id uuid not null constraint shopify_segment_membres_contact_id_fkey references contacts(id) on delete cascade');
    expect(instructions[2]).toContain('constraint shopify_segment_membres_segment_fkey foreign key (tenant_id, segment_id) references shopify_segments (tenant_id, segment_id) on delete cascade');
    expect(instructions[1]).toContain('tenant_id uuid not null references tenants(id) on delete cascade');
  });
});
