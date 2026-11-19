import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { PgWorkflowStore } from '../src/workflow/store.pg';
import { PgWorkflowRunStore } from '../src/workflow/run-store.pg';
import { buildWorkflowRuntime } from '../src/workflow/wiring';
import { WorkflowExecutor, type WorkflowExecutorDeps } from '../src/workflow/executor';
import type { WorkflowGraph, WorkflowNodeType } from '../src/workflow/graph';
import type { WorkflowRunRow } from '../src/workflow/run-store.pg';
import { avecGardesDEtatInertes, depsInertes } from './executeur-inerte';
import { bancDuFil, ESPACE } from './banc-du-fil';
import { jamaisDesabonne, toujoursDAccord } from './consentement';
import { offresToutOuvert, filiereApiSeule } from './gardes';

/**
 * 🔴 UN PARCOURS VIVANT SURVIT AU CHANGEMENT DE RAYON DE SON SCÉNARIO (menu « Scénario », lot 6b, décision 41). La bascule
 * déplace au rayon `hubspot` des scénarios qu'un workflow HubSpot lance, dont MUTAC `devis` qui a trois parcours vivants.
 * Le rayon ne se juge qu'au LANCEMENT (`lancer`, `rayonAdmis`) ; ce fichier prouve que le reste de la vie d'un parcours ne le
 * lit nulle part : le balayage réclame dans `workflow_runs` seul, le réveil et l'avance relisent le graphe par `getGraph`,
 * que le câblage construit sur `PgWorkflowStore.getById`, qui ne filtre aucun rayon. Si l'une de ces lectures se mettait à
 * filtrer le rayon, ce fichier tomberait, et la migration de bascule ne devrait plus déplacer un scénario aux parcours vivants.
 */

const n = (id: string, type: WorkflowNodeType, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data });

/** Le devis de MUTAC, en plus court : un template à bouton, une attente, un remerciement. */
const DEVIS: WorkflowGraph = {
  nodes: [
    n('devis', 'template', { templateName: 'devis', language: 'fr', templateButtons: [{ type: 'QUICK_REPLY', text: 'Oui' }] }),
    n('attente', 'wait', { waitMode: 'delai', value: 1, unit: 'hours' }),
    n('merci', 'template', { templateName: 'merci', language: 'fr' }),
  ],
  edges: [
    { id: 'e1', source: 'devis', target: 'merci', sourceHandle: 'btn:0' },
    { id: 'e2', source: 'attente', target: 'merci' },
  ],
};

const WF = '7b9d1c2e-3f40-4a51-8b62-9c7d0e1f2a3b';
const WA = '33611223344';

/** Un faux pool qui note chaque requête et rend la ligne du scénario déplacé au rayon `hubspot`. */
function poolDuScenario() {
  const requetes: string[] = [];
  const query = async (sql: string) => {
    requetes.push(sql.replace(/\s+/g, ' '));
    if (/from workflows/.test(sql)) {
      return {
        rows: [{
          id: WF, tenant_id: ESPACE, name: 'devis', code: 'scn_devis', graph: DEVIS, draft_graph: null,
          published_at: new Date('2026-11-19T08:00:00Z'), created_at: new Date('2026-11-01T08:00:00Z'), updated_at: new Date('2026-11-19T08:00:00Z'),
          rayon: 'hubspot',
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  };
  return { requetes, pool: { query } as unknown as Pool };
}

/** Le `getGraph` du VRAI câblage, monté sur le VRAI magasin des scénarios (et un faux pool). */
function getGraphDuCablage(pool: Pool): WorkflowExecutorDeps['getGraph'] {
  const inerte = {} as never;
  const { executor } = buildWorkflowRuntime({
    pool: pool as never, queue: { enqueue: async () => {} }, dryRun: true, repo: inerte,
    contactStore: inerte, inboxStore: inerte, settingsStore: inerte, workflowStore: new PgWorkflowStore(pool),
    metaCredentials: inerte, metaFactory: inerte, rcsProvider: 'fake', emailTemplates: inerte, emailResolver: inerte,
    numeroDeLEspace: async () => null, runStore: inerte, fil: inerte, offres: offresToutOuvert,
    prevenirEquipe: async () => {}, application: filiereApiSeule, magasinObjets: null, connecteurHubspot: null,
  });
  // `deps` est privé à l'exécuteur : on lit la dépendance telle que le câblage la lui a donnée.
  return (Reflect.get(executor, 'deps') as WorkflowExecutorDeps).getGraph;
}

const run = (o: Partial<WorkflowRunRow>): WorkflowRunRow => ({
  id: 'r-vivant', workflowId: WF, tenantId: ESPACE, waId: WA, contactId: 'c1', currentNode: 'devis', status: 'waiting',
  lastMessageId: null, channel: 'whatsapp', grapheFige: null, exigeAccordMarketing: false, neEnMasse: true, evenement: null, ...o,
});

/** Le vrai exécuteur, sur le `getGraph` du câblage et le vrai contrôle du fil ; le fil est à nous. */
function executeur(getGraph: WorkflowExecutorDeps['getGraph'], attend: WorkflowRunRow | null) {
  const b = bancDuFil({ surLaListe: [], conversations: { [WA]: { owner: 'app_workflow' } } });
  const envois: string[] = [];
  const executor = new WorkflowExecutor({
    ...depsInertes,
    estDesabonne: jamaisDesabonne,
    aAccordMarketing: toujoursDAccord,
    runs: avecGardesDEtatInertes({
      start: async () => ({ id: 'r-neuf' }),
      findWaitingByWaId: async () => attend,
      setState: async () => {},
      closeActiveByWaId: async () => [],
    }),
    getGraph,
    applyTag: async () => true,
    setField: async () => {},
    removeTag: async () => {},
    clearField: async () => {},
    sendTemplate: async (_t, _w, nom) => { envois.push(`tpl:${nom}`); },
    sendQuickMessage: async () => {},
    sendFlow: async () => {},
    sendQuestion: async () => {},
    mayAct: b.fil.peutAgir,
    reclaimControl: b.fil.reprendrePourLApp,
  });
  return { executor, envois };
}

describe('🔴 un parcours vivant d’un scénario passé au rayon HubSpot continue (décision 41)', () => {
  it('le magasin relit un scénario par son identifiant sans filtrer le rayon', async () => {
    const { pool, requetes } = poolDuScenario();
    const wf = await new PgWorkflowStore(pool).getById(WF, ESPACE);
    expect(wf).toMatchObject({ id: WF, rayon: 'hubspot', graph: DEVIS });
    expect(requetes[0]).toMatch(/where id = \$1 and tenant_id = \$2/);
    expect(requetes[0]).not.toMatch(/\brayon\b\s*=/);
  });

  it('le `getGraph` du vrai câblage rend le graphe d’un scénario du rayon HubSpot', async () => {
    const { pool } = poolDuScenario();
    expect(await getGraphDuCablage(pool)(WF, ESPACE)).toEqual(DEVIS);
  });

  it('🔴 le réveil (balayage d’une attente) continue le parcours : le bloc suivant part', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { pool } = poolDuScenario();
    const m = executeur(getGraphDuCablage(pool), null);
    expect(await m.executor.resume(run({ currentNode: 'attente', status: 'sleeping' }))).toBe(true);
    expect(m.envois).toEqual(['tpl:merci']);
  });

  it('🔴 l’avance sur un clic continue le parcours : la branche du bouton part', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { pool } = poolDuScenario();
    const m = executeur(getGraphDuCablage(pool), run({ currentNode: 'devis', status: 'waiting' }));
    await m.executor.advance(ESPACE, WA, 'wamid.clic', 'btn:0');
    expect(m.envois).toEqual(['tpl:merci']);
  });

  it('🔴 le balayage réclame les parcours dus dans `workflow_runs` seul, sans lire leur scénario', async () => {
    const requetes: string[] = [];
    const pool = { query: async (sql: string) => { requetes.push(sql.replace(/\s+/g, ' ')); return { rows: [], rowCount: 0 }; } } as unknown as Pool;
    const runs = new PgWorkflowRunStore(pool);
    await runs.claimDueSleeping(10);
    await runs.claimDueQuestions(10);
    expect(requetes).toHaveLength(2);
    for (const sql of requetes) {
      expect(sql).toMatch(/workflow_runs/);
      expect(sql).not.toMatch(/\bworkflows\b/);
    }
  });
});
