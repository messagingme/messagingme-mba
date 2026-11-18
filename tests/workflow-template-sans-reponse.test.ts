import { jamaisDesabonne, toujoursDAccord } from './consentement';
import { avecGardesDEtatInertes, depsInertes } from './executeur-inerte';
import { describe, it, expect } from 'vitest';
import { delaiSansReponseMs, nextNodeHorsTimeout, walk } from '../src/workflow/engine';
import { WorkflowExecutor } from '../src/workflow/executor';
import type { WorkflowExecutorDeps } from '../src/workflow/executor';
import type { WorkflowGraph, WorkflowNodeType } from '../src/workflow/graph';
import type { WorkflowRunRow, RunState } from '../src/workflow/run-store.pg';
import { blocSeul } from '../src/mba/outils-maison';

/**
 * LE BLOC TEMPLATE SORT PAR « PAS DE RÉPONSE APRÈS X » (menu « Scénario », lot 2, spec décisions 12 et 25).
 *
 * Aujourd'hui un template attend une réponse sans limite. Il réutilise désormais l'échéance de la Question : l'échéance
 * voyage avec le repos `waiting` (`timeoutInMs`), l'exécuteur la traduit en `resume_at`, le balayage la réclame, et le
 * réveil sort par la poignée `timeout`. Ce fichier verrouille surtout ce qui NE DOIT PAS changer : un template sans délai
 * (ou à délai nul, à unité inconnue, sans nom) garde exactement son comportement, avec et sans agent de Meta, et une
 * arête `timeout` qui traînerait sur un template sans délai n'est jamais prise pour la « suite ».
 */
const n = (id: string, type: WorkflowNodeType, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const e = (id: string, source: string, target: string, sourceHandle?: string) =>
  ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) });

/** Un template à bouton, sa branche, sa sortie libre et sa sortie « pas de réponse ». */
const tpl = (data: Record<string, unknown> = {}) => n('t', 'template', {
  templateName: 'relance', language: 'fr', templateButtons: [{ type: 'QUICK_REPLY', text: 'Je finalise' }], ...data,
});
const GRAPHE = (data: Record<string, unknown> = { timeoutValue: 30, timeoutUnit: 'minutes' }): WorkflowGraph => ({
  nodes: [tpl(data), n('clic', 'tag', { tag: 'clic' }), n('ecrit', 'tag', { tag: 'ecrit' }), n('muet', 'tag', { tag: 'sans-reponse' })],
  edges: [e('e1', 't', 'clic', 'btn:0'), e('e2', 't', 'ecrit'), e('e3', 't', 'muet', 'timeout')],
});
/** Un template SANS bouton (donc sans choix), pour le mode agent de Meta. */
const sansBouton = (data: Record<string, unknown>): WorkflowGraph => ({
  nodes: [n('t', 'template', { templateName: 'info', language: 'fr', ...data }), n('suite', 'tag', { tag: 'suite' }), n('muet', 'tag', { tag: 'sans-reponse' })],
  // L'arête `timeout` est déclarée EN PREMIER : `nextNode` (la première arête venue) la prendrait pour la suite.
  edges: [e('e0', 't', 'muet', 'timeout'), e('e1', 't', 'suite')],
});

describe('le délai « pas de réponse », lu comme celui de la Question', () => {
  it('0, absent, négatif ou d’unité inconnue = aucune échéance ; minutes, heures, jours ; plafond 30 jours', () => {
    expect(delaiSansReponseMs(tpl({}))).toBe(0);
    expect(delaiSansReponseMs(tpl({ timeoutValue: 0 }))).toBe(0);
    expect(delaiSansReponseMs(tpl({ timeoutValue: -2, timeoutUnit: 'hours' }))).toBe(0);
    expect(delaiSansReponseMs(tpl({ timeoutValue: 2, timeoutUnit: 'secondes' }))).toBe(0);
    expect(delaiSansReponseMs(tpl({ timeoutValue: 30, timeoutUnit: 'minutes' }))).toBe(30 * 60_000);
    expect(delaiSansReponseMs(tpl({ timeoutValue: 2, timeoutUnit: 'days' }))).toBe(2 * 86_400_000);
    expect(delaiSansReponseMs(tpl({ timeoutValue: 99, timeoutUnit: 'days' }))).toBe(30 * 86_400_000);
  });

  it('nextNodeHorsTimeout ne prend jamais la poignée `timeout`', () => {
    expect(nextNodeHorsTimeout(sansBouton({}), 't')).toBe('suite');
  });
});

describe('walk : le template à délai attend, celui sans délai ne change pas', () => {
  it('🔴 sans délai, à délai nul ou à unité inconnue : le même repos qu’avant, sans échéance', () => {
    for (const data of [{}, { timeoutValue: 0 }, { timeoutValue: 3, timeoutUnit: 'siecles' }]) {
      expect(walk(GRAPHE(data), 't').rest).toEqual({ status: 'waiting', nodeId: 't' });
    }
  });

  it('🔴 avec un délai : `waiting` et son échéance, après l’envoi du template', () => {
    const { actions, rest } = walk(GRAPHE(), 't');
    expect(actions.map((a) => a.action.kind)).toEqual(['sendTemplate']);
    expect(rest).toEqual({ status: 'waiting', nodeId: 't', timeoutInMs: 30 * 60_000 });
  });

  it('🔴 en mode agent de Meta, un template sans choix SANS délai continue comme avant, par la vraie suite', () => {
    const { rest, actions } = walk(sansBouton({}), 't', undefined, { mbaActif: true });
    expect(actions.map((a) => a.action.kind)).toEqual(['sendTemplate', 'tag']);
    // La SUITE, jamais la sortie « pas de réponse » déclarée en premier (que `nextNode` prendrait).
    expect(actions[1]?.action).toMatchObject({ tag: 'suite' });
    expect(rest.status).toBe('done');
  });

  it('🔴 en mode agent de Meta, un template sans choix AVEC délai attend (décision 25)', () => {
    const { rest } = walk(sansBouton({ timeoutValue: 1, timeoutUnit: 'hours' }), 't', undefined, { mbaActif: true });
    expect(rest).toEqual({ status: 'waiting', nodeId: 't', timeoutInMs: 3_600_000 });
  });

  it('un template sans nom (rien n’est parti) n’a pas d’échéance, même avec un délai', () => {
    const g = GRAPHE({ templateName: '', timeoutValue: 30, timeoutUnit: 'minutes' });
    expect(walk(g, 't').rest).toEqual({ status: 'waiting', nodeId: 't' });
  });

  it('🔴 blocSeul refuse un template à délai : il attend une réponse du client', () => {
    const g = sansBouton({ timeoutValue: 1, timeoutUnit: 'hours', code: 'nod_ab_0123456789ABCDEFGHJKMNPQRS' });
    const r = blocSeul(g, 'nod_ab_0123456789ABCDEFGHJKMNPQRS');
    expect(r).toEqual({ ok: false, raison: expect.stringContaining('attend une réponse') });
  });
});

interface Capture { etats: RunState[]; tags: string[]; rapides: string[]; rendus: string[] }

function monter(graph: WorkflowGraph, run: WorkflowRunRow | null, cap: Capture, over: Partial<WorkflowExecutorDeps> = {}) {
  const deps: WorkflowExecutorDeps = {
    ...depsInertes,
    estDesabonne: jamaisDesabonne,
    aAccordMarketing: toujoursDAccord,
    runs: avecGardesDEtatInertes({
      start: async (_t: string, _w: string, _wa: string, _c: string | null, state: RunState) => { cap.etats.push(state); return { id: 'r1' }; },
      findWaitingByWaId: async () => run,
      setState: async (_id: string, state: RunState) => { cap.etats.push(state); },
      closeActiveByWaId: async () => [],
    }),
    getGraph: async () => graph,
    applyTag: async (_t, _w, tag) => { cap.tags.push(tag); },
    setField: async () => {},
    removeTag: async () => {},
    clearField: async () => {},
    sendTemplate: async () => {},
    sendQuickMessage: async (_t, _w, body) => { cap.rapides.push(String(body)); },
    sendFlow: async () => {},
    sendQuestion: async () => {},
    isWindowOpen: async () => true,
    escalateToHuman: async () => {},
    mbaActifPour: async () => true,
    releaseToMba: async (_t: string, waId: string) => { cap.rendus.push(waId); },
    now: () => 1_000_000,
    ...over,
  };
  return new WorkflowExecutor(deps);
}
const capture = (): Capture => ({ etats: [], tags: [], rapides: [], rendus: [] });
const enAttente = (): WorkflowRunRow => ({
  id: 'r1', workflowId: 'wf1', tenantId: 't1', waId: '33600', contactId: 'c1', currentNode: 't', status: 'waiting',
  lastMessageId: null, channel: 'whatsapp', grapheFige: null, exigeAccordMarketing: false, neEnMasse: false,
});

describe('exécution : l’échéance du template', () => {
  it('🔴 l’échéance est posée sur un parcours WAITING, à l’envoi', async () => {
    const cap = capture();
    const ex = monter(GRAPHE(), null, cap);
    await ex.demarrer('automatisme_ordinaire', 't1', 'wf1', GRAPHE(), { waId: '33600', contactId: 'c1' }, { depuis: 'entree', fenetreOuverte: true });
    const etat = cap.etats.at(-1);
    expect(etat?.status).toBe('waiting');
    expect(etat?.currentNode).toBe('t');
    expect(etat?.resumeAt?.getTime()).toBe(1_000_000 + 30 * 60_000);
  });

  it('sans délai, aucune échéance : le template attend sans limite, comme avant', async () => {
    const cap = capture();
    const g = GRAPHE({});
    const ex = monter(g, null, cap);
    await ex.demarrer('automatisme_ordinaire', 't1', 'wf1', g, { waId: '33600', contactId: 'c1' }, { depuis: 'entree', fenetreOuverte: true });
    expect(cap.etats.at(-1)?.resumeAt).toBeUndefined();
  });

  it('🔴 un clic part sur sa branche et efface l’échéance', async () => {
    const cap = capture();
    const ex = monter(GRAPHE(), enAttente(), cap);
    await ex.advance('t1', '33600', 'm1', 'btn:0');
    expect(cap.tags).toEqual(['clic']);
    expect(cap.etats.every((s) => s.resumeAt === undefined)).toBe(true);
  });

  it('🔴 à l’échéance, on sort par `timeout`, jamais par la sortie libre ni par le bouton', async () => {
    const cap = capture();
    const ex = monter(GRAPHE(), null, cap);
    expect(await ex.resume(enAttente())).toBe(true);
    expect(cap.tags).toEqual(['sans-reponse']);
  });

  it('🔴 sortie « pas de réponse » non câblée : le parcours se clôt et rend la main', async () => {
    const g = { ...GRAPHE(), edges: GRAPHE().edges.filter((x) => x.sourceHandle !== 'timeout') };
    const cap = capture();
    const ex = monter(g, null, cap);
    expect(await ex.resume(enAttente())).toBe(false);
    expect(cap.etats.at(-1)?.status).toBe('done');
    expect(cap.rendus).toEqual(['33600']);
  });

  it('🔴 fenêtre fermée au réveil : le message rapide de la sortie « pas de réponse » ne part pas', async () => {
    const g: WorkflowGraph = {
      nodes: [tpl({ timeoutValue: 30, timeoutUnit: 'minutes' }), n('rapide', 'quick_message', { body: 'Toujours là ?' })],
      edges: [e('e1', 't', 'rapide', 'timeout')],
    };
    const cap = capture();
    const ex = monter(g, null, cap, { isWindowOpen: async () => false });
    await ex.resume(enAttente());
    expect(cap.rapides).toEqual([]);
  });
});

/**
 * 🔴 LE CHEMIN DE MASSE (spec, décision 24, migration 0295). Un parcours né d'une campagne, d'un workflow HubSpot ou
 * d'un envoi API à un bloc se réveille par « Pas de réponse » en même temps pour tous ses destinataires : chaque
 * étiquette posée publierait un « tag ajouté », donc autant de scénarios lancés et facturés (invariant 8). Le drapeau est
 * figé à la naissance (`neEnMasse`) ; tant que le contact n'a pas répondu (`lastMessageId` nul), le réveil n'émet rien
 * et un « Aller à » saute en `aller_a_masse`. Après une réponse, ou pour un parcours unitaire, rien ne change.
 */
describe('🔴 une relance de masse n’émet rien tant que le contact n’a pas répondu', () => {
  const g: WorkflowGraph = {
    nodes: [tpl({ timeoutValue: 30, timeoutUnit: 'minutes' }), n('muet', 'tag', { tag: 'sans-reponse' })],
    edges: [e('e1', 't', 'muet', 'timeout')],
  };
  /** Ce que la reprise POSE et ce qu'elle ÉMET : une retenue qui ne poserait plus rien passerait sinon pour juste. */
  const relancer = async (run: WorkflowRunRow, graphe: WorkflowGraph = g): Promise<{ posees: string[]; emises: string[] }> => {
    const posees: string[] = [];
    const emises: string[] = [];
    const ex = monter(graphe, null, capture(), {
      applyTag: async (_t: string, _w: string, tag: string) => { posees.push(tag); },
      emitTagAdded: async (_t: string, _w: string, tag: string) => { emises.push(tag); },
    });
    await ex.resume(run);
    return { posees, emises };
  };

  it('né d’une campagne, sans réponse : l’étiquette est posée mais n’émet pas', async () => {
    expect(await relancer({ ...enAttente(), neEnMasse: true, lastMessageId: null })).toEqual({ posees: ['sans-reponse'], emises: [] });
  });

  it('né d’une campagne, APRÈS une réponse du contact : émet comme avant', async () => {
    expect(await relancer({ ...enAttente(), neEnMasse: true, lastMessageId: 'wamid.reponse' })).toEqual({ posees: ['sans-reponse'], emises: ['sans-reponse'] });
  });

  it('parcours unitaire (automation) : émet comme avant', async () => {
    expect(await relancer({ ...enAttente(), neEnMasse: false, lastMessageId: null })).toEqual({ posees: ['sans-reponse'], emises: ['sans-reponse'] });
  });

  it('🔴 le réveil d’une ATTENTE d’un parcours né d’une campagne émet comme avant : la retenue ne vise que « Pas de réponse »', async () => {
    // Relecture de 2a, point 3 : « Attente 1 jour puis étiquette » nourrit aujourd'hui une automation « étiquette
    // ajoutée ». La décision 24 ne vise que la relance « Pas de réponse » ; couper aussi ce réveil changerait en silence
    // un montage qui marche.
    const attente: WorkflowGraph = {
      nodes: [n('w', 'wait', { delay: 1, unit: 'days' }), n('j1', 'tag', { tag: 'relance_j1' })],
      edges: [e('e1', 'w', 'j1')],
    };
    const dormant: WorkflowRunRow = { ...enAttente(), status: 'sleeping', currentNode: 'w', neEnMasse: true, lastMessageId: null };
    expect(await relancer(dormant, attente)).toEqual({ posees: ['relance_j1'], emises: ['relance_j1'] });
  });

  it('un « Aller à » de la relance de masse saute en masse : l’étiquette du scénario d’arrivée n’émet pas', async () => {
    const depart: WorkflowGraph = {
      nodes: [tpl({ timeoutValue: 30, timeoutUnit: 'minutes' }), n('saut', 'aller_a', { cible: 'nod_ab_ARRIVEE0000000000000000000' })],
      edges: [e('e1', 't', 'saut', 'timeout')],
    };
    const arrivee: WorkflowGraph = { nodes: [n('a', 'tag', { tag: 'arrivee', code: 'nod_ab_ARRIVEE0000000000000000000' })], edges: [] };
    const tags: string[] = [];
    const posees: string[] = [];
    const ex = monter(depart, null, capture(), {
      emitTagAdded: async (_t: string, _w: string, tag: string) => { tags.push(tag); },
      applyTag: async (_t: string, _w: string, tag: string) => { posees.push(tag); },
      resoudreBloc: async () => ({ workflowId: 'wf2', nodeId: 'a', graph: arrivee }),
    });
    await ex.resume({ ...enAttente(), neEnMasse: true, lastMessageId: null });
    expect(posees).toEqual(['arrivee']);
    expect(tags).toEqual([]);
  });
});
