import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowNodeEventStore } from '../../src/workflow/node-events.pg';

/**
 * LE BLOC QUI A ENVOYÉ UN MESSAGE, contre une VRAIE base (menu « Scénario », lot 2, relecture de 2a point 2) : c'est ce
 * qui reconnaît un clic sur un ANCIEN message. Seule la mesure d'ENVOI du bloc fait foi (un accusé « lu » recopie le même
 * identifiant), et l'espace d'un autre ne voit rien : un wamid deviné ne doit pas dire quel bloc d'un autre client
 * l'a envoyé.
 *
 * Jamais joué en local (le DATABASE_URL local pointe l'ancienne production), joué par le job `integration`.
 */
const url = process.env.DATABASE_URL ?? '';

describe.skipIf(!url)('le bloc d’un message (Postgres)', () => {
  let pool: Pool;
  let store: PgWorkflowNodeEventStore;
  let tenantId = '';
  let autre = '';
  let workflowId = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    store = new PgWorkflowNodeEventStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-bloc-du-message') returning id`)).rows[0]!.id;
    autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-bloc-du-message-autre') returning id`)).rows[0]!.id;
    workflowId = (await pool.query<{ id: string }>(
      `insert into workflows (tenant_id, name, graph) values ($1, 'itest', '{"nodes":[],"edges":[]}'::jsonb) returning id`,
      [tenantId],
    )).rows[0]!.id;
    await store.record({ tenantId, workflowId, nodeId: 't1', waId: '33600000901', kind: 'sent', metaMessageId: 'wamid.itest.premier' });
    await store.record({ tenantId, workflowId, nodeId: 't2', waId: '33600000901', kind: 'sent', metaMessageId: 'wamid.itest.relance' });
    await store.recordStatusForMessage('wamid.itest.premier', 'read');
  });

  afterAll(async () => {
    for (const t of [tenantId, autre]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  it('chaque message retrouve le bloc qui l’a envoyé, accusé de lecture compris', async () => {
    expect(await store.blocDuMessage(tenantId, 'wamid.itest.premier')).toEqual({ workflowId, nodeId: 't1' });
    expect(await store.blocDuMessage(tenantId, 'wamid.itest.relance')).toEqual({ workflowId, nodeId: 't2' });
  });

  it('un message inconnu ne désigne rien', async () => {
    expect(await store.blocDuMessage(tenantId, 'wamid.itest.inconnu')).toBeNull();
  });

  it('🔴 l’espace d’un autre ne voit rien', async () => {
    expect(await store.blocDuMessage(autre, 'wamid.itest.premier')).toBeNull();
  });
});
