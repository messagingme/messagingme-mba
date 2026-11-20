import { describe, it, expect } from 'vitest';
import { jamaisDesabonne, toujoursDAccord } from './consentement';
import { avecGardesDEtatInertes, depsInertes } from './executeur-inerte';
import { parseGraph, type WorkflowGraph } from '../src/workflow/graph';
import { walk, nextNode, nextNodeHorsTimeout } from '../src/workflow/engine';
import { WorkflowExecutor, type WorkflowExecutorDeps } from '../src/workflow/executor';
import type { RunState, WorkflowRunRow } from '../src/workflow/run-store.pg';
import { creerLivraisonTemplates } from '../src/workflow/livraison-template';
import { SORTIE_NON_LIVRE } from '../web/lib/partage/sortie-non-livre';
import { processStatuses } from '../src/webhooks/delivery';
import type { WebhookEvent } from '../src/webhooks/parse';
import { aucunTarif, aucunEchecLibre, aucunAjustementCredit } from './webhook-fixtures';

/**
 * La sortie « En cas d'échec » d'un bloc template (Julien, 2026-11-20) : l'accusé `failed` de Meta fait partir le
 * parcours par elle, `delivered` par la suite là où le parcours n'attendait que lui, et jamais une suite libre ne la prend.
 */
const pos = { x: 0, y: 0 };

/** Template sans bouton → (suite) étiquette « suite » ; (En cas d'échec) étiquette « echec ». */
function graphe(avecSortie = true): WorkflowGraph {
  return parseGraph({
    nodes: [
      { id: 't', type: 'template', position: pos, data: { templateName: 'bienvenue', language: 'fr' } },
      { id: 'repli', type: 'action', position: pos, data: { actionKind: 'add_tag', tag: 'echec' } },
      { id: 'suite', type: 'action', position: pos, data: { actionKind: 'add_tag', tag: 'suite' } },
    ],
    // La sortie d'échec EN PREMIER : une suite libre qui prendrait « la première arête venue » la volerait.
    edges: [
      ...(avecSortie ? [{ id: 'e0', source: 't', target: 'repli', sourceHandle: SORTIE_NON_LIVRE }] : []),
      { id: 'e1', source: 't', target: 'suite' },
    ],
  })!;
}

const BLOC = { workflowId: 'w1', nodeId: 't' };

function monter(graph: WorkflowGraph, opts: { mbaActif?: boolean; evenement?: boolean } = {}) {
  const tags: string[] = [];
  const etats: RunState[] = [];
  let run: WorkflowRunRow | null = null;
  const etat = { filANous: true };
  const deps: WorkflowExecutorDeps = {
    ...depsInertes,
    estDesabonne: jamaisDesabonne,
    aAccordMarketing: toujoursDAccord,
    getGraph: async () => graph,
    mbaActifPour: async () => opts.mbaActif === true,
    mayAct: async () => etat.filANous,
    applyTag: async (_t, _w, tag) => { tags.push(tag); },
    setField: async () => {},
    removeTag: async () => {},
    clearField: async () => {},
    sendTemplate: async () => ({ messageId: 'wamid.1' }),
    sendQuickMessage: async () => {},
    sendFlow: async () => {},
    sendQuestion: async () => {},
    now: () => 1_000,
    runs: avecGardesDEtatInertes({
      start: async (_t: string, _w: string, waId: string, _c: string | null, state: RunState) => {
        etats.push({ ...state });
        run = {
          id: 'run-1', tenantId: 't1', workflowId: 'w1', waId, currentNode: state.currentNode ?? null, status: state.status as 'waiting',
          lastMessageId: null, channel: 'whatsapp', grapheFige: null, neEnMasse: false, exigeAccordMarketing: false,
          evenement: opts.evenement ? { origine: 'shopify:x', variables: {}, messageId: 'wamid.1', noeudDepart: 't' } : null,
        };
        return { id: 'run-1' };
      },
      setState: async (_id: string, state: RunState) => {
        etats.push({ ...state });
        if (run) run = { ...run, currentNode: state.currentNode ?? null, status: state.status as 'waiting', lastMessageId: state.lastMessageId ?? run.lastMessageId };
      },
      closeActiveByWaId: async () => [],
      findWaitingByWaId: async () => (run && run.status === 'waiting' ? run : null),
      findWaitingSurBloc: async (_t: string, _w: string, workflowId: string, nodeId: string) =>
        (run && run.status === 'waiting' && run.workflowId === workflowId && run.currentNode === nodeId ? run : null),
    }),
  };
  const executor = new WorkflowExecutor(deps);
  return { executor, tags, etats, run: () => run, set filANous(v: boolean) { etat.filANous = v; } };
}

async function demarrer(m: ReturnType<typeof monter>, g: WorkflowGraph) {
  await m.executor.demarrer('campagne_scenario', 't1', 'w1', g, { waId: '33600000001', contactId: 'c1' });
}

describe('sortie « En cas d’échec » : le moteur', () => {
  it('aucune suite libre ne prend la sortie d’échec, même placée en premier', () => {
    const g = graphe();
    expect(nextNode(g, 't')).toBe('suite');
    expect(nextNodeHorsTimeout(g, 't')).toBe('suite');
  });

  it('agent de Meta actif : branchée, le template attend l’accusé au lieu de continuer', () => {
    expect(walk(graphe(true), 't', undefined, { mbaActif: true }).rest).toEqual({ status: 'waiting', nodeId: 't' });
  });

  it('agent de Meta actif : non branchée, le template continue comme avant', () => {
    const r = walk(graphe(false), 't', undefined, { mbaActif: true });
    expect(r.rest.status).toBe('done');
    expect(r.actions.map((a) => a.nodeId)).toEqual(['t', 'suite']);
  });
});

describe('sortie « En cas d’échec » : l’accusé de Meta', () => {
  it('un échec fait partir le parcours par la sortie d’échec, et pas par la suite', async () => {
    const g = graphe();
    const m = monter(g, { mbaActif: true });
    await demarrer(m, g);
    expect(m.etats.at(-1)).toMatchObject({ currentNode: 't', status: 'waiting' });
    expect(m.tags).toEqual([]);

    expect(await m.executor.templateNonLivre('t1', '33600000001', 'wamid.1', BLOC)).toBe(true);
    expect(m.tags).toEqual(['echec']);
  });

  it('un échec rejoué ne rejoue pas la branche', async () => {
    const g = graphe();
    const m = monter(g, { mbaActif: true });
    await demarrer(m, g);
    await m.executor.templateNonLivre('t1', '33600000001', 'wamid.1', BLOC);
    await m.executor.templateNonLivre('t1', '33600000001', 'wamid.1', BLOC);
    expect(m.tags).toEqual(['echec']);
  });

  it('un « livré » fait partir la suite quand l’agent de Meta est actif', async () => {
    const g = graphe();
    const m = monter(g, { mbaActif: true });
    await demarrer(m, g);
    expect(await m.executor.templateLivre('t1', '33600000001', 'wamid.1', BLOC)).toBe(true);
    expect(m.tags).toEqual(['suite']);
    // L'échec arrivé après la livraison ne trouve plus de parcours sur le bloc.
    expect(await m.executor.templateNonLivre('t1', '33600000001', 'wamid.1', BLOC)).toBe(false);
    expect(m.tags).toEqual(['suite']);
  });

  it('un « livré » ne fait rien quand le parcours attend la réponse du contact (agent de Meta éteint)', async () => {
    const g = graphe();
    const m = monter(g, { mbaActif: false });
    await demarrer(m, g);
    expect(await m.executor.templateLivre('t1', '33600000001', 'wamid.1', BLOC)).toBe(false);
    expect(m.tags).toEqual([]);
    expect(m.run()).toMatchObject({ currentNode: 't', status: 'waiting' });
  });

  it('fil tenu par un opérateur : ni branche, ni cession à la campagne', async () => {
    const g = graphe();
    const m = monter(g, { mbaActif: true });
    await demarrer(m, g);
    m.filANous = false;
    let cede = false;
    expect(await m.executor.templateNonLivre('t1', '33600000001', 'wamid.1', BLOC, async () => { cede = true; })).toBe(false);
    expect(cede).toBe(false);
    expect(m.tags).toEqual([]);
  });

  it('sortie non branchée : l’échec ne fait rien (le comportement d’avant)', async () => {
    const g = graphe(false);
    const m = monter(g);
    await demarrer(m, g);
    expect(await m.executor.templateNonLivre('t1', '33600000001', 'wamid.1', BLOC)).toBe(false);
    expect(m.tags).toEqual([]);
  });

  it('un accusé d’un autre bloc ne fait pas avancer ce parcours', async () => {
    const g = graphe();
    const m = monter(g, { mbaActif: true });
    await demarrer(m, g);
    expect(await m.executor.templateNonLivre('t1', '33600000001', 'wamid.9', { workflowId: 'w1', nodeId: 'autre' })).toBe(false);
    expect(m.tags).toEqual([]);
  });

  it('un parcours d’événement né sur ce template prend aussi la sortie d’échec', async () => {
    const g = graphe();
    const m = monter(g, { evenement: true });
    await demarrer(m, g);
    await m.executor.templateNonLivre('t1', '33600000001', 'wamid.1', BLOC);
    expect(m.tags).toEqual(['echec']);
  });
});

describe('sortie « En cas d’échec » : le puits des accusés', () => {
  it('sur un échec, la campagne cède AVANT que la branche ne parte ; sur une livraison, rien n’est cédé', async () => {
    const ordre: string[] = [];
    const puits = creerLivraisonTemplates({
      envoiDuMessage: async (w) => (w === 'wamid.1' ? { tenantId: 't1', waId: '336', workflowId: 'w1', nodeId: 't' } : null),
      parcours: {
        templateLivre: async () => { ordre.push('livre'); return true; },
        templateNonLivre: async (_t, _w, _m, _b, avant) => { await avant(); ordre.push('branche'); return true; },
      },
      cederAuScenario: async () => { ordre.push('cede'); },
    });
    await puits.surAccuse('wamid.1', 'failed');
    await puits.surAccuse('wamid.1', 'delivered');
    await puits.surAccuse('wamid.inconnu', 'failed');
    expect(ordre).toEqual(['cede', 'branche', 'livre']);
  });
});

describe('sortie « En cas d’échec » : le traitement des accusés', () => {
  const statut = (id: string, status: string): WebhookEvent => ({
    source: 'statuses',
    dedupKey: `st:${id}:${status}`,
    data: { id, status },
  } as unknown as WebhookEvent);

  it('l’accusé arrive au puits AVANT la livraison et la remise du fil, jamais pour `sent`, et sa panne ne coûte rien', async () => {
    const ordre: string[] = [];
    await processStatuses(
      [statut('wamid.A', 'sent'), statut('wamid.B', 'failed'), statut('wamid.C', 'delivered')],
      { updateDeliveryByMessageId: async (id: string) => { ordre.push(`livraison:${id}`); return 0; } } as never,
      {
        tarifs: aucunTarif, echecsLibres: aucunEchecLibre, ajustementCredit: aucunAjustementCredit,
        remiseMba: async (id) => { ordre.push(`remise:${id}`); },
        livraisonTemplates: {
          surAccuse: async (id, s) => {
            ordre.push(`puits:${id}:${s}`);
            if (id === 'wamid.B') throw new Error('panne');
          },
        },
      },
    );
    expect(ordre).toEqual([
      'livraison:wamid.A', 'remise:wamid.A',
      'puits:wamid.B:failed', 'livraison:wamid.B', 'remise:wamid.B',
      'puits:wamid.C:delivered', 'livraison:wamid.C', 'remise:wamid.C',
    ]);
  });
});
