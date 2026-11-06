import { test, expect, type Page } from './aide/test';
import { repondre } from './aide/confirmation';
import { mockAccueil } from './support/accueil';

/**
 * « QUI PAIE VOS MESSAGES À META ? » (révision du Crédit WhatsApp du 2026-11-04, lot B) : les deux cartes de Connecter
 * WhatsApp et de l'Accueil, selon l'état de la ligne que le serveur rend (`GET /credit-whatsapp/etat`). « Ma carte chez
 * Meta » est la voie active et ouvre le guide ; le Crédit WhatsApp est grisé tant qu'il n'est pas en vente. Le serveur
 * est simulé, rien ne part chez Stripe.
 */
const SANS_NUMERO = { hasNumber: false, phoneNumberId: null, number: null, numberStatus: null, codeVerificationStatus: null, status: { dot: 'grey', label: 'Aucun numéro', reason: 'Aucun numéro connecté.' } };
const PAGE_STRIPE = 'https://checkout.stripe.com/c/pay/cs_test_option_e2e';
const PRO = ['inbox', 'scenarios', 'statistiques', 'agent_meta', 'aide', 'assistants', 'email', 'console'];
const LIMITES = {
  utilisateurs: 3, admins: 2, contacts: 5000, envoisModelesMois: null, automations: null, suppressionsJour: null, adressesWebhook: 5,
  journalWebhooksJours: 30, conservationJours: 90, commissionPct: 20, badge: false, numeroInclus: true,
};
const ESSAI = {
  statut: 'essai', periodicite: 'mois', debutLe: '2026-11-01T09:00:00.000Z', prochaineEcheanceLe: '2099-11-15T09:00:00.000Z',
  finPrevueLe: null, essaiFinLe: '2099-11-15T09:00:00.000Z', finiLe: null, finRaison: null,
};
const vueOffre = (offre: string, abonnement: unknown = null) => ({
  offre, fonctions: PRO, limites: LIMITES, usage: { envoisModelesMois: null, contacts: 12, automations: 1, membres: 2 },
  grille: { free: { fonctions: [], limites: LIMITES }, pro: { fonctions: PRO, limites: LIMITES }, entreprise: { fonctions: PRO, limites: LIMITES } },
  prixPro: { moisCentimes: 4900, anCentimes: 49000 }, essai: null, sieges: null, suiteDuNumero: null, abonnement,
  upgradeUrl: 'https://console.e2e.test/offre', ongletCreditWhatsapp: false,
});
type Etat = { etat: string; enVente: boolean; avecApplication?: boolean };

/** Le serveur des cartes : l'offre, l'état de la ligne (une suite, la dernière répétée), l'option et le démarrage du Pro. */
async function simuler(page: Page, o: { offre?: string; abonnement?: unknown; etats?: Etat[]; demarrer?: unknown } = {}) {
  const options: unknown[] = [];
  const etats = [...(o.etats ?? [{ etat: 'a_prendre', enVente: false }])];
  let lecturesEtat = 0;
  let demarrages = 0;
  await page.route(`${PAGE_STRIPE}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe Checkout (e2e)</h1>' }));
  await page.route((url) => url.pathname.startsWith('/api/backend/'), async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname;
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/credit-whatsapp/etat')) {
      lecturesEtat += 1;
      return json(etats.length > 1 ? etats.shift()! : etats[0]!);
    }
    if (chemin.endsWith('/credit-whatsapp/option') && req.method() === 'POST') {
      options.push(req.postDataJSON());
      return json({ url: PAGE_STRIPE });
    }
    if (chemin.endsWith('/offre/pro/demarrer') && req.method() === 'POST') {
      demarrages += 1;
      return json(o.demarrer ?? { essaiFini: true, paye: true });
    }
    if (chemin.endsWith('/offre/tarif')) return json({ proHtCentimes: 4900, siegeHtCentimes: null, remise: false });
    if (chemin.endsWith('/offre')) return json(vueOffre(o.offre ?? 'pro', o.abonnement ?? null));
    return route.fallback();
  });
  return { options, lecturesEtat: () => lecturesEtat, demarrages: () => demarrages };
}

test.describe('Connecter WhatsApp : « Qui paie vos messages à Meta ? »', () => {
  test('🔴 la carte chez Meta est la voie active et le guide suit ; hors vente, le Crédit WhatsApp est grisé, sur demande', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    await simuler(page, { etats: [{ etat: 'a_prendre', enVente: false }] });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('qui-regle-meta')).toContainText('Qui paie vos messages à Meta ?');
    await expect(page.getByTestId('carte-meta-choisir')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('question-compte')).toBeVisible();
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Sur demande : écrivez-nous depuis le Support.');
    await expect(page.getByTestId('carte-credit-wa-ligne').getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support');
    await expect(page.getByTestId('carte-credit-wa-grisee')).toBeDisabled();
    await expect(page.getByTestId('carte-credit-wa-prendre')).toHaveCount(0);
  });

  test('🔴 en Free, sans lire l’état (la route est fermée à la Free) : « Avec la formule Pro. »', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    const s = await simuler(page, { offre: 'free' });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Avec la formule Pro.');
    await expect(page.getByTestId('carte-credit-wa-grisee')).toBeDisabled();
    expect(s.lecturesEtat()).toBe(0);
  });

  test('🔴 un Pro en essai : l’explication, puis « Démarrer la formule Pro maintenant » enchaîne sur le paiement de l’option, retour sur Connecter WhatsApp', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    const s = await simuler(page, { abonnement: ESSAI, etats: [{ etat: 'essai', enVente: true }] });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Il vient avec la formule Pro payante : à la fin de l’essai, ou tout de suite.');
    await page.getByTestId('carte-credit-wa-demarrer').click();
    await repondre(page, true, /Votre essai gratuit s’arrête aujourd’hui : votre formule Pro \(Mensuel, 49 € HT par mois\)[\s\S]*l’option Crédit WhatsApp pour un numéro/);
    await expect(page).toHaveURL(PAGE_STRIPE);
    expect([s.demarrages(), s.options]).toEqual([1, [{ places: 1, origine: 'connecter' }]]);
  });

  test('🔴 la formule payée et l’option en vente : « Prendre l’option » pour un numéro, et l’avertissement quand tous les numéros gardent l’application', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    const s = await simuler(page, { etats: [{ etat: 'a_prendre', enVente: true, avecApplication: true }] });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('carte-credit-wa-avertissement')).toContainText('le Crédit WhatsApp n’est pas possible avec l’application');
    await page.getByTestId('carte-credit-wa-prendre').click();
    await expect(page).toHaveURL(PAGE_STRIPE);
    expect(s.options).toEqual([{ places: 1, origine: 'connecter' }]);
  });

  test('🔴 au retour de Stripe, la prise reste fermée jusqu’à l’option écrite : « Votre ligne s’ouvre sous 24 h ouvrées. »', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    const s = await simuler(page, { etats: [{ etat: 'a_prendre', enVente: true }, { etat: 'a_prendre', enVente: true }, { etat: 'en_attente', enVente: true }] });
    await page.goto('/connecter-whatsapp?option=recue');
    await expect(page.getByTestId('carte-credit-wa-recue')).toContainText('Paiement de l’option reçu.');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Votre ligne s’ouvre sous 24 h ouvrées.');
    await expect(page.getByTestId('carte-credit-wa-prendre')).toHaveCount(0);
    // La ligne attendue, le guide de la carte chez Meta ne s'ouvre que d'un clic.
    await expect.poll(() => s.lecturesEtat(), { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId('question-compte')).toHaveCount(0);
    await page.getByTestId('carte-meta-choisir').click();
    await expect(page.getByTestId('question-compte')).toBeVisible();
    expect(s.options).toEqual([]);
  });

  test('un paiement abandonné : rien n’a été débité pour l’option, et la prise se représente', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    await simuler(page, { etats: [{ etat: 'a_prendre', enVente: true }] });
    await page.goto('/connecter-whatsapp?option=abandon');
    await expect(page.getByTestId('carte-credit-wa-abandon')).toContainText('rien n’a été débité pour l’option');
    await expect(page.getByTestId('carte-credit-wa-prendre')).toBeVisible();
  });

  test('🔴 un numéro connecté dont l’option est arrêtée : les deux chemins, et la carte chez Meta rouvre le guide', async ({ page }) => {
    await mockAccueil(page, { inscription: { complete: {} } });
    const s = await simuler(page, { etats: [{ etat: 'arretee', enVente: true }] });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('numero-connecte')).toBeVisible();
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Vos envois par le Crédit WhatsApp sont arrêtés, votre crédit restant est conservé.');
    await expect(page.getByTestId('question-compte')).toHaveCount(0);
    await page.getByTestId('carte-meta-choisir').click();
    await expect(page.getByTestId('question-compte')).toBeVisible();
    await page.getByTestId('carte-credit-wa-reprendre').click();
    await expect(page).toHaveURL(PAGE_STRIPE);
    expect(s.options).toEqual([{ places: 1, origine: 'connecter' }]);
  });

  test('un numéro connecté sur une ligne active : le Crédit WhatsApp paie, aucun guide ni bouton de la carte chez Meta', async ({ page }) => {
    await mockAccueil(page, { inscription: { complete: {} } });
    await simuler(page, { etats: [{ etat: 'active', enVente: true }] });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Vos messages sont payés par votre Crédit WhatsApp.');
    await expect(page.getByTestId('carte-meta-choisir')).toHaveCount(0);
    await expect(page.getByTestId('question-compte')).toHaveCount(0);
  });

  test('🔴 garder l’application, c’est payer Meta avec sa carte : la carte du guide le dit', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    await simuler(page);
    await page.goto('/connecter-whatsapp');
    await page.getByTestId('question-compte-non').click();
    await page.getByTestId('question-application-oui').click();
    await expect(page.getByTestId('note-carte-application')).toHaveText('Vous payez Meta avec votre carte : le Crédit WhatsApp n’est pas possible avec l’application.');
  });
});

test.describe('Accueil : « Qui paie vos messages à Meta ? »', () => {
  test('sans numéro : la carte chez Meta mène au guide de Connecter WhatsApp, le Crédit WhatsApp dit son état', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    await simuler(page, { etats: [{ etat: 'en_attente', enVente: true }] });
    await page.goto('/accueil');
    await expect(page.getByTestId('qui-regle-meta')).toBeVisible();
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Votre ligne s’ouvre sous 24 h ouvrées.');
    await expect(page.getByTestId('carte-meta-choisir')).toHaveAttribute('href', '/connecter-whatsapp');
  });

  test('un numéro connecté : pas de cartes sur l’Accueil', async ({ page }) => {
    await mockAccueil(page, { inscription: { complete: {} } });
    await simuler(page);
    await page.goto('/accueil');
    await expect(page.getByTestId('qui-regle-meta')).toHaveCount(0);
  });
});
