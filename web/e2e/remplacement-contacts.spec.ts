import { test, expect, type Page } from './aide/test';
import { repondre } from './aide/confirmation';

/**
 * « LE PLUS ANCIEN LAISSE SA PLACE » DANS LA CONSOLE (décision de Julien du 2026-11-24, lot 2). Dans Paramètres, la case
 * n'existe qu'en Business et en Entreprise ; la cocher passe par une confirmation qui dit l'irréversible, la décocher non.
 * L'aperçu d'un import CSV dit combien des plus anciens seront effacés, avant le bouton qui importe.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };

async function monter(page: Page, o: { possible: boolean; actif?: boolean; apercu?: unknown }) {
  const patches: unknown[] = [];
  let actif = o.actif ?? false;
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname.replace('/api/backend', '');
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin === '/tenants/t-e2e/settings/contacts-remplacer-anciens') {
      if (req.method() === 'PATCH') {
        patches.push(req.postDataJSON());
        actif = (req.postDataJSON() as { actif: boolean }).actif;
        return json({ actif });
      }
      return json({ actif, possible: o.possible });
    }
    if (chemin === '/tenants/t-e2e/settings') return json({ mbaEnabled: false, autoRetryEnabled: false, timezone: 'Europe/Paris', businessHours: {} });
    if (chemin === '/tenants/t-e2e/settings/agents-peuvent-prendre') return json({ actif: false });
    if (chemin === '/tenants/t-e2e/contacts/blocked') return json({ contacts: [] });
    if (chemin === '/tenants/t-e2e/contacts/import/preview') return json(o.apercu ?? {});
    if (chemin === '/tenants/t-e2e/contacts') return json({ contacts: [], total: 0 });
    if (chemin.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Moi', role: 'admin' });
    return json({});
  });
  return { patches };
}

test.describe('🔴 Paramètres : le plus ancien laisse sa place', () => {
  test('un Business : la cocher demande une confirmation qui dit l’irréversible ; annulée, rien ne part', async ({ page }) => {
    const { patches } = await monter(page, { possible: true });
    await page.goto('/parametres');
    const toggle = page.getByTestId('param-remplacement-contacts-toggle');
    await toggle.click();
    await repondre(page, false, 'Irréversible');
    expect(patches).toEqual([]);
    await toggle.click();
    await repondre(page, true, 'Aucun contact n’est protégé');
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toEqual({ actif: true });
  });

  test('la décocher se fait sans confirmation', async ({ page }) => {
    const { patches } = await monter(page, { possible: true, actif: true });
    await page.goto('/parametres');
    await page.getByTestId('param-remplacement-contacts-toggle').click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toEqual({ actif: false });
    await expect(page.getByTestId('confirmation')).toHaveCount(0);
  });

  test('🔴 un Pro ou une Free : la section n’existe pas', async ({ page }) => {
    await monter(page, { possible: false });
    await page.goto('/parametres');
    await expect(page.getByTestId('param-prise-agents')).toBeVisible();
    await expect(page.getByTestId('param-remplacement-contacts')).toHaveCount(0);
  });
});

test.describe('🔴 l’aperçu d’un import CSV annonce les effacements', () => {
  const APERCU = {
    headers: ['Nom', 'Téléphone'], sampleRows: [{ Nom: 'Léa', Téléphone: '+33639980101' }], rowCount: 3,
    mapping: { columns: { Nom: { target: 'name' }, Téléphone: { target: 'phone' } } },
  };

  test('espace plein, option cochée : « effacera définitivement 2 de vos contacts les plus anciens »', async ({ page }) => {
    await monter(page, { possible: true, apercu: { ...APERCU, remplacement: { nouveaux: 3, placesLibres: 1 } } });
    await page.goto('/contacts');
    await page.getByTestId('contacts-ajouter-menu').click();
    await page.getByTestId('contact-importer-csv').click();
    await page.getByText(/coller le texte/i).click();
    await page.locator('textarea').first().fill('Nom,Téléphone\nLéa,+33639980101\nHugo,+33639980102\nInès,+33639980103');
    await page.getByRole('button', { name: /Analyser/ }).click();
    await expect(page.getByTestId('import-effacements')).toContainText('effacera définitivement 2 de vos contacts les plus anciens');
  });

  test('sans l’option (aucune clé dans l’aperçu) : aucune annonce', async ({ page }) => {
    await monter(page, { possible: false, apercu: APERCU });
    await page.goto('/contacts');
    await page.getByTestId('contacts-ajouter-menu').click();
    await page.getByTestId('contact-importer-csv').click();
    await page.getByText(/coller le texte/i).click();
    await page.locator('textarea').first().fill('Nom,Téléphone\nLéa,+33639980101');
    await page.getByRole('button', { name: /Analyser/ }).click();
    await expect(page.getByText('Léa').first()).toBeVisible();
    await expect(page.getByTestId('import-effacements')).toHaveCount(0);
  });
});
