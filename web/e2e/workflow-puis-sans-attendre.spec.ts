import { test, expect } from './aide/test';

/**
 * La sortie « Puis, sans attendre » d'un message rapide à boutons (Julien, 2026-11-10) : « à partir du moment où on met
 * un bouton de réponse rapide, on ne peut plus relier le node à un node suivant sauf par ses boutons ». Le moteur est tenu
 * par `tests/workflow-puis-sans-attendre.test.ts` ; ici, le geste réel sur le canevas : la sortie se relie sous SON nom,
 * elle n'existe que sur un message rapide à boutons, et le dernier bouton retiré emporte sa flèche.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

const message = (data: Record<string, unknown>) =>
  ({ id: 'n1', type: 'quick_message', position: { x: 0, y: 0 }, data: { wfType: 'quick_message', body: 'Merci pour votre aide', ...data } });
const suite = { id: 'n2', type: 'quick_message', position: { x: 420, y: 40 }, data: { wfType: 'quick_message', body: 'Bonne journée' } };

async function mockBuilder(page: import('@playwright/test').Page, graph: Graph, saved: Graph[]) {
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  const wf = { id: 'wf1', name: 'Scénario E2E', graph, createdAt: '', updatedAt: '' };
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (req.method() === 'PATCH' && /\/workflows\/wf1$/.test(url)) {
      const body = (req.postDataJSON() ?? {}) as { graph?: Graph };
      if (body.graph) saved.push(body.graph);
      return json({ ok: true });
    }
    if (/\/workflows\/wf1$/.test(url)) return json({ workflow: wf });
    if (url.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: 'Scénario E2E', graph }] });
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
}

const POIGNEE = '.react-flow__handle[data-handleid="ensuite"]';

test.describe('Scénario : la sortie « Puis, sans attendre » d’un message rapide', () => {
  test('🔴 elle se relie à un bloc, et l’arête s’enregistre sous la poignée « ensuite »', async ({ page }) => {
    const saved: Graph[] = [];
    await mockBuilder(page, { nodes: [message({ quickReplies: ['Main menu'] }), suite], edges: [] }, saved);
    await page.goto('/workflows?open=wf1');
    await expect(page.getByText('Puis, sans attendre')).toBeVisible();
    const depart = await page.locator(POIGNEE).boundingBox();
    const bloc = await page.locator('.react-flow__node').nth(1).boundingBox();
    await page.mouse.move(depart!.x + depart!.width / 2, depart!.y + depart!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bloc!.x + bloc!.width / 2, bloc!.y + bloc!.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect.poll(
      () => saved.some((g) => g.edges.some((e) => e.source === 'n1' && e.target === 'n2' && e.sourceHandle === 'ensuite')),
      { timeout: 10_000 },
    ).toBe(true);
  });

  test('elle n’existe ni sur un message sans bouton, ni sur un modèle à boutons', async ({ page }) => {
    const modele = { id: 'n3', type: 'template', position: { x: 0, y: 300 }, data: { wfType: 'template', templateName: 'promo', templateButtons: [{ type: 'QUICK_REPLY', text: 'Oui' }] } };
    await mockBuilder(page, { nodes: [message({}), modele], edges: [] }, []);
    await page.goto('/workflows?open=wf1');
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await expect(page.locator(POIGNEE)).toHaveCount(0);
  });

  test('🔴 retirer le dernier bouton emporte la flèche « Puis, sans attendre »', async ({ page }) => {
    // Sa poignée disparaît avec le dernier bouton : restée en base, la flèche serait invisible et le moteur la suivrait
    // comme la suite d'un message sans bouton.
    const saved: Graph[] = [];
    await mockBuilder(page, {
      nodes: [message({ quickReplies: ['Main menu'] }), suite],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'ensuite' }],
    }, saved);
    await page.goto('/workflows?open=wf1');
    await expect(page.locator(POIGNEE)).toHaveCount(1);
    await page.locator('.react-flow__node').first().click();
    await page.getByRole('button', { name: 'Retirer' }).click();
    await expect(page.locator(POIGNEE)).toHaveCount(0);
    await expect.poll(() => saved.length > 0 && !saved[saved.length - 1]!.edges.some((e) => e.sourceHandle === 'ensuite'), { timeout: 10_000 }).toBe(true);
  });
});
