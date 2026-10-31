import { test, expect, type Page } from './aide/test';

/**
 * L'ACCORD PUBLICITAIRE (pixel Meta, lot 3 du plan docs/superpowers/plans/2026-10-30-pixel-meta.md).
 *
 * 🔴 CE QUE CES TESTS TIENNENT : la case est DÉCOCHÉE au chargement de `/signup` et de `/autoriser` ; sans elle, aucun
 * corps de création ne porte `pub` ; cochée, les trois entrées (e-mail, Google, Google du plugin) le portent, avec les
 * identifiants de Meta venus de la vitrine ; « Mon compte » accorde et retire. Ce que le serveur en fait (aucun envoi
 * sans accord, pas de rattrapage) est dans `tests/auth-signup-reset.test.ts`, `tests/auth-google.test.ts`,
 * `tests/http-oauth.test.ts` et `tests/pub-conversions-meta.test.ts`.
 */

type Appel = { chemin: string; methode: string; corps: Record<string, unknown> | null };
type Reponse = { status?: number; body: unknown };

const SESSION = { token: 'jeton-console', email: 'a@b.co', role: 'admin', tenantId: 't1' };
const FBC = 'fb.1.1793300000000.essai';
const FBP = 'fb.1.1793300000000.42';

async function monter(page: Page, repondeur: (chemin: string, methode: string) => Reponse | undefined, session?: Record<string, unknown>): Promise<Appel[]> {
  const appels: Appel[] = [];
  if (session) await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), session);
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname.replace('/api/backend', '');
    appels.push({ chemin, methode: req.method(), corps: req.postData() ? (req.postDataJSON() as Record<string, unknown>) : null });
    const r = repondeur(chemin, req.method())
      ?? (chemin === '/auth/config' ? { body: { googleClientId: 'client-e2e', googleEnabled: true } } : { body: {} });
    return route.fulfill({ status: r.status ?? 200, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  // Google Identity Services, simulé comme dans `e2e/autoriser.spec.ts` : un bouton qui rend un jeton d'identité.
  await page.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.google = { accounts: { id: {
      initialize: function (cfg) { window.__rappelGoogle = cfg.callback; },
      renderButton: function (el) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Google (simulé)';
        b.setAttribute('data-testid', 'google-simule');
        b.onclick = function () { window.__rappelGoogle({ credential: 'jeton-google-e2e' }); };
        el.appendChild(b);
      },
    } } };`,
  }));
  return appels;
}

const corpsDe = (appels: Appel[], chemin: string): Record<string, unknown> | null => appels.find((a) => a.chemin === chemin)?.corps ?? null;
const caseMeta = (page: Page) => page.getByTestId('case-partage-meta').locator('input[type="checkbox"]');

async function remplirInscription(page: Page): Promise<void> {
  await page.getByPlaceholder(/Mon entreprise|My company/).fill('Mon espace');
  await page.locator('input[type="email"]').fill('a@b.co');
  await page.locator('input[type="password"]').fill('motdepasse-long');
}

test.describe('L’accord publicitaire à l’inscription', () => {
  test('🔴 /signup : la case est décochée, et sans elle le corps ne porte aucun accord', async ({ page }) => {
    const appels = await monter(page, (chemin) => (chemin === '/auth/signup' ? { status: 201, body: SESSION } : undefined));
    await page.goto(`/signup?fbc=${FBC}&fbp=${FBP}`);
    await expect(caseMeta(page)).not.toBeChecked();
    await remplirInscription(page);
    await page.getByRole('button', { name: /Créer mon espace|Create my workspace/ }).click();
    await expect.poll(() => corpsDe(appels, '/auth/signup')).not.toBeNull();
    expect(corpsDe(appels, '/auth/signup')).not.toHaveProperty('pub');
  });

  test('🔴 /signup, case cochée : l’accord part avec les identifiants de Meta venus de la vitrine', async ({ page }) => {
    const appels = await monter(page, (chemin) => (chemin === '/auth/signup' ? { status: 201, body: SESSION } : undefined));
    await page.goto(`/signup?fbc=${FBC}&fbp=${FBP}`);
    await remplirInscription(page);
    await caseMeta(page).check();
    await page.getByRole('button', { name: /Créer mon espace|Create my workspace/ }).click();
    await expect.poll(() => corpsDe(appels, '/auth/signup')).not.toBeNull();
    expect(corpsDe(appels, '/auth/signup')?.pub).toEqual({ accord: true, fbc: FBC, fbp: FBP });
  });

  test('/signup par Google : la case cochée part avec le jeton (décochée : `champPub(false)`, `lib/pub.test.ts`)', async ({ page }) => {
    const appels = await monter(page, (chemin) => (chemin === '/auth/google' ? { status: 201, body: { ...SESSION, user: { email: 'a@b.co', role: 'admin', tenantId: 't1' }, isNew: true } } : undefined));
    await page.goto('/signup');
    await caseMeta(page).check();
    await page.getByTestId('google-simule').click();
    await expect.poll(() => corpsDe(appels, '/auth/google')).not.toBeNull();
    expect(corpsDe(appels, '/auth/google')).toEqual({ idToken: 'jeton-google-e2e', pub: { accord: true } });
  });

  test('🔴 /autoriser : la case est décochée ; cochée, l’accord part avec l’entrée Google du plugin', async ({ page }) => {
    const appels = await monter(page, (chemin) => {
      if (chemin === '/oauth/consentement/demande') return { body: { client: 'Claude Code', marque: 'epingle', domaine: null, hoteDeRetour: 'localhost', droits: ['mcp:read', 'mcp:write'] } };
      if (chemin === '/oauth/consentement/google') return { body: { choix: 'preuve', nouveau: true, espaces: [{ tenantId: 't1', nom: 'Espace', admin: true }] } };
      return undefined;
    });
    await page.goto('/autoriser?demande=d-e2e');
    await expect(caseMeta(page)).not.toBeChecked();
    await caseMeta(page).check();
    await page.getByTestId('google-simule').click();
    await expect.poll(() => corpsDe(appels, '/oauth/consentement/google')).not.toBeNull();
    expect(corpsDe(appels, '/oauth/consentement/google')).toEqual({ demande: 'd-e2e', idToken: 'jeton-google-e2e', pub: { accord: true } });
  });
});

test.describe('L’accord publicitaire dans « Mon compte »', () => {
  test('🔴 accorder puis retirer, aussi simplement l’un que l’autre', async ({ page }) => {
    let accord = false;
    const appels = await monter(page, (chemin, methode) => {
      if (chemin === '/tenants/t1/moi/partage-meta') {
        if (methode === 'PUT') accord = !accord;
        return { body: { accord, depuis: accord ? '2026-11-02T10:00:00.000Z' : null } };
      }
      return undefined;
    }, SESSION);
    await page.goto('/compte');
    const interrupteur = page.getByTestId('partage-meta');
    await expect(interrupteur).not.toBeChecked();
    // La case suit la RÉPONSE du serveur (comme les préférences d'e-mails) : un clic, puis l'état attendu.
    await interrupteur.click();
    await expect(interrupteur).toBeChecked();
    await expect(page.getByTestId('partage-meta-bloc')).toContainText(/Accordé le|Granted on/);
    await interrupteur.click();
    await expect(interrupteur).not.toBeChecked();
    await expect(page.getByTestId('partage-meta-bloc')).toContainText(/Rien n’est partagé|Nothing is shared/);
    expect(appels.filter((a) => a.chemin === '/tenants/t1/moi/partage-meta' && a.methode === 'PUT').map((a) => a.corps))
      .toEqual([{ accord: true }, { accord: false }]);
  });
});
