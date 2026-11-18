import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowRunStore } from '../../src/workflow/run-store.pg';

/**
 * LE DRAPEAU « NÉ D'UN CHEMIN DE MASSE » D'UN PARCOURS, contre une VRAIE base (migration 0295, menu « Scénario », lot 2,
 * relecture de 2a point 4).
 *
 * 🔴 Les lignes de `workflow_runs` sont typées à la main, et une fausse implémentation de `start` à sept paramètres reste
 * assignable au contrat de l'exécuteur : retirer la colonne de l'insert (son défaut la remplirait) laissait toute la suite
 * verte. Seul cet aller-retour prouve que `start` ÉCRIT le drapeau et que les lectures le RELISENT (`findWaitingByWaId`,
 * `byId`, les réclamations des balayages, `claimSleepingById`). La lecture se fait « === true » : c'est le cas `true` qui
 * prouve vraiment la lecture.
 */
const url = process.env.DATABASE_URL ?? '';

describe.skipIf(!url)('workflow_runs.ne_en_masse : écrit par start, relu par les lectures', () => {
  let pool: Pool;
  let store: PgWorkflowRunStore;
  let tenantId: string;
  let workflowId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgWorkflowRunStore(pool);
    tenantId = (await pool.query<{ id: string }>(
      `insert into tenants (name) values ('itest-run-ne-en-masse') returning id`,
    )).rows[0]!.id;
    workflowId = (await pool.query<{ id: string }>(
      `insert into workflows (tenant_id, name, graph) values ($1, 'itest', '{"nodes":[],"edges":[]}'::jsonb) returning id`,
      [tenantId],
    )).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query(`delete from tenants where id = $1`, [tenantId]);
    await pool.end();
  });

  /** Un parcours né par le CHEMIN RÉEL (`start`), son échéance passée quand il doit être réclamé. */
  async function parcours(waId: string, status: 'waiting' | 'sleeping', masse: boolean, echeancePassee: boolean): Promise<string> {
    const { id } = await store.start(tenantId, workflowId, waId, null, {
      currentNode: 'n1', status, ...(echeancePassee ? { resumeAt: new Date(Date.now() - 60_000) } : {}),
    }, null, false, masse);
    return id;
  }

  for (const masse of [true, false]) {
    it(`🔴 ${masse ? 'né en masse' : 'unitaire'} : start l’écrit, findWaitingByWaId et byId le relisent`, async () => {
      const wa = masse ? '33600000821' : '33600000822';
      const id = await parcours(wa, 'waiting', masse, false);
      const ligne = await pool.query<{ ne_en_masse: boolean }>(`select ne_en_masse from workflow_runs where id = $1`, [id]);
      expect(ligne.rows[0]?.ne_en_masse).toBe(masse);
      expect((await store.findWaitingByWaId(tenantId, wa))?.neEnMasse).toBe(masse);
      expect((await store.byId(tenantId, id))?.neEnMasse).toBe(masse);
    });

    it(`🔴 ${masse ? 'né en masse' : 'unitaire'} : les réclamations des balayages (sommeil, question) et du réveil court le relisent`, async () => {
      const dormant = await parcours(masse ? '33600000831' : '33600000832', 'sleeping', masse, true);
      const question = await parcours(masse ? '33600000841' : '33600000842', 'waiting', masse, true);
      const court = await parcours(masse ? '33600000851' : '33600000852', 'sleeping', masse, true);
      // Le réveil court d'abord : la réclamation par lot prendrait aussi ce parcours.
      expect((await store.claimSleepingById(tenantId, court))?.neEnMasse).toBe(masse);
      const sommeil = await store.claimDueSleeping(500);
      expect(sommeil.find((r) => r.id === dormant)?.neEnMasse).toBe(masse);
      const questions = await store.claimDueQuestions(500);
      expect(questions.find((r) => r.id === question)?.neEnMasse).toBe(masse);
    });
  }

  it('la colonne a son défaut : un parcours inséré sans elle (l’ancien code pendant le déploiement) naît unitaire', async () => {
    const r = await pool.query<{ ne_en_masse: boolean }>(
      `insert into workflow_runs (workflow_id, tenant_id, wa_id, current_node, status) values ($1, $2, '33600000861', 'n1', 'waiting')
       returning ne_en_masse`,
      [workflowId, tenantId],
    );
    expect(r.rows[0]?.ne_en_masse).toBe(false);
  });
});
