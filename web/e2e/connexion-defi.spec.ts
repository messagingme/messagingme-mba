import { test, expect, type Page } from './aide/test';

/**
 * LE DÉFI À LA DEMANDE ET LES REFUS DU MOT DE PASSE OUBLIÉ (lot E de l'audit de sécurité, 2026-11-16).
 *
 * Après beaucoup d'essais sur une adresse, tous réseaux confondus, l'API refuse l'essai suivant en 403 `code: 'defi'`
 * tant qu'il ne porte pas le jeton du défi anti-robot (`compterEssai`, `src/auth/tentatives.ts`). La console le dit avec
 * son propre message, traduit, et garde le formulaire.
 * ⚠️ Le build des e2e n'a pas de clé du site Turnstile : le widget ne peut pas s'afficher, et c'est le cas « clé
 * absente » qui s'éprouve ici (le message donne les deux sorties, le bouton reste actif). Le widget lui-même s'éprouve
 * sur l'essai réel du lot.
 */
async function backend(page: Page, chemin: string, reponse: { status: number; body: unknown; entetes?: Record<string, string> }): Promise<unknown[]> {
  const corps: unknown[] = [];
  await page.route('**/api/backend/**', async (route) => {
    const url = route.request().url().split('?')[0]!;
    if (url.endsWith(chemin)) {
      corps.push(route.request().postDataJSON());
      // Comme la vraie API (`exposedHeaders`, `src/server.ts`) : en topologie Vercel, la console appelle l'API d'une
      // autre origine, et le navigateur masquerait `retry-after` si la réponse ne l'exposait pas.
      const headers = { ...reponse.entetes, 'access-control-expose-headers': 'retry-after' };
      return route.fulfill({ status: reponse.status, contentType: 'application/json', headers, body: JSON.stringify(reponse.body) });
    }
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.endsWith('/auth/config')) return json({ googleClientId: '', googleEnabled: false });
    return json({});
  });
  return corps;
}

test.describe('Connexion : le défi anti-robot à la demande', () => {
  test('🔴 un refus « defi » affiche le message du défi, n’ouvre aucune session, et l’envoi suivant reste possible', async ({ page }) => {
    const corps = await backend(page, '/auth/login', { status: 403, body: { error: 'message du serveur, jamais affiché tel quel', code: 'defi' } });
    await page.goto('/login');
    await page.getByLabel('Email').fill('a@b.co');
    await page.locator('input[type="password"]').fill('motdepasse');
    const bouton = page.getByRole('button', { name: /Se connecter|Sign in/ });
    await bouton.click();

    await expect(page.getByText(/vérification anti-robot n’est pas disponible ici|anti-bot check is not available here/)).toBeVisible();
    await expect(page.getByText('message du serveur, jamais affiché tel quel')).toHaveCount(0);
    expect(page.url()).toContain('/login');
    // Sans clé du site, aucun jeton : le bouton reste actif, et l'envoi suivant part sans `turnstile`.
    await expect(bouton).toBeEnabled();
    await bouton.click();
    await expect.poll(() => corps.length).toBe(2);
    expect(corps[1]).toEqual({ email: 'a@b.co', password: 'motdepasse' });
  });
});

test.describe('Mot de passe oublié : le refus se dit', () => {
  test('🔴 le refus du jour dit les liens déjà partis et l’heure où une demande redevient possible, sans annoncer d’envoi', async ({ page }) => {
    await backend(page, '/auth/forgot-password', { status: 429, body: { error: 'message du serveur' }, entetes: { 'retry-after': '7200' } });
    await page.goto('/forgot');
    await page.locator('input[type="email"]').fill('a@b.co');
    await page.getByRole('button', { name: /Envoyer le lien|Send the link/ }).click();
    const refus = page.getByTestId('forgot-erreur');
    await expect(refus).toContainText(/Plusieurs liens de réinitialisation sont déjà partis vers cette adresse aujourd’hui|Several reset links have already been sent/);
    await expect(refus).toContainText(/Nouvelle demande possible à partir de \d{2}:\d{2}|A new request is possible from \d{1,2}:\d{2}/);
    await expect(page.getByText(/un lien de réinitialisation vient d’être envoyé|a reset link has just been sent/)).toHaveCount(0);
  });

  test('un refus court (le réseau, une base muette) dit de réessayer dans une minute, au vouvoiement', async ({ page }) => {
    await backend(page, '/auth/forgot-password', { status: 429, body: { error: 'trop de tentatives, réessaie plus tard' }, entetes: { 'retry-after': '30' } });
    await page.goto('/forgot');
    await page.locator('input[type="email"]').fill('a@b.co');
    await page.getByRole('button', { name: /Envoyer le lien|Send the link/ }).click();
    await expect(page.getByTestId('forgot-erreur')).toContainText(/Trop de demandes en ce moment : réessayez dans une minute|Too many requests right now/);
    await expect(page.getByText('trop de tentatives, réessaie plus tard')).toHaveCount(0);
  });

  test('toute autre erreur garde le message générique : rien ne dit si le compte existe', async ({ page }) => {
    await backend(page, '/auth/forgot-password', { status: 500, body: { error: 'panne' } });
    await page.goto('/forgot');
    await page.locator('input[type="email"]').fill('a@b.co');
    await page.getByRole('button', { name: /Envoyer le lien|Send the link/ }).click();
    await expect(page.getByText(/un lien de réinitialisation vient d’être envoyé|a reset link has just been sent/)).toBeVisible();
    await expect(page.getByTestId('forgot-erreur')).toHaveCount(0);
  });
});
