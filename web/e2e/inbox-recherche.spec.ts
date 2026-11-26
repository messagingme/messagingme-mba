import { test, expect } from './aide/test';

/**
 * LA LOUPE ET LES JOURS DE L'INBOX (demande de Julien, 2026-11-26).
 *
 * Les règles pures sont tenues par `tests/web-inbox-recherche.test.ts`, la route par `tests/http-inbox.test.ts`, la
 * requête par `tests/integration/inbox-recherche.integration.test.ts`. Reste l'ÉCRAN : la loupe part au serveur, la
 * liste ne montre que ce qui correspond tant que le champ n'est pas vidé, la croix rend tout, et un jour se replie.
 *
 * ⚠️ Le faux serveur IGNORE `?q=`, comme l'API d'avant ce lot : c'est le cas où l'écran doit filtrer lui-même, donc
 * celui qui prouve le plus. Que `q` parte bien est vérifié sur l'adresse appelée.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };

const aujourdhui = new Date();
const ilYA = (jours: number) => new Date(aujourdhui.getTime() - jours * 86_400_000).toISOString();

const convs = [
  { id: 'c-alice', waId: '33600000001', profileName: 'Alice Martin', lastPreview: 'bonjour', lastMessageAt: ilYA(0) },
  { id: 'c-bruno', waId: '33600000002', profileName: 'Bruno Petit', lastPreview: 'ma commande', lastMessageAt: ilYA(0) },
  { id: 'c-chloe', waId: '33611112222', profileName: 'Chloé Durand', lastPreview: 'merci', lastMessageAt: ilYA(3) },
].map((c) => ({ ...c, curseur: c.lastMessageAt, controlOwner: 'app_human', unread: false, urgente: false, traitee: false }));

async function monter(page: import('@playwright/test').Page, appels: string[]) {
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const url = route.request().url();
    appels.push(url);
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (/\/conversations\/counts/.test(url)) {
      return json({ tout: 3, aTraiter: 3, urgentes: 0, signalees: 0, archivees: 0, traitees: 0, nonAffectees: 3, parMembre: [] });
    }
    if (/\/conversations\?|\/conversations$/.test(url)) return json({ conversations: convs });
    if (url.includes('/unread-count')) return json({ count: 0 });
    if (url.endsWith('/me')) return json({ email: SESSION.email, name: 'Jean Test', role: 'admin' });
    return json({});
  });
  await page.goto('/inbox');
}

const lignes = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid^="inbox-ligne-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('inbox-ligne-', '')));

test('la loupe ne garde que ce qui correspond, la croix rend tout', async ({ page }) => {
  const appels: string[] = [];
  await monter(page, appels);
  await expect.poll(() => lignes(page)).toEqual(['c-alice', 'c-bruno', 'c-chloe']);

  await page.getByTestId('inbox-recherche').fill('+33 6 1111');
  await expect.poll(() => lignes(page)).toEqual(['c-chloe']);
  expect(appels.some((u) => new URL(u).searchParams.get('q') === '+33 6 1111')).toBe(true);

  await page.getByTestId('inbox-recherche').fill('zzz');
  await expect(page.getByText('Aucune conversation ne correspond à « zzz ».')).toBeVisible();

  await page.getByTestId('inbox-recherche-effacer').click();
  await expect(page.getByTestId('inbox-recherche')).toHaveValue('');
  await expect.poll(() => lignes(page)).toEqual(['c-alice', 'c-bruno', 'c-chloe']);
});

test('les conversations sont rangées par jour, et un jour se replie', async ({ page }) => {
  await monter(page, []);
  const jour = page.locator('[data-testid^="inbox-jour-"]');
  await expect(jour).toHaveCount(2);
  await expect(jour.first()).toHaveText(/Aujourd’hui/);
  await jour.first().click();
  await expect(jour.first()).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => lignes(page)).toEqual(['c-chloe']);
  await jour.first().click();
  await expect.poll(() => lignes(page)).toEqual(['c-alice', 'c-bruno', 'c-chloe']);
});
