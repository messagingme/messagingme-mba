import { test, expect } from './aide/test';

/**
 * DEUX SYSTÈMES, ET CHAQUE APPEL CHEZ LE SIEN (Julien, 2026-11-11, en branchant un système de production à côté
 * de son système d'essai : « c'est pas clair putain »).
 *
 * Ce qui le trompait, et que ces tests empêchent de revenir :
 *  - les appels du système déplié flottaient SOUS son cadre, et le système suivant, collé dessous, se lisait
 *    comme l'un d'eux : les appels semblaient passer d'un système à l'autre ;
 *  - le titre disait « Appels API » sans dire de quel système ;
 *  - le bloc « Appel API » d'un scénario listait deux appels de même nom et de même chemin, l'un vers l'essai,
 *    l'autre vers la production, sans rien pour les distinguer.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };

const ESSAI = '22222222-2222-4222-8222-222222222222';
const PROD = '44444444-4444-4444-8444-444444444444';
const source = (id: string, label: string, baseUrl: string) => ({
  id, kind: 'http', label, baseUrl, authKind: 'header', authHeaderName: 'ApiKey', aAuthentification: true,
  status: 'active', lastOkAt: null, lastError: null, outilsActifs: 0, agents: 0,
});
const SOURCES = [source(PROD, 'connection T9 prod', 'https://t9.example'), source(ESSAI, 'test webhook', 'https://webhook.example')];
const requete = (id: string, sourceId: string, label: string, scenarios: string[]) => ({
  id, tenantId: 't-e2e', sourceId, label, methode: 'POST', chemin: '/api/data/t9-kal-whatsapp-asb-post',
  parametres: [], entetes: [], corps: { mode: 'aucun' }, variables: [], outputPaths: [], valeursTest: {},
  outils: 0, scenarios, updatedAt: '2026-11-11T00:00:00.000Z',
});
const RQ_ESSAI = '33333333-3333-4333-8333-333333333333';
const RQ_PROD = '55555555-5555-4555-8555-555555555555';
const REQUETES = [requete(RQ_ESSAI, ESSAI, 'declarer l’appel', ['main']), requete(RQ_PROD, PROD, 'déclarer l’appel', [])];

type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
const GRAPHE: Graph = {
  nodes: [{ id: 'n1', type: 'http', position: { x: 0, y: 0 }, data: { wfType: 'http', requestId: RQ_ESSAI, requeteLabel: 'declarer l’appel' } }],
  edges: [],
};

async function mock(page: import('@playwright/test').Page) {
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  const wf = { id: 'wf1', name: 'main', graph: GRAPHE, createdAt: '', updatedAt: '' };
  await page.route('**/api/backend/**', async (route) => {
    const url = route.request().url();
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/agent-requetes')) return json({ requetes: REQUETES, champs: [], catalogue: { fiche: [], contact: ['wa_id'], systeme: [], entetesReserves: [] } });
    if (url.includes('/agent-sources')) return json({ sources: SOURCES });
    if (/\/workflows\/wf1$/.test(url)) return json({ workflow: wf });
    if (url.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: 'main', graph: GRAPHE }] });
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

test.describe('Connecteurs : chaque appel chez son système', () => {
  test('🔴 les appels du système déplié sont DANS son cadre, sous un titre qui le nomme', async ({ page }) => {
    await mock(page);
    await page.goto('/connecteurs');

    // Le système de production : son appel est dans son cadre, et le système d'essai rangé dessous n'en fait pas partie.
    await page.getByTestId(`source-ligne-${PROD}`).click();
    const cadreProd = page.getByTestId(`source-cadre-${PROD}`);
    await expect(cadreProd.getByTestId('requetes-titre')).toHaveText('Appels API de « connection T9 prod »');
    await expect(cadreProd.getByTestId(`requete-${RQ_PROD}`)).toBeVisible();
    await expect(cadreProd.getByTestId(`source-ligne-${ESSAI}`)).toHaveCount(0);
    await expect(page.getByTestId(`requete-${RQ_ESSAI}`)).toHaveCount(0);

    // Le système d'essai : son appel est dans SON cadre, et pas ailleurs.
    await page.getByTestId(`source-ligne-${ESSAI}`).click();
    const cadreEssai = page.getByTestId(`source-cadre-${ESSAI}`);
    await expect(cadreEssai.getByTestId('requetes-titre')).toHaveText('Appels API de « test webhook »');
    await expect(cadreEssai.getByTestId(`requete-${RQ_ESSAI}`)).toBeVisible();
    await expect(page.getByTestId(`requete-${RQ_PROD}`)).toHaveCount(0);

    // La ligne compte ce qui se sert du système, scénarios compris.
    await expect(page.getByTestId(`source-usage-${ESSAI}`)).toContainText('1 appel(s), 1 scénario(s)');
    await expect(page.getByTestId(`source-usage-${PROD}`)).toContainText('1 appel(s)');
    await expect(page.getByTestId(`source-usage-${PROD}`)).not.toContainText('scénario');
  });

  test('🔴 le bloc « Appel API » nomme le système de chaque appel', async ({ page }) => {
    await mock(page);
    await page.goto('/workflows?open=wf1');
    await page.locator('.react-flow__node').first().click();
    const choix = page.getByTestId('http-node-requete');
    await expect(choix.locator(`option[value="${RQ_ESSAI}"]`)).toHaveText('declarer l’appel (test webhook, POST /api/data/t9-kal-whatsapp-asb-post)');
    await expect(choix.locator(`option[value="${RQ_PROD}"]`)).toHaveText('déclarer l’appel (connection T9 prod, POST /api/data/t9-kal-whatsapp-asb-post)');
  });
});
