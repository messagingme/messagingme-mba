import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowRunStore } from '../../src/workflow/run-store.pg';
import { PgInboxStore } from '../../src/inbox/store.pg';

/**
 * 🔴 RÉSERVER LE TOUR D'UNE AVANCE NE REND PAS LE FIL À UN PARCOURS (relecture de 5a du menu « Scénario », 2026-11-19).
 *
 * `advance` réserve son tour (`reserverAvance`) AVANT la garde du gel (`mayAct`). Une réservation qui datait l'activité du
 * parcours (`updated_at`) remettait un parcours ORDINAIRE gelé, silencieux depuis plus de 24 h, à « tenir le fil » à chaque
 * message du contact : la remise, qui suit l'avance dans le même job, laissait alors le message à l'équipe au lieu de le
 * rendre au robot de l'espace, et un parcours RCS qui attend une réponse RCS gardait le fil tant que le contact écrivait sur
 * WhatsApp. Ce que seule une vraie base prouve : la règle « un parcours tient le fil » (`parcoursTientLeFil`) relue après la
 * réservation et sa libération.
 */
const url = process.env.DATABASE_URL ?? '';

describe.skipIf(!url)('la réservation d’une avance et la règle « un parcours tient le fil »', () => {
  let pool: Pool;
  let tenantId = '';
  let runId = '';
  const wa = '33600005066';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-reservation-gel') returning id`)).rows[0]!.id;
    const wf = (await pool.query<{ id: string }>(
      `insert into workflows (tenant_id, name, graph) values ($1, 'itest', '{"nodes":[],"edges":[]}'::jsonb) returning id`, [tenantId],
    )).rows[0]!.id;
    runId = (await pool.query<{ id: string }>(
      `insert into workflow_runs (workflow_id, tenant_id, wa_id, current_node, status, updated_at)
       values ($1, $2, $3, 'q', 'waiting', now() - interval '2 days') returning id`, [wf, tenantId, wa],
    )).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query(`delete from tenants where id = $1`, [tenantId]);
    await pool.end();
  });

  it('🔴 un parcours ordinaire silencieux depuis deux jours, réservé par une avance qui sera gelée, ne se remet pas à tenir le fil', async () => {
    const runs = new PgWorkflowRunStore(pool);
    const inbox = new PgInboxStore(pool);
    expect(await inbox.parcoursTientLeFil(tenantId, wa)).toBe(false);
    const jeton = await runs.reserverAvance(tenantId, runId, 'q', 30);
    expect(jeton).not.toBeNull();
    // `advance` : la garde du gel rend `false`, puis le `finally` libère le tour.
    await runs.libererAvance(runId, jeton!);
    expect(await inbox.parcoursTientLeFil(tenantId, wa)).toBe(false);
  });
});
