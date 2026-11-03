import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowRunStore } from '../../src/workflow/run-store.pg';
import { PgContactStore } from '../../src/crm/contact-store.pg';

/**
 * LA GARDE MARKETING D'UN PARCOURS, contre une VRAIE base (migration 0272, lot 3b du plan mm-hubspot du 2026-11-02).
 *
 * 🔴 Les lignes de `workflow_runs` sont typées à la main : une colonne oubliée dans un `select` ou un `returning` ne se
 * voit pas au typecheck. Et une fausse implémentation de `start` à six paramètres reste assignable au contrat de
 * l'exécuteur. Seul cet aller-retour prouve que `start` ÉCRIT la règle et que les QUATRE lectures la RELISENT
 * (`findWaitingByWaId`, `byId`, la réclamation des balayages, `claimSleepingById`) : perdue en route, un parcours
 * d'automation endormi se réveillerait sans elle. La lecture se fait « !== false » : une colonne absente ferait refuser,
 * donc le cas `false` est celui qui prouve vraiment la lecture.
 */
const url = process.env.DATABASE_URL ?? '';

describe.skipIf(!url)('workflow_runs.accord_marketing_exige : écrite par start, relue par les quatre lectures', () => {
  let pool: Pool;
  let store: PgWorkflowRunStore;
  let fiches: PgContactStore;
  let tenantId: string;
  let workflowId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgWorkflowRunStore(pool);
    fiches = new PgContactStore(pool);
    tenantId = (await pool.query<{ id: string }>(
      `insert into tenants (name) values ('itest-run-accord-marketing') returning id`,
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
  async function parcours(waId: string, status: 'waiting' | 'sleeping', exige: boolean, echeancePassee: boolean): Promise<string> {
    const { id } = await store.start(tenantId, workflowId, waId, null, {
      currentNode: 'n1', status, ...(echeancePassee ? { resumeAt: new Date(Date.now() - 60_000) } : {}),
    }, null, exige);
    return id;
  }

  for (const exige of [true, false]) {
    it(`🔴 ${exige ? 'exigée' : 'libre'} : start l’écrit, findWaitingByWaId et byId la relisent`, async () => {
      const wa = exige ? '33600000721' : '33600000722';
      const id = await parcours(wa, 'waiting', exige, false);
      const ligne = await pool.query<{ accord_marketing_exige: boolean }>(`select accord_marketing_exige from workflow_runs where id = $1`, [id]);
      expect(ligne.rows[0]?.accord_marketing_exige).toBe(exige);
      expect((await store.findWaitingByWaId(tenantId, wa))?.exigeAccordMarketing).toBe(exige);
      expect((await store.byId(tenantId, id))?.exigeAccordMarketing).toBe(exige);
    });

    it(`🔴 ${exige ? 'exigée' : 'libre'} : les réclamations des balayages (sommeil, question) et du réveil court la relisent`, async () => {
      const dormant = await parcours(exige ? '33600000731' : '33600000732', 'sleeping', exige, true);
      const question = await parcours(exige ? '33600000741' : '33600000742', 'waiting', exige, true);
      const court = await parcours(exige ? '33600000751' : '33600000752', 'sleeping', exige, true);
      // Le réveil court d'abord : la réclamation par lot prendrait aussi ce parcours.
      expect((await store.claimSleepingById(tenantId, court))?.exigeAccordMarketing).toBe(exige);
      const sommeil = await store.claimDueSleeping(500);
      expect(sommeil.find((r) => r.id === dormant)?.exigeAccordMarketing).toBe(exige);
      const questions = await store.claimDueQuestions(500);
      expect(questions.find((r) => r.id === question)?.exigeAccordMarketing).toBe(exige);
    });
  }

  it('la colonne a son défaut : un parcours inséré sans elle (l’ancien code pendant le déploiement) naît libre', async () => {
    const r = await pool.query<{ accord_marketing_exige: boolean }>(
      `insert into workflow_runs (workflow_id, tenant_id, wa_id, current_node, status) values ($1, $2, '33600000761', 'n1', 'waiting')
       returning accord_marketing_exige`,
      [workflowId, tenantId],
    );
    expect(r.rows[0]?.accord_marketing_exige).toBe(false);
  });

  it('🔴 l’accord de la fiche : seul `opted_in` vaut accord ; inconnue, sans statut, désabonnée, supprimée ou d’un autre espace, non', async () => {
    const autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-run-accord-autre') returning id`)).rows[0]!.id;
    try {
      const fiche = async (t: string, tel: string, statut: string, supprimee = false) => pool.query(
        `insert into contacts (tenant_id, phone_e164, opt_in_status, deleted_at) values ($1, $2, $3, case when $4 then now() else null end)`,
        [t, tel, statut, supprimee],
      );
      await fiche(tenantId, '+33600000771', 'opted_in');
      await fiche(tenantId, '+33600000772', 'unknown');
      await fiche(tenantId, '+33600000773', 'opted_out');
      await fiche(tenantId, '+33600000774', 'opted_in', true);
      await fiche(autre, '+33600000775', 'opted_in');
      expect(await fiches.aAccordMarketingParWaId(tenantId, '33600000771')).toBe(true);
      expect(await fiches.aAccordMarketingParWaId(tenantId, '33600000772')).toBe(false);
      expect(await fiches.aAccordMarketingParWaId(tenantId, '33600000773')).toBe(false);
      expect(await fiches.aAccordMarketingParWaId(tenantId, '33600000774')).toBe(false);
      expect(await fiches.aAccordMarketingParWaId(tenantId, '33600000775'), 'la fiche d’un autre espace ne prête pas son accord').toBe(false);
      expect(await fiches.aAccordMarketingParWaId(tenantId, '33600000779')).toBe(false);
    } finally {
      await pool.query(`delete from tenants where id = $1`, [autre]);
    }
  });
});
