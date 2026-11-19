import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgShopifyStore } from '../../src/shopify/store.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * CE QUE LA RÈGLE « ENCORE VOULU ? » LIT DE LA BOUTIQUE, CONTRE UNE VRAIE BASE (lot 5, migration 0299) : l'état de la
 * boutique (absente, coupée, en pause, active) et l'interrupteur de la ligne de l'événement, filtrés par l'espace.
 */
describe.skipIf(!url)('PgShopifyStore.etatPourParcours', () => {
  let pool: Pool;
  let store: PgShopifyStore;
  let tenantId: string;
  let autreTenant: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgShopifyStore(pool, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    tenantId = await espace('itest-parcours-voulu');
    autreTenant = await espace('itest-parcours-voulu-autre');
    await pool.query(
      `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre) values ($1, 'voulu-itest.myshopify.com', 'c1', 'x')`,
      [tenantId],
    );
    const scenario = (await pool.query<{ id: string }>(
      `insert into workflows (tenant_id, name, rayon) values ($1, 'itest-voulu', 'shopify') returning id`, [tenantId],
    )).rows[0]!.id;
    await pool.query(
      `insert into shopify_lignes (tenant_id, evenement, workflow_id, actif) values ($1, 'checkout_abandoned', $2, true), ($1, 'order_paid', $2, false)`,
      [tenantId, scenario],
    );
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[tenantId, autreTenant]]);
    await pool.end();
  });

  it('🔴 la boutique active et sa ligne allumée ; une ligne éteinte ; une ligne absente', async () => {
    expect(await store.etatPourParcours(tenantId, 'voulu-itest.myshopify.com', 'checkout_abandoned')).toEqual({ boutique: 'active', ligneActive: true });
    expect(await store.etatPourParcours(tenantId, 'voulu-itest.myshopify.com', 'order_paid')).toEqual({ boutique: 'active', ligneActive: false });
    expect(await store.etatPourParcours(tenantId, 'voulu-itest.myshopify.com', 'order_fulfilled')).toEqual({ boutique: 'active', ligneActive: false });
  });

  it('🔴 en pause, puis coupée ; un autre espace ou un autre domaine : absente', async () => {
    await pool.query(`update shopify_boutiques set pause_le = now() where tenant_id = $1`, [tenantId]);
    expect((await store.etatPourParcours(tenantId, 'voulu-itest.myshopify.com', 'checkout_abandoned')).boutique).toBe('pause');
    await pool.query(`update shopify_boutiques set etat = 'coupee' where tenant_id = $1`, [tenantId]);
    expect((await store.etatPourParcours(tenantId, 'voulu-itest.myshopify.com', 'checkout_abandoned')).boutique).toBe('coupee');
    expect((await store.etatPourParcours(autreTenant, 'voulu-itest.myshopify.com', 'checkout_abandoned')).boutique).toBe('absente');
    expect((await store.etatPourParcours(tenantId, 'autre-itest.myshopify.com', 'checkout_abandoned')).boutique).toBe('absente');
  });
});
