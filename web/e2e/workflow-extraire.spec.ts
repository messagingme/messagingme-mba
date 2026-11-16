import { test, expect } from './aide/test';

/**
 * E2E builder : le bloc « Extraire du JSON » (plan docs/superpowers/plans/2026-11-11-champ-json-lot-2.md).
 *
 * Le panneau lit un champ JSON, et « Voir un exemple » rejoue l'Appel API du scénario qui range dans ce champ, avec ses
 * valeurs d'essai : un clic dans la réponse écrit le chemin de la ligne active, et la ligne montre ce qu'elle extrairait.
 * Backend intercepté, aucune base.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
const PANIER = JSON.stringify({ id: 1, products: [{ title: 'Blue Frock', price: 29.99 }, { title: 'iPhone 6', price: 299.99 }] });

async function ouvrirBuilder(page: import('@playwright/test').Page, opts: { sansAmont?: boolean } = {}) {
  const saved: Graph[] = [];
  const essais: string[] = [];
  const champs = [
    { key: 'panier', label: 'Panier', type: 'json' },
    { key: 'premier', label: 'Premier article', type: 'text' },
    { key: 'nb', label: 'Nombre d’articles', type: 'number' },
  ];
  const initial: Graph = {
    nodes: opts.sansAmont ? [] : [{ id: 'h', type: 'http', position: { x: 0, y: 0 }, data: { requestId: 'rq1', champCible: 'panier' } }],
    edges: [],
  };
  const wf = { id: 'wf1', name: 'Scenario E2E', graph: initial, createdAt: '', updatedAt: '' };

  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (req.method() === 'PATCH' && /\/workflows\/wf1$/.test(url)) {
      const body = (req.postDataJSON() ?? {}) as { graph?: Graph };
      if (body.graph) saved.push(body.graph);
      return json({ ok: true });
    }
    if (req.method() === 'POST' && /\/agent-requetes\/rq1\/test$/.test(url)) {
      essais.push(url);
      return json({ ok: true, httpStatus: 200, apercu: PANIER });
    }
    if (/\/agent-requetes/.test(url)) {
      return json({
        requetes: [{ id: 'rq1', label: 'Panier', methode: 'GET', chemin: '/carts/1', systeme: 'Démo' }], champs: [], catalogue: {},
      });
    }
    if (/\/workflows\/wf1$/.test(url)) return json({ workflow: wf });
    if (url.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: 'Scenario E2E', graph: initial }] });
    if (url.includes('/user-fields')) return json({ fields: champs });
    if (url.includes('/templates')) return json({ templates: [] });
    if (url.includes('/flows')) return json({ flows: [] });
    if (url.includes('/tags')) return json({ tags: [] });
    if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });

  await page.goto('/workflows?open=wf1');
  await page.getByTestId('add-node-extraire').click();
  return { saved, essais };
}

test.describe('Builder : le bloc Extraire du JSON', () => {
  test('🔴 l’exemple rejoue l’Appel API amont, un clic écrit le chemin, la ligne montre la valeur', async ({ page }) => {
    const { saved, essais } = await ouvrirBuilder(page);
    // La source ne propose que les champs JSON.
    await expect(page.getByTestId('extraire-source').locator('option[value="premier"]')).toHaveCount(0);
    await page.getByTestId('extraire-source').selectOption('panier');
    await page.getByTestId('extraire-ajouter').click();
    await page.getByTestId('extraire-cible-0').selectOption('premier');

    await page.getByTestId('extraire-exemple').click();
    await expect.poll(() => essais.length).toBe(1);
    await page.getByTestId('noeud-json').filter({ hasText: 'Blue Frock' }).getByRole('button', { name: /Attacher/ }).click();
    await expect(page.getByTestId('extraire-chemin-0')).toHaveValue('products[0].title');
    await expect(page.getByTestId('extraire-apercu-0')).toContainText('Blue Frock');

    // 🔴 Une LISTE s'attache aussi depuis l'arbre (Julien, 2026-11-16), et se compte d'office.
    await page.getByTestId('extraire-ajouter').click();
    await page.getByTestId('noeud-json').filter({ hasText: 'products' }).first().getByRole('button', { name: /Attacher/ }).click();
    await expect(page.getByTestId('extraire-chemin-1')).toHaveValue('products');
    await expect(page.getByTestId('extraire-mesure-1')).toHaveValue('nombre');
    await page.getByTestId('extraire-cible-1').selectOption('nb');
    await expect(page.getByTestId('extraire-apercu-1')).toContainText('2');

    await expect.poll(() => saved.some((g) => g.nodes.some((nd) => {
      const d = nd.data as { champSource?: unknown; lignes?: Array<{ chemin: string; mesure: string; champCible: string }> };
      return d.champSource === 'panier' && d.lignes?.length === 2 && d.lignes[0]?.chemin === 'products[0].title'
        && d.lignes[1]?.mesure === 'nombre' && d.lignes[1]?.champCible === 'nb';
    })), { timeout: 5000 }).toBe(true);
  });

  test('sans Appel API qui range dans la source, le panneau le dit et propose la saisie du chemin', async ({ page }) => {
    await ouvrirBuilder(page, { sansAmont: true });
    await page.getByTestId('extraire-source').selectOption('panier');
    await expect(page.getByTestId('extraire-sans-amont')).toBeVisible();
    await expect(page.getByTestId('extraire-exemple')).toHaveCount(0);
  });
});
