import { test, expect, type Page } from './aide/test';

/**
 * LA FENÊTRE AU DÉPART, DITE À L'ÉCRAN (menu « Scénario », lot 2, décisions 11, 16 et 17) : prévenir, jamais refuser.
 *
 * Ce que seul un test de bout en bout peut voir :
 *  - le builder lit les départs que rend `GET /workflows/:id` et dit, par un bandeau, le message de session qu'un départ
 *    FERMÉ atteindrait sans réponse du client, avec le nom du bloc ; le panneau de ce bloc le redit ;
 *  - sans départ (une API d'avant ce lot) ou depuis un départ ouvert, rien n'est dit ;
 *  - l'écran Automation montre, sous une automation et dans son formulaire, l'avertissement que la liste lui donne.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
type Depart = { noeudId: string | null; fenetre: 'ouverte' | 'fermee'; raison: string };

/** Un template à délai, puis un message rapide sur la sortie « Pas de réponse » : ce message part sans réponse. */
const RELANCE: Graph = {
  nodes: [
    { id: 'n1', type: 'template', position: { x: 0, y: 0 }, data: { wfType: 'template', templateName: 'panier', language: 'fr', templateButtons: [], timeoutValue: 30, timeoutUnit: 'minutes' } },
    { id: 'n2', type: 'quick_message', position: { x: 360, y: 0 }, data: { wfType: 'quick_message', name: 'Relance', body: 'Toujours là ?' } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'timeout' }],
};

async function monterBuilder(page: Page, departs: Depart[] | undefined): Promise<void> {
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  const wf = { id: 'wf1', name: 'Panier abandonné', graph: RELANCE, createdAt: '', updatedAt: '' };
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (req.method() === 'PATCH' && /\/workflows\/wf1$/.test(url)) return json({ ok: true });
    if (/\/workflows\/wf1$/.test(url)) return json(departs === undefined ? { workflow: wf } : { workflow: wf, departs });
    if (url.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: 'Panier abandonné', graph: RELANCE }] });
    if (url.includes('/email/accounts')) return json({ accounts: [] });
    if (url.includes('/email/templates')) return json({ templates: [] });
    if (url.includes('/templates')) return json({ templates: [] });
    if (url.includes('/flows')) return json({ flows: [] });
    if (url.includes('/tags')) return json({ tags: [] });
    if (url.includes('/user-fields/usage')) return json({ total: 0, parChamp: {} });
    if (url.includes('/user-fields')) return json({ fields: [] });
    if (url.includes('/settings')) return json({ mbaEnabled: false, rcsEnabled: false, hubspotListsEnabled: false, campaignsPaused: false });
    if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });
  await page.goto('/workflows?open=wf1');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
}

test.describe('La fenêtre au départ, dite à l’écran', () => {
  test('🔴 un départ FERMÉ : le bandeau nomme le message qui partirait sans réponse, et son panneau le redit', async ({ page }) => {
    await monterBuilder(page, [{ noeudId: null, fenetre: 'fermee', raison: 'un événement Shopify' }]);
    const bandeau = page.getByTestId('alerte-fenetre');
    await expect(bandeau).toHaveCount(1);
    await expect(bandeau).toContainText('« Relance »');
    await expect(bandeau).toContainText('un événement Shopify');
    await page.locator('.react-flow__node').filter({ hasText: 'Relance' }).click();
    await expect(page.getByTestId('panneau-alerte-fenetre')).toContainText('template');
  });

  test('un départ ouvert, ou une API qui ne rend pas les départs : rien n’est dit', async ({ page }) => {
    await monterBuilder(page, undefined);
    await expect(page.getByTestId('alerte-fenetre')).toHaveCount(0);
  });

  test('🔴 l’écran Automation montre l’avertissement sous l’automation et dans son formulaire', async ({ page }) => {
    await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
    const phrase = 'Ce déclencheur lance le scénario sans que le client ait écrit : le bloc « Relance » partirait hors de la fenêtre de 24 h et Meta le refuserait. Faites-le précéder d’un template.';
    const automation = {
      id: 'a1', name: 'Anniversaire', enabled: true, triggerKind: 'avant_date', triggerConfig: { champ: 'anniversaire', jours: 0 },
      conditionGroup: null, workflowId: 'wf1', startNodeId: null, cooldownSeconds: null, accordMarketing: null, avertissementFenetre: phrase,
    };
    await page.route('**/api/backend/**', async (route) => {
      const url = route.request().url();
      const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (url.endsWith('/automations')) return json({ automations: [automation] });
      if (url.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: 'Panier abandonné', graph: RELANCE }] });
      if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
      return json({});
    });
    await page.goto('/automations');
    await expect(page.getByTestId('automation-fenetre-a1')).toHaveText(phrase);
    await page.getByTestId('automation-modifier-a1').click();
    await expect(page.getByTestId('automation-form-fenetre')).toHaveText(phrase);
  });
});
