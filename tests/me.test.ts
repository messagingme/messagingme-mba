import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import type { MeRouteDeps } from '../src/http/me';

const SECRET = 'test-secret';
let agentTok = '';
let otherTenantTok = '';
let observationTok = '';
beforeAll(async () => {
  agentTok = await signSession({ userId: 'u1', tenantId: 't1', role: 'agent' }, SECRET);
  otherTenantTok = await signSession({ userId: 'u9', tenantId: 't2', role: 'admin' }, SECRET);
  // Le jeton que `/ops/observe` émet (`src/index.ts`) : une identité qui n'est PAS un uuid, et aucun compte.
  observationTok = await signSession({ userId: 'ops-observation', tenantId: 't1', role: 'admin', impersonated: true }, SECRET);
});
const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
const h = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

function app(over: Partial<MeRouteDeps> = {}) {
  const deps: MeRouteDeps = {
    getById: async (userId) => (userId === 'u1' ? { email: 'julien@messagingme.fr', name: 'Julien Dumas', role: 'agent' } : null),
    accueilAFaire: async () => false,
    marquerAccueil: async () => {},
    ...over,
  };
  return buildServer({ queue: new FakeQueue(), auth: { users: noUsers, secret: SECRET }, me: deps });
}

describe('route me', () => {
  it('🔴 jaune 4 de la relecture de A : le rôle rendu est le rôle EFFECTIF de la requête (en Pro, administrateur), pas celui de la fiche', async () => {
    const server = buildServer({
      queue: new FakeQueue(),
      // Le rôle frais que la garde pose à chaque requête : `getUserState` rend le rôle effectif (`roleEffectif`, src/index.ts).
      auth: { users: noUsers, secret: SECRET, getUserState: async () => ({ role: 'admin', disabled: false, horsOffre: null, sessionsDepuis: null }) },
      me: { getById: async () => ({ email: 'julien@messagingme.fr', name: 'Julien Dumas', role: 'agent' }), accueilAFaire: async () => false, marquerAccueil: async () => {} },
    });
    const res = await server.inject({ method: 'GET', url: '/tenants/t1/me', ...h(agentTok) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ role: 'admin' });
    await server.close();
  });

  it('renvoie le profil de l\'utilisateur courant (depuis req.auth.userId)', async () => {
    const server = app();
    const res = await server.inject({ method: 'GET', url: '/tenants/t1/me', ...h(agentTok) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: 'julien@messagingme.fr', name: 'Julien Dumas', role: 'agent' });
    await server.close();
  });

  it('tenant croisé -> 403', async () => {
    const server = app();
    const res = await server.inject({ method: 'GET', url: '/tenants/t1/me', ...h(otherTenantTok) });
    expect(res.statusCode).toBe(403);
    await server.close();
  });

  it('utilisateur inconnu -> 404', async () => {
    const server = app({ getById: async () => null });
    const res = await server.inject({ method: 'GET', url: '/tenants/t1/me', ...h(agentTok) });
    expect(res.statusCode).toBe(404);
    await server.close();
  });

  it('🔴 la session d’observation de /ops : une réponse propre, SANS lecture en base (son identité n’est pas un uuid)', async () => {
    const lus: string[] = [];
    // Lue en base, `ops-observation` fait lever Postgres (22P02) : le faux dépôt fait de même.
    const server = app({ getById: async (userId) => { lus.push(userId); throw new Error('invalid input syntax for type uuid: "ops-observation"'); } });
    const res = await server.inject({ method: 'GET', url: '/tenants/t1/me', ...h(observationTok) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: '', name: null, role: 'admin' });
    expect(lus).toEqual([]);
    await server.close();
  });

  it('le lien d’exploitation : `exploitation: true` pour une adresse de la liste, rien sinon', async () => {
    // Un confort du menu du compte, jamais une autorisation : `/ops` a sa propre garde. Le champ n'est posé que
    // vrai, pour qu'une réponse ordinaire garde exactement sa forme d'avant.
    const vus: string[] = [];
    const oui = app({ estExploitant: (email) => { vus.push(email); return true; } });
    expect((await oui.inject({ method: 'GET', url: '/tenants/t1/me', ...h(agentTok) })).json()).toMatchObject({ exploitation: true });
    expect(vus).toEqual(['julien@messagingme.fr']);
    await oui.close();
    const non = app({ estExploitant: () => false });
    expect((await non.inject({ method: 'GET', url: '/tenants/t1/me', ...h(agentTok) })).json()).not.toHaveProperty('exploitation');
    await non.close();
    // Une session d'observation n'a pas d'identité à elle : jamais de lien.
    const observation = app({ estExploitant: () => true });
    expect((await observation.inject({ method: 'GET', url: '/tenants/t1/me', ...h(observationTok) })).json()).not.toHaveProperty('exploitation');
    await observation.close();
  });

  describe('la fenêtre de bienvenue (plan 2026-11-19-accueil-pro)', () => {
    it('`accueilAFaire: true` pour un compte qui n’a pas choisi, lu dans l’espace de la session ; rien sinon', async () => {
      const lus: Array<[string, string]> = [];
      const oui = app({ accueilAFaire: async (u, t) => { lus.push([u, t]); return true; } });
      expect((await oui.inject({ method: 'GET', url: '/tenants/t1/me', ...h(agentTok) })).json()).toMatchObject({ accueilAFaire: true });
      expect(lus).toEqual([['u1', 't1']]);
      await oui.close();
      // Le champ n'est posé que vrai : une réponse ordinaire garde sa forme d'avant.
      const non = app({ accueilAFaire: async () => false });
      expect((await non.inject({ method: 'GET', url: '/tenants/t1/me', ...h(agentTok) })).json()).not.toHaveProperty('accueilAFaire');
      await non.close();
    });

    it('🔴 la session d’observation de /ops ne la voit jamais, et n’est pas lue en base', async () => {
      const lus: string[] = [];
      const server = app({ accueilAFaire: async (u) => { lus.push(u); return true; } });
      expect((await server.inject({ method: 'GET', url: '/tenants/t1/me', ...h(observationTok) })).json()).not.toHaveProperty('accueilAFaire');
      expect(lus).toEqual([]);
      await server.close();
    });

    it('🔴 le marquage touche le compte de la SESSION dans son espace, jamais un compte nommé par la requête', async () => {
      const marques: Array<[string, string]> = [];
      const server = app({ marquerAccueil: async (u, t) => { marques.push([u, t]); } });
      const res = await server.inject({ method: 'POST', url: '/tenants/t1/moi/accueil', payload: {}, ...h(agentTok) });
      expect(res.statusCode).toBe(204);
      expect(marques).toEqual([['u1', 't1']]);
      // Un identifiant glissé dans le corps est refusé, rien n'est marqué.
      const refus = await server.inject({ method: 'POST', url: '/tenants/t1/moi/accueil', payload: { userId: 'u2' }, ...h(agentTok) });
      expect(refus.statusCode).toBe(400);
      expect(marques).toHaveLength(1);
      await server.close();
    });

    it('marquer : 401 sans session, 403 sur un autre espace, 403 pour la session d’observation (la garde refuse ses écritures)', async () => {
      const marques: string[] = [];
      const server = app({ marquerAccueil: async (u) => { marques.push(u); } });
      expect((await server.inject({ method: 'POST', url: '/tenants/t1/moi/accueil', payload: {} })).statusCode).toBe(401);
      expect((await server.inject({ method: 'POST', url: '/tenants/t1/moi/accueil', payload: {}, ...h(otherTenantTok) })).statusCode).toBe(403);
      expect((await server.inject({ method: 'POST', url: '/tenants/t1/moi/accueil', payload: {}, ...h(observationTok) })).statusCode).toBe(403);
      expect(marques).toEqual([]);
      await server.close();
    });
  });

  it('sans token -> 401', async () => {
    const server = app();
    const res = await server.inject({ method: 'GET', url: '/tenants/t1/me' });
    expect(res.statusCode).toBe(401);
    await server.close();
  });
});
