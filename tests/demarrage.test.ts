import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import type { DemarrageRouteDeps } from '../src/http/demarrage';

/** La route « Bien démarrer » (plan 2026-11-24-guide-demarrage, lot 1) : l'espace vérifié, réservée aux admins. */
const SECRET = 'test-secret';
let adminTok = '';
let agentTok = '';
beforeAll(async () => {
  adminTok = await signSession({ userId: 'u1', tenantId: 't1', role: 'admin' }, SECRET);
  agentTok = await signSession({ userId: 'u2', tenantId: 't1', role: 'agent' }, SECRET);
});
const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
const h = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const ETAT = { numero: true, outil: false, scenarioOuCampagne: true, agent: false, bulle: false };

function app(lus: string[]) {
  const deps: DemarrageRouteDeps = { etat: async (tenant) => { lus.push(tenant); return ETAT; } };
  return buildServer({ queue: new FakeQueue(), auth: { users: noUsers, secret: SECRET }, demarrage: deps });
}

describe('route demarrage', () => {
  it('rend les cinq signaux de l’espace de la session', async () => {
    const lus: string[] = [];
    const server = app(lus);
    const res = await server.inject({ method: 'GET', url: '/tenants/t1/demarrage', ...h(adminTok) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(ETAT);
    expect(lus).toEqual(['t1']);
    await server.close();
  });

  it('🔴 un autre espace dans l’URL est refusé, sans lecture', async () => {
    const lus: string[] = [];
    const server = app(lus);
    const res = await server.inject({ method: 'GET', url: '/tenants/t2/demarrage', ...h(adminTok) });
    expect(res.statusCode).toBe(403);
    expect(lus).toEqual([]);
    await server.close();
  });

  it('réservée aux administrateurs, comme l’Accueil', async () => {
    const lus: string[] = [];
    const server = app(lus);
    const res = await server.inject({ method: 'GET', url: '/tenants/t1/demarrage', ...h(agentTok) });
    expect(res.statusCode).toBe(403);
    expect(lus).toEqual([]);
    await server.close();
  });
});
