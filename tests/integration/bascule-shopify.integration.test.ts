import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';

/**
 * LA BASCULE DES MESSAGES SHOPIFY (migration 0302, menu « Scénario », lot 5b), contre une VRAIE base : les anciens
 * messages s'éteignent et les attentes de l'ancien assistant se vident, sans rien toucher d'autre.
 *
 * ⚠️ ELLE TOURNE DANS UNE TRANSACTION ANNULÉE : la migration vise TOUS les espaces, et la base de la CI est partagée par
 * les autres fichiers.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ANCIENNE base de production. La CI monte un
 * Postgres jetable pour ça (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';
const MIGRATION = readFileSync(resolve(__dirname, '..', '..', 'db', 'migrations', '0302_bascule_shopify.sql'), 'utf8');

describe.skipIf(!url)('la bascule des messages Shopify en base (0302)', () => {
  let pool: Pool;

  beforeAll(() => { pool = new Pool({ connectionString: url, ssl: pgSsl() }); });
  afterAll(async () => { await pool.end(); });

  it('🔴 les anciens messages s’éteignent, les attentes se vident ; le reste de la ligne ne bouge pas', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const tenant = (await client.query<{ id: string }>(`insert into tenants (name) values ('itest-bascule-shopify') returning id`)).rows[0]!.id;
      await client.query(
        `insert into shopify_messages (tenant_id, evenement, modele, langue, variables, actif)
         values ($1, 'order_paid', 'commande_payee', 'fr', '["first_name"]'::jsonb, true),
                ($1, 'checkout_abandoned', 'relance', 'fr', '[]'::jsonb, false)`,
        [tenant],
      );
      await client.query(
        `insert into shopify_messages_attente (tenant_id, evenement, modele, langue) values ($1, 'order_fulfilled', 'shopify_order_fulfilled_mh2abcde', 'fr')`,
        [tenant],
      );
      await client.query(MIGRATION);
      const messages = await client.query<{ evenement: string; modele: string; variables: unknown; actif: boolean }>(
        'select evenement, modele, variables, actif from shopify_messages where tenant_id = $1 order by evenement', [tenant],
      );
      expect(messages.rows).toEqual([
        { evenement: 'checkout_abandoned', modele: 'relance', variables: [], actif: false },
        { evenement: 'order_paid', modele: 'commande_payee', variables: ['first_name'], actif: false },
      ]);
      const attentes = await client.query('select 1 from shopify_messages_attente where tenant_id = $1', [tenant]);
      expect(attentes.rowCount).toBe(0);
      // Rejouée, elle ne change rien de plus : aucune erreur, le même état.
      await client.query(MIGRATION);
      expect((await client.query('select 1 from shopify_messages where tenant_id = $1 and actif', [tenant])).rowCount).toBe(0);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
