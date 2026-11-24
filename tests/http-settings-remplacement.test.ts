import { describe, it, expect, beforeAll } from 'vitest';
import { sansPortailHubspot } from './hubspot';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import type { SettingsRouteDeps } from '../src/http/settings';
import type { AuditSink } from '../src/audit/journal';
import type { Offre } from '../src/offres/offres';
import { reglagesDepInertes, reglagesInertes } from './routes-inertes';

/**
 * « LE PLUS ANCIEN LAISSE SA PLACE » DANS LES RÉGLAGES (décision de Julien du 2026-11-24, lot 2) : un administrateur coche
 * l'option en Business et en Entreprise ; ailleurs elle est refusée, et la décocher passe toujours. Un changement entre au
 * journal de l'espace ; `possible` dit à l'écran s'il peut la proposer.
 */
const SECRET = 'test-secret';
const tok = { admin: '', manager: '' };
beforeAll(async () => {
  tok.admin = await signSession({ userId: 'u1', tenantId: 't1', role: 'admin' }, SECRET);
  tok.manager = await signSession({ userId: 'u2', tenantId: 't1', role: 'manager' }, SECRET);
});
const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
const h = (t: string) => ({ headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` } });
const URL = '/tenants/t1/settings/contacts-remplacer-anciens';

function app(offre: Offre, initial = false) {
  let courant = initial;
  const ecrits: boolean[] = [];
  const audits: Array<{ action: string; detail: Record<string, unknown> | undefined }> = [];
  const audit: AuditSink = async (_t, _a, action, _c, detail) => { audits.push({ action, detail }); };
  const settings: SettingsRouteDeps = {
    ...reglagesInertes,
    audit,
    hubspotPortalConnecte: sansPortailHubspot,
    reglages: {
      ...reglagesDepInertes,
      get: async () => { throw new Error('get : hors de ce test'); },
      setMbaEnabled: async () => {}, setHubspotListsEnabled: async () => {}, setControlHandbackSeconds: async () => {},
      setTimezone: async () => {}, setBusinessHours: async () => {},
    },
    choixHubspot: async () => ({ analyse: true, passage: true, injoignable: true, reponse: false, modeles: false, workflows: false, automations: false, stop: true, valideLe: null }),
    remplacement: {
      lire: async () => courant,
      ecrire: async (_t, actif) => { ecrits.push(actif); courant = actif; },
      offreDe: async () => offre,
    },
  };
  return { ecrits, audits, srv: buildServer({ queue: new FakeQueue(), auth: { users: noUsers, secret: SECRET }, settings }) };
}

describe('l’option « le plus ancien laisse sa place » dans les réglages', () => {
  it('🔴 un Business la coche : écrite, au journal avec l’état d’avant ; la lecture dit qu’elle est possible', async () => {
    const { srv, ecrits, audits } = app('business');
    expect((await srv.inject({ method: 'GET', url: URL, ...h(tok.admin) })).json()).toEqual({ actif: false, possible: true });
    const r = await srv.inject({ method: 'PATCH', url: URL, ...h(tok.admin), payload: { actif: true } });
    expect([r.statusCode, r.json()]).toEqual([200, { actif: true }]);
    expect(ecrits).toEqual([true]);
    expect(audits).toEqual([{ action: 'settings.contacts_remplacer_anciens', detail: { actif: true, actifAvant: false } }]);
    // La même valeur une seconde fois : rien de plus au journal.
    await srv.inject({ method: 'PATCH', url: URL, ...h(tok.admin), payload: { actif: true } });
    expect(audits).toHaveLength(1);
    await srv.close();
  });

  it('une Entreprise aussi', async () => {
    const { srv, ecrits } = app('entreprise');
    expect((await srv.inject({ method: 'PATCH', url: URL, ...h(tok.admin), payload: { actif: true } })).statusCode).toBe(200);
    expect(ecrits).toEqual([true]);
    await srv.close();
  });

  it('🔴 un Pro ou une Free ne la cochent pas (409, rien d’écrit) ; la décocher passe toujours (un espace redescendu)', async () => {
    for (const offre of ['pro', 'base'] as const) {
      const { srv, ecrits } = app(offre, true);
      expect((await srv.inject({ method: 'GET', url: URL, ...h(tok.admin) })).json()).toEqual({ actif: true, possible: false });
      const r = await srv.inject({ method: 'PATCH', url: URL, ...h(tok.admin), payload: { actif: true } });
      expect([r.statusCode, r.json<{ code: string }>().code]).toEqual([409, 'offre_business_requise']);
      expect(ecrits).toEqual([]);
      expect((await srv.inject({ method: 'PATCH', url: URL, ...h(tok.admin), payload: { actif: false } })).statusCode).toBe(200);
      expect(ecrits).toEqual([false]);
      await srv.close();
    }
  });

  it('🔴 un manager ne la règle pas (403) ; un corps qui n’est pas un booléen : 400', async () => {
    const { srv, ecrits } = app('business');
    expect((await srv.inject({ method: 'PATCH', url: URL, ...h(tok.manager), payload: { actif: true } })).statusCode).toBe(403);
    expect((await srv.inject({ method: 'GET', url: URL, ...h(tok.manager) })).statusCode).toBe(403);
    expect((await srv.inject({ method: 'PATCH', url: URL, ...h(tok.admin), payload: { actif: 'oui' } })).statusCode).toBe(400);
    expect(ecrits).toEqual([]);
    await srv.close();
  });
});
