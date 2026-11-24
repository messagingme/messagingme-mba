import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0320 : les index de la cascade d'une fiche sur les trois tables des étiquettes Shopify (segments Shopify enrichis, lot 6b).
 * Leurs clés commencent par `tenant_id` : sans un index sur `contact_id` seul, la suppression d'une fiche (la cascade ne
 * nomme que `contact_id`) balaierait chaque table en entier. Ce que seul le texte peut dire avant la production : dans une
 * transaction, sous un délai de verrou, trois index idempotents et rien d'autre. Leur présence en base est relue par
 * `tests/integration/shopify-etiquettes.integration.test.ts`.
 */
const SQL = readFileSync(new URL('../db/migrations/0320_shopify_etiquettes_index.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL).map(sansCommentaires).map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()).filter((i) => i !== '');

describe('migration 0320', () => {
  it('🔴 dans une transaction, sous un délai de verrou, sans accent grave', () => {
    expect(veutHorsTransaction(SQL)).toBe(false);
    expect(SQL).not.toContain('`');
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(instructions).toHaveLength(4);
  });

  it('🔴 un index sur contact_id seul pour chacune des trois tables de la fiche, idempotent', () => {
    expect(instructions.slice(1)).toEqual([
      'create index if not exists shopify_clients_contact on shopify_clients (contact_id)',
      'create index if not exists shopify_etiquettes_contact on shopify_etiquettes (contact_id)',
      'create index if not exists shopify_fiches_cherchees_contact on shopify_fiches_cherchees (contact_id)',
    ]);
  });
});
