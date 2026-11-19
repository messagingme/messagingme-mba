import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';

const url = process.env.DATABASE_URL ?? '';

/**
 * 0299 ET 0300 CONTRE UNE VRAIE BASE (menu « Scénario », lot 5). Le texte des migrations est tenu par
 * `tests/migration-0299.test.ts` ; ici, ce que la base en fait : la ligne Shopify et ses cascades, les deux colonnes de
 * la boutique nulles par défaut, la source d'une vente élargie sans perdre la règle de la relance, l'index partiel.
 */
describe.skipIf(!url)('0299 et 0300 appliquées', () => {
  let pool: Pool;
  let tenantId: string;
  let workflowId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-0299') returning id`)).rows[0]!.id;
    workflowId = (await pool.query<{ id: string }>(
      `insert into workflows (tenant_id, name, rayon) values ($1, 'itest-0299', 'shopify') returning id`, [tenantId],
    )).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = $1', [tenantId]);
    await pool.end();
  });

  const code = async (sql: string, p: unknown[]): Promise<string | null> => {
    try { await pool.query(sql, p); return null; } catch (e) { return (e as { code?: string }).code ?? 'inconnu'; }
  };
  const vente = (source: string, relanceLe: string | null) => code(
    `insert into ventes_attribuees (tenant_id, montant, devise, payee_le, source, relance_le) values ($1, 10, 'EUR', now(), $2, $3::timestamptz)`,
    [tenantId, source, relanceLe],
  );

  it('🔴 une ligne Shopify : éteinte par défaut, un événement connu, une par événement et par espace', async () => {
    await pool.query(`insert into shopify_lignes (tenant_id, evenement, workflow_id) values ($1, 'order_paid', $2)`, [tenantId, workflowId]);
    const l = (await pool.query<{ actif: boolean }>(`select actif from shopify_lignes where tenant_id = $1 and evenement = 'order_paid'`, [tenantId])).rows[0];
    expect(l?.actif).toBe(false);
    expect(await code(`insert into shopify_lignes (tenant_id, evenement, workflow_id) values ($1, 'order_paid', $2)`, [tenantId, workflowId])).toBe('23505');
    expect(await code(`insert into shopify_lignes (tenant_id, evenement, workflow_id) values ($1, 'refund', $2)`, [tenantId, workflowId])).toBe('23514');
  });

  it('🔴 le scénario supprimé emporte sa ligne (cascade)', async () => {
    const autre = (await pool.query<{ id: string }>(
      `insert into workflows (tenant_id, name, rayon) values ($1, 'itest-0299-b', 'shopify') returning id`, [tenantId],
    )).rows[0]!.id;
    await pool.query(`insert into shopify_lignes (tenant_id, evenement, workflow_id) values ($1, 'checkout_abandoned', $2)`, [tenantId, autre]);
    await pool.query(`delete from workflows where id = $1 and tenant_id = $2`, [autre, tenantId]);
    const reste = await pool.query(`select 1 from shopify_lignes where tenant_id = $1 and evenement = 'checkout_abandoned'`, [tenantId]);
    expect(reste.rowCount).toBe(0);
  });

  it('la pause et la borne des paniers : deux colonnes timestamptz, nullables, sans défaut', async () => {
    const cols = (await pool.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_name = 'shopify_boutiques' and column_name in ('pause_le', 'paniers_depuis') order by column_name`,
    )).rows;
    expect(cols.map((c) => [c.column_name, c.data_type, c.is_nullable, c.column_default])).toEqual([
      ['paniers_depuis', 'timestamp with time zone', 'YES', null],
      ['pause_le', 'timestamp with time zone', 'YES', null],
    ]);
  });

  it('🔴 une vente « commande payée » ou « commande expédiée » s’écrit ; une source inconnue est refusée ; la règle de la relance tient', async () => {
    expect(await vente('commande_payee', null)).toBeNull();
    expect(await vente('commande_expediee', null)).toBeNull();
    expect(await vente('scenario', null)).toBeNull();
    expect(await vente('inconnue', null)).toBe('23514');
    expect(await vente('relance_panier', null)).toBe('23514');
    expect(await vente('relance_panier', new Date().toISOString())).toBeNull();
  });

  it('🔴 l’index 0300 : partiel, sur les seuls parcours d’événement, tous statuts', async () => {
    const def = (await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'workflow_runs_evenement_idx'`,
    )).rows[0]?.indexdef ?? '';
    expect(def.replace(/\s+/g, ' ')).toMatch(/ON public\.workflow_runs USING btree \(tenant_id, wa_id\) WHERE \(evenement IS NOT NULL\)$/);
  });
});
