import { describe, it, expect, vi, afterEach } from 'vitest';
import { demarrerPro } from './offre';

/**
 * Démarrer la formule Pro avant la fin de l'essai (révision du Crédit WhatsApp, 2026-11-04, décision 6), côté navigateur :
 * ce que la réponse du serveur veut dire pour l'écran. 🔴 La console part avant l'API (Vercel publie au push) : une API
 * d'avant le champ `paye` n'annonçait que les paiements faits, il se lit donc vrai quand il manque.
 */
function repondre(status: number, corps: unknown): Array<{ url: string; methode: string | undefined; corps: unknown }> {
  const appels: Array<{ url: string; methode: string | undefined; corps: unknown }> = [];
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    appels.push({ url, methode: init?.method, corps: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });
  }));
  return appels;
}

describe('demarrerPro', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('un POST sans rien dedans (un corps JSON vide, que le serveur accepte), et le paiement relu dit tel quel', async () => {
    const appels = repondre(200, { essaiFini: true, paye: true });
    expect(await demarrerPro('t1')).toEqual({ paye: true });
    expect(appels).toEqual([{ url: expect.stringContaining('/tenants/t1/offre/pro/demarrer'), methode: 'POST', corps: {} }]);
    repondre(200, { essaiFini: true, paye: false });
    expect(await demarrerPro('t1')).toEqual({ paye: false });
  });

  it('🔴 une API d’avant le champ (paye absent) : lu vrai, comme elle l’annonçait', async () => {
    repondre(200, { essaiFini: true });
    expect(await demarrerPro('t1')).toEqual({ paye: true });
  });

  it('🔴 une carte refusée (402) remonte avec le message du serveur : l’essai continue', async () => {
    repondre(402, { error: 'Le paiement n’a pas abouti : votre essai continue.', code: 'paiement_refuse' });
    await expect(demarrerPro('t1')).rejects.toThrow(/votre essai continue/);
  });
});
