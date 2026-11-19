import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import type { ScenariosDep, WorkflowRouteDeps } from '../src/http/workflows';
import type { WorkflowResumeRow, WorkflowRow } from '../src/workflow/store.pg';
import { WorkflowUtiliseParLienChaine } from '../src/workflow/store.pg';
import { aucunePubliciteUtilise } from './pubs-fixtures';
import { modelesDeBlocInertes, scenariosDepInerte, scenariosInertes } from './routes-inertes';

const SECRET = 'test-secret';
// Un identifiant qui a la FORME d'un uuid : les routes refusent desormais en 404 ce qui n'en est pas un,
// parce qu'un id mal forme partait tel quel dans un `where id = $1` sur une colonne uuid et faisait lever
// Postgres (22P02), donc un 500 dont Cloudflare remplace le corps. Une adresse tapee de travers rend 404.
const W1 = '11111111-1111-4111-8111-111111111111';
let adminTok = '';
let agentTok = '';
let otherTok = '';
beforeAll(async () => {
  adminTok = await signSession({ userId: 'u1', tenantId: 't1', role: 'admin' }, SECRET);
  agentTok = await signSession({ userId: 'u2', tenantId: 't1', role: 'agent' }, SECRET);
  otherTok = await signSession({ userId: 'u3', tenantId: 't2', role: 'admin' }, SECRET);
});
const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
const h = (t: string) => ({ headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` } });

const sampleRow = (over: Partial<WorkflowRow> = {}): WorkflowRow => ({
  id: W1, tenantId: 't1', name: 'Onboarding', rayon: 'general',
  graph: { nodes: [{ id: 'n1', type: 'template', position: { x: 0, y: 0 }, data: {} }], edges: [] },
  createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z', ...over,
});

/** Le résumé que la liste sert (requis depuis le lot 3 de l'audit ponytail) : la ligne de `sampleRow`, sans graphe. */
const resumeW1: WorkflowResumeRow = {
  id: W1, tenantId: 't1', name: 'Onboarding', code: null,
  createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z', publishedAt: null,
  nodeCount: 1, hasDraft: false, campaignEligible: true, canalOuverture: 'whatsapp',
};

function app(over: Partial<Omit<WorkflowRouteDeps, 'scenarios'>> & { scenarios?: Partial<ScenariosDep> } = {}) {
  const cap = {
    created: [] as Array<{ name: string; graph: unknown }>, updated: [] as Array<{ id: string; patch: unknown }>,
    deleted: [] as string[], declared: [] as string[][], publies: [] as string[],
    journal: [] as Array<{ action: string; userId: string | null; target: string }>,
  };
  const { scenarios, ...reste } = over;
  const deps: WorkflowRouteDeps = {
    ...scenariosInertes,
    scenarios: {
      ...scenariosDepInerte,
      insert: async (_t, name, graph) => { cap.created.push({ name, graph }); return { id: 'wNew' }; },
      list: async () => [sampleRow()],
      listResume: async () => [resumeW1],
      getById: async (id) => (id === W1 ? sampleRow() : null),
      update: async (id, _t, patch) => { cap.updated.push({ id, patch }); return { trouve: id === W1, brouillon: true }; },
      publish: async (id) => { cap.publies.push(id); return id === W1 ? sampleRow({ publishedAt: '2026-09-01T10:00:00.000Z' }) : null; },
      remove: async (id) => { cap.deleted.push(id); return id === W1; },
      ...scenarios,
    },
    tenantCode: async () => 'k7m2p3',
    publicites: { publicitesQuiUtilisent: aucunePubliciteUtilise },
    declareTags: async (_t, tags) => { cap.declared.push(tags); },
    audit: async (_t, actor, action, target) => { cap.journal.push({ action, userId: actor.userId, target: target.id }); },
    ...reste,
  };
  return { server: buildServer({ queue: new FakeQueue(), auth: { users: noUsers, secret: SECRET }, workflows: deps }), cap };
}

const validGraph = {
  nodes: [{ id: 'n1', type: 'tag', position: { x: 0, y: 0 }, data: { tag: 'vip' } }, { id: 'n2', type: 'template', position: { x: 200, y: 0 }, data: { templateName: 'promo' } }],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
};

describe('routes workflows', () => {
  it('POST -> 201, graphe sanitisé passé au store', async () => {
    const { server, cap } = app();
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/workflows', ...h(adminTok), payload: { name: 'Onb', graph: validGraph } });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ id: string }>().id).toBe('wNew');
    expect(cap.created[0]!.name).toBe('Onb');
    await server.close();
  });

  it('POST sans graph -> 201 (démarre vide)', async () => {
    const { server, cap } = app();
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/workflows', ...h(adminTok), payload: { name: 'Vide' } });
    expect(res.statusCode).toBe(201);
    expect(cap.created[0]!.graph).toEqual({ nodes: [], edges: [] });
    await server.close();
  });

  it('POST name vide -> 400 ; graphe invalide -> 400', async () => {
    const { server } = app();
    const noName = await server.inject({ method: 'POST', url: '/tenants/t1/workflows', ...h(adminTok), payload: { name: '', graph: validGraph } });
    const badGraph = await server.inject({ method: 'POST', url: '/tenants/t1/workflows', ...h(adminTok), payload: { name: 'X', graph: { nodes: [{ id: 'n1', type: 'tag', position: { x: 0, y: 0 } }], edges: [{ id: 'e', source: 'n1', target: 'ABSENT' }] } } });
    expect(noName.statusCode).toBe(400);
    expect(badGraph.statusCode).toBe(400);
    await server.close();
  });

  // Lot D : le SAVE n'impose PLUS qu'un scénario commence par un template. Un scénario qui ouvre sur un
  // formulaire / message rapide est valide et enregistrable : il est réservé aux déclenchements où la fenêtre
  // de service 24 h est garantie (contact qui vient d'écrire), et c'est `POST /campaigns` qui refuse de le
  // lancer en broadcast (garde INDÉPENDANTE, verrouillée par tests/http-campaigns.test.ts).
  it('POST/PATCH : graphe qui OUVRE sur un flow ou un message rapide -> ENREGISTRÉ (plus de 400 depuis le Lot D)', async () => {
    const { server, cap } = app();
    // tag -> flow en ouverture (la chaîne synchrone compte aussi comme ouverture).
    const flowEntry = {
      nodes: [
        { id: 'n1', type: 'tag', position: { x: 0, y: 0 }, data: { tag: 'vip' } },
        { id: 'n2', type: 'flow', position: { x: 200, y: 0 }, data: { flowId: 'fl1', flowName: 'RDV' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    };
    const post = await server.inject({ method: 'POST', url: '/tenants/t1/workflows', ...h(adminTok), payload: { name: 'X', graph: flowEntry } });
    expect(post.statusCode).toBe(201);
    const qmEntry = { nodes: [{ id: 'n1', type: 'quick_message', position: { x: 0, y: 0 }, data: { body: 'Salut', quickReplies: ['Oui'] } }], edges: [] };
    const patch = await server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: qmEntry } });
    expect(patch.statusCode).toBe(200);
    // Les deux graphes sont bien PERSISTÉS (et non acceptés puis silencieusement vidés).
    expect(cap.created).toHaveLength(1);
    const saved = cap.created[0]!.graph as { nodes: Array<{ type: string }> };
    expect(saved.nodes.map((nd) => nd.type)).toEqual(['tag', 'flow']);
    expect(cap.updated).toHaveLength(1);
    await server.close();
  });

  it('POST : flow NON configuré (sans flowId) en ouverture -> 201 (le graphe reste enregistrable pendant la construction)', async () => {
    const { server } = app();
    const wip = { nodes: [{ id: 'n1', type: 'flow', position: { x: 0, y: 0 }, data: {} }], edges: [] };
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/workflows', ...h(adminTok), payload: { name: 'WIP', graph: wip } });
    expect(res.statusCode).toBe(201);
    await server.close();
  });

  it('GET liste + GET un + 404', async () => {
    const { server } = app();
    const list = await server.inject({ method: 'GET', url: '/tenants/t1/workflows', ...h(adminTok) });
    expect(list.json<{ workflows: unknown[] }>().workflows).toHaveLength(1);
    const one = await server.inject({ method: 'GET', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok) });
    expect(one.statusCode).toBe(200);
    const miss = await server.inject({ method: 'GET', url: '/tenants/t1/workflows/nope', ...h(adminTok) });
    expect(miss.statusCode).toBe(404);
    await server.close();
  });

  it('PATCH graph -> 200 ; graphe invalide -> 400 ; rien à modifier -> 400', async () => {
    const { server, cap } = app();
    const ok = await server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: validGraph } });
    expect(ok.statusCode).toBe(200);
    expect(cap.updated[0]!.id).toBe(W1);
    const bad = await server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: { nodes: 'x', edges: [] } } });
    expect(bad.statusCode).toBe(400);
    const empty = await server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: {} });
    expect(empty.statusCode).toBe(400);
    await server.close();
  });

  it('POST : chaque node reçoit un code public nod_<client>_<ulid>, dans la réponse ET le graphe persisté', async () => {
    const { server, cap } = app();
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/workflows', ...h(adminTok), payload: { name: 'Onb', graph: validGraph } });
    expect(res.statusCode).toBe(201);
    const g = res.json<{ graph: { nodes: Array<{ data: { code?: string } }> } }>().graph;
    for (const n of g.nodes) expect(n.data.code).toMatch(/^nod_k7m2p3_[0-9A-HJKMNP-TV-Z]{26}$/);
    const stored = cap.created[0]!.graph as { nodes: Array<{ data: { code?: string } }> };
    for (const n of stored.nodes) expect(n.data.code).toMatch(/^nod_k7m2p3_/); // mint AVANT le store
    await server.close();
  });

  it('PATCH graph : mint les codes manquants, CONSERVE un code valide du tenant', async () => {
    const { server } = app();
    const withCode = {
      nodes: [
        { id: 'n1', type: 'tag', position: { x: 0, y: 0 }, data: { tag: 'vip', code: 'nod_k7m2p3_0123456789ABCDEFGHJKMNPQRS' } },
        { id: 'n2', type: 'template', position: { x: 200, y: 0 }, data: { templateName: 'promo' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    };
    const res = await server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: withCode } });
    expect(res.statusCode).toBe(200);
    const g = res.json<{ graph: { nodes: Array<{ data: { code?: string } }> } }>().graph;
    expect(g.nodes[0]!.data.code).toBe('nod_k7m2p3_0123456789ABCDEFGHJKMNPQRS'); // conservé (stabilité)
    expect(g.nodes[1]!.data.code).toMatch(/^nod_k7m2p3_[0-9A-HJKMNP-TV-Z]{26}$/); // minté
    await server.close();
  });

  it('POST déclare les tags des blocs « ajout de tag » (Contenus > Tags)', async () => {
    const { server, cap } = app();
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/workflows', ...h(adminTok), payload: { name: 'Onb', graph: validGraph } });
    expect(res.statusCode).toBe(201);
    expect(cap.declared).toEqual([['vip']]); // le node tag 'vip', pas le node template
    await server.close();
  });

  it('PATCH graph déclare aussi les tags du graphe', async () => {
    const { server, cap } = app();
    const res = await server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: validGraph } });
    expect(res.statusCode).toBe(200);
    expect(cap.declared).toEqual([['vip']]);
    await server.close();
  });

  it('déclaration best-effort : un échec de declareTags ne casse pas la sauvegarde', async () => {
    const { server } = app({ declareTags: async () => { throw new Error('boom'); } });
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/workflows', ...h(adminTok), payload: { name: 'Onb', graph: validGraph } });
    expect(res.statusCode).toBe(201);
    await server.close();
  });

  it('DELETE -> 200 ; inconnu -> 404', async () => {
    const { server } = app();
    const ok = await server.inject({ method: 'DELETE', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok) });
    expect(ok.statusCode).toBe(200);
    const miss = await server.inject({ method: 'DELETE', url: '/tenants/t1/workflows/nope', ...h(adminTok) });
    expect(miss.statusCode).toBe(404);
    await server.close();
  });

  it('🔴 DELETE d’un scénario utilisé par un lien de chaîne WhatsApp : 409 nommé, jamais un 500', async () => {
    // `channelsme_links.workflow_id` est en `on delete restrict` (migration 0114) : le store lève
    // `WorkflowUtiliseParLienChaine` (traduite depuis Postgres 23503), et sans cette route la violation
    // remonterait au gestionnaire d'erreur global, donc en 500, dont Cloudflare remplace le corps.
    const { server } = app({ scenarios: { remove: async () => { throw new WorkflowUtiliseParLienChaine(); } } });
    const res = await server.inject({ method: 'DELETE', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok) });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toContain('lien de chaîne WhatsApp');
    await server.close();
  });

  it('🔴 DELETE d’un scénario utilisé par une PUBLICITÉ vivante : 409 nommé, et la suppression n’a PAS lieu', async () => {
    // 🔴 LE REFUS SE POSE AVANT LA SUPPRESSION, sans quoi il ne verrait rien à refuser :
    // `publicites.workflow_id` est en `on delete set null`, donc un `delete` RÉUSSIT et laisse la
    // publicité avec une destination `scenario` et plus aucun scénario. Ses prospects, qui ont coûté un
    // clic, n’arriveraient alors nulle part, sans la moindre erreur.
    let supprime = false;
    const { server } = app({
      publicites: { publicitesQuiUtilisent: async () => ['Rentrée 2026', 'Black Friday'] },
      scenarios: { remove: async () => { supprime = true; return true; } },
    });
    const res = await server.inject({ method: 'DELETE', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok) });
    expect(res.statusCode).toBe(409);
    const corps = res.json<{ error: string; code: string }>();
    expect(corps.code).toBe('utilise_par_publicite');
    // Le message NOMME les publicités : « ce scénario est utilisé » sans dire par quoi enverrait le
    // client chercher dans une liste entière.
    expect(corps.error).toContain('Rentrée 2026');
    // 🔴 LE SENS QUI COMPTE AUTANT : la suppression n’a pas eu lieu.
    expect(supprime).toBe(false);
    await server.close();
  });

  it('🔴 DELETE d’un scénario qu’une automation, un widget ou le répondeur utilise : 409 qui les nomme, rien de supprimé', async () => {
    // `automations.workflow_id` est en cascade et `widgets.workflow_id` en `set null` : sans ce refus, la suppression
    // emportait l'automation en silence, ou laissait la bulle sans scénario. La même garde que l'API (`utilisationsDuScenario`).
    let supprime = false;
    const { server } = app({
      scenarios: {
        utilisationsDuScenario: async () => ['l’automation « Bienvenue »', 'le widget « Bulle »'],
        remove: async () => { supprime = true; return true; },
      },
    });
    const res = await server.inject({ method: 'DELETE', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok) });
    expect(res.statusCode).toBe(409);
    const corps = res.json<{ error: string; code: string }>();
    expect(corps.code).toBe('scenario_in_use');
    expect(corps.error).toContain('Bienvenue');
    expect(corps.error).toContain('Bulle');
    expect(supprime).toBe(false);
    await server.close();
  });

  it('aucune publicité ne l’utilise : la suppression passe, comme avant ce lot', async () => {
    let supprime = false;
    const { server } = app({ scenarios: { remove: async () => { supprime = true; return true; } } });
    const res = await server.inject({ method: 'DELETE', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok) });
    expect(res.statusCode).toBe(200);
    expect(supprime).toBe(true);
    await server.close();
  });

  it('agent -> 403 sur écriture ; tenant croisé -> 403', async () => {
    const { server } = app();
    const agent = await server.inject({ method: 'POST', url: '/tenants/t1/workflows', ...h(agentTok), payload: { name: 'X' } });
    expect(agent.statusCode).toBe(403);
    const cross = await server.inject({ method: 'GET', url: '/tenants/t1/workflows', ...h(otherTok) });
    expect(cross.statusCode).toBe(403);
    await server.close();
  });

  it('GET /nodes : aplati les nodes de tous les scénarios, résumé field depuis fieldLabel', async () => {
    // Forme RÉELLE persistée par le builder (fieldKey/fieldLabel/value pour un bloc « ajout de champ »).
    const nodesRow = sampleRow({
      id: 'wA', name: 'Parcours',
      graph: { nodes: [
        { id: 'n1', type: 'template', position: { x: 0, y: 0 }, data: { code: 'nod_k7m2p3_0123456789ABCDEFGHJKMNPQRS', templateName: 'promo' } },
        { id: 'n2', type: 'field', position: { x: 200, y: 0 }, data: { fieldKey: 'ville', fieldLabel: 'Ville', value: 'Paris' } },
        { id: 'n3', type: 'tag', position: { x: 400, y: 0 }, data: { tag: 'vip' } },
      ], edges: [] },
    });
    const { server } = app({ scenarios: { list: async () => [nodesRow] } });
    const all = await server.inject({ method: 'GET', url: '/tenants/t1/nodes', ...h(adminTok) });
    expect(all.statusCode).toBe(200);
    const nodes = all.json<{ nodes: Array<{ type: string; summary: string; code: string | null; workflowId: string }> }>().nodes;
    expect(nodes).toHaveLength(3);
    const field = nodes.find((n) => n.type === 'field')!;
    expect(field.summary).toBe('Ville = Paris'); // <- aurait échoué avec l'ancien data.key
    expect(field.code).toBeNull(); // node jamais re-sauvegardé -> pas de code
    expect(nodes.find((n) => n.type === 'template')!.code).toBe('nod_k7m2p3_0123456789ABCDEFGHJKMNPQRS');
    expect(nodes.every((n) => n.workflowId === 'wA')).toBe(true);
    // Filtre par type
    const tags = await server.inject({ method: 'GET', url: '/tenants/t1/nodes?type=tag', ...h(adminTok) });
    expect(tags.json<{ nodes: unknown[] }>().nodes).toHaveLength(1);
    // Tenant croisé -> 403
    const cross = await server.inject({ method: 'GET', url: '/tenants/t1/nodes', ...h(otherTok) });
    expect(cross.statusCode).toBe(403);
    await server.close();
  });
});

describe('POST /tenants/:t/workflows/:id/duplicate', () => {
  const SRC_CODE = 'nod_k7m2p3_0123456789ABCDEFGHJKMNPQRS'; // code valide du tenant t1 (k7m2p3)
  const source = (): WorkflowRow => sampleRow({
    name: 'Promo',
    graph: {
      nodes: [{ id: 'n1', type: 'template', position: { x: 5, y: 9 }, data: { code: SRC_CODE, templateName: 'x' } }],
      edges: [],
    },
  });

  it('201, nom « (copie) », graphe cloné, codes de node RE-MINTÉS (différents de la source)', async () => {
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W1 ? source() : null), list: async () => [source()] } });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/duplicate`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ name: string }>().name).toBe('Promo (copie)');
    expect(cap.created[0]!.name).toBe('Promo (copie)');
    const g = cap.created[0]!.graph as { nodes: Array<{ id: string; position: unknown; data: { code?: string } }> };
    expect(g.nodes[0]!.id).toBe('n1');                 // structure clonée
    expect(g.nodes[0]!.position).toEqual({ x: 5, y: 9 });
    expect(g.nodes[0]!.data.code).toMatch(/^nod_k7m2p3_[0-9A-HJKMNP-TV-Z]{26}$/); // code frais valide
    expect(g.nodes[0]!.data.code).not.toBe(SRC_CODE);  // PAS celui de la source
    await server.close();
  });

  it('🔴 un « Aller à » interne vise le bloc de la COPIE, un « Aller à » vers un autre scénario ne bouge pas (RC5)', async () => {
    const AILLEURS = 'nod_k7m2p3_01J00000000000000000000099';
    const avecSauts = (): WorkflowRow => sampleRow({
      name: 'Promo',
      graph: {
        nodes: [
          { id: 'n1', type: 'template', position: { x: 0, y: 0 }, data: { code: SRC_CODE, templateName: 'x' } },
          { id: 'j1', type: 'aller_a', position: { x: 0, y: 0 }, data: { cible: SRC_CODE } },
          { id: 'j2', type: 'aller_a', position: { x: 0, y: 0 }, data: { cible: AILLEURS } },
          { id: 'j3', type: 'aller_a', position: { x: 0, y: 0 }, data: { cible: '' } },
        ],
        edges: [],
      },
    });
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W1 ? avecSauts() : null), list: async () => [avecSauts()] } });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/duplicate`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(201);
    const g = cap.created[0]!.graph as { nodes: Array<{ id: string; data: { code?: string; cible?: string } }> };
    const par = (id: string) => g.nodes.find((x) => x.id === id)!;
    expect(par('n1').data.code).not.toBe(SRC_CODE);
    expect(par('j1').data.cible).toBe(par('n1').data.code);
    expect(par('j2').data.cible).toBe(AILLEURS);
    expect(par('j3').data.cible).toBe('');
    await server.close();
  });

  it('incrémente « (copie 2) » si le nom est déjà pris', async () => {
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W1 ? source() : null), list: async () => [source(), sampleRow({ name: 'Promo (copie)' })] } });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/duplicate`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(201);
    expect(cap.created[0]!.name).toBe('Promo (copie 2)');
    await server.close();
  });

  it('id inconnu -> 404, aucune création', async () => {
    const { server, cap } = app({ scenarios: { getById: async () => null } });
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/workflows/ghost/duplicate', ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(404);
    expect(cap.created).toHaveLength(0);
    await server.close();
  });

  it('🔴 copie le BROUILLON quand il y en a un (on duplique ce qu’on voit, pas ce qui tourne)', async () => {
    const avecBrouillon = (): WorkflowRow => sampleRow({
      name: 'Promo',
      graph: { nodes: [{ id: 'nEnLigne', type: 'template', position: { x: 0, y: 0 }, data: { templateName: 'en-ligne' } }], edges: [] },
      draftGraph: { nodes: [{ id: 'nBrouillon', type: 'template', position: { x: 0, y: 0 }, data: { templateName: 'brouillon' } }], edges: [] },
    });
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W1 ? avecBrouillon() : null), list: async () => [avecBrouillon()] } });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/duplicate`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(201);
    const g = cap.created[0]!.graph as { nodes: Array<{ id: string }> };
    expect(g.nodes[0]!.id).toBe('nBrouillon');
    await server.close();
  });

  it('sans brouillon, copie la version en ligne (l’autre sens de la même règle)', async () => {
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W1 ? source() : null), list: async () => [source()] } });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/duplicate`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(201);
    const g = cap.created[0]!.graph as { nodes: Array<{ id: string }> };
    expect(g.nodes[0]!.id).toBe('n1');
    await server.close();
  });

  it('agent -> 403 (admin-only) ; tenant != token -> 403', async () => {
    const { server } = app({ scenarios: { getById: async () => source() } });
    const agent = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/duplicate`, ...h(agentTok), payload: {} });
    const cross = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/duplicate`, ...h(otherTok), payload: {} });
    expect(agent.statusCode).toBe(403);
    expect(cross.statusCode).toBe(403);
    await server.close();
  });
});

/**
 * MISE EN LIGNE (lot 7). La route est le seul chemin qui change quelque chose pour les contacts : tout le
 * reste de l'éditeur n'écrit qu'un brouillon.
 */
describe('POST /tenants/:t/workflows/:id/publish', () => {
  it('200 : publie, rend le graphe en ligne et la date, et journalise QUI a publié', async () => {
    const { server, cap } = app();
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ publishedAt: string }>().publishedAt).toBe('2026-09-01T10:00:00.000Z');
    expect(cap.publies).toEqual([W1]);
    expect(cap.journal).toEqual([{ action: 'workflow.published', userId: 'u1', target: W1 }]);
    await server.close();
  });

  it('scénario inconnu -> 404, et un id qui n’est pas un uuid -> 404 SANS toucher au store', async () => {
    const { server, cap } = app();
    const inconnu = await server.inject({ method: 'POST', url: '/tenants/t1/workflows/22222222-2222-4222-8222-222222222222/publish', ...h(adminTok), payload: {} });
    expect(inconnu.statusCode).toBe(404);
    const malForme = await server.inject({ method: 'POST', url: '/tenants/t1/workflows/pas-un-uuid/publish', ...h(adminTok), payload: {} });
    expect(malForme.statusCode).toBe(404);
    // Le second n'a JAMAIS atteint la base : un id mal formé y ferait lever Postgres (22P02), donc un 500.
    expect(cap.publies).toEqual(['22222222-2222-4222-8222-222222222222']);
    await server.close();
  });

  it('🔴 réservée aux admins, et jamais d’un espace à l’autre', async () => {
    const { server, cap } = app();
    const agent = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(agentTok), payload: {} });
    const cross = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(otherTok), payload: {} });
    expect(agent.statusCode).toBe(403);
    expect(cross.statusCode).toBe(403);
    expect(cap.publies).toEqual([]);
    await server.close();
  });

  /**
   * 🔴 LES BLOCS « ALLER À » SE VÉRIFIENT AVANT LA MISE EN LIGNE (RC5). La règle elle-même est tenue par
   * `tests/workflow-aller-a.test.ts` (`refusDePublication`) ; ici, que la route la pose AVANT `publish`, sur le
   * BROUILLON, avec les scénarios de SON espace, et qu'un brouillon sans saut ne paie aucune lecture de plus.
   */
  it('🔴 un « Aller à » vers un bloc inexistant : 422, rien n’est publié, et la liste lue est celle de l’espace', async () => {
    const lus: string[] = [];
    const brouillon = { nodes: [{ id: 'j', type: 'aller_a' as const, position: { x: 0, y: 0 }, data: { name: 'Vers le menu', cible: 'nod_k7m2p3_01J00000000000000000000099' } }], edges: [] };
    const { server, cap } = app({ scenarios: {
      getById: async (id) => (id === W1 ? sampleRow({ draftGraph: brouillon }) : null),
      list: async (t) => { lus.push(t); return [sampleRow()]; },
    } });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('aller_a_invalide');
    expect(res.json<{ error: string }>().error).toContain('« Vers le menu » vise un bloc qui n’existe pas');
    expect(cap.publies).toEqual([]);
    expect(lus).toEqual(['t1']);
    await server.close();
  });

  it('un « Aller à » vers un bloc publié d’un autre scénario de l’espace : publié', async () => {
    const cible = 'nod_k7m2p3_01J00000000000000000000042';
    const brouillon = { nodes: [{ id: 'j', type: 'aller_a' as const, position: { x: 0, y: 0 }, data: { cible } }], edges: [] };
    const autre = sampleRow({ id: '33333333-3333-4333-8333-333333333333', name: 'Menu', graph: { nodes: [{ id: 'm', type: 'tag', position: { x: 0, y: 0 }, data: { tag: 'x', code: cible } }], edges: [] } });
    const { server, cap } = app({ scenarios: {
      getById: async (id) => (id === W1 ? sampleRow({ draftGraph: brouillon }) : null),
      list: async () => [sampleRow(), autre],
    } });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(cap.publies).toEqual([W1]);
    await server.close();
  });

  it('un brouillon sans « Aller à » ne lit pas les autres scénarios', async () => {
    const lus: string[] = [];
    const { server, cap } = app({ scenarios: {
      getById: async (id) => (id === W1 ? sampleRow({ draftGraph: validGraph as WorkflowRow['graph'] }) : null),
      list: async (t) => { lus.push(t); return []; },
    } });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(cap.publies).toEqual([W1]);
    expect(lus).toEqual([]);
    await server.close();
  });

  /**
   * 🔴 UN BLOC QUESTION QUI ATTEND UN FICHIER DOIT RELIER « FICHIER REÇU » (décision de Julien du 2026-11-02). La règle
   * est tenue par `tests/workflow-question-piece.test.ts` (`refusFichierSansSuite`) ; ici, que la route la pose AVANT
   * `publish`, sur le BROUILLON : sans elle, une pièce d'identité n'aurait aucune suite.
   */
  it('🔴 une Question qui attend un fichier sans arête « Fichier reçu » : 422, rien n’est publié', async () => {
    const brouillon = {
      nodes: [
        { id: 'q', type: 'question' as const, position: { x: 0, y: 0 }, data: { body: 'Votre pièce d’identité ?', attendreFichier: true } },
        { id: 'i', type: 'inbox' as const, position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [{ id: 'e', source: 'q', target: 'i' }],
    };
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W1 ? sampleRow({ draftGraph: brouillon }) : null) } });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('fichier_sans_suite');
    expect(res.json<{ error: string }>().error).toContain('Publication refusée : le bloc Question « Votre pièce d’identité ? » attend un fichier');
    expect(cap.publies).toEqual([]);
    await server.close();
  });

  it('la même Question avec son arête « Fichier reçu » : publiée', async () => {
    const brouillon = {
      nodes: [
        { id: 'q', type: 'question' as const, position: { x: 0, y: 0 }, data: { body: 'Votre pièce d’identité ?', attendreFichier: true } },
        { id: 'i', type: 'inbox' as const, position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [{ id: 'e', source: 'q', target: 'i', sourceHandle: 'fichier' }],
    };
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W1 ? sampleRow({ draftGraph: brouillon }) : null) } });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(cap.publies).toEqual([W1]);
    await server.close();
  });

  /**
   * 🔴 « PUIS, SANS ATTENDRE » NE MÈNE QU'À DES BLOCS QUI N'ATTENDENT RIEN (décision de Julien du 2026-11-10). La règle est
   * tenue par `tests/workflow-puis-sans-attendre.test.ts` (`refusSuiteQuiAttend`) ; ici, que la route la pose AVANT
   * `publish`, sur le BROUILLON : sans elle, le moteur s'arrêterait en silence devant la Question.
   */
  it('🔴 « Puis, sans attendre » qui mène à une Question : 422, rien n’est publié', async () => {
    const brouillon = {
      nodes: [
        { id: 'm', type: 'quick_message' as const, position: { x: 0, y: 0 }, data: { body: 'Merci', quickReplies: ['Main menu'] } },
        { id: 'q', type: 'question' as const, position: { x: 0, y: 0 }, data: { body: 'Votre âge ?' } },
      ],
      edges: [{ id: 'e', source: 'm', target: 'q', sourceHandle: 'ensuite' }],
    };
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W1 ? sampleRow({ draftGraph: brouillon }) : null) } });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('suite_qui_attend');
    expect(res.json<{ error: string }>().error).toContain('Publication refusée : la sortie « Puis, sans attendre » du message « Merci » mène à un bloc Question, qui attend');
    expect(cap.publies).toEqual([]);
    await server.close();
  });

  it('la même sortie vers un message sans bouton : publiée', async () => {
    const brouillon = {
      nodes: [
        { id: 'm', type: 'quick_message' as const, position: { x: 0, y: 0 }, data: { body: 'Merci', quickReplies: ['Main menu'] } },
        { id: 't', type: 'quick_message' as const, position: { x: 0, y: 0 }, data: { body: 'Bonne journée' } },
      ],
      edges: [{ id: 'e', source: 'm', target: 't', sourceHandle: 'ensuite' }],
    };
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W1 ? sampleRow({ draftGraph: brouillon }) : null) } });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(cap.publies).toEqual([W1]);
    await server.close();
  });

  it('le PATCH dit s’il reste un brouillon à publier : c’est lui qui allume le bouton', async () => {
    const { server } = app();
    const avec = await server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: validGraph } });
    expect(avec.json<{ brouillon: boolean }>().brouillon).toBe(true);
    const { server: s2 } = app({ scenarios: { update: async () => ({ trouve: true, brouillon: false }) } });
    const sans = await s2.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: validGraph } });
    expect(sans.json<{ brouillon: boolean }>().brouillon).toBe(false);
    await server.close();
    await s2.close();
  });
});


describe('GET /workflows : le RÉSUMÉ, jamais les graphes', () => {
  it('🔴 la liste ne transporte AUCUN graphe quand le résumé est câblé', async () => {
    // 🔴 Constat du contre-audit du 2026-09-01 : la liste renvoyait DEUX graphes complets par ligne (le
    // publié et le brouillon) pour des écrans qui n'affichent qu'un nom. Avec des centaines de scénarios,
    // chaque écran paie le transfert et l'analyse de tous les JSON. Ce que les écrans en tiraient devient
    // trois champs, et le graphe complet reste sur `GET /workflows/:id`.
    const { server } = app({
      scenarios: {
        listResume: async () => [{
          id: W1, tenantId: 't1', name: 'Onboarding', rayon: 'general', code: 'scn_k7m2p3_x',
          createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', publishedAt: null,
          nodeCount: 4, hasDraft: true, campaignEligible: true, canalOuverture: 'whatsapp' as const,
        }],
      },
    });
    const res = await server.inject({ method: 'GET', url: '/tenants/t1/workflows', ...h(adminTok) });
    expect(res.statusCode).toBe(200);
    const [w] = res.json<{ workflows: Array<Record<string, unknown>> }>().workflows;
    expect(w).toMatchObject({ nodeCount: 4, hasDraft: true, campaignEligible: true });
    // La preuve qui compte : aucun graphe dans la charge utile.
    expect(w).not.toHaveProperty('graph');
    expect(w).not.toHaveProperty('draftGraph');
    await server.close();
  });
});

describe('🔴 GET /workflows/:id rend les départs du scénario (menu « Scénario », lot 2 : prévenir, jamais refuser)', () => {
  it('un scénario du Builder lancé par une automation de date : un départ ouvert à l’entrée et un départ fermé à son bloc', async () => {
    const { server } = app({ scenarios: { lanceursDuScenario: async () => [{ type: 'automation', nom: 'Rappel', declencheur: 'avant_date', blocDeDepart: 'n1' }] } });
    const res = await server.inject({ method: 'GET', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok) });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ departs: unknown[] }>().departs).toEqual([
      { noeudId: null, fenetre: 'ouverte', raison: '' },
      { noeudId: 'n1', fenetre: 'fermee', raison: 'l’automation « Rappel »' },
    ]);
    await server.close();
  });

  it('sans lanceur fermé : le seul départ ouvert, et la ligne du scénario inchangée', async () => {
    const { server } = app();
    const res = await server.inject({ method: 'GET', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok) });
    const corps = res.json<{ workflow: { id: string }; departs: unknown[] }>();
    expect(corps.workflow.id).toBe(W1);
    expect(corps.departs).toEqual([{ noeudId: null, fenetre: 'ouverte', raison: '' }]);
    await server.close();
  });
});

/**
 * ─── Écrire un template depuis un bloc, et la publication programmée (menu « Scénario », lot 3, décision 18) ───
 * Les décisions sont tenues par `tests/workflow-modeles-de-bloc.test.ts` et `tests/workflow-publication-programmee.test.ts` ;
 * ici, que les routes les posent au bon endroit : avant `publish`, sur le BROUILLON, avec l'auteur de la session.
 */
describe('🔴 templates de bloc et publication programmée (menu « Scénario », lot 3)', () => {
  const brouillonA = { nodes: [{ id: 'n1', type: 'template' as const, position: { x: 0, y: 0 }, data: { templateName: 'relance_a', language: 'fr' } }], edges: [] };
  const ligneA = (etat: 'en_validation' | 'approuve' | 'refuse', raison: string | null = null) =>
    ({ workflowId: W1, modele: 'relance_a', langue: 'fr', etat, raison, creeLe: '2026-11-18T10:00:00.000Z', trancheLe: null });

  /** Un montage dont la publication voit une ligne de template de bloc, et dont Meta rend `statut`. */
  function appAvec(o: { etat: 'en_validation' | 'approuve' | 'refuse'; statutMeta?: string; raison?: string; campagnes?: string[] }) {
    const programmes: Array<{ id: string; par: string | null; graphe: unknown }> = [];
    const lectures: string[] = [];
    const r = app({
      scenarios: {
        getById: async (id) => (id === W1 ? sampleRow({ draftGraph: brouillonA }) : null),
        programmer: async (id, _t, par, graphe) => { programmes.push({ id, par, graphe }); return { le: '2026-11-18T15:00:00.000Z' }; },
      },
      modelesDeBloc: {
        ...modelesDeBlocInertes,
        publication: {
          ...modelesDeBlocInertes.publication,
          lignes: { ...modelesDeBlocInertes.publication.lignes, desModeles: async () => [ligneA(o.etat, o.raison ?? null)] },
          scenarios: {
            ...modelesDeBlocInertes.publication.scenarios,
            lanceursDuScenario: async () => (o.campagnes ?? []).map((nom) => ({ type: 'campagne' as const, nom, declencheur: null, blocDeDepart: null })),
          },
          statutModele: async (_t, modele) => { lectures.push(modele); return o.statutMeta ? { statut: o.statutMeta, raison: o.raison ?? null } : null; },
        },
      },
    });
    return { ...r, programmes, lectures };
  }

  it('🔴 un template de bloc en validation : 202, la mise en ligne se PROGRAMME sur le brouillon jugé, par l’auteur, sans publier', async () => {
    const { server, cap, programmes, lectures } = appAvec({ etat: 'en_validation', statutMeta: 'PENDING' });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ id: W1, programmee: { le: '2026-11-18T15:00:00.000Z', attend: [{ modele: 'relance_a', langue: 'fr' }] } });
    expect(programmes).toEqual([{ id: W1, par: 'u1', graphe: brouillonA }]);
    expect(lectures).toEqual(['relance_a']);
    expect(cap.publies).toEqual([]);
    expect(cap.journal).toEqual([{ action: 'workflow.publication_programmee', userId: 'u1', target: W1 }]);
    await server.close();
  });

  it('🔴 un template de bloc refusé par Meta : 422 avec sa raison, rien n’est publié ni programmé', async () => {
    const { server, cap, programmes } = appAvec({ etat: 'refuse', raison: 'INVALID_FORMAT' });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string; error: string }>()).toMatchObject({ code: 'modele_refuse' });
    expect(res.json<{ error: string }>().error).toContain('INVALID_FORMAT');
    expect(cap.publies).toEqual([]);
    expect(programmes).toEqual([]);
    await server.close();
  });

  it('🔴 en validation sous une campagne active : 422 qui nomme la campagne, rien n’est programmé', async () => {
    const { server, cap, programmes } = appAvec({ etat: 'en_validation', statutMeta: 'PENDING', campagnes: ['Soldes'] });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('campagne_active');
    expect(res.json<{ error: string }>().error).toContain('Soldes');
    expect(cap.publies).toEqual([]);
    expect(programmes).toEqual([]);
    await server.close();
  });

  it('🔴 « Publier » passe au magasin le brouillon JUGÉ, pas celui du moment (relecture de 3a)', async () => {
    const recus: unknown[] = [];
    const { server } = app({
      scenarios: {
        getById: async (id) => (id === W1 ? sampleRow({ draftGraph: brouillonA }) : null),
        publish: async (_id, _t, graphe) => { recus.push(graphe); return sampleRow({ publishedAt: '2026-11-18T15:00:00.000Z' }); },
      },
    });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(recus).toEqual([brouillonA]);
    await server.close();
  });

  it('approuvé (relu chez Meta) : publication immédiate, comme avant', async () => {
    const { server, cap, programmes } = appAvec({ etat: 'en_validation', statutMeta: 'APPROVED' });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(cap.publies).toEqual([W1]);
    expect(programmes).toEqual([]);
    await server.close();
  });

  it('🔴 un brouillon sans template de bloc se publie SANS aucune lecture de Meta', async () => {
    const lectures: string[] = [];
    const { server, cap } = app({
      scenarios: { getById: async (id) => (id === W1 ? sampleRow({ draftGraph: brouillonA }) : null) },
      modelesDeBloc: { ...modelesDeBlocInertes, publication: { ...modelesDeBlocInertes.publication, statutModele: async (_t, m) => { lectures.push(m); return null; } } },
    });
    const res = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(cap.publies).toEqual([W1]);
    expect(lectures).toEqual([]);
    await server.close();
  });

  it('POST …/blocs/:nodeId/modele : 201, le template est créé par l’auteur de la session, et journalisé', async () => {
    const creations: string[] = [];
    const inseres: Array<{ tenant: string; workflowId: string; par: string | null }> = [];
    const { server, cap } = app({
      modelesDeBloc: {
        ...modelesDeBlocInertes,
        creation: {
          ...modelesDeBlocInertes.creation,
          scenarios: { getById: async (id, t) => (id === W1 && t === 't1' ? sampleRow({ draftGraph: brouillonA }) : null) },
          gestion: {
            ...modelesDeBlocInertes.creation.gestion,
            repo: { ...modelesDeBlocInertes.creation.gestion.repo, getTenantWabaId: async () => 'waba1' },
            meta: {
              templateClientForTenant: async () => ({
                create: async (_w: string, input: { name: string }) => { creations.push(input.name); return { id: 'tid', status: 'PENDING', category: 'UTILITY' }; },
              }) as never,
            },
          },
          lignes: { inserer: async (tenant, l) => { inseres.push({ tenant, workflowId: l.workflowId, par: l.par }); } },
          maintenant: () => new Date('2026-11-18T15:00:00.000Z'),
        },
      },
    });
    const res = await server.inject({
      method: 'POST', url: `/tenants/t1/workflows/${W1}/blocs/n1/modele`, ...h(adminTok),
      payload: { category: 'UTILITY', language: 'fr', body: 'Votre panier vous attend', name: 'pirate' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ modele: string; etat: string }>()).toMatchObject({ etat: 'en_validation', langue: 'fr', categorie: 'UTILITY' });
    expect(res.json<{ modele: string }>().modele).toMatch(/^onboarding_[a-z0-9]+$/);
    expect(creations).toEqual([res.json<{ modele: string }>().modele]);
    expect(inseres).toEqual([{ tenant: 't1', workflowId: W1, par: 'u1' }]);
    expect(cap.journal).toEqual([{ action: 'workflow.modele_soumis', userId: 'u1', target: W1 }]);
    await server.close();
  });

  it('POST …/blocs/:nodeId/modele : identifiant mal formé 404 sans rien lire ; réservé aux admins', async () => {
    const lus: string[] = [];
    const { server } = app({
      modelesDeBloc: {
        ...modelesDeBlocInertes,
        creation: { ...modelesDeBlocInertes.creation, scenarios: { getById: async (id) => { lus.push(id); return null; } } },
      },
    });
    const malForme = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/blocs/a.b/modele`, ...h(adminTok), payload: {} });
    expect(malForme.statusCode).toBe(404);
    const pasUuid = await server.inject({ method: 'POST', url: '/tenants/t1/workflows/pas-un-uuid/blocs/n1/modele', ...h(adminTok), payload: {} });
    expect(pasUuid.statusCode).toBe(404);
    const agent = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/blocs/n1/modele`, ...h(agentTok), payload: {} });
    expect(agent.statusCode).toBe(403);
    expect(lus).toEqual([]);
    // Un identifiant bien formé atteint la lecture du scénario (inconnu ici : 404, sans jamais atteindre Meta).
    const inconnu = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/blocs/n1/modele`, ...h(adminTok), payload: {} });
    expect(inconnu.statusCode).toBe(404);
    expect(lus).toEqual([W1]);
    await server.close();
  });

  it('🔴 GET …/modeles : l’état des templates que NOMME le brouillon (même créés depuis un autre scénario), et la version programmée', async () => {
    const demandes: unknown[] = [];
    const { server } = app({
      scenarios: {
        getById: async (id) => (id === W1 ? sampleRow({ draftGraph: brouillonA }) : null),
        publicationProgrammee: async () => ({ graphe: brouillonA, le: '2026-11-18T15:00:00.000Z', par: 'u1' }),
      },
      modelesDeBloc: {
        ...modelesDeBlocInertes,
        publication: {
          ...modelesDeBlocInertes.publication,
          lignes: { ...modelesDeBlocInertes.publication.lignes, desModeles: async (_t, paires) => { demandes.push(paires); return [ligneA('en_validation')]; } },
        },
      },
    });
    const res = await server.inject({ method: 'GET', url: `/tenants/t1/workflows/${W1}/modeles`, ...h(adminTok) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      modeles: [{ modele: 'relance_a', langue: 'fr', etat: 'en_validation', raison: null, creeLe: '2026-11-18T10:00:00.000Z' }],
      programmee: { le: '2026-11-18T15:00:00.000Z', attend: [{ modele: 'relance_a', langue: 'fr', etat: 'en_validation', raison: null }], campagnes: [] },
    });
    const inconnu = await server.inject({ method: 'GET', url: '/tenants/t1/workflows/22222222-2222-4222-8222-222222222222/modeles', ...h(adminTok) });
    expect(inconnu.statusCode).toBe(404);
    // Par NOM : la paire du brouillon, d'abord, puis celle de la version programmée.
    expect(demandes[0]).toEqual([{ modele: 'relance_a', langue: 'fr' }]);
    await server.close();
  });

  it('GET …/modeles : tout approuvé, la version programmée dit la campagne qui la retient', async () => {
    const { server } = app({
      scenarios: {
        publicationProgrammee: async () => ({ graphe: brouillonA, le: '2026-11-18T15:00:00.000Z', par: null }),
        lanceursDuScenario: async () => [{ type: 'campagne', nom: 'Soldes', declencheur: null, blocDeDepart: null }],
      },
      modelesDeBloc: {
        ...modelesDeBlocInertes,
        publication: { ...modelesDeBlocInertes.publication, lignes: { ...modelesDeBlocInertes.publication.lignes, desModeles: async () => [ligneA('approuve')] } },
      },
    });
    const res = await server.inject({ method: 'GET', url: `/tenants/t1/workflows/${W1}/modeles`, ...h(adminTok) });
    expect(res.json<{ programmee: unknown }>().programmee).toEqual({ le: '2026-11-18T15:00:00.000Z', attend: [], campagnes: ['Soldes'] });
    await server.close();
  });

  it('DELETE …/programmation : 204 et journal ; sans programmation, 404', async () => {
    const annulees: Array<string | null> = [];
    const avec = app({ scenarios: { annulerProgrammation: async (_id, _t, le) => { annulees.push(le); return true; } } });
    const ok = await avec.server.inject({ method: 'DELETE', url: `/tenants/t1/workflows/${W1}/programmation`, ...h(adminTok) });
    expect(ok.statusCode).toBe(204);
    expect(annulees).toEqual([null]);
    expect(avec.cap.journal).toEqual([{ action: 'workflow.programmation_annulee', userId: 'u1', target: W1 }]);
    await avec.server.close();
    const sans = app();
    const non = await sans.server.inject({ method: 'DELETE', url: `/tenants/t1/workflows/${W1}/programmation`, ...h(adminTok) });
    expect(non.statusCode).toBe(404);
    await sans.server.close();
  });
});

/**
 * LE VERROU DU PREMIER BLOC D'UNE AUTOMATION (menu « Scénario », lot 5, tâche 9 ; décisions 13 et 23) : dans le rayon
 * Shopify, l'enregistrement et la publication refusent un graphe qui perd, déplace ou change le bloc marqué, ou qui y mène ;
 * un « Aller à » ne vise jamais le premier bloc d'une autre automation. Le rayon général n'en voit rien.
 */
describe('le verrou du premier bloc (rayon Shopify)', () => {
  const W2 = '22222222-2222-4222-8222-222222222222';
  const depart = (code?: string) => ({
    id: 'depart', type: 'template' as const, position: { x: 0, y: 0 },
    data: { verrouille: true, templateName: 'commande_payee', ...(code ? { code } : {}) },
  });
  const merci = { id: 'merci', type: 'quick_message' as const, position: { x: 0, y: 1 }, data: { body: 'Merci' } };
  const ligne = (over: Partial<WorkflowRow> = {}): WorkflowRow => sampleRow({
    rayon: 'shopify', name: 'Commande payée', graph: { nodes: [depart('nod_k7m2p3_01')], edges: [] }, ...over,
  });
  const suite = { nodes: [depart(), merci], edges: [{ id: 'e1', source: 'depart', target: 'merci' }] };

  it('🔴 PATCH : un graphe qui perd le premier bloc est refusé (422), rien n’est écrit ; sa suite passe', async () => {
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W1 ? ligne() : null) } });
    const perdu = await server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: { nodes: [merci], edges: [] } } });
    expect(perdu.statusCode).toBe(422);
    expect(perdu.json()).toMatchObject({ code: 'premier_bloc_verrouille', error: expect.stringContaining('premier bloc') });
    expect(cap.updated).toEqual([]);
    const ok = await server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: suite } });
    expect(ok.statusCode).toBe(200);
    expect(cap.updated).toHaveLength(1);
    await server.close();
  });

  it('le rayon général n’a pas de verrou ; un PATCH du nom seul ne juge aucun graphe', async () => {
    const general = app();
    expect((await general.server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: { nodes: [merci], edges: [] } } })).statusCode).toBe(200);
    await general.server.close();
    const nom = app({ scenarios: { getById: async (id) => (id === W1 ? ligne() : null) } });
    expect((await nom.server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { name: 'Merci pour la commande' } })).statusCode).toBe(200);
    await nom.server.close();
  });

  it('🔴 publication : un brouillon qui a perdu le premier bloc est refusé (422), rien n’est publié', async () => {
    const enCours = ligne({ draftGraph: { nodes: [merci], edges: [] } });
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W1 ? enCours : null), list: async () => [enCours] } });
    const r = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok) });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ code: 'premier_bloc_verrouille' });
    expect(cap.publies).toEqual([]);
    await server.close();
  });

  /** Lot 6 : le scénario d'une automation HubSpot a le même premier bloc verrouillé (décisions 13 et 23), que son circuit envoie. */
  it('🔴 lot 6 : rayon HubSpot, le même verrou à l’enregistrement et à la publication ; sa suite passe', async () => {
    const hubspot = (over: Partial<WorkflowRow> = {}) => ligne({ rayon: 'hubspot', name: 'Devis envoyé', ...over });
    const enregistrement = app({ scenarios: { getById: async (id) => (id === W1 ? hubspot() : null) } });
    const perdu = await enregistrement.server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: { nodes: [merci], edges: [] } } });
    expect(perdu.statusCode).toBe(422);
    expect(perdu.json()).toMatchObject({ code: 'premier_bloc_verrouille' });
    expect(enregistrement.cap.updated).toEqual([]);
    expect((await enregistrement.server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: suite } })).statusCode).toBe(200);
    await enregistrement.server.close();
    const enCours = hubspot({ draftGraph: { nodes: [merci], edges: [] } });
    const publication = app({ scenarios: { getById: async (id) => (id === W1 ? enCours : null), list: async () => [enCours] } });
    const r = await publication.server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok) });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ code: 'premier_bloc_verrouille' });
    expect(publication.cap.publies).toEqual([]);
    await publication.server.close();
  });

  it('une copie jamais publiée d’une automation se publie : son brouillon, écrit par le serveur, fait référence', async () => {
    const copie = ligne({ name: 'Commande payée (copie)', graph: { nodes: [], edges: [] }, draftGraph: suite });
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W1 ? copie : null), list: async () => [copie] } });
    expect((await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok) })).statusCode).toBe(200);
    expect(cap.publies).toEqual([W1]);
    await server.close();
  });

  /**
   * 🔴 Relecture de 5b (mutation X1) : à l'enregistrement aussi, la référence d'une copie jamais publiée est son brouillon.
   * Prise sur le publié (vide), elle vaudrait « aucun premier bloc », et l'éditeur ne pourrait plus rien enregistrer.
   */
  it('🔴 PATCH d’une copie jamais publiée : son brouillon fait référence ; sa suite passe, perdre le premier bloc est refusé', async () => {
    const copie = ligne({ name: 'Commande payée (copie)', graph: { nodes: [], edges: [] }, draftGraph: suite });
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W1 ? copie : null) } });
    const ok = await server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: suite } });
    expect(ok.statusCode).toBe(200);
    const perdu = await server.inject({ method: 'PATCH', url: `/tenants/t1/workflows/${W1}`, ...h(adminTok), payload: { graph: { nodes: [merci], edges: [] } } });
    expect(perdu.statusCode).toBe(422);
    expect(perdu.json()).toMatchObject({ code: 'premier_bloc_verrouille' });
    expect(cap.updated).toHaveLength(1);
    await server.close();
  });

  it('🔴 publication : un « Aller à » vers le premier bloc d’une autre automation est refusé', async () => {
    const autre = sampleRow({
      id: W2, rayon: 'shopify', name: 'Panier abandonné',
      graph: { nodes: [{ ...depart(), id: 'depart2' }], edges: [] },
      draftGraph: {
        nodes: [{ ...depart(), id: 'depart2' }, { id: 'saut', type: 'aller_a', position: { x: 0, y: 1 }, data: { cible: 'nod_k7m2p3_01' } }],
        edges: [{ id: 'e1', source: 'depart2', target: 'saut' }],
      },
    });
    const { server, cap } = app({ scenarios: { getById: async (id) => (id === W2 ? autre : id === W1 ? ligne() : null), list: async () => [ligne(), autre] } });
    const r = await server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W2}/publish`, ...h(adminTok) });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ code: 'aller_a_invalide', error: expect.stringContaining('premier bloc') });
    expect(cap.publies).toEqual([]);
    await server.close();
  });

  it('🔴 la publication d’un scénario Shopify programme le ménage du template remplacé ; le rayon général jamais', async () => {
    const programmes: unknown[] = [];
    const menage = {
      lignes: { desModelesDAutomation: async (_t: string, paires: ReadonlyArray<{ modele: string; langue: string }>) => paires.map((p) => ({ workflowId: W1, modele: p.modele, langue: p.langue, etat: 'approuve' as const, raison: null, creeLe: 'x', trancheLe: null })) },
      programmerOubli: async (job: unknown) => { programmes.push(job); },
    };
    const avecMenage = { ...modelesDeBlocInertes, publication: { ...modelesDeBlocInertes.publication, menage } };
    const v2 = { nodes: [{ ...depart(), data: { verrouille: true, templateName: 'commande_payee_v2' } }], edges: [] };
    const enCours = ligne({ draftGraph: v2 });
    const shopify = app({
      scenarios: { getById: async () => enCours, list: async () => [enCours], publish: async () => ({ ...enCours, graph: v2, draftGraph: null }) },
      modelesDeBloc: avecMenage,
    });
    expect((await shopify.server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok) })).statusCode).toBe(200);
    expect(programmes).toEqual([{ type: 'bloc', tenantId: 't1', modele: 'commande_payee', langue: 'fr', essai: 0 }]);
    await shopify.server.close();
    const general = sampleRow({ graph: { nodes: [{ id: 'n1', type: 'template', position: { x: 0, y: 0 }, data: { templateName: 'ancien' } }], edges: [] }, draftGraph: { nodes: [{ id: 'n1', type: 'template', position: { x: 0, y: 0 }, data: { templateName: 'neuf' } }], edges: [] } });
    const builder = app({ scenarios: { getById: async () => general, publish: async () => ({ ...general, graph: general.draftGraph!, draftGraph: null }) }, modelesDeBloc: avecMenage });
    expect((await builder.server.inject({ method: 'POST', url: `/tenants/t1/workflows/${W1}/publish`, ...h(adminTok) })).statusCode).toBe(200);
    expect(programmes).toHaveLength(1);
    await builder.server.close();
  });

  it('GET /nodes au rayon du scénario édité ; sans scénario, ou inconnu, le Builder général', async () => {
    const rayons: string[] = [];
    const { server } = app({
      scenarios: { getById: async (id) => (id === W1 ? ligne() : null), list: async (_t, rayon) => { rayons.push(rayon); return []; } },
    });
    for (const url of [`/tenants/t1/nodes?scenario=${W1}`, '/tenants/t1/nodes', `/tenants/t1/nodes?scenario=${W2}`, '/tenants/t1/nodes?scenario=pas-un-uuid']) {
      expect((await server.inject({ method: 'GET', url, ...h(adminTok) })).statusCode, url).toBe(200);
    }
    expect(rayons).toEqual(['shopify', 'general', 'general', 'general']);
    await server.close();
  });
});
