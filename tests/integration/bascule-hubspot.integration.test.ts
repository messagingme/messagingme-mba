import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { pgSsl } from '../../src/db/ssl';

/**
 * LA BASCULE HUBSPOT (migration 0304, menu « Scénario », lot 6b), contre une VRAIE base : les automations « changement
 * d'étape » du Builder s'éteignent, « Date d'un champ » reste, et les scénarios lancés par un workflow HubSpot dans les 90
 * derniers jours passent au rayon `hubspot` avec leur ligne allumée, sauf ceux que le Builder vise encore.
 *
 * ⚠️ ELLE TOURNE DANS UNE TRANSACTION ANNULÉE : la migration vise TOUS les espaces, et la base de la CI est partagée par
 * les autres fichiers.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ANCIENNE base de production. La CI monte un
 * Postgres jetable pour ça (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';
const MIGRATION = readFileSync(resolve(__dirname, '..', '..', 'db', 'migrations', '0304_bascule_hubspot.sql'), 'utf8');
const GRAPHE = JSON.stringify({ nodes: [{ id: 'depart', type: 'template', position: { x: 0, y: 0 }, data: { templateName: 'devis', language: 'fr', code: 'nod_itest_devis' } }], edges: [] });

async function scenario(client: PoolClient, tenant: string, code: string, graphe = GRAPHE): Promise<string> {
  return (await client.query<{ id: string }>(
    `insert into workflows (tenant_id, name, graph, published_at, code) values ($1, $2, $3::jsonb, now(), $2) returning id`, [tenant, code, graphe],
  )).rows[0]!.id;
}
async function campagne(client: PoolClient, tenant: string, wf: string, nom: string, depuisJours = 1, statut = 'completed'): Promise<void> {
  await client.query(
    `insert into campaigns (tenant_id, phone_number_id, name, category, template_name, template_language, workflow_id, status, created_at)
     values ($1, 'pn-itest', $2, 'utility', 'devis', 'fr', $3, $4, now() - make_interval(days => $5))`,
    [tenant, nom, wf, statut, depuisJours],
  );
}
async function automation(client: PoolClient, tenant: string, wf: string, kind: string, enabled: boolean, config = '{}'): Promise<string> {
  return (await client.query<{ id: string }>(
    `insert into automations (tenant_id, name, enabled, trigger_kind, trigger_config, workflow_id) values ($1, $2, $3, $2, $4::jsonb, $5) returning id`,
    [tenant, kind, enabled, config, wf],
  )).rows[0]!.id;
}

describe.skipIf(!url)('la bascule HubSpot en base (0304)', () => {
  let pool: Pool;

  beforeAll(() => { pool = new Pool({ connectionString: url, ssl: pgSsl() }); });
  afterAll(async () => { await pool.end(); });

  it('🔴 étapes éteintes, date gardée ; les scénarios d’un workflow déplacés avec leur ligne, sauf ceux que le Builder vise', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const t = (await client.query<{ id: string }>(`insert into tenants (name) values ('itest-bascule-hubspot') returning id`)).rows[0]!.id;
      const etapeWf = await scenario(client, t, 'scn_itest_etape');
      const etape = await automation(client, t, etapeWf, 'hubspot_deal_stage', true, '{"pipelineId":"p","stageId":"s"}');
      const date = await automation(client, t, etapeWf, 'avant_date', true, '{"fieldKey":"hs_rdv","delai":1,"unite":"jours","sens":"avant"}');

      // Lancé par un workflow il y a deux jours, rien d'autre ne le vise : il passe.
      const devis = await scenario(client, t, 'scn_itest_devis');
      await campagne(client, t, devis, 'HubSpot · workflow 1234567', 2);
      await campagne(client, t, devis, 'HubSpot · workflow 1234567', 1, 'running');
      // Une automation des Autres le vise encore (même éteinte) : il reste.
      const vise = await scenario(client, t, 'scn_itest_vise');
      await campagne(client, t, vise, 'HubSpot · workflow 42', 3);
      await automation(client, t, vise, 'keyword', false, '{"keywords":["devis"]}');
      // Une campagne active du Builder le lance : il reste.
      const campagneBuilder = await scenario(client, t, 'scn_itest_campagne');
      await campagne(client, t, campagneBuilder, 'HubSpot · workflow 43', 3);
      await campagne(client, t, campagneBuilder, 'Relance novembre', 1, 'paused');
      // Un « Aller à » d'un autre scénario vise un de ses blocs : il reste.
      const cible = await scenario(client, t, 'scn_itest_cible', GRAPHE.replace('nod_itest_devis', 'nod_itest_cible'));
      await campagne(client, t, cible, 'HubSpot · workflow 44', 3);
      await scenario(client, t, 'scn_itest_saut', JSON.stringify({ nodes: [{ id: 'a', type: 'aller_a', position: { x: 0, y: 0 }, data: { cible: 'nod_itest_cible' } }], edges: [] }));
      // Lancé il y a cent jours seulement : hors de la fenêtre, il reste.
      const vieux = await scenario(client, t, 'scn_itest_vieux', JSON.stringify({ nodes: [], edges: [] }));
      await campagne(client, t, vieux, 'HubSpot · workflow 45', 100);

      const notices: string[] = [];
      client.on('notice', (n) => notices.push(n.message ?? ''));
      await client.query(MIGRATION);

      const auto = await client.query<{ id: string; enabled: boolean }>('select id, enabled from automations where id = any($1::uuid[]) order by trigger_kind', [[etape, date]]);
      expect(auto.rows).toEqual([{ id: date, enabled: true }, { id: etape, enabled: false }]);

      const rayons = await client.query<{ code: string; rayon: string }>('select code, rayon from workflows where tenant_id = $1 order by code', [t]);
      expect(rayons.rows).toEqual([
        { code: 'scn_itest_campagne', rayon: 'general' }, { code: 'scn_itest_cible', rayon: 'general' },
        { code: 'scn_itest_devis', rayon: 'hubspot' }, { code: 'scn_itest_etape', rayon: 'general' },
        { code: 'scn_itest_saut', rayon: 'general' }, { code: 'scn_itest_vieux', rayon: 'general' }, { code: 'scn_itest_vise', rayon: 'general' },
      ]);
      const lignes = await client.query<{ workflow_id: string; enabled: boolean; trigger_kind: string; trigger_config: unknown; rayon: string; name: string }>(
        `select workflow_id, enabled, trigger_kind, trigger_config, rayon, name from automations where tenant_id = $1 and rayon = 'hubspot'`, [t],
      );
      expect(lignes.rows).toEqual([{ workflow_id: devis, enabled: true, trigger_kind: 'hubspot_workflow', trigger_config: {}, rayon: 'hubspot', name: 'scn_itest_devis' }]);
      expect(notices.some((n) => n.includes('scn_itest_vise') && n.includes('Autres'))).toBe(true);
      expect(notices.some((n) => n.includes('scn_itest_campagne') && n.includes('campagne active'))).toBe(true);
      expect(notices.some((n) => n.includes('scn_itest_cible') && n.includes('Aller a'))).toBe(true);
      expect(notices.some((n) => n.includes('scn_itest_devis') && n.includes('passe au rayon hubspot'))).toBe(true);

      // Rejouée, elle ne change rien : aucune ligne de plus, rien de rallumé.
      await client.query(MIGRATION);
      expect((await client.query(`select 1 from automations where tenant_id = $1 and rayon = 'hubspot'`, [t])).rowCount).toBe(1);
      expect((await client.query('select enabled from automations where id = $1', [etape])).rows[0]).toEqual({ enabled: false });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
