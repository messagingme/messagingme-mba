import { test, expect, type Page } from './aide/test';
import { repondre } from './aide/confirmation';

/**
 * SHOPIFY DANS LA CONSOLE, vu de l'écran (conception 2026-10-22 ; menu « Scénario », lots 5 et 7) : la carte de Tools >
 * Intégrations branche la boutique, la met en pause et la coupe ; la page Scénario > Automation > Shopify
 * (`/automations/shopify`) allume chaque automation, en dit l'état, règle le délai du panier et ouvre son scénario. Le
 * serveur tient ses règles de son côté (`tests/http-shopify.test.ts`, `tests/shopify-lignes-gestion.test.ts`) ; ici, on
 * regarde ce que l'écran MONTRE et ce qu'il ENVOIE, contre une API simulée.
 */
const PAGE = '/automations/shopify';
const BOUTIQUE = {
  domaine: 'ma-boutique.myshopify.com', nom: 'Ma Boutique', etat: 'connectee', dernierEvenementLe: null,
  delaiPanierMinutes: 60, origine: 'claude_code', pauseLe: null,
};
const VIDE = { boutique: null, compteurs: {}, paniers: { relances: {}, fermesATemps: 0, enAttente: 0 }, pageApps: null, lignes: [] };
const ligne = (evenement: string, o: Record<string, unknown> = {}) => ({
  evenement, actif: true, workflowId: `wf-${evenement}`, scenario: evenement, modele: `m_${evenement}`, langue: 'fr',
  etatChezMeta: 'APPROVED', blocs: 1, versionProgrammee: false, ...o,
});
const BRANCHEE = {
  ...VIDE, boutique: BOUTIQUE, pageApps: 'https://admin.shopify.com/store/ma-boutique/settings/apps', lignes: [ligne('order_paid')],
};
/** La relance aussi en service : la carte dit alors la ligne des paniers. */
const RELANCE_ACTIVE = { ...BRANCHEE, lignes: [ligne('order_paid'), ligne('checkout_abandoned')] };

interface Trace {
  branchements: unknown[];
  pauses: unknown[];
  lignes: Array<{ evenement: string; corps: unknown }>;
}

async function monter(page: Page, o: { etat?: Record<string, unknown> | 'absente'; apresBranchement?: Record<string, unknown>; ecran?: string; role?: string }): Promise<Trace> {
  const trace: Trace = { branchements: [], pauses: [], lignes: [] };
  const session = { token: 'e2e-token', email: 'moi@e2e.test', role: o.role ?? 'admin', tenantId: 't-e2e' };
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), session);
  let etat = o.etat ?? BRANCHEE;
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const chemin = req.url().split('?')[0]!;
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    const reglageLigne = /\/integrations\/shopify\/lignes\/([a-z_]+)$/.exec(chemin);
    if (reglageLigne && req.method() === 'PUT') {
      const corps = req.postDataJSON() as { actif: boolean };
      trace.lignes.push({ evenement: reglageLigne[1]!, corps });
      return json({ ligne: { evenement: reglageLigne[1], workflowId: `wf-${reglageLigne[1]}`, actif: corps.actif, modifieLe: '2026-11-19T10:00:00.000Z' } });
    }
    if (chemin.endsWith('/integrations/shopify') && req.method() === 'PATCH') {
      trace.pauses.push(req.postDataJSON());
      return json({ changee: true });
    }
    if (chemin.endsWith('/integrations/shopify') && req.method() === 'POST') {
      trace.branchements.push(req.postDataJSON());
      if (o.apresBranchement) etat = o.apresBranchement;
      return json(BOUTIQUE);
    }
    if (chemin.endsWith('/integrations/shopify')) {
      // Le 404 exact du routeur Fastify : c'est lui qui dit « API pas encore déployée ».
      if (etat === 'absente') return json({ message: 'Route GET not found', error: 'Not Found', statusCode: 404 }, 404);
      return json(etat);
    }
    if (chemin.endsWith('/automations')) return json({ automations: [] });
    if (chemin.endsWith('/workflows')) return json({ workflows: [] });
    if (chemin.endsWith('/settings')) return json({ mbaEnabled: false, timezone: 'Europe/Paris', businessHours: {} });
    if (chemin.endsWith('/account-status')) return json({ hasNumber: false, hubspotPortal: { connected: false } });
    if (chemin.endsWith('/integrations/batch')) return json({ branche: false });
    if (chemin.endsWith('/settings/agents-peuvent-prendre')) return json({ actif: false });
    if (chemin.endsWith('/contacts/blocked')) return json({ contacts: [] });
    if (chemin.endsWith('/unread-count')) return json({ count: 0 });
    if (chemin.endsWith('/me')) return json({ email: 'moi@e2e.test', name: 'Moi', role: o.role ?? 'admin' });
    return json({});
  });
  await page.goto(o.ecran ?? '/integrations');
  return trace;
}

test.describe('Tools > Intégrations > Shopify : la carte de la console', () => {
  test('🔴 sans boutique : le mode opératoire, puis les clés branchent la boutique, nettoyées', async ({ page }) => {
    const trace = await monter(page, { etat: VIDE, apresBranchement: BRANCHEE });
    const carte = page.getByTestId('integration-shopify');
    await expect(carte.getByTestId('shopify-mode-operatoire')).toContainText('Create app manually');
    await expect(carte.getByTestId('shopify-mode-operatoire')).toContainText('https://app.messagingme.fr/shopify/console/');
    await expect(carte.getByTestId('shopify-mode-operatoire')).toContainText('read_customers,read_orders,read_checkouts,read_fulfillments');
    const valider = carte.getByTestId('shopify-brancher-valider');
    await expect(valider).toBeDisabled();
    await carte.getByTestId('shopify-boutique').fill(' https://admin.shopify.com/store/ma-boutique ');
    await carte.getByTestId('shopify-client-id').fill(' cid ');
    await carte.getByTestId('shopify-secret').fill('shpss_secret\n');
    await valider.click();
    await expect.poll(() => trace.branchements.length).toBe(1);
    expect(trace.branchements[0]).toEqual({ boutique: 'https://admin.shopify.com/store/ma-boutique', clientId: 'cid', secret: 'shpss_secret' });
    // Plus d'assistant : les messages sont des automations, que la carte renvoie à LEUR page (menu « Scénario », lot 7).
    const versLesAutomations = carte.getByTestId('integration-shopify-automations').getByRole('link');
    await expect(versLesAutomations).toHaveText('Scénario > Automation > Shopify');
    await expect(versLesAutomations).toHaveAttribute('href', PAGE);
    await expect(carte.getByTestId('integration-shopify-message')).toContainText('Boutique branchée');
    await expect(carte.getByTestId('integration-shopify-message')).toContainText('Scénario > Automation > Shopify');
  });

  test('🔴 la pause se confirme, puis part ; la reprise part sans question', async ({ page }) => {
    const trace = await monter(page, {});
    const carte = page.getByTestId('integration-shopify');
    await carte.getByTestId('integration-shopify-pause-interrupteur').click();
    await repondre(page, true, 'Aucun message Shopify ne partira plus');
    await expect.poll(() => trace.pauses).toEqual([{ pause: true }]);
    await expect(carte.getByTestId('integration-shopify-message')).toContainText('Boutique en pause');
  });

  test('🔴 en pause, la carte le dit ; la reprise part sans question', async ({ page }) => {
    const trace = await monter(page, { etat: { ...BRANCHEE, boutique: { ...BOUTIQUE, pauseLe: '2026-11-19T10:00:00.000Z' } } });
    const carte = page.getByTestId('integration-shopify');
    await expect(carte.getByTestId('integration-shopify-pause')).toContainText('En pause depuis');
    await carte.getByTestId('integration-shopify-pause-interrupteur').click();
    await expect.poll(() => trace.pauses).toEqual([{ pause: false }]);
    await expect(page.getByTestId('confirmation')).toHaveCount(0);
  });

  test('🔴 la ligne des paniers dit les relances parties et les récupérés de la même date, leur montant, les tests à part (plan 2026-10-30)', async ({ page }) => {
    await monter(page, {
      etat: {
        ...RELANCE_ACTIVE,
        paniers: {
          relances: { envoye: 3 }, fermesATemps: 1, enAttente: 2,
          relancesParties: 4, recuperes: 2, montantsRecuperes: [{ devise: 'EUR', montant: '59.9' }], recuperesTest: 1,
        },
      },
    });
    const ligneDesPaniers = page.getByTestId('integration-shopify-paniers');
    await expect(ligneDesPaniers).toContainText('4 relances parties, 2 récupérés');
    await expect(ligneDesPaniers).toContainText(/59,90\s€/);
    await expect(ligneDesPaniers).toContainText('et 1 de test, non comptés');
  });

  test('la ligne des paniers ne se montre que si l’automation du panier est en service', async ({ page }) => {
    await monter(page, { etat: { ...BRANCHEE, lignes: [ligne('order_paid'), ligne('checkout_abandoned', { actif: false })] } });
    await expect(page.getByTestId('integration-shopify-etat')).toBeVisible();
    await expect(page.getByTestId('integration-shopify-paniers')).toHaveCount(0);
  });

  test('🔴 API pas encore déployée (404 du routeur) : AUCUNE carte', async ({ page }) => {
    await monter(page, { etat: 'absente' });
    await expect(page.getByTestId('integration-hubspot')).toBeVisible();
    await expect(page.getByTestId('integration-shopify')).toHaveCount(0);
  });
});

test.describe('Scénario > Automation > Shopify : les automations de la boutique, sur leur page (menu « Scénario », lots 5 et 7)', () => {
  test('🔴 une ligne par événement : son état dit, sans ligne « pas encore créée », et son scénario s’ouvre', async ({ page }) => {
    await monter(page, {
      ecran: PAGE,
      etat: { ...BRANCHEE, lignes: [ligne('order_paid'), ligne('checkout_abandoned', { modele: null, langue: null, etatChezMeta: null })] },
    });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Automations Shopify');
    const section = page.getByTestId('automations-shopify');
    await expect(section.getByTestId('automations-shopify-etat-order_paid')).toHaveText('active');
    await expect(section.getByTestId('automations-shopify-etat-order_fulfilled')).toHaveText('pas encore créée');
    await expect(section.getByTestId('automations-shopify-etat-checkout_abandoned')).toContainText('à compléter');
    await expect(section.getByTestId('automations-shopify-ouvrir-order_paid')).toHaveAttribute('href', '/workflows?open=wf-order_paid');
    await expect(section.getByTestId('automations-shopify-ouvrir-order_fulfilled')).toHaveCount(0);
    await expect(section.getByTestId('automations-shopify-interrupteur-order_paid')).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByTestId('automations-shopify-interrupteur-order_fulfilled')).toHaveAttribute('aria-pressed', 'false');
  });

  test('🔴 l’interrupteur éteint ou rallume sa ligne sur place ; le délai du panier part avec elle', async ({ page }) => {
    const trace = await monter(page, {
      ecran: PAGE, etat: { ...RELANCE_ACTIVE, lignes: [...RELANCE_ACTIVE.lignes, ligne('order_fulfilled', { actif: false })] },
    });
    const section = page.getByTestId('automations-shopify');
    await section.getByTestId('automations-shopify-interrupteur-order_paid').click();
    await expect.poll(() => trace.lignes).toEqual([{ evenement: 'order_paid', corps: { actif: false } }]);
    // Une ligne qui existe déjà se rallume sur place : seul le PREMIER allumage ouvre le builder.
    await section.getByTestId('automations-shopify-interrupteur-order_fulfilled').click();
    await expect.poll(() => trace.lignes.length).toBe(2);
    expect(trace.lignes[1]).toEqual({ evenement: 'order_fulfilled', corps: { actif: true } });
    await section.getByTestId('automations-shopify-delai').selectOption('180');
    await expect.poll(() => trace.lignes.length).toBe(3);
    expect(trace.lignes[2]).toEqual({ evenement: 'checkout_abandoned', corps: { actif: true, delaiMinutes: 180 } });
    await expect(page).toHaveURL(/\/automations\/shopify$/);
  });

  test('🔴 le premier allumage crée le scénario et l’ouvre dans le builder (spec § 2.1)', async ({ page }) => {
    const trace = await monter(page, { ecran: PAGE, etat: BRANCHEE });
    await page.getByTestId('automations-shopify-interrupteur-order_fulfilled').click();
    await expect.poll(() => trace.lignes).toEqual([{ evenement: 'order_fulfilled', corps: { actif: true } }]);
    await expect(page).toHaveURL(/\/workflows\?open=wf-order_fulfilled$/);
  });

  test('la pause se dit, avec le chemin pour la reprendre, et les lignes restent', async ({ page }) => {
    await monter(page, { ecran: PAGE, etat: { ...BRANCHEE, boutique: { ...BOUTIQUE, pauseLe: '2026-11-19T10:00:00.000Z' } } });
    await expect(page.getByTestId('automations-shopify-pause')).toContainText('Boutique en pause');
    await expect(page.getByTestId('automations-shopify-order_paid')).toBeVisible();
  });

  test('la coupure se dit, sans aucune ligne', async ({ page }) => {
    await monter(page, { ecran: PAGE, etat: { ...BRANCHEE, boutique: { ...BOUTIQUE, etat: 'coupee' } } });
    await expect(page.getByTestId('automations-shopify-coupee')).toContainText('Boutique coupée');
    await expect(page.getByTestId('automations-shopify-order_paid')).toHaveCount(0);
  });

  test('🔴 sans boutique, la page le dit et mène à la carte qui la branche, sans aucune ligne', async ({ page }) => {
    await monter(page, { ecran: PAGE, etat: VIDE });
    const sans = page.getByTestId('automations-shopify-sans-boutique');
    await expect(sans).toContainText('Aucune boutique Shopify n’est branchée');
    await expect(sans.getByRole('link')).toHaveAttribute('href', '/integrations#integration-shopify');
    await expect(page.getByTestId('automations-shopify')).toHaveCount(0);
  });

  test('🔴 l’API sans la route (404 du routeur) : la page dit que la lecture a échoué, sans aucune ligne', async ({ page }) => {
    await monter(page, { ecran: PAGE, etat: 'absente' });
    await expect(page.getByTestId('automations-shopify-panne')).toContainText('n’ont pas pu être lues');
    await expect(page.getByTestId('automations-shopify')).toHaveCount(0);
  });

  test('🔴 l’écran des autres automations n’a plus de section Shopify, même avec une boutique', async ({ page }) => {
    // La lecture de la boutique doit avoir RÉPONDU avant l'assertion d'absence : la barre la lit sur toute la Console, et
    // c'est elle qui fait apparaître l'entrée Shopify, pas la page.
    const lue = page.waitForResponse((r) => r.url().includes('/integrations/shopify'));
    await monter(page, { ecran: '/automations', etat: BRANCHEE });
    await lue;
    await expect(page.getByTestId('automation-add')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Autres automations');
    await expect(page.getByTestId('automations-shopify')).toHaveCount(0);
    await expect(page.locator('aside a[href="/automations/shopify"]')).toHaveCount(1);
  });
});
