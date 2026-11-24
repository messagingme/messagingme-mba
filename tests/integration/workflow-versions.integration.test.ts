import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowStore } from '../../src/workflow/store.pg';
import { PgVersionsScenario } from '../../src/workflow/versions.pg';
import type { WorkflowGraph } from '../../src/workflow/graph';

const url = process.env.DATABASE_URL ?? '';

/**
 * LES VERSIONS PUBLIÉES D'UN SCÉNARIO, EN BASE (lot 1 du CSM virtuel, B3, migration 0315).
 *
 * 🔴 Le déclencheur `workflows_version` est le seul à écrire une version : ce fichier prouve qu'il le fait sur chaque
 * chemin qui change `workflows.graph` (la publication de la console, la création publiée de l'API, la publication
 * programmée), qu'une republication à l'identique ou un brouillon n'en créent pas, que la lecture est scopée à l'espace
 * et que la suppression d'un scénario emporte ses versions.
 */
describe.skipIf(!url)('les versions publiées d’un scénario (Postgres)', () => {
  let pool: Pool;
  let tenantId = '';
  let autreTenant = '';
  const store = () => new PgWorkflowStore(pool);
  const versions = () => new PgVersionsScenario(pool);
  const graphe = (corps: string): WorkflowGraph => ({
    nodes: [{ id: 'x', type: 'quick_message', position: { x: 0, y: 0 }, data: { body: corps } }], edges: [],
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 3 });
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-versions') returning id`)).rows[0]!.id;
    autreTenant = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-versions-autre') returning id`)).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query(`delete from tenants where id = any($1::uuid[])`, [[tenantId, autreTenant]]);
    await pool.end();
  });

  it('🔴 un brouillon n’est pas une version ; chaque publication en est une, une republication à l’identique non', async () => {
    const { id } = await store().insert(tenantId, 'itest versions console', graphe('v1'), 'general');
    expect(await versions().lister(tenantId, id)).toEqual([]);
    await store().publish(id, tenantId);
    await store().update(id, tenantId, { graph: graphe('v2') });
    expect((await versions().lister(tenantId, id)).map((v) => v.numero)).toEqual([1]);
    await store().publish(id, tenantId);
    await store().publish(id, tenantId);
    const liste = await versions().lister(tenantId, id);
    expect(liste.map((v) => [v.numero, v.blocs])).toEqual([[2, 1], [1, 1]]);
    expect((await versions().lire(tenantId, id, 1))?.graph).toEqual(graphe('v1'));
    expect((await versions().lire(tenantId, id, 2))?.graph).toEqual(graphe('v2'));
  });

  it('🔴 déplacer les blocs d’un scénario publié range la disposition dans le publié, sans faire de version', async () => {
    const { id } = await store().insert(tenantId, 'itest versions disposition', graphe('d'), 'general');
    await store().publish(id, tenantId);
    const deplace: WorkflowGraph = { ...graphe('d'), nodes: [{ ...graphe('d').nodes[0]!, position: { x: 40, y: 80 } }] };
    await store().update(id, tenantId, { graph: deplace });
    expect((await store().getById(id, tenantId))?.graph).toEqual(deplace);
    expect((await versions().lister(tenantId, id)).map((v) => v.numero)).toEqual([1]);
    expect((await versions().lire(tenantId, id, 1))?.graph).toEqual(graphe('d'));
  });

  it('🔴 une création déjà publiée (l’API, MCP) a sa version 1, et son remplacement par l’API la 2', async () => {
    const cree = await store().creerPublieParApi(tenantId, 'itest versions api', graphe('api'));
    if (!('id' in cree)) throw new Error('création refusée');
    expect((await versions().lister(tenantId, cree.id)).map((v) => v.numero)).toEqual([1]);
    expect(await store().remplacerPublieParApi(cree.id, tenantId, 'itest versions api', graphe('api 2'), () => null)).toBe('ok');
    expect((await versions().lister(tenantId, cree.id)).map((v) => v.numero)).toEqual([2, 1]);
    expect((await versions().lire(tenantId, cree.id, 2))?.graph).toEqual(graphe('api 2'));
  });

  it('🔴 une publication programmée crée sa version quand elle part', async () => {
    const { id } = await store().insert(tenantId, 'itest versions programmee', graphe('avant'), 'general');
    await store().publish(id, tenantId);
    const prog = await store().programmer(id, tenantId, null, graphe('apres'));
    expect(prog).not.toBeNull();
    await store().mettreEnLigneLaVersionProgrammee(id, tenantId, prog!.le);
    expect((await versions().lister(tenantId, id)).map((v) => v.numero)).toEqual([2, 1]);
    expect((await versions().lire(tenantId, id, 2))?.graph).toEqual(graphe('apres'));
  });

  it('🔴 la lecture est scopée à l’espace, et la suppression d’un scénario emporte ses versions', async () => {
    const { id } = await store().insert(tenantId, 'itest versions isolement', graphe('a'), 'general');
    await store().publish(id, tenantId);
    expect(await versions().lister(autreTenant, id)).toEqual([]);
    expect(await versions().lire(autreTenant, id, 1)).toBeNull();
    await store().remove(id, tenantId);
    const reste = await pool.query(`select 1 from workflow_versions where workflow_id = $1`, [id]);
    expect(reste.rowCount).toBe(0);
  });
});
