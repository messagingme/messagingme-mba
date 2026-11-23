import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0311 : les lignes des commandes payées (segments Shopify enrichis, lot 3). Une colonne à défaut constant sur
 * `shopify_commandes`, une table neuve et deux index partiels, dans une transaction, `lock_timeout` en tête.
 * 🔴 Les prédicats des index sont un contrat avec les requêtes de `src/crm/segments.ts` (`tests/contact-where.test.ts`
 * vérifie l'autre moitié, `tests/integration/shopify-produits.integration.test.ts` que les index la servent) ; 🔴 aucune donnée de la personne n'entre sur la ligne : ni téléphone, ni nom, ni adresse.
 */
const SQL = readFileSync(new URL('../db/migrations/0311_shopify_commande_lignes.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');

describe('migration 0311', () => {
  it('🔴 le plafond d’attente du verrou vient en tête, dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('🔴 la colonne neuve a un défaut constant (métadonnée seule), puis la table et ses deux index', () => {
    expect(instructions.slice(1).map((i) => i.split(' (')[0])).toEqual([
      'alter table shopify_commandes add column if not exists lignes_tronquees boolean not null default false',
      'create table if not exists shopify_commande_lignes',
      'create index if not exists shopify_commande_lignes_produit on shopify_commande_lignes',
      'create index if not exists shopify_commande_lignes_sku on shopify_commande_lignes',
    ]);
  });

  it('🔴 les lignes partent avec leur commande (cascade), et les prédicats des index sont ceux des requêtes', () => {
    const sql = sansCommentaires(SQL).replace(/\s+/g, ' ');
    expect(sql).toContain('foreign key (tenant_id, commande_id) references shopify_commandes (tenant_id, commande_id) on delete cascade');
    expect(sql).toContain('(tenant_id, produit_id) where produit_id is not null and not carte_cadeau;');
    expect(sql).toContain('(tenant_id, sku) where sku is not null and not carte_cadeau;');
  });

  it('🔴 aucune donnée de la personne : ni téléphone, ni nom, ni adresse, ni montant', () => {
    expect(sansCommentaires(SQL)).not.toMatch(/phone|telephone|e164|\bnom\b|name|adresse|address|prix|price|montant/i);
  });
});
