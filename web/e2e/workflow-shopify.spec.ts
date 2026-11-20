import { test, expect } from './aide/test';

/**
 * LE BUILDER D'UN SCÉNARIO SHOPIFY (menu « Scénario », lot 5, tâche 12 ; décision 13). Ce que seul un test de bout en
 * bout peut voir :
 *  - le premier bloc, verrouillé : ni ✕ ni poignée d'entrée sur le canevas, ni « Supprimer » au panneau ;
 *  - ses variables lues dans l'événement (`{ type: 'variable' }`) s'affichent comme des données Shopify et le RESTENT
 *    quand on en change une autre : lues comme une source inconnue, elles retombaient sur « Nom », et le numéro de
 *    commande partait remplacé par le nom du contact ;
 *  - un message de la suite insère une donnée de l'événement en `{{shopify.<clé>}}`.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

const GRAPHE: Graph = {
  nodes: [
    {
      id: 'n1', type: 'template', position: { x: 0, y: 0 },
      data: {
        wfType: 'template', templateName: 'commande', language: 'fr', templateButtons: [], verrouille: true,
        variables: [
          { position: 1, source: { type: 'variable', key: 'first_name' } },
          { position: 2, source: { type: 'variable', key: 'order_number' } },
        ],
      },
    },
    { id: 'n2', type: 'quick_message', position: { x: 0, y: 200 }, data: { wfType: 'quick_message', body: 'Merci !' } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
};
const TEMPLATE = {
  id: 'id-commande', name: 'commande', status: 'APPROVED', category: 'UTILITY', language: 'fr',
  body: 'Bonjour {{1}}, votre commande {{2}} est payée. Merci !', headerFormat: null, isCarousel: false, editable: true, buttons: [],
};

async function monter(page: import('@playwright/test').Page): Promise<{ graphes: Graph[]; creations: Array<Record<string, unknown>> }> {
  const recus = { graphes: [] as Graph[], creations: [] as Array<Record<string, unknown>> };
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  const wf = { id: 'wf-s', name: 'Commande payée', rayon: 'shopify', graph: GRAPHE, draftGraph: GRAPHE, createdAt: '', updatedAt: '' };
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const json = (b: unknown, statut = 200) => route.fulfill({ status: statut, contentType: 'application/json', body: JSON.stringify(b) });
    if (req.method() === 'PATCH' && /\/workflows\/wf-s$/.test(url)) {
      const corps = (req.postDataJSON() ?? {}) as { graph?: Graph };
      if (corps.graph) recus.graphes.push(corps.graph);
      return json({ ok: true, brouillon: true });
    }
    if (req.method() === 'POST' && /\/workflows\/wf-s\/blocs\/n1\/modele$/.test(url)) {
      recus.creations.push((req.postDataJSON() ?? {}) as Record<string, unknown>);
      return json({ modele: 'commande_payee_mi3k2x1a', langue: 'fr', etat: 'en_validation', categorie: 'UTILITY', boutons: [] }, 201);
    }
    if (/\/workflows\/wf-s\/modeles$/.test(url)) return json({ modeles: [], programmee: null });
    if (/\/workflows\/wf-s$/.test(url)) return json({ workflow: wf });
    // Le Builder général ne liste pas une automation : elle s'ouvre par son identifiant.
    if (url.endsWith('/workflows')) return json({ workflows: [] });
    if (url.includes('/integrations/shopify')) {
      return json({
        boutique: { domaine: 'b.myshopify.com', nom: 'B', etat: 'connectee', origine: 'console', delaiPanierMinutes: 60, pauseLe: null },
        lignes: [{ evenement: 'order_paid', actif: true, workflowId: 'wf-s', scenario: 'Commande payée', modele: 'commande', langue: 'fr', etatChezMeta: 'APPROVED', blocs: 2, versionProgrammee: false }],
      });
    }
    if (/\/nodes(\?|$)/.test(url)) return json({ nodes: [] });
    if (url.includes('/param-hints')) return json({ hints: [] });
    if (url.includes('/email/accounts')) return json({ accounts: [] });
    if (url.includes('/email/templates')) return json({ templates: [] });
    if (url.includes('/templates')) return json({ templates: [TEMPLATE] });
    if (url.includes('/flows')) return json({ flows: [] });
    if (url.includes('/tags')) return json({ tags: [] });
    if (url.includes('/user-fields/usage')) return json({ total: 0, parChamp: {} });
    if (url.includes('/user-fields')) return json({ fields: [] });
    if (url.includes('/settings')) return json({ mbaEnabled: false, rcsEnabled: false, hubspotListsEnabled: false, campaignsPaused: false });
    if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });
  await page.goto('/workflows?open=wf-s');
  return recus;
}

const bloc = (page: import('@playwright/test').Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

test.describe('Éditeur : un scénario Shopify (lot 5)', () => {
  test('🔴 le premier bloc : ni ✕ ni poignée d’entrée, ni « Supprimer » au panneau ; un bloc de la suite, si', async ({ page }) => {
    await monter(page);
    await expect(page.getByTestId('wf-premier-bloc-n1')).toBeVisible();
    await expect(bloc(page, 'n1').getByTitle('Supprimer le bloc')).toHaveCount(0);
    await expect(bloc(page, 'n1').locator('.react-flow__handle-top')).toHaveCount(0);
    await expect(bloc(page, 'n2').getByTitle('Supprimer le bloc')).toHaveCount(1);
    await bloc(page, 'n1').click();
    await expect(page.getByTestId('panneau-premier-bloc')).toContainText('Shopify l’envoie à chaque événement');
    await expect(page.getByRole('button', { name: 'Supprimer', exact: true })).toHaveCount(0);
    await bloc(page, 'n2').click();
    await expect(page.getByRole('button', { name: 'Supprimer', exact: true })).toHaveCount(1);
  });

  test('🔴 les variables du premier bloc restent des données Shopify quand on en change une autre (jamais « Nom »)', async ({ page }) => {
    const recus = await monter(page);
    await bloc(page, 'n1').click();
    const v1 = page.getByTestId('template-node-variable-1');
    const v2 = page.getByTestId('template-node-variable-2');
    await expect(v1).toHaveValue('var:first_name');
    await expect(v2).toHaveValue('var:order_number');
    await expect(v1.locator('option:checked')).toHaveText('prénom');
    // Les données de l'événement « Commande payée » sont proposées ; le lien du panier, d'un autre événement, non.
    await expect(v2.locator('option[value="var:order_total"]')).toHaveCount(1);
    await expect(v2.locator('option[value="var:checkout_url"]')).toHaveCount(0);
    await v2.selectOption('var:order_total');
    await expect.poll(() => recus.graphes.length).toBeGreaterThan(0);
    const n1 = recus.graphes.at(-1)!.nodes.find((n) => n.id === 'n1')!;
    expect((n1.data as { variables: unknown }).variables).toEqual([
      { position: 1, source: { type: 'variable', key: 'first_name' } },
      { position: 2, source: { type: 'variable', key: 'order_total' } },
    ]);
  });

  test('🔴 « Modifier ce template » sur le premier bloc : aucune donnée Shopify dans les indices du template (400 avant le 2026-11-20), et le bloc les garde', async ({ page }) => {
    const recus = await monter(page);
    await bloc(page, 'n1').click();
    await page.getByTestId('template-modifier').click();
    const modale = page.getByTestId('modele-du-bloc');
    await expect(modale).toBeVisible();
    await modale.getByTestId('template-soumettre').click();
    await expect(modale).toHaveCount(0);
    expect(recus.creations).toHaveLength(1);
    const indices = (recus.creations[0]!.paramHints ?? []) as Array<{ source: { type: string } }>;
    expect(indices.filter((h) => h.source.type === 'variable')).toEqual([]);
    await expect.poll(() => String((recus.graphes.at(-1)?.nodes.find((n) => n.id === 'n1')?.data as { templateName?: unknown } | undefined)?.templateName ?? ''), { timeout: 10_000 })
      .toBe('commande_payee_mi3k2x1a');
    const n1 = recus.graphes.at(-1)!.nodes.find((n) => n.id === 'n1')!;
    expect((n1.data as { variables: unknown }).variables).toEqual([
      { position: 1, source: { type: 'variable', key: 'first_name' } },
      { position: 2, source: { type: 'variable', key: 'order_number' } },
    ]);
  });

  test('🔴 le retour mène à Automation > Shopify, pas à la liste des scénarios (spec 2026-11-20 § 4.4)', async ({ page }) => {
    await monter(page);
    const retour = page.getByTestId('workflow-retour');
    await expect(retour).toHaveText('← Retour aux automations Shopify');
    await retour.click();
    await expect(page).toHaveURL(/\/automations\/shopify$/);
  });

  test('un message de la suite insère une donnée de l’événement en {{shopify.<clé>}}', async ({ page }) => {
    const recus = await monter(page);
    await bloc(page, 'n2').click();
    await page.getByTestId('quick-node-body-variable').click();
    await page.getByTestId('quick-node-body-variable-shopify-order_number').click();
    await expect.poll(() => String((recus.graphes.at(-1)?.nodes.find((n) => n.id === 'n2')?.data as { body?: unknown } | undefined)?.body ?? ''))
      .toContain('{{shopify.order_number}}');
  });
});
