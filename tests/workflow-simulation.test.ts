import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { jamaisDesabonne, toujoursDAccord } from './consentement';
import { avecGardesDEtatInertes, depsInertes } from './executeur-inerte';
import { WorkflowExecutor } from '../src/workflow/executor';
import type { WorkflowGraph, WorkflowNode } from '../src/workflow/graph';
import type { RunState, WorkflowRunRow } from '../src/workflow/run-store.pg';
import { compilerRecette, type ReferencesResolues } from '../src/workflow/recette-graphe';
import type { Etape } from '../src/workflow/recette';
import { questionRows } from '../src/workflow/engine';
import { SORTIE_MAX, simulerParcours, type ReponseSimulee, type Simulation } from '../src/workflow/simulation';

/**
 * LA SIMULATION D'UN PARCOURS (lot 1 du CSM virtuel, B6) : ce qu'elle rend pour le parcours du pilote, et 🔴 la PARITÉ
 * avec l'exécuteur réel, qui joue les mêmes réponses : mêmes envois, mêmes champs et étiquettes, même fin.
 */
const humain: Etape = { humain: {} };
const refs: ReferencesResolues = {
  // Un bouton de lien AVANT les réponses rapides : leurs sorties sont `btn:1` et `btn:2`, l'index dans le template.
  templates: new Map([['relance|fr', {
    etat: 'approuve' as const, variables: 0, indices: [],
    boutons: [{ type: 'URL', text: 'Site', url: 'https://exemple.fr' }, { type: 'QUICK_REPLY', text: 'Oui' }, { type: 'QUICK_REPLY', text: 'Plus tard' }],
  }]]),
  agents: new Map(),
  champs: new Set(['besoin', 'budget', 'delai']),
};
const relance: Etape = { template: { nom: 'relance', langue: 'fr' }, boutons: [{ texte: 'Oui', suite: { action: [{ etiquette: 'oui' }] } }, { texte: 'Plus tard', suite: humain }] };
const vingtHeures = { valeur: 20, unite: 'hours' as const };
const deuxEcheances: Etape = {
  question: { texte: 'Votre besoin ?', champ: 'besoin', sans_reponse_apres: vingtHeures },
  suite: humain,
  sans_reponse: {
    question: { texte: 'Toujours là ?', champ: 'budget', sans_reponse_apres: vingtHeures },
    suite: {
      question: { texte: 'Votre délai ?', champ: 'delai', sans_reponse_apres: vingtHeures },
      suite: humain,
      sans_reponse: { message: { texte: 'Je vous laisse.' }, suite: humain },
    },
    sans_reponse: humain,
  },
};
/** Un graphe de la console : un message, un bloc Attente, puis une Question qui range la réponse. */
const avecAttente = (unit: 'hours' | 'days'): WorkflowGraph => ({
  nodes: [
    { id: 'm', type: 'quick_message', position: { x: 0, y: 0 }, data: { body: 'Bonjour' } },
    { id: 'w', type: 'wait', position: { x: 1, y: 0 }, data: { delay: 2, unit } },
    { id: 'q', type: 'question', position: { x: 2, y: 0 }, data: { body: 'Votre nom ?', champReponse: 'besoin' } },
    { id: 'h', type: 'inbox', position: { x: 3, y: 0 }, data: {} },
  ],
  edges: [{ id: 'e1', source: 'm', target: 'w' }, { id: 'e2', source: 'w', target: 'q' }, { id: 'e3', source: 'q', target: 'h' }],
});

const pilote: Etape = {
  question: { texte: 'Que recherchez-vous ?', champ: 'besoin' },
  suite: {
    question: { texte: 'Quel budget ?', champ: 'budget', bouton: 'Choisir', ranger_choix: true, sans_reponse_apres: { valeur: 2, unite: 'hours' } },
    menu: [
      { titre: 'Moins de 1 000 €', suite: { action: [{ etiquette: 'lead-froid' }], suite: { message: { texte: 'Nos offres arrivent.' } } } },
      { titre: 'Plus de 1 000 €', suite: { action: [{ etiquette: 'lead-chaud' }, { champ: 'delai', valeur: 'rapide' }], suite: { message: { texte: 'Un conseiller vous rappelle.' }, suite: humain } } },
    ],
    autre_reponse: humain,
    sans_reponse: { message: { texte: 'Je vous laisse réfléchir.' }, suite: humain },
  },
};

function compile(e: Etape): WorkflowGraph {
  const r = compilerRecette(e, refs, null);
  if (!r.ok) throw new Error(r.message);
  return r.valeur;
}

/** Ce que la simulation prévoit, dans le format de la trace de l'exécuteur ; la réponse rangée vient avant les effets. */
function traceDe(s: Simulation): string[] {
  const t: string[] = [];
  for (const e of s.etapes) {
    if (e.reponse?.champ_range) t.push(`champ:${e.reponse.champ_range.champ}=${e.reponse.champ_range.valeur}`);
    for (const f of e.effets) {
      if ('envoi' in f) t.push(f.envoi === 'question' ? `question:${f.texte}:${f.lignes.join('|')}` : f.envoi === 'message' ? `message:${f.texte}` : `${f.envoi}`);
      else if ('etiquette' in f) t.push(`etiquette:${f.etiquette}`);
      else if ('etiquette_retiree' in f) t.push(`retiree:${f.etiquette_retiree}`);
      else if ('champ' in f) t.push(`champ:${f.champ}=${f.valeur}`);
      else if ('champ_vide' in f) t.push(`vide:${f.champ_vide}`);
    }
  }
  return t;
}
/** La fin, telle que l'exécuteur la laisse voir : un parcours terminé et une réponse que rien ne suit rendent tous deux le fil. */
const finDe = (s: Simulation): string => (s.fin.etat === 'termine' || s.fin.etat === 'repondeur' ? 'rendu' : s.fin.etat);

class FakeRuns {
  run: WorkflowRunRow | null = null;
  async closeActiveByWaId(): Promise<string[]> { return []; }
  async start(tenantId: string, workflowId: string, waId: string, _c: string | null, state: RunState): Promise<{ id: string }> {
    this.run = { evenement: null, id: 'r1', workflowId, tenantId, waId, currentNode: state.currentNode, status: state.status, lastMessageId: null, grapheFige: null, neEnMasse: false, exigeAccordMarketing: false };
    return { id: 'r1' };
  }
  async findWaitingByWaId(_t: string, waId: string): Promise<WorkflowRunRow | null> {
    return this.run && this.run.status === 'waiting' && this.run.waId === waId ? this.run : null;
  }
  async setState(id: string, state: RunState): Promise<void> {
    if (this.run && this.run.id === id) this.run = { ...this.run, currentNode: state.currentNode, status: state.status, lastMessageId: state.lastMessageId ?? this.run.lastMessageId };
  }
}

/** Le clic que Meta renverrait pour ce choix : `row:<i>` d'un menu, `btn:<i>` d'une réponse rapide ou d'un bouton de template. */
function clicDe(n: WorkflowNode, texte: string): string {
  if (n.type === 'question') return `row:${questionRows(n).findIndex((r) => r.title === texte)}`;
  if (n.type === 'quick_message') return `btn:${(n.data.quickReplies as string[]).indexOf(texte)}`;
  return `btn:${(n.data.templateButtons as Array<{ text: string }>).findIndex((b) => b.text === texte)}`;
}

/** Les mêmes réponses jouées par l'exécuteur RÉEL (ses faux d'envoi et d'écriture) : sa trace, et comment il finit. */
async function parExecuteur(g: WorkflowGraph, reponses: ReponseSimulee[], fenetreOuverteALaReprise = true): Promise<{ trace: string[]; fin: string }> {
  const runs = new FakeRuns();
  const trace: string[] = [];
  let equipe = false;
  // La fiche que les Conditions lisent : celle que les écritures du parcours laissent, comme en base.
  const fiche = { fields: {} as Record<string, string>, tags: [] as string[] };
  const ex = new WorkflowExecutor({
    ...depsInertes,
    estDesabonne: jamaisDesabonne,
    aAccordMarketing: toujoursDAccord,
    runs: avecGardesDEtatInertes(runs),
    getGraph: async () => g,
    applyTag: async (_t, _w, tag) => { trace.push(`etiquette:${tag}`); fiche.tags.push(tag); },
    setField: async (_t, _w, k, v) => { trace.push(`champ:${k}=${v}`); fiche.fields[k] = v; },
    removeTag: async (_t, _w, tag) => { trace.push(`retiree:${tag}`); fiche.tags = fiche.tags.filter((x) => x !== tag); },
    clearField: async (_t, _w, k) => { trace.push(`vide:${k}`); delete fiche.fields[k]; },
    evalContext: async () => ({
      fields: { ...fiche.fields }, tags: [...fiche.tags], optIn: 'opted_in', name: null, phone: null, bsuid: null,
      now: new Date(), timeZone: 'Europe/Paris', businessHours: {}, derniereSaisie: null, analyse: null,
    }),
    sendTemplate: async () => { trace.push('template'); },
    sendQuickMessage: async (_t, _w, body) => { trace.push(`message:${body}`); },
    sendFlow: async () => { trace.push('formulaire'); },
    sendQuestion: async (_t, _w, body, _b, rows) => { trace.push(`question:${body}:${rows.map((r) => r.title).join('|')}`); },
    escalateToHuman: async () => { equipe = true; },
    // La fenêtre que la reprise lit : la simulation la déduit du temps écoulé depuis le dernier message du contact.
    isWindowOpen: async () => fenetreOuverteALaReprise,
  });
  // Un bloc Attente : le balayage reprend le parcours à son échéance, avant toute réponse du contact.
  const reveiller = async (): Promise<void> => {
    for (let n = 0; n < 5 && runs.run?.status === 'sleeping'; n += 1) await ex.resume({ ...runs.run, status: 'sleeping' });
  };
  await ex.demarrer('automatisme_ordinaire', 't1', 'wf1', g, { waId: '33600', contactId: 'c1' }, { depuis: 'entree', fenetreOuverte: true });
  await reveiller();
  for (const [i, r] of reponses.entries()) {
    const run = runs.run;
    if (!run || run.status !== 'waiting' || run.currentNode === null) break;
    const bloc = g.nodes.find((n) => n.id === run.currentNode)!;
    if ('sans_reponse' in r) {
      await ex.resume({ ...run, status: 'waiting' });
    } else if ('choix' in r) {
      await ex.advance('t1', '33600', `m${i}`, clicDe(bloc, r.choix), 'whatsapp', { reaction: false });
    } else {
      await ex.advance('t1', '33600', `m${i}`, null, 'whatsapp', { reaction: false, texte: r.texte });
    }
    await reveiller();
  }
  const fin = equipe ? 'equipe' : runs.run?.status === 'waiting' ? 'attend_une_reponse' : 'rendu';
  return { trace, fin };
}

describe('simulerParcours : le parcours du pilote', () => {
  it('rend les effets, les attentes, la sortie de chaque réponse et la fin', () => {
    const s = simulerParcours(compile(pilote), [{ texte: 'Un logiciel' }, { choix: 'plus de 1 000 €' }]);
    expect(s.fin).toEqual({ etat: 'equipe' });
    expect(s.reponses_non_utilisees).toBe(0);
    expect(s.etapes[0]).toMatchObject({ effets: [{ envoi: 'question', texte: 'Que recherchez-vous ?' }], attente: { reponse: { type: 'question', choix: [] } } });
    expect(s.etapes[1]).toMatchObject({
      reponse: { recue: { texte: 'Un logiciel' }, sortie: 'libre', champ_range: { champ: 'besoin', valeur: 'Un logiciel' } },
      attente: { reponse: { choix: ['Moins de 1 000 €', 'Plus de 1 000 €'], echeance_minutes: 120 } },
    });
    expect(s.etapes[2]).toMatchObject({
      reponse: { sortie: 'row:1', champ_range: { champ: 'budget', valeur: 'Plus de 1 000 €' } },
      effets: [{ etiquette: 'lead-chaud' }, { champ: 'delai', valeur: 'rapide' }, { envoi: 'message', texte: 'Un conseiller vous rappelle.' }],
    });
  });

  it('dit ce qu’elle ne peut pas jouer au lieu d’inventer une branche', () => {
    const g = compile(pilote);
    expect(simulerParcours(g, [{ texte: 'x' }, { choix: 'Peut-être' }]).fin).toMatchObject({ etat: 'reponse_impossible', raison: expect.stringContaining('« Moins de 1 000 € »') });
    expect(simulerParcours(g, [{ sans_reponse: true }]).fin).toMatchObject({ etat: 'reponse_impossible', raison: expect.stringContaining('sans échéance') });
    expect(simulerParcours(g, [{ texte: 'x' }])).toMatchObject({ fin: { etat: 'attend_une_reponse' }, reponses_non_utilisees: 0 });
    expect(simulerParcours(g, [{ texte: 'x' }, { texte: 'y' }, { texte: 'z' }])).toMatchObject({ fin: { etat: 'equipe' }, reponses_non_utilisees: 1 });
    expect(simulerParcours({ nodes: [], edges: [] }, []).fin).toMatchObject({ etat: 'non_simule' });
  });

  it('🔴 sa sortie a un budget : des blocs « Extraire du JSON » qui recopient de longues valeurs s’arrêtent et le disent', () => {
    // Vingt blocs de vingt lignes, chacune recopiant une valeur de près de 1 000 caractères (la borne d'une fiche) :
    // environ 400 000 caractères d'effets en une seule marche.
    const source = JSON.stringify({ a: 'x'.repeat(980) });
    const blocs: WorkflowNode[] = Array.from({ length: 20 }, (_, b) => ({
      id: `x${b}`, type: 'extraire', position: { x: b, y: 0 },
      data: { champSource: 'reponse', lignes: Array.from({ length: 20 }, (_, l) => ({ chemin: 'a', champCible: `t${b}_${l}` })) },
    }));
    const g: WorkflowGraph = {
      nodes: [...blocs, { id: 'h', type: 'inbox', position: { x: 21, y: 0 }, data: {} }],
      edges: [...blocs.map((n, b) => ({ id: `e${b}`, source: n.id, target: b + 1 < blocs.length ? `x${b + 1}` : 'h' }))],
    };
    const s = simulerParcours(g, [], { champs: { reponse: source } });
    expect(s.fin).toMatchObject({ etat: 'non_simule', raison: expect.stringContaining(String(SORTIE_MAX)) });
    expect(JSON.stringify(s).length).toBeLessThan(SORTIE_MAX);
  });

  it('l’horloge avance avec une Attente : un champ « maintenant » posé après lit l’heure de la reprise', () => {
    const depart = new Date('2026-11-25T09:00:00Z');
    const g: WorkflowGraph = {
      nodes: [
        { id: 'w', type: 'wait', position: { x: 0, y: 0 }, data: { delay: 2, unit: 'days' } },
        { id: 'f', type: 'field', position: { x: 1, y: 0 }, data: { key: 'vu', valueKind: 'now' } },
      ],
      edges: [{ id: 'e', source: 'w', target: 'f' }],
    };
    const effet = simulerParcours(g, [], {}, depart).etapes[1]?.effets[0];
    expect(effet).toMatchObject({ champ: 'vu' });
    expect(Date.parse((effet as { valeur: string }).valeur)).toBe(Date.parse('2026-11-27T09:00:00Z'));
  });

  it('des réponses rapides telles que Meta les montre : trois au plus, titres de 20 caractères, index d’origine', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'm', type: 'quick_message', position: { x: 0, y: 0 }, data: { body: 'Alors ?', quickReplies: ['Oui', 'Une réponse beaucoup trop longue', '', 'Non', 'Peut-être'] } },
        { id: 't', type: 'tag', position: { x: 1, y: 0 }, data: { tag: 'longue' } },
      ],
      edges: [{ id: 'e', source: 'm', target: 't', sourceHandle: 'btn:1' }],
    };
    const s = simulerParcours(g, [{ choix: 'Une réponse beaucoup trop longue' }]);
    expect(s.etapes[0]).toMatchObject({ effets: [{ reponses: ['Oui', 'Une réponse beaucoup', 'Non'] }], attente: { reponse: { choix: ['Oui', 'Une réponse beaucoup', 'Non'] } } });
    expect(s.etapes[1]).toMatchObject({ reponse: { sortie: 'btn:1' }, effets: [{ etiquette: 'longue' }] });
    expect(simulerParcours(g, [{ choix: 'Peut-être' }]).fin).toMatchObject({ etat: 'reponse_impossible' });
  });

  it('un bloc qui attend sans avoir rien envoyé ne propose aucun choix', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'm', type: 'quick_message', position: { x: 0, y: 0 }, data: { body: '', quickReplies: ['Oui', 'Non'] } },
        { id: 't', type: 'tag', position: { x: 1, y: 0 }, data: { tag: 'oui' } },
      ],
      edges: [{ id: 'e', source: 'm', target: 't', sourceHandle: 'btn:0' }],
    };
    const s = simulerParcours(g, [{ choix: 'Oui' }]);
    expect(s.etapes[0]).toMatchObject({ effets: [], attente: { reponse: { choix: [] } } });
    expect(s.fin).toMatchObject({ etat: 'reponse_impossible', raison: expect.stringContaining('rien envoyé') });
  });

  it('🔴 elle n’importe rien qui envoie, appelle ou écrit : pas de magasin, pas de client, pas de file', () => {
    const imports = [...readFileSync('src/workflow/simulation.ts', 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../../web/lib/partage/sorties-agent', './conditions', './engine', './graph', './question-piece']);
  });
});

describe('🔴 parité : la simulation prévoit ce que l’exécuteur réel fait', () => {
  const piloteDeuxJours = JSON.parse(JSON.stringify(pilote).replace('"unite":"hours"', '"unite":"days"')) as Etape;
  const cas: Array<[string, Etape, ReponseSimulee[], boolean?]> = [
    ['un lead chaud : réponse écrite, puis le choix du gros budget', pilote, [{ texte: 'Un logiciel' }, { choix: 'Plus de 1 000 €' }]],
    ['un lead froid : le petit budget, puis le parcours se termine', pilote, [{ texte: 'Un logiciel' }, { choix: 'Moins de 1 000 €' }]],
    ['pas de réponse au budget : la relance, puis l’équipe', pilote, [{ texte: 'Un logiciel' }, { sans_reponse: true }]],
    ['pas de réponse en deux jours : la fenêtre est close, la relance est retenue, l’équipe', piloteDeuxJours, [{ texte: 'Un logiciel' }, { sans_reponse: true }], false],
    ['une réponse écrite au lieu d’un choix : autre_reponse', pilote, [{ texte: 'Un logiciel' }, { texte: 'Je ne sais pas' }]],
    ['les réponses s’arrêtent : le parcours attend', pilote, [{ texte: 'Un logiciel' }]],
    ['un message à réponses rapides sans sortie libre : un texte rend le fil', {
      message: { texte: 'Un choix ?' }, reponses: [{ texte: 'Oui', suite: { action: [{ etiquette: 'oui' }] } }, { texte: 'Non', suite: humain }],
    }, [{ texte: 'peut-être' }]],
    ['un message à réponses rapides : le clic suit sa réponse', {
      message: { texte: 'Un choix ?' }, reponses: [{ texte: 'Oui', suite: { action: [{ etiquette: 'oui' }] } }, { texte: 'Non', suite: humain }],
    }, [{ choix: 'Oui' }]],
    ['un bouton de template après un bouton de lien : le clic suit le bon bouton', relance, [{ choix: 'Oui' }]],
    ['le second bouton de template : l’équipe', relance, [{ choix: 'Plus tard' }]],
    ['une réponse écrite à un template sans sortie libre : le fil est rendu', relance, [{ texte: 'bonjour' }]],
    // 20 h, une réponse, 20 h : la fenêtre est ouverte à la seconde reprise parce que la réponse l'a rouverte.
    ['deux échéances séparées par une réponse : la réponse rouvre la fenêtre', deuxEcheances, [{ sans_reponse: true }, { texte: 'oui' }, { sans_reponse: true }]],
  ];
  for (const [nom, recette, reponses, fenetre] of cas) {
    it(nom, async () => {
      const g = compile(recette);
      const prevu = simulerParcours(g, reponses);
      const reel = await parExecuteur(g, reponses, fenetre ?? true);
      expect(traceDe(prevu)).toEqual(reel.trace);
      expect(finDe(prevu)).toBe(reel.fin);
    });
  }

  const casConsole: Array<[string, WorkflowGraph, ReponseSimulee[], boolean]> = [
    ['un bloc Attente de deux heures : la question part au réveil', avecAttente('hours'), [{ texte: 'Julien' }], true],
    ['un bloc Attente de deux jours : la fenêtre est close, la question est retenue, l’équipe', avecAttente('days'), [{ texte: 'Julien' }], false],
    ['une échéance de la console sans sortie « pas de réponse » : le fil est rendu', {
      nodes: [
        { id: 'q', type: 'question', position: { x: 0, y: 0 }, data: { body: 'Votre nom ?', timeoutValue: 2, timeoutUnit: 'hours' } },
        { id: 'h', type: 'inbox', position: { x: 1, y: 0 }, data: {} },
      ],
      edges: [{ id: 'e', source: 'q', target: 'h' }],
    }, [{ sans_reponse: true }], true],
    ['un choix sans sortie à lui suit la sortie libre', {
      nodes: [
        { id: 'q', type: 'question', position: { x: 0, y: 0 }, data: { body: 'A ou B ?', rows: [{ title: 'A' }, { title: 'B' }] } },
        { id: 'ta', type: 'tag', position: { x: 1, y: 0 }, data: { tag: 'a' } },
        { id: 'tl', type: 'tag', position: { x: 1, y: 1 }, data: { tag: 'libre' } },
      ],
      edges: [{ id: 'e1', source: 'q', target: 'ta', sourceHandle: 'row:0' }, { id: 'e2', source: 'q', target: 'tl' }],
    }, [{ choix: 'B' }], true],
    ['une Condition lit la réponse que la Question vient de ranger', {
      nodes: [
        { id: 'q', type: 'question', position: { x: 0, y: 0 }, data: { body: 'Votre besoin ?', champReponse: 'besoin' } },
        { id: 'c', type: 'condition', position: { x: 1, y: 0 }, data: { match: 'all', clauses: [{ kind: 'field', key: 'besoin', op: 'eq', value: 'oui' }] } },
        { id: 'to', type: 'tag', position: { x: 2, y: 0 }, data: { tag: 'oui' } },
        { id: 'tn', type: 'tag', position: { x: 2, y: 1 }, data: { tag: 'non' } },
      ],
      edges: [
        { id: 'e1', source: 'q', target: 'c' },
        { id: 'e2', source: 'c', target: 'to', sourceHandle: 'true' }, { id: 'e3', source: 'c', target: 'tn', sourceHandle: 'false' },
      ],
    }, [{ texte: 'oui' }], true],
    ['une extraction JSON range ses champs, vides sans réponse d’appel', {
      nodes: [
        { id: 'x', type: 'extraire', position: { x: 0, y: 0 }, data: { champSource: 'reponse', lignes: [{ chemin: 'statut', champCible: 'statut' }, { chemin: 'montant', champCible: 'budget' }] } },
        { id: 'h', type: 'inbox', position: { x: 1, y: 0 }, data: {} },
      ],
      edges: [{ id: 'e', source: 'x', target: 'h' }],
    }, [], true],
  ];
  for (const [nom, g, reponses, fenetre] of casConsole) {
    it(nom, async () => {
      const prevu = simulerParcours(g, reponses);
      const reel = await parExecuteur(g, reponses, fenetre);
      expect(traceDe(prevu)).toEqual(reel.trace);
      expect(finDe(prevu)).toBe(reel.fin);
    });
  }

  it('un choix proposé qui ne mène nulle part passe à l’équipe, chez l’un comme chez l’autre', async () => {
    // Un graphe de la console : la ligne « B » n'a pas d'arête, et aucune sortie libre ne la rattrape.
    const g: WorkflowGraph = {
      nodes: [
        { id: 'q', type: 'question', position: { x: 0, y: 0 }, data: { body: 'A ou B ?', rows: [{ title: 'A' }, { title: 'B' }] } },
        { id: 'h', type: 'inbox', position: { x: 1, y: 0 }, data: {} },
      ],
      edges: [{ id: 'e', source: 'q', target: 'h', sourceHandle: 'row:0' }],
    };
    const prevu = simulerParcours(g, [{ choix: 'B' }]);
    const reel = await parExecuteur(g, [{ choix: 'B' }]);
    expect(finDe(prevu)).toBe('equipe');
    expect(reel.fin).toBe('equipe');
    expect(traceDe(prevu)).toEqual(reel.trace);
  });
});
