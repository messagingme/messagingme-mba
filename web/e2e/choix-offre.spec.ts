import { test, expect, type Page } from './aide/test';
import { mockAccueil } from './support/accueil';

/**
 * LA FORMULE D'ABORD (lot 3b, Julien, 2026-11-09) : le premier écran d'un espace neuf en Free
 * (`/connecter-whatsapp?suite=demarrer`) pose « Quelle formule voulez-vous ? » et ses quatre cartes, avant « Qui paie vos
 * messages à Meta ? ». Free continue ; Pro ouvre la page de Stripe, mensuelle, avec l'essai, puis revient au numéro
 * (décision du 2026-11-10) ; Business et Entreprise vont au formulaire de contact. Le serveur est simulé, rien ne part
 * chez Stripe.
 */
const SANS_NUMERO = { hasNumber: false, phoneNumberId: null, number: null, numberStatus: null, codeVerificationStatus: null, status: { dot: 'grey', label: 'Aucun numéro', reason: 'Aucun numéro connecté.' } };
const PAGE_STRIPE = 'https://checkout.stripe.com/c/pay/cs_test_pro_e2e';
const PRO = ['inbox', 'scenarios', 'statistiques', 'agent_meta', 'aide', 'assistants', 'email', 'console'];
const LIMITES = {
  utilisateurs: 3, admins: 2, contacts: 5000, envoisModelesMois: null, automations: null, suppressionsJour: null, adressesWebhook: 5,
  journalWebhooksJours: 30, conservationJours: 90, commissionPct: 20, badge: false, numeroInclus: true,
};
type Option = { offre?: string; prixPro?: unknown; essaiPossible?: boolean; paiement?: { status: number; body: unknown } };
const vueOffre = (o: Option) => ({
  offre: o.offre ?? 'base', fonctions: (o.offre ?? 'base') === 'base' ? [] : PRO, limites: LIMITES,
  usage: { envoisModelesMois: null, contacts: 0, automations: 0, membres: 1 },
  grille: { free: { fonctions: [], limites: LIMITES }, pro: { fonctions: PRO, limites: LIMITES }, entreprise: { fonctions: PRO, limites: LIMITES } },
  prixPro: o.prixPro === undefined ? { moisCentimes: 4900, anCentimes: 49000 } : o.prixPro,
  essai: { jours: 14, possible: o.essaiPossible ?? true, finLe: null }, sieges: null, suiteDuNumero: null, abonnement: null,
  upgradeUrl: 'https://console.e2e.test/offre', ongletCreditWhatsapp: false,
});

/** Le serveur de l'offre et du paiement du Pro ; le reste, celui de l'Accueil (`mockAccueil`, posé avant). */
async function simuler(page: Page, o: Option = {}) {
  const paiements: unknown[] = [];
  await page.route(`${PAGE_STRIPE}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe Checkout (e2e)</h1>' }));
  await page.route((url) => url.pathname.startsWith('/api/backend/'), async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname;
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/offre/paiement') && req.method() === 'POST') {
      paiements.push(req.postDataJSON());
      return o.paiement ? json(o.paiement.body, o.paiement.status) : json({ url: PAGE_STRIPE, portail: false, essaiJours: 14 });
    }
    if (chemin.endsWith('/credit-whatsapp/etat')) return json({ etat: 'a_prendre', enVente: false });
    if (chemin.endsWith('/offre/tarif')) return json({ proHtCentimes: 4900, siegeHtCentimes: null, remise: false });
    if (chemin.endsWith('/offre')) return json(vueOffre(o));
    return route.fallback();
  });
  return { paiements };
}

async function monter(page: Page, o: Option = {}) {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  return simuler(page, o);
}

test('🔴 un espace neuf en Free voit d’abord la formule ; Free mène à « Qui paie vos messages à Meta ? », et l’onglet s’en souvient', async ({ page }) => {
  await monter(page);
  await page.goto('/connecter-whatsapp?suite=demarrer');
  await expect(page.getByTestId('choix-offre')).toContainText('Quelle formule voulez-vous ?');
  for (const f of ['free', 'pro', 'business', 'entreprise']) await expect(page.getByTestId(`carte-offre-${f}`)).toBeVisible();
  // L'essai du Pro, en tête de sa carte (« on comprend rien sinon »), et le bouton qui le dit.
  await expect(page.getByTestId('carte-offre-pro').getByTestId('carte-offre-essai')).toHaveText('14 jours d’essai gratuit');
  await expect(page.getByTestId('offre-choisir-pro')).toHaveText('Essayer Pro 14 jours');
  await expect(page.getByTestId('carte-offre-pro')).toContainText('49 €');
  await expect(page.getByTestId('carte-offre-pro')).toContainText('HT par mois');
  await expect(page.getByTestId('carte-offre-free')).toContainText('Besoin d’un IDE : Claude Code ou Codex');
  // Avant la réponse, rien de la suite.
  await expect(page.getByTestId('qui-regle-meta')).toHaveCount(0);
  await expect(page.getByTestId('question-compte')).toHaveCount(0);
  await page.getByTestId('offre-nsp').click();
  await expect(page.getByTestId('offre-aide')).toContainText('Sans agent IA, choisissez Pro');
  await page.getByTestId('offre-choisir-free').click();
  await expect(page.getByTestId('choix-offre')).toHaveCount(0);
  await expect(page.getByTestId('qui-regle-meta')).toContainText('Qui paie vos messages à Meta ?');
  await page.reload();
  await expect(page.getByTestId('qui-regle-meta')).toBeVisible();
  await expect(page.getByTestId('choix-offre')).toHaveCount(0);
});

test('🔴 Pro ouvre la page de Stripe, mensuelle, avec l’essai (décision de Julien du 2026-11-10)', async ({ page }) => {
  const { paiements } = await monter(page);
  await page.goto('/connecter-whatsapp?suite=demarrer');
  await page.getByTestId('offre-choisir-pro').click();
  await expect(page).toHaveURL(/checkout\.stripe\.com/);
  expect(paiements).toEqual([{ periodicite: 'mois' }]);
});

test('Business et Entreprise mènent au formulaire de contact de la console, leur sujet prérempli', async ({ page }) => {
  await monter(page);
  await page.goto('/connecter-whatsapp?suite=demarrer');
  await expect(page.getByTestId('offre-choisir-entreprise')).toHaveAttribute('href', '/support?sujet=entreprise');
  await expect(page.getByTestId('offre-choisir-business')).toHaveAttribute('href', '/support?sujet=business');
  // Le formulaire de contact, à l'adresse du lien : son sujet prérempli.
  await page.goto('/support?sujet=business');
  await expect(page.getByTestId('support-sujet')).toHaveValue('Passer en Business');
});

test('un Pro pas en vente se demande au Support ; sans droit à l’essai, « Passer en Pro »', async ({ page }) => {
  await monter(page, { prixPro: null });
  await page.goto('/connecter-whatsapp?suite=demarrer');
  await expect(page.getByTestId('offre-choisir-pro-support')).toHaveAttribute('href', '/support?sujet=pro');
  await expect(page.getByTestId('offre-choisir-pro')).toHaveCount(0);
});

test('un espace qui a déjà eu son essai lit « Passer en Pro », et un refus du paiement se dit', async ({ page }) => {
  await monter(page, { essaiPossible: false, paiement: { status: 409, body: { error: 'Votre espace est en offre Business : la formule Pro ne lui ajouterait rien.', code: 'deja_business' } } });
  await page.goto('/connecter-whatsapp?suite=demarrer');
  await expect(page.getByTestId('offre-choisir-pro')).toHaveText('Passer en Pro');
  // Sans droit à l'essai, ni pastille ni promesse (jaune 2 de la relecture).
  await expect(page.getByTestId('carte-offre-essai')).toHaveCount(0);
  await page.getByTestId('offre-choisir-pro').click();
  await expect(page.getByTestId('choix-offre')).toContainText('Votre espace est en offre Business : la formule Pro ne lui ajouterait rien.');
  await expect(page).toHaveURL(/\/connecter-whatsapp/);
});

test('🔴 le retour de Stripe ramène au numéro, l’essai dit, même si l’offre se lit encore Free', async ({ page }) => {
  await monter(page);
  // Le premier écran pose la suite dans l'onglet ; Stripe revient ensuite sur la page de l'offre.
  await page.goto('/connecter-whatsapp?suite=demarrer');
  await expect(page.getByTestId('choix-offre')).toBeVisible();
  await page.goto('/offre?pro=recu');
  await expect(page).toHaveURL(/\/connecter-whatsapp\?suite=demarrer&pro=recu/);
  await expect(page.getByTestId('essai-pro-commence')).toContainText('Votre formule Pro est souscrite');
  await expect(page.getByTestId('choix-offre')).toHaveCount(0);
  await expect(page.getByTestId('qui-regle-meta')).toBeVisible();
});

test('un paiement abandonné repose la question de la formule', async ({ page }) => {
  await monter(page);
  await page.goto('/connecter-whatsapp?suite=demarrer');
  await expect(page.getByTestId('choix-offre')).toBeVisible();
  await page.goto('/offre?pro=abandon');
  await expect(page).toHaveURL(/\/connecter-whatsapp\?suite=demarrer&pro=abandon/);
  await expect(page.getByTestId('essai-pro-abandonne')).toContainText('rien n’a été prélevé');
  await expect(page.getByTestId('choix-offre')).toBeVisible();
});

test('🔴 un espace venu du choix du Pro entre dans le tunnel : après Stripe, la connexion de son numéro', async ({ page }) => {
  await monter(page);
  await page.goto('/offre?fonction=console&suite=demarrer');
  await expect(page.getByTestId('offre-raison')).toBeVisible();
  await page.goto('/offre?pro=recu');
  await expect(page).toHaveURL(/\/connecter-whatsapp\?suite=demarrer&pro=recu/);
  await expect(page.getByTestId('essai-pro-commence')).toBeVisible();
});

test('hors du tunnel, ni la question ni le renvoi : la page de l’offre reste la page de l’offre', async ({ page }) => {
  await monter(page);
  await page.goto('/connecter-whatsapp');
  await expect(page.getByTestId('qui-regle-meta')).toBeVisible();
  await expect(page.getByTestId('choix-offre')).toHaveCount(0);
  await page.goto('/offre?pro=recu');
  await expect(page).toHaveURL(/\/offre\?pro=recu/);
});

test('un espace déjà en Pro, dans le tunnel, ne repasse pas par la formule', async ({ page }) => {
  await monter(page, { offre: 'pro' });
  await page.goto('/connecter-whatsapp?suite=demarrer');
  await expect(page.getByTestId('qui-regle-meta')).toBeVisible();
  await expect(page.getByTestId('choix-offre')).toHaveCount(0);
});

test('🔴 un statut de compte illisible rend l’écran d’avant, jamais un écran vide (jaune 1 de la relecture)', async ({ page }) => {
  await monter(page);
  await page.route((url) => url.pathname.endsWith('/account-status'), (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"panne"}' }));
  await page.goto('/connecter-whatsapp?suite=demarrer');
  await expect(page.getByTestId('qui-regle-meta')).toBeVisible();
  await expect(page.getByTestId('choix-offre')).toHaveCount(0);
});

test('🔴 un Pro payé ne revoit pas les cartes dans l’onglet, même si l’offre se lit encore Free (jaune 4 de la relecture)', async ({ page }) => {
  await monter(page);
  await page.goto('/connecter-whatsapp?suite=demarrer');
  // Le premier écran a posé la suite dans l'onglet avant que Stripe ne revienne sur la page de l'offre.
  await expect(page.getByTestId('choix-offre')).toBeVisible();
  await page.goto('/offre?pro=recu');
  await expect(page.getByTestId('essai-pro-commence')).toBeVisible();
  // « Plus tard », puis « Connecter mon numéro » : le tunnel sans le retour de Stripe, l'offre toujours lue Free.
  await page.goto('/connecter-whatsapp?suite=demarrer');
  await expect(page.getByTestId('qui-regle-meta')).toBeVisible();
  await expect(page.getByTestId('choix-offre')).toHaveCount(0);
});
