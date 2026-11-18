import { test, expect } from './aide/test';

/**
 * La sortie « Pas de réponse » du bloc TEMPLATE (menu « Scénario », lot 2, spec décision 12) : « Si le contact ne répond
 * pas », comme sur la Question.
 *
 * Ce que seul un test de bout en bout peut voir :
 *  - la rangée « Pas de réponse » n'apparaît sur le bloc QUE si un délai est posé, avec ou sans boutons : sans délai elle
 *    ne partirait jamais, l'afficher promettrait une branche morte ;
 *  - repasser le délai à 0 retire la flèche « Pas de réponse » du graphe enregistré, template ET Question : sa poignée
 *    disparaît, l'arête ne doit pas rester en base, invisible.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

const bloc = (data: Record<string, unknown>) => ({ id: 'n1', type: 'template', position: { x: 0, y: 0 }, data: { wfType: 'template', templateName: 'relance_panier', language: 'fr', ...data } });
const suite = { id: 'n2', type: 'tag', position: { x: 360, y: 0 }, data: { wfType: 'tag', tag: 'relance' } };

/** Un template à un bouton, sans délai : le cas de départ. */
const A_BOUTON: Graph = { nodes: [bloc({ templateButtons: [{ type: 'QUICK_REPLY', text: 'Je finalise' }] }), suite], edges: [] };
/** Un template sans bouton, sans délai. */
const SANS_BOUTON: Graph = { nodes: [bloc({ templateButtons: [] }), suite], edges: [] };
/** Un template à délai, sa flèche « Pas de réponse » tirée. */
const A_DELAI: Graph = {
  nodes: [bloc({ templateButtons: [{ type: 'QUICK_REPLY', text: 'Je finalise' }], timeoutValue: 30, timeoutUnit: 'minutes' }), suite],
  edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'timeout' }],
};
/** Une Question à délai, sa flèche « Pas de réponse » tirée. */
const QUESTION_A_DELAI: Graph = {
  nodes: [
    { id: 'n1', type: 'question', position: { x: 0, y: 0 }, data: { wfType: 'question', body: 'Ça vous convient ?', rows: [{ title: 'Oui' }], timeoutValue: 2, timeoutUnit: 'hours' } },
    suite,
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'timeout' }],
};

async function mockBuilder(page: import('@playwright/test').Page, graph: Graph, saved: Graph[] = []) {
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

/** Le dernier graphe enregistré a-t-il encore une flèche « Pas de réponse » partant de n1, et quel délai porte n1 ? */
const dernier = (saved: Graph[]) => {
  const g = saved.at(-1);
  if (!g) return null;
  const n1 = g.nodes.find((x) => x.id === 'n1') as { data?: { timeoutValue?: number } } | undefined;
  return { delai: n1?.data?.timeoutValue, fleche: g.edges.some((e) => e.source === 'n1' && e.sourceHandle === 'timeout') };
};

test.describe('Éditeur : la sortie « Pas de réponse » du bloc template', () => {
  test('🔴 n’apparaît sur un template à bouton QUE si un délai est posé', async ({ page }) => {
    await mockBuilder(page, A_BOUTON);
    await page.goto('/workflows?open=wf1');
    const n1 = page.locator('.react-flow__node').first();
    await expect(n1).toContainText('Je finalise');
    await expect(n1).not.toContainText('Pas de réponse');

    await n1.click();
    await page.getByTestId('template-node-timeout').fill('30');
    await page.getByTestId('template-node-timeout-unit').selectOption('minutes');
    await expect(n1).toContainText('Pas de réponse');
  });

  test('apparaît aussi sur un template sans bouton, dès qu’un délai est posé', async ({ page }) => {
    await mockBuilder(page, SANS_BOUTON);
    await page.goto('/workflows?open=wf1');
    const n1 = page.locator('.react-flow__node').first();
    await expect(n1).not.toContainText('Pas de réponse');
    await n1.click();
    await page.getByTestId('template-node-timeout').fill('2');
    await expect(n1).toContainText('Pas de réponse');
  });

  test('🔴 repasser le délai à 0 retire la flèche « Pas de réponse » du graphe enregistré', async ({ page }) => {
    const saved: Graph[] = [];
    await mockBuilder(page, A_DELAI, saved);
    await page.goto('/workflows?open=wf1');
    const n1 = page.locator('.react-flow__node').first();
    await expect(n1).toContainText('Pas de réponse');
    await n1.click();
    await page.getByTestId('template-node-timeout').fill('0');
    await expect(n1).not.toContainText('Pas de réponse');
    await expect.poll(() => dernier(saved), { timeout: 10_000 }).toEqual({ delai: 0, fleche: false });
  });

  test('🔴 la même règle vaut pour la Question', async ({ page }) => {
    const saved: Graph[] = [];
    await mockBuilder(page, QUESTION_A_DELAI, saved);
    await page.goto('/workflows?open=wf1');
    const n1 = page.locator('.react-flow__node').first();
    await expect(n1).toContainText('Pas de réponse');
    await n1.click();
    await page.getByTestId('question-node-timeout').fill('0');
    await expect(n1).not.toContainText('Pas de réponse');
    await expect.poll(() => dernier(saved), { timeout: 10_000 }).toEqual({ delai: 0, fleche: false });
  });
});
