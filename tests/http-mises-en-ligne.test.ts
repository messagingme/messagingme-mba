import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import { DUREE_MISE_EN_LIGNE_MS } from '../src/mise-en-ligne/mise-en-ligne';
import { ADMIN, T, monter, proposee } from './mise-en-ligne-fixtures';

/**
 * LA PAGE DU OUI DE MISE EN LIGNE, SES ROUTES (CSM, B2) : la seule porte du clic. 🔴 Une session d'admin de l'espace,
 * rien d'autre : un membre qui n'est pas admin, l'admin d'un autre espace, un jeton qui n'est pas une session de la
 * console (celui du MCP, une clé d'API) sont refusés, et rien n'est publié. La logique du clic est éprouvée par
 * `tests/mise-en-ligne.test.ts` ; ici, la garde et la traduction en statuts.
 */
const SECRET = 'test-secret';
let adminTok = '';
let agentTok = '';
let autreEspaceTok = '';
beforeAll(async () => {
  adminTok = await signSession({ userId: ADMIN.userId, tenantId: T, role: 'admin' }, SECRET);
  agentTok = await signSession({ userId: 'u-agent', tenantId: T, role: 'agent' }, SECRET);
  autreEspaceTok = await signSession({ userId: 'u-x', tenantId: 't2', role: 'admin' }, SECRET);
});
const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
const h = (t: string) => ({ headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` } });

function app() {
  const m = monter();
  return { m, server: buildServer({ queue: new FakeQueue(), auth: { users: noUsers, secret: SECRET }, misesEnLigne: m.deps }) };
}

describe('routes du oui de mise en ligne', () => {
  it('🔴 l’admin de l’espace lit, puis clique : publié et branché ; un second clic rend le résultat', async () => {
    const { m, server } = app();
    const id = await proposee(m);
    const lu = await server.inject({ method: 'GET', url: `/tenants/${T}/mises-en-ligne/${id}`, ...h(adminTok) });
    expect(lu.statusCode).toBe(200);
    expect(lu.json()).toMatchObject({ id, etat: 'proposee', libelle: 'Activer sur WhatsApp' });
    const clic = await server.inject({ method: 'POST', url: `/tenants/${T}/mises-en-ligne/${id}/accepter`, ...h(adminTok), payload: {} });
    expect(clic.statusCode).toBe(200);
    expect(clic.json()).toMatchObject({ etat: 'faite' });
    const encore = await server.inject({ method: 'POST', url: `/tenants/${T}/mises-en-ligne/${id}/accepter`, ...h(adminTok), payload: {} });
    expect(encore.json()).toMatchObject({ etat: 'faite' });
    expect(m.publies).toHaveLength(1);
    await server.close();
  });

  it('🔴 un membre qui n’est pas admin, ou l’admin d’un autre espace, ne lit ni ne clique', async () => {
    const { m, server } = app();
    const id = await proposee(m);
    for (const [tok, nom] of [[agentTok, 'agent'], [autreEspaceTok, 'autre espace']] as const) {
      const lu = await server.inject({ method: 'GET', url: `/tenants/${T}/mises-en-ligne/${id}`, ...h(tok) });
      const clic = await server.inject({ method: 'POST', url: `/tenants/${T}/mises-en-ligne/${id}/accepter`, ...h(tok), payload: {} });
      expect(lu.statusCode, nom).toBe(403);
      expect(clic.statusCode, nom).toBe(403);
    }
    expect(m.publies).toEqual([]);
    await server.close();
  });

  it('🔴 un jeton qui n’est pas une session de la console (MCP, clé d’API) n’ouvre pas le clic', async () => {
    const { m, server } = app();
    const id = await proposee(m);
    for (const jeton of ['mcp_at_0123456789abcdef', 'mm_live_0123456789abcdef', 'pas-un-jeton']) {
      const clic = await server.inject({ method: 'POST', url: `/tenants/${T}/mises-en-ligne/${id}/accepter`, ...h(jeton), payload: {} });
      expect(clic.statusCode, jeton).toBe(401);
    }
    expect(m.publies).toEqual([]);
    await server.close();
  });

  it('une mise en ligne inconnue rend 404 ; un bouton échu rend 409 et son code', async () => {
    const { m, server } = app();
    const inconnue = await server.inject({ method: 'GET', url: `/tenants/${T}/mises-en-ligne/99999999-9999-4999-8999-999999999999`, ...h(adminTok) });
    expect(inconnue.statusCode).toBe(404);
    const malFormee = await server.inject({ method: 'POST', url: `/tenants/${T}/mises-en-ligne/pas-un-uuid/accepter`, ...h(adminTok), payload: {} });
    expect(malFormee.statusCode).toBe(404);
    const id = await proposee(m);
    m.horloge.now += DUREE_MISE_EN_LIGNE_MS;
    const echu = await server.inject({ method: 'POST', url: `/tenants/${T}/mises-en-ligne/${id}/accepter`, ...h(adminTok), payload: {} });
    expect(echu.statusCode).toBe(409);
    expect(echu.json()).toMatchObject({ code: 'expiree' });
    expect(m.publies).toEqual([]);
    await server.close();
  });
});
