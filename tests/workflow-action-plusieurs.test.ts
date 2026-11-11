import { describe, it, expect } from 'vitest';
import { walk, actionOf } from '../src/workflow/engine';
import { collectNodes } from '../src/workflow/node-list';
import { champsAVider, etiquettesARetirer, sousActions } from '../web/lib/partage/actions-bloc';
import type { WorkflowGraph, WorkflowNodeType } from '../src/workflow/graph';
import type { EvalContext } from '../src/workflow/conditions';

/**
 * UN BLOC « ACTION » À PLUSIEURS ACTIONS (Julien, 2026-11-11). Mettre à jour trois champs demandait trois blocs ; la
 * première action reste à plat dans `data`, les suivantes vivent dans `data.suite`. Retirer des étiquettes et vider
 * des champs prennent une LISTE. Ce qui compte : l'ordre, la copie de travail entre deux actions, et qu'un bloc
 * d'avant se lise à l'identique.
 */

const n = (id: string, type: WorkflowNodeType, data: Record<string, unknown> = {}): WorkflowGraph['nodes'][number] => ({ id, type, position: { x: 0, y: 0 }, data });
const e = (id: string, source: string, target: string, sourceHandle?: string) => ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  fields: {}, tags: [], optIn: 'unknown', name: null, phone: null, bsuid: null, analyse: null,
  now: new Date('2026-08-03T12:00:00Z'), timeZone: 'Europe/Paris', businessHours: null as never, ...over,
});
const seul = (data: Record<string, unknown>): WorkflowGraph => ({ nodes: [n('a', 'action', data)], edges: [] });

describe('bloc Action : plusieurs actions jouées à la suite', () => {
  it('joue la première action puis chaque action de la suite, dans l’ordre, toutes rattachées au bloc', () => {
    const g = seul({
      actionKind: 'set_field', fieldKey: 'prenom', value: 'Anne',
      suite: [
        { actionKind: 'set_field', fieldKey: 'ville', value: 'Lyon' },
        { actionKind: 'add_tag', tag: 'vip' },
        { actionKind: 'set_optout' },
      ],
    });
    expect(walk(g, 'a', ctx()).actions).toEqual([
      { nodeId: 'a', action: { kind: 'field', key: 'prenom', value: 'Anne' } },
      { nodeId: 'a', action: { kind: 'field', key: 'ville', value: 'Lyon' } },
      { nodeId: 'a', action: { kind: 'tag', tag: 'vip' } },
      { nodeId: 'a', action: { kind: 'optIn', value: 'opted_out' } },
    ]);
  });

  it('une action incomplète de la suite est sautée sans emporter les autres', () => {
    const g = seul({ actionKind: 'add_tag', tag: '', suite: [{ actionKind: 'clear_field' }, { actionKind: 'add_tag', tag: 'ok' }, 'pas un objet'] });
    expect(walk(g, 'a').actions.map((s) => s.action)).toEqual([{ kind: 'tag', tag: 'ok' }]);
  });

  it('retirer une LISTE d’étiquettes et vider une LISTE de champs : une action par élément', () => {
    const g = seul({
      actionKind: 'remove_tag', tags: ['vip', ' prospect ', '', 'vip'],
      suite: [{ actionKind: 'clear_field', champs: [{ key: 'ville', label: 'Ville' }, { key: 'statut', label: 'Statut' }, { key: '' }] }],
    });
    expect(walk(g, 'a').actions.map((s) => s.action)).toEqual([
      { kind: 'removeTag', tag: 'vip' },
      { kind: 'removeTag', tag: 'prospect' },
      { kind: 'clearField', key: 'ville' },
      { kind: 'clearField', key: 'statut' },
    ]);
  });

  it('un bloc d’avant (une action à plat, `tag` et `fieldKey` uniques) se lit à l’identique', () => {
    expect(walk(seul({ actionKind: 'remove_tag', tag: 'vip' }), 'a').actions.map((s) => s.action)).toEqual([{ kind: 'removeTag', tag: 'vip' }]);
    expect(walk(seul({ actionKind: 'clear_field', fieldKey: 'statut' }), 'a').actions.map((s) => s.action)).toEqual([{ kind: 'clearField', key: 'statut' }]);
    expect(actionOf(n('a', 'action', { actionKind: 'add_tag', tag: 'x' }))).toEqual({ kind: 'tag', tag: 'x' });
  });

  it('`actionOf` rend la première action qui fait quelque chose, même quand elle est dans la suite', () => {
    expect(actionOf(n('a', 'action', { actionKind: 'add_tag', tag: '', suite: [{ actionKind: 'set_optin' }] }))).toEqual({ kind: 'optIn', value: 'opted_in' });
    expect(actionOf(n('a', 'action', { actionKind: 'add_tag', tag: '' }))).toBeNull();
  });

  it('chaque action est vue par la suivante et par une condition en aval (copie de travail)', () => {
    // La 2e action recopie le dernier message : elle voit le contexte. La condition en aval voit le champ vidé ET
    // l'étiquette retirée par le même bloc.
    const g: WorkflowGraph = {
      nodes: [
        n('a', 'action', {
          actionKind: 'clear_field', champs: [{ key: 'statut' }],
          suite: [{ actionKind: 'remove_tag', tags: ['vip'] }, { actionKind: 'set_field', fieldKey: 'note', valueKind: 'derniere_saisie' }],
        }),
        n('c', 'condition', { match: 'all', clauses: [{ kind: 'field', key: 'statut', op: 'empty' }, { kind: 'tag', op: 'not_has', tag: 'vip' }] }),
        n('ok', 'tag', { tag: 'nettoye' }), n('ko', 'tag', { tag: 'reste' }),
      ],
      edges: [e('e0', 'a', 'c'), e('e1', 'c', 'ok', 'true'), e('e2', 'c', 'ko', 'false')],
    };
    const faites = walk(g, 'a', ctx({ fields: { statut: 'actif' }, tags: ['vip'], derniereSaisie: 'bonjour' })).actions.map((s) => s.action);
    expect(faites).toContainEqual({ kind: 'field', key: 'note', value: 'bonjour' });
    expect(faites).toContainEqual({ kind: 'tag', tag: 'nettoye' });
    expect(faites).not.toContainEqual({ kind: 'tag', tag: 'reste' });
  });
});

describe('lecture partagée des actions d’un bloc', () => {
  it('`sousActions` : la première à plat, puis la suite ; une suite qui n’est pas une liste ne compte pas', () => {
    expect(sousActions({ actionKind: 'add_tag', suite: [{ actionKind: 'set_optin' }] }).map((x) => x.actionKind)).toEqual(['add_tag', 'set_optin']);
    expect(sousActions({ actionKind: 'add_tag', suite: 'non' })).toHaveLength(1);
  });
  it('la liste prime sur l’ancienne valeur unique, dédoublonnée et sans vide', () => {
    expect(etiquettesARetirer({ tags: ['a', 'a', ' '], tag: 'ancien' })).toEqual(['a']);
    expect(etiquettesARetirer({ tag: 'ancien' })).toEqual(['ancien']);
    expect(champsAVider({ champs: [{ key: 'x', label: 'X' }, { key: 'x', label: 'Y' }], fieldKey: 'ancien' })).toEqual([{ key: 'x', label: 'X' }]);
    expect(champsAVider({ fieldKey: 'ancien', fieldLabel: 'Ancien' })).toEqual([{ key: 'ancien', label: 'Ancien' }]);
  });
  it('le résumé du MCP dit chaque action du bloc', () => {
    const [item] = collectNodes([{
      id: 'w', tenantId: 't', name: 'S', code: `scn_ab_${'0'.repeat(26)}`, createdAt: '', updatedAt: '',
      graph: { nodes: [n('a', 'action', { actionKind: 'set_field', fieldKey: 'ville', fieldLabel: 'Ville', value: 'Lyon', suite: [{ actionKind: 'remove_tag', tags: ['vip', 'chaud'] }, { actionKind: 'clear_field', champs: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] }] })], edges: [] },
    } as never]);
    expect(item?.summary).toBe('Ville = Lyon · − vip, − chaud · A, B (vidés)');
  });
});
