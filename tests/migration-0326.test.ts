import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0326 : un client Shopify relie toutes les fiches de ses numéros, une fiche porte les étiquettes de tous ses clients
 * (segments Shopify enrichis, lot 6b bis ; décision de Julien du 2026-11-25, « le max de numéros »). Ce que seul le texte
 * peut dire avant la production : dans une transaction, sous un délai de verrou, la colonne `client_id` remplie depuis le
 * lien existant AVANT que la contrainte « une fiche, un client » ne disparaisse (le remplissage n'est sans ambiguïté que
 * sous elle), les lignes sans lien retirées avant le NOT NULL, les contraintes nommées comme la base les a nommées après la
 * 0319, et la cascade du lien. Le résultat en base est relu par `tests/integration/shopify-etiquettes.integration.test.ts`.
 */
const SQL = readFileSync(new URL('../db/migrations/0326_shopify_liens_tous_les_numeros.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL).map(sansCommentaires).map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()).filter((i) => i !== '');

describe('migration 0326', () => {
  it('🔴 dans une transaction, sous un délai de verrou, sans accent grave', () => {
    expect(veutHorsTransaction(SQL)).toBe(false);
    expect(SQL).not.toContain('`');
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
  });

  it('🔴 dans l’ordre : la colonne remplie depuis le lien encore unique, les orphelines retirées, puis les clés changées', () => {
    expect(instructions.slice(1)).toEqual([
      'alter table shopify_etiquettes add column client_id text',
      'update shopify_etiquettes e set client_id = l.client_id from shopify_clients l where l.tenant_id = e.tenant_id and l.contact_id = e.contact_id',
      'delete from shopify_etiquettes where client_id is null',
      'alter table shopify_etiquettes alter column client_id set not null',
      "alter table shopify_etiquettes add constraint shopify_etiquettes_client_id_check check (client_id ~ '^[0-9]{1,19}$')",
      'alter table shopify_clients drop constraint shopify_clients_contact_key',
      'alter table shopify_clients drop constraint shopify_clients_pkey',
      'alter table shopify_clients add constraint shopify_clients_pkey primary key (tenant_id, client_id, contact_id)',
      'alter table shopify_etiquettes drop constraint shopify_etiquettes_pkey',
      'alter table shopify_etiquettes add constraint shopify_etiquettes_pkey primary key (tenant_id, contact_id, client_id, etiquette)',
      'alter table shopify_etiquettes add constraint shopify_etiquettes_lien_fkey foreign key (tenant_id, client_id, contact_id) '
        + 'references shopify_clients (tenant_id, client_id, contact_id) on delete cascade',
    ]);
  });

  it('🔴 le format de client_id est celui de shopify_clients (0319) : un identifiant numérique de 1 à 19 chiffres', () => {
    const lien = readFileSync(new URL('../db/migrations/0319_shopify_etiquettes.sql', import.meta.url), 'utf8');
    expect(lien).toContain("client_id text not null constraint shopify_clients_client_id_check check (client_id ~ '^[0-9]{1,19}$')");
    expect(SQL).toContain("check (client_id ~ '^[0-9]{1,19}$')");
  });
});
