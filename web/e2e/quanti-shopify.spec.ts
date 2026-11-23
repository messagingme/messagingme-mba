import { test, expect } from './aide/test';

/**
 * QUANTITATIF > SHOPIFY : le chiffre d'affaires attribué aux envois WhatsApp (plan 2026-10-30, lot 2, tâche 5).
 *
 * 🔴 CE QUE CE FICHIER PROTÈGE : deux devises restent deux chiffres, jamais un total ; les commandes de test s'annoncent
 * à part, sans entrer dans le chiffre ; l'entrée de la barre n'existe que pour un espace qui a une boutique ; et la
 * console publiée avant l'API dit « pas encore disponible ». Le calcul est tenu sans navigateur (`tests/shopify-chiffre`).
 */
const ADMIN = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };

const VENTES = {
  periode: { from: '2026-10-01', to: '2026-10-30' },
  reel: {
    totaux: [{ devise: 'EUR', brut: '170.5', prouve: '100.5', commandes: 3 }, { devise: 'USD', brut: '30', prouve: '0', commandes: 1 }],
    sources: [
      { source: 'campagne', campaignId: 'k1', nom: 'Soldes', devise: 'EUR', brut: '150.5', prouve: '100.5', commandes: 2 },
      { source: 'campagne', campaignId: null, nom: null, devise: 'EUR', brut: '20', prouve: '0', commandes: 1 },
      { source: 'agent', campaignId: null, nom: null, devise: 'USD', brut: '30', prouve: '0', commandes: 1 },
    ],
  },
  test: { totaux: [{ devise: 'USD', brut: '2148.85', prouve: '1548.85', commandes: 4 }], sources: [] },
  paniers: { relances: 7, recuperes: 2, montants: [{ devise: 'EUR', montant: '40' }], recuperesTest: 1 },
};

const BOUTIQUE = { domaine: 'essai.myshopify.com', nom: 'Essai', etat: 'connectee', dernierEvenementLe: null, delaiPanierMinutes: 15, origine: 'console' };

const ROI = {
  devise: 'EUR',
  serie: [
    { jour: '2026-10-01', chiffreCumule: '0', coutCumule: 2 },
    { jour: '2026-10-02', chiffreCumule: '150.5', coutCumule: 6.5 },
    { jour: '2026-10-03', chiffreCumule: '170.5', coutCumule: 7.5 },
  ],
  depense: 7.5, ramene: '170.5', prouve: '100.5', roiPct: 2173, ia: 1.5, estime: true, partiel: false,
  autresDevises: [{ devise: 'USD', cout: 0.4 }],
  sources: [
    { source: 'campagne', campaignId: 'k1', nom: 'Soldes', cout: 5, brut: '150.5', roiPct: 2910, partiel: false },
    { source: 'agent', campaignId: null, nom: null, cout: 1.5, brut: '0', roiPct: -100, partiel: false },
    { source: 'campagne', campaignId: 'k2', nom: 'Muette', cout: 1, brut: '0', roiPct: -100, partiel: true },
  ],
  autres: null,
};

/** L'exemple de la spec : 128 = 74 livrées + 12 supprimées + 20 sans numéro + 8 invalides + 14 en attente. */
const JOIGNABILITE = { expediees: 128, messagesLivres: 96, livrees: 74, supprimees: 12, sansNumero: 20, invalides: 8, enAttente: 14, testExpediees: 3 };

async function mock(page: import('@playwright/test').Page, opts: { boutique?: unknown; ventes?: unknown; statut?: number; roi?: unknown; joignabilite?: unknown } = {}) {
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), ADMIN);
  await page.route('**/api/backend/**', async (route) => {
    const url = route.request().url();
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/stats/joignabilite')) {
      // Par défaut, un corps illisible : la page reste celle d'avant, sans la carte, comme avant ce lot.
      if (opts.joignabilite === 404) return json({ message: 'Route GET:/tenants/t-e2e/stats/joignabilite not found', error: 'Not Found', statusCode: 404 }, 404);
      return json(opts.joignabilite ?? {});
    }
    if (url.includes('/stats/roi')) {
      // Par défaut, la route du ROI rend un corps illisible : la page reste celle d'avant, comme avant ce lot.
      if (opts.roi === 404) return json({ message: 'Route GET:/tenants/t-e2e/stats/roi not found', error: 'Not Found', statusCode: 404 }, 404);
      return json(opts.roi ?? {});
    }
    if (url.includes('/stats/ventes')) {
      // Le 404 du ROUTEUR, celui d'une API qui ne connaît pas encore la route.
      if (opts.statut === 404) return json({ message: 'Route GET:/tenants/t-e2e/stats/ventes not found', error: 'Not Found', statusCode: 404 }, 404);
      return json(opts.ventes ?? VENTES);
    }
    if (url.includes('/integrations/shopify')) {
      return json({ boutique: opts.boutique === undefined ? BOUTIQUE : opts.boutique, messages: [], compteurs: {}, paniers: {}, pageApps: null, attentes: [] });
    }
    if (url.includes('/unread-count')) return json({ count: 0 });
    if (url.endsWith('/me')) return json({ email: ADMIN.email, name: 'Jean Test', role: 'admin' });
    return json({});
  });
}

test.describe('Quantitatif > Shopify', () => {
  test('🔴 deux devises, deux chiffres ; les sources, les paniers, et les commandes de test à part', async ({ page }) => {
    await mock(page);
    await page.goto('/dashboard/shopify');
    await expect(page.getByTestId('ventes-total-EUR')).toContainText(/170,50\s€|€170\.50/);
    await expect(page.getByTestId('ventes-total-USD')).toContainText(/30,00\s\$US|\$30\.00/);
    await expect(page.getByTestId('ventes-total-EUR')).toContainText(/100,50\s€|€100\.50/);
    await expect(page.getByTestId('ventes-regle')).toContainText(/5 jours|5 days/);
    // Le reste n'est qu'une concordance dans le temps, et l'écran le dit (anti-but de la spec ; relecture du lot B).
    await expect(page.getByTestId('ventes-regle')).toContainText(/concordance dans le temps|match in time/);
    await expect(page.getByTestId('ventes-sources')).toContainText(/Campagne « Soldes »|Campaign “Soldes”/);
    await expect(page.getByTestId('ventes-sources')).toContainText(/Campagne supprimée|Deleted campaign/);
    await expect(page.getByTestId('ventes-relances')).toHaveText('7');
    await expect(page.getByTestId('ventes-recuperes')).toHaveText('2');
    await expect(page.getByTestId('ventes-montant-recupere')).toContainText(/40,00\s€|€40\.00/);
    // Les tests s'annoncent, sans entrer dans le chiffre : aucun total de 2 148,85 ailleurs que sur leur ligne.
    await expect(page.getByTestId('ventes-tests')).toContainText(/4 commandes de test|4 test orders/);
    await expect(page.getByTestId('ventes-tests')).toContainText(/2\s148,85|2,148\.85/);
    // Leur part prouvée et le panier récupéré en test se lisent aussi : l'essai réel n'a que des commandes de test.
    await expect(page.getByTestId('ventes-tests')).toContainText(/dont 1\s548,85\s\$US prouvés|of which \$1,548\.85 proven/);
    await expect(page.getByTestId('ventes-tests')).toContainText(/1 panier relancé récupéré|1 reminded checkout recovered/);
    await expect(page.getByTestId('ventes-total-USD')).not.toContainText(/2\s148|2,148/);
  });

  test('🔴 l’entrée de la barre existe avec une boutique, et disparaît sans', async ({ page }) => {
    await mock(page);
    await page.goto('/dashboard/performance');
    await expect(page.locator('nav a[href="/dashboard/shopify"]')).toHaveCount(1);
  });

  test('🔴 sans boutique, pas d’entrée Shopify dans Quantitatif', async ({ page }) => {
    await mock(page, { boutique: null });
    // La lecture de la boutique doit avoir RÉPONDU avant l'assertion : sinon l'entrée, encore cachée faute de réponse,
    // ferait passer le test sur une lecture fautive (relecture du lot B).
    const lue = page.waitForResponse((r) => r.url().includes('/integrations/shopify'));
    await page.goto('/dashboard/performance');
    await lue;
    await expect(page.locator('nav a[href="/dashboard/performance"]').first()).toBeVisible();
    await expect(page.locator('nav a[href="/dashboard/shopify"]')).toHaveCount(0);
  });

  test('aucune vente : la phrase le dit, jamais un zéro sans explication', async ({ page }) => {
    await mock(page, { ventes: { reel: { totaux: [], sources: [] }, test: { totaux: [], sources: [] }, paniers: { relances: 0, recuperes: 0, montants: [], recuperesTest: 0 } } });
    await page.goto('/dashboard/shopify');
    await expect(page.getByTestId('ventes-vide')).toBeVisible();
    await expect(page.getByTestId('ventes-tests')).toHaveCount(0);
  });

  test('un panier récupéré en test sans commande de test sur la période : la ligne le dit, sans « 0 commandes »', async ({ page }) => {
    await mock(page, { ventes: { reel: { totaux: [], sources: [] }, test: { totaux: [], sources: [] }, paniers: { relances: 1, recuperes: 0, montants: [], recuperesTest: 1 } } });
    await page.goto('/dashboard/shopify');
    await expect(page.getByTestId('ventes-tests')).toContainText(/1 panier relancé récupéré|1 reminded checkout recovered/);
    await expect(page.getByTestId('ventes-tests')).not.toContainText(/0 commandes|0 test orders/);
  });

  test('🔴 le ROI : dépensé, ramené, pourcentage, deux courbes, et « Par source » parti de ce qui a coûté', async ({ page }) => {
    await mock(page, { roi: ROI });
    await page.goto('/dashboard/shopify');
    await expect(page.getByTestId('roi-depense')).toContainText(/7,50\s€|€7\.50/);
    await expect(page.getByTestId('roi-ramene')).toContainText(/170,50\s€|€170\.50/);
    await expect(page.getByTestId('roi-pct')).toContainText(/\+2\s173\s%|\+2,173 %/);
    await expect(page.getByTestId('roi-courbe-ramene')).toHaveCount(1);
    await expect(page.getByTestId('roi-courbe-depense')).toHaveCount(1);
    // Une autre devise se dit à part, jamais additionnée ; l'estimation se dit aussi.
    await expect(page.getByTestId('roi-autres-devises')).toContainText(/0,40\s\$US|\$0\.40/);
    await expect(page.getByTestId('roi-estime')).toBeVisible();
    await expect(page.getByTestId('roi-notes')).toContainText(/confirmations de commande|order confirmations/);
    // Le tableau part des coûts : une campagne sans vente y est, à -100 %, son coût annoncé comme un minimum.
    const sources = page.getByTestId('roi-sources');
    await expect(sources).toContainText(/Campagne « Soldes »|Campaign “Soldes”/);
    await expect(sources).toContainText(/Campagne « Muette »|Campaign “Muette”/);
    await expect(sources).toContainText('-100 %');
    await expect(sources).toContainText(/minimum/);
    // La part prouvée de « Soldes » vient du chiffre voisin (100,50).
    await expect(sources).toContainText(/100,50\s€|€100\.50/);
    await expect(page.getByTestId('ventes-sources')).toHaveCount(0);
  });

  test('aucun coût sur la période : pas de pourcentage, la phrase le dit', async ({ page }) => {
    await mock(page, { roi: { ...ROI, depense: 0, roiPct: null, sources: [], autresDevises: [], estime: false } });
    await page.goto('/dashboard/shopify');
    await expect(page.getByTestId('roi-pct')).toContainText(/aucun coût sur la période|no cost in the period/);
    // Sans ligne de ROI, le tableau des ventes d'avant revient.
    await expect(page.getByTestId('ventes-sources')).toBeVisible();
  });

  test('🔴 la route du ROI absente (console publiée avant l’API) : la page reste celle d’avant, sans la carte', async ({ page }) => {
    await mock(page, { roi: 404 });
    await page.goto('/dashboard/shopify');
    await expect(page.getByTestId('ventes-total-EUR')).toBeVisible();
    await expect(page.getByTestId('ventes-sources')).toBeVisible();
    await expect(page.getByTestId('roi-carte')).toHaveCount(0);
  });

  /**
   * LA CARTE « JOIGNABILITÉ WHATSAPP » (segments Shopify enrichis, lot 2b) : les deux nombres côte à côte, le taux en
   * COMMANDES (jamais messages sur commandes), les quatre parts dans l'ordre, la ligne des deux messages, le test à part.
   */
  test('🔴 la joignabilité : commandes expédiées, messages livrés, taux en commandes, les quatre parts, le test à part', async ({ page }) => {
    await mock(page, { joignabilite: JOIGNABILITE });
    await page.goto('/dashboard/shopify');
    await expect(page.getByTestId('joignabilite-expediees')).toHaveText('128');
    await expect(page.getByTestId('joignabilite-messages')).toHaveText('96');
    await expect(page.getByTestId('joignabilite-taux')).toContainText(/58 %/);
    await expect(page.getByTestId('joignabilite-taux')).toContainText(/pas seulement accepté par Meta|not just accepted by Meta/);
    await expect(page.getByTestId('joignabilite-sans-numero')).toContainText(/20 sans numéro|20 without a number/);
    await expect(page.getByTestId('joignabilite-sans-numero')).toContainText('16 %');
    await expect(page.getByTestId('joignabilite-invalides')).toContainText(/8 numéro invalide ou fixe|8 invalid or landline number/);
    await expect(page.getByTestId('joignabilite-supprimees')).toContainText(/12 échec, contact supprimé|12 failed, contact deleted/);
    await expect(page.getByTestId('joignabilite-attente')).toContainText(/14 en attente|14 awaiting/);
    await expect(page.getByTestId('joignabilite-deux-messages')).toBeVisible();
    await expect(page.getByTestId('joignabilite-tests')).toContainText(/3 commandes de test|3 test orders/);
    // Une API à cinq parts (d'avant le lot 3) : pas de sixième ligne, ses commandes sont « en attente ».
    await expect(page.getByTestId('joignabilite-pas-livrable')).toHaveCount(0);
  });

  test('🔴 la sixième part (lot 3) : « pas de message livrable », sortie de l’attente, dans le total', async ({ page }) => {
    await mock(page, { joignabilite: { ...JOIGNABILITE, enAttente: 10, pasLivrable: 4 } });
    await page.goto('/dashboard/shopify');
    await expect(page.getByTestId('joignabilite-attente')).toContainText(/10 en attente|10 awaiting/);
    await expect(page.getByTestId('joignabilite-pas-livrable')).toContainText(/4 pas de message livrable|4 no deliverable message/);
    await expect(page.getByTestId('joignabilite-pas-livrable')).toContainText('3 %');
  });

  test('🔴 aucune commande expédiée : la phrase le dit, jamais « 0 % »', async ({ page }) => {
    await mock(page, { joignabilite: { expediees: 0, messagesLivres: 0, livrees: 0, supprimees: 0, sansNumero: 0, invalides: 0, enAttente: 0, testExpediees: 0 } });
    await page.goto('/dashboard/shopify');
    await expect(page.getByTestId('joignabilite-vide')).toBeVisible();
    await expect(page.getByTestId('joignabilite-taux')).toHaveCount(0);
    await expect(page.getByTestId('joignabilite-parts')).toHaveCount(0);
    await expect(page.getByTestId('joignabilite-carte')).not.toContainText('%');
  });

  test('🔴 la route de la joignabilité absente ou illisible : la page reste celle d’avant, sans la carte', async ({ page }) => {
    await mock(page, { joignabilite: 404 });
    await page.goto('/dashboard/shopify');
    await expect(page.getByTestId('ventes-total-EUR')).toBeVisible();
    await expect(page.getByTestId('joignabilite-carte')).toHaveCount(0);
    // Des parts qui ne font pas le total : illisible, pas de carte plutôt qu'une répartition fausse.
    await mock(page, { joignabilite: { ...JOIGNABILITE, enAttente: 15 } });
    await page.goto('/dashboard/shopify');
    await expect(page.getByTestId('ventes-total-EUR')).toBeVisible();
    await expect(page.getByTestId('joignabilite-carte')).toHaveCount(0);
  });

  test('la console publiée avant l’API : « pas encore disponible »', async ({ page }) => {
    await mock(page, { statut: 404 });
    await page.goto('/dashboard/shopify');
    await expect(page.getByTestId('ventes-indisponible')).toBeVisible();
  });
});
