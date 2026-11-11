import { describe, it, expect } from 'vitest';
import { walk, REPRISE_APRES_APPEL_MS } from '../src/workflow/engine';
import type { WorkflowGraph, WorkflowNodeType } from '../src/workflow/graph';
import type { EvalContext } from '../src/workflow/conditions';
import { SORTIE_ENSUITE } from '../web/lib/partage/sortie-ensuite';

/**
 * LA MARCHE S'ARRÊTE APRÈS UN APPEL QUI RANGE UN CHAMP, quand on le lui demande (`attendreLesAppels`, plan
 * `docs/superpowers/plans/2026-11-11-appel-api-puis-condition.md`). Le parcours de bout en bout (démarrage, reprise) est
 * tenu par `tests/workflow-executor.test.ts` ; ici, les cas du moteur seul.
 */
const n = (id: string, type: WorkflowNodeType, data: Record<string, unknown> = {}): WorkflowGraph['nodes'][number] => ({ id, type, position: { x: 0, y: 0 }, data });
const e = (id: string, source: string, target: string) => ({ id, source, target });
const eh = (id: string, source: string, target: string, sourceHandle: string) => ({ id, source, target, sourceHandle });
const ctx = (): EvalContext => ({
  fields: {}, tags: [], optIn: 'unknown', name: null, phone: null, bsuid: null, analyse: null,
  now: new Date('2026-11-11T12:00:00Z'), timeZone: 'Europe/Paris', businessHours: {},
});
const condition = n('c', 'condition', { match: 'all', clauses: [{ kind: 'field', key: 'statut', op: 'not_empty' }] });
const apres = (premier: WorkflowGraph['nodes'][number]): WorkflowGraph => ({
  nodes: [premier, condition, n('ok', 'tag', { tag: 'ok' }), n('ko', 'tag', { tag: 'ko' })],
  edges: [e('e1', premier.id, 'c'), eh('e2', 'c', 'ok', 'true'), eh('e3', 'c', 'ko', 'false')],
});
const SOMMEIL = { status: 'sleeping', resumeInMs: REPRISE_APRES_APPEL_MS };

describe('walk : arrêt après un appel qui range un champ', () => {
  it('🔴 Appel API avec champ, suivi d’une condition : arrêt SUR l’appel, la condition n’est pas décidée', () => {
    const r = walk(apres(n('h', 'http', { requestId: 'req-1', champCible: 'statut' })), 'h', ctx(), { attendreLesAppels: true });
    expect(r.actions.map((a) => a.action.kind)).toEqual(['appelHttp']);
    expect(r.rest).toEqual({ ...SOMMEIL, nodeId: 'h' });
  });

  it('🔴 Fonction JS avec champ : même arrêt', () => {
    const js = n('j', 'js', { js: 'return valeur', champSource: 'x', champCible: 'statut' });
    const r = walk(apres(js), 'j', ctx(), { attendreLesAppels: true });
    expect(r.actions.map((a) => a.action.kind)).toEqual(['fonctionJs']);
    expect(r.rest).toEqual({ ...SOMMEIL, nodeId: 'j' });
  });

  it('sans l’option, la marche d’avant : elle traverse, et la condition lit la copie (vide) -> « Sinon »', () => {
    const r = walk(apres(n('h', 'http', { requestId: 'req-1', champCible: 'statut' })), 'h', ctx());
    expect(r.actions.map((a) => a.nodeId)).toEqual(['h', 'ko']);
    expect(r.rest).toEqual({ status: 'done' });
  });

  it('🔴 une boucle SANS Attente (appel -> condition -> appel) ne s’endort pas : chaque réveil rappellerait le client', () => {
    const g: WorkflowGraph = {
      nodes: [n('h', 'http', { requestId: 'req-1', champCible: 'statut' }), condition, n('ok', 'tag', { tag: 'ok' })],
      edges: [e('e1', 'h', 'c'), eh('e2', 'c', 'ok', 'true'), eh('e3', 'c', 'h', 'false')],
    };
    const r = walk(g, 'h', ctx(), { attendreLesAppels: true });
    // La marche d'avant : un seul passage sur l'appel, puis la garde `visited` arrête la boucle.
    expect(r.actions.map((a) => a.nodeId)).toEqual(['h']);
    expect(r.rest).toEqual({ status: 'done' });
  });

  it('la même boucle AVEC une Attente s’endort : la reprise ne repasse sur l’appel qu’après l’attente', () => {
    const g: WorkflowGraph = {
      nodes: [
        n('h', 'http', { requestId: 'req-1', champCible: 'statut' }), condition, n('ok', 'tag', { tag: 'ok' }),
        n('w', 'wait', { delay: 5, unit: 'minutes' }),
      ],
      edges: [e('e1', 'h', 'c'), eh('e2', 'c', 'ok', 'true'), eh('e3', 'c', 'w', 'false'), e('e4', 'w', 'h')],
    };
    expect(walk(g, 'h', ctx(), { attendreLesAppels: true }).rest).toEqual({ ...SOMMEIL, nodeId: 'h' });
    // Une Attente SANS délai passe sans attendre : la boucle redevient serrée, pas d'arrêt.
    const vide: WorkflowGraph = { ...g, nodes: g.nodes.map((x) => (x.id === 'w' ? n('w', 'wait', {}) : x)) };
    expect(walk(vide, 'h', ctx(), { attendreLesAppels: true }).rest).toEqual({ status: 'done' });
  });

  it('un appel qui pousse (sans champ) traverse : rien à relire', () => {
    const r = walk(apres(n('h', 'http', { requestId: 'req-1' })), 'h', ctx(), { attendreLesAppels: true });
    expect(r.rest.status).toBe('done');
  });

  it('un appel en fin de chaîne ne s’endort pas : il n’y a pas de suite à reprendre', () => {
    const seul: WorkflowGraph = { nodes: [n('h', 'http', { requestId: 'req-1', champCible: 'statut' })], edges: [] };
    expect(walk(seul, 'h', ctx(), { attendreLesAppels: true }).rest).toEqual({ status: 'done' });
  });

  it('🔴 dans une suite « Puis, sans attendre », pas d’arrêt : son repos est ignoré, le reste partirait à la trappe', () => {
    const g: WorkflowGraph = {
      nodes: [
        n('qm', 'quick_message', { body: 'Merci', quickReplies: ['Menu'] }), n('menu', 'quick_message', { body: 'Menu' }),
        n('h', 'http', { requestId: 'req-1', champCible: 'statut' }), n('tg', 'tag', { tag: 'vu' }),
      ],
      edges: [eh('e-btn', 'qm', 'menu', 'btn:0'), eh('e-ensuite', 'qm', 'h', SORTIE_ENSUITE), e('e2', 'h', 'tg')],
    };
    const r = walk(g, 'qm', ctx(), { attendreLesAppels: true });
    expect(r.actions.map((a) => a.nodeId)).toEqual(['qm', 'h', 'tg']);
    expect(r.rest).toEqual({ status: 'waiting', nodeId: 'qm' });
  });
});
