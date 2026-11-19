import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import type { DepsLignesHubspot } from '../src/hubspot/lignes-gestion';
import type { LigneHubspot } from '../src/hubspot/lignes';
import type { WorkflowRow } from '../src/workflow/store.pg';
import type { SourceOffres } from '../src/offres/offre.pg';
import { DROITS, type Offre } from '../src/offres/offres';

/**
 * LES ROUTES D'AUTOMATION > HUBSPOT (menu « Scénario », lot 6b, tâche 4), sur le contrat que la console du lot 6c lit : les
 * rôles de l'écran Automation (lecture à tous, écritures aux administrateurs), un refus toujours porteur d'une phrase
 * (`error`) que la console affiche telle quelle, le `PUT` qui ne reçoit ce soir que l'interrupteur, et l'offre `crm`.
 */

const SECRET = 'test-secret';
let adminTok = '';
let agentTok = '';
beforeAll(async () => {
  adminTok = await signSession({ userId: 'u1', tenantId: 't1', role: 'admin' }, SECRET);
  agentTok = await signSession({ userId: 'u2', tenantId: 't1', role: 'agent' }, SECRET);
});
const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
const h = (t: string) => ({ headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` } });

const L1 = '11111111-1111-4111-8111-111111111111';
const ETAPE: LigneHubspot = { id: L1, famille: 'etape', config: { pipelineId: 'default', stageId: 'closedwon', stageLabel: 'Gagné' }, actif: false, workflowId: 'wf-1', nom: 'Étape Gagné' };

function app(o: { offre?: Offre; lignes?: LigneHubspot[] } = {}) {
  const lignes = [...(o.lignes ?? [ETAPE])];
  const ecritures: string[] = [];
  const scenario: WorkflowRow = {
    id: 'wf-1', tenantId: 't1', name: 'Étape Gagné', code: 'scn_1', graph: { nodes: [{ id: 'depart', type: 'template', position: { x: 0, y: 0 }, data: { verrouille: true } }], edges: [] },
    draftGraph: null, publishedAt: 'x', createdAt: 'x', updatedAt: 'x', rayon: 'hubspot',
  };
  const gestion: DepsLignesHubspot = {
    lignes: {
      lister: async () => lignes,
      lire: async (t, id) => (t === 't1' ? lignes.find((l) => l.id === id) ?? null : null),
      creer: async (_t, l) => { ecritures.push(`creer:${l.famille}`); lignes.push({ ...ETAPE, id: '22222222-2222-4222-8222-222222222222', famille: l.famille, config: l.config, nom: l.nom }); return { id: '22222222-2222-4222-8222-222222222222' }; },
      etapeReglee: async () => false,
      allumer: async (_t, id, actif) => { ecritures.push(`allumer:${id}:${actif}`); return true; },
      supprimer: async (_t, id) => { ecritures.push(`supprimer:${id}`); return true; },
    },
    workflows: {
      insert: async () => ({ id: 'wf-1' }), publish: async () => scenario, getById: async () => scenario, publicationProgrammee: async () => null,
    },
    indices: { get: async () => [] },
    parcours: { arreterParcours: async () => 0 },
    modeles: async () => [],
    champs: async () => [{ key: 'hs_date_rdv', type: 'datetime' }],
    choix: async () => ({ automations: true, workflows: false }),
    ligneHubspot: async () => 'reliee',
  };
  const offre = o.offre ?? 'entreprise';
  const offres: SourceOffres = { offreDe: async () => ({ offre, droits: DROITS[offre], retourEnBaseLe: null }) };
  return { server: buildServer({ queue: new FakeQueue(), auth: { users: noUsers, secret: SECRET }, hubspotLignes: { gestion }, offres }), ecritures };
}

describe('routes Automation > HubSpot', () => {
  it('🔴 GET : `connecte` booléen, les deux interrupteurs, et les lignes ; lisible par un agent', async () => {
    const { server } = app();
    const res = await server.inject({ method: 'GET', url: '/tenants/t1/hubspot/lignes', ...h(agentTok) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      connecte: true, automationsCoupees: false, workflowsCoupes: true,
      lignes: [{ id: L1, famille: 'etape', config: ETAPE.config, actif: false, workflowId: 'wf-1', scenario: 'Étape Gagné', modele: null, blocs: 1, versionProgrammee: false }],
    });
    await server.close();
  });

  it('🔴 un agent ne crée, ne règle ni ne supprime rien (403), sans aucune écriture', async () => {
    const { server, ecritures } = app();
    const appels = [
      server.inject({ method: 'POST', url: '/tenants/t1/hubspot/lignes', ...h(agentTok), payload: { famille: 'workflow', config: {} } }),
      server.inject({ method: 'PUT', url: `/tenants/t1/hubspot/lignes/${L1}`, ...h(agentTok), payload: { actif: false } }),
      server.inject({ method: 'DELETE', url: `/tenants/t1/hubspot/lignes/${L1}`, ...h(agentTok) }),
    ];
    for (const r of await Promise.all(appels)) expect(r.statusCode).toBe(403);
    expect(ecritures).toEqual([]);
    await server.close();
  });

  it('POST : 201 et la ligne ; le nom donné ; une famille inconnue, une configuration illisible : 400 avec une phrase', async () => {
    const { server } = app();
    const ok = await server.inject({ method: 'POST', url: '/tenants/t1/hubspot/lignes', ...h(adminTok), payload: { famille: 'rdv', config: { fieldKey: 'hs_date_rdv', sens: 'avant', delaiMinutes: 60 }, nom: 'Rappel J-1' } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ ligne: { famille: 'rdv', config: { fieldKey: 'hs_date_rdv', sens: 'avant', delaiMinutes: 60 } } });
    for (const payload of [{ famille: 'mail', config: {} }, { famille: 'etape', config: { stageId: 's' } }, { famille: 'etape', config: {}, autre: 1 }]) {
      const r = await server.inject({ method: 'POST', url: '/tenants/t1/hubspot/lignes', ...h(adminTok), payload });
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
      expect(r.json<{ error: string }>().error, JSON.stringify(payload)).toMatch(/^[A-ZÉ].+\.$/);
    }
    await server.close();
  });

  it('🔴 PUT : l’interrupteur seul ; une configuration est refusée en 400 ; allumer sans template rend 409 a_completer', async () => {
    const { server, ecritures } = app();
    const config = await server.inject({ method: 'PUT', url: `/tenants/t1/hubspot/lignes/${L1}`, ...h(adminTok), payload: { actif: true, config: {} } });
    expect(config.statusCode).toBe(400);
    expect(config.json<{ error: string }>().error).toMatch(/interrupteur/);
    const aCompleter = await server.inject({ method: 'PUT', url: `/tenants/t1/hubspot/lignes/${L1}`, ...h(adminTok), payload: { actif: true } });
    expect(aCompleter.statusCode).toBe(409);
    expect(aCompleter.json()).toMatchObject({ code: 'a_completer', error: expect.stringContaining('premier message') });
    expect(ecritures).toEqual([]);
    const eteinte = await server.inject({ method: 'PUT', url: `/tenants/t1/hubspot/lignes/${L1}`, ...h(adminTok), payload: { actif: false } });
    expect(eteinte.statusCode).toBe(200);
    expect(ecritures).toEqual([`allumer:${L1}:false`]);
    await server.close();
  });

  it('DELETE : 204 ; une ligne inconnue ou un identifiant qui n’en est pas un : 404 avec une phrase', async () => {
    const { server } = app();
    expect((await server.inject({ method: 'DELETE', url: `/tenants/t1/hubspot/lignes/${L1}`, ...h(adminTok) })).statusCode).toBe(204);
    for (const id of ['pas-un-uuid', '33333333-3333-4333-8333-333333333333']) {
      const r = await server.inject({ method: 'DELETE', url: `/tenants/t1/hubspot/lignes/${id}`, ...h(adminTok) });
      expect(r.statusCode, id).toBe(404);
      expect(r.json<{ error: string }>().error).toMatch(/rechargez la page/);
    }
    await server.close();
  });

  it('🔴 hors de l’offre qui ouvre HubSpot (`crm`) : refusé, même en lecture', async () => {
    const { server } = app({ offre: 'pro' });
    const res = await server.inject({ method: 'GET', url: '/tenants/t1/hubspot/lignes', ...h(adminTok) });
    expect(res.statusCode).toBe(402);
    await server.close();
  });

  it('un autre espace que celui du jeton : 403', async () => {
    const { server } = app();
    expect((await server.inject({ method: 'GET', url: '/tenants/t2/hubspot/lignes', ...h(adminTok) })).statusCode).toBe(403);
    await server.close();
  });
});
