import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowStore } from '../../src/workflow/store.pg';
import { PgAutomationStore } from '../../src/automation/store.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LES LANCEURS D'UN SCÉNARIO EN BASE (menu « Scénario », lot 2) : ce qui donne au builder ses départs fermés. Seules les
 * automations ALLUMÉES comptent, avec leur déclencheur et leur bloc de départ ; l'espace d'un autre ne fuit pas.
 *
 * Jamais joué en local (le DATABASE_URL local pointe l'ancienne production), joué par le job `integration`.
 */
describe.skipIf(!url)('lanceurs d’un scénario (Postgres)', () => {
  let pool: Pool;
  let tenantId = '';
  let autre = '';
  let scenario = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-lanceurs') returning id`)).rows[0]!.id;
    autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-lanceurs-autre') returning id`)).rows[0]!.id;
    const workflows = new PgWorkflowStore(pool);
    scenario = (await workflows.insert(tenantId, 'Relance', { nodes: [], edges: [] }, 'general')).id;
    const automations = new PgAutomationStore(pool);
    const base = { triggerConfig: { keywords: ['x'] }, conditionGroup: null, cooldownSeconds: null, rayon: 'general' as const, workflowId: scenario };
    await automations.create(tenantId, { ...base, name: 'Rappel', triggerKind: 'tag_added', triggerConfig: { tag: 'vip' }, startNodeId: 'n2', enabled: true });
    await automations.create(tenantId, { ...base, name: 'Éteinte', triggerKind: 'keyword', startNodeId: null, enabled: false });
  });

  afterAll(async () => {
    for (const t of [tenantId, autre]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  it('les automations allumées, avec leur déclencheur et leur bloc de départ', async () => {
    expect(await new PgWorkflowStore(pool).lanceursDuScenario(tenantId, scenario)).toEqual([
      { type: 'automation', nom: 'Rappel', declencheur: 'tag_added', blocDeDepart: 'n2' },
    ]);
  });

  it('🔴 l’espace d’un autre ne voit rien', async () => {
    expect(await new PgWorkflowStore(pool).lanceursDuScenario(autre, scenario)).toEqual([]);
  });

  it('les graphes publiés d’une liste, en une lecture, par espace', async () => {
    const store = new PgWorkflowStore(pool);
    expect([...(await store.graphesPublies(tenantId, [scenario])).keys()]).toEqual([scenario]);
    expect([...(await store.graphesPublies(autre, [scenario])).keys()]).toEqual([]);
  });
});
