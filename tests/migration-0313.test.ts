import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0313 : les reprises de l'historique Shopify (segments Shopify enrichis, lot 5). Une table neuve, dans une transaction,
 * `lock_timeout` en tête. 🔴 Aucune donnée de personne : des comptes, un curseur, une erreur. 🔴 L'index unique partiel
 * qui tient « une reprise vivante par espace » a le MÊME prédicat que les requêtes du magasin qui le supposent.
 */
const SQL = readFileSync(new URL('../db/migrations/0313_shopify_reprises.sql', import.meta.url), 'utf8');
const MAGASIN = readFileSync(new URL('../src/shopify/reprises.pg.ts', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');

describe('migration 0313', () => {
  it('🔴 le plafond d’attente du verrou vient en tête, dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('🔴 une table neuve et ses deux index, rien d’autre (aucune table existante modifiée)', () => {
    expect(instructions.slice(1).map((i) => i.split(' (')[0])).toEqual([
      'create table if not exists shopify_reprises',
      'create unique index if not exists shopify_reprises_vivante on shopify_reprises',
      'create index if not exists shopify_reprises_derniere on shopify_reprises',
    ]);
  });

  it('🔴 le statut et le genre sont fermés, sous des noms de contrainte lisibles ; l’espace meurt avec ses reprises', () => {
    const t = sansCommentaires(SQL).replace(/\s+/g, ' ');
    expect(t).toContain("constraint shopify_reprises_statut_check check (statut in ('en_attente', 'en_cours', 'termine', 'refuse', 'erreur'))");
    expect(t).toContain("constraint shopify_reprises_genre_check check (genre in ('commandes', 'fiches_acheteurs'))");
    expect(t).toContain('tenant_id uuid not null references tenants(id) on delete cascade');
  });

  it('🔴 l’index « une reprise vivante » et les requêtes du magasin disent « vivante » avec le MÊME prédicat', () => {
    const vivante = "statut in ('en_attente', 'en_cours')";
    expect(instructions[2]).toBe(`create unique index if not exists shopify_reprises_vivante on shopify_reprises (tenant_id, genre) where ${vivante}`);
    // Le lancement clôt l'abandonnée, puis relit la vivante qui l'a refusé ; prendre ne prend qu'une vivante.
    expect(MAGASIN.split(vivante).length - 1).toBeGreaterThanOrEqual(3);
    expect(MAGASIN).not.toMatch(/statut in \('en_cours', 'en_attente'\)|statut <> 'termine'/);
  });

  it('🔴 aucune donnée personnelle : ni téléphone, ni nom, ni adresse, ni commande', () => {
    expect(sansCommentaires(SQL)).not.toMatch(/phone|telephone|e164|nom\b|name|adresse|address|commande_id|email/i);
  });
});
