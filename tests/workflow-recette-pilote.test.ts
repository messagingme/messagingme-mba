import { describe, it, expect } from 'vitest';
import {
  empreinteRecette, lireRecette, referencesDe, BOUTON_MENU_MAX, DESCRIPTION_LIGNE_MAX, ECHEANCE_MAX_JOURS, ETIQUETTE_MAX,
  LIGNES_MENU_MAX, OPERATIONS_MAX, TEXTE_QUESTION_MAX, TITRE_LIGNE_MAX, VALEUR_CHAMP_RECETTE_MAX, type Etape,
} from '../src/workflow/recette';
import { compilerRecette, decompilerGraphe, type ReferencesResolues } from '../src/workflow/recette-graphe';
import { delaiSansReponseMs, walk, actionOf } from '../src/workflow/engine';
import { reglagesQuestion } from '../src/workflow/question-piece';
import { parseGraph, type WorkflowGraph } from '../src/workflow/graph';

/**
 * LA RECETTE DU PILOTE (lot 1 du CSM virtuel, B5, plan `2026-11-24-csm-lot1-e-recette-pilote.md`) : les étapes Question
 * et Action, lues, compilées dans la forme que la console pose et que le moteur joue, puis relues à l'identique.
 */
const humain: Etape = { humain: {} };
const refs = (): ReferencesResolues => ({
  templates: new Map(), agents: new Map(), champs: new Set(['besoin', 'budget', 'delai', 'ville']),
});

/** Le parcours du pilote : deux questions, un menu, une relance à l'échéance, des étiquettes et l'équipe. */
const pilote = (): Etape => ({
  question: { texte: 'Bonjour ! Que recherchez-vous ?', champ: 'besoin' },
  suite: {
    question: {
      texte: 'Quel est votre budget ?', champ: 'budget', bouton: 'Choisir', ranger_choix: true,
      sans_reponse_apres: { valeur: 2, unite: 'hours' },
    },
    menu: [
      { titre: 'Moins de 1 000 €', suite: { action: [{ etiquette: 'petit-budget' }], suite: humain } },
      {
        titre: 'Plus de 1 000 €', description: 'Un conseiller vous rappelle',
        suite: { action: [{ etiquette: 'lead-chaud' }, { champ: 'delai', valeur: 'rapide' }, { retirer_etiquettes: ['froid'] }, { vider_champs: ['ville'] }], suite: humain },
      },
    ],
    autre_reponse: humain,
    sans_reponse: { message: { texte: 'Vous êtes toujours là ? Un conseiller prend le relais.' }, suite: humain },
  },
});

const compile = (e: Etape, precedent: WorkflowGraph | null = null): WorkflowGraph => {
  const r = compilerRecette(e, refs(), precedent);
  if (!r.ok) throw new Error(`compilation refusée : ${r.message}`);
  return r.valeur;
};
const lue = (entree: unknown) => lireRecette({ nom: 'Qualification', entree });
const refusDe = (entree: unknown) => {
  const r = lue(entree);
  if (r.ok) throw new Error('attendu : un refus');
  return r;
};
const q = (question: Record<string, unknown>, reste: Record<string, unknown> = {}) => ({ question: { texte: 'Votre ville ?', ...question }, ...reste });

describe('lireRecette : la Question et l’Action', () => {
  it('lit le parcours du pilote tel quel', () => {
    const r = lue(pilote());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valeur.entree).toEqual(pilote());
  });

  it('refuse chaque combinaison que le moteur ne jouerait pas, à son chemin', () => {
    expect(refusDe(q({ bouton: 'Choisir' })).chemin).toBe('entree.question.bouton');
    expect(refusDe(q({ champ: 'ville', ranger_choix: true })).chemin).toBe('entree.question.ranger_choix');
    expect(refusDe(q({ ranger_choix: true }, { menu: [{ titre: 'Paris', suite: humain }] })).chemin).toBe('entree.question.ranger_choix');
    expect(refusDe(q({}, { menu: [{ titre: 'Paris', suite: humain }], suite: humain })).chemin).toBe('entree.suite');
    expect(refusDe(q({}, { autre_reponse: humain })).chemin).toBe('entree.autre_reponse');
    expect(refusDe(q({ sans_reponse_apres: { valeur: 2, unite: 'days' } })).chemin).toBe('entree.sans_reponse');
    expect(refusDe(q({}, { sans_reponse: humain })).chemin).toBe('entree.sans_reponse');
    expect(refusDe(q({}, { menu: [{ titre: 'Paris' }] })).chemin).toBe('entree.menu[0].suite');
  });

  it('borne chaque valeur à ce que WhatsApp et le moteur acceptent', () => {
    const lignes = (n: number) => Array.from({ length: n }, (_, i) => ({ titre: `Ligne ${i}`, suite: humain }));
    expect(lue(q({}, { menu: lignes(LIGNES_MENU_MAX) })).ok).toBe(true);
    expect(refusDe(q({}, { menu: lignes(LIGNES_MENU_MAX + 1) })).chemin).toBe('entree.menu');
    expect(refusDe(q({}, { menu: [{ titre: 'x'.repeat(TITRE_LIGNE_MAX + 1), suite: humain }] })).chemin).toBe('entree.menu[0].titre');
    expect(refusDe(q({}, { menu: [{ titre: 'a', description: 'x'.repeat(DESCRIPTION_LIGNE_MAX + 1), suite: humain }] })).chemin).toBe('entree.menu[0].description');
    expect(refusDe(q({}, { menu: [{ titre: 'Paris', suite: humain }, { titre: ' Paris ', suite: humain }] })).chemin).toBe('entree.menu[1].titre');
    expect(refusDe(q({ bouton: 'x'.repeat(BOUTON_MENU_MAX + 1) }, { menu: lignes(1) })).chemin).toBe('entree.question.bouton');
    expect(refusDe(q({ texte: 'x'.repeat(TEXTE_QUESTION_MAX + 1) })).chemin).toBe('entree.question.texte');
    expect(refusDe(q({ texte: '  ' })).chemin).toBe('entree.question.texte');
    const echeance = (valeur: number, unite: string) => q({ sans_reponse_apres: { valeur, unite } }, { sans_reponse: humain });
    expect(lue(echeance(ECHEANCE_MAX_JOURS, 'days')).ok).toBe(true);
    expect(refusDe(echeance(ECHEANCE_MAX_JOURS * 24 + 1, 'hours')).chemin).toBe('entree.question.sans_reponse_apres');
    expect(refusDe(echeance(1.5, 'hours')).chemin).toBe('entree.question.sans_reponse_apres.valeur');
    expect(refusDe(echeance(10, 'seconds')).chemin).toBe('entree.question.sans_reponse_apres.unite');
    const ops = (n: number) => ({ action: Array.from({ length: n }, (_, i) => ({ etiquette: `e${i}` })) });
    expect(lue(ops(OPERATIONS_MAX)).ok).toBe(true);
    expect(refusDe(ops(OPERATIONS_MAX + 1)).chemin).toBe('entree.action');
    expect(refusDe({ action: [] }).chemin).toBe('entree.action');
    expect(refusDe({ action: [{ etiquette: 'x'.repeat(ETIQUETTE_MAX + 1) }] }).chemin).toBe('entree.action[0].etiquette');
    expect(refusDe({ action: [{ champ: 'ville', valeur: 'x'.repeat(VALEUR_CHAMP_RECETTE_MAX + 1) }] }).chemin).toBe('entree.action[0].valeur');
    // Le consentement vient du contact, jamais d'une recette : une opération inconnue est refusée.
    expect(refusDe({ action: [{ consentement: 'opted_out' }] }).chemin).toBe('entree.action[0]');
  });

  it('rend une forme unique : listes sans doublon, case à faux et description vide retirées', () => {
    const r = lue({
      question: { texte: 'Ville ?', ranger_choix: false }, suite: { action: [{ retirer_etiquettes: ['a', 'a', 'b'] }, { vider_champs: ['ville', 'ville'] }] },
    });
    expect(r.ok && r.valeur.entree).toEqual({ question: { texte: 'Ville ?' }, suite: { action: [{ retirer_etiquettes: ['a', 'b'] }, { vider_champs: ['ville'] }] } });
    const d = lue(q({}, { menu: [{ titre: 'Paris', description: '  ', suite: humain }] }));
    expect(d.ok && d.valeur.entree).toEqual(q({}, { menu: [{ titre: 'Paris', suite: humain }] }));
  });

  it('referencesDe nomme les champs d’une Question et d’une Action', () => {
    expect(referencesDe(pilote()).champs.sort()).toEqual(['besoin', 'budget', 'delai', 'ville']);
  });
});

describe('compilerRecette : la Question et l’Action telles que le moteur les joue', () => {
  it('pose le bloc Question que la console pose, et le moteur lit son champ, son menu et son échéance', () => {
    const g = compile(pilote());
    expect(parseGraph(g)).not.toBeNull();
    const budget = g.nodes.find((n) => n.data.body === 'Quel est votre budget ?')!;
    expect(actionOf(budget)).toMatchObject({ kind: 'sendQuestion', buttonLabel: 'Choisir', rows: [{ title: 'Moins de 1 000 €' }, { title: 'Plus de 1 000 €', description: 'Un conseiller vous rappelle' }] });
    expect(reglagesQuestion(budget)).toEqual({ champ: 'budget', rangerLigne: true, genres: null });
    expect(delaiSansReponseMs(budget)).toBe(2 * 3_600_000);
    const sorties = g.edges.filter((e) => e.source === budget.id).map((e) => e.sourceHandle ?? 'libre').sort();
    expect(sorties).toEqual(['libre', 'row:0', 'row:1', 'timeout']);
  });

  it('le moteur joue les opérations d’une Action dans l’ordre, puis continue', () => {
    const g = compile({
      action: [{ etiquette: 'lead-chaud' }, { champ: 'delai', valeur: 'rapide' }, { retirer_etiquettes: ['froid', 'tiède'] }, { vider_champs: ['ville'] }],
      suite: { question: { texte: 'Votre ville ?', champ: 'ville' } },
    });
    const r = walk(g, g.nodes[0]!.id);
    expect(r.actions.map((s) => s.action)).toEqual([
      { kind: 'tag', tag: 'lead-chaud' }, { kind: 'field', key: 'delai', value: 'rapide' },
      { kind: 'removeTag', tag: 'froid' }, { kind: 'removeTag', tag: 'tiède' }, { kind: 'clearField', key: 'ville' },
      expect.objectContaining({ kind: 'sendQuestion', body: 'Votre ville ?' }),
    ]);
  });

  it('refuse un champ que l’espace n’a pas, à son chemin', () => {
    const refus = (e: Etape) => {
      const r = compilerRecette(e, refs(), null);
      if (r.ok) throw new Error('attendu : un refus');
      return r;
    };
    expect(refus({ question: { texte: 'Ville ?', champ: 'pays' } })).toMatchObject({ code: 'field_unknown', chemin: 'entree.question.champ' });
    expect(refus({ action: [{ etiquette: 'a' }, { champ: 'pays', valeur: 'FR' }] })).toMatchObject({ code: 'field_unknown', chemin: 'entree.action[1].champ' });
    expect(refus({ action: [{ vider_champs: ['ville', 'pays'] }] })).toMatchObject({ code: 'field_unknown', chemin: 'entree.action[0].vider_champs' });
  });
});

describe('decompilerGraphe : la Question et l’Action relues', () => {
  it('🔴 aller-retour : le parcours compilé puis relu redonne la même recette, donc la même empreinte', () => {
    const r = decompilerGraphe(compile(pilote()));
    expect(r).toEqual({ ok: true, valeur: pilote() });
    expect(r.ok && empreinteRecette(r.valeur)).toBe(empreinteRecette(pilote()));
    const sansMenu: Etape = { question: { texte: 'Ville ?', champ: 'ville', sans_reponse_apres: { valeur: 3, unite: 'days' } }, suite: humain, sans_reponse: humain };
    expect(decompilerGraphe(compile(sansMenu))).toEqual({ ok: true, valeur: sansMenu });
  });

  it('ce que la recette ne dit pas reste à la console', () => {
    const g = compile(pilote());
    const budget = g.nodes.find((n) => n.data.body === 'Quel est votre budget ?')!;
    const avec = (data: Record<string, unknown>): WorkflowGraph => ({ ...g, nodes: g.nodes.map((n) => (n.id === budget.id ? { ...n, data: { ...n.data, ...data } } : n)) });
    const indescriptible = (x: WorkflowGraph) => expect(decompilerGraphe(x)).toMatchObject({ ok: false, code: 'scenario_not_describable' });
    indescriptible(avec({ attendreFichier: true }));
    indescriptible(avec({ timeoutValue: 0 }));
    indescriptible(avec({ timeoutValue: 1.5 }));
    indescriptible({ ...g, edges: g.edges.filter((e) => !(e.source === budget.id && e.sourceHandle === 'row:1')) });
    const action = g.nodes.find((n) => n.type === 'action' && n.data.tag === 'petit-budget')!;
    const actionAvec = (data: Record<string, unknown>): WorkflowGraph => ({ ...g, nodes: g.nodes.map((n) => (n.id === action.id ? { ...n, data } : n)) });
    indescriptible(actionAvec({ actionKind: 'set_optout' }));
    indescriptible(actionAvec({ actionKind: 'set_field', fieldKey: 'ville', valueKind: 'derniere_saisie' }));
    indescriptible(actionAvec({}));
  });

  it('relit les blocs tels que la console les écrit (libellés, description vide, valeur fixe, échéance à zéro sans sortie)', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'q', type: 'question', position: { x: 0, y: 0 }, data: { body: 'Votre ville ?', rows: [{ title: 'Paris', description: '' }, { title: 'Lyon' }], buttonLabel: '', champReponse: 'ville', champReponseLabel: 'Ville', rangerLigne: false, timeoutValue: 0, timeoutUnit: 'hours', name: 'Ville' } },
        { id: 'a', type: 'action', position: { x: 1, y: 0 }, data: { actionKind: 'set_field', fieldKey: 'delai', fieldLabel: 'Délai', valueKind: 'fixed', value: 'rapide', suite: [{ actionKind: 'clear_field', champs: [{ key: 'budget', label: 'Budget' }] }] } },
        { id: 'h', type: 'inbox', position: { x: 2, y: 0 }, data: {} },
        { id: 'h2', type: 'inbox', position: { x: 2, y: 1 }, data: {} },
      ],
      edges: [{ id: 'e1', source: 'q', target: 'a', sourceHandle: 'row:0' }, { id: 'e2', source: 'q', target: 'h2', sourceHandle: 'row:1' }, { id: 'e3', source: 'a', target: 'h' }],
    };
    expect(decompilerGraphe(g)).toEqual({
      ok: true,
      valeur: {
        question: { texte: 'Votre ville ?', champ: 'ville' },
        menu: [{ titre: 'Paris', suite: { action: [{ champ: 'delai', valeur: 'rapide' }, { vider_champs: ['budget'] }], suite: humain } }, { titre: 'Lyon', suite: humain }],
      },
    });
    // Deux lignes au même titre, réglées dans la console : l'écriture les refuserait, la relecture les laisse à la console.
    const doublon: WorkflowGraph = { ...g, nodes: g.nodes.map((n) => (n.id === 'q' ? { ...n, data: { ...n.data, rows: [{ title: 'Paris' }, { title: 'Paris' }] } } : n)) };
    expect(decompilerGraphe(doublon)).toMatchObject({ ok: false, code: 'scenario_not_describable' });
  });

  it('🔴 un parcours de la console fait de Questions et d’Actions garde l’id et la place de chaque bloc inchangé', () => {
    const g = compile(pilote());
    const uuid = new Map(g.nodes.map((n, i) => [n.id, `${String(i).padStart(8, '0')}-aaaa-4bbb-8ccc-dddddddddddd`]));
    const dessine: WorkflowGraph = {
      nodes: g.nodes.map((n, i) => ({ ...n, id: uuid.get(n.id)!, position: { x: 500 + i, y: 900 + i } })),
      edges: g.edges.map((e, i) => ({ ...e, id: `xy-edge-${i}`, source: uuid.get(e.source)!, target: uuid.get(e.target)! })),
    };
    const ids = (x: WorkflowGraph) => x.nodes.map((n) => n.id).sort();
    const meme = compile(pilote(), dessine);
    expect(ids(meme)).toEqual(ids(dessine));
    for (const n of meme.nodes) expect(n.position, n.id).toEqual(dessine.nodes.find((d) => d.id === n.id)!.position);
    // Une ligne de menu renommée change les sorties de la Question : elle seule prend un id neuf, avec la branche renommée.
    const renomme = pilote() as Extract<Etape, { question: unknown }>;
    const budget = renomme.suite as Extract<Etape, { question: unknown }>;
    budget.menu![0]!.titre = 'Moins de 500 €';
    const apres = compile(renomme, dessine);
    const neufs = apres.nodes.filter((n) => !dessine.nodes.some((d) => d.id === n.id));
    expect(neufs.map((n) => n.type)).toEqual(['question', 'action', 'inbox']);
  });
});
