import { jamaisDesabonne, toujoursDAccord } from './consentement';
import { avecGardesDEtatInertes, depsInertes } from './executeur-inerte';
import { describe, it, expect, vi } from 'vitest';
import { PERIODE_RENOUVELLEMENT_MS } from '../src/workflow/bail-avance';
import { analyserFenetreDuMoteur } from '../src/workflow/fenetre-moteur';
import { delaiSansReponseMs, nextNodeHorsTimeout, sautsApresAttenteLongue, waitBeforeSessionMessage, walk } from '../src/workflow/engine';
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
const enAttente = (): WorkflowRunRow => ({ evenement: null,
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

/**
 * 🔴 L'ANALYSE DES LONGUES ATTENTES SUIT LA SORTIE « PAS DE RÉPONSE » (relecture de 2a, point 5). Elle remettait le
 * compteur à zéro sur tout template, « le parcours s'arrête au template jusqu'à la réponse » : faux dès qu'un délai est
 * posé, la sortie « Pas de réponse » partant SANS réponse. Le montage « template à 30 h, puis message rapide » ne partira
 * jamais, et un saut vers un autre scénario au bout de 30 h sans réponse se juge à la publication.
 */
describe('🔴 la sortie « Pas de réponse » relève de l’analyse de fenêtre, pas des longues attentes (relecture de 2b-1)', () => {
  const rapide = n('rapide', 'quick_message', { body: 'Toujours là ?' });

  it('template à 30 h, puis message rapide : l’analyse de fenêtre le signale, les longues attentes non', () => {
    const g: WorkflowGraph = { nodes: [tpl({ timeoutValue: 30, timeoutUnit: 'hours' }), rapide], edges: [e('e1', 't', 'rapide', 'timeout')] };
    expect(waitBeforeSessionMessage(g)).toBeNull();
    expect(analyserFenetreDuMoteur(g, [{ noeudId: null, fenetre: 'ouverte', raison: '' }]).map((c) => c.noeudId)).toEqual(['rapide']);
  });

  it('template à 30 min, puis message rapide : rien, la fenêtre peut être ouverte', () => {
    const g: WorkflowGraph = { nodes: [tpl({ timeoutValue: 30, timeoutUnit: 'minutes' }), rapide], edges: [e('e1', 't', 'rapide', 'timeout')] };
    expect(waitBeforeSessionMessage(g)).toBeNull();
  });

  it('la sortie de RÉPONSE remet toujours le compteur à zéro', () => {
    const g: WorkflowGraph = {
      nodes: [n('w', 'wait', { delay: 20, unit: 'hours' }), tpl({ timeoutValue: 30, timeoutUnit: 'minutes' }), n('w2', 'wait', { delay: 10, unit: 'hours' }), rapide],
      edges: [e('e0', 'w', 't'), e('e1', 't', 'w2', 'btn:0'), e('e2', 'w2', 'rapide')],
    };
    expect(waitBeforeSessionMessage(g)).toBeNull();
  });

  it('🔴 un saut vers un autre scénario après 2 jours sans réponse n’est PAS refusé à la publication : il est signalé', () => {
    // Décision 16 : prévenir, jamais refuser. Suivie par les longues attentes, cette sortie nourrissait
    // `refusDePublication`, alors que la même forme passe derrière une Question.
    const g: WorkflowGraph = {
      nodes: [tpl({ timeoutValue: 2, timeoutUnit: 'days' }), n('saut', 'aller_a', { cible: 'nod_ab_AILLEURS000000000000000000' })],
      edges: [e('e1', 't', 'saut', 'timeout')],
    };
    expect(sautsApresAttenteLongue(g)).toEqual([]);
    expect(analyserFenetreDuMoteur(g, [{ noeudId: null, fenetre: 'ouverte', raison: '' }]).map((c) => c.raison)).toEqual(['saut_fenetre_fermee']);
  });
});

/**
 * 🔴 LA REPRISE D'UNE ÉCHÉANCE RÉSERVE LE TOUR (relecture de 2a, point 1, démontré par `course.mts`). La réclamation du
 * balayage ne pose qu'un bail sur `resume_at` et le parcours reste `waiting` : une réponse du contact pendant que le lot
 * attend sa reprise passait par `advance`, et la reprise rejouait ensuite l'instantané réclamé, envoyait la relance EN
 * PLUS de la branche choisie, puis réécrivait le parcours sur la branche « Pas de réponse ». Elle réserve donc le tour
 * comme `advance` : refusé, rien ne part ; obtenu, l'état s'écrit sur le bloc attendu avec le jeton, et le tour se rend.
 */
describe('🔴 la reprise d’une échéance réserve le tour, comme une réponse', () => {
  interface Trace { reserves: string[]; conditions: unknown[]; ecritsGardes: Array<{ noeud: string | null; statut: string; jeton: string | null | undefined }>; vivants: number; rendus: string[] }
  const tracer = (reserve: string | null, ecritureAcceptee = true) => {
    const tr: Trace = { reserves: [], conditions: [], ecritsGardes: [], vivants: 0, rendus: [] };
    const runs = avecGardesDEtatInertes({
      start: async () => ({ id: 'r1' }),
      findWaitingByWaId: async () => null,
      setState: async () => {},
      closeActiveByWaId: async () => [],
      reserverAvance: async (_t: string, id: string, _n: string | null, _b: number, condition?: { lastMessageId: string | null }) => {
        tr.reserves.push(id);
        tr.conditions.push(condition);
        return reserve;
      },
      setStateSiEncoreSur: async (_t: string, _id: string, noeud: string | null, s: RunState, jeton?: string | null) => {
        tr.ecritsGardes.push({ noeud, statut: s.status, jeton });
        return ecritureAcceptee;
      },
      setStateSiVivant: async () => { tr.vivants += 1; return true; },
      libererAvance: async (_id: string, jeton: string) => { tr.rendus.push(jeton); },
    });
    return { tr, runs };
  };

  it('🔴 le tour refusé (une réponse est en cours) : rien ne part, rien ne s’écrit', async () => {
    const { tr, runs } = tracer(null);
    const cap = capture();
    const ex = monter(GRAPHE(), null, cap, { runs });
    expect(await ex.resume(enAttente())).toBe(false);
    expect(cap.tags).toEqual([]);
    expect(tr.ecritsGardes).toEqual([]);
    expect(tr.vivants).toBe(0);
  });

  it('🔴 le tour obtenu : l’état s’écrit sur le bloc attendu, avec le jeton, et le tour se rend', async () => {
    const { tr, runs } = tracer('jeton-1');
    const cap = capture();
    const ex = monter(GRAPHE(), null, cap, { runs });
    await ex.resume(enAttente());
    expect(cap.tags).toEqual(['sans-reponse']);
    expect(tr.ecritsGardes).toEqual([{ noeud: 't', statut: 'done', jeton: 'jeton-1' }]);
    expect(tr.vivants).toBe(0);
    expect(tr.rendus).toEqual(['jeton-1']);
  });

  it('le parcours a été remplacé pendant la reprise : l’écriture refusée arrête la suite', async () => {
    const { runs } = tracer('jeton-2', false);
    const cap = capture();
    const ex = monter(GRAPHE(), null, cap, { runs });
    expect(await ex.resume(enAttente())).toBe(false);
    // La fin ordinaire rend la main à l'agent de Meta : jamais sur un parcours qui n'est plus le nôtre.
    expect(cap.rendus).toEqual([]);
  });

  it('🔴 le tour se rend même quand un envoi jette', async () => {
    const { tr, runs } = tracer('jeton-3');
    const ex = monter(GRAPHE(), null, capture(), { runs, applyTag: async () => { throw new Error('base'); } });
    await expect(ex.resume(enAttente())).rejects.toThrow('base');
    expect(tr.rendus).toEqual(['jeton-3']);
  });

  it('🔴 la reprise réserve sous la condition du dernier message réclamé (relecture de 2b-1)', async () => {
    for (const lastMessageId of [null, 'wamid.vu']) {
      const { tr, runs } = tracer('jeton-5');
      await monter(GRAPHE(), null, capture(), { runs }).resume({ ...enAttente(), lastMessageId });
      expect(tr.conditions).toEqual([{ lastMessageId }]);
    }
  });

  it('🔴 un bail perdu pendant la reprise arrête les envois suivants, comme dans advance (relecture de 2b-1)', async () => {
    vi.useFakeTimers();
    try {
      let liberer!: () => void;
      const bloque = new Promise<void>((r) => { liberer = r; });
      const rapides: string[] = [];
      const runs = avecGardesDEtatInertes({
        start: async () => ({ id: 'r1' }),
        findWaitingByWaId: async () => null,
        setState: async () => {},
        closeActiveByWaId: async () => [],
        prolongerAvance: async () => false,
      });
      const g: WorkflowGraph = {
        nodes: [tpl({ timeoutValue: 30, timeoutUnit: 'minutes' }), n('un', 'quick_message', { body: 'un' }), n('deux', 'quick_message', { body: 'deux' })],
        edges: [e('e1', 't', 'un', 'timeout'), e('e2', 'un', 'deux')],
      };
      const ex = monter(g, null, capture(), {
        runs,
        sendQuickMessage: async (_t, _w, body) => { rapides.push(String(body)); if (body === 'un') await bloque; },
      });
      const reprise = ex.resume(enAttente());
      await vi.advanceTimersByTimeAsync(PERIODE_RENOUVELLEMENT_MS + 1_000);
      liberer();
      await reprise;
      expect(rapides).toEqual(['un']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('le réveil d’une Attente ne réserve rien : une réponse n’atteint pas un parcours endormi', async () => {
    const { tr, runs } = tracer('jeton-4');
    const attente: WorkflowGraph = { nodes: [n('w', 'wait', { delay: 1, unit: 'days' }), n('j1', 'tag', { tag: 'relance_j1' })], edges: [e('e1', 'w', 'j1')] };
    const ex = monter(attente, null, capture(), { runs });
    await ex.resume({ ...enAttente(), status: 'sleeping', currentNode: 'w' });
    expect(tr.reserves).toEqual([]);
    expect(tr.ecritsGardes).toEqual([]);
    expect(tr.vivants).toBe(1);
  });
});

/**
 * 🔴 UN CLIC SUR UN ANCIEN MESSAGE N'EST PAS UN BOUTON DU BLOC COURANT (relecture de 2a, point 2, démontré par
 * `clic-tardif.mts`). Les sorties sont positionnelles : taper « Je finalise » sur le PREMIER template, une fois la relance
 * partie, arrivait comme `btn:0` et prenait la branche « Oui, mon code -10 % » de la relance. Le message cité par le clic
 * est retrouvé dans les mesures des blocs : envoyé par un AUTRE bloc, le clic se lit comme une réponse écrite.
 */
describe('🔴 un clic sur un ancien message n’est pas un bouton du bloc courant', () => {
  const relance = (): WorkflowGraph => ({
    nodes: [
      n('t1', 'template', { templateName: 'panier', language: 'fr', templateButtons: [{ type: 'QUICK_REPLY', text: 'Je finalise' }], timeoutValue: 30, timeoutUnit: 'minutes' }),
      n('paiement', 'tag', { tag: 'lien_paiement' }),
      n('t2', 'template', { templateName: 'relance_moins_dix', language: 'fr', templateButtons: [{ type: 'QUICK_REPLY', text: 'Oui, mon code -10 %' }, { type: 'QUICK_REPLY', text: 'Non merci' }] }),
      n('code', 'tag', { tag: 'code_promo' }),
      n('non', 'tag', { tag: 'non_merci' }),
    ],
    edges: [e('e1', 't1', 'paiement', 'btn:0'), e('e2', 't1', 't2', 'timeout'), e('e3', 't2', 'code', 'btn:0'), e('e4', 't2', 'non', 'btn:1')],
  });
  const surLaRelance = (): WorkflowRunRow => ({ ...enAttente(), currentNode: 't2' });
  const blocs: Record<string, { workflowId: string; nodeId: string }> = {
    'wamid.premier': { workflowId: 'wf1', nodeId: 't1' },
    'wamid.relance': { workflowId: 'wf1', nodeId: 't2' },
  };
  const cliquer = async (messageCite: string | undefined): Promise<string[]> => {
    const cap = capture();
    const ex = monter(relance(), surLaRelance(), cap, { blocDuMessage: async (_t: string, wamid: string) => blocs[wamid] ?? null });
    await ex.advance('t1', '33600', 'wamid.clic', 'btn:0', 'whatsapp', { reaction: false, type: 'button', ...(messageCite ? { messageCite } : {}) });
    return cap.tags;
  };

  it('🔴 « Je finalise » tapé sur le PREMIER template ne part jamais vers « Oui, mon code -10 % »', async () => {
    expect(await cliquer('wamid.premier')).not.toContain('code_promo');
  });

  it('le clic sur la relance prend sa branche', async () => {
    expect(await cliquer('wamid.relance')).toEqual(['code_promo']);
  });

  it('un message inconnu (envoyé avant la mesure, ou ailleurs) garde le comportement d’avant', async () => {
    expect(await cliquer('wamid.inconnu')).toEqual(['code_promo']);
  });

  it('un clic sans message cité garde le comportement d’avant', async () => {
    expect(await cliquer(undefined)).toEqual(['code_promo']);
  });
});
