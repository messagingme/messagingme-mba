import { describe, it, expect, vi, afterEach } from 'vitest';
import { login, loginOps, loginWithGoogle } from './auth';

/**
 * LA CONNEXION GOOGLE DE LA CONSOLE PORTE LA LANGUE DE L'ÉCRAN (aide à la connexion, lot 2b). Une adresse inconnue y crée
 * son espace : le serveur le nomme dans cette langue et fait naître l'identité avec, donc ses e-mails. Lue AU CLIC par
 * `langue()` (`http.ts`), la règle de l'écran : `?lang=`, puis le choix mémorisé, puis la langue du navigateur.
 */
function api(): Array<{ url: string; corps: Record<string, unknown> }> {
  const appels: Array<{ url: string; corps: Record<string, unknown> }> = [];
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    appels.push({ url, corps: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return new Response(JSON.stringify({ token: 't', user: { email: 'a@x.fr', role: 'admin', tenantId: 't1' }, isNew: true }), {
      status: 201, headers: { 'content-type': 'application/json' },
    });
  }));
  return appels;
}

const fenetre = (o: { memorisee?: string; navigateur: string; recherche?: string }) => ({
  localStorage: { getItem: () => o.memorisee ?? null },
  location: { search: o.recherche ?? '' },
  navigator: { language: o.navigateur },
});

describe('loginWithGoogle', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('🔴 envoie la langue de l’écran : le navigateur sans choix, le choix mémorisé, puis le lien `?lang=`', async () => {
    const appels = api();
    vi.stubGlobal('window', fenetre({ navigateur: 'en-US' }));
    await loginWithGoogle('jeton-google');
    vi.stubGlobal('window', fenetre({ navigateur: 'en-US', memorisee: 'fr' }));
    await loginWithGoogle('jeton-google');
    vi.stubGlobal('window', fenetre({ navigateur: 'fr-FR', memorisee: 'fr', recherche: '?lang=en' }));
    await loginWithGoogle('jeton-google');
    expect(appels.map((a) => a.corps.langue)).toEqual(['en', 'fr', 'en']);
    expect(appels.every((a) => a.url.endsWith('/auth/google'))).toBe(true);
  });

  it('le jeton et l’accord coché voyagent avec elle, comme avant', async () => {
    const appels = api();
    vi.stubGlobal('window', fenetre({ navigateur: 'fr-FR' }));
    await loginWithGoogle('jeton-google', { accord: true });
    expect(appels[0]?.corps).toEqual({ idToken: 'jeton-google', langue: 'fr', pub: { accord: true } });
  });
});

/**
 * LE JETON DU DÉFI D'UN ESSAI DE MOT DE PASSE (lot E de l'audit de sécurité). Sans lui dans le corps, un titulaire dont
 * l'adresse a un filet plein reste devant le défi à chaque envoi : `login` et `loginOps` le joignent quand l'écran en a
 * un (`useDefiALaDemande`), et ne joignent rien sinon (la console face à une API d'avant le lot envoie le corps d'avant).
 */
describe('login et loginOps : le jeton du défi', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('🔴 joignent `turnstile` quand l’écran en a un, et rien sinon', async () => {
    const appels = api();
    vi.stubGlobal('window', fenetre({ navigateur: 'fr-FR' }));
    await login('a@b.co', 'pw');
    await login('a@b.co', 'pw', { turnstile: 'jeton-defi' });
    await loginOps('a@b.co', 'pw');
    await loginOps('a@b.co', 'pw', { turnstile: 'jeton-ops' });
    expect(appels.map((a) => a.corps)).toEqual([
      { email: 'a@b.co', password: 'pw' },
      { email: 'a@b.co', password: 'pw', turnstile: 'jeton-defi' },
      { email: 'a@b.co', password: 'pw', ops: true },
      { email: 'a@b.co', password: 'pw', ops: true, turnstile: 'jeton-ops' },
    ]);
    expect(appels.every((a) => a.url.endsWith('/auth/login'))).toBe(true);
  });
});
