import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowRunStore, type RunState } from '../../src/workflow/run-store.pg';
import type { EvenementDuParcours } from '../../src/workflow/evenement';

/**
 * LE PARCOURS D'ÉVÉNEMENT contre une VRAIE base (menu « Scénario », lot 4, migrations 0297 et 0298, décisions 21 et 28).
 *
 * 🔴 Ce que seul un aller-retour prouve : que `start` ÉCRIT l'événement et que chaque lecture le RELIT (une fausse
 * implémentation à huit paramètres reste assignable au contrat de l'exécuteur) ; que l'index unique refuse un SECOND
 * parcours d'événement actif pour un contact, et que ce refus arrive comme un refus typé ; que les clôtures épargnent ou
 * visent ce qu'elles disent ; que la fin d'un parcours efface ses variables (des liens à clé d'accès) et garde son origine.
 */
const url = process.env.DATABASE_URL ?? '';

describe.skipIf(!url)('workflow_runs.evenement : la place unique, les lectures, les clôtures', () => {
  let pool: Pool;
  let store: PgWorkflowRunStore;
  let tenantId: string;
  let autreTenant: string;
  let workflowId: string;
  let autreWorkflow: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgWorkflowRunStore(pool);
    const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    tenantId = await espace('itest-run-evenement');
    autreTenant = await espace('itest-run-evenement-autre');
    const scenario = async (t: string) => (await pool.query<{ id: string }>(
      `insert into workflows (tenant_id, name, graph) values ($1, 'itest', '{"nodes":[],"edges":[]}'::jsonb) returning id`, [t],
    )).rows[0]!.id;
    workflowId = await scenario(tenantId);
    autreWorkflow = await scenario(autreTenant);
  });

  afterAll(async () => {
    await pool.query(`delete from tenants where id = any($1::uuid[])`, [[tenantId, autreTenant]]);
    await pool.end();
  });

  const ev = (ref: string): EvenementDuParcours => ({ origine: `shopify:b:checkouts/create:${ref}`, variables: { checkout_url: `https://x/${ref}` } });

  /** Un parcours né par le CHEMIN RÉEL (`start`). */
  async function nait(t: string, w: string, waId: string, evenement: EvenementDuParcours | null, etat: Partial<RunState> = {}): Promise<string> {
    const r = await store.start(t, w, waId, null, { currentNode: 'n1', status: 'waiting', ...etat }, null, false, false, evenement);
    if (!('id' in r)) throw new Error(`refus inattendu : ${r.refus}`);
    return r.id;
  }
  const evenementEnBase = async (id: string) =>
    (await pool.query<{ evenement: unknown }>(`select evenement from workflow_runs where id = $1`, [id])).rows[0]?.evenement;

  it('🔴 start écrit l’événement ; findWaitingByWaId, byId et les trois réclamations le relisent', async () => {
    const e = ev('lu');
    const enAttente = await nait(tenantId, workflowId, '33600009101', e);
    expect(await evenementEnBase(enAttente)).toEqual(e);
    expect((await store.findWaitingByWaId(tenantId, '33600009101'))?.evenement).toEqual(e);
    expect((await store.byId(tenantId, enAttente))?.evenement).toEqual(e);

    const passe = new Date(Date.now() - 60_000);
    const court = await nait(tenantId, workflowId, '33600009102', ev('court'), { status: 'sleeping', resumeAt: passe });
    const dormant = await nait(tenantId, workflowId, '33600009103', ev('dormant'), { status: 'sleeping', resumeAt: passe });
    const question = await nait(tenantId, workflowId, '33600009104', ev('question'), { resumeAt: passe });
    // Le réveil court d'abord : la réclamation par lot prendrait aussi ce parcours.
    expect((await store.claimSleepingById(tenantId, court))?.evenement).toEqual(ev('court'));
    expect((await store.claimDueSleeping(500)).find((r) => r.id === dormant)?.evenement).toEqual(ev('dormant'));
    expect((await store.claimDueQuestions(500)).find((r) => r.id === question)?.evenement).toEqual(ev('question'));
  });

  it('🔴 un SECOND parcours d’événement actif pour le même contact est refusé ; un ordinaire coexiste', async () => {
    const wa = '33600009111';
    const premier = await nait(tenantId, workflowId, wa, ev('a'));
    const second = await store.start(tenantId, workflowId, wa, null, { currentNode: 'n1', status: 'sleeping' }, null, false, false, ev('b'));
    expect(second).toEqual({ refus: 'evenement_actif' });
    const ordinaire = await nait(tenantId, workflowId, wa, null);
    expect(await store.parcoursDEvenementActif(tenantId, wa)).toEqual({ id: premier });
    expect(ordinaire).not.toBe(premier);
    // Un autre contact, ou le même numéro dans un autre espace : leur place est libre.
    await nait(tenantId, workflowId, '33600009112', ev('a'));
    await nait(autreTenant, autreWorkflow, wa, ev('a'));
  });

  it('🔴 closeOrdinairesByWaId épargne le parcours d’événement ; cloreAutresActifs épargne celui qui prend la main', async () => {
    const wa = '33600009121';
    const evenement = await nait(tenantId, workflowId, wa, ev('c'));
    const ordinaire = await nait(tenantId, workflowId, wa, null);
    expect(await store.closeOrdinairesByWaId(tenantId, wa)).toEqual([ordinaire]);
    expect((await store.byId(tenantId, evenement))?.status).toBe('waiting');
    const repondeur = await nait(tenantId, workflowId, wa, null);
    expect(await store.cloreAutresActifs(tenantId, wa, evenement)).toEqual([repondeur]);
    expect((await store.byId(tenantId, evenement))?.status).toBe('waiting');
  });

  it('🔴 la fin d’un parcours efface ses variables et garde son origine, quelle que soit l’écriture qui le clôt', async () => {
    const fins: Array<[string, (id: string, wa: string) => Promise<unknown>]> = [
      ['closeActiveByWaId', (_id, wa) => store.closeActiveByWaId(tenantId, wa)],
      ['setState done', (id) => store.setState(id, { currentNode: null, status: 'done' })],
      ['setState inbox', (id) => store.setState(id, { currentNode: null, status: 'inbox' })],
      ['setStateSiVivant', (id) => store.setStateSiVivant(tenantId, id, { currentNode: null, status: 'done' })],
      ['setStateSiEncoreSur', (id) => store.setStateSiEncoreSur(tenantId, id, 'n1', { currentNode: null, status: 'done' })],
      ['cloreParOrigine', () => store.cloreParOrigine(tenantId, ev('fin-cloreParOrigine').origine)],
    ];
    let n = 0;
    for (const [nom, finir] of fins) {
      const wa = `3360000913${n++}`;
      const e = ev(`fin-${nom}`);
      const id = await nait(tenantId, workflowId, wa, e);
      await finir(id, wa);
      expect({ nom, evenement: await evenementEnBase(id) }).toEqual({ nom, evenement: { origine: e.origine } });
    }
    // Une écriture qui ne termine pas le parcours garde ses variables.
    const vivant = await nait(tenantId, workflowId, '33600009140', ev('vivant'));
    await store.setState(vivant, { currentNode: 'n2', status: 'sleeping', resumeAt: new Date(Date.now() + 3_600_000) });
    expect(await evenementEnBase(vivant)).toEqual(ev('vivant'));
  });

  it('cloreParOrigine et cloreParScenarios ne touchent que les parcours d’événement actifs de CET espace', async () => {
    const e = ev('origine-commune');
    const cible = await nait(tenantId, workflowId, '33600009151', e);
    const ailleurs = await nait(autreTenant, autreWorkflow, '33600009151', e);
    const ordinaire = await nait(tenantId, workflowId, '33600009152', null);
    expect(await store.cloreParOrigine(tenantId, e.origine)).toEqual([cible]);
    expect((await store.byId(autreTenant, ailleurs))?.status).toBe('waiting');

    const parScenario = await nait(tenantId, workflowId, '33600009153', ev('scenario'));
    const fermes = await store.cloreParScenarios(tenantId, [workflowId, autreWorkflow]);
    expect(fermes).toContain(parScenario);
    expect(fermes).not.toContain(ordinaire);
    expect(fermes).not.toContain(ailleurs);
    expect((await store.byId(tenantId, ordinaire))?.status).toBe('waiting');
  });

  it('la colonne est nulle par défaut : un parcours inséré sans elle (l’ancien code) est ordinaire', async () => {
    const r = await pool.query<{ evenement: unknown }>(
      `insert into workflow_runs (workflow_id, tenant_id, wa_id, current_node, status) values ($1, $2, '33600009161', 'n1', 'waiting')
       returning evenement`,
      [workflowId, tenantId],
    );
    expect(r.rows[0]?.evenement).toBeNull();
  });
});
