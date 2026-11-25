import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { PgContactStore, buildContactWhere, type ContactFilters } from '../src/crm/contact-store.pg';
import { FiltreContactInvalide, normalizeFieldFilters } from '../src/crm/contact-filters';
import { refusDesSegmentsShopify } from '../src/shopify/etiquettes-garde';
import { segmentsShopifyDesFiltres } from '../src/crm/segments';
import { BORNES_SEGMENTS, CLES_SEGMENT as S, filtreSegment } from '../web/lib/partage/segments';

/**
 * 🔴 LE CRITÈRE DE SEGMENT SHOPIFY REFUSE, JAMAIS « PERSONNE » (segments Shopify enrichis, lot 6c) : un segment visé
 * inconnu de l'espace, disparu chez Shopify, qui n'est plus suivi ou dont les membres n'ont jamais été lus fait lever
 * `FiltreContactInvalide` à CHAQUE lecture par filtres du magasin des contacts, AVANT de lire une seule fiche, en le
 * nommant. La preuve sur une vraie base : `tests/integration/shopify-etiquettes.integration.test.ts`.
 */
const T = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const SEGMENT = (segments: string[], mode: 'toutes' | 'une' = 'toutes'): ContactFilters => ({
  fieldFilters: [filtreSegment(S.segmentShopify, { segments, mode })],
});
interface Ligne { segment_id: string; nom: string; suivi: boolean; absent: boolean; lu: boolean }
const LU = (segment_id: string, nom = `S${segment_id}`): Ligne => ({ segment_id, nom, suivi: true, absent: false, lu: true });

/** Un faux pool : les segments connus de l'espace ; il garde chaque requête, et rend des fiches vides. */
function pool(segments: Ligne[] = []) {
  const requetes: Array<{ sql: string; params: unknown[] }> = [];
  const p = {
    query: async (sql: string, params: unknown[] = []) => {
      requetes.push({ sql, params });
      if (FICHES.test(sql)) return { rows: [], rowCount: 0 };
      if (/from shopify_segments s where/.test(sql)) {
        const ids = params[1] as string[];
        return { rows: segments.filter((x) => ids.includes(x.segment_id)) };
      }
      throw new Error(`requête inattendue : ${sql}`);
    },
  };
  return { pool: p as unknown as Pool, requetes, fiches: () => requetes.filter((r) => FICHES.test(r.sql)) };
}
const FICHES = /from contacts where|update contacts set/;

describe('la garde du critère de segment Shopify', () => {
  it('🔴 inconnu, disparu, plus suivi, jamais lu : refusé, en nommant le segment et le geste qui le débloque', async () => {
    expect(await refusDesSegmentsShopify(pool().pool, T, ['11'])).toMatch(/le segment 11 n’est pas connu de cet espace.*sync_shopify_customer_tags/);
    expect(await refusDesSegmentsShopify(pool([{ ...LU('11', 'VIP'), absent: true }]).pool, T, ['11'])).toMatch(/« VIP » n’existe plus dans la boutique Shopify/);
    expect(await refusDesSegmentsShopify(pool([{ ...LU('11', 'VIP'), suivi: false }]).pool, T, ['11'])).toMatch(/« VIP » n’est pas suivi\. Choisissez-le sur la carte Shopify/);
    expect(await refusDesSegmentsShopify(pool([{ ...LU('11', 'VIP'), lu: false }]).pool, T, ['11'])).toMatch(/membres du segment « VIP » n’ont pas encore été lus/);
    // Un seul segment fautif parmi plusieurs suffit à refuser.
    expect(await refusDesSegmentsShopify(pool([LU('11'), { ...LU('12', 'Hiver'), lu: false }]).pool, T, ['11', '12'])).toMatch(/« Hiver »/);
  });

  it('🔴 suivi et lu : le critère s’applique ; la requête nomme l’espace ; aucun segment visé, aucune requête', async () => {
    const p = pool([LU('11'), LU('12')]);
    expect(await refusDesSegmentsShopify(p.pool, T, ['11', '12'])).toBeNull();
    expect(p.requetes).toHaveLength(1);
    expect(p.requetes[0]!.sql).toMatch(/where s\.tenant_id = \$1 and s\.segment_id = any\(\$2::text\[\]\)/);
    expect(p.requetes[0]!.params).toEqual([T, ['11', '12']]);
    const vide = pool();
    expect(await refusDesSegmentsShopify(vide.pool, T, [])).toBeNull();
    expect(vide.requetes).toEqual([]);
  });

  const lectures: Array<[string, (c: PgContactStore, f: ContactFilters) => Promise<unknown>]> = [
    ['query', (c, f) => c.query(T, f)],
    ['count', (c, f) => c.count(T, f)],
    ['idsForFilters', (c, f) => c.idsForFilters(T, f)],
    ['applyEditsMany', (c, f) => c.applyEditsMany(T, { filters: f }, { addTags: ['vip'] })],
    ['contactIdsForTarget', (c, f) => c.contactIdsForTarget(T, { filters: f })],
    ['selectionAEffacer', (c, f) => c.selectionAEffacer(T, { filters: f }, 10)],
  ];

  it.each(lectures)('🔴 %s : refusé AVANT de lire une seule fiche, pour un segment pas encore lu', async (_nom, lire) => {
    const p = pool([{ ...LU('11'), lu: false }]);
    await expect(lire(new PgContactStore(p.pool), SEGMENT(['11']))).rejects.toThrow(FiltreContactInvalide);
    expect(p.fiches()).toEqual([]);
  });

  it.each(lectures)('%s : lu, la lecture passe ; sans critère de segment, la garde ne lit rien', async (_nom, lire) => {
    const p = pool([LU('11'), LU('12')]);
    await lire(new PgContactStore(p.pool), SEGMENT(['11', '12'], 'une'));
    expect(p.fiches().length).toBeGreaterThan(0);
    const sansCritere = pool();
    await lire(new PgContactStore(sansCritere.pool), { tags: ['VIP'] });
    expect(sansCritere.requetes.filter((r) => /shopify_/.test(r.sql))).toEqual([]);
  });
});

describe('le critère de segment Shopify en SQL et sa validation', () => {
  const ou = (f: ContactFilters) => buildContactWhere('t1', f);

  it('🔴 « tous » : une sous-requête par segment, jointes par « and » ; « l’un d’eux » : une seule ; l’espace toujours nommé', () => {
    const tous = ou(SEGMENT(['11', '12']));
    expect(tous.where.replace(/\s+/g, ' ')).toContain('(id in (select m.contact_id from shopify_segment_membres m where m.tenant_id = $1 and m.segment_id in ($2)) '
      + 'and id in (select m.contact_id from shopify_segment_membres m where m.tenant_id = $1 and m.segment_id in ($3)))');
    expect(tous.params).toEqual(['t1', '11', '12']);
    const un = ou(SEGMENT(['11', '12'], 'une'));
    expect(un.where.replace(/\s+/g, ' ')).toContain('id in (select m.contact_id from shopify_segment_membres m where m.tenant_id = $1 and m.segment_id in ($2, $3))');
    // Jamais les étiquettes, ni celles de Messaging Me, ni celles de Shopify.
    expect(tous.where).not.toMatch(/\btags\b|shopify_etiquettes/);
  });

  it('🔴 une valeur qui ne se lit pas vise personne, jamais tout l’espace', () => {
    for (const value of ['{"segments":[],"mode":"toutes"}', '{pas du json', '{"segments":["11"]}', '{"segments":["11"],"mode":"aucune"}', '["11"]', '{"segments":["abc"],"mode":"une"}']) {
      expect(buildContactWhere('t1', { fieldFilters: [{ key: S.segmentShopify, op: 'segment', value }] }).where.split(' and '), value).toContain('false');
    }
  });

  it('🔴 la validation : 1 à 20 identifiants en chiffres, dédupliqués, le mode, aucune autre clé ; refusée en le nommant', () => {
    const lu = normalizeFieldFilters([{ key: S.segmentShopify, op: 'segment', value: JSON.stringify({ segments: ['11', ' 11 ', '12'], mode: 'une' }) }]);
    expect(lu).toEqual([filtreSegment(S.segmentShopify, { segments: ['11', '12'], mode: 'une' })]);
    expect(segmentsShopifyDesFiltres(lu)).toEqual(['11', '12']);
    const refuse = (valeur: unknown) => () => normalizeFieldFilters([{ key: S.segmentShopify, op: 'segment', value: JSON.stringify(valeur) }]);
    expect(refuse({ segments: [], mode: 'toutes' })).toThrow(/segment Shopify.*au moins un segment/);
    expect(refuse({ segments: Array.from({ length: BORNES_SEGMENTS.segmentsShopifyMax + 1 }, (_, i) => String(i + 1)) })).toThrow(/20 segments au plus/);
    expect(refuse({ segments: ['gid://shopify/Segment/11'] })).toThrow(/en chiffres/);
    expect(refuse({ segments: ['11'], mode: 'aucune' })).toThrow(/« mode »/);
    expect(refuse({ segments: ['11'], jours: 3 })).toThrow(/clé inconnue \(jours\)/);
    expect(refuse(['11'])).toThrow(/un objet \{ segments, mode \}/);
  });
});
