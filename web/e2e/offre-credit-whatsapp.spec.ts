import { test, expect, type Page } from './aide/test';

/**
 * L'ONGLET CRÉDIT WHATSAPP DE LA PAGE OFFRE (plan du Crédit WhatsApp, tâche 11) : il n'apparaît que quand la vue de l'offre
 * le dit, montre le solde, le prix d'un message vers la France tout compris (jamais un taux), les quatre achats et
 * l'historique ; le retour de Stripe relit sans rien créditer. Le serveur est simulé, aucun appel ne part chez Stripe.
 */
const ADMIN = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
const AGENT = { ...ADMIN, email: 'agent@e2e.test', role: 'agent' };
const PAGE_STRIPE = 'https://checkout.stripe.com/c/pay/cs_test_wa_e2e';
const PRO = ['inbox', 'scenarios', 'statistiques', 'agent_meta', 'aide', 'assistants', 'email', 'console'];
const LIMITES = {
  utilisateurs: 3, admins: 2, contacts: 5000, envoisModelesMois: null, automations: null, suppressionsJour: null, adressesWebhook: 5,
  journalWebhooksJours: 30, conservationJours: 90, commissionPct: 20, badge: false, numeroInclus: true,
};
const vueOffre = (onglet: boolean) => ({
  offre: 'pro', fonctions: PRO, limites: LIMITES, usage: { envoisModelesMois: null, contacts: 12, automations: 1, membres: 2 },
  grille: { free: { fonctions: [], limites: LIMITES }, pro: { fonctions: PRO, limites: LIMITES }, entreprise: { fonctions: PRO, limites: LIMITES } },
  prixPro: null, essai: null, sieges: null, suiteDuNumero: null, abonnement: null, upgradeUrl: 'https://console.e2e.test/offre',
  ongletCreditWhatsapp: onglet,
});

const ACHAT_ANCIEN = { id: 'm1', raison: 'achat', deltaMicroEur: 50_000_000, jour: null, at: '2026-10-20T09:00:00.000Z', messages: null, reference: 'cs_live_wa_ancien', facture: true };
const ENVOIS = { id: 'envois:2026-10-30', raison: 'envois', deltaMicroEur: -149_520, jour: '2026-10-30', at: '2026-10-30T18:00:00.000Z', messages: 2, reference: null, facture: false };
const credit = (o: Record<string, unknown> = {}) => ({
  soldeMicroEur: 37_250_000,
  prixFrance: [
    { categorie: 'marketing', prixMicroEur: 74_760 }, { categorie: 'utility', prixMicroEur: 26_040 },
    { categorie: 'authentication', prixMicroEur: 26_040 }, { categorie: 'service', prixMicroEur: 21_000 },
  ],
  franchiseServiceParNumero: 1000,
  achat: {
    disponible: true, permis: 'ok',
    offres: [{ offre: 'wa_50', htCentimes: 5_000 }, { offre: 'wa_100', htCentimes: 10_000 }, { offre: 'wa_250', htCentimes: 25_000 }, { offre: 'wa_500', htCentimes: 50_000 }],
  },
  ligneArretee: false,
  historique: [ENVOIS, ACHAT_ANCIEN],
  ...o,
});

interface Options {
  session?: typeof ADMIN;
  onglet?: boolean;
  /** Les vues successives du Crédit WhatsApp (la dernière se répète). */
  vues?: unknown[];
  achat?: { status: number; body: unknown };
}

async function monter(page: Page, o: Options = {}) {
  const achats: unknown[] = [];
  const factures: string[] = [];
  const vues = [...(o.vues ?? [credit()])];
  let lectures = 0;
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), o.session ?? ADMIN);
  await page.route(`${PAGE_STRIPE}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe Checkout (e2e)</h1>' }));
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname;
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/credit-whatsapp/achat') && req.method() === 'POST') {
      achats.push(req.postDataJSON());
      const a = o.achat ?? { status: 200, body: { url: PAGE_STRIPE } };
      return json(a.body, a.status);
    }
    if (chemin.endsWith('/credit-whatsapp')) {
      lectures += 1;
      return json(vues.length > 1 ? vues.shift()! : vues[0]!);
    }
    if (chemin.includes('/credit/factures/')) {
      factures.push(chemin);
      return json({ error: 'paiement inconnu', code: 'paiement_inconnu' }, 404);
    }
    if (chemin.endsWith('/offre')) return json(vueOffre(o.onglet ?? true));
    if (chemin.endsWith('/offre/factures')) return json({ plusSurStripe: false, factures: [] });
    if (chemin.endsWith('/agents/solde')) return json({ soldeMicroEur: 3_000_000 });
    if (chemin.endsWith('/agents/mouvements')) return json({ mouvements: [] });
    if (chemin.endsWith('/unread-count')) return json({ count: 0 });
    if (chemin.endsWith('/me')) return json({ email: ADMIN.email, name: 'Jean Test', role: 'admin' });
    return json({});
  });
  return { achats, factures, lectures: () => lectures };
}

test.describe('Paramètres > Offre > Crédit WhatsApp', () => {
  test('🔴 sans numéro sur la ligne, pas d’onglet, et l’adresse de l’onglet ramène à l’offre', async ({ page }) => {
    await monter(page, { onglet: false });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('mba-tab-credit')).toBeVisible();
    await expect(page.getByTestId('mba-tab-whatsapp')).toHaveCount(0);
    await expect(page.getByTestId('offre-usage')).toBeVisible();
    await expect(page.getByTestId('credit-wa-solde')).toHaveCount(0);
  });

  test('🔴 le solde, le prix d’un message vers la France tout compris, jamais un taux, et les quatre achats', async ({ page }) => {
    const m = await monter(page);
    await page.goto('/offre');
    await page.getByTestId('mba-tab-whatsapp').click();
    await expect(page).toHaveURL(/tab=whatsapp/);
    await expect(page.getByTestId('credit-wa-solde')).toContainText('37,25');
    await expect(page.getByTestId('credit-wa-bas')).toHaveCount(0);
    const prix = page.getByTestId('credit-wa-prix');
    await expect(prix.locator('[data-categorie="marketing"]')).toContainText('0,0748');
    await expect(prix.locator('[data-categorie="service"]')).toContainText('0,0210');
    await expect(prix).toContainText(/1\s000 premières réponses/);
    // Un prix tout compris, jamais la commission ni un pourcentage.
    await expect(page.locator('main')).not.toContainText(/commission|%/i);
    for (const euros of [50, 100, 250, 500]) {
      await expect(page.getByTestId(`credit-wa-offre-wa_${euros}`)).toHaveText(new RegExp(`Recharger ${euros} € HT`));
    }
    await expect(page.getByTestId('credit-wa-ligne')).toHaveCount(2);
    await expect(page.locator('[data-raison="envois"]')).toContainText('Envois du 30/10 (2 messages)');

    await page.getByTestId('credit-wa-offre-wa_250').click();
    await expect(page).toHaveURL(PAGE_STRIPE);
    expect(m.achats).toEqual([{ offre: 'wa_250' }]);
  });

  test('🔴 le RETOUR de paiement ne crédite rien : il annonce le crédit, puis relit jusqu’à voir l’achat', async ({ page }) => {
    const achat = { ...ACHAT_ANCIEN, id: 'm2', reference: 'cs_live_wa_neuf', at: new Date().toISOString() };
    const m = await monter(page, { vues: [credit({ soldeMicroEur: 0 }), credit({ soldeMicroEur: 50_000_000, historique: [achat, ENVOIS, ACHAT_ANCIEN] })] });
    await page.goto('/offre?tab=whatsapp&paiement=recu');
    await expect(page.getByTestId('credit-wa-retour-recu')).toContainText(/le crédit arrive dans quelques secondes/);
    await expect(page.getByTestId('credit-wa-solde')).toContainText('50,00', { timeout: 10_000 });
    await expect(page.getByTestId('credit-wa-retour-recu')).toContainText(/votre Crédit WhatsApp est à jour/);
    expect(m.lectures()).toBeGreaterThanOrEqual(2);
  });

  test('épuisé : plus rien ne part, réponses comprises', async ({ page }) => {
    await monter(page, { vues: [credit({ soldeMicroEur: 0 })] });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-epuise')).toContainText(/plus aucun message WhatsApp ne part/);
    await expect(page.getByTestId('credit-wa-bas')).toHaveCount(0);
  });

  test('sous 10 €, c’est bas', async ({ page }) => {
    await monter(page, { vues: [credit({ soldeMicroEur: 9_500_000 })] });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-bas')).toBeVisible();
    await expect(page.getByTestId('credit-wa-epuise')).toHaveCount(0);
  });

  test('🔴 les numéros arrêtés : on le dit, et aucun bouton d’achat', async ({ page }) => {
    await monter(page, { vues: [credit({ soldeMicroEur: 0, ligneArretee: true, achat: { disponible: true, permis: 'sans_ligne', offres: credit().achat.offres } })] });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-ligne-arretee')).toBeVisible();
    await expect(page.getByTestId('credit-wa-offre-wa_50')).toHaveCount(0);
    await expect(page.getByTestId('credit-wa-epuise')).toHaveCount(0);
  });

  test('🔴 une route d’achat absente (la console part avant l’API) : « pas encore disponible », pas une erreur brute', async ({ page }) => {
    await monter(page, { achat: { status: 404, body: { message: 'Route not found' } } });
    await page.goto('/offre?tab=whatsapp');
    await page.getByTestId('credit-wa-offre-wa_50').click();
    await expect(page.getByTestId('credit-wa-indisponible')).toBeVisible();
    await expect(page.getByTestId('credit-wa-erreur')).toHaveCount(0);
  });

  test('la facture d’un achat s’ouvre par sa session ; un refus se dit dans la page', async ({ page }) => {
    const m = await monter(page);
    await page.goto('/offre?tab=whatsapp');
    await page.getByTestId('credit-wa-facture').click();
    await expect(page.getByTestId('credit-wa-facture-erreur')).toBeVisible();
    expect(m.factures).toHaveLength(1);
    expect(m.factures[0]).toContain('/tenants/t-e2e/credit/factures/cs_live_wa_ancien');
  });

  test('🔴 un compte NON ADMIN n’y entre pas : aucun bouton d’achat ne lui est offert', async ({ page }) => {
    const m = await monter(page, { session: AGENT });
    await page.goto('/offre?tab=whatsapp');
    await expect(page).toHaveURL(/\/inbox/);
    await expect(page.getByTestId('credit-wa-offre-wa_50')).toHaveCount(0);
    expect(m.achats).toEqual([]);
  });
});
