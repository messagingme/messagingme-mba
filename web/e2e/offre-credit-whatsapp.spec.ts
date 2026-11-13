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
const vueOffre = (onglet: boolean, plus: Record<string, unknown> = {}) => ({
  offre: 'pro', fonctions: PRO, limites: LIMITES, usage: { envoisModelesMois: null, contacts: 12, automations: 1, membres: 2 },
  grille: { free: { fonctions: [], limites: LIMITES }, pro: { fonctions: PRO, limites: LIMITES }, entreprise: { fonctions: PRO, limites: LIMITES } },
  prixPro: null, essai: null, sieges: null, suiteDuNumero: null, abonnement: null, upgradeUrl: 'https://console.e2e.test/offre',
  ongletCreditWhatsapp: onglet, ...plus,
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
  /** La réponse à la prise de l'option (POST) et au changement de ses places (PATCH). */
  option?: { status: number; body: unknown };
  places?: { status: number; body: unknown };
  /** Ce que la vue de l'offre change (l'offre, l'abonnement en essai, ses prix). */
  vueOffre?: Record<string, unknown>;
  /**
   * La configuration de la fenêtre de Meta, dont `solutionId` (la fenêtre du partenaire, que le serveur n'ouvre qu'à un
   * espace sans numéro). Absente, le serveur simulé rend `{}` : aucune fenêtre.
   */
  solution?: string | null;
}

/** Le texte validé par Julien le 2026-11-13 (version A) : l'option ne se vend plus à un numéro connecté avec sa carte. */
const NUMERO_AVEC_CARTE = 'Votre numéro est connecté avec votre carte chez Meta : la ligne de crédit ne peut pas le prendre en charge. Pour changer, écrivez au Support.';

/** L'option en vente, pas encore prise (lot 4a) : 30 € HT par numéro et par mois, de 1 à 20 numéros. */
const OPTION = { disponible: true, prixHtCentimes: 3000, placesMax: 20, places: 0, couverts: 0, statut: null, finPrevueLe: null };
const PORTAIL = 'https://billing.stripe.com/p/session/test_e2e';
/** Un Pro sans numéro sur le Crédit WhatsApp : l'onglet paraît pour l'option, la recharge attend un numéro. */
const SANS_NUMERO = { soldeMicroEur: 0, historique: [], achat: { disponible: true, permis: 'sans_ligne', offres: credit().achat.offres } };

async function monter(page: Page, o: Options = {}) {
  const achats: unknown[] = [];
  const options: unknown[] = [];
  const changements: unknown[] = [];
  const factures: string[] = [];
  /** Les fins de la fenêtre de Meta reçues (`POST /embedded-signup/complete`, V4). */
  const fins: unknown[] = [];
  const vues = [...(o.vues ?? [credit()])];
  let lectures = 0;
  let demarrages = 0;
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), o.session ?? ADMIN);
  await page.route(`${PAGE_STRIPE}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe Checkout (e2e)</h1>' }));
  await page.route(`${PORTAIL}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Portail Stripe (e2e)</h1>' }));
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname;
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/credit-whatsapp/achat') && req.method() === 'POST') {
      achats.push(req.postDataJSON());
      const a = o.achat ?? { status: 200, body: { url: PAGE_STRIPE } };
      return json(a.body, a.status);
    }
    if (chemin.endsWith('/credit-whatsapp/option') && req.method() === 'POST') {
      options.push(req.postDataJSON());
      const a = o.option ?? { status: 200, body: { url: PAGE_STRIPE } };
      return json(a.body, a.status);
    }
    if (chemin.endsWith('/credit-whatsapp/option') && req.method() === 'PATCH') {
      changements.push(req.postDataJSON());
      const a = o.places ?? { status: 200, body: { places: 0 } };
      return json(a.body, a.status);
    }
    if (chemin.endsWith('/offre/portail') && req.method() === 'POST') return json({ url: PORTAIL });
    // Plus aucun écran de l'option ne démarre la formule Pro (lot 3v) : un appel ici serait compté, et refusé par le test.
    if (chemin.endsWith('/offre/pro/demarrer') && req.method() === 'POST') {
      demarrages += 1;
      return json({ essaiFini: true, paye: true });
    }
    if (chemin.endsWith('/offre/tarif')) return json({ proHtCentimes: 4900, siegeHtCentimes: null, remise: false });
    if (chemin.endsWith('/credit-whatsapp')) {
      lectures += 1;
      return json(vues.length > 1 ? vues.shift()! : vues[0]!);
    }
    if (chemin.includes('/credit/factures/')) {
      factures.push(chemin);
      return json({ error: 'paiement inconnu', code: 'paiement_inconnu' }, 404);
    }
    if (chemin.endsWith('/offre')) return json(vueOffre(o.onglet ?? true, o.vueOffre ?? {}));
    if (chemin.endsWith('/offre/factures')) return json({ plusSurStripe: false, factures: [] });
    if (chemin.endsWith('/agents/solde')) return json({ soldeMicroEur: 3_000_000 });
    if (chemin.endsWith('/agents/mouvements')) return json({ mouvements: [] });
    if (chemin.endsWith('/unread-count')) return json({ count: 0 });
    if (chemin.endsWith('/me')) return json({ email: ADMIN.email, name: 'Jean Test', role: 'admin' });
    if (o.solution !== undefined && chemin.endsWith('/embedded-signup/config')) {
      return json({ enabled: true, appId: 'app-e2e', configId: 'cfg-e2e', graphVersion: 'v25.0', solutionId: o.solution });
    }
    if (chemin.endsWith('/embedded-signup/complete') && req.method() === 'POST') {
      fins.push(req.postDataJSON());
      return json({ connected: true, wabaId: 'w-e2e', phoneNumberId: 'pn-e2e', displayPhoneNumber: '+33 6 00 00 00 00', warnings: [] });
    }
    return json({});
  });
  return { achats, options, changements, factures, fins, lectures: () => lectures, demarrages: () => demarrages };
}

test.describe('Paramètres > Offre > Ligne de crédit', () => {
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
    await expect(page.getByTestId('credit-wa-retour-recu')).toContainText(/votre ligne de crédit est rechargée dans quelques secondes/);
    await expect(page.getByTestId('credit-wa-solde')).toContainText('50,00', { timeout: 10_000 });
    await expect(page.getByTestId('credit-wa-retour-recu')).toContainText(/votre ligne de crédit est à jour/);
    expect(m.lectures()).toBeGreaterThanOrEqual(2);
  });

  test('🔴 une Entreprise, illimitée : « Illimitée » et les messages du mois, ni solde, ni alerte, ni bouton d’achat', async ({ page }) => {
    // Son solde peut valoir zéro : il ne bouge pas et n'arrête rien (décision du 2026-11-02), l'écran ne doit pas le dire épuisé.
    await monter(page, { vues: [credit({ illimite: true, soldeMicroEur: 0, consommationDuMoisMicroEur: 2_149_520, achat: { disponible: true, permis: 'open_bar', offres: [] } })] });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-illimite')).toHaveText('Illimitée');
    await expect(page.getByTestId('credit-wa-conso-mois')).toContainText('2,15');
    await expect(page.getByTestId('credit-wa-conso-mois')).toContainText(/selon votre contrat/);
    for (const alerte of ['credit-wa-epuise', 'credit-wa-presque-epuise', 'credit-wa-bas', 'credit-wa-recharger']) {
      await expect(page.getByTestId(alerte), alerte).toHaveCount(0);
    }
    // Les prix et l'historique restent : ils expliquent la facture.
    await expect(page.getByTestId('credit-wa-prix').locator('[data-categorie="marketing"]')).toContainText('0,0748');
    await expect(page.locator('[data-raison="envois"]')).toContainText('Envois du 30/10 (2 messages)');
  });

  test('🔴 la courbe de 90 jours : le solde d’un prépayé ; la consommation d’une Entreprise, dont l’historique perd son « moins »', async ({ page }) => {
    const SERIE = [
      { jour: '2026-10-30', soldeMicroEur: 37_399_520, consommationMicroEur: 149_520 },
      { jour: '2026-11-02', soldeMicroEur: 37_250_000, consommationMicroEur: 149_520 },
    ];
    await monter(page, { vues: [credit({ serie: SERIE })] });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-courbe')).toHaveAttribute('data-genre', 'solde');
    await expect(page.getByTestId('credit-wa-courbe')).toContainText(/37,25\s€/);
    await expect(page.getByTestId('credit-wa-montant').first()).toHaveText(/^-0,1495\s€$|^-0,15\s€$/);
  });

  test('🔴 une Entreprise : sa courbe est sa consommation, ses envois sans « moins »', async ({ page }) => {
    const SERIE = [{ jour: '2026-11-02', soldeMicroEur: 0, consommationMicroEur: 149_520 }];
    await monter(page, { vues: [credit({ illimite: true, soldeMicroEur: 0, consommationDuMoisMicroEur: 149_520, achat: { disponible: true, permis: 'open_bar', offres: [] }, serie: SERIE })] });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-courbe')).toHaveAttribute('data-genre', 'consommation');
    for (const texte of await page.getByTestId('credit-wa-montant').allTextContents()) expect(texte).not.toMatch(/^-/);
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
    await expect(page.getByTestId('credit-wa-presque-epuise')).toHaveCount(0);
  });

  test('🔴 sous un euro, presque épuisé : ce reste ne couvre déjà plus certains messages', async ({ page }) => {
    await monter(page, { vues: [credit({ soldeMicroEur: 40_000 })] });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-presque-epuise')).toContainText(/ne couvre déjà plus certains messages/);
    await expect(page.getByTestId('credit-wa-bas')).toHaveCount(0);
    await expect(page.getByTestId('credit-wa-epuise')).toHaveCount(0);
  });

  test('🔴 les numéros arrêtés : on le dit, et aucun bouton d’achat', async ({ page }) => {
    await monter(page, { vues: [credit({ soldeMicroEur: 0, ligneArretee: true, achat: { disponible: true, permis: 'sans_ligne', offres: credit().achat.offres } })] });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-ligne-arretee')).toBeVisible();
    await expect(page.getByTestId('credit-wa-offre-wa_50')).toHaveCount(0);
    await expect(page.getByTestId('credit-wa-epuise')).toHaveCount(0);
  });

  test('🔴 l’option arrêtée (lot C, moment 3) : la sortie dite, « Reprendre l’option » mène à sa section, la carte chez Meta à Connecter WhatsApp', async ({ page }) => {
    const arretee = credit({
      soldeMicroEur: 12_000_000, ligneArretee: true, optionArretee: true,
      achat: { disponible: true, permis: 'sans_ligne', offres: credit().achat.offres }, option: { ...OPTION, formulePayee: true },
    });
    await monter(page, { vues: [arretee] });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-arretee')).toContainText(
      'Vos envois par la ligne de crédit sont arrêtés, votre solde est conservé. Pour envoyer de nouveau : reprenez l’option, ou connectez votre numéro avec votre carte chez Meta.',
    );
    // L'ancien avis (« contactez-nous ») reste aux lignes posées à la main : jamais les deux.
    await expect(page.getByTestId('credit-wa-ligne-arretee')).toHaveCount(0);
    await expect(page.getByTestId('credit-wa-offre-wa_50')).toHaveCount(0);
    await expect(page.getByTestId('credit-wa-option-arretee-meta')).toHaveAttribute('href', '/connecter-whatsapp');
    await page.getByTestId('credit-wa-option-arretee-reprendre').click();
    await expect(page.getByTestId('credit-wa-option-prendre')).toBeInViewport();
  });

  test('l’option arrêtée hors vente : la carte chez Meta et le Support, jamais « Reprendre l’option »', async ({ page }) => {
    await monter(page, {
      vues: [credit({
        soldeMicroEur: 0, ligneArretee: true, optionArretee: true,
        achat: { disponible: true, permis: 'sans_ligne', offres: credit().achat.offres }, option: { ...OPTION, disponible: false, formulePayee: true },
      })],
    });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-arretee')).toContainText('Sur demande : écrivez-nous depuis le Support.');
    await expect(page.getByTestId('credit-wa-option-arretee-reprendre')).toHaveCount(0);
    await expect(page.getByTestId('credit-wa-option-arretee-meta')).toBeVisible();
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

  test('🔴 une recharge payée depuis Claude revient sur la page publique, qui parle de la ligne de crédit (pas du numéro)', async ({ page }) => {
    // `buy_credit` renvoie ici (`?produit=credit_whatsapp`), sans session : la page tombait sur le texte du numéro.
    await page.goto('/paiement-recu?produit=credit_whatsapp');
    await expect(page.getByTestId('paiement-recu')).toContainText('recharge de votre ligne de crédit');
    await expect(page.getByTestId('paiement-recu')).not.toContainText('numéro');
    await page.goto('/paiement-recu?produit=credit_whatsapp&abonnement=abandon');
    await expect(page.getByTestId('paiement-abandonne')).toBeVisible();
  });

  test('🔴 l’option prise depuis Claude (take_credit_line) revient sur la page publique, qui parle de l’option et de la suite (le lien du numéro)', async ({ page }) => {
    // Sans ce cas, `?produit=option_credit_whatsapp` retombe sur le texte du réabonnement du numéro.
    await page.goto('/paiement-recu?produit=option_credit_whatsapp');
    await expect(page.getByTestId('paiement-recu')).toContainText('votre option ligne de crédit');
    await expect(page.getByTestId('paiement-recu')).not.toContainText('réabonnement');
    await page.goto('/paiement-recu?produit=option_credit_whatsapp&abonnement=abandon');
    await expect(page.getByTestId('paiement-abandonne')).toBeVisible();
  });

  test('🔴 un compte NON ADMIN n’y entre pas : aucun bouton d’achat ne lui est offert', async ({ page }) => {
    const m = await monter(page, { session: AGENT });
    await page.goto('/offre?tab=whatsapp');
    await expect(page).toHaveURL(/\/inbox/);
    await expect(page.getByTestId('credit-wa-offre-wa_50')).toHaveCount(0);
    expect(m.achats).toEqual([]);
  });
});

/**
 * L'OPTION DU CRÉDIT WHATSAPP (lot 4a, 30 € HT par numéro et par mois) : un Pro ou un Business la prend dans l'onglet, pour
 * 1 à 20 numéros, puis en change le nombre un numéro à la fois, le prix dit avant toute facture. Stripe est simulé.
 */
test.describe('Paramètres > Offre > Ligne de crédit : l’option', () => {
  test('🔴 un Pro sans numéro sur la ligne de crédit : l’option proposée, jamais « épuisé », et la prendre ouvre Stripe', async ({ page }) => {
    const m = await monter(page, { vues: [credit({ ...SANS_NUMERO, option: OPTION })] });
    await page.goto('/offre?tab=whatsapp');
    const section = page.getByTestId('credit-wa-option');
    await expect(section).toContainText('30 € HT par numéro et par mois');
    // Ses messages ne passent pas par le solde : un zéro n'y est pas « épuisé ».
    await expect(page.getByTestId('credit-wa-solde')).toContainText('0,00');
    for (const alerte of ['credit-wa-epuise', 'credit-wa-presque-epuise', 'credit-wa-bas']) {
      await expect(page.getByTestId(alerte), alerte).toHaveCount(0);
    }
    await expect(page.getByTestId('credit-wa-ferme')).toContainText('avec l’option ci-dessus');
    await page.getByTestId('credit-wa-option-places').selectOption('2');
    await expect(page.getByTestId('credit-wa-option-prendre')).toHaveText(/Prendre l’option, 60 € HT par mois/);
    await page.getByTestId('credit-wa-option-prendre').click();
    await expect(page).toHaveURL(PAGE_STRIPE);
    expect(m.options).toEqual([{ places: 2 }]);
  });

  test('🔴 une API d’avant l’option, ou une Entreprise : aucune section de l’option', async ({ page }) => {
    await monter(page);
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-solde')).toContainText('37,25');
    await expect(page.getByTestId('credit-wa-option')).toHaveCount(0);
  });

  test('une Entreprise, même l’option en vente : illimitée, sans option', async ({ page }) => {
    await monter(page, { vues: [credit({ illimite: true, soldeMicroEur: 0, achat: { disponible: true, permis: 'open_bar', offres: [] }, option: OPTION })] });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-illimite')).toBeVisible();
    await expect(page.getByTestId('credit-wa-option')).toHaveCount(0);
  });

  test('🔴 le RETOUR du paiement de l’option ne prend rien : il relit jusqu’à voir ses places', async ({ page }) => {
    const prise = { ...OPTION, places: 1, statut: 'actif' };
    const sans = credit({ ...SANS_NUMERO, option: OPTION });
    const m = await monter(page, { vues: [sans, sans, credit({ ...SANS_NUMERO, option: prise })] });
    await page.goto('/offre?tab=whatsapp&option=recue');
    await expect(page.getByTestId('credit-wa-option-recue')).toContainText('arrive dans quelques secondes');
    // 🔴 Payée, pas encore arrivée : rien ne se reprend (relecture du lot 4a-2, elle serait payée deux fois). Relevé TOUT DE
    // SUITE, dans le rendu qui porte la notice : un `toHaveCount(0)` attendrait l'option arrivée et passerait sans la garde.
    expect(await page.getByTestId('credit-wa-option-prendre').count()).toBe(0);
    expect(await page.getByTestId('credit-wa-option-places').count()).toBe(0);
    await expect(page.getByTestId('credit-wa-option-recue')).toContainText('votre option est active', { timeout: 15_000 });
    await expect(page.getByTestId('credit-wa-option-payes')).toHaveText('1');
    await expect(page.getByTestId('credit-wa-option-libre')).toContainText('contactez-nous depuis le Support');
    expect(m.lectures()).toBeGreaterThanOrEqual(2);
    expect(m.options).toEqual([]);
  });

  test('🔴 une place payée et le numéro connecté avec sa carte : le texte validé, plus aucune reconnexion (décision de Julien du 2026-11-13)', async ({ page }) => {
    // Meta refuse qu'un compte que nous servons déjà en direct repasse par la fenêtre du partenaire (#2494156) : l'ancienne
    // reconnexion de l'onglet (V4) ne passerait jamais. Même une configuration qui rendrait la solution n'y change rien.
    const payee = { ...OPTION, places: 1, couverts: 0, statut: 'actif', numeroAvecCarte: true };
    const m = await monter(page, { vues: [credit({ ...SANS_NUMERO, option: payee })], solution: 'sol-e2e' });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-numero-carte')).toHaveText(NUMERO_AVEC_CARTE);
    await expect(page.getByTestId('credit-wa-option-numero-carte').getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support');
    await expect(page.getByTestId('credit-wa-option-libre')).toHaveCount(0);
    await expect(page.getByTestId('credit-wa-connecter')).toHaveCount(0);
    expect(m.fins).toEqual([]);
  });

  test('sans numéro, la fenêtre du partenaire ouverte : l’onglet mène à Connecter WhatsApp', async ({ page }) => {
    await monter(page, {
      vues: [credit({ ...SANS_NUMERO, option: { ...OPTION, places: 1, couverts: 0, statut: 'actif' } })],
      solution: 'sol-e2e',
    });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-libre')).toContainText('1 numéro payé pas encore sur la ligne de crédit : connectez votre numéro sans carte chez Meta.');
    await expect(page.getByTestId('credit-wa-connecter')).toHaveAttribute('href', '/connecter-whatsapp');
  });

  test('🔴 la fenêtre fermée par le serveur (un numéro déjà là, rien de configuré) : le Support, aucun bouton', async ({ page }) => {
    await monter(page, {
      vues: [credit({ ...SANS_NUMERO, option: { ...OPTION, places: 1, couverts: 0, statut: 'actif' } })],
      solution: null,
    });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-libre')).toHaveText('1 numéro payé pas encore sur la ligne de crédit : contactez-nous depuis le Support pour y mettre votre numéro.');
    await expect(page.getByTestId('credit-wa-connecter')).toHaveCount(0);
  });

  test('🔴 l’option payée qui tarde : toutes les relectures faites, l’écran le dit, et la prise reste fermée', async ({ page }) => {
    // Dix relectures toutes les 3 s : le scénario dure plus que le délai par défaut.
    test.setTimeout(60_000);
    const m = await monter(page, { vues: [credit({ ...SANS_NUMERO, option: OPTION })] });
    await page.goto('/offre?tab=whatsapp&option=recue');
    await expect(page.getByTestId('credit-wa-option-recue')).toContainText('pas encore arrivée', { timeout: 45_000 });
    await expect(page.getByTestId('credit-wa-option-recue')).toContainText('sans la reprendre');
    await expect(page.getByTestId('credit-wa-option-prendre')).toHaveCount(0);
    expect(m.lectures()).toBeGreaterThanOrEqual(10);
    expect(m.options).toEqual([]);
  });

  test('🔴 un numéro de plus : son prix dit avant la facture ; un prorata impayé donne la page de sa facture', async ({ page }) => {
    const facture = 'https://invoice.stripe.com/i/acct_e2e/test_place';
    const m = await monter(page, {
      vues: [credit({ option: { ...OPTION, places: 2, couverts: 1, statut: 'actif' } })],
      places: { status: 402, body: { error: 'Le paiement du numéro en plus n’a pas abouti : réglez la facture sur sa page, puis recommencez.', code: 'paiement_place_incomplet', url: facture } },
    });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-payes')).toHaveText('2');
    await expect(page.getByTestId('credit-wa-option-couverts')).toHaveText('1');
    await page.getByTestId('credit-wa-option-ajouter').click();
    await expect(page.getByTestId('credit-wa-option-confirmer')).toContainText(/30 € HT par mois : le prorata .* est facturé maintenant/);
    // Rien ne part avant la confirmation.
    expect(m.changements).toEqual([]);
    await page.getByTestId('credit-wa-option-valider').click();
    await expect(page.getByTestId('credit-wa-option-erreur')).toContainText('n’a pas abouti');
    await expect(page.getByTestId('credit-wa-option-facture')).toHaveAttribute('href', facture);
    expect(m.changements).toEqual([{ depuis: 2, cible: 3 }]);
  });

  test('🔴 un retrait ne passe pas sous les numéros sur la ligne de crédit, et part depuis les places lues', async ({ page }) => {
    const pleine = await monter(page, { vues: [credit({ option: { ...OPTION, places: 2, couverts: 2, statut: 'actif' } })] });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-retirer')).toBeDisabled();
    expect(pleine.changements).toEqual([]);
  });

  test('un retrait possible : annoncé sans remboursement, puis envoyé et relu', async ({ page }) => {
    const m = await monter(page, {
      vues: [credit({ option: { ...OPTION, places: 3, couverts: 2, statut: 'actif' } }), credit({ option: { ...OPTION, places: 2, couverts: 2, statut: 'actif' } })],
      places: { status: 200, body: { places: 2 } },
    });
    await page.goto('/offre?tab=whatsapp');
    await page.getByTestId('credit-wa-option-retirer').click();
    await expect(page.getByTestId('credit-wa-option-confirmer')).toContainText('sans remboursement du mois entamé');
    await page.getByTestId('credit-wa-option-valider').click();
    await expect(page.getByTestId('credit-wa-option-payes')).toHaveText('2');
    expect(m.changements).toEqual([{ depuis: 3, cible: 2 }]);
    await expect(page.getByTestId('credit-wa-option-retirer')).toBeDisabled();
  });

  test('🔴 un numéro du compte au-delà des places : l’écran dit qu’il n’envoie pas', async ({ page }) => {
    await monter(page, { vues: [credit({ option: { ...OPTION, places: 1, couverts: 2, statut: 'actif' } })] });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-couverts')).toHaveText('1');
    await expect(page.getByTestId('credit-wa-option-manque')).toContainText('1 numéro de votre compte WhatsApp n’envoie pas');
  });

  test('🔴 un renouvellement impayé, une fin programmée : dits, et plus de changement de places', async ({ page }) => {
    await monter(page, { vues: [credit({ option: { ...OPTION, places: 2, couverts: 1, statut: 'en_retard', finPrevueLe: '2026-11-30T10:00:00.000Z' } })] });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-retard')).toContainText('Stripe le retente');
    await expect(page.getByTestId('credit-wa-option-fin')).toContainText('30/11/2026');
    await expect(page.getByTestId('credit-wa-option-ajouter')).toHaveCount(0);
    await expect(page.getByTestId('credit-wa-option-retirer')).toHaveCount(0);
    // La carte se met à jour au portail de Stripe.
    await page.getByTestId('credit-wa-option-portail').click();
    await expect(page).toHaveURL(PORTAIL);
  });
});

/**
 * LA PRISE DE L'OPTION SELON LE SERVEUR (lot 3v, V1 du 2026-11-10) : la règle est `option.prisePossible`, lue telle
 * quelle. Un Pro la prend dès le début de son essai, sa formule pas encore payée ; un Business en essai et un Pro en
 * retard de paiement attendent, et l'onglet dit pourquoi dans les mots du refus du serveur. Plus de « Démarrer la formule
 * Pro maintenant ». L'abonnement ne choisit que les mots.
 */
test.describe('Paramètres > Offre > Ligne de crédit : la prise de l’option, essai compris', () => {
  const ESSAI = {
    statut: 'essai', periodicite: 'mois', debutLe: '2026-11-01T09:00:00.000Z', prochaineEcheanceLe: '2099-11-15T09:00:00.000Z',
    finPrevueLe: null, essaiFinLe: '2099-11-15T09:00:00.000Z', finiLe: null, finRaison: null,
  };
  const EN_ESSAI = { abonnement: ESSAI, prixPro: { moisCentimes: 4900, anCentimes: 49000 } };
  const EN_RETARD = { abonnement: { ...ESSAI, statut: 'en_retard', essaiFinLe: null }, prixPro: EN_ESSAI.prixPro };
  const PRISE_EN_ESSAI = credit({ ...SANS_NUMERO, option: { ...OPTION, formulePayee: false, prisePossible: true } });
  const ATTENTE = (formulePayee: boolean) => credit({ ...SANS_NUMERO, option: { ...OPTION, formulePayee, prisePossible: false } });

  test('🔴 un Pro en essai prend l’option tout de suite : « Prendre l’option » pour ses numéros, sans démarrer sa formule', async ({ page }) => {
    const m = await monter(page, { vues: [PRISE_EN_ESSAI], vueOffre: EN_ESSAI });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-essai')).toHaveCount(0);
    await expect(page.getByTestId('credit-wa-option-demarrer')).toHaveCount(0);
    await page.getByTestId('credit-wa-option-places').selectOption('2');
    await expect(page.getByTestId('credit-wa-option-prendre')).toHaveText(/Prendre l’option, 60 € HT par mois/);
    await page.getByTestId('credit-wa-option-prendre').click();
    await expect(page).toHaveURL(PAGE_STRIPE);
    expect([m.demarrages(), m.options]).toEqual([0, [{ places: 2 }]]);
  });

  test('🔴 un Business en essai : l’explication et la raison du serveur, ni démarrage ni prise', async ({ page }) => {
    const m = await monter(page, { vues: [ATTENTE(false)], vueOffre: { offre: 'business' } });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-essai')).toContainText('vient avec la formule payante');
    await expect(page.getByTestId('credit-wa-option-attente')).toHaveText('L’option Ligne de crédit s’ouvre quand votre formule Business est confirmée.');
    await expect(page.getByTestId('credit-wa-option-demarrer')).toHaveCount(0);
    await expect(page.getByTestId('credit-wa-option-prendre')).toHaveCount(0);
    expect(m.options).toEqual([]);
  });

  test('🔴 un Pro en retard de paiement : la raison du serveur, sans parler d’essai, ni prise', async ({ page }) => {
    await monter(page, { vues: [ATTENTE(true)], vueOffre: EN_RETARD });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-attente')).toHaveText('Le paiement de votre formule Pro est en retard : réglez-le, puis prenez l’option. Mettez à jour votre carte dans l’onglet Offre.');
    await expect(page.getByTestId('credit-wa-option-essai')).not.toContainText('Pendant l’essai');
    await expect(page.getByTestId('credit-wa-option-prendre')).toHaveCount(0);
  });

  test('🔴 une API d’avant V1, sans la prise possible : la formule pas payée attend, comme avant, sans démarrage', async ({ page }) => {
    await monter(page, { vues: [credit({ ...SANS_NUMERO, option: { ...OPTION, formulePayee: false } })], vueOffre: { offre: 'business' } });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-attente')).toBeVisible();
    await expect(page.getByTestId('credit-wa-option-prendre')).toHaveCount(0);
    await expect(page.getByTestId('credit-wa-option-demarrer')).toHaveCount(0);
  });

  test('🔴 tous les numéros gardent l’application : l’avertissement avant « Prendre l’option » (décision 8)', async ({ page }) => {
    await monter(page, { vues: [credit({ ...SANS_NUMERO, option: { ...OPTION, formulePayee: false, prisePossible: true, avecApplication: true } })], vueOffre: EN_ESSAI });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-avertissement')).toContainText('la ligne de crédit n’est pas possible avec l’application');
    await expect(page.getByTestId('credit-wa-option-prendre')).toBeVisible();
  });

  test('🔴 un Pro en essai dont le numéro est connecté avec sa carte : le texte validé à la place de « Prendre l’option », sans explication de l’essai (décision de Julien du 2026-11-13)', async ({ page }) => {
    const avecCarte = credit({ ...SANS_NUMERO, option: { ...OPTION, formulePayee: false, prisePossible: false, numeroAvecCarte: true } });
    const m = await monter(page, { vues: [avecCarte], vueOffre: EN_ESSAI });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-numero-carte')).toHaveText(NUMERO_AVEC_CARTE);
    await expect(page.getByTestId('credit-wa-option-prendre')).toHaveCount(0);
    await expect(page.getByTestId('credit-wa-option-places')).toHaveCount(0);
    await expect(page.getByTestId('credit-wa-option-essai')).toHaveCount(0);
    expect(m.options).toEqual([]);
  });

  test('🔴 la formule payée : « Prendre l’option », sans explication de l’attente', async ({ page }) => {
    await monter(page, { vues: [credit({ ...SANS_NUMERO, option: { ...OPTION, formulePayee: true, prisePossible: true } })], vueOffre: EN_ESSAI });
    await page.goto('/offre?tab=whatsapp');
    await expect(page.getByTestId('credit-wa-option-prendre')).toBeVisible();
    await expect(page.getByTestId('credit-wa-option-essai')).toHaveCount(0);
  });
});
