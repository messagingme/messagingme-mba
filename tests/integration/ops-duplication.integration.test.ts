import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowStore } from '../../src/workflow/store.pg';
import { PgAutomationStore } from '../../src/automation/store.pg';
import { PgUserFieldStore } from '../../src/crm/field-store.pg';
import { PgDuplicationStore, type EtatEnBase } from '../../src/ops/duplication/store.pg';
import { planifierDuplication } from '../../src/ops/duplication/plan';
import type { WorkflowGraph } from '../../src/workflow/graph';

const url = process.env.DATABASE_URL ?? '';

/**
 * LA DUPLICATION D'UN SCÉNARIO ENTRE ESPACES, SUR POSTGRES (lot 1, tâche 4 du plan
 * `docs/superpowers/plans/2026-11-16-duplication-scenario-lot-1.md`).
 *
 * 🔴 POURQUOI EN INTÉGRATION. Ce qui doit être prouvé est dans le SQL : le filtre d'espace de chaque lecture (un scénario
 * d'un autre espace, ou le scénario système, ne se lit pas), le brouillon comme seule colonne écrite, la transaction qui
 * ne laisse rien après une panne, et la source jamais touchée.
 *
 * Jamais joué en local (le DATABASE_URL local pointe l'ancienne base de production), joué par le job `integration`.
 */
describe.skipIf(!url)('duplication de scénario entre espaces (Postgres)', () => {
  let pool: Pool;
  let store: PgDuplicationStore;
  let workflows: PgWorkflowStore;
  let source: string;
  let destination: string;
  let tiers: string;
  let scenario: string;

  const graphe = (version: string): WorkflowGraph => ({
    nodes: [
      { id: 'q1', type: 'question', position: { x: 0, y: 0 }, data: { body: `Ville ? ${version}`, champReponse: 'ville' } },
      { id: 'a2', type: 'aller_a', position: { x: 0, y: 0 }, data: { cible: 'nod_x_01J00000000000000000000000' } },
    ],
    edges: [{ id: 'e1', source: 'q1', target: 'a2' }],
  });

  const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
  const compter = async (tenant: string) => (await pool.query<{ w: number; a: number; c: number }>(
    `select (select count(*)::int from workflows where tenant_id = $1) as w,
            (select count(*)::int from automations where tenant_id = $1) as a,
            (select count(*)::int from user_fields where tenant_id = $1) as c`, [tenant],
  )).rows[0]!;
  const plan = (e: EtatEnBase) => planifierDuplication({ ...e, templatesDestination: [], offreOuvreScenarios: true });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    store = new PgDuplicationStore(pool);
    workflows = new PgWorkflowStore(pool);
    source = await espace('itest-dup-source');
    destination = await espace('itest-dup-destination');
    tiers = await espace('itest-dup-tiers');
    await pool.query(`insert into waba (id, tenant_id) values ($1, $2)`, [`itest-dup-${destination}`, destination]);
    await new PgUserFieldStore(pool).create(source, { key: 'ville', label: 'Ville', type: 'text' });
    // Publié en v1, puis un brouillon v2 : la copie doit prendre le brouillon.
    scenario = (await workflows.insert(source, 'Accueil', graphe('v1'))).id;
    await workflows.publish(scenario, source);
    await workflows.update(scenario, source, { graph: graphe('v2') });
    await new PgAutomationStore(pool).create(source, {
      name: 'Accueil', triggerKind: 'keyword', triggerConfig: { keywords: ['bonjour'] }, conditionGroup: null,
      workflowId: scenario, startNodeId: 'q1', cooldownSeconds: null, enabled: true,
    });
  });

  afterAll(async () => {
    for (const t of [source, destination, tiers]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  it('lit le BROUILLON du scénario, ses déclencheurs et les champs des deux espaces', async () => {
    const e = (await store.lireEtat(source, scenario, destination))!;
    expect(e.scenario.graphe.nodes[0]!.data.body).toBe('Ville ? v2');
    expect(e.automationsDuScenario.map((a) => a.name)).toEqual(['Accueil']);
    expect(e.champsSource).toEqual([{ key: 'ville', label: 'Ville', type: 'text' }]);
    expect(e.champsDestination).toEqual([]);
    expect(e.destination.codeClient).not.toBe('');
  });

  it('🔴 un scénario d’un AUTRE espace, ou le scénario système, ne se lit pas', async () => {
    const autre = (await workflows.insert(tiers, 'Chez le tiers', graphe('t'))).id;
    expect(await store.lireEtat(source, autre, destination)).toBeNull();
    const systeme = await workflows.assurerScenarioSysteme(source, 'repondeur');
    expect(await store.lireEtat(source, systeme, destination)).toBeNull();
    expect((await store.scenarios(source)).map((s) => s.id)).not.toContain(systeme);
  });

  it('écrit dans la destination seulement : brouillon, champ, déclencheur éteint ; la source ne bouge pas', async () => {
    const avantSource = await compter(source);
    const e = (await store.lireEtat(source, scenario, destination))!;
    const r = await store.ecrire(destination, e.scenario.nom, plan(e));
    expect(r.nom).toBe('Accueil (copie)');
    expect(r.champsCrees).toEqual(['ville']);
    const copie = (await workflows.getById(r.scenarioId, destination))!;
    expect(copie.graph.nodes).toHaveLength(0);
    expect(copie.draftGraph?.nodes[1]!.data.cible).toBe('');
    const autos = await new PgAutomationStore(pool).toutesPourLaDuplication(destination);
    expect(autos.map((a) => [a.workflowId, a.enabled, a.startNodeId])).toEqual([[r.scenarioId, false, 'q1']]);
    expect(await compter(source)).toEqual(avantSource);
  });

  it('une seconde copie prend « (copie 2) »', async () => {
    const e = (await store.lireEtat(source, scenario, destination))!;
    expect((await store.ecrire(destination, e.scenario.nom, plan(e))).nom).toBe('Accueil (copie 2)');
  });

  it('🔴 une panne en route ne laisse RIEN dans la destination', async () => {
    const vierge = await espace('itest-dup-vierge');
    try {
      const e = (await store.lireEtat(source, scenario, vierge))!;
      const p = plan(e);
      // Un `bigint` ne se sérialise pas : l'insertion du déclencheur lève APRÈS le champ et le scénario.
      p.declencheurs.copies[0]!.triggerConfig = { keywords: ['bonjour'], n: 1n };
      await expect(store.ecrire(vierge, e.scenario.nom, p)).rejects.toThrow();
      expect(await compter(vierge)).toEqual({ w: 0, a: 0, c: 0 });
    } finally {
      await pool.query('delete from tenants where id = $1', [vierge]);
    }
  });

  it('liste les espaces avec leur WABA', async () => {
    const espaces = await store.espaces();
    expect(espaces.find((x) => x.id === destination)?.waba).toBe(true);
    expect(espaces.find((x) => x.id === tiers)?.waba).toBe(false);
  });
});
