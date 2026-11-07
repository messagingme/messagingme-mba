import { test, expect } from './aide/test';

const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };

async function monterChamps(page: import('@playwright/test').Page, refuserModification: boolean, refuserRelecture = false) {
  let libelleServeur = 'Ville';
  let modifications = 0;
  let relectureApresRefus = false;

  await page.addInitScript((session) => window.localStorage.setItem('mba.session', JSON.stringify(session)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const requete = route.request();
    const chemin = new URL(requete.url()).pathname;
    const json = (corps: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corps) });

    if (chemin.endsWith('/user-fields') && requete.method() === 'GET') {
      if (relectureApresRefus) return json({ error: 'Liste indisponible' }, 503);
      return json({ fields: [{ key: 'ville', label: libelleServeur, type: 'text' }] });
    }
    if (chemin.endsWith('/user-fields/ville') && requete.method() === 'PATCH') {
      modifications++;
      if (refuserModification) {
        relectureApresRefus = refuserRelecture;
        return json({ error: 'Modification refusée par le serveur' }, 409);
      }
      libelleServeur = (requete.postDataJSON() as { label: string }).label;
      return json({ key: 'ville', label: libelleServeur, type: 'text' });
    }
    if (chemin.endsWith('/conversations/todo-count')) return json({ count: 0 });
    if (chemin.endsWith('/me')) return json({ email: SESSION.email, role: SESSION.role });
    return json({});
  });

  await page.goto('/fields');
  const libelle = page.locator('tbody tr').filter({ hasText: 'ville' }).locator('input');
  await expect(libelle).toHaveValue('Ville');
  return { libelle, modifications: () => modifications };
}

test('un enregistrement refusé restaure la valeur et explique le refus', async ({ page }) => {
  const { libelle, modifications } = await monterChamps(page, true);
  await libelle.fill('Nouvelle ville');
  await libelle.press('Tab');

  await expect.poll(modifications).toBe(1);
  await expect(libelle).toHaveValue('Ville');
  await expect(page.getByText('Modification refusée par le serveur')).toBeVisible();
});

test('un enregistrement accepté garde la nouvelle valeur', async ({ page }) => {
  const { libelle, modifications } = await monterChamps(page, false);
  await libelle.fill('Nouvelle ville');
  await libelle.press('Tab');

  await expect.poll(modifications).toBe(1);
  await expect(libelle).toHaveValue('Nouvelle ville');
  await expect(page.getByText('Modification refusée par le serveur')).toHaveCount(0);
});

test('un refus suivi d’une relecture impossible signale les deux problèmes', async ({ page }) => {
  const { libelle, modifications } = await monterChamps(page, true, true);
  await libelle.fill('Nouvelle ville');
  await libelle.press('Tab');

  await expect.poll(modifications).toBe(1);
  await expect(page.getByText(/Modification refusée par le serveur.*liste n’a pas pu être rechargée/)).toBeVisible();
});
