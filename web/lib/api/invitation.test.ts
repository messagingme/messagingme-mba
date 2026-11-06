import { describe, it, expect, vi, afterEach } from 'vitest';
import { accepterInvitationGoogle, estApercuInvitation, lireApercuInvitation } from './auth';

/**
 * La page d'une invitation (lot identité C), côté navigateur : ce que la lecture de l'aperçu veut dire pour l'écran.
 * 🔴 La console part AVANT l'API (Vercel publie au push) : l'API d'avant le lot n'a pas la route (404), et le harnais e2e
 * répond `{}` à toute route qu'il ne connaît pas. Les deux doivent donner `indisponible`, donc l'ancien formulaire SANS
 * Google, jamais une invitation « lisible » vide.
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

const APERCU = { espace: 'Acme', adresse: 'invite@x.fr', invitant: { nom: 'Boss', adresse: 'boss@x.fr' }, aUnMotDePasse: false };

describe('lireApercuInvitation', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('un aperçu de la bonne forme : lisible, et un seul POST qui porte le jeton', async () => {
    const appels = repondre(200, APERCU);
    expect(await lireApercuInvitation('JETON')).toEqual({ statut: 'ok', apercu: APERCU });
    expect(appels).toEqual([{ url: expect.stringContaining('/auth/invitations/apercu'), methode: 'POST', corps: { token: 'JETON' } }]);
  });

  it('une invitation morte (400) : `invalide`', async () => {
    repondre(400, { error: 'invitation invalide ou expirée' });
    expect(await lireApercuInvitation('JETON')).toEqual({ statut: 'invalide' });
  });

  it('🔴 l’API d’avant le lot (404), un plafond (429), une panne (503) ou une réponse vide : `indisponible`', async () => {
    for (const [status, corps] of [[404, { error: 'Not Found' }], [429, { error: 'trop' }], [503, { error: 'indisponible' }], [200, {}]] as const) {
      repondre(status, corps);
      expect(await lireApercuInvitation('JETON'), `${status} ${JSON.stringify(corps)}`).toEqual({ statut: 'indisponible' });
      vi.unstubAllGlobals();
    }
  });
});

describe('estApercuInvitation', () => {
  it('accepte un invitant inconnu (invitation d’avant le lot), refuse toute autre forme', () => {
    expect(estApercuInvitation({ ...APERCU, invitant: null })).toBe(true);
    expect(estApercuInvitation({ ...APERCU, invitant: { nom: null, adresse: 'boss@x.fr' } })).toBe(true);
    expect(estApercuInvitation({ ...APERCU, aUnMotDePasse: 'oui' })).toBe(false);
    expect(estApercuInvitation({ ...APERCU, invitant: { nom: 'Boss' } })).toBe(false);
    expect(estApercuInvitation({ espace: 'Acme' })).toBe(false);
    expect(estApercuInvitation(null)).toBe(false);
  });
});

describe('accepterInvitationGoogle', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('poste le jeton de l’invitation ET le jeton Google, et rend la session', async () => {
    const appels = repondre(200, { token: 'S', user: { email: 'invite@x.fr', role: 'agent', tenantId: 't1' } });
    expect(await accepterInvitationGoogle('JETON', 'IDTOKEN')).toMatchObject({ token: 'S', user: { tenantId: 't1' } });
    expect(appels).toEqual([{ url: expect.stringContaining('/auth/invitations/google'), methode: 'POST', corps: { token: 'JETON', idToken: 'IDTOKEN' } }]);
  });

  it('une autre adresse Google (403) remonte avec le message du serveur', async () => {
    repondre(403, { error: 'le compte Google autre@x.fr n’est pas l’adresse invitée', code: 'autre_adresse' });
    await expect(accepterInvitationGoogle('JETON', 'IDTOKEN')).rejects.toThrow(/n’est pas l’adresse invitée/);
  });
});
