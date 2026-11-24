import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';
import { BAIL_LOT_SECONDES, FRAICHEUR_COLLECTIONS_HEURES, PgCollectionsStore } from '../src/shopify/collections.pg';

/**
 * 0314 : les collections des produits achetés (segments Shopify enrichis, lot 6a). Trois tables neuves et un index, dans une
 * transaction, `lock_timeout` en tête, aucune table existante modifiée. 🔴 BLOQUANTE : `effacerBranchement` nomme les trois
 * tables (le même test le vérifie dans le code), elle part SEULE, avant le code. 🔴 Aucune donnée de personne : des produits
 * et des collections du catalogue. 🔴 Toutes les requêtes du magasin nomment l'espace.
 */
const SQL = readFileSync(new URL('../db/migrations/0314_shopify_collections.sql', import.meta.url), 'utf8');
const MAGASIN = readFileSync(new URL('../src/shopify/collections.pg.ts', import.meta.url), 'utf8');
const STORE = readFileSync(new URL('../src/shopify/store.pg.ts', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');
const TABLES = ['shopify_produits', 'shopify_produit_collections', 'shopify_collections_lecture'];

describe('migration 0314', () => {
  it('🔴 le plafond d’attente du verrou vient en tête, dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('🔴 trois tables neuves et l’index du critère, rien d’autre (aucune table existante modifiée)', () => {
    expect(instructions.slice(1).map((i) => i.split(' (')[0])).toEqual([
      'create table if not exists shopify_produits',
      'create table if not exists shopify_produit_collections',
      'create index if not exists shopify_produit_collections_collection on shopify_produit_collections',
      'create table if not exists shopify_collections_lecture',
    ]);
    expect(sansCommentaires(SQL)).not.toMatch(/alter table|drop /i);
  });

  it('🔴 les contraintes sous des noms lisibles ; les collections partent avec leur produit, l’espace avec ses tables', () => {
    const t = sansCommentaires(SQL).replace(/\s+/g, ' ');
    expect(t).toContain("constraint shopify_produits_produit_id_check check (produit_id ~ '^[0-9]{1,19}$')");
    expect(t).toContain('constraint shopify_produits_titre_check check (char_length(titre) between 1 and 200)');
    expect(t).toContain("constraint shopify_produit_collections_collection_id_check check (collection_id ~ '^[0-9]{1,19}$')");
    expect(t).toContain('constraint shopify_produit_collections_titre_check check (char_length(titre) between 1 and 200)');
    expect(t).toContain('constraint shopify_produit_collections_produit_fkey foreign key (tenant_id, produit_id) references shopify_produits (tenant_id, produit_id) on delete cascade');
    expect(t).toContain("constraint shopify_collections_lecture_issue_check check (issue in ('lue', 'sans_droit', 'refusee', 'erreur'))");
    expect(t).toContain('constraint shopify_collections_lecture_message_check check (char_length(message) between 1 and 500)');
    expect(t.match(/tenant_id uuid (not null|primary key) references tenants\(id\) on delete cascade/g)).toHaveLength(2);
    expect(t).toContain('create index if not exists shopify_produit_collections_collection on shopify_produit_collections (tenant_id, collection_id)');
  });

  it('🔴 aucune donnée personnelle : ni téléphone, ni nom de personne, ni adresse, ni commande', () => {
    expect(sansCommentaires(SQL)).not.toMatch(/phone|telephone|e164|\bnom\b|name|adresse|address|email|commande_id|contact_id/i);
  });

  it('🔴 BLOQUANTE : l’effacement du branchement nomme les trois tables, les produits avant leurs collections (l’ordre des verrous de l’écriture)', () => {
    const efface = STORE.slice(STORE.indexOf('async function effacerBranchement('));
    const liste = /for \(const table of \[([\s\S]*?)\]\)/.exec(efface)![1]!;
    const noms = [...liste.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const table of TABLES) expect(noms, table).toContain(table);
    expect(noms.indexOf('shopify_produits')).toBeLessThan(noms.indexOf('shopify_produit_collections'));
  });

  it('🔴 la réservation d’un lot : `for update skip locked` sur les produits à lire dont le bail est libre ou mort, puis un bail et un jeton', async () => {
    const vues: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: async (sql: string, params: unknown[]) => { vues.push({ sql, params }); return { rows: [{ produit_id: '8801' }] }; } };
    const lot = await new PgCollectionsStore(pool as never).reserver('t1', 10);
    const sql = vues[0]!.sql.replace(/\s+/g, ' ');
    expect(sql).toContain('for update skip locked');
    expect(sql).toContain('and (p.bail_jusqua is null or p.bail_jusqua < now())');
    expect(sql).toContain('where p.tenant_id = $1 and (p.collections_lues_le is null or p.collections_lues_le < now() - make_interval(hours => $2))');
    expect(sql).toContain('set bail_jusqua = now() + make_interval(secs => $4), jeton = $5');
    expect(vues[0]!.params).toEqual(['t1', FRAICHEUR_COLLECTIONS_HEURES, 10, BAIL_LOT_SECONDES, lot.jeton]);
    expect(lot).toEqual({ jeton: expect.stringMatching(/^[0-9a-f-]{36}$/), produits: ['8801'] });
  });

  it('🔴 l’écriture d’un lot ne touche que les produits que CE jeton tient encore', async () => {
    const vues: string[] = [];
    const client = { query: async (sql: string) => { vues.push(sql.replace(/\s+/g, ' ')); return { rows: [], rowCount: 0 }; }, release: () => undefined };
    const pool = { connect: async () => client };
    expect(await new PgCollectionsStore(pool as never).ecrire('t1', 'jeton-1', [{ produitId: '8801', titre: 'A', collections: [], incompletes: false }])).toBe(0);
    expect(vues.find((s) => s.startsWith('update shopify_produits'))).toContain('where p.tenant_id = $1 and p.jeton = $2 and p.produit_id = x.produit_id');
    // Aucun produit tenu : aucune collection effacée ni écrite.
    expect(vues.some((s) => /shopify_produit_collections/.test(s))).toBe(false);
  });

  it('🔴 chaque requête du magasin nomme l’espace', () => {
    const requetes = [...MAGASIN.matchAll(/query(?:<[^>]*>)?\(\s*`([\s\S]*?)`/g)].map((m) => m[1]!);
    expect(requetes.length).toBeGreaterThanOrEqual(12);
    // Un filtre sur l'espace, ou une insertion dont l'espace est la première valeur.
    for (const r of requetes) expect(r, r).toMatch(/tenant_id = \$1|^\s*insert into \w+ (as \w+ )?\(tenant_id,[^)]*\)\s*(select \$1,|values \(\$1,)/);
    // Les sous-requêtes aussi : chaque mention d'une table du cache est suivie de son filtre d'espace.
    for (const r of requetes) {
      for (const m of r.matchAll(/(from|join) (shopify_produits|shopify_produit_collections|shopify_commande_lignes|shopify_collections_lecture) (\w+)?/g)) {
        const alias = m[3] && !['where', 'on', 'as', 'set'].includes(m[3]) ? `${m[3]}.` : '';
        expect(r, `${m[0]} dans ${r}`).toContain(`${alias}tenant_id = $1`);
      }
    }
  });
});
