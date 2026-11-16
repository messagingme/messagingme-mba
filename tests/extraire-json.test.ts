import { describe, it, expect } from 'vitest';
import { extraireDuJson, lignesDuBloc, valeurExtraite, MAX_LIGNES_EXTRACTION } from '../web/lib/partage/extraire-json';
import { walk } from '../src/workflow/engine';
import type { WorkflowGraph, WorkflowNodeType } from '../src/workflow/graph';
import type { EvalContext } from '../src/workflow/conditions';

/**
 * LE BLOC « EXTRAIRE DU JSON » (plan `docs/superpowers/plans/2026-11-11-champ-json-lot-2.md`). Le calcul pur, puis le
 * moteur : une Condition qui suit voit les valeurs extraites, sans arrêt du parcours. L'écriture (source relue, type de
 * la cible) est tenue par `tests/workflow-executor.test.ts`.
 */
const PANIER = JSON.stringify({
  id: 1,
  products: [{ title: 'Blue Frock', price: 29.99 }, { title: 'iPhone 6', price: 299.99 }, { title: 'Baseball Ball', price: 8.99 }],
  livre: false,
  coupon: null,
});
const v = (chemin: string, mesure: 'valeur' | 'nombre' = 'valeur') => valeurExtraite(JSON.parse(PANIER), { chemin, mesure });

describe('extraire une valeur d’un JSON', () => {
  it('une clé, un index, l’index depuis la fin', () => {
    expect(v('id')).toBe('1');
    expect(v('products[0].title')).toBe('Blue Frock');
    expect(v('products[-1].title')).toBe('Baseball Ball');
    expect(v('products[1].price')).toBe('299.99');
    expect(v('livre')).toBe('false');
  });

  it('`[-0]` vaut `[0]` ; un entier au-delà de 2^53 ne se range pas (il a perdu sa précision)', () => {
    expect(v('products[-0].title')).toBe('Blue Frock');
    expect(valeurExtraite(JSON.parse('{"id":1234567890123456789}'), { chemin: 'id', mesure: 'valeur' })).toBe('');
    expect(valeurExtraite(JSON.parse('{"id":"1234567890123456789"}'), { chemin: 'id', mesure: 'valeur' })).toBe('1234567890123456789');
    expect(valeurExtraite({ prix: 12.5 }, { chemin: 'prix', mesure: 'valeur' })).toBe('12.5');
  });

  it('le nombre d’éléments d’une liste ; sur autre chose, rien', () => {
    expect(v('products', 'nombre')).toBe('3');
    expect(v('id', 'nombre')).toBe('');
    // La racine (chemin vide) : une réponse qui est elle-même une liste.
    expect(valeurExtraite([1, 2], { chemin: '', mesure: 'nombre' })).toBe('2');
  });

  it('un objet ou une liste sort en JSON compact : c’est ce qu’un champ JSON reçoit', () => {
    expect(v('products[0]')).toBe('{"title":"Blue Frock","price":29.99}');
  });

  it('🔴 un chemin absent, une valeur nulle, un index hors de la liste : rien (la cible sera vidée)', () => {
    for (const c of ['absent', 'coupon', 'products[9].title', 'products[-9].title', 'id.sous']) expect(v(c), c).toBe('');
  });

  it('🔴 une source vide ou qui n’est pas du JSON vide CHAQUE cible : l’appel en amont a échoué', () => {
    const lignes = [{ chemin: 'id', mesure: 'valeur' as const, champCible: 'a' }, { chemin: 'products', mesure: 'nombre' as const, champCible: 'b' }];
    expect(extraireDuJson('', lignes)).toEqual([{ champCible: 'a', valeur: '' }, { champCible: 'b', valeur: '' }]);
    expect(extraireDuJson('pas du json', lignes).map((r) => r.valeur)).toEqual(['', '']);
    expect(extraireDuJson(PANIER, lignes).map((r) => r.valeur)).toEqual(['1', '3']);
  });

  it('les lignes d’un bloc : sans cible ou au chemin illisible, écartées ; bornées', () => {
    const data = {
      lignes: [
        { chemin: 'id', mesure: 'valeur', champCible: 'a' }, { chemin: 'id', champCible: '' }, { chemin: 'a..b', champCible: 'c' },
        { chemin: '', mesure: 'nombre', champCible: 'd' }, 'nimporte', null,
      ],
    };
    expect(lignesDuBloc(data)).toEqual([
      { chemin: 'id', mesure: 'valeur', champCible: 'a' }, { chemin: '', mesure: 'nombre', champCible: 'd' },
    ]);
    const beaucoup = { lignes: Array.from({ length: 30 }, (_, i) => ({ chemin: 'id', champCible: `c${i}` })) };
    expect(lignesDuBloc(beaucoup)).toHaveLength(MAX_LIGNES_EXTRACTION);
  });
});

const n = (id: string, type: WorkflowNodeType, data: Record<string, unknown> = {}): WorkflowGraph['nodes'][number] => ({ id, type, position: { x: 0, y: 0 }, data });
const e = (id: string, source: string, target: string) => ({ id, source, target });
const eh = (id: string, source: string, target: string, sourceHandle: string) => ({ id, source, target, sourceHandle });
const ctx = (fields: Record<string, unknown>): EvalContext => ({
  fields, tags: [], optIn: 'unknown', name: null, phone: null, bsuid: null, analyse: null,
  now: new Date('2026-11-16T12:00:00Z'), timeZone: 'Europe/Paris', businessHours: {},
});

describe('walk : le bloc Extraire du JSON', () => {
  // extraire (panier -> nb_articles) -> condition (nb_articles >= 3) --true--> tag ok ; --false--> tag ko
  const graphe: WorkflowGraph = {
    nodes: [
      n('x', 'extraire', { champSource: 'panier', lignes: [{ chemin: 'products', mesure: 'nombre', champCible: 'nb_articles' }] }),
      n('c', 'condition', { match: 'all', clauses: [{ kind: 'field', key: 'nb_articles', op: 'gte', value: '3', valueType: 'number' }] }),
      n('ok', 'tag', { tag: 'ok' }), n('ko', 'tag', { tag: 'ko' }),
    ],
    edges: [e('e1', 'x', 'c'), eh('e2', 'c', 'ok', 'true'), eh('e3', 'c', 'ko', 'false')],
  };

  it('🔴 une Condition qui suit lit la valeur EXTRAITE, sans arrêt du parcours (campagne comprise)', () => {
    for (const attendreLesAppels of [true, false]) {
      const r = walk(graphe, 'x', ctx({ panier: PANIER }), { attendreLesAppels });
      expect(r.actions.map((a) => a.nodeId)).toEqual(['x', 'ok']);
      expect(r.rest).toEqual({ status: 'done' });
    }
  });

  it('🔴 la copie de travail VALIDE comme l’exécuteur : une valeur que le type refuse est vide pour la Condition', () => {
    // Relecture du lot 2 : sans les types, la Condition « montant renseigné » voyait « beaucoup » et prenait la branche
    // « vraie », alors que l'exécuteur écrivait une cible vide, et le message partait avec un {{montant}} vide.
    const g: WorkflowGraph = {
      nodes: [
        n('x', 'extraire', { champSource: 'panier', lignes: [{ chemin: 'total', champCible: 'montant' }] }),
        n('c', 'condition', { match: 'all', clauses: [{ kind: 'field', key: 'montant', op: 'not_empty' }] }),
        n('ok', 'tag', { tag: 'ok' }), n('ko', 'tag', { tag: 'ko' }),
      ],
      edges: [e('e1', 'x', 'c'), eh('e2', 'c', 'ok', 'true'), eh('e3', 'c', 'ko', 'false')],
    };
    const panier = JSON.stringify({ total: 'beaucoup' });
    expect(walk(g, 'x', { ...ctx({ panier }), typesChamps: { montant: 'number' } }).actions.map((a) => a.nodeId)).toEqual(['x', 'ko']);
    // Sans type connu (champ pas encore créé), la valeur passe telle quelle, comme à l'écriture.
    expect(walk(g, 'x', ctx({ panier })).actions.map((a) => a.nodeId)).toEqual(['x', 'ok']);
  });

  it('une source vide : la cible est vide, la Condition prend « Sinon »', () => {
    expect(walk(graphe, 'x', ctx({})).actions.map((a) => a.nodeId)).toEqual(['x', 'ko']);
  });

  it('un bloc sans source ou sans ligne lisible est un passe-plat : rien n’est extrait, la Condition prend « Sinon »', () => {
    const vide: WorkflowGraph = { ...graphe, nodes: graphe.nodes.map((x) => (x.id === 'x' ? n('x', 'extraire', { champSource: 'panier', lignes: [] }) : x)) };
    expect(walk(vide, 'x', ctx({ panier: PANIER })).actions.map((a) => a.nodeId)).toEqual(['ko']);
  });
});
