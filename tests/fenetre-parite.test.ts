import { describe, it, expect } from 'vitest';
import { analyserFenetreConsole } from '../web/lib/fenetre-console';
import { analyserFenetreDuMoteur } from '../src/workflow/fenetre-moteur';
import type { Depart } from '../web/lib/partage/fenetre-scenario';
import type { GraphLike, GraphNodeLike } from '../web/lib/campaign-eligibility';
import type { WorkflowGraph } from '../src/workflow/graph';

/**
 * 🔴 LA PARITÉ DE L'ANALYSE DE FENÊTRE, CONSOLE CONTRE MOTEUR (menu « Scénario », lot 2). Le parcours est commun
 * (`web/lib/partage/fenetre-scenario.ts`) ; chaque côté fournit SA lecture des blocs (`REGLES_FENETRE_CONSOLE`,
 * `REGLES_FENETRE_MOTEUR`). Si elles divergeaient d'un cas, le builder annoncerait un message refusé que le moteur
 * enverrait, ou se tairait sur un message que Meta refusera : aucune erreur ne le dirait. Même méthode que la parité de
 * « attente >= 24 h puis message de session » (`tests/web-campaign-eligibility.test.ts`).
 */
const n = (id: string, type: string, data: Record<string, unknown> = {}): GraphNodeLike => ({ id, type, data });
const e = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}-${sourceHandle ?? ''}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
const g = (nodes: GraphNodeLike[], edges: GraphLike['edges'] = []): GraphLike => ({ nodes, edges });
const TPL = (id: string, data: Record<string, unknown> = {}) => n(id, 'template', { templateName: 'promo', language: 'fr', ...data });
const QM = (id: string, data: Record<string, unknown> = {}) => n(id, 'quick_message', { body: 'Toujours là ?', ...data });
const FERME: Depart = { noeudId: null, fenetre: 'fermee', raison: 'un événement Shopify' };
const OUVERT: Depart = { noeudId: null, fenetre: 'ouverte', raison: '' };

const cas: Array<[string, GraphLike, Depart[]]> = [
  ['fermé, message rapide', g([QM('q')]), [FERME]],
  ['fermé, message rapide SANS texte (rien ne part)', g([QM('q', { body: '' })]), [FERME]],
  ['fermé, template, clic, message rapide', g([TPL('t', { templateButtons: [{ type: 'QUICK_REPLY', text: 'Oui' }] }), QM('q')], [e('t', 'q', 'btn:0')]), [FERME]],
  ['fermé, template à 30 min, « Pas de réponse », message rapide', g([TPL('t', { timeoutValue: 30, timeoutUnit: 'minutes' }), QM('q')], [e('t', 'q', 'timeout')]), [FERME]],
  ['fermé, template sans nom, à délai', g([TPL('t', { templateName: '', timeoutValue: 30, timeoutUnit: 'minutes' }), QM('q')], [e('t', 'q', 'timeout')]), [FERME]],
  ['fermé, template, réponse écrite, message rapide', g([TPL('t'), QM('q')], [e('t', 'q')]), [FERME]],
  ['ouvert, question à 30 h, « Pas de réponse », message rapide', g([n('qu', 'question', { body: 'Ça va ?', timeoutValue: 30, timeoutUnit: 'hours' }), QM('q')], [e('qu', 'q', 'timeout')]), [OUVERT]],
  ['ouvert, question à 2 h, « Pas de réponse », message rapide', g([n('qu', 'question', { body: 'Ça va ?', timeoutValue: 2, timeoutUnit: 'hours' }), QM('q')], [e('qu', 'q', 'timeout')]), [OUVERT]],
  ['ouvert, attente datée, message rapide', g([n('w', 'wait', { waitMode: 'date', waitDate: '2026-12-24T09:00' }), QM('q')], [e('w', 'q')]), [OUVERT]],
  ['ouvert, attente de 30 h en heures, message rapide', g([n('w', 'wait', { delay: 30, unit: 'hours' }), QM('q')], [e('w', 'q')]), [OUVERT]],
  ['ouvert, mode d’attente INCONNU gardant 2 h', g([n('w', 'wait', { waitMode: 'quand_il_pleut', delay: 2, unit: 'hours' }), QM('q')], [e('w', 'q')]), [OUVERT]],
  ['fermé, agent configuré', g([n('a', 'agent', { agentId: 'ag1' })]), [FERME]],
  ['fermé, agent NON configuré puis message rapide', g([n('a', 'agent', {}), QM('q')], [e('a', 'q')]), [FERME]],
  ['fermé, formulaire sans flowId puis message rapide', g([n('f', 'flow', {}), QM('q')], [e('f', 'q')]), [FERME]],
  ['fermé, formulaire configuré', g([n('f', 'flow', { flowId: 'fl1' })]), [FERME]],
  ['fermé, message à bouton de lien QUI GARDE ses réponses rapides, puis message rapide', g(
    [QM('ql', { quickReplies: ['Oui'], lienActif: true, lienTexte: 'Voir', lienUrl: 'https://exemple.fr' }), QM('q')],
    [e('ql', 'q')],
  ), [OUVERT, { ...FERME, noeudId: 'q' }]],
  ['fermé, saut vers un autre scénario', g([n('j', 'aller_a', { cible: 'nod_ab_AILLEURS000000000000000000' })]), [FERME]],
  ['fermé, saut interne vers un message rapide', g(
    [n('j', 'aller_a', { cible: 'nod_ab_ICI00000000000000000000000' }), QM('q', { code: 'nod_ab_ICI00000000000000000000000' })],
  ), [FERME]],
  // « CE BLOC ATTEND-IL UNE RÉPONSE ? » ne se départage qu'avec un cumul : une réponse remet le compte à zéro. Atteint
  // fenêtre fermée, un message de session est relevé et l'analyse s'arrête là ; atteint ouvert sans cumul, rien ne change.
  ['ouvert, 20 h, message à lien gardant ses réponses, 10 h, message rapide', g(
    [n('w1', 'wait', { delay: 20, unit: 'hours' }), QM('ql', { quickReplies: ['Oui'], lienActif: true, lienTexte: 'Voir', lienUrl: 'https://exemple.fr' }), n('w2', 'wait', { delay: 10, unit: 'hours' }), QM('q')],
    [e('w1', 'ql'), e('ql', 'w2'), e('w2', 'q')],
  ), [OUVERT]],
  ['ouvert, 20 h, message rapide à boutons, clic, 10 h, message rapide', g(
    [n('w1', 'wait', { delay: 20, unit: 'hours' }), QM('qb', { quickReplies: ['Oui', 'Non'] }), n('w2', 'wait', { delay: 10, unit: 'hours' }), QM('q')],
    [e('w1', 'qb'), e('qb', 'w2', 'btn:0'), e('w2', 'q')],
  ), [OUVERT]],
  ['ouvert, 20 h, template, réponse écrite, 10 h, message rapide', g(
    [n('w1', 'wait', { delay: 20, unit: 'hours' }), TPL('t'), n('w2', 'wait', { delay: 10, unit: 'hours' }), QM('q')],
    [e('w1', 't'), e('t', 'w2'), e('w2', 'q')],
  ), [OUVERT]],
  ['ouvert, 20 h, formulaire, rempli, 10 h, message rapide', g(
    [n('w1', 'wait', { delay: 20, unit: 'hours' }), n('f', 'flow', { flowId: 'fl1' }), n('w2', 'wait', { delay: 10, unit: 'hours' }), QM('q')],
    [e('w1', 'f'), e('f', 'w2', 'rempli'), e('w2', 'q')],
  ), [OUVERT]],
  ['départ fermé à un bloc (automation), départ ouvert à l’entrée', g(
    [QM('accueil'), TPL('t', { timeoutValue: 1, timeoutUnit: 'days' }), QM('relance')],
    [e('accueil', 't'), e('t', 'relance', 'timeout')],
  ), [OUVERT, { noeudId: 't', fenetre: 'fermee', raison: 'l’automation « Rappel »' }]],
];

describe('🔴 parité de l’analyse de fenêtre, console contre moteur', () => {
  for (const [nom, graphe, departs] of cas) {
    it(nom, () => {
      const lire = (cs: Array<{ noeudId: string; raison: string; depart: Depart }>) => cs.map((c) => [c.noeudId, c.raison, c.depart.noeudId]);
      expect(lire(analyserFenetreConsole(graphe, departs))).toEqual(lire(analyserFenetreDuMoteur(graphe as unknown as WorkflowGraph, departs)));
    });
  }

  it('et la parité ne cache pas une lecture fausse des deux côtés : trois verdicts attendus', () => {
    const noeuds = (i: number) => analyserFenetreConsole(cas[i]![1], cas[i]![2]).map((c) => c.noeudId);
    expect(noeuds(0)).toEqual(['q']);
    expect(noeuds(2)).toEqual([]);
    expect(noeuds(3)).toEqual(['q']);
  });
});
