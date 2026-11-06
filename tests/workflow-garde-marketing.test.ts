import { describe, it, expect, vi } from 'vitest';
import { jamaisDesabonne, toujoursDesabonne } from './consentement';
import { avecGardesDEtatInertes, depsInertes } from './executeur-inerte';
import { WorkflowExecutor } from '../src/workflow/executor';
import type { WorkflowExecutorDeps } from '../src/workflow/executor';
import type { WorkflowGraph, WorkflowNodeType } from '../src/workflow/graph';
import type { RunState, WorkflowRunRow } from '../src/workflow/run-store.pg';
import { MOTIF_DESABONNE, MOTIF_SANS_ACCORD_MARKETING } from '../src/campaign/guardrails';
import { buildWorkflowRuntime } from '../src/workflow/wiring';
import { offresToutOuvert, filiereApiSeule } from './gardes';

/**
 * 🔴 LA GARDE MARKETING DANS L'EXÉCUTEUR (décision A du cadrage mm-hubspot du 2026-11-02, lot 3b), sur le VRAI
 * `WorkflowExecutor`. La table des lancements (`tests/workflow-lancements.test.ts`) prouve QUI l'exige au démarrage ; ce
 * fichier prouve qu'elle tient là où un parcours d'automation continue sans son type : le réveil d'une attente, la
 * réponse du contact, le bloc poussé par un agent, et un « Aller à » vers un autre scénario. Et ce qui se passe quand
 * elle refuse : les envois suivants sautés, le parcours clos SANS passer à l'équipe (un déclencheur de masse, un deal
 * HubSpot sur une étape peuplée, remplirait sinon « À traiter »).
 */

const n = (id: string, type: WorkflowNodeType, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const e = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
const code = (k: number): string => `nod_k7m2p3_01J${String(k).padStart(23, '0')}`;
const WA = '33611';
const promo = n('tpl', 'template', { templateName: 'promo', language: 'fr' });

/** « Attente, puis modèle Marketing » : l'automation qui relance deux jours plus tard. */
const ATTENTE_PUIS_PROMO: WorkflowGraph = { nodes: [n('w', 'wait', { delay: 2, unit: 'days' }), promo], edges: [e('w', 'tpl')] };
/** « Question à bouton, puis modèle Marketing » : la réponse du contact fait partir le Marketing. */
const QUESTION_PUIS_PROMO: WorkflowGraph = {
  nodes: [n('qm', 'quick_message', { body: 'Intéressé ?', quickReplies: ['Oui'] }), promo],
  edges: [e('qm', 'tpl', 'btn:0')],
};

const PARCOURS = (exige: boolean, currentNode: string, status: WorkflowRunRow['status']): WorkflowRunRow => ({
  id: 'run-1', workflowId: 'wf1', tenantId: 't1', waId: WA, contactId: 'c1',
  currentNode, status, lastMessageId: null, grapheFige: null, exigeAccordMarketing: exige,
});

/**
 * Le monde : une fiche dont l'accord se lit EN DIRECT (`fiche.accord`, que le bloc « consentement » du scénario peut
 * poser), un catalogue de modèles (`promo` Marketing, `rappel` Service), et ce que l'exécuteur a fait.
 */
function monde(graph: WorkflowGraph, run: WorkflowRunRow | null, surcharges: Partial<WorkflowExecutorDeps> = {}) {
  const fiche = { accord: false };
  const envois: string[] = [];
  const etiquettes: string[] = [];
  const etats: RunState[] = [];
  const escalades: string[] = [];
  const rendus: string[] = [];
  const sautsJournalises: string[] = [];
  const mesures: string[] = [];
  const lecturesAccord: string[] = [];
  /** La règle figée de chaque parcours créé (`runs.start`, dernier argument). */
  const crees: boolean[] = [];
  const deps: WorkflowExecutorDeps = {
    ...depsInertes,
    estDesabonne: jamaisDesabonne,
    categorieDuModele: async (_t, nom) => (nom === 'promo' ? 'marketing' : nom === 'rappel' ? 'utility' : null),
    aAccordMarketing: async (_t, waId) => { lecturesAccord.push(waId); return fiche.accord; },
    setOptIn: async (_t, _w, v) => { fiche.accord = v === 'opted_in'; },
    runs: avecGardesDEtatInertes({
      start: async (...a: Parameters<WorkflowExecutorDeps['runs']['start']>) => { crees.push(a[6]); return { id: 'run-2' }; },
      findWaitingByWaId: async () => (run && run.status === 'waiting' ? run : null),
      setState: async (_id: string, s: RunState) => { etats.push(s); },
      closeActiveByWaId: async () => [],
    }),
    getGraph: async () => graph,
    applyTag: async (_t, _w, tag) => { etiquettes.push(tag); return true; },
    setField: async () => {},
    removeTag: async () => {},
    clearField: async () => {},
    sendTemplate: async (_t, _w, nom) => { envois.push(`modèle ${nom}`); },
    sendQuickMessage: async (_t, _w, texte) => { envois.push(`message ${texte}`); },
    sendFlow: async () => {},
    sendQuestion: async () => {},
    recordNodeEvent: async (ev) => { mesures.push(`${ev.nodeId}:${ev.kind}`); },
    escalateToHuman: async (_t, w) => { escalades.push(w); },
    // L'agent de Meta répond : une fin de parcours lui rend la main, et un modèle sans bouton ne bloque pas le parcours.
    mbaActifPour: async () => true,
    releaseToMba: async (_t, w) => { rendus.push(w); },
    journaliserEchecSaut: async (ev) => { sautsJournalises.push(ev.erreur); },
    ...surcharges,
  };
  return { executor: new WorkflowExecutor(deps), fiche, envois, etiquettes, etats, escalades, rendus, sautsJournalises, mesures, lecturesAccord, crees };
}

function silence(): void {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('au démarrage d’une automation : le bloc refusé, et ce qui le suit', () => {
  /** « Étiquette, Marketing, message rapide, étiquette » : un Marketing refusé ne laisse pas partir sa suite orpheline. */
  const MARKETING_PUIS_SUITE: WorkflowGraph = {
    nodes: [n('t1', 'tag', { tag: 'avant' }), promo, n('qm', 'quick_message', { body: 'Et vous ?' }), n('t2', 'tag', { tag: 'apres' })],
    edges: [e('t1', 'tpl'), e('tpl', 'qm'), e('qm', 't2')],
  };

  it('🔴 sans accord : le Marketing ET les envois qui le suivent sont sautés, les étiquettes posées, rien n’est créé', async () => {
    silence();
    const m = monde(MARKETING_PUIS_SUITE, null);
    const issue = await m.executor.demarrer('automatisme_ordinaire', 't1', 'wf1', MARKETING_PUIS_SUITE, { waId: WA, contactId: 'c1' },
      { depuis: 'entree', fenetreOuverte: true });
    expect(issue).toBe(MOTIF_SANS_ACCORD_MARKETING);
    expect(m.envois).toEqual([]);
    expect(m.etiquettes).toEqual(['avant', 'apres']);
    expect(m.mesures).toEqual(['tpl:failed', 'qm:failed']);
    expect(m.etats).toEqual([]);
  });

  it('avec l’accord : tout part (l’autre sens)', async () => {
    const m = monde(MARKETING_PUIS_SUITE, null);
    m.fiche.accord = true;
    expect(await m.executor.demarrer('automatisme_ordinaire', 't1', 'wf1', MARKETING_PUIS_SUITE, { waId: WA, contactId: 'c1' },
      { depuis: 'entree', fenetreOuverte: true })).toBe(true);
    expect(m.envois).toEqual(['modèle promo', 'message Et vous ?']);
  });

  it('🔴 le bloc « consentement » du scénario, posé AVANT le Marketing, vaut accord : la fiche est relue en direct', async () => {
    const g: WorkflowGraph = { nodes: [n('ok', 'action', { actionKind: 'set_optin' }), promo], edges: [e('ok', 'tpl')] };
    const m = monde(g, null);
    expect(await m.executor.demarrer('automatisme_ordinaire', 't1', 'wf1', g, { waId: WA, contactId: 'c1' },
      { depuis: 'entree', fenetreOuverte: true })).toBe(true);
    expect(m.envois).toEqual(['modèle promo']);
  });

  it('l’accord n’est lu qu’une fois par liste d’effets, et jamais pour un Service', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [n('r', 'template', { templateName: 'rappel', language: 'fr' }), promo, n('p2', 'template', { templateName: 'promo', language: 'fr' })],
      edges: [e('r', 'tpl'), e('tpl', 'p2')],
    };
    const m = monde(g, null);
    m.fiche.accord = true;
    expect(await m.executor.demarrer('automatisme_ordinaire', 't1', 'wf1', g, { waId: WA, contactId: 'c1' },
      { depuis: 'entree', fenetreOuverte: true })).toBe(true);
    expect(m.envois).toEqual(['modèle rappel', 'modèle promo', 'modèle promo']);
    expect(m.lecturesAccord).toEqual([WA]);
  });
});

/**
 * 🔴 UNE CAMPAGNE À SCÉNARIO (décision de Julien du 2026-11-05, la règle la moins stricte). Sa liste est triée à la
 * construction sur la catégorie cochée pour la campagne, qui décrit son modèle d'OUVERTURE : celui-là part sans la garde
 * (sinon une campagne cochée Service sur un modèle Marketing verrait ses destinataires refusés, comptés en échec par la
 * porte de qualité). Tout modèle Marketing qui le SUIT est vérifié au moment de partir, et la règle se fige pour les reprises.
 */
describe('🔴 une campagne à scénario : l’ouverture exemptée, la suite gardée', () => {
  const rappel = n('r', 'template', { templateName: 'rappel', language: 'fr' });
  const ouvrir = (m: ReturnType<typeof monde>, g: WorkflowGraph) =>
    m.executor.demarrer('campagne_scenario', 't1', 'wf1', g, { waId: WA, contactId: 'c1' }, { depuis: 'entree', firstTemplateParams: [] });

  it('🔴 l’ouverture Marketing part sans accord ni lecture de l’accord, et la règle se FIGE vraie pour la suite', async () => {
    const g: WorkflowGraph = { nodes: [promo], edges: [] };
    // Sans l'agent de Meta répondeur, le modèle bloque : le parcours naît en attente de la réponse.
    const m = monde(g, null, { mbaActifPour: async () => false });
    expect(await ouvrir(m, g)).toBe(true);
    expect(m.envois).toEqual(['modèle promo']);
    expect(m.lecturesAccord, 'l’ouverture a été triée à la construction').toEqual([]);
    expect(m.crees).toEqual([true]);
  });

  it('🔴 deux Marketing dans la liste du démarrage (l’agent de Meta répond) : seul le premier est exempté, le second est refusé sans accord', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [promo, n('p2', 'template', { templateName: 'promo', language: 'fr' }), n('t', 'tag', { tag: 'apres' })],
      edges: [e('tpl', 'p2'), e('p2', 't')],
    };
    const m = monde(g, null);
    expect(await ouvrir(m, g), 'l’ouverture est partie : le parcours vit').toBe(true);
    expect(m.envois).toEqual(['modèle promo']);
    expect(m.mesures).toContain('p2:failed');
    expect(m.etiquettes, 'les étiquettes se posent encore').toEqual(['apres']);
    expect(m.lecturesAccord).toEqual([WA]);
  });

  it('🔴 « Service, puis Marketing » dans la liste du démarrage : l’exemption est consommée par le PREMIER modèle, le Service', async () => {
    silence();
    const g: WorkflowGraph = { nodes: [rappel, promo], edges: [e('r', 'tpl')] };
    const m = monde(g, null);
    expect(await ouvrir(m, g)).toBe(true);
    expect(m.envois, 'le Marketing qui suit n’hérite pas de l’exemption').toEqual(['modèle rappel']);
    expect(m.lecturesAccord).toEqual([WA]);
  });

  it('🔴 « Service à bouton, puis Marketing » : à la réponse du contact, refusé sans accord, clos sans équipe ; parti avec', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [n('r', 'template', { templateName: 'rappel', language: 'fr', templateButtons: [{ type: 'QUICK_REPLY', text: 'Voir' }] }), promo],
      edges: [e('r', 'tpl', 'btn:0')],
    };
    for (const accord of [false, true]) {
      const m = monde(g, null, { mbaActifPour: async () => false });
      m.fiche.accord = accord;
      expect(await ouvrir(m, g)).toBe(true);
      expect(m.envois).toEqual(['modèle rappel']);
      expect(m.crees).toEqual([true]);
      const apres = monde(g, PARCOURS(m.crees[0]!, 'r', 'waiting'), { mbaActifPour: async () => false });
      apres.fiche.accord = accord;
      await apres.executor.advance('t1', WA, 'wamid.1', 'btn:0');
      expect(apres.envois, `accord ${accord}`).toEqual(accord ? ['modèle promo'] : []);
      expect(apres.escalades).toEqual([]);
      if (!accord) expect(apres.etats).toEqual([{ currentNode: null, status: 'done', lastMessageId: 'wamid.1' }]);
    }
  });

  it('le même démarrage AVEC l’accord : tout part (l’autre sens)', async () => {
    const g: WorkflowGraph = {
      nodes: [promo, n('p2', 'template', { templateName: 'promo', language: 'fr' })],
      edges: [e('tpl', 'p2')],
    };
    const m = monde(g, null);
    m.fiche.accord = true;
    expect(await ouvrir(m, g)).toBe(true);
    expect(m.envois).toEqual(['modèle promo', 'modèle promo']);
  });

  /** « Service, attente, Marketing » : le trou du lot 3b, une relance Marketing derrière une ouverture Service. */
  const SERVICE_ATTENTE_PROMO: WorkflowGraph = {
    nodes: [rappel, n('w', 'wait', { delay: 2, unit: 'days' }), promo],
    edges: [e('r', 'w'), e('w', 'tpl')],
  };

  it('🔴 « Service, attente, Marketing » sans accord : le Service part à tous, le Marketing est refusé au réveil, clos sans équipe', async () => {
    silence();
    const m = monde(SERVICE_ATTENTE_PROMO, null);
    expect(await ouvrir(m, SERVICE_ATTENTE_PROMO)).toBe(true);
    expect(m.envois, 'l’audience ne bouge pas').toEqual(['modèle rappel']);
    expect(m.crees).toEqual([true]);
    // Le réveil relit la règle FIGÉE dans le parcours, pas le type de lancement.
    expect(await m.executor.resume(PARCOURS(m.crees[0]!, 'w', 'sleeping'))).toBe(false);
    expect(m.envois).toEqual(['modèle rappel']);
    expect(m.etats.at(-1)).toEqual({ currentNode: null, status: 'done' });
    expect(m.escalades, 'une campagne ne remplit pas « À traiter »').toEqual([]);
  });

  it('« Service, attente, Marketing » avec l’accord : le Marketing part au réveil', async () => {
    const m = monde(SERVICE_ATTENTE_PROMO, null);
    m.fiche.accord = true;
    expect(await ouvrir(m, SERVICE_ATTENTE_PROMO)).toBe(true);
    expect(await m.executor.resume(PARCOURS(m.crees[0]!, 'w', 'sleeping'))).toBe(true);
    expect(m.envois).toEqual(['modèle rappel', 'modèle promo']);
  });

  it('un départ à un bloc (pas l’entrée) n’exempte rien : seule l’ouverture d’une campagne l’est', async () => {
    silence();
    const m = monde(SERVICE_ATTENTE_PROMO, null);
    expect(await m.executor.demarrer('campagne_scenario', 't1', 'wf1', SERVICE_ATTENTE_PROMO, { waId: WA, contactId: 'c1' },
      { depuis: 'bloc', noeudId: 'tpl' })).toBe(MOTIF_SANS_ACCORD_MARKETING);
    expect(m.envois).toEqual([]);
  });
});

describe('🔴 le réveil d’une attente (`resume`) garde la règle du parcours', () => {
  it('parcours d’automation, sans accord : rien ne part, le parcours est CLOS sans passer à l’équipe, la main revient à l’agent', async () => {
    silence();
    const m = monde(ATTENTE_PUIS_PROMO, null);
    expect(await m.executor.resume(PARCOURS(true, 'w', 'sleeping'))).toBe(false);
    expect(m.envois).toEqual([]);
    expect(m.etats).toEqual([{ currentNode: null, status: 'done' }]);
    expect(m.escalades, 'un déclencheur de masse ne remplit pas « À traiter »').toEqual([]);
    expect(m.rendus).toEqual([WA]);
  });

  it('parcours d’automation, accord donné PENDANT l’attente : le Marketing part (lu au réveil, pas au déclenchement)', async () => {
    const m = monde(ATTENTE_PUIS_PROMO, null);
    m.fiche.accord = true;
    expect(await m.executor.resume(PARCOURS(true, 'w', 'sleeping'))).toBe(true);
    expect(m.envois).toEqual(['modèle promo']);
  });

  it('parcours né avant la garde (colonne à false) : il finit comme avant, sans accord', async () => {
    const m = monde(ATTENTE_PUIS_PROMO, null);
    expect(await m.executor.resume(PARCOURS(false, 'w', 'sleeping'))).toBe(true);
    expect(m.envois).toEqual(['modèle promo']);
  });

  it('un AUTRE refus sans rien de parti (le STOP) passe toujours à l’équipe : la clôture silencieuse ne vaut que pour l’accord', async () => {
    silence();
    const m = monde(ATTENTE_PUIS_PROMO, null, { estDesabonne: toujoursDesabonne });
    expect(await m.executor.resume(PARCOURS(true, 'w', 'sleeping'))).toBe(false);
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox' }]);
    expect(m.escalades).toEqual([WA]);
  });

  /** Après l'attente, la fenêtre de 24 h est fermée : le message rapide ne pourrait de toute façon pas partir. */
  const fenetreFermee = { isWindowOpen: async () => false };

  it('🔴 « attendre, Marketing, message rapide », fenêtre fermée, sans accord : CLOS sans passer à l’équipe', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [n('w', 'wait', { delay: 2, unit: 'days' }), promo, n('qm', 'quick_message', { body: 'Et vous ?' })],
      edges: [e('w', 'tpl'), e('tpl', 'qm')],
    };
    const m = monde(g, null, fenetreFermee);
    expect(await m.executor.resume(PARCOURS(true, 'w', 'sleeping'))).toBe(false);
    expect(m.envois).toEqual([]);
    expect(m.etats).toEqual([{ currentNode: null, status: 'done' }]);
    expect(m.escalades, 'la règle marketing, pas la fenêtre, a arrêté le parcours').toEqual([]);
    expect(m.rendus).toEqual([WA]);
  });

  it('« attendre, message rapide, Marketing », fenêtre fermée : le message rapide manqué passe toujours à l’équipe', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [n('w', 'wait', { delay: 2, unit: 'days' }), n('qm', 'quick_message', { body: 'Et vous ?' }), promo],
      edges: [e('w', 'qm'), e('qm', 'tpl')],
    };
    const m = monde(g, null, fenetreFermee);
    expect(await m.executor.resume(PARCOURS(true, 'w', 'sleeping'))).toBe(false);
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox' }]);
    expect(m.escalades).toEqual([WA]);
  });

  it('« attendre, e-mail, message rapide, Marketing », fenêtre fermée : l’e-mail parti ne compte pas, le message rapide manqué passe à l’équipe', async () => {
    silence();
    const email = n('em', 'email', { emailAccountId: 'a1', templateId: 't1', to: { kind: 'literal', value: 'client@exemple.fr' } });
    const g: WorkflowGraph = {
      nodes: [n('w', 'wait', { delay: 2, unit: 'days' }), email, n('qm', 'quick_message', { body: 'Et vous ?' }), promo],
      edges: [e('w', 'em'), e('em', 'qm'), e('qm', 'tpl')],
    };
    const courriels: string[] = [];
    const m = monde(g, null, { ...fenetreFermee, sendEmail: async (_t, w) => { courriels.push(w); } });
    expect(await m.executor.resume(PARCOURS(true, 'w', 'sleeping'))).toBe(false);
    expect(courriels).toEqual([WA]);
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox' }]);
    expect(m.escalades).toEqual([WA]);
  });

  it('« attendre, Marketing, agent », fenêtre fermée, sans accord : CLOS sans passer à l’équipe, l’agent n’est pas réveillé', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [n('w', 'wait', { delay: 2, unit: 'days' }), promo, n('a', 'agent', { agentId: 'ag1' })],
      edges: [e('w', 'tpl'), e('tpl', 'a')],
    };
    const m = monde(g, null, fenetreFermee);
    expect(await m.executor.resume(PARCOURS(true, 'w', 'sleeping'))).toBe(false);
    expect(m.etats).toEqual([{ currentNode: null, status: 'done' }]);
    expect(m.escalades).toEqual([]);
  });

  it('« attendre, Marketing, message rapide », fenêtre fermée, AVEC l’accord : le Marketing part, le message manqué passe à l’équipe', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [n('w', 'wait', { delay: 2, unit: 'days' }), promo, n('qm', 'quick_message', { body: 'Et vous ?' })],
      edges: [e('w', 'tpl'), e('tpl', 'qm')],
    };
    const m = monde(g, null, fenetreFermee);
    m.fiche.accord = true;
    expect(await m.executor.resume(PARCOURS(true, 'w', 'sleeping'))).toBe(false);
    expect(m.envois).toEqual(['modèle promo']);
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox' }]);
    expect(m.escalades).toEqual([WA]);
  });
});

describe('🔴 la réponse du contact (`advance`) garde la règle du parcours', () => {
  it('parcours d’automation, sans accord : le Marketing ne part pas, le parcours est clos sans passer à l’équipe', async () => {
    silence();
    const m = monde(QUESTION_PUIS_PROMO, PARCOURS(true, 'qm', 'waiting'));
    await m.executor.advance('t1', WA, 'wamid.1', 'btn:0');
    expect(m.envois).toEqual([]);
    expect(m.etats).toEqual([{ currentNode: null, status: 'done', lastMessageId: 'wamid.1' }]);
    expect(m.escalades).toEqual([]);
    expect(m.rendus).toEqual([WA]);
  });

  it('parcours libre (l’Inbox, une campagne à bloc) : la réponse fait partir le Marketing comme avant', async () => {
    const m = monde(QUESTION_PUIS_PROMO, PARCOURS(false, 'qm', 'waiting'));
    await m.executor.advance('t1', WA, 'wamid.1', 'btn:0');
    expect(m.envois).toEqual(['modèle promo']);
  });

  it('le STOP prime : désabonné, le refus est celui du STOP, et il passe à l’équipe comme avant', async () => {
    silence();
    const m = monde(QUESTION_PUIS_PROMO, PARCOURS(true, 'qm', 'waiting'), { estDesabonne: toujoursDesabonne });
    m.fiche.accord = true;
    await m.executor.advance('t1', WA, 'wamid.1', 'btn:0');
    expect(m.envois).toEqual([]);
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox', lastMessageId: 'wamid.1' }]);
    expect(m.escalades).toEqual([WA]);
  });
});

describe('🔴 le bloc poussé par un agent (`envoyerBlocDepuisAgent`) garde la règle du parcours de l’agent', () => {
  const graphe: WorkflowGraph = { nodes: [n('a', 'agent', { agentId: 'ag1' }), promo], edges: [] };
  for (const exige of [true, false]) {
    it(`parcours ${exige ? 'd’automation : refusé, avec le motif' : 'libre : parti'}`, async () => {
      silence();
      const m = monde(graphe, PARCOURS(exige, 'a', 'waiting'));
      const r = await m.executor.envoyerBlocDepuisAgent('t1', WA, { runId: 'run-1', workflowId: 'wf1', graphe, noeudId: 'tpl' });
      expect(r).toEqual(exige ? { ok: false, raison: MOTIF_SANS_ACCORD_MARKETING } : { ok: true });
      expect(m.envois).toEqual(exige ? [] : ['modèle promo']);
    });
  }
});

describe('🔴 un « Aller à » vers un autre scénario hérite la règle', () => {
  const SAUT: WorkflowGraph = { nodes: [n('w', 'wait', { delay: 1, unit: 'days' }), n('j', 'aller_a', { cible: code(2) })], edges: [e('w', 'j')] };
  const ARRIVEE: WorkflowGraph = { nodes: [n('tpl2', 'template', { templateName: 'promo', language: 'fr', code: code(2) })], edges: [] };
  const resoudreBloc = async () => ({ workflowId: 'wf2', nodeId: 'tpl2', graph: ARRIVEE });

  it('au réveil d’un parcours d’automation, sans accord : le scénario d’arrivée ne part pas, sans équipe ni journal des échecs', async () => {
    silence();
    const m = monde(SAUT, null, { resoudreBloc });
    expect(await m.executor.resume(PARCOURS(true, 'w', 'sleeping'))).toBe(true);
    expect(m.envois).toEqual([]);
    expect(m.escalades).toEqual([]);
    expect(m.sautsJournalises, 'une règle, pas un trou de montage').toEqual([]);
    expect(m.rendus).toEqual([WA]);
  });

  it('le même saut depuis un parcours libre : le Marketing d’arrivée part (l’autre sens)', async () => {
    const m = monde(SAUT, null, { resoudreBloc });
    expect(await m.executor.resume(PARCOURS(false, 'w', 'sleeping'))).toBe(true);
    expect(m.envois).toEqual(['modèle promo']);
  });

  it('au démarrage d’une automation qui ouvre par le saut : refusé de même', async () => {
    silence();
    const g: WorkflowGraph = { nodes: [n('j', 'aller_a', { cible: code(2) })], edges: [] };
    const m = monde(g, null, { resoudreBloc });
    // Le démarrage qui a franchi le saut a bien eu lieu (`runFrom` rend `true`) ; c'est le scénario d'arrivée qui refuse.
    expect(await m.executor.demarrer('automatisme_ordinaire', 't1', 'wf1', g, { waId: WA, contactId: 'c1' },
      { depuis: 'entree', fenetreOuverte: true })).toBe(true);
    expect(m.envois).toEqual([]);
    expect(m.escalades).toEqual([]);
  });
});

/**
 * LE VRAI CÂBLAGE (`buildWorkflowRuntime`), monté sans base comme dans `tests/workflow-lancements.test.ts`. La catégorie se
 * lit sur le MÊME cache que l'envoi (une seule lecture chez Meta pour la garde et `templateVarInfo`), une lecture en échec
 * rend « illisible » ; l'accord se lit sur le store ENTIER, par une méthode qui garde son `this` (règle du dépôt : une
 * méthode de store détachée perd son pool, et un objet de `vi.fn` masquerait la panne).
 */
describe('🔴 le câblage des deux dépendances', () => {
  class FichesQuiLisentThis {
    private readonly statut = new Map([['33611', 'opted_in']]);
    lus: string[] = [];
    async aAccordMarketingParWaId(t: string, waId: string): Promise<boolean> {
      this.lus.push(`${t}/${waId}`);
      return this.statut.get(waId) === 'opted_in';
    }
  }
  function cablage(list: () => Promise<unknown[]>) {
    const inerte = {} as never;
    const fiches = new FichesQuiLisentThis();
    let lecturesMeta = 0;
    const runtime = buildWorkflowRuntime({
      pool: inerte, queue: { enqueue: async () => {} }, dryRun: true,
      repo: { getTenantWabaId: async () => 'waba-1' } as never,
      contactStore: fiches as never,
      inboxStore: inerte, settingsStore: inerte, workflowStore: inerte, metaCredentials: inerte,
      metaFactory: { templateClientForTenant: async () => ({ list: async () => { lecturesMeta += 1; return list(); } }) } as never,
      rcsProvider: 'fake', emailTemplates: inerte, emailResolver: inerte, numeroDeLEspace: async () => null, runStore: inerte,
      fil: inerte, offres: offresToutOuvert, prevenirEquipe: async () => {}, application: filiereApiSeule, magasinObjets: null, connecteurHubspot: null,
    });
    const deps = Reflect.get(runtime.executor, 'deps') as WorkflowExecutorDeps;
    return { runtime, deps, fiches, lectures: () => lecturesMeta };
  }
  const modele = { id: 'm1', name: 'promo', status: 'APPROVED', category: 'MARKETING', language: 'fr', body: 'Bonjour', headerFormat: null };

  it('la catégorie vient du cache de l’envoi : en minuscules, et une seule lecture chez Meta pour la garde ET l’envoi', async () => {
    const c = cablage(async () => [modele]);
    expect(await c.deps.categorieDuModele('t1', 'promo', 'fr')).toBe('marketing');
    expect((await c.runtime.templateVarInfo('t1', 'promo', 'fr'))?.category).toBe('marketing');
    expect(await c.deps.categorieDuModele('t1', 'promo', 'fr'), 'le destinataire suivant').toBe('marketing');
    expect(c.lectures()).toBe(1);
  });

  it('modèle introuvable ou Meta en panne : illisible (`null`), jamais une exception qui tuerait le parcours', async () => {
    silence();
    expect(await cablage(async () => []).deps.categorieDuModele('t1', 'promo', 'fr')).toBeNull();
    expect(await cablage(async () => { throw new Error('Meta injoignable'); }).deps.categorieDuModele('t1', 'promo', 'fr')).toBeNull();
  });

  it('l’accord est lu sur le store, sans perdre son `this`', async () => {
    const c = cablage(async () => [modele]);
    expect(await c.deps.aAccordMarketing('t1', '33611')).toBe(true);
    expect(await c.deps.aAccordMarketing('t1', '33699')).toBe(false);
    expect(c.fiches.lus).toEqual(['t1/33611', 't1/33699']);
  });
});

describe('le STOP reste avant la garde', () => {
  it('désabonné : le motif est celui du STOP, et l’accord n’est même pas lu', async () => {
    silence();
    const m = monde(ATTENTE_PUIS_PROMO, null, { estDesabonne: toujoursDesabonne });
    m.fiche.accord = true;
    expect(await m.executor.demarrer('automatisme_ordinaire', 't1', 'wf1', ATTENTE_PUIS_PROMO, { waId: WA, contactId: 'c1' },
      { depuis: 'bloc', noeudId: 'tpl' })).toBe(MOTIF_DESABONNE);
    expect(m.lecturesAccord).toEqual([]);
  });
});
