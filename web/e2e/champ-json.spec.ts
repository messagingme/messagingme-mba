import { test, expect } from './aide/test';
import { TREIZE_POUCES } from './aide/largeur';

/**
 * LE CHAMP JSON DANS LA CONSOLE (spec docs/superpowers/specs/2026-11-11-champ-json-appel-api-design.md).
 *
 * Il se crée dans l'écran Champs, son type ne se change plus ensuite, et la fiche le montre en LECTURE SEULE : il se
 * remplit par le bloc « Appel API » d'un scénario, l'API ou le MCP, jamais par une saisie.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
const CHAMPS = [
  { key: 'ville', label: 'Ville', type: 'text' },
  { key: 'reponse_api', label: 'Réponse API', type: 'json' },
];
const REPONSE = '{"statut":"expédiée","lignes":[{"id":1}]}';
const CONTACT = {
  id: '5f0c1b2e-7d4a-4c8e-9b1a-2f3e4d5c6b7a', profileName: 'Camille Json', phoneE164: '+33600000021', externalId: null,
  bsuid: null, optInStatus: 'opted_in', tags: [], fields: { reponse_api: REPONSE }, createdAt: '2026-01-01T00:00:00Z',
  whatsappJoignable: null, whatsappJoignableLe: null,
};

async function monter(page: import('@playwright/test').Page): Promise<{ crees: Array<{ label: string; type: string }> }> {
  const crees: Array<{ label: string; type: string }> = [];
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const requete = route.request();
    const chemin = new URL(requete.url()).pathname;
    const json = (corps: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corps) });
    if (chemin.endsWith('/user-fields') && requete.method() === 'POST') {
      const corps = requete.postDataJSON() as { label: string; type: string };
      crees.push(corps);
      return json({ key: 'nouveau', label: corps.label, type: corps.type }, 201);
    }
    if (chemin.endsWith('/user-fields')) return json({ fields: CHAMPS });
    if (chemin.endsWith('/contacts')) return json({ contacts: [CONTACT], total: 1 });
    if (chemin.endsWith('/conversations/todo-count')) return json({ count: 0 });
    if (chemin.endsWith('/tags')) return json({ tags: [] });
    if (chemin.endsWith('/me')) return json({ email: SESSION.email, name: 'Jean Test', role: SESSION.role });
    return json({});
  });
  return { crees };
}

test.describe('le champ JSON dans la console', () => {
  test.use({ viewport: TREIZE_POUCES });

  test('🔴 il se crée dans l’écran Champs, puis son type ne se change plus', async ({ page }) => {
    const { crees } = await monter(page);
    await page.goto('/fields');
    // Le champ JSON existant : son type est un libellé, pas un menu.
    const ligneJson = page.locator('tbody tr').filter({ hasText: 'reponse_api' });
    await expect(ligneJson.getByTestId('champ-type-json')).toBeVisible();
    await expect(ligneJson.locator('select')).toHaveCount(0);
    // Un champ texte ne peut pas DEVENIR JSON : son menu ne le propose pas.
    const ligneTexte = page.locator('tbody tr').filter({ hasText: 'ville' });
    await expect(ligneTexte.locator('select option[value="json"]')).toHaveCount(0);
    // À la création, le type JSON est proposé.
    await page.getByPlaceholder('Libellé du nouveau champ (ex. Code postal)…').fill('Réponse commande');
    await page.locator('select').filter({ has: page.locator('option[value="json"]') }).last().selectOption('json');
    await page.getByRole('button', { name: 'Créer un champ' }).click();
    await expect.poll(() => crees).toEqual([{ label: 'Réponse commande', type: 'json' }]);
  });

  test('🔴 la fiche le montre en lecture seule, mis en forme, et ne le propose pas à l’ajout', async ({ page }) => {
    await monter(page);
    await page.goto('/contacts');
    await page.getByText('Camille Json').first().click();
    const bloc = page.getByTestId('fiche-bloc-champs');
    const valeur = bloc.getByTestId('champ-json');
    await expect(valeur).toBeVisible();
    await expect(bloc.getByTestId('champ-modifier')).toHaveCount(0);
    await valeur.locator('summary').click();
    await expect(valeur.locator('pre')).toContainText('"statut": "expédiée"');
    // « Ajouter un champ existant » propose Ville, jamais le champ JSON.
    const ajout = bloc.locator('select').filter({ hasText: 'Ajouter un champ existant…' });
    await expect(ajout.locator('option[value="ville"]')).toHaveCount(1);
    await expect(ajout.locator('option[value="reponse_api"]')).toHaveCount(0);
  });
});
