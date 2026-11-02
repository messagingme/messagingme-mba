import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { brancheHumainMuette, creerSeTaitApresEscalade } from '../src/workflow/branche-humain';
import { grapheDuRepondeur, BLOC_AGENT_REPONDEUR } from '../src/repondeur/graphe';
import { compilerRecette, type ReferencesResolues } from '../src/workflow/recette-graphe';
import type { WorkflowGraph, WorkflowNode } from '../src/workflow/graph';

/**
 * LA PHRASE D'ESCALADE QU'AUCUNE BRANCHE NE DIT (essai réel du 2026-11-02, scénario créé par l'API) : l'agent a passé la
 * main en écrivant « Un conseiller SMATIS prend le relais… », le cerveau a jeté la phrase parce que le parcours n'était
 * pas le répondeur, et la sortie `humain` menait à une fin muette : le contact n'a rien reçu.
 */
const bloc = (id: string, type: WorkflowNode['type'], data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data });
const humain = (cible: string) => ({ id: `a>${cible}`, source: 'a', target: cible, sourceHandle: 'sortie:humain' });
const libre = (source: string, cible: string) => ({ id: `${source}>${cible}`, source, target: cible });
const agent = bloc('a', 'agent', { agentId: 'ag-1' });

describe('brancheHumainMuette', () => {
  it('🔴 la recette de l’API (sortie humain vers un bloc Action vide) est muette', () => {
    const g: WorkflowGraph = { nodes: [agent, bloc('fin', 'action', { name: 'Fin' })], edges: [humain('fin')] };
    expect(brancheHumainMuette(g, 'a')).toBe(true);
  });

  it('🔴 le graphe que compile VRAIMENT une recette à agent est muet sur son bloc agent', () => {
    const AGENT = '7f6b1c2e-1d2a-4b3c-8d4e-5f6a7b8c9d0e';
    const refs: ReferencesResolues = {
      templates: new Map(),
      agents: new Map([[AGENT, { actif: true, label: 'Conseiller', sorties: [{ code: 'devis', label: 'Veut un devis' }] }]]),
      champs: new Set(),
    };
    const c = compilerRecette({ message: { texte: 'Je vous passe notre assistant.' }, suite: { agent: { agent_id: AGENT } } }, refs, null);
    if (!c.ok) throw new Error('recette attendue valide');
    const blocAgent = c.valeur.nodes.find((n) => n.type === 'agent')!;
    expect(brancheHumainMuette(c.valeur, blocAgent.id)).toBe(true);
  });

  it('le répondeur est muet, par le même critère', () => {
    expect(brancheHumainMuette(grapheDuRepondeur({ id: 'ag-1', sorties: [] }), BLOC_AGENT_REPONDEUR)).toBe(true);
  });

  it('des actions enchaînées puis rien sont muettes', () => {
    const g: WorkflowGraph = {
      nodes: [agent, bloc('t', 'action', { actionKind: 'add_tag', tag: 'vip' }), bloc('f', 'action', { actionKind: 'set_field', fieldKey: 'k', value: 'v' })],
      edges: [humain('t'), libre('t', 'f')],
    };
    expect(brancheHumainMuette(g, 'a')).toBe(true);
  });

  it('« Passer à un humain » ne l’est pas : il bascule le fil avant l’escalade, la phrase serait jetée quand même', () => {
    // Relecture du lot : compté muet, le cas aurait été annoncé couvert sans l'être (`run-turn`, main perdue).
    const g: WorkflowGraph = {
      nodes: [agent, bloc('t', 'action', { actionKind: 'add_tag', tag: 'vip' }), bloc('h', 'inbox', { assigneA: 'u-1' })],
      edges: [humain('t'), libre('t', 'h')],
    };
    expect(brancheHumainMuette(g, 'a')).toBe(false);
  });

  it('une branche qui parle ne l’est pas, même après des actions : une seule voix', () => {
    const parle: WorkflowGraph = { nodes: [agent, bloc('m', 'quick_message', { body: 'Un conseiller arrive' })], edges: [humain('m')] };
    expect(brancheHumainMuette(parle, 'a')).toBe(false);
    const apres: WorkflowGraph = {
      nodes: [agent, bloc('t', 'action', { actionKind: 'add_tag', tag: 'vip' }), bloc('m', 'quick_message', { body: 'x' })],
      edges: [humain('t'), libre('t', 'm')],
    };
    expect(brancheHumainMuette(apres, 'a')).toBe(false);
  });

  it('dans le doute, parlante : sortie non câblée, autre sortie seule, condition, bifurcation, boucle, bloc absent', () => {
    const fin = bloc('fin', 'action');
    expect(brancheHumainMuette({ nodes: [agent, fin], edges: [] }, 'a')).toBe(false);
    expect(brancheHumainMuette({ nodes: [agent, fin], edges: [{ id: 'x', source: 'a', target: 'fin', sourceHandle: 'timeout' }] }, 'a')).toBe(false);
    expect(brancheHumainMuette({ nodes: [agent, bloc('c', 'condition')], edges: [humain('c')] }, 'a')).toBe(false);
    const deux: WorkflowGraph = { nodes: [agent, bloc('t', 'action'), fin, bloc('g', 'action')], edges: [humain('t'), libre('t', 'fin'), libre('t', 'g')] };
    expect(brancheHumainMuette(deux, 'a')).toBe(false);
    const boucle: WorkflowGraph = { nodes: [agent, bloc('t', 'action'), bloc('u', 'action')], edges: [humain('t'), libre('t', 'u'), libre('u', 't')] };
    expect(brancheHumainMuette(boucle, 'a')).toBe(false);
    expect(brancheHumainMuette({ nodes: [agent], edges: [humain('fantome')] }, 'a')).toBe(false);
  });
});

describe('creerSeTaitApresEscalade', () => {
  const muet: WorkflowGraph = { nodes: [agent, bloc('fin', 'action')], edges: [humain('fin')] };
  const parlant: WorkflowGraph = { nodes: [agent, bloc('m', 'quick_message', { body: 'x' })], edges: [humain('m')] };

  // Des classes dont les méthodes lisent `this` : un câblage qui les détacherait de leur objet casserait ici.
  class Scenarios {
    constructor(private readonly lignes: Record<string, { systeme: 'repondeur' | null; graph: WorkflowGraph }>) {}
    async designation(id: string) { const l = this.lignes[id]; return l ? { nom: id, systeme: l.systeme } : null; }
    async getById(id: string) { const l = this.lignes[id]; return l ? { graph: l.graph } as never : null; }
  }
  class Parcours {
    constructor(private readonly lignes: Record<string, WorkflowGraph | null>) {}
    async byId(_t: string, id: string) { return id in this.lignes ? { grapheFige: this.lignes[id] ?? null } as never : null; }
  }

  it('le répondeur se tait, sans lire le graphe', async () => {
    const f = creerSeTaitApresEscalade({ workflows: new Scenarios({ w: { systeme: 'repondeur', graph: parlant } }), runs: new Parcours({}) });
    expect(await f('t', 'w', 'r', 'a')).toBe(true);
  });

  it('🔴 un scénario publié dont l’escalade finit muette se tait ; parlant, non', async () => {
    const runs = new Parcours({ r: null });
    expect(await creerSeTaitApresEscalade({ workflows: new Scenarios({ w: { systeme: null, graph: muet } }), runs })('t', 'w', 'r', 'a')).toBe(true);
    expect(await creerSeTaitApresEscalade({ workflows: new Scenarios({ w: { systeme: null, graph: parlant } }), runs })('t', 'w', 'r', 'a')).toBe(false);
  });

  it('le graphe figé du parcours prime sur le publié (grapheDuRun)', async () => {
    const f = creerSeTaitApresEscalade({ workflows: new Scenarios({ w: { systeme: null, graph: parlant } }), runs: new Parcours({ r: muet }) });
    expect(await f('t', 'w', 'r', 'a')).toBe(true);
  });

  it('🔴 le worker la câble : une flèche à deux paramètres (l’ancien câblage) compilerait encore', () => {
    const source = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
    expect(source).toContain('estRepondeur: creerSeTaitApresEscalade({ workflows: workflowStore, runs: runStore })');
  });

  it('parcours ou scénario introuvable : comme avant, la phrase est jetée', async () => {
    expect(await creerSeTaitApresEscalade({ workflows: new Scenarios({ w: { systeme: null, graph: muet } }), runs: new Parcours({}) })('t', 'w', 'r', 'a')).toBe(false);
    expect(await creerSeTaitApresEscalade({ workflows: new Scenarios({}), runs: new Parcours({ r: null }) })('t', 'w', 'r', 'a')).toBe(false);
  });
});
