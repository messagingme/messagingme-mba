import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowStore } from '../../src/workflow/store.pg';
import { PgDeroule, PARCOURS_MAX, PASSAGES_MAX } from '../../src/workflow/deroule.pg';
import type { WorkflowGraph } from '../../src/workflow/graph';

const url = process.env.DATABASE_URL ?? '';

/** Il y a `jours` jours (et `secondes` de plus), en ISO : les dates suivent l'horloge, la fenêtre de 90 jours aussi. */
const ilYa = (jours: number, secondes = 0): string => new Date(Date.now() - jours * 86_400_000 + secondes * 1000).toISOString();

/**
 * LE DÉROULÉ D'UN CONTACT, EN BASE (lot 1 du CSM virtuel, B6b) : ses derniers parcours et les blocs qu'il a passés,
 * 🔴 jamais ceux d'un autre espace ni d'un autre contact, dans l'ordre, bornés en nombre, dans la fenêtre de ses
 * parcours et jamais au-delà de 90 jours.
 */
describe.skipIf(!url)('le déroulé d’un contact (Postgres)', () => {
  let pool: Pool;
  let tenantId = '';
  let autreTenant = '';
  let scenario = '';
  let scenarioAutre = '';
  const graphe: WorkflowGraph = { nodes: [{ id: 'q', type: 'quick_message', position: { x: 0, y: 0 }, data: { body: 'Bonjour' } }], edges: [] };
  const parcours = (t: string, w: string, waId: string, statut: string, cree: string, bloc: string | null = 'q') => pool.query(
    `insert into workflow_runs (workflow_id, tenant_id, wa_id, current_node, status, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $6)`,
    [w, t, waId, bloc, statut, cree],
  );
  const passage = (t: string, w: string, waId: string, kind: string, at: string, handle: string | null = null) => pool.query(
    `insert into workflow_node_events (tenant_id, workflow_id, node_id, wa_id, kind, handle, at) values ($1, $2, 'q', $3, $4, $5, $6)`,
    [t, w, waId, kind, handle, at],
  );
  const lire = (t: string, w: string, waId: string) => new PgDeroule(pool).lire(t, w, waId);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 3 });
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-deroule') returning id`)).rows[0]!.id;
    autreTenant = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-deroule-autre') returning id`)).rows[0]!.id;
    const store = new PgWorkflowStore(pool);
    scenario = (await store.insert(tenantId, 'itest deroule', graphe, 'general')).id;
    scenarioAutre = (await store.insert(autreTenant, 'itest deroule autre', graphe, 'general')).id;
  });

  afterAll(async () => {
    await pool.query(`delete from tenants where id = any($1::uuid[])`, [[tenantId, autreTenant]]);
    await pool.end();
  });

  it('🔴 rend les parcours et les passages du contact, du plus ancien au plus récent, jamais ceux d’un autre espace ou contact', async () => {
    await parcours(tenantId, scenario, '33600000001', 'done', ilYa(5), null);
    await parcours(tenantId, scenario, '33600000001', 'waiting', ilYa(4));
    await passage(tenantId, scenario, '33600000001', 'sent', ilYa(4, 1));
    await passage(tenantId, scenario, '33600000001', 'reply_button', ilYa(4, 300), 'btn:1');
    // Bien avant le plus ancien de ses parcours, mais dans les 90 jours : hors de la fenêtre des parcours.
    await passage(tenantId, scenario, '33600000001', 'sent', ilYa(60));
    // Le même numéro dans un autre espace, et un autre contact du même scénario : rien de tout cela.
    await parcours(autreTenant, scenarioAutre, '33600000001', 'waiting', ilYa(4));
    await passage(autreTenant, scenarioAutre, '33600000001', 'sent', ilYa(4, 2));
    await passage(tenantId, scenario, '33600000002', 'sent', ilYa(4, 3));
    const d = await lire(tenantId, scenario, '33600000001');
    expect(d.parcours.map((p) => [p.statut, p.bloc])).toEqual([['waiting', 'q'], ['done', null]]);
    expect(d.passages.map((p) => [p.quoi, p.sortie])).toEqual([['sent', null], ['reply_button', 'btn:1']]);
    // L'autre espace ne voit pas ce scénario, même par son identifiant.
    expect(await lire(autreTenant, scenario, '33600000001')).toEqual({ parcours: [], passages: [] });
  });

  it('borne les parcours et les passages, les plus récents, rendus dans l’ordre', async () => {
    const waId = '33600000003';
    for (let i = 0; i < PARCOURS_MAX + 2; i += 1) await parcours(tenantId, scenario, waId, 'done', ilYa(15 - i), null);
    const base = Date.now() - 7 * 86_400_000;
    const a = (i: number): string => new Date(base + i * 1000).toISOString();
    for (let i = 0; i < PASSAGES_MAX + 5; i += 1) await passage(tenantId, scenario, waId, 'read', a(i));
    const d = await lire(tenantId, scenario, waId);
    expect(d.parcours).toHaveLength(PARCOURS_MAX);
    // Les cent plus récents, du plus ancien au plus récent : les cinq premiers écrits sont laissés.
    expect(d.passages.map((p) => p.le)).toEqual(Array.from({ length: PASSAGES_MAX }, (_, i) => a(i + 5)));
  });

  it('🔴 jamais au-delà de 90 jours, même derrière un parcours qui attend depuis plus longtemps', async () => {
    const waId = '33600000004';
    await parcours(tenantId, scenario, waId, 'waiting', ilYa(200));
    await passage(tenantId, scenario, waId, 'sent', ilYa(150));
    await passage(tenantId, scenario, waId, 'read', ilYa(10));
    const d = await lire(tenantId, scenario, waId);
    expect(d.parcours).toHaveLength(1);
    expect(d.passages.map((p) => p.quoi)).toEqual(['read']);
  });
});
