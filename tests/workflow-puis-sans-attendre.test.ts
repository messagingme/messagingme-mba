import { describe, it, expect } from 'vitest';
import { walk, refusSuiteQuiAttend, passeSansAttente } from '../src/workflow/engine';
import type { WorkflowGraph, WorkflowNodeType } from '../src/workflow/graph';
import type { EvalContext } from '../src/workflow/conditions';
import { SORTIE_ENSUITE } from '../web/lib/partage/sortie-ensuite';
import { WORKFLOW_NODE_TYPES } from '../web/lib/partage/blocs';

/**
 * LA SORTIE « PUIS, SANS ATTENDRE » D'UN MESSAGE RAPIDE À BOUTONS (Julien, 2026-11-10).
 *
 * 🔴 CE QUE CES TESTS GARDENT. La suite part avec le message, et le parcours attend sur LE MESSAGE : ses boutons restent la
 * seule réponse attendue. Un parcours n'a qu'un curseur et un tap revient en `btn:<i>` sans nommer son message : un bloc
 * qui attendrait sur la suite prendrait ce curseur, et un tap sur l'ancien bouton serait lu comme une réponse à lui. D'où
 * l'arrêt du moteur AVANT un tel bloc, et le refus de publication qui dit le montage.
 */

const n = (id: string, type: WorkflowNodeType, data: Record<string, unknown> = {}): WorkflowGraph['nodes'][number] => ({ id, type, position: { x: 0, y: 0 }, data });
const e = (id: string, source: string, target: string) => ({ id, source, target });
const eh = (id: string, source: string, target: string, sourceHandle: string) => ({ id, source, target, sourceHandle });

const merci = (data: Record<string, unknown> = {}) => n('qm', 'quick_message', { body: 'Merci pour votre aide', quickReplies: ['Main menu'], ...data });

/** qm (« Main menu ») --ensuite--> texte --> tag ; « Main menu » --> menu ; Toute autre réponse --> autre. */
const avecSuite = (suite: WorkflowGraph['nodes'][number][], aretesSuite: WorkflowGraph['edges'] = []): WorkflowGraph => ({
  nodes: [merci(), n('menu', 'quick_message', { body: 'Menu' }), n('autre', 'tag', { tag: 'autre' }), ...suite],
  edges: [eh('e-btn', 'qm', 'menu', 'btn:0'), e('e-libre', 'qm', 'autre'), ...(suite[0] ? [eh('e-ensuite', 'qm', suite[0].id, SORTIE_ENSUITE)] : []), ...aretesSuite],
});

const ctx = (): EvalContext => ({
  fields: {}, tags: [], optIn: 'unknown', name: null, phone: null, bsuid: null, analyse: null,
  now: new Date('2026-11-10T12:00:00Z'), timeZone: 'Europe/Paris', businessHours: {},
});

describe('walk : la suite « Puis, sans attendre » part avec le message, qui garde la main', () => {
  it('🔴 le message, puis toute sa suite, et le parcours attend sur LE MESSAGE', () => {
    const g = avecSuite([n('txt', 'quick_message', { body: 'Bonne journée' }), n('tg', 'tag', { tag: 'vu' })], [e('e2', 'txt', 'tg')]);
    const r = walk(g, 'qm');
    expect(r.actions.map((a) => a.nodeId)).toEqual(['qm', 'txt', 'tg']);
    expect(r.rest).toEqual({ status: 'waiting', nodeId: 'qm' });
    // Ni la branche du bouton ni « Toute autre réponse » ne partent : ce sont des réponses du contact.
    expect(r.actions.map((a) => a.nodeId)).not.toContain('menu');
    expect(r.actions.map((a) => a.nodeId)).not.toContain('autre');
  });

  it('sans arête « Puis, sans attendre » : le message attend seul, comme avant', () => {
    const r = walk(avecSuite([]), 'qm');
    expect(r.actions.map((a) => a.nodeId)).toEqual(['qm']);
    expect(r.rest).toEqual({ status: 'waiting', nodeId: 'qm' });
  });

  it('🔴 un bloc qui attend sur la suite n’est PAS envoyé : le moteur s’arrête devant lui, le message garde la main', () => {
    const g = avecSuite([n('txt', 'quick_message', { body: 'Une question :' }), n('q', 'question', { body: 'Votre âge ?' }), n('tg', 'tag', { tag: 'jamais' })], [e('e2', 'txt', 'q'), e('e3', 'q', 'tg')]);
    const r = walk(g, 'qm');
    expect(r.actions.map((a) => a.nodeId)).toEqual(['qm', 'txt']);
    expect(r.rest).toEqual({ status: 'waiting', nodeId: 'qm' });
  });

  it('un message à boutons sur la suite s’arrête de même (il attendrait)', () => {
    const g = avecSuite([n('qm2', 'quick_message', { body: 'Autre choix ?', quickReplies: ['Oui'] })]);
    expect(walk(g, 'qm').actions.map((a) => a.nodeId)).toEqual(['qm']);
  });

  it('une boucle de la suite vers le message s’arrête sans le renvoyer', () => {
    const g = avecSuite([n('tg', 'tag', { tag: 'vu' })], [e('e2', 'tg', 'qm')]);
    const r = walk(g, 'qm');
    expect(r.actions.map((a) => a.nodeId)).toEqual(['qm', 'tg']);
    expect(r.rest).toEqual({ status: 'waiting', nodeId: 'qm' });
  });

  it('une condition de la suite voit ce que les blocs d’avant ont posé', () => {
    const cond = n('c', 'condition', { match: 'all', clauses: [{ kind: 'tag', op: 'has', tag: 'vu' }] });
    const g = avecSuite(
      [n('tg', 'tag', { tag: 'vu' }), cond, n('oui', 'quick_message', { body: 'Vu' }), n('non', 'quick_message', { body: 'Pas vu' })],
      [e('e2', 'tg', 'c'), eh('e3', 'c', 'oui', 'true'), eh('e4', 'c', 'non', 'false')],
    );
    expect(walk(g, 'qm', ctx()).actions.map((a) => a.nodeId)).toEqual(['qm', 'tg', 'oui']);
  });

  it('un message sans texte n’est pas parti : sa suite non plus', () => {
    const g: WorkflowGraph = { nodes: [n('qm', 'quick_message', { quickReplies: ['Main menu'] }), n('tg', 'tag', { tag: 'vu' })], edges: [eh('x', 'qm', 'tg', SORTIE_ENSUITE)] };
    expect(walk(g, 'qm').actions).toEqual([]);
  });

  it('un modèle à boutons n’a pas cette sortie : une arête « ensuite » posée à la main n’y part pas', () => {
    const g: WorkflowGraph = {
      nodes: [n('tpl', 'template', { templateName: 'promo', templateButtons: [{ type: 'QUICK_REPLY', text: 'Oui' }] }), n('tg', 'tag', { tag: 'vu' })],
      edges: [eh('x', 'tpl', 'tg', SORTIE_ENSUITE)],
    };
    expect(walk(g, 'tpl').actions.map((a) => a.nodeId)).toEqual(['tpl']);
  });
});

describe('passeSansAttente : les blocs qui peuvent suivre « Puis, sans attendre »', () => {
  it('🔴 la liste, type par type : un type ajouté demain doit être rangé ici, pas laissé au hasard', () => {
    const passent = WORKFLOW_NODE_TYPES.filter((t) => passeSansAttente(n('x', t, t === 'quick_message' ? { body: 'Texte' } : {})));
    expect([...passent].sort()).toEqual(['action', 'condition', 'email', 'field', 'http', 'js', 'mba_disable', 'mba_handoff', 'quick_message', 'tag']);
  });

  it('un message rapide passe sans bouton ou avec un bouton de lien, jamais avec une réponse rapide ni sans texte', () => {
    expect(passeSansAttente(n('x', 'quick_message', { body: 'Texte' }))).toBe(true);
    expect(passeSansAttente(n('x', 'quick_message', { body: 'Texte', lienActif: true, lienTexte: 'Voir', lienUrl: 'https://a.fr' }))).toBe(true);
    expect(passeSansAttente(n('x', 'quick_message', { body: 'Texte', quickReplies: ['Oui'] }))).toBe(false);
    expect(passeSansAttente(n('x', 'quick_message', {}))).toBe(false);
  });
});

describe('refusSuiteQuiAttend : la publication dit le montage au lieu de le laisser se taire', () => {
  it('rien à dire sans suite, ou avec une suite qui n’attend rien', () => {
    expect(refusSuiteQuiAttend(avecSuite([]))).toBeNull();
    expect(refusSuiteQuiAttend(avecSuite([n('txt', 'quick_message', { body: 'Bonne journée' }), n('tg', 'tag', { tag: 'vu' })], [e('e2', 'txt', 'tg')]))).toBeNull();
  });

  it('🔴 un refus nommé pour chaque type qui attend', () => {
    const attendent: Array<[WorkflowNodeType, Record<string, unknown>, string]> = [
      ['question', { body: 'Votre âge ?' }, 'un bloc Question'],
      ['template', { templateName: 'promo' }, 'un bloc Envoi template'],
      ['flow', { flowId: 'f1' }, 'un bloc Formulaire'],
      ['agent', { agentId: 'a1' }, 'un bloc Agent IA'],
      ['wait', { delay: 2, unit: 'hours' }, 'un bloc Attente'],
      ['inbox', {}, 'un bloc Assigner à un agent'],
      ['rcs_message', { text: 'Salut' }, 'un bloc Message RCS'],
      ['aller_a', { cible: 'nod_x' }, 'un bloc Aller à'],
      ['vers_mba', {}, 'un bloc Envoyer au MBA'],
      ['quick_message', { body: 'Autre ?', quickReplies: ['Oui'] }, 'un bloc Message rapide'],
      ['quick_message', {}, 'un Message rapide sans texte'],
    ];
    for (const [type, data, nom] of attendent) {
      const refus = refusSuiteQuiAttend(avecSuite([n('x', type, data)]));
      expect(refus, type).toContain('la sortie « Puis, sans attendre » du message « Merci pour votre aide »');
      expect(refus, type).toContain(`mène à ${nom}, qui attend`);
    }
  });

  it('🔴 derrière une condition, chaque sortie compte', () => {
    const cond = n('c', 'condition', { match: 'all', clauses: [] });
    const g = avecSuite([cond, n('ok', 'tag', { tag: 'x' }), n('q', 'question', { body: 'Votre âge ?' })], [eh('e2', 'c', 'ok', 'true'), eh('e3', 'c', 'q', 'false')]);
    expect(refusSuiteQuiAttend(g)).toContain('mène à un bloc Question');
  });

  it('plus loin sur la suite aussi, et un long texte est coupé', () => {
    const long = 'x'.repeat(80);
    const g: WorkflowGraph = {
      nodes: [n('qm', 'quick_message', { body: long, quickReplies: ['Oui'] }), n('tg', 'tag', { tag: 'a' }), n('w', 'wait', { delay: 1, unit: 'days' })],
      edges: [eh('x', 'qm', 'tg', SORTIE_ENSUITE), e('y', 'tg', 'w')],
    };
    expect(refusSuiteQuiAttend(g)).toContain(`du message « ${'x'.repeat(60)}… » mène à un bloc Attente`);
  });

  it('les autres sorties du message ne sont pas jugées : un bouton mène où il veut', () => {
    const g: WorkflowGraph = {
      nodes: [merci(), n('q', 'question', { body: 'Votre âge ?' }), n('w', 'wait', { delay: 1, unit: 'days' })],
      edges: [eh('a', 'qm', 'q', 'btn:0'), e('b', 'qm', 'w')],
    };
    expect(refusSuiteQuiAttend(g)).toBeNull();
  });
});
