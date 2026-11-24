import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { PgContactStore, type ContactFilters } from '../src/crm/contact-store.pg';
import { FiltreContactInvalide } from '../src/crm/contact-filters';
import { REFUS_SANS_DROIT, REFUS_SANS_LECTURE, refusDesCollections } from '../src/shopify/collections.pg';
import { CLES_SEGMENT as S, filtreSegment } from '../web/lib/partage/segments';

/**
 * 🔴 LE CRITÈRE DE COLLECTION REFUSE, JAMAIS « PERSONNE » (segments Shopify enrichis, lot 6a) : sans lecture aboutie des
 * collections de l'espace, ou pour une collection pas connue à la dernière lecture, CHAQUE lecture par filtres du magasin
 * des contacts lève `FiltreContactInvalide` (400 aux routes, refus de l'outil au MCP) AVANT de lire une seule fiche. Une
 * campagne vide prise pour une vérité est l'accident qu'on évite. La preuve sur une vraie base :
 * `tests/integration/shopify-collections.integration.test.ts`.
 */
const T = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const COLLECTION = (ids: string[], jours?: number): ContactFilters => ({
  fieldFilters: [filtreSegment(S.collection, { collections: ids, ...(jours !== undefined ? { jours } : {}) })],
});

/** Un faux pool : l'état de la lecture et les collections connues ; il garde chaque requête, et refuse de lire les fiches. */
function pool(o: { etat?: { lue_le: Date | null; issue: string | null } | null; connues?: string[] } = {}) {
  const requetes: Array<{ sql: string; params: unknown[] }> = [];
  const p = {
    query: async (sql: string, params: unknown[] = []) => {
      requetes.push({ sql, params });
      // Les fiches d'abord : leur WHERE nomme les tables du cache dans ses sous-requêtes.
      if (FICHES.test(sql)) return { rows: [], rowCount: 0 };
      if (/from shopify_collections_lecture/.test(sql)) return { rows: o.etat === undefined || o.etat === null ? [] : [o.etat] };
      if (/from shopify_produit_collections/.test(sql)) {
        const ids = params[1] as string[];
        return { rows: (o.connues ?? []).filter((c) => ids.includes(c)).map((c) => ({ collection_id: c })) };
      }
      throw new Error(`requête inattendue : ${sql}`);
    },
  };
  return { pool: p as unknown as Pool, requetes, fiches: () => requetes.filter((r) => FICHES.test(r.sql)) };
}

const LUE = { lue_le: new Date('2026-11-24T08:00:00Z'), issue: 'lue' };
/** Une lecture ou une écriture des FICHES (jamais une requête de la garde). */
const FICHES = /from contacts where|update contacts set/;

describe('la garde du critère de collection', () => {
  it('🔴 aucune lecture aboutie : refusé, avec la phrase qui dit comment la lancer ; le droit manquant le dit', async () => {
    expect(await refusDesCollections(pool().pool, T, ['4401'])).toBe(REFUS_SANS_LECTURE);
    expect(await refusDesCollections(pool({ etat: { lue_le: null, issue: null } }).pool, T, ['4401'])).toBe(REFUS_SANS_LECTURE);
    expect(await refusDesCollections(pool({ etat: { lue_le: null, issue: 'sans_droit' } }).pool, T, ['4401'])).toBe(REFUS_SANS_DROIT);
    expect(REFUS_SANS_DROIT).toContain('read_products');
  });

  it('🔴 une collection inconnue à la dernière lecture est nommée, avec la date de la lecture ; connues, rien', async () => {
    expect(await refusDesCollections(pool({ etat: LUE, connues: ['4401'] }).pool, T, ['4401'])).toBeNull();
    expect(await refusDesCollections(pool({ etat: LUE, connues: ['4401'] }).pool, T, ['4401', '4499']))
      .toMatch(/la collection 4499 n’est pas connue, aucun produit commandé ne s’y trouvait à la lecture du 2026-11-24/);
    expect(await refusDesCollections(pool({ etat: LUE }).pool, T, ['4498', '4499'])).toMatch(/les collections 4498, 4499 ne sont pas connues/);
  });

  it('🔴 chaque requête de la garde nomme l’espace ; aucune collection visée, aucune requête', async () => {
    const p = pool({ etat: LUE, connues: ['4401'] });
    await refusDesCollections(p.pool, T, ['4401']);
    expect(p.requetes).toHaveLength(2);
    for (const r of p.requetes) {
      expect(r.sql).toMatch(/where (collection_id = any\(\$2::text\[\]\) and )?tenant_id = \$1|where tenant_id = \$1/);
      expect(r.params[0]).toBe(T);
    }
    const vide = pool();
    expect(await refusDesCollections(vide.pool, T, [])).toBeNull();
    expect(vide.requetes).toEqual([]);
  });

  /** Chaque lecture par filtres du magasin, avec la cible de collection. */
  const lectures: Array<[string, (c: PgContactStore, f: ContactFilters) => Promise<unknown>]> = [
    ['query', (c, f) => c.query(T, f)],
    ['count', (c, f) => c.count(T, f)],
    ['idsForFilters', (c, f) => c.idsForFilters(T, f)],
    ['applyEditsMany', (c, f) => c.applyEditsMany(T, { filters: f }, { addTags: ['vip'] })],
    ['contactIdsForTarget', (c, f) => c.contactIdsForTarget(T, { filters: f })],
    ['selectionAEffacer', (c, f) => c.selectionAEffacer(T, { filters: f }, 10)],
  ];

  it.each(lectures)('🔴 %s : refusé AVANT de lire une seule fiche, sans lecture aboutie ou pour une collection inconnue', async (_nom, lire) => {
    for (const o of [{}, { etat: { lue_le: null, issue: 'sans_droit' } }, { etat: LUE, connues: ['4401'] }]) {
      const p = pool(o);
      await expect(lire(new PgContactStore(p.pool), COLLECTION(['4401', '4499'])), JSON.stringify(o)).rejects.toThrow(FiltreContactInvalide);
      expect(p.fiches()).toEqual([]);
    }
  });

  it.each(lectures)('%s : connues, la lecture passe ; sans critère de collection, la garde ne lit rien', async (_nom, lire) => {
    const p = pool({ etat: LUE, connues: ['4401'] });
    await lire(new PgContactStore(p.pool), COLLECTION(['4401'], 30));
    expect(p.fiches().length).toBeGreaterThan(0);
    const sansCritere = pool();
    await lire(new PgContactStore(sansCritere.pool), { tags: ['vip'] });
    expect(sansCritere.requetes.filter((r) => /shopify_/.test(r.sql))).toEqual([]);
  });

  it('🔴 aucune lecture du magasin n’esquive la garde : `buildContactWhere` et `buildBulkSelector` ne s’appellent que par elle', () => {
    const source = readFileSync(new URL('../src/crm/contact-store.pg.ts', import.meta.url), 'utf8');
    // Le CODE de la classe, sans ses commentaires (qui citent ces fonctions), jusqu'aux fonctions elles-mêmes.
    const corps = source.slice(0, source.indexOf('export function buildContactWhere('))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s+/g, ' ');
    // Dans la classe, un seul appel de chacun, dans les deux passages gardés.
    expect(corps.match(/buildContactWhere\(/g)).toHaveLength(1);
    expect(corps.match(/buildBulkSelector\(/g)).toHaveLength(1);
    expect(corps).toContain('await this.exigerCollectionsConnues(tenantId, filters); return buildContactWhere(tenantId, filters);');
    expect(corps).toContain("if ('filters' in target) await this.exigerCollectionsConnues(tenantId, target.filters); return buildBulkSelector(tenantId, target);");
  });
});
