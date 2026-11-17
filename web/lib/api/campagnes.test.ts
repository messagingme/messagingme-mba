import { describe, it, expect, vi, afterEach } from 'vitest';
import { cancelSchedule, retryRecipient, runCampaign } from './campagnes';

/**
 * Lancer, renvoyer et annuler la programmation passent par l'espace (2026-11-17). 🔴 La console part avant l'API (Vercel
 * publie au push) : tant que l'API n'a pas la nouvelle adresse, seul son 404 de route inconnue fait retomber sur
 * l'ancienne. Un autre 404, une campagne introuvable, remonte tel quel : le rejouer ailleurs le masquerait.
 */
type Reponse = { status: number; corps: unknown };
function repondre(...reponses: Reponse[]): Array<{ url: string; methode: string | undefined; corps: unknown }> {
  const appels: Array<{ url: string; methode: string | undefined; corps: unknown }> = [];
  let rang = 0;
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    appels.push({ url, methode: init?.method, corps: init?.body ? JSON.parse(String(init.body)) : null });
    const r = reponses[Math.min(rang, reponses.length - 1)]!;
    rang += 1;
    return new Response(JSON.stringify(r.corps), { status: r.status, headers: { 'content-type': 'application/json' } });
  }));
  return appels;
}

const ROUTE_INCONNUE: Reponse = {
  status: 404, corps: { message: 'Route POST:/tenants/t1/campaigns/c1/run not found', error: 'Not Found', statusCode: 404 },
};

describe('les actions de campagne passent par l’espace', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('un seul appel, à l’adresse de l’espace, avec la date quand il y en a une', async () => {
    const appels = repondre({ status: 202, corps: { scheduled: true } });
    await runCampaign('t1', 'c1', '2026-12-01T09:00:00.000Z');
    expect(appels).toEqual([{
      url: expect.stringMatching(/\/tenants\/t1\/campaigns\/c1\/run$/), methode: 'POST', corps: { scheduledAt: '2026-12-01T09:00:00.000Z' },
    }]);
  });

  it('🔴 une API pas encore déployée (route inconnue) : le même appel repart sur l’ancienne adresse', async () => {
    const appels = repondre(ROUTE_INCONNUE, { status: 202, corps: { enqueued: true } });
    expect(await runCampaign('t1', 'c1')).toEqual({ enqueued: true });
    expect(appels.map((a) => a.url)).toEqual([
      expect.stringMatching(/\/tenants\/t1\/campaigns\/c1\/run$/),
      expect.stringMatching(/[^s]\/campaigns\/c1\/run$/),
    ]);
  });

  it('🔴 un 404 de l’application (campagne inconnue) remonte, sans second appel', async () => {
    const appels = repondre({ status: 404, corps: { error: 'campagne inconnue' } });
    await expect(runCampaign('t1', 'c1')).rejects.toThrow(/campagne inconnue/);
    expect(appels).toHaveLength(1);
  });

  it('le renvoi et l’annulation suivent la même règle', async () => {
    const renvoi = repondre(ROUTE_INCONNUE, { status: 202, corps: { enqueued: true, recipientId: 'r1' } });
    await retryRecipient('t1', 'c1', 'r1');
    expect(renvoi.map((a) => a.url)).toEqual([
      expect.stringMatching(/\/tenants\/t1\/campaigns\/c1\/recipients\/r1\/retry$/),
      expect.stringMatching(/[^s]\/campaigns\/c1\/recipients\/r1\/retry$/),
    ]);
    const annulation = repondre({ status: 200, corps: { cancelled: true } });
    await cancelSchedule('t1', 'c1');
    expect(annulation.map((a) => a.url)).toEqual([expect.stringMatching(/\/tenants\/t1\/campaigns\/c1\/cancel-schedule$/)]);
  });
});
