import { describe, it, expect } from 'vitest';
import { copierGraphe, referencesDuGraphe, rebrancher } from '../src/ops/duplication/graphe';
import { parseGraph, MAX_NODES, type WorkflowGraph, type WorkflowNodeType } from '../src/workflow/graph';

/**
 * LA COPIE D'UN GRAPHE VERS UN AUTRE ESPACE (duplication depuis /ops, lot 1, plan
 * `docs/superpowers/plans/2026-11-16-duplication-scenario-lot-1.md`, tâche 1).
 *
 * Un cas par ligne de la table « Ce que devient chaque bloc » de la spec : ce qui pointe un objet de l'espace source est
 * débranché et listé, ce qui se recrée dans la destination (champs, tags, templates) est collecté, le reste passe tel
 * quel. Les codes publics sont refaits au code client de la destination.
 */

const SOURCE = 'src01';
const DEST = 'dst02';
const code = (i: number) => `nod_${SOURCE}_01J${String(i).padStart(23, '0')}`;
const n = (id: string, type: WorkflowNodeType, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 10, y: 20 }, data: { code: code(Number(id.replace(/\D/g, '')) || 1), ...data } });
const e = (source: string, target: string, sourceHandle?: string) =>
  ({ id: `${source}>${target}>${sourceHandle ?? ''}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
const g = (nodes: WorkflowGraph['nodes'], edges: WorkflowGraph['edges'] = []): WorkflowGraph => ({ nodes, edges });
const bloc = (copie: WorkflowGraph, id: string) => copie.nodes.find((x) => x.id === id)!;

describe('copierGraphe : ce qui pointe l’espace source est débranché et listé', () => {
  it('« aller vers » : cible vidée, même vers un bloc du même scénario', () => {
    const r = copierGraphe(g([
      n('q1', 'question', { body: 'Votre prénom ?' }),
      n('a2', 'aller_a', { cible: code(1), cibleLibelle: 'Votre prénom ?' }),
      n('a3', 'aller_a', { cible: `nod_${SOURCE}_01JZZZZZZZZZZZZZZZZZZZZZZZ`, cibleLibelle: 'Autre scénario' }),
    ]), DEST);
    expect(bloc(r.graphe, 'a2').data).toMatchObject({ cible: '', cibleLibelle: '' });
    expect(bloc(r.graphe, 'a3').data).toMatchObject({ cible: '', cibleLibelle: '' });
    expect(r.debranches.filter((d) => d.raison === 'aller_a').map((d) => d.nodeId)).toEqual(['a2', 'a3']);
  });

  it('« assigner à » : la personne retirée, la conversation ira au pot commun', () => {
    const r = copierGraphe(g([n('i1', 'inbox', { assigneA: '6f1c3c1e-1111-4111-8111-111111111111', assigneNom: 'Léa' })]), DEST);
    expect(bloc(r.graphe, 'i1').data).toMatchObject({ assigneA: '', assigneNom: '' });
    expect(r.debranches).toEqual([{ nodeId: 'i1', nom: expect.any(String), type: 'inbox', raison: 'assignation' }]);
  });

  it('agent, appel API, e-mail et Flow : références vidées, chacun sous sa raison', () => {
    const r = copierGraphe(g([
      n('g1', 'agent', { agentId: 'a-1', agentLabel: 'Conseiller', sorties: [{ code: 'rdv', libelle: 'RDV' }] }),
      n('h2', 'http', { requestId: 'r-1', requeteLabel: 'Créer le lead', champCible: 'lead_id' }),
      n('m3', 'email', { emailAccountId: 'b-1', templateId: 't-1', to: [{ kind: 'literal', value: 'a@b.fr' }] }),
      n('f4', 'flow', { flowId: '123456', flowName: 'Inscription', cta: 'Ouvrir' }),
    ], [e('g1', 'h2', 'sortie:rdv'), e('h2', 'm3'), e('m3', 'f4')]), DEST);
    expect(bloc(r.graphe, 'g1').data).toMatchObject({ agentId: '', agentLabel: '', sorties: [{ code: 'rdv', libelle: 'RDV' }] });
    expect(bloc(r.graphe, 'h2').data).toMatchObject({ requestId: '', requeteLabel: '', champCible: 'lead_id' });
    expect(bloc(r.graphe, 'm3').data).toMatchObject({ emailAccountId: '', templateId: '', to: [{ kind: 'literal', value: 'a@b.fr' }] });
    expect(bloc(r.graphe, 'f4').data).toMatchObject({ flowId: '', flowName: '', cta: 'Ouvrir' });
    expect(r.debranches.map((d) => [d.nodeId, d.raison])).toEqual([['g1', 'agent'], ['h2', 'appel_api'], ['m3', 'email'], ['f4', 'flow']]);
    expect(r.graphe.edges).toEqual([e('g1', 'h2', 'sortie:rdv'), e('h2', 'm3'), e('m3', 'f4')]);
  });

  it('un bloc qui ne pointait déjà rien n’est pas listé', () => {
    const r = copierGraphe(g([n('a1', 'aller_a', { cible: '' }), n('i2', 'inbox', {}), n('g3', 'agent', { agentId: '  ' })]), DEST);
    expect(r.debranches).toEqual([]);
  });

  it('le nom listé est celui que l’écran montre', () => {
    const r = copierGraphe(g([n('g1', 'agent', { agentId: 'a-1', name: 'Qualifier le besoin' })]), DEST);
    expect(r.debranches[0]!.nom).toBe('Qualifier le besoin');
  });
});

describe('copierGraphe : ce qui se recrée dans la destination est collecté', () => {
  it('template : inchangé, nom et langue collectés une fois', () => {
    const t = { templateName: 'bienvenue', language: 'fr', templateButtons: [{ type: 'QUICK_REPLY', text: 'Oui' }] };
    const r = copierGraphe(g([n('t1', 'template', t), n('t2', 'template', t), n('t3', 'template', { templateName: 'relance' })]), DEST);
    expect(bloc(r.graphe, 't1').data).toMatchObject(t);
    expect(r.templates).toEqual([{ nom: 'bienvenue', langue: 'fr' }, { nom: 'relance', langue: 'fr' }]);
  });

  it('les clés de champ de chaque bloc qui en porte une', () => {
    const r = copierGraphe(g([
      n('q1', 'question', { body: 'Votre ville ?', champReponse: 'ville' }),
      n('a2', 'action', {
        actionKind: 'set_field', fieldKey: 'statut', value: 'chaud',
        suite: [{ actionKind: 'clear_field', champs: [{ key: 'relance', label: 'Relance' }] }, { actionKind: 'add_tag', tag: 'VIP' }],
      }),
      n('f3', 'field', { fieldKey: 'source' }),
      n('c4', 'condition', { match: 'all', clauses: [{ kind: 'field', key: 'score', op: 'gt', value: '3' }, { kind: 'tag', op: 'has', tag: 'vip' }] }),
      n('c5', 'condition', { familles: [{ code: 'f1', nom: 'Récent', groupe: { match: 'any', clauses: [{ kind: 'datetime', key: 'rdv_le', op: 'after' }] } }] }),
      n('j6', 'js', { js: 'return 1', champSource: 'brut', champCible: 'propre' }),
      n('x7', 'extraire', { champSource: 'reponse_api', lignes: [{ chemin: 'a.b', mesure: 'valeur', champCible: 'code_postal' }] }),
      n('h8', 'http', { requestId: 'r-1', champCible: 'lead_id' }),
      n('m9', 'email', { to: [{ kind: 'field', field: 'email_pro' }, { kind: 'literal', value: 'a@b.fr' }] }),
      n('t10', 'template', { templateName: 'rdv', variables: [{ position: 1, source: { type: 'field', key: 'date_rdv' } }, { position: 2, source: { type: 'now' } }] }),
    ]), DEST);
    expect([...r.clesDeChamp].sort()).toEqual([
      'brut', 'code_postal', 'date_rdv', 'email_pro', 'lead_id', 'propre', 'rdv_le', 'relance', 'reponse_api', 'score', 'source',
      'statut', 'ville',
    ]);
  });

  it('une clé système n’est jamais collectée ; une clé vide ou en double non plus', () => {
    const r = copierGraphe(g([
      n('f1', 'field', { fieldKey: 'prenom' }),
      n('f2', 'field', { fieldKey: '  ' }),
      n('f3', 'field', { fieldKey: 'ville' }),
      n('q4', 'question', { body: 'Ville ?', champReponse: 'ville' }),
    ]), DEST);
    expect(r.clesDeChamp).toEqual(['ville']);
  });

  it('tags : ceux que le scénario pose, normalisés comme à la pose', () => {
    const r = copierGraphe(g([
      n('t1', 'tag', { tag: 'Client VIP' }),
      n('a2', 'action', { actionKind: 'add_tag', tag: 'relancé' }),
      n('a3', 'action', { actionKind: 'remove_tag', tag: 'froid' }),
    ]), DEST);
    expect(r.tags).toHaveLength(2);
    expect(r.tags).not.toContain('froid');
  });
});

describe('copierGraphe : forme du graphe rendu', () => {
  it('aucun code de la source ne survit : chaque code est au code client de la destination', () => {
    const r = copierGraphe(g([n('q1', 'question', { body: 'A' }), n('w2', 'wait', { delay: 1, unit: 'hours' })]), DEST);
    for (const x of r.graphe.nodes) expect(String(x.data.code)).toMatch(new RegExp(`^nod_${DEST}_[0-9A-HJKMNP-TV-Z]{26}$`));
    expect(JSON.stringify(r.graphe)).not.toContain(`nod_${SOURCE}_`);
  });

  it('ids, positions, types et arêtes sont gardés', () => {
    const source = g([n('q1', 'question', { body: 'A' }), n('w2', 'wait', { delay: 1 })], [e('q1', 'w2', 'timeout')]);
    const r = copierGraphe(source, DEST);
    expect(r.graphe.nodes.map((x) => [x.id, x.type, x.position])).toEqual(source.nodes.map((x) => [x.id, x.type, x.position]));
    expect(r.graphe.edges).toEqual(source.edges);
  });

  it('un bloc JS ancien dont la source est dans data.code la garde (déplacée dans data.js)', () => {
    const r = copierGraphe(g([{ id: 'j1', type: 'js', position: { x: 0, y: 0 }, data: { code: 'return input.trim()', champSource: 'a', champCible: 'b' } }]), DEST);
    expect(bloc(r.graphe, 'j1').data.js).toBe('return input.trim()');
    expect(String(bloc(r.graphe, 'j1').data.code)).toMatch(new RegExp(`^nod_${DEST}_`));
  });

  it('la source n’est jamais modifiée', () => {
    const source = g([n('a1', 'aller_a', { cible: code(9) }), n('g2', 'agent', { agentId: 'a-1' })]);
    const avant = JSON.stringify(source);
    copierGraphe(source, DEST);
    expect(JSON.stringify(source)).toBe(avant);
  });

  it('le graphe rendu repasse parseGraph, y compris aux plafonds (200 blocs, 400 arêtes)', () => {
    const nodes = Array.from({ length: MAX_NODES }, (_, i) => n(`b${i + 1}`, i % 2 ? 'agent' : 'aller_a', { agentId: 'a', cible: code(1) }));
    const edges = Array.from({ length: 400 }, (_, i) => ({ id: `e${i}`, source: `b${(i % MAX_NODES) + 1}`, target: `b${((i + 1) % MAX_NODES) + 1}` }));
    const r = copierGraphe(g(nodes, edges), DEST);
    expect(parseGraph(JSON.parse(JSON.stringify(r.graphe)))).not.toBeNull();
    expect(r.debranches).toHaveLength(MAX_NODES);
  });
});

describe('lot 2 : les références du graphe, et son rebranchement sur les copies', () => {
  it('referencesDuGraphe rend chaque agent, requête et modèle d’e-mail avec son bloc ; une clé vide n’en est pas une', () => {
    const source = g([
      n('g1', 'agent', { agentId: 'a-1' }),
      n('g2', 'agent', { agentId: 'a-1' }),
      n('h3', 'http', { requestId: 'r-1' }),
      n('m4', 'email', { emailAccountId: 'b-1', templateId: 't-1' }),
      n('g5', 'agent', { agentId: '  ' }),
      n('m6', 'email', { emailAccountId: 'b-1' }),
    ]);
    expect(referencesDuGraphe(source)).toEqual([
      { nodeId: 'g1', sorte: 'agent', id: 'a-1' },
      { nodeId: 'g2', sorte: 'agent', id: 'a-1' },
      { nodeId: 'h3', sorte: 'requete', id: 'r-1' },
      { nodeId: 'm4', sorte: 'modele_email', id: 't-1' },
    ]);
  });

  it('chaque ancien code de bloc mène au nouveau code du même bloc', () => {
    const source = g([n('q1', 'question', { body: 'A' }), n('w2', 'wait', { delay: 1 })]);
    const r = copierGraphe(source, DEST);
    for (const ancien of source.nodes) {
      const nouveau = r.graphe.nodes.find((x) => x.id === ancien.id)!.data.code;
      expect(r.codes.get(String(ancien.data.code))).toBe(nouveau);
    }
  });

  it('les images /m/ de la source sont listées, pas une adresse externe', () => {
    const r = copierGraphe(g([
      n('q1', 'quick_message', { imageUrl: 'https://api.messagingme.app/m/abc123.jpg' }),
      n('r2', 'rcs_message', { imageUrl: 'https://cdn.exemple.fr/image.png' }),
    ]), DEST);
    expect(r.imagesSource).toEqual(['https://api.messagingme.app/m/abc123.jpg']);
  });

  it('rebrancher pose les copies sur leurs blocs ; un bloc sans copie reste vide et listé ; la copie d’origine ne bouge pas', () => {
    const source = g([
      n('g1', 'agent', { agentId: 'a-1', agentLabel: 'Conseiller' }),
      n('h2', 'http', { requestId: 'r-1', requeteLabel: 'Créer le lead' }),
      n('m3', 'email', { emailAccountId: 'b-1', templateId: 't-1' }),
      n('g4', 'agent', { agentId: 'a-2' }),
    ]);
    const copie = copierGraphe(source, DEST);
    const avant = JSON.stringify(copie);
    const r = rebrancher(copie, referencesDuGraphe(source), {
      agents: new Map([['a-1', { id: 'a-copie', nom: 'Conseiller (copie)' }]]),
      requetes: new Map([['r-1', { id: 'r-copie', nom: 'Créer le lead' }]]),
      modelesEmail: new Map([['t-1', 't-copie']]),
    });
    expect(bloc(r.graphe, 'g1').data).toMatchObject({ agentId: 'a-copie', agentLabel: 'Conseiller (copie)' });
    expect(bloc(r.graphe, 'h2').data).toMatchObject({ requestId: 'r-copie', requeteLabel: 'Créer le lead' });
    expect(bloc(r.graphe, 'm3').data).toMatchObject({ templateId: 't-copie', emailAccountId: '' });
    expect(bloc(r.graphe, 'g4').data).toMatchObject({ agentId: '' });
    // L'agent et la requête rebranchés sortent des débranchés ; l'e-mail reste (sa boîte d'envoi), l'agent sans copie aussi.
    expect(r.debranches.map((d) => d.nodeId)).toEqual(['m3', 'g4']);
    expect(JSON.stringify(copie)).toBe(avant);
  });
});
