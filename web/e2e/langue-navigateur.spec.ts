import { test, expect, type Page } from './aide/test';

/**
 * LA CONSOLE DANS LA LANGUE DU NAVIGATEUR (aide à la connexion, lot 2, décision de Julien du 2026-11-08). Une personne
 * qui autorisait Claude depuis un poste anglais voyait l'écran d'autorisation en français : il s'ouvre désormais en
 * français si le navigateur est en français, en anglais pour toute autre langue. Un lien `?lang=` et un choix mémorisé
 * l'emportent sur le navigateur, et la langue du navigateur n'est JAMAIS mémorisée (la règle : `langueInitiale`,
 * `lib/locale.ts`). La page de choix : `/autoriser` sans demande, qui s'affiche sans aucun appel à l'API.
 */
const FR = 'Relancez la connexion depuis votre application';
const EN = 'Start the connection again from your application';

async function ouvrir(page: Page, adresse = '/autoriser'): Promise<void> {
  await page.route('**/api/backend/**', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.goto(adresse);
}
const memorisee = (page: Page): Promise<string | null> => page.evaluate(() => window.localStorage.getItem('mba_locale'));

test.describe('un navigateur en anglais', () => {
  test.use({ locale: 'en-US' });

  test('🔴 l’écran d’autorisation s’ouvre en anglais, le document se déclare anglais, et rien n’est mémorisé', async ({ page }) => {
    await ouvrir(page);
    await expect(page.getByTestId('autoriser-absente')).toContainText(EN);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await memorisee(page)).toBeNull();
  });

  test('un choix mémorisé en français l’emporte sur le navigateur', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('mba_locale', 'fr'));
    await ouvrir(page);
    await expect(page.getByTestId('autoriser-absente')).toContainText(FR);
  });

  test('un lien `?lang=fr` l’emporte aussi, devient le choix mémorisé, puis quitte l’adresse', async ({ page }) => {
    await ouvrir(page, '/autoriser?lang=fr');
    await expect(page.getByTestId('autoriser-absente')).toContainText(FR);
    expect(await memorisee(page)).toBe('fr');
    // Resté dans l'adresse, il contredirait une bascule ultérieure (jaune A2 de la relecture du lot 2).
    await expect(page).toHaveURL(/\/autoriser$/);
    // Et le français tient au rechargement, porté par le choix mémorisé.
    await page.reload();
    await expect(page.getByTestId('autoriser-absente')).toContainText(FR);
  });
});

test.describe('un navigateur dans une autre langue que le français', () => {
  test.use({ locale: 'de-DE' });

  test('l’anglais', async ({ page }) => {
    await ouvrir(page);
    await expect(page.getByTestId('autoriser-absente')).toContainText(EN);
  });
});

test.describe('un navigateur en français (celui de la configuration)', () => {
  test('le français, et rien n’est mémorisé', async ({ page }) => {
    await ouvrir(page);
    await expect(page.getByTestId('autoriser-absente')).toContainText(FR);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    expect(await memorisee(page)).toBeNull();
  });
});
