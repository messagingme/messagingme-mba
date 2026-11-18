import { describe, it, expect } from 'vitest';
import { analyserFenetre, FENETRE_MS, type Depart, type ReglesFenetre } from '../web/lib/partage/fenetre-scenario';

/**
 * L'ANALYSE DE FENÊTRE PARTAGÉE (menu « Scénario », lot 2, spec décisions 11 et 16, § 5.2).
 *
 * Un scénario lancé par un événement (rayon Shopify ou HubSpot, automation qui ne naît pas d'un message) démarre fenêtre
 * FERMÉE. Le builder PRÉVIENT (sans jamais refuser) d'un message de session atteint fenêtre fermée, ou d'un « Aller à »
 * vers un autre scénario atteint fermé. Une réponse ou un clic du contact rouvre la fenêtre ; la sortie « pas de
 * réponse » la laisse fermée ; 24 h d'attente cumulées la ferment. Sans départ fourni, le scénario part ouvert à
 * l'entrée : le comportement d'aujourd'hui.
 */
type N = { id: string; type: string; data: Record<string, unknown> };
const n = (id: string, type: string, data: Record<string, unknown> = {}): N => ({ id, type, data });
const e = (source: string, target: string, sourceHandle?: string) => ({ source, target, ...(sourceHandle ? { sourceHandle } : {}) });

/** Des règles minimales, celles que fournissent le moteur et la console avec leur propre lecture des blocs. */
const regles: ReglesFenetre<N> = {
  envoieSession: (x) => x.type === 'quick_message' || x.type === 'question',
  attendUneReponse: (x) => x.type === 'template' || x.type === 'question',
  delaiSansReponseMs: (x) => Number(x.data.delaiMs ?? 0),
  dureeAttenteMs: (x) => (x.type === 'wait' ? Number(x.data.dureeMs ?? 0) : 0),
};
const ferme = (noeudId: string | null = null): Depart => ({ noeudId, fenetre: 'fermee', raison: 'une date' });
const ouvert = (noeudId: string | null = null): Depart => ({ noeudId, fenetre: 'ouverte', raison: 'un mot-clé' });

describe('🔴 l’analyse de fenêtre au départ', () => {
  it('départ fermé, puis un message rapide : c’est un constat', () => {
    const g = { nodes: [n('rapide', 'quick_message')], edges: [] };
    expect(analyserFenetre(g, [ferme()], regles).map((c) => [c.noeudId, c.raison])).toEqual([['rapide', 'session_fenetre_fermee']]);
  });

  it('départ fermé, un template, un CLIC, puis un message rapide : rien, le clic a rouvert la fenêtre', () => {
    const g = { nodes: [n('t', 'template'), n('rapide', 'quick_message')], edges: [e('t', 'rapide', 'btn:0')] };
    expect(analyserFenetre(g, [ferme()], regles)).toEqual([]);
  });

  it('🔴 départ fermé, un template, sa sortie « pas de réponse », puis un message rapide : constat', () => {
    const g = { nodes: [n('t', 'template', { delaiMs: 30 * 60_000 }), n('rapide', 'quick_message')], edges: [e('t', 'rapide', 'timeout')] };
    expect(analyserFenetre(g, [ferme()], regles).map((c) => c.noeudId)).toEqual(['rapide']);
  });

  it('départ OUVERT, une Question qui attend 30 h, sa sortie « pas de réponse », puis un message rapide : constat (24 h cumulées)', () => {
    const g = { nodes: [n('q', 'question', { delaiMs: 30 * 3_600_000 }), n('rapide', 'quick_message')], edges: [e('q', 'rapide', 'timeout')] };
    expect(analyserFenetre(g, [ouvert()], regles).map((c) => c.noeudId)).toEqual(['rapide']);
  });

  it('départ ouvert et attente de moins de 24 h : rien', () => {
    const g = { nodes: [n('w', 'wait', { dureeMs: 2 * 3_600_000 }), n('rapide', 'quick_message')], edges: [e('w', 'rapide')] };
    expect(analyserFenetre(g, [ouvert()], regles)).toEqual([]);
    const long = { ...g, nodes: [n('w', 'wait', { dureeMs: FENETRE_MS }), n('rapide', 'quick_message')] };
    expect(analyserFenetre(long, [ouvert()], regles).map((c) => c.noeudId)).toEqual(['rapide']);
  });

  it('plusieurs départs : seul le départ fermé produit son constat, et il le porte', () => {
    const g = {
      nodes: [n('rapide-a', 'quick_message'), n('t', 'template'), n('rapide-b', 'quick_message')],
      edges: [e('rapide-a', 't'), e('t', 'rapide-b', 'timeout')],
    };
    const constats = analyserFenetre(g, [ouvert(), ferme('t')], regles);
    expect(constats.map((c) => [c.noeudId, c.depart.noeudId])).toEqual([['rapide-b', 't']]);
  });

  it('un « Aller à » vers un autre scénario, atteint fermé : constat de saut', () => {
    const g = { nodes: [n('saut', 'aller_a', { cible: 'nod_ab_AILLEURS000000000000000000' })], edges: [] };
    expect(analyserFenetre(g, [ferme()], regles).map((c) => [c.noeudId, c.raison])).toEqual([['saut', 'saut_fenetre_fermee']]);
  });

  it('un « Aller à » interne est suivi', () => {
    const g = {
      nodes: [n('saut', 'aller_a', { cible: 'nod_ab_ICI00000000000000000000000' }), n('rapide', 'quick_message', { code: 'nod_ab_ICI00000000000000000000000' })],
      edges: [],
    };
    expect(analyserFenetre(g, [ferme('saut')], regles).map((c) => c.noeudId)).toEqual(['rapide']);
  });

  it('sans départ fourni : ouvert à l’entrée, le comportement d’aujourd’hui', () => {
    const g = { nodes: [n('rapide', 'quick_message')], edges: [] };
    expect(analyserFenetre(g, [], regles)).toEqual([]);
  });

  it('un cycle se termine', () => {
    const g = { nodes: [n('a', 'tag'), n('b', 'tag')], edges: [e('a', 'b'), e('b', 'a')] };
    expect(analyserFenetre(g, [ferme()], regles)).toEqual([]);
  });
});
