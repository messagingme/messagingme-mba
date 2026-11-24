import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { PgContactStore, buildContactWhere, type ContactFilters } from '../src/crm/contact-store.pg';
import { FiltreContactInvalide, normalizeFieldFilters } from '../src/crm/contact-filters';
import { REFUS_SANS_SYNCHRO, REFUS_SYNCHRO_EN_COURS, refusDesEtiquettesShopify } from '../src/shopify/etiquettes-garde';
import { etiquettesShopifyDesFiltres } from '../src/crm/segments';
import { CLES_SEGMENT as S, filtreSegment } from '../web/lib/partage/segments';

/**
 * 🔴 LE CRITÈRE D'ÉTIQUETTE SHOPIFY REFUSE, JAMAIS « PERSONNE » (segments Shopify enrichis, lot 6b) : sans synchronisation
 * aboutie des étiquettes de l'espace, CHAQUE lecture par filtres du magasin des contacts lève `FiltreContactInvalide` (400
 * aux routes, refus de l'outil au MCP) AVANT de lire une seule fiche. Une synchronisation aboutie, même à zéro fiche, et le
 * critère s'applique. La preuve sur une vraie base : `tests/integration/shopify-etiquettes.integration.test.ts`.
 */
const T = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const ETIQUETTE = (etiquettes: string[], mode: 'toutes' | 'une' = 'toutes'): ContactFilters => ({
  fieldFilters: [filtreSegment(S.etiquetteShopify, { etiquettes, mode })],
});

/** Un faux pool : l'état de la synchronisation ; il garde chaque requête, et rend des fiches vides. */
function pool(etat?: { synchro_le: Date | null; vivante: boolean; issue: string | null; message: string | null } | null) {
  const requetes: Array<{ sql: string; params: unknown[] }> = [];
  const p = {
    query: async (sql: string, params: unknown[] = []) => {
      requetes.push({ sql, params });
      if (FICHES.test(sql)) return { rows: [], rowCount: 0 };
      if (/from shopify_etiquettes_synchro/.test(sql)) return { rows: etat === undefined || etat === null ? [] : [etat] };
      throw new Error(`requête inattendue : ${sql}`);
    },
  };
  return { pool: p as unknown as Pool, requetes, fiches: () => requetes.filter((r) => FICHES.test(r.sql)) };
}

const LUE = { synchro_le: new Date('2026-11-24T08:00:00Z'), vivante: false, issue: 'lue', message: null };
/** Une lecture ou une écriture des FICHES (jamais une requête de la garde). */
const FICHES = /from contacts where|update contacts set/;

describe('la garde du critère d’étiquette Shopify', () => {
  it('🔴 aucune synchronisation aboutie : refusé, avec la phrase qui dit où l’allumer ; en cours, ou en échec, la phrase le dit', async () => {
    expect(await refusDesEtiquettesShopify(pool().pool, T, ['VIP'])).toBe(REFUS_SANS_SYNCHRO);
    expect(await refusDesEtiquettesShopify(pool({ synchro_le: null, vivante: false, issue: null, message: null }).pool, T, ['VIP'])).toBe(REFUS_SANS_SYNCHRO);
    expect(await refusDesEtiquettesShopify(pool({ synchro_le: null, vivante: true, issue: null, message: null }).pool, T, ['VIP'])).toBe(REFUS_SYNCHRO_EN_COURS);
    expect(await refusDesEtiquettesShopify(pool({ synchro_le: null, vivante: false, issue: 'sans_droit', message: 'manque read_customers' }).pool, T, ['VIP']))
      .toMatch(/a échoué \(manque read_customers\)/);
    expect(REFUS_SANS_SYNCHRO).toContain('sync_shopify_customer_tags');
  });

  it('🔴 une synchronisation aboutie : le critère s’applique, même à une étiquette que personne ne porte, et même si la dernière a échoué', async () => {
    expect(await refusDesEtiquettesShopify(pool(LUE).pool, T, ['Inconnue'])).toBeNull();
    expect(await refusDesEtiquettesShopify(pool({ ...LUE, issue: 'refusee', message: 'm' }).pool, T, ['VIP'])).toBeNull();
  });

  it('🔴 la requête de la garde nomme l’espace ; aucune étiquette visée, aucune requête', async () => {
    const p = pool(LUE);
    await refusDesEtiquettesShopify(p.pool, T, ['VIP']);
    expect(p.requetes).toHaveLength(1);
    expect(p.requetes[0]!.sql).toMatch(/where e\.tenant_id = \$1$/);
    expect(p.requetes[0]!.params).toEqual([T]);
    const vide = pool();
    expect(await refusDesEtiquettesShopify(vide.pool, T, [])).toBeNull();
    expect(vide.requetes).toEqual([]);
  });

  /** Chaque lecture par filtres du magasin, avec la cible d'étiquette Shopify. */
  const lectures: Array<[string, (c: PgContactStore, f: ContactFilters) => Promise<unknown>]> = [
    ['query', (c, f) => c.query(T, f)],
    ['count', (c, f) => c.count(T, f)],
    ['idsForFilters', (c, f) => c.idsForFilters(T, f)],
    ['applyEditsMany', (c, f) => c.applyEditsMany(T, { filters: f }, { addTags: ['vip'] })],
    ['contactIdsForTarget', (c, f) => c.contactIdsForTarget(T, { filters: f })],
    ['selectionAEffacer', (c, f) => c.selectionAEffacer(T, { filters: f }, 10)],
  ];

  it.each(lectures)('🔴 %s : refusé AVANT de lire une seule fiche, sans synchronisation aboutie', async (_nom, lire) => {
    for (const etat of [null, { synchro_le: null, vivante: true, issue: null, message: null }, { synchro_le: null, vivante: false, issue: 'erreur', message: 'x' }]) {
      const p = pool(etat);
      await expect(lire(new PgContactStore(p.pool), ETIQUETTE(['VIP'])), JSON.stringify(etat)).rejects.toThrow(FiltreContactInvalide);
      expect(p.fiches()).toEqual([]);
    }
  });

  it.each(lectures)('%s : synchronisée, la lecture passe ; sans critère d’étiquette Shopify, la garde ne lit rien', async (_nom, lire) => {
    const p = pool(LUE);
    await lire(new PgContactStore(p.pool), ETIQUETTE(['VIP', 'Grossiste'], 'une'));
    expect(p.fiches().length).toBeGreaterThan(0);
    const sansCritere = pool();
    await lire(new PgContactStore(sansCritere.pool), { tags: ['VIP'] });
    expect(sansCritere.requetes.filter((r) => /shopify_/.test(r.sql))).toEqual([]);
  });
});

describe('le critère d’étiquette Shopify en SQL', () => {
  const ou = (f: ContactFilters) => buildContactWhere('t1', f);

  it('🔴 « toutes » : une sous-requête par étiquette, jointes par « and » ; « une » : une seule ; l’espace toujours nommé, sans la casse', () => {
    const toutes = ou(ETIQUETTE(['VIP', 'Grossiste']));
    const compact = toutes.where.replace(/\s+/g, ' ');
    expect(compact).toContain('(id in (select e.contact_id from shopify_etiquettes e where e.tenant_id = $1 and lower(e.etiquette) in (lower($2))) '
      + 'and id in (select e.contact_id from shopify_etiquettes e where e.tenant_id = $1 and lower(e.etiquette) in (lower($3))))');
    expect(toutes.params).toEqual(['t1', 'VIP', 'Grossiste']);
    const une = ou(ETIQUETTE(['VIP', 'Grossiste'], 'une'));
    expect(une.where.replace(/\s+/g, ' ')).toContain('id in (select e.contact_id from shopify_etiquettes e where e.tenant_id = $1 and lower(e.etiquette) in (lower($2), lower($3)))');
  });

  it('🔴 jamais les étiquettes Messaging Me : le critère ne lit pas `tags`, et le filtre `tags` ne lit pas les étiquettes Shopify', () => {
    const shopify = ou(ETIQUETTE(['VIP'])).where;
    expect(shopify).not.toMatch(/\btags\b/);
    expect(ou({ tags: ['VIP'] }).where).not.toMatch(/shopify_etiquettes/);
  });

  it('🔴 une valeur qui ne se lit pas vise personne, jamais tout l’espace', () => {
    for (const value of ['{"etiquettes":[],"mode":"toutes"}', '{pas du json', '{"etiquettes":["VIP"]}', '{"etiquettes":["VIP"],"mode":"aucune"}', '["VIP"]', '{"etiquettes":[""],"mode":"une"}']) {
      expect(buildContactWhere('t1', { fieldFilters: [{ key: S.etiquetteShopify, op: 'segment', value }] }).where.split(' and '), value).toContain('false');
    }
  });

  it('🔴 une étiquette Shopify qui s’appelle comme une clé réservée n’est qu’une donnée : elle ne pose aucun autre critère', () => {
    const lu = normalizeFieldFilters([{ key: S.etiquetteShopify, op: 'segment', value: JSON.stringify({ etiquettes: [S.commandes, 'segment_pays'], mode: 'une' }) }]);
    expect(lu.map((f) => f.key)).toEqual([S.etiquetteShopify]);
    const { where, params } = buildContactWhere('t1', { fieldFilters: lu });
    expect(where).not.toMatch(/shopify_commandes|phone_e164 like/);
    expect(params).toEqual(['t1', S.commandes, 'segment_pays']);
    expect(etiquettesShopifyDesFiltres(lu)).toEqual([S.commandes, 'segment_pays']);
  });
});
