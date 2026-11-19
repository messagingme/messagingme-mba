import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgLignesHubspot } from '../../src/hubspot/lignes.pg';
import { PgAutomationStore } from '../../src/automation/store.pg';
import { PgWorkflowStore } from '../../src/workflow/store.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LE MAGASIN DES LIGNES HUBSPOT EN BASE (menu « Scénario », lot 6b) : des lignes d'`automations` du rayon `hubspot`, que
 * l'écran Autres et le moteur du rayon général ne voient pas, chaque requête bornée à l'espace.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ANCIENNE base de production. La CI monte un
 * Postgres jetable pour ça (job `integration`).
 */
describe.skipIf(!url)('les lignes HubSpot (Postgres)', () => {
  let pool: Pool;
  let lignes: PgLignesHubspot;
  let t = '';
  let autre = '';
  let wf = '';
  let wfWorkflow = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    lignes = new PgLignesHubspot(pool);
    t = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-hubspot-lignes') returning id`)).rows[0]!.id;
    autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-hubspot-lignes-autre') returning id`)).rows[0]!.id;
    const workflows = new PgWorkflowStore(pool);
    wf = (await workflows.insert(t, 'étape', { nodes: [], edges: [] }, 'hubspot')).id;
    wfWorkflow = (await workflows.insert(t, 'devis', { nodes: [{ id: 'depart', type: 'template', position: { x: 0, y: 0 }, data: { templateName: 'devis' } }], edges: [] }, 'hubspot')).id;
    await workflows.publish(wfWorkflow, t);
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[t, autre]]);
    await pool.end();
  });

  it('🔴 créer, relire, lister : éteintes, rangées par famille, le rendez-vous dans la forme du déclencheur de date', async () => {
    const etape = await lignes.creer(t, { famille: 'etape', config: { pipelineId: 'default', stageId: 'closedwon', stageLabel: 'Gagné' }, workflowId: wf, nom: 'Étape Gagné' });
    const rdv = await lignes.creer(t, { famille: 'rdv', config: { fieldKey: 'hs_date_rdv', sens: 'avant', delaiMinutes: 1440 }, workflowId: wf, nom: 'Rappel' });
    expect(await lignes.lire(t, etape.id)).toEqual({ id: etape.id, famille: 'etape', config: { pipelineId: 'default', stageId: 'closedwon', stageLabel: 'Gagné' }, actif: false, workflowId: wf, nom: 'Étape Gagné' });
    expect((await lignes.lire(t, rdv.id))?.config).toEqual({ fieldKey: 'hs_date_rdv', sens: 'avant', delaiMinutes: 1440 });
    const brut = await pool.query<{ trigger_config: unknown; rayon: string; enabled: boolean }>('select trigger_config, rayon, enabled from automations where id = $1', [rdv.id]);
    expect(brut.rows[0]).toEqual({ trigger_config: { fieldKey: 'hs_date_rdv', delai: 1440, unite: 'minutes', sens: 'avant' }, rayon: 'hubspot', enabled: false });
    expect((await lignes.lister(t)).map((l) => l.id)).toEqual([etape.id, rdv.id]);
    // 🔴 Aucune n'atteint un autre espace, ni l'écran Autres, ni le moteur du rayon général.
    expect(await lignes.lire(autre, etape.id)).toBeNull();
    expect(await lignes.allumer(autre, etape.id, true)).toBe(false);
    expect(await lignes.supprimer(autre, etape.id)).toBe(false);
    const automations = new PgAutomationStore(pool);
    expect((await automations.list(t, 'general')).map((a) => a.id)).not.toContain(etape.id);
    expect(await automations.getById(etape.id, t, 'general')).toBeNull();
  });

  it('🔴 une étape se reconnaît à sa paire ; allumée, elle tire, le pipeline ne restreignant que si les deux côtés le portent', async () => {
    const e = await lignes.creer(t, { famille: 'etape', config: { pipelineId: 'p2', stageId: 's2' }, workflowId: wf, nom: 'E2' });
    expect(await lignes.etapeReglee(t, 'p2', 's2')).toBe(true);
    expect(await lignes.etapeReglee(t, 'p3', 's2')).toBe(false);
    expect(await lignes.etapeReglee(autre, 'p2', 's2')).toBe(false);
    expect(await lignes.etapesAllumees(t, 'p2', 's2')).toEqual([]);
    expect(await lignes.allumer(t, e.id, true)).toBe(true);
    expect((await lignes.etapesAllumees(t, 'p2', 's2')).map((l) => l.id)).toEqual([e.id]);
    expect((await lignes.etapesAllumees(t, '', 's2')).map((l) => l.id)).toEqual([e.id]);
    expect(await lignes.etapesAllumees(t, 'p3', 's2')).toEqual([]);
    expect(await lignes.etapesAllumees(autre, 'p2', 's2')).toEqual([]);
  });

  it('les rendez-vous allumés et les espaces à balayer ; les codes des scénarios qu’un workflow lance', async () => {
    const r = await lignes.creer(t, { famille: 'rdv', config: { fieldKey: 'hs_rdv_2', sens: 'apres', delaiMinutes: 30 }, workflowId: wf, nom: 'R2' });
    expect(await lignes.tenantsAvecRendezVous()).not.toContain(t);
    await lignes.allumer(t, r.id, true);
    expect(await lignes.tenantsAvecRendezVous()).toContain(t);
    expect((await lignes.rendezVousAllumes(t)).map((l) => l.id)).toEqual([r.id]);
    const w = await lignes.creer(t, { famille: 'workflow', config: {}, workflowId: wfWorkflow, nom: 'devis' });
    expect(await lignes.codesLancesParWorkflow(t)).toEqual(new Set());
    await lignes.allumer(t, w.id, true);
    const code = (await pool.query<{ code: string }>('select code from workflows where id = $1', [wfWorkflow])).rows[0]!.code;
    expect(await lignes.codesLancesParWorkflow(t)).toEqual(new Set([code]));
    expect(await lignes.codesLancesParWorkflow(autre)).toEqual(new Set());
    expect(await lignes.supprimer(t, w.id)).toBe(true);
    expect(await lignes.codesLancesParWorkflow(t)).toEqual(new Set());
  });
});
