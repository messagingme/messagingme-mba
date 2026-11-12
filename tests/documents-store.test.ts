import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { PgDocumentsContact, CONSERVATION_DOCUMENTS_JOURS, CHAMP_DOCUMENT } from '../src/documents/store.pg';
import type { MagasinObjets } from '../src/lib/magasin-objets';

/**
 * LA FIN DE VIE DES PDF RECOPIÉS DE HUBSPOT (lot A du plan `docs/superpowers/plans/2026-11-12-pdf-par-contact-hubspot.md`).
 * Ce que le SQL réel prouve vit dans `tests/integration/purge-rgpd.integration.test.ts` ; ici, l'ORDRE : l'objet au bucket
 * d'abord, la ligne ensuite, et un objet qui résiste garde sa ligne.
 */
function fauxPool(lignes: Array<{ tenant_id: string; code: string; cle_objet: string }>, journal: string[] = []) {
  const requetes: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      requetes.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (!sql.trim().startsWith('select')) journal.push(sql.trim().startsWith('update') ? 'champ' : 'ligne');
      return sql.trim().startsWith('select') ? { rows: lignes, rowCount: lignes.length } : { rows: [], rowCount: 0 };
    },
  };
  return { pool: pool as unknown as Pool, requetes };
}

const L1 = { tenant_id: 't1', code: 'doc_a', cle_objet: 'tenants/t1/documents/doc_a.pdf' };
const L2 = { tenant_id: 't1', code: 'doc_b', cle_objet: 'tenants/t1/documents/doc_b.pdf' };

describe('PgDocumentsContact.purgerEchus', () => {
  it('🔴 30 jours, et les lignes marquées par la purge RGPD', async () => {
    const { pool, requetes } = fauxPool([]);
    await new PgDocumentsContact(pool, { effacer: async () => {} } as unknown as MagasinObjets).purgerEchus(10);
    expect(CONSERVATION_DOCUMENTS_JOURS).toBe(30);
    expect(requetes[0]!.sql).toContain('a_effacer_le is not null or cree_le <= now() - make_interval(days => $2::int)');
    expect(requetes[0]!.params).toEqual([10, 30]);
  });

  it('🔴 l’objet PUIS la ligne ; le champ de la fiche vidé avec elle', async () => {
    const journal: string[] = [];
    const { pool, requetes } = fauxPool([L1, L2], journal);
    const magasin = { effacer: async (cle: string) => { journal.push(`objet:${cle}`); } } as unknown as MagasinObjets;
    expect(await new PgDocumentsContact(pool, magasin).purgerEchus(10)).toBe(2);
    expect(journal).toEqual([`objet:${L1.cle_objet}`, `objet:${L2.cle_objet}`, 'champ', 'ligne']);
    const champ = requetes.find((r) => r.sql.startsWith('update contacts'))!;
    expect(champ.params[1]).toBe(CHAMP_DOCUMENT);
    expect(champ.sql).toContain('c.tenant_id = x.tenant_id and c.fields @> jsonb_build_object($2::text, x.code)');
  });

  it('🔴 un objet qui résiste GARDE sa ligne, et la passe lève pour que l’étape se voie en échec', async () => {
    const { pool, requetes } = fauxPool([L1, L2]);
    const magasin = {
      effacer: async (cle: string) => { if (cle === L2.cle_objet) throw new Error('bucket muet'); },
    } as unknown as MagasinObjets;
    await expect(new PgDocumentsContact(pool, magasin).purgerEchus(10)).rejects.toThrow(/1 document\(s\) du bucket non effacé\(s\)/);
    const supprime = requetes.find((r) => r.sql.startsWith('delete from documents_contact'))!;
    expect(JSON.parse(supprime.params[0] as string)).toEqual([{ tenant_id: 't1', code: 'doc_a' }]);
  });

  it('sans magasin, rien ne s’efface (l’objet resterait sans ligne qui le nomme)', async () => {
    const { pool, requetes } = fauxPool([L1]);
    expect(await new PgDocumentsContact(pool, null).purgerEchus(10)).toBe(0);
    expect(requetes).toEqual([]);
  });
});
