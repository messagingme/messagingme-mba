import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import type { HubspotInboxRouteDeps } from '../src/http/hubspot-inbox';
import type { Fonction } from '../src/offres/offres';
import type { LigneEspace } from '../src/hubspot/inbox';
import { HubspotServiceError } from '../src/crm/hubspot-service';

/**
 * `GET` et `PUT /tenants/:t/hubspot/inbox` (lot 1 de l'Inbox HubSpot, tâche 6) : l'admin choisit la boîte où la ligne
 * WhatsApp de l'espace est branchée. Ce qu'elles garantissent : seul un admin de l'espace y touche ; l'état local ne
 * change qu'après la réponse du connecteur ; brancher exige l'offre, débrancher jamais ; un connecteur endormi ou un
 * portail sans portées se disent, jamais en 500.
 */
const SECRET = 'test-secret';
let adminTok = '';
let agentTok = '';
let autreAdminTok = '';
beforeAll(async () => {
  adminTok = await signSession({ userId: 'u1', tenantId: 't1', role: 'admin' }, SECRET);
  agentTok = await signSession({ userId: 'u2', tenantId: 't1', role: 'agent' }, SECRET);
  autreAdminTok = await signSession({ userId: 'u3', tenantId: 't2', role: 'admin' }, SECRET);
});
const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
const LIGNE: LigneEspace = { affichage: '+33 1 00 00 00 00', connectee: true, enPause: false };
const PRO: ReadonlySet<Fonction> = new Set<Fonction>(['inbox']);

interface Banc { boite: string | null; branchements: unknown[]; debranchements: unknown[] }

function app(o: {
  boite?: string | null;
  ligne?: LigneEspace | null;
  fonctions?: ReadonlySet<Fonction>;
  echec?: unknown;
} = {}): { server: ReturnType<typeof buildServer>; b: Banc } {
  const b: Banc = { boite: o.boite ?? null, branchements: [], debranchements: [] };
  const deps: HubspotInboxRouteDeps = {
    store: {
      lireBoite: async () => b.boite,
      brancher: async (_t, boite) => { b.boite = boite; },
      debrancher: async () => { b.boite = null; },
      ligne: async () => (o.ligne === undefined ? LIGNE : o.ligne),
    },
    fonctions: async () => o.fonctions ?? PRO,
    connecteur: {
      boites: async () => { if (o.echec) throw o.echec; return [{ id: '77', nom: 'Boîte générale', type: 'INBOX' }]; },
      brancher: async (c) => { if (o.echec) throw o.echec; b.branchements.push(c); },
      debrancher: async (c) => { if (o.echec) throw o.echec; b.debranchements.push(c); },
    },
  };
  return { server: buildServer({ queue: new FakeQueue(), auth: { users: noUsers, secret: SECRET }, hubspotInbox: deps }), b };
}

const req = (method: 'GET' | 'PUT', tok: string, body?: unknown) => ({
  method, url: '/tenants/t1/hubspot/inbox',
  ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
});

describe('/tenants/:t/hubspot/inbox', () => {
  it('🔴 agent, ou admin d’un AUTRE espace : 403, rien n’est branché', async () => {
    const { server, b } = app();
    for (const tok of [agentTok, autreAdminTok]) {
      expect((await server.inject(req('PUT', tok, { inboxId: '77' }))).statusCode).toBe(403);
      expect((await server.inject(req('GET', tok))).statusCode).toBe(403);
    }
    expect(b.branchements).toHaveLength(0);
    await server.close();
  });

  it('GET rend la boîte branchée, la ligne en E.164 et les boîtes du portail', async () => {
    const { server } = app({ boite: '77' });
    const res = await server.inject(req('GET', adminTok));
    expect(res.json()).toEqual({ boite: '77', ligne: '+33100000000', boites: [{ id: '77', nom: 'Boîte générale', type: 'INBOX' }], raison: null });
    await server.close();
  });

  it('GET d’un portail sans les portées de l’Inbox : la raison, pas une erreur', async () => {
    const { server } = app({ echec: new HubspotServiceError(409, 'portees_inbox_manquantes', false) });
    const res = await server.inject(req('GET', adminTok));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ boites: null, raison: 'portees_inbox_manquantes' });
    await server.close();
  });

  it('🔴 un connecteur endormi (échéance dépassée) : « indisponible », jamais une 500', async () => {
    const endormi = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const { server } = app({ echec: endormi });
    expect((await server.inject(req('GET', adminTok))).json()).toMatchObject({ raison: 'connecteur_indisponible' });
    const put = await server.inject(req('PUT', adminTok, { inboxId: '77' }));
    expect(put.statusCode).toBe(502);
    expect(put.json()).toEqual({ error: 'connecteur_indisponible' });
    await server.close();
  });

  it('PUT branche la ligne en E.164 sur la boîte, puis seulement retient la boîte', async () => {
    const { server, b } = app();
    const res = await server.inject(req('PUT', adminTok, { inboxId: '77' }));
    expect(res.json()).toEqual({ boite: '77' });
    expect(b.branchements).toEqual([{ tenantId: 't1', ligne: '+33100000000', inboxId: '77', nom: 'WhatsApp +33100000000' }]);
    expect(b.boite).toBe('77');
    await server.close();
  });

  it('🔴 un refus du connecteur : la boîte n’est PAS retenue (la console ne dit jamais « branché » à tort)', async () => {
    const { server, b } = app({ echec: new HubspotServiceError(409, 'portees_inbox_manquantes', false) });
    const res = await server.inject(req('PUT', adminTok, { inboxId: '77' }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'portees_inbox_manquantes' });
    expect(b.boite).toBeNull();
    await server.close();
  });

  it('changer de boîte débranche d’abord l’ancienne', async () => {
    const { server, b } = app({ boite: '77' });
    await server.inject(req('PUT', adminTok, { inboxId: '78' }));
    expect(b.debranchements).toHaveLength(1);
    expect(b.branchements).toHaveLength(1);
    expect(b.boite).toBe('78');
    await server.close();
  });

  it('🔴 brancher sans la fonction de l’offre : 402 ; débrancher reste permis', async () => {
    const sansOffre = app({ fonctions: new Set<Fonction>() });
    expect((await sansOffre.server.inject(req('PUT', adminTok, { inboxId: '77' }))).statusCode).toBe(402);
    expect(sansOffre.b.branchements).toHaveLength(0);
    await sansOffre.server.close();
    const branche = app({ boite: '77', fonctions: new Set<Fonction>() });
    expect((await branche.server.inject(req('PUT', adminTok, { inboxId: null }))).json()).toEqual({ boite: null });
    expect(branche.b.debranchements).toHaveLength(1);
    await branche.server.close();
  });

  it('un espace sans numéro : 409 au branchement, `sans_numero` à la lecture', async () => {
    const { server } = app({ ligne: null });
    expect((await server.inject(req('PUT', adminTok, { inboxId: '77' }))).statusCode).toBe(409);
    expect((await server.inject(req('GET', adminTok))).json()).toMatchObject({ raison: 'sans_numero' });
    await server.close();
  });

  it('corps invalide (identifiant non numérique, champ en trop) : 400', async () => {
    const { server } = app();
    expect((await server.inject(req('PUT', adminTok, { inboxId: 'abc' }))).statusCode).toBe(400);
    expect((await server.inject(req('PUT', adminTok, { inboxId: '77', x: 1 }))).statusCode).toBe(400);
    await server.close();
  });
});
