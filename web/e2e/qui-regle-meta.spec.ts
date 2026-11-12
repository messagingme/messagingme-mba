import { test, expect, type Page } from './aide/test';
import { mockAccueil } from './support/accueil';

/**
 * « QUI PAIE VOS MESSAGES À META ? » (révision du Crédit WhatsApp du 2026-11-04, lot B) : les deux cartes de Connecter
 * WhatsApp et de l'Accueil, selon l'état de la ligne que le serveur rend (`GET /credit-whatsapp/etat`). La carte du
 * moyen de paiement chez Meta (son libellé et ses deux liens, lot 3a) est la voie active et ouvre le guide ; le Crédit
 * WhatsApp est grisé tant qu'il n'est pas en vente. Le serveur est simulé, rien ne part chez Stripe.
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
type Etat = { etat: string; enVente: boolean; avecApplication?: boolean; fenetrePartenaire?: boolean };

/** Le serveur des cartes : l'offre, l'état de la ligne (une suite, la dernière répétée), l'option et le démarrage du Pro. */
async function simuler(page: Page, o: { offre?: string; abonnement?: unknown; etats?: Etat[]; solution?: string } = {}) {
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
      // Plus aucune carte ne démarre la formule Pro (lot 3v) : un appel ici serait compté, et refusé par le test.
      return json({ essaiFini: true, paye: true });
    }
    // La fenêtre du partenaire (lot E) : la configuration de la connexion rend l'identifiant de la solution.
    if (o.solution !== undefined && chemin.endsWith('/embedded-signup/config')) {
      return json({ enabled: true, appId: 'app-e2e', configId: 'cfg-e2e', graphVersion: 'v25.0', solutionId: o.solution });
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
    // Le libellé de la carte et ses deux liens vers la vitrine (lot 3a ; « Payer Meta » depuis le lot 4b).
    const carteMeta = page.getByTestId('carte-meta');
    await expect(carteMeta).toContainText('Je mets un moyen de paiement (Visa / Mastercard) sur mon compte Meta Business');
    await expect(carteMeta.getByRole('link', { name: 'Pourquoi un moyen de paiement ?' })).toHaveAttribute('href', /\/aide\/payer-meta-poser-votre-carte\/$/);
    await expect(carteMeta.getByRole('link', { name: 'Qu’est-ce qu’un compte Meta Business ?' })).toHaveAttribute('href', /\/aide\/ce-qu-il-faut-chez-meta\/$/);
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

  test('🔴 un Pro en essai prend l’option tout de suite (lot 3v) : « Prendre l’option », jamais « Démarrer la formule Pro maintenant »', async ({ page }) => {
    // Le serveur dit un Pro dans ses 14 jours `a_prendre` (V1) : l'option se paie dès le début de l'essai.
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    const s = await simuler(page, { abonnement: ESSAI, etats: [{ etat: 'a_prendre', enVente: true }] });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('carte-credit-wa-demarrer')).toHaveCount(0);
    await page.getByTestId('carte-credit-wa-prendre').click();
    await expect(page).toHaveURL(PAGE_STRIPE);
    expect([s.demarrages(), s.options]).toEqual([0, [{ places: 1, origine: 'connecter' }]]);
  });

  test('🔴 un Business en essai, l’option en vente : la raison du serveur, jamais « Prendre l’option » (lot 3v)', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    const s = await simuler(page, { offre: 'business', etats: [{ etat: 'essai', enVente: true }] });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('L’option Crédit WhatsApp s’ouvre quand votre formule Business est confirmée.');
    await expect(page.getByTestId('carte-credit-wa-prendre')).toHaveCount(0);
    expect(s.options).toEqual([]);
  });

  test('🔴 un Pro en retard de paiement, l’option en vente : la raison du serveur, jamais « Prendre l’option » (lot 3v)', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    await simuler(page, { abonnement: { ...ESSAI, statut: 'en_retard', essaiFinLe: null }, etats: [{ etat: 'essai', enVente: true }] });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Le paiement de votre formule Pro est en retard : réglez-le, puis prenez l’option. Mettez à jour votre carte dans l’onglet Offre.');
    await expect(page.getByTestId('carte-credit-wa-prendre')).toHaveCount(0);
  });

  test('🔴 un Pro en essai, l’option hors vente : la carte grisée, sur demande, jamais « Démarrer la formule Pro maintenant » (rouge de la relecture du lot B)', async ({ page }) => {
    // Démarrer la formule Pro pour une option qui ne se prend pas : un prélèvement sur une promesse que rien ne tient.
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    const s = await simuler(page, { abonnement: ESSAI, etats: [{ etat: 'a_prendre', enVente: false }] });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Sur demande : écrivez-nous depuis le Support.');
    await expect(page.getByTestId('carte-credit-wa-grisee')).toBeDisabled();
    await expect(page.getByTestId('carte-credit-wa-demarrer')).toHaveCount(0);
    await expect(page.getByTestId('carte-credit-wa-prendre')).toHaveCount(0);
    expect(s.demarrages()).toBe(0);
  });

  test('🔴 un Business en essai, l’option hors vente : sur demande, jamais « il s’ouvre dès que… »', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    await simuler(page, { offre: 'business', etats: [{ etat: 'essai', enVente: false }] });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Sur demande : écrivez-nous depuis le Support.');
    await expect(page.getByTestId('carte-credit-wa-grisee')).toBeDisabled();
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
    // La fenêtre du partenaire fermée (le serveur ne la dit pas ouverte) : pas de « Connecter sans carte chez Meta ».
    await expect(page.getByTestId('carte-credit-wa-connecter-ligne')).toHaveCount(0);
    // La ligne attendue, le guide de la carte chez Meta ne s'ouvre que d'un clic.
    await expect.poll(() => s.lecturesEtat(), { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId('question-compte')).toHaveCount(0);
    await page.getByTestId('carte-meta-choisir').click();
    await expect(page.getByTestId('question-compte')).toBeVisible();
    expect(s.options).toEqual([]);
  });

  test('🔴 une option reprise (arrêtée) : au retour de Stripe, la prise reste fermée et l’écran relit jusqu’à la ligne relancée (jaune 1 du lot B)', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    const s = await simuler(page, { etats: [{ etat: 'arretee', enVente: true }, { etat: 'arretee', enVente: true }, { etat: 'active', enVente: true }] });
    await page.goto('/connecter-whatsapp?option=recue');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Votre ligne s’ouvre sous 24 h ouvrées.');
    await expect(page.getByTestId('carte-credit-wa-reprendre')).toHaveCount(0);
    await expect.poll(() => s.lecturesEtat(), { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Vos messages sont payés par votre Crédit WhatsApp.');
    expect(s.options).toEqual([]);
  });

  test('🔴 une Entreprise : son contrat, sur demande, jamais le prix de l’option ni « avec la formule Pro ou Business » (jaune 9 du lot B)', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    await simuler(page, { offre: 'entreprise', etats: [{ etat: 'a_prendre', enVente: false }] });
    await page.goto('/connecter-whatsapp');
    const carte = page.getByTestId('carte-credit-wa');
    await expect(carte).toContainText('Vous payez vos messages chez Messaging Me, sans carte chez Meta, selon votre contrat Entreprise.');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Sur demande : écrivez-nous depuis le Support.');
    await expect(carte).not.toContainText('30 €');
    await expect(carte).not.toContainText('avec la formule Pro ou Business');
  });

  test('🔴 un numéro connecté payé par sa carte : la carte du moyen de paiement chez Meta est mise en avant (jaune 4 du lot B)', async ({ page }) => {
    await mockAccueil(page, { inscription: { complete: {} } });
    await simuler(page, { etats: [{ etat: 'a_prendre', enVente: true }] });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('carte-meta')).toHaveClass(/border-ink-900/);
    await expect(page.getByTestId('carte-credit-wa')).toHaveClass(/border-ink-200/);
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

  test('🔴 V4 : le numéro de l’essai, connecté avec la carte chez Meta, l’option payée : la carte mène à sa reconnexion dans l’onglet Crédit WhatsApp', async ({ page }) => {
    // Le serveur ne rouvre la fenêtre du partenaire à un espace connecté que pour l'y reconnecter (`seReconnecte`) : sans
    // elle, personne ne poserait sa ligne, et « sous 24 h ouvrées » serait faux.
    await mockAccueil(page, { inscription: { complete: {} } });
    await simuler(page, { etats: [{ etat: 'en_attente', enVente: true, fenetrePartenaire: true }] });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('numero-connecte')).toBeVisible();
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Votre option est payée, mais votre numéro est connecté avec votre carte chez Meta : reconnectez-le sans carte depuis l’onglet Crédit WhatsApp.');
    await expect(page.getByTestId('carte-credit-wa-reconnecter')).toHaveAttribute('href', '/offre?tab=whatsapp');
    // La fenêtre ne s'ouvre pas d'ici : la question de la voie de la ligne est celle d'un espace sans numéro.
    await expect(page.getByTestId('ligne-numero')).toHaveCount(0);
  });

  test('un numéro connecté, l’option payée, sans fenêtre à rouvrir : la ligne s’ouvre sous 24 h, comme avant', async ({ page }) => {
    await mockAccueil(page, { inscription: { complete: {} } });
    await simuler(page, { etats: [{ etat: 'en_attente', enVente: true }] });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Votre ligne s’ouvre sous 24 h ouvrées.');
    await expect(page.getByTestId('carte-credit-wa-reconnecter')).toHaveCount(0);
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
    await page.getByTestId('question-meme-numero-oui').click();
    await expect(page.getByTestId('note-carte-application')).toHaveText('Vous payez Meta avec votre carte : le Crédit WhatsApp n’est pas possible avec l’application.');
  });
});

/**
 * LA FENÊTRE DU PARTENAIRE (lot E du Crédit WhatsApp) : « Connecter sans carte chez Meta » ouvre la fenêtre de Meta avec
 * la solution du partenaire, que la configuration de la connexion rend à cet espace. Le faux SDK retient les options de
 * `FB.login` ; la fin dit au serveur que la connexion s'est faite par la ligne. Textes validés par Julien le 2026-11-09.
 */
const SDK_QUI_RETIENT = 'window.FB={init:function(){},login:function(cb,o){window.__optionsFb=o;setTimeout(function(){cb({authResponse:{code:"code-e2e"}})},10)}};';
const CONNECTE = { connected: true, wabaId: 'w-e2e', phoneNumberId: 'pn-e2e', displayPhoneNumber: '+33 6 00 00 00 00' };

test.describe('Connecter WhatsApp : la fenêtre du partenaire', () => {
  test('🔴 l’option payée : « Connecter sans carte chez Meta » ouvre la fenêtre de Meta par la solution, et la fin le dit au serveur', async ({ page }) => {
    await page.route('https://connect.facebook.net/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK_QUI_RETIENT }));
    const posts: unknown[] = [];
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: CONNECTE, posts } });
    await simuler(page, { etats: [{ etat: 'en_attente', enVente: true, fenetrePartenaire: true }], solution: 'sol-e2e' });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Votre option est payée : connectez votre numéro, Meta ne vous facturera pas. Votre ligne s’ouvre ensuite sous 24 h ouvrées.');
    // La voie de la carte chez Meta est fermée : son guide n'est pas monté, une seule connexion écoute la fenêtre.
    await expect(page.getByTestId('carte-meta-choisir')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('question-compte')).toHaveCount(0);
    // « Votre numéro, ou le nôtre ? » (lot 3v) : le sien reçoit la phrase validée de Julien AVANT la fenêtre.
    await expect(page.getByTestId('ligne-numero')).toContainText('Votre numéro, ou le nôtre ?');
    await expect(page.getByTestId('carte-credit-wa-connecter-ligne')).toHaveCount(0);
    await page.getByTestId('ligne-numero-mien').click();
    await expect(page.getByTestId('ligne-numero-application')).toHaveText('Votre numéro sert déjà dans WhatsApp ou dans l’application WhatsApp Business ? Avec le Crédit WhatsApp, il n’y marchera plus : vos clients vous écriront dans Messaging Me, et vous leur répondrez là (la console ou Claude). Pour garder l’application : « Je mets un moyen de paiement (Visa / Mastercard) sur mon compte Meta Business », ou un numéro de chez nous.');
    await expect(page.getByTestId('ligne-numero-application')).not.toContainText('quitter');
    // Ce qu'il faut chez Meta, comme sur les autres voies : le compte Meta Business sans carte, et son numéro avec le
    // téléphone qui reçoit le code (jaune de la relecture du lot 4a-3).
    const prerequis = page.getByTestId('prerequis-meta');
    await expect(prerequis).toContainText('Avant de commencer, chez Meta');
    await expect(prerequis.locator('li')).toHaveCount(3);
    await expect(prerequis.locator('li').nth(0)).toContainText('sans carte chez Meta');
    await expect(prerequis.locator('li').nth(2)).toHaveText('Votre numéro, et le téléphone qui le porte : Meta y envoie un code, par SMS ou par appel.');
    const bouton = page.getByTestId('carte-credit-wa-connecter-ligne');
    await expect(bouton).toHaveText('Connecter sans carte chez Meta');
    await expect(bouton).toBeEnabled();
    await bouton.click();
    // L'écoute attend 6 s un message de la fenêtre avant d'envoyer le code seul.
    await expect.poll(() => posts.length, { timeout: 15_000 }).toBe(1);
    expect(posts[0]).toEqual({ code: 'code-e2e', parLaLigne: true });
    const options = await page.evaluate(() => (window as unknown as { __optionsFb?: { extras?: unknown } }).__optionsFb);
    expect(options?.extras).toEqual({ setup: { solutionID: 'sol-e2e' }, featureType: '', sessionInfoVersion: '3' });
  });

  // Une Entreprise connectée en direct, avant que la fenêtre du partenaire existe (plan
  // `2026-11-12-credit-whatsapp-reconnexion-entreprise.md`) : le partenaire ne voit pas son compte, sa ligne ne peut pas
  // s'y attacher. Son onglet Crédit WhatsApp, sans ligne, ne s'affiche pas : la reconnexion se fait depuis la carte, et
  // seulement par le lien que notre équipe donne (`?reconnexion=entreprise`, décision de Julien : « MUTAC seulement »).
  const RECONNEXION_ENTREPRISE = 'Votre numéro est connecté avec votre carte chez Meta, qui facture encore ses messages : reconnectez-le sans carte, en choisissant dans la fenêtre de Meta le même compte WhatsApp et le même numéro.';
  const LIEN_RECONNEXION = '/connecter-whatsapp?reconnexion=entreprise';

  test('🔴 une Entreprise connectée en direct, SANS le lien de notre équipe : « sur demande », aucun bouton, même la fenêtre rouverte par le serveur', async ({ page }) => {
    await mockAccueil(page, { inscription: { complete: {} } });
    await simuler(page, { offre: 'entreprise', etats: [{ etat: 'a_prendre', enVente: false, fenetrePartenaire: true }], solution: 'sol-e2e' });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('numero-connecte')).toBeVisible();
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Sur demande : écrivez-nous depuis le Support.');
    await expect(page.getByTestId('carte-credit-wa-reconnecter-entreprise')).toHaveCount(0);
  });

  test('🔴 une Entreprise connectée en direct, par le lien de notre équipe, la fenêtre rouverte par le serveur : « Reconnecter mon numéro sans carte chez Meta » ouvre la fenêtre par la solution, la fin passe par la ligne, et la carte relit son état', async ({ page }) => {
    await page.route('https://connect.facebook.net/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK_QUI_RETIENT }));
    const posts: unknown[] = [];
    await mockAccueil(page, { inscription: { complete: CONNECTE, posts } });
    await simuler(page, { offre: 'entreprise', etats: [{ etat: 'a_prendre', enVente: false, fenetrePartenaire: true }], solution: 'sol-e2e' });
    // La fin de la connexion pose la ligne (le serveur l'attache et la vérifie) : l'état relu après elle est actif.
    await page.route((url) => url.pathname.endsWith('/credit-whatsapp/etat'), (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(posts.length > 0
        ? { etat: 'active', enVente: false, avecApplication: false, fenetrePartenaire: false }
        : { etat: 'a_prendre', enVente: false, avecApplication: false, fenetrePartenaire: true }),
    }));
    await page.goto(LIEN_RECONNEXION);
    await expect(page.getByTestId('numero-connecte')).toBeVisible();
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText(RECONNEXION_ENTREPRISE);
    const bouton = page.getByTestId('carte-credit-wa-reconnecter-entreprise');
    await expect(bouton).toHaveText('Reconnecter mon numéro sans carte chez Meta');
    await expect(bouton).toBeEnabled();
    await bouton.click();
    // L'écoute attend 6 s un message de la fenêtre avant d'envoyer le code seul.
    await expect.poll(() => posts.length, { timeout: 15_000 }).toBe(1);
    expect(posts[0]).toEqual({ code: 'code-e2e', parLaLigne: true });
    const options = await page.evaluate(() => (window as unknown as { __optionsFb?: { extras?: unknown } }).__optionsFb);
    expect(options?.extras).toEqual({ setup: { solutionID: 'sol-e2e' }, featureType: '', sessionInfoVersion: '3' });
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Vos messages sont payés par votre Crédit WhatsApp.');
    await expect(page.getByTestId('carte-credit-wa-reconnecter-entreprise')).toHaveCount(0);
  });

  test('🔴 une Entreprise connectée, par le lien, la fenêtre fermée par le serveur (déjà sur une ligne, application, rien de configuré) : « sur demande », aucun bouton', async ({ page }) => {
    await mockAccueil(page, { inscription: { complete: {} } });
    await simuler(page, { offre: 'entreprise', etats: [{ etat: 'a_prendre', enVente: false }], solution: 'sol-e2e' });
    await page.goto(LIEN_RECONNEXION);
    await expect(page.getByTestId('numero-connecte')).toBeVisible();
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Sur demande : écrivez-nous depuis le Support.');
    await expect(page.getByTestId('carte-credit-wa-reconnecter-entreprise')).toHaveCount(0);
  });

  test('🔴 la fenêtre du partenaire ouverte : ni l’autre réponse ni la carte chez Meta ne démontent la connexion en cours', async ({ page }) => {
    // Un SDK dont la fenêtre ne rend jamais la main : la connexion reste en cours (jaune de la relecture du lot 3v-1).
    await page.route('https://connect.facebook.net/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.FB={init:function(){},login:function(){}};' }));
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: CONNECTE, posts: [] } });
    await simuler(page, { etats: [{ etat: 'en_attente', enVente: true, fenetrePartenaire: true }], solution: 'sol-e2e' });
    await page.goto('/connecter-whatsapp');
    await page.getByTestId('ligne-numero-mien').click();
    await expect(page.getByTestId('ligne-numero-notre')).toBeEnabled();
    await page.getByTestId('carte-credit-wa-connecter-ligne').click();
    await expect(page.getByTestId('carte-credit-wa-connecter-ligne')).toBeDisabled();
    // Fenêtre ouverte : les gestes qui démonteraient « Le mien » sont fermés, et son parcours reste monté.
    await expect(page.getByTestId('ligne-numero-notre')).toBeDisabled();
    await expect(page.getByTestId('ligne-numero-mien')).toBeDisabled();
    await expect(page.getByTestId('carte-meta-choisir')).toBeDisabled();
    await expect(page.getByTestId('ligne-numero-mien-suite')).toBeVisible();
  });

  test('🔴 la fenêtre de Meta de la voie de la carte ouverte : les réponses de la ligne ne démontent pas son parcours', async ({ page }) => {
    // La page tient l'état de la fenêtre de son parcours (`surOccupe`) et le passe à la carte (`occupe`).
    await page.route('https://connect.facebook.net/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.FB={init:function(){},login:function(){}};' }));
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: CONNECTE, posts: [] } });
    await simuler(page, { etats: [{ etat: 'en_attente', enVente: true, fenetrePartenaire: true }], solution: 'sol-e2e' });
    await page.goto('/connecter-whatsapp');
    await page.getByTestId('carte-meta-choisir').click();
    await page.getByTestId('question-compte-oui').click();
    await page.getByTestId('choix-apporte').click();
    await expect(page.getByTestId('ligne-numero-mien')).toBeEnabled();
    await page.getByTestId('ouvrir-fenetre-meta').click();
    await expect(page.getByTestId('ouvrir-fenetre-meta')).toBeDisabled();
    await expect(page.getByTestId('ligne-numero-mien')).toBeDisabled();
    await expect(page.getByTestId('ligne-numero-notre')).toBeDisabled();
    // Le parcours de la carte reste monté : son encadré et son bouton, fenêtre ouverte.
    await expect(page.getByTestId('prerequis-meta')).toBeVisible();
    await expect(page.getByTestId('ouvrir-fenetre-meta')).toBeVisible();
  });

  test('🔴 une Entreprise sans numéro : son texte, la même question ; la carte chez Meta se reprend d’un clic, et « Le mien » la referme avant la fenêtre du partenaire', async ({ page }) => {
    await page.route('https://connect.facebook.net/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK_QUI_RETIENT }));
    const posts: unknown[] = [];
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: CONNECTE, posts } });
    await simuler(page, { offre: 'entreprise', etats: [{ etat: 'a_prendre', enVente: false, fenetrePartenaire: true }], solution: 'sol-e2e' });
    await page.goto('/connecter-whatsapp');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Connectez votre numéro, Meta ne vous facturera pas. Votre ligne s’ouvre ensuite sous 24 h ouvrées.');
    await expect(page.getByTestId('ligne-numero')).toBeVisible();
    await expect(page.getByTestId('carte-credit-wa-grisee')).toHaveCount(0);
    // Une Entreprise n'a pas de ligne en attente : sans la fenêtre du partenaire, la carte chez Meta serait la voie active.
    await expect(page.getByTestId('carte-meta-choisir')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('question-compte')).toHaveCount(0);
    await page.getByTestId('carte-meta-choisir').click();
    await expect(page.getByTestId('question-compte')).toBeVisible();
    // Sans recharger la page : « Le mien » referme le guide de la carte, puis le bouton du partenaire ouvre sa fenêtre.
    await page.getByTestId('ligne-numero-mien').click();
    await expect(page.getByTestId('question-compte')).toHaveCount(0);
    const bouton = page.getByTestId('carte-credit-wa-connecter-ligne');
    await expect(bouton).toBeEnabled();
    await bouton.click();
    await expect.poll(() => posts.length, { timeout: 15_000 }).toBe(1);
    expect(posts[0]).toEqual({ code: 'code-e2e', parLaLigne: true });
  });
});

test.describe('Connecter WhatsApp : le numéro fourni par la fenêtre du partenaire (lot 3v)', () => {
  test('🔴 « Le vôtre » : le numéro fourni, la fenêtre de Meta ouverte par la solution du partenaire, la fin par la ligne', async ({ page }) => {
    await page.route('https://connect.facebook.net/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK_QUI_RETIENT }));
    const posts: unknown[] = [];
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: CONNECTE, posts } });
    await simuler(page, { etats: [{ etat: 'en_attente', enVente: true, fenetrePartenaire: true }], solution: 'sol-e2e' });
    // Le numéro fourni, déjà attribué (inclus en Pro), et le code que l'Asterisk a capté.
    const json = (b: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    await page.route('**/api/backend/tenants/*/connexion-numero', (route) => route.fulfill(json({
      etat: { fourni: '+441235619343', code: null, connecte: null, abonnement: null, inclusDansLePro: true }, empreinte: '0123456789abcdef',
    })));
    await page.route('**/api/backend/tenants/*/numero-fourni**', (route) => route.fulfill(json({ numero: '+441235619343', code: '345679', codeRecuLe: '2026-11-10T10:00:00.000Z' })));
    await page.goto('/connecter-whatsapp');
    await page.getByTestId('ligne-numero-notre').click();
    await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
    // Ni la phrase du sien, ni la voie de la carte chez Meta : un seul parcours écoute la fenêtre.
    await expect(page.getByTestId('ligne-numero-application')).toHaveCount(0);
    await expect(page.getByTestId('question-compte')).toHaveCount(0);
    // Les conditions chez Meta, sans la carte que la ligne remplace (jaune 4 de la relecture du lot 3v).
    const prerequis = page.getByTestId('prerequis-meta');
    await expect(prerequis).toContainText('sans carte chez Meta');
    await expect(prerequis).not.toContainText('votre carte');
    await expect(prerequis).not.toContainText('moyen de paiement');
    const bouton = page.getByTestId('ouvrir-fenetre-meta');
    await expect(bouton).toBeEnabled();
    await bouton.click();
    await expect.poll(() => posts.length, { timeout: 15_000 }).toBe(1);
    expect(posts[0]).toEqual({ code: 'code-e2e', parLaLigne: true });
    const options = await page.evaluate(() => (window as unknown as { __optionsFb?: { extras?: unknown } }).__optionsFb);
    expect(options?.extras).toEqual({ setup: { solutionID: 'sol-e2e' }, featureType: '', sessionInfoVersion: '3' });
  });

  test('🔴 « Le vôtre », sa fenêtre ouverte : ni « Le mien » ni la carte chez Meta ne démontent son parcours', async ({ page }) => {
    await page.route('https://connect.facebook.net/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.FB={init:function(){},login:function(){}};' }));
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: CONNECTE, posts: [] } });
    await simuler(page, { etats: [{ etat: 'en_attente', enVente: true, fenetrePartenaire: true }], solution: 'sol-e2e' });
    const json = (b: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    await page.route('**/api/backend/tenants/*/connexion-numero', (route) => route.fulfill(json({
      etat: { fourni: '+441235619343', code: null, connecte: null, abonnement: null, inclusDansLePro: true }, empreinte: '0123456789abcdef',
    })));
    await page.route('**/api/backend/tenants/*/numero-fourni**', (route) => route.fulfill(json({ numero: '+441235619343', code: null, codeRecuLe: null })));
    await page.goto('/connecter-whatsapp');
    await page.getByTestId('ligne-numero-notre').click();
    await page.getByTestId('ouvrir-fenetre-meta').click();
    await expect(page.getByTestId('ouvrir-fenetre-meta')).toBeDisabled();
    await expect(page.getByTestId('ligne-numero-mien')).toBeDisabled();
    await expect(page.getByTestId('carte-meta-choisir')).toBeDisabled();
    await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  });
});

test('🔴 au retour de Stripe d’un numéro fourni payé, « Le vôtre » reprend, par la ligne (jaune 6 de la relecture du lot 3v)', async ({ page }) => {
  await page.route('https://connect.facebook.net/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK_QUI_RETIENT }));
  const posts: unknown[] = [];
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: CONNECTE, posts } });
  await simuler(page, { offre: 'business', etats: [{ etat: 'en_attente', enVente: true, fenetrePartenaire: true }], solution: 'sol-e2e' });
  const json = (b: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  await page.route('**/api/backend/tenants/*/connexion-numero', (route) => route.fulfill(json({
    etat: { fourni: '+441235619343', code: null, connecte: null, abonnement: { statut: 'actif', periodeFin: null } }, empreinte: '0123456789abcdef',
  })));
  await page.route('**/api/backend/tenants/*/numero-fourni**', (route) => route.fulfill(json({ numero: '+441235619343', code: '345679', codeRecuLe: '2026-11-10T10:00:00.000Z' })));
  // Une variante d'avant gardée dans l'onglet ne fait pas sortir le numéro par l'application.
  await page.addInitScript(() => { try { window.localStorage.setItem('mba.numero-variante.t-e2e', 'fourni_application'); } catch { /* rien */ } });
  await page.goto('/connecter-whatsapp?abonnement=recu');
  await expect(page.getByTestId('ligne-numero-notre')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  await expect(page.getByTestId('question-compte')).toHaveCount(0);
  await page.getByTestId('ouvrir-fenetre-meta').click();
  await expect.poll(() => posts.length, { timeout: 15_000 }).toBe(1);
  expect(posts[0]).toEqual({ code: 'code-e2e', parLaLigne: true });
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

  test('sans numéro, la fenêtre du partenaire ouverte (lot E) : son texte, et « Connecter sans carte chez Meta » mène à Connecter WhatsApp', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    await simuler(page, { etats: [{ etat: 'en_attente', enVente: true, fenetrePartenaire: true }] });
    await page.goto('/accueil');
    await expect(page.getByTestId('carte-credit-wa-ligne')).toHaveText('Votre option est payée : connectez votre numéro, Meta ne vous facturera pas. Votre ligne s’ouvre ensuite sous 24 h ouvrées.');
    await expect(page.getByTestId('carte-credit-wa-connecter-ligne')).toHaveAttribute('href', '/connecter-whatsapp');
  });

  test('un numéro connecté : pas de cartes sur l’Accueil', async ({ page }) => {
    await mockAccueil(page, { inscription: { complete: {} } });
    await simuler(page);
    await page.goto('/accueil');
    await expect(page.getByTestId('qui-regle-meta')).toHaveCount(0);
  });
});
