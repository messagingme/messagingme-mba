import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';
import { BAIL_SYNCHRO_SECONDES, PgEtiquettesStore } from '../src/shopify/etiquettes.pg';
import { BORNES_SEGMENTS } from '../web/lib/partage/segments';
import { ficheAvecEtiquetteShopify } from '../src/crm/segments';

/**
 * 0319 : les étiquettes des clients Shopify (segments Shopify enrichis, lot 6b). Quatre tables neuves et un index, dans une
 * transaction, `lock_timeout` en tête, aucune table existante modifiée. 🔴 BLOQUANTE : `effacerBranchement` et `purgeMany`
 * nomment les tables (le même test le vérifie dans le code), elle part SEULE, avant le code. 🔴 Les tables de la fiche
 * cascadent avec elle. 🔴 Toutes les requêtes du magasin nomment l'espace ; la réservation est un bail pris sans attendre.
 * 🔴 Aucune requête du magasin n'écrit les étiquettes Messaging Me (`contacts.tags`).
 */
const SQL = readFileSync(new URL('../db/migrations/0319_shopify_etiquettes.sql', import.meta.url), 'utf8');
const MAGASIN = readFileSync(new URL('../src/shopify/etiquettes.pg.ts', import.meta.url), 'utf8');
const GARDE = readFileSync(new URL('../src/shopify/etiquettes-garde.ts', import.meta.url), 'utf8');
const STORE = readFileSync(new URL('../src/shopify/store.pg.ts', import.meta.url), 'utf8');
const CONTACTS = readFileSync(new URL('../src/crm/contact-store.pg.ts', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');
const TABLES_FICHE = ['shopify_clients', 'shopify_fiches_cherchees', 'shopify_etiquettes'];
const TABLES = ['shopify_etiquettes_synchro', ...TABLES_FICHE];

describe('migration 0319', () => {
  it('🔴 le plafond d’attente du verrou vient en tête, dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('🔴 quatre tables neuves et l’index du critère, rien d’autre (aucune table existante modifiée)', () => {
    expect(instructions.slice(1).map((i) => i.split(' (')[0])).toEqual([
      'create table if not exists shopify_clients',
      'create table if not exists shopify_etiquettes',
      'create index if not exists shopify_etiquettes_etiquette on shopify_etiquettes',
      'create table if not exists shopify_fiches_cherchees',
      'create table if not exists shopify_etiquettes_synchro',
    ]);
    expect(sansCommentaires(SQL)).not.toMatch(/alter table|drop /i);
  });

  it('🔴 les contraintes sous des noms lisibles ; un client par fiche et une fiche par client ; la borne de Shopify', () => {
    const t = sansCommentaires(SQL).replace(/\s+/g, ' ');
    expect(t).toContain("constraint shopify_clients_client_id_check check (client_id ~ '^[0-9]{1,19}$')");
    expect(t).toContain('primary key (tenant_id, client_id), constraint shopify_clients_contact_key unique (tenant_id, contact_id)');
    expect(t).toContain(`constraint shopify_etiquettes_etiquette_check check (char_length(etiquette) between 1 and ${BORNES_SEGMENTS.etiquetteShopifyMax})`);
    expect(t).toContain('primary key (tenant_id, contact_id, etiquette)');
    expect(t).toContain("constraint shopify_etiquettes_synchro_issue_check check (issue in ('lue', 'sans_droit', 'refusee', 'erreur'))");
    expect(t).toContain('constraint shopify_etiquettes_synchro_message_check check (char_length(message) between 1 and 500)');
    expect(t).toContain("constraint shopify_etiquettes_synchro_curseur_check check (curseur ~ '^[0-9]{1,19}$')");
    expect(t).toContain('allumee boolean not null default false');
  });

  it('🔴 les trois tables de la fiche cascadent avec elle ; chaque table avec l’espace', () => {
    const t = sansCommentaires(SQL).replace(/\s+/g, ' ');
    for (const table of TABLES_FICHE) {
      expect(t, table).toContain(`contact_id uuid not null constraint ${table}_contact_id_fkey references contacts(id) on delete cascade`);
    }
    expect(t.match(/tenant_id uuid (not null|primary key) references tenants\(id\) on delete cascade/g)).toHaveLength(4);
  });

  it('🔴 l’index du critère : son expression est celle de la requête, mot pour mot', () => {
    const t = sansCommentaires(SQL).replace(/\s+/g, ' ');
    expect(t).toContain('create index if not exists shopify_etiquettes_etiquette on shopify_etiquettes (tenant_id, lower(etiquette))');
    const clause = ficheAvecEtiquetteShopify(['VIP'], () => '$2').replace(/\s+/g, ' ');
    expect(clause).toBe('id in (select e.contact_id from shopify_etiquettes e where e.tenant_id = $1 and lower(e.etiquette) in (lower($2)))');
  });

  it('🔴 aucune donnée de personne au-delà du lien : ni téléphone, ni nom, ni adresse, ni commande (un compte n’en est pas une)', () => {
    // `trouves_par_telephone` est un compte : la frontière de mot (`_` en est une lettre) ne le prend pas pour un téléphone.
    expect(sansCommentaires(SQL)).not.toMatch(/\bphone|\btelephone|e164|\bnom\b|name|adresse|address|email|commande_id/i);
  });

  it('🔴 BLOQUANTE : l’effacement du branchement nomme les quatre tables, l’état de la synchronisation avant ses données', () => {
    const efface = STORE.slice(STORE.indexOf('async function effacerBranchement('));
    const liste = /for \(const table of \[([\s\S]*?)\]\)/.exec(efface)![1]!;
    const noms = [...liste.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    for (const table of TABLES) expect(noms, table).toContain(table);
    // L'ordre des verrous de chaque écriture de la synchronisation : la ligne d'état d'abord.
    for (const table of TABLES_FICHE) expect(noms.indexOf('shopify_etiquettes_synchro')).toBeLessThan(noms.indexOf(table));
  });

  it('🔴 BLOQUANTE : la purge d’une fiche nomme les trois tables de la fiche, par l’espace et les fiches purgées', () => {
    const purge = CONTACTS.slice(CONTACTS.indexOf('async purgeMany('));
    for (const table of TABLES_FICHE) {
      expect(purge, table).toContain(`delete from ${table} where tenant_id = $1 and contact_id = any($2::uuid[])`);
    }
  });

  it('🔴 la réservation : un bail pris sans attendre (`for update skip locked`) sur une synchronisation commencée dont le bail est libre ou mort', async () => {
    const vues: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: async (sql: string, params: unknown[]) => { vues.push({ sql, params }); return { rows: [{ jeton: 'j1', curseur: null }] }; } };
    expect(await new PgEtiquettesStore(pool as never).prendre('t1')).toEqual({ jeton: 'j1', curseur: null });
    const sql = vues[0]!.sql.replace(/\s+/g, ' ');
    expect(sql).toContain('where tenant_id = $1 and en_cours_depuis is not null and (bail_jusqua is null or bail_jusqua < now()) for update skip locked');
    expect(sql).toContain('set jeton = gen_random_uuid(), bail_jusqua = now() + make_interval(secs => $2)');
    expect(vues[0]!.params).toEqual(['t1', BAIL_SYNCHRO_SECONDES]);
  });

  it('🔴 chaque écriture verrouille d’abord la ligne d’état PAR SON JETON, puis les fiches actives ; sans le jeton, rien ne s’écrit', async () => {
    for (const ecrire of [
      (m: PgEtiquettesStore) => m.ecrireClients('t1', 'jeton-1', { lus: [{ clientId: '1001', etiquettes: ['VIP'] }], curseur: '1001' }),
      (m: PgEtiquettesStore) => m.ecrireRecherche('t1', 'jeton-1', { cherchees: ['c1'], trouves: [{ contactId: 'c1', clientId: '1001', etiquettes: ['VIP'] }], complete: true }),
    ]) {
      const vues: string[] = [];
      const client = {
        query: async (sql: string) => { vues.push(sql.replace(/\s+/g, ' ')); return { rows: [], rowCount: 0 }; }, release: () => undefined,
      };
      const r = await ecrire(new PgEtiquettesStore({ connect: async () => client } as never));
      expect(r === false || r === null).toBe(true);
      const ecritures = vues.filter((s) => !/^(begin|commit|rollback)/.test(s));
      expect(ecritures).toEqual(['select 1 from shopify_etiquettes_synchro where tenant_id = $1 and jeton = $2 for update']);
    }
    // Les fiches : actives, de l'espace, verrouillées contre une purge (`for key share`).
    expect(MAGASIN.replace(/\s+/g, ' ')).toContain(
      'select x.id from contacts x where x.tenant_id = $1 and x.id = any($2::uuid[]) and ${ficheActive(\'x\')} order by x.id for key share',
    );
  });

  it('🔴 chaque requête du magasin et de la garde nomme l’espace (une seule exception transverse : le balayage des espaces allumés)', () => {
    const requetes = [...`${MAGASIN}\n${GARDE}`.matchAll(/query(?:<[^>]*>)?\(\s*`([\s\S]*?)`/g)].map((m) => m[1]!);
    expect(requetes.length).toBeGreaterThanOrEqual(20);
    const transverses = requetes.filter((r) => !/tenant_id = \$1|^\s*insert into \w+ (as \w+ )?\(tenant_id[,)]/.test(r));
    expect(transverses).toHaveLength(1);
    expect(transverses[0]).toMatch(/^\s*with dues as/);
    expect(transverses[0]).toContain('join shopify_boutiques b on b.tenant_id = e.tenant_id');
    expect(transverses[0]).toContain('where e.allumee and');
    // Les sous-requêtes aussi : chaque mention d'une table de l'espace est suivie de son filtre d'espace.
    for (const r of requetes.filter((x) => x !== transverses[0])) {
      for (const m of r.matchAll(/(from|join) (shopify_clients|shopify_etiquettes|shopify_fiches_cherchees|shopify_etiquettes_synchro|shopify_commandes|contacts) (\w+)?/g)) {
        const alias = m[3] && !['where', 'on', 'as', 'set', 'select'].includes(m[3]) ? `${m[3]}.` : '';
        expect(r, `${m[0]} dans ${r}`).toContain(`${alias}tenant_id = $1`);
      }
    }
  });

  it('🔴 jamais les étiquettes Messaging Me : aucune requête du magasin n’écrit `contacts`', () => {
    const requetes = [...MAGASIN.matchAll(/query(?:<[^>]*>)?\(\s*`([\s\S]*?)`/g)].map((m) => m[1]!.replace(/\s+/g, ' '));
    for (const r of requetes) {
      expect(r, r).not.toMatch(/update contacts|insert into contacts|delete from contacts/);
    }
    expect(MAGASIN).not.toMatch(/tags\s*=|array_append|array_cat/);
  });
});
