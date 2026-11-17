import { test, expect, type Page } from './aide/test';
import { mockAccueil } from './support/accueil';

/**
 * « Connecter WhatsApp » (lot 3b) : le numéro fourni par la réserve, puis le code que l'Asterisk capte quand Meta
 * appelle ce numéro. Le serveur est simulé : la page attribue, affiche, puis lit le code en boucle.
 */
const SANS_NUMERO = { hasNumber: false, phoneNumberId: null, number: null, numberStatus: null, codeVerificationStatus: null, status: { dot: 'grey', label: 'Aucun numéro', reason: 'Aucun numéro connecté.' } };

/** Le numéro fourni côté serveur : rien d'attribué au départ, puis le code arrive au bout de `lecturesAvantCode` lectures. */
async function simulerNumeroFourni(page: Page, o: {
  lecturesAvantCode?: number; abonnement?: 'actif' | 'resilie' | null;
  /** Le délai de la lecture du numéro, selon le numéro attribué à ce moment (la course de « Remplacer »). */
  delaiLecture?: (numero: string) => number;
  /** Le code que rend la lecture de ce numéro, à la place du code qui arrive au fil des lectures. */
  codeDe?: (numero: string) => string | null;
  /** « Abandonner » programme la fin de l'abonnement chez Stripe (lot 4, livraison B) ; absent = une API plus ancienne. */
  finProgrammee?: boolean;
  /** Un Pro vivant inclut le numéro (lot 6, B2b) ; absent = une API plus ancienne. */
  inclusDansLePro?: boolean;
  /** La route de la voie répond 404 : une API d'avant le lot 3 du 2026-11-17, la console déjà publiée. */
  sansRouteDeLaVoie?: boolean;
} = {}) {
  const etat = {
    numero: null as string | null, lectures: 0, gestes: [] as string[],
    abonnement: (o.abonnement === undefined ? 'actif' : o.abonnement) as 'actif' | 'resilie' | null, retours: [] as string[],
    /** Le corps de chaque `POST …/numero-fourni/destination` (lot 3 du 2026-11-17), à part des gestes. */
    destinations: [] as unknown[],
  };
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  // L'état de la connexion (lot 3c) : l'abonnement du numéro, et le numéro attribué.
  await page.route('**/api/backend/tenants/*/connexion-numero', (route) => route.fulfill(json({
    etat: {
      fourni: etat.numero, code: null, connecte: null, abonnement: etat.abonnement ? { statut: etat.abonnement, periodeFin: null } : null,
      ...(o.inclusDansLePro === undefined ? {} : { inclusDansLePro: o.inclusDansLePro }),
    },
    empreinte: '0123456789abcdef',
  })));
  await page.route('**/api/backend/tenants/*/numero-fourni**', async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname;
    if (req.method() === 'POST' && chemin.endsWith('/abonnement')) {
      etat.gestes.push('payer');
      etat.retours.push((req.postDataJSON() as { retour: string }).retour);
      // Une adresse de la page elle-même : le test ne quitte pas l'application pour Stripe.
      return route.fulfill(json({ url: '/connecter-whatsapp?abonnement=recu' }));
    }
    if (req.method() === 'POST' && chemin.endsWith('/portail')) {
      etat.gestes.push('portail');
      return route.fulfill(json({ url: '/connecter-whatsapp?portail=ouvert' }));
    }
    if (req.method() === 'POST' && chemin.endsWith('/abandonner')) {
      etat.gestes.push('abandonner');
      const rendu = etat.numero !== null;
      etat.numero = null;
      return route.fulfill(json(o.finProgrammee === undefined ? { rendu } : { rendu, finProgrammee: o.finProgrammee }));
    }
    if (req.method() === 'POST' && chemin.endsWith('/numero-fourni')) {
      etat.gestes.push('obtenir');
      etat.numero = '+441235619343';
      return route.fulfill(json({ numero: etat.numero }));
    }
    if (req.method() === 'POST' && chemin.endsWith('/remplacer')) {
      etat.gestes.push('remplacer');
      etat.numero = '+442071234567';
      etat.lectures = 0;
      return route.fulfill(json({ numero: etat.numero }));
    }
    if (req.method() === 'POST' && chemin.endsWith('/destination')) {
      // La voie choisie dans l'arbre : la fenêtre de Meta (`api`) ou l'application. Le serveur rend celle qu'il retient.
      const corps = req.postDataJSON() as { destination: string };
      etat.destinations.push(corps);
      if (o.sansRouteDeLaVoie) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not Found' }) });
      return route.fulfill(json({ destination: corps.destination }));
    }
    if (req.method() === 'GET') {
      if (etat.numero === null) return route.fulfill(json({ numero: null, code: null, codeRecuLe: null }));
      etat.lectures += 1;
      // La réponse décrit le serveur au moment de la LECTURE : une réponse lente arrive avec l'état d'avant.
      const numero = etat.numero;
      const code = o.codeDe ? o.codeDe(numero) : etat.lectures > (o.lecturesAvantCode ?? 1) ? '345679' : null;
      const delai = o.delaiLecture?.(numero) ?? 0;
      if (delai > 0) await new Promise((r) => setTimeout(r, delai));
      return route.fulfill(json({ numero, code, codeRecuLe: code ? '2026-10-06T10:00:00.000Z' : null })).catch(() => {});
    }
    return route.fulfill(json({}));
  });
  return etat;
}

test('🔴 numéro fourni : il s’affiche, puis le code capté apparaît sans rien recharger', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { lecturesAvantCode: 1 });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();

  await page.getByTestId('question-compte-oui').click();
  await page.getByTestId('choix-fourni').click();
  // 🔴 La voie retenue chez le serveur (lot 3 du 2026-11-17) : la fenêtre de Meta, jamais l'application.
  await expect.poll(() => etat.destinations).toEqual([{ destination: 'api' }]);
  await page.getByTestId('obtenir-numero').click();
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  // 🔴 L'appel, pas le SMS (lot 2c) : l'étape en gras est celle de « Phone call », l'exception dite à part, en petit.
  const appel = page.getByTestId('etapes-numero-fourni').locator('li[data-insiste]');
  await expect(appel).toHaveCount(1);
  await expect(appel).toContainText('choisissez « Appel téléphonique » (« Phone call » si la fenêtre est en anglais), surtout pas « Message texte »');
  await expect(appel).toHaveCSS('font-weight', '600');
  await expect(page.getByTestId('si-seul-text-message')).toContainText('ne propose que « Message texte » (« Text message »), prenez-le');
  await expect(page.getByTestId('code-capte')).toContainText('En attente du code de Meta');
  // La page lit le code toutes les 3 secondes : il arrive sans geste du client.
  await expect(page.getByTestId('code-capte')).toContainText('345679', { timeout: 12_000 });
  await expect(page.getByTestId('ouvrir-fenetre-meta')).toBeEnabled();
  expect(etat.gestes).toEqual(['obtenir']);
});

test('« Meta refuse ce numéro » : un autre numéro remplace le premier', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { lecturesAvantCode: 100 });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-oui').click();
  await page.getByTestId('choix-fourni').click();
  await page.getByTestId('obtenir-numero').click();
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  await page.getByTestId('remplacer-numero').click();
  await expect(page.getByTestId('numero-fourni')).toHaveText('+442071234567');
  expect(etat.gestes).toEqual(['obtenir', 'remplacer']);
});

test('un numéro déjà attribué reprend où il en était au retour sur la page', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page);
  etat.numero = '+441235619343';
  await page.goto('/connecter-whatsapp');
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  expect(etat.gestes).toEqual([]);
});

test('🔴 sans abonnement : le prix et « Payer », puis la page de paiement ; aucun numéro avant', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-oui').click();
  await page.getByTestId('choix-fourni').click();
  await expect(page.getByTestId('obtenir-numero')).toHaveCount(0);
  await expect(page.getByTestId('payer-numero')).toContainText('3,50');
  await page.getByTestId('payer-numero').click();
  await expect(page).toHaveURL(/abonnement=recu/);
  expect(etat.gestes).toEqual(['payer']);
  expect(etat.retours).toEqual(['console']);
});

test('🔴 en Pro (lot 6, B2b) : le numéro est inclus, « Obtenir mon numéro » sans jamais « Payer »', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { abonnement: null, inclusDansLePro: true });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-oui').click();
  await expect(page.getByTestId('choix-fourni')).toContainText('Inclus dans votre offre');
  await page.getByTestId('choix-fourni').click();
  await expect(page.getByTestId('numero-inclus')).toBeVisible();
  await expect(page.getByTestId('payer-numero')).toHaveCount(0);
  await page.getByTestId('obtenir-numero').click();
  await expect(page.getByText('+441235619343').first()).toBeVisible();
  expect(etat.gestes).toEqual(['obtenir']);
});

test('🔴 retour de Stripe avant le webhook : « confirmation en cours », et pas de second paiement', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp?abonnement=recu');
  // 🟡 Le parcours s'ouvre de lui-même sur le numéro fourni : le client vient de le payer, il ne le rechoisit pas.
  await expect(page.getByTestId('choix-fourni')).toHaveCount(0);
  await expect(page.getByTestId('paiement-en-confirmation')).toBeVisible();
  await expect(page.getByTestId('payer-numero')).toHaveCount(0);
  // Le webhook passe : l'abonnement est actif et le numéro attribué ; la page le montre sans rien recharger.
  etat.abonnement = 'actif';
  etat.numero = '+441235619343';
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343', { timeout: 12_000 });
  expect(etat.gestes).toEqual([]);
});

test('🟡 retour de Stripe, mais l’abonnement est résilié : « Payer » revient', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: 'resilie' });
  await page.goto('/connecter-whatsapp?abonnement=recu');
  await expect(page.getByTestId('payer-numero')).toBeVisible();
  await expect(page.getByTestId('paiement-en-confirmation')).toHaveCount(0);
});

test('🟡 « Abandonner » pendant que l’abonnement court : un texte qui le dit, pas « en préparation »', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { abonnement: 'actif', lecturesAvantCode: 100 });
  etat.numero = '+441235619343';
  await page.goto('/connecter-whatsapp');
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  await page.getByTestId('abandonner-numero').click();
  // Le numéro rendu ramène aux questions du tunnel.
  await page.getByTestId('question-compte-oui').click();
  await page.getByTestId('choix-fourni').click();
  await expect(page.getByTestId('numero-rendu')).toBeVisible();
  await expect(page.getByTestId('numero-en-preparation')).toHaveCount(0);
  await expect(page.getByTestId('gerer-abonnement')).toBeVisible();
  expect(etat.gestes).toEqual(['abandonner']);
});

test('🔴 « Abandonner » qui programme la fin chez Stripe (lot 4, B) : la page dit que l’abonnement prend fin', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { abonnement: 'actif', lecturesAvantCode: 100, finProgrammee: true });
  etat.numero = '+441235619343';
  await page.goto('/connecter-whatsapp');
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  await page.getByTestId('abandonner-numero').click();
  // Le numéro rendu ramène aux questions du tunnel.
  await page.getByTestId('question-compte-oui').click();
  await page.getByTestId('choix-fourni').click();
  await expect(page.getByTestId('numero-rendu')).toContainText(/prend fin/);
  await expect(page.getByTestId('numero-rendu')).not.toContainText(/continue/);
});

test('🟡 le portail de Stripe s’ouvre depuis la console', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { abonnement: 'actif' });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-oui').click();
  await page.getByTestId('choix-fourni').click();
  await page.getByTestId('gerer-abonnement').click();
  await expect(page).toHaveURL(/portail=ouvert/);
  expect(etat.gestes).toEqual(['portail']);
});

test('🟡 sans abonnement, pas de bouton du portail', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-oui').click();
  await page.getByTestId('choix-fourni').click();
  await expect(page.getByTestId('payer-numero')).toBeVisible();
  await expect(page.getByTestId('gerer-abonnement')).toHaveCount(0);
});

test('🟡 « Remplacer » : une lecture partie avant ne réaffiche pas l’ancien numéro ni son code', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const A = '+441235619343';
  const B = '+442071234567';
  // Les lectures de A sont lentes et portent le code de A ; celles de B, plus lentes encore, n'en ont pas.
  const etat = await simulerNumeroFourni(page, {
    abonnement: 'actif',
    codeDe: (n) => (n === A ? '111111' : null),
    delaiLecture: (n) => (n === A ? 2_500 : 8_000),
  });
  etat.numero = A;
  await page.goto('/connecter-whatsapp');
  await expect(page.getByTestId('numero-fourni')).toHaveText(A, { timeout: 10_000 });
  // Une lecture du code de A part ; « Remplacer » est cliqué pendant qu'elle est en route.
  const lente = page.waitForResponse((r) => r.request().method() === 'GET' && /\/numero-fourni$/.test(new URL(r.url()).pathname), { timeout: 15_000 });
  await page.waitForRequest((r) => r.method() === 'GET' && /\/numero-fourni$/.test(new URL(r.url()).pathname), { timeout: 15_000 });
  await page.getByTestId('remplacer-numero').click();
  await expect(page.getByTestId('numero-fourni')).toHaveText(B);
  await lente;
  await page.waitForTimeout(500);
  await expect(page.getByTestId('numero-fourni')).toHaveText(B);
  await expect(page.getByTestId('code-capte')).not.toContainText('111111');
  await expect(page.getByTestId('code-capte')).toContainText('En attente du code de Meta');
});

test('payé, mais la réserve était vide : « en préparation »', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: 'actif' });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-oui').click();
  await page.getByTestId('choix-fourni').click();
  await expect(page.getByTestId('numero-en-preparation')).toBeVisible();
});

test('espace déjà connecté : la page le dit, aucun choix', async ({ page }) => {
  await mockAccueil(page);
  await page.goto('/connecter-whatsapp');
  await expect(page.getByTestId('numero-connecte')).toBeVisible();
  await expect(page.getByTestId('choix-fourni')).toHaveCount(0);
});

test('🟡 espace connecté avec un numéro fourni payé : « Gérer mon abonnement »', async ({ page }) => {
  await mockAccueil(page);
  const etat = await simulerNumeroFourni(page, { abonnement: 'actif' });
  await page.goto('/connecter-whatsapp');
  await expect(page.getByTestId('numero-connecte')).toBeVisible();
  await page.getByTestId('gerer-abonnement').click();
  await expect(page).toHaveURL(/portail=ouvert/);
  expect(etat.gestes).toEqual(['portail']);
});

/*
 * LES QUESTIONS DU TUNNEL DE LA VITRINE (2026-10-30, plan `docs/superpowers/plans/2026-10-30-tunnel-numero-console-plugin.md`) :
 * le compte Meta Business, puis l'application WhatsApp Business. Plus aucune voie par QR code. Avec l'application (lot 3
 * du plan `docs/superpowers/plans/2026-11-17-numero-fourni-application-et-essai.md`) : un numéro y fonctionne-t-il, est-ce
 * celui-là ? Puis, au lot 4 du même plan, « Comment voulez-vous utiliser WhatsApp ? » : sans l'application (à installer
 * d'abord si on la choisit), avec elle sans numéro dedans, ou pour un 2e compte. L'application mène à « Souhaitez-vous
 * qu'on vous fournisse un numéro ? », l'API à « Avez-vous déjà un numéro que vous pourriez utiliser ? », dont « Oui » ne
 * propose plus que le sien.
 */
test('🔴 sans compte Meta Business ni application, par l’API, avec un numéro : le numéro API, sans rien à télécharger (2026-11-12, lot 4)', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await expect(page.getByTestId('question-compte')).toContainText('Avez-vous un compte Meta Business ?');
  // Rien n'est choisi tant qu'on n'a pas répondu.
  await expect(page.getByTestId('choix-fourni')).toHaveCount(0);
  await page.getByTestId('question-compte-non').click();
  await expect(page.getByTestId('note-compte')).toContainText('la fenêtre de Meta vous le fera créer en chemin');
  // Le titre tel qu'il se lit : la bulle de « WhatsApp Business », fermée, est dans le texte de la page mais pas à
  // l'écran (`useInnerText` ne lit que ce qui s'affiche).
  await expect(page.getByTestId('question-application')).toContainText('Avez-vous déjà l’application WhatsApp Business ?', { useInnerText: true });
  await page.getByTestId('question-application-non').click();
  // Sans l'application, comment utiliser WhatsApp (lot 4) : la question du numéro ne vient qu'avec l'API.
  await expect(page.getByTestId('question-deploiement')).toBeVisible();
  await expect(page.getByTestId('question-numero')).toHaveCount(0);
  await page.getByTestId('question-deploiement-api').click();
  // 🔴 Par l'API, rien à télécharger : ni « installez d'abord », ni magasins à l'écran.
  await expect(page.getByTestId('question-numero')).toContainText('Avez-vous déjà un numéro que vous pourriez utiliser ?');
  await expect(page.getByTestId('question-numero')).toContainText('Le numéro de votre entreprise, relié à l’API officielle de WhatsApp.');
  await expect(page.getByTestId('note-installer-application')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/télécharger|Téléchargez|App Store|Google Play/, { useInnerText: true });
  await expect(page.getByTestId('issue-api')).toHaveCount(0);
  await page.getByTestId('question-numero-oui').click();
  // Le numéro API, comme avec un compte : le sien par la fenêtre de Meta, et la ligne pour garder son application.
  await expect(page.getByTestId('issue-api')).toContainText('Votre numéro API');
  await expect(page.getByTestId('choix-apporte')).toBeVisible();
  await expect(page.getByTestId('issue-api')).toContainText('Votre numéro sert déjà dans WhatsApp ou dans l’application WhatsApp Business ?');
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/QR|télécharger|Téléchargez/);
  await page.getByTestId('choix-apporte').click();
  await expect(page.getByTestId('choix-apporte-ouvert')).toContainText('Dans la fenêtre de Meta, choisissez votre entreprise');
  await expect(page.getByTestId('ouvrir-fenetre-meta')).toBeVisible();
  // « Retour » ramène aux questions, les réponses gardées ; une autre réponse change la suite.
  await page.getByRole('button', { name: 'Retour' }).click();
  await expect(page.getByTestId('question-compte-non')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('question-compte-oui')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('question-application-non')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('question-deploiement-api')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('question-numero-oui')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('question-application-oui').click();
  await expect(page.getByTestId('question-deploiement')).toHaveCount(0);
  await expect(page.getByTestId('question-numero')).toHaveCount(0);
  await expect(page.getByTestId('issue-api')).toHaveCount(0);
  // Avec l'application, un numéro y fonctionne-t-il, puis ce numéro-là ? (lot 3 du 2026-11-17) : rien ne s'ouvre avant
  // les réponses.
  await expect(page.getByTestId('question-meme-numero')).toHaveCount(0);
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toHaveCount(0);
  await page.getByTestId('question-numero-application-oui').click();
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toHaveCount(0);
  await page.getByTestId('question-meme-numero-oui').click();
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(page.getByTestId('whatsapp-ordinaire')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retour' })).toHaveCount(0);
});

test('« Je ne sais pas » : où le vérifier, puis l’application gardée', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-nsp').click();
  await expect(page.getByTestId('note-compte').getByRole('link', { name: 'business.facebook.com' })).toHaveAttribute('href', 'https://business.facebook.com/');
  await page.getByTestId('question-application-oui').click();
  await page.getByTestId('question-numero-application-oui').click();
  await page.getByTestId('question-meme-numero-oui').click();
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/télécharger|Téléchargez/);
});

test('avec un compte Meta Business : le numéro API, libre ou fourni, et « Vous pouvez le garder »', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-oui').click();
  await expect(page.getByTestId('issue-api')).toContainText('Votre numéro API');
  await expect(page.getByTestId('choix-fourni')).toBeVisible();
  await expect(page.getByTestId('choix-apporte')).toBeVisible();
  await expect(page.getByTestId('question-application')).toHaveCount(0);
  // Avec un compte, le lot 4 ne change rien : ni « Comment voulez-vous utiliser WhatsApp ? », ni la question du numéro.
  await expect(page.getByTestId('question-deploiement')).toHaveCount(0);
  await expect(page.getByTestId('question-numero')).toHaveCount(0);
  await expect(page.getByTestId('issue-api')).toContainText('Votre numéro sert déjà dans WhatsApp ou dans l’application WhatsApp Business ?');
  await page.getByTestId('choix-coexistence').click();
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(page.getByTestId('whatsapp-ordinaire')).toContainText('elle vous propose de reprendre ce numéro, avec vos conversations');
  // WhatsApp Business s'installe sur le même téléphone : ses deux magasins, avec leur icône, sous la phrase.
  const ordinaire = page.getByTestId('whatsapp-ordinaire');
  await expect(ordinaire.getByRole('link', { name: 'App Store (iPhone)' })).toHaveAttribute('href', /id1386412985/);
  await expect(ordinaire.getByRole('link', { name: 'Google Play (Android)' })).toHaveAttribute('href', /com\.whatsapp\.w4b/);
  await expect(ordinaire.getByRole('link').locator('svg')).toHaveCount(2);
  // « Retour » ramène aux questions, la réponse gardée en évidence ; une autre réponse change la suite.
  await page.getByRole('button', { name: 'Retour' }).click();
  await expect(page.getByTestId('question-compte-oui')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('issue-api')).toBeVisible();
  await page.getByTestId('question-compte-non').click();
  await expect(page.getByTestId('issue-api')).toHaveCount(0);
  await expect(page.getByTestId('question-application')).toBeVisible();
});

test('🔴 sans compte ni application, par l’API, sans numéro : un numéro de chez nous, relié par la fenêtre de Meta, jamais dans l’application (2026-11-12, lot 4)', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { abonnement: 'actif', lecturesAvantCode: 100 });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-non').click();
  await page.getByTestId('question-application-non').click();
  await page.getByTestId('question-deploiement-api').click();
  await page.getByTestId('question-numero-non').click();
  const issue = page.getByTestId('issue-fourni');
  await expect(issue).toContainText('Un numéro de chez nous, relié par Meta');
  await expect(issue).toContainText('la fenêtre de Meta le relie à l’API officielle de WhatsApp');
  // 🔴 Rien sur l'application : ni à télécharger, ni à garder, ni ses magasins.
  await expect(issue).not.toContainText(/application|Téléchargez|App Store|Google Play/);
  await expect(page.getByTestId('issue-api')).toHaveCount(0);
  await page.getByTestId('choix-issue-fourni').click();
  // 🔴 La voie retenue chez le serveur (lot 3 du 2026-11-17) : la fenêtre de Meta, jamais l'application.
  await expect.poll(() => etat.destinations).toEqual([{ destination: 'api' }]);
  await expect(page.getByTestId('choix-fourni-ouvert')).toContainText('que vous connecterez dans la fenêtre de Meta');
  // 🔴 Le tunnel de la console n'a pas l'encadré « Avant de commencer » : les questions le disent une à une (2026-11-17).
  await expect(page.getByTestId('prerequis-meta')).toHaveCount(0);
  await page.getByTestId('obtenir-numero').click();
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  // Par la fenêtre de Meta, le code par l'appel (lot 2c), jamais dans l'application.
  await expect(page.getByTestId('etapes-numero-fourni').locator('li[data-insiste]')).toContainText('Phone call');
  await expect(page.getByTestId('code-capte')).toContainText('En attente du code de Meta');
  await expect(page.getByTestId('ouvrir-fenetre-meta')).toBeVisible();
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toHaveCount(0);
  await expect(page.getByTestId('suite-fourni-application')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/QR/);
  expect(etat.gestes).toEqual(['obtenir']);
  // 🔴 Un rechargement reprend le numéro par la fenêtre de Meta : la mémoire de l'onglet dit `fourni`.
  await page.reload();
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  await expect(page.getByTestId('ouvrir-fenetre-meta')).toBeVisible();
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toHaveCount(0);
});

test('🔴 la reprise d’un numéro fourni mis dans l’application : sa variante, ses étapes, puis la garder', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  // L'onglet a gardé la variante (`fourni_application`), et le numéro est déjà attribué.
  await page.addInitScript(() => { window.localStorage.setItem('mba.numero-variante.t-e2e', 'fourni_application'); });
  const etat = await simulerNumeroFourni(page, { abonnement: 'actif', lecturesAvantCode: 100 });
  etat.numero = '+441235619343';
  await page.goto('/connecter-whatsapp');
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  await expect(page.getByTestId('etapes-numero-fourni')).toContainText('créez le compte avec ce numéro');
  await expect(page.getByTestId('code-capte')).toContainText('En attente du code de WhatsApp');
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(page.getByTestId('ouvrir-fenetre-meta')).toHaveCount(0);
  await expect(page.getByTestId('suite-fourni-application')).toContainText('Dès le premier jour');
  await expect(page.getByTestId('suite-fourni-application')).not.toContainText('Meta refuse');
  await expect(page.locator('main')).not.toContainText(/QR/);
  expect(etat.gestes).toEqual([]);
});

test('🟡 avec l’application et ce numéro-là, aucune autre question ni numéro proposé', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-nsp').click();
  await page.getByTestId('question-application-oui').click();
  await page.getByTestId('question-numero-application-oui').click();
  await page.getByTestId('question-meme-numero-oui').click();
  await expect(page.getByTestId('question-deploiement')).toHaveCount(0);
  await expect(page.getByTestId('question-numero')).toHaveCount(0);
  await expect(page.getByTestId('question-fournir')).toHaveCount(0);
  await expect(page.getByTestId('issue-fourni')).toHaveCount(0);
  await expect(page.getByTestId('issue-fourni-application')).toHaveCount(0);
  await expect(page.getByTestId('issue-installer')).toHaveCount(0);
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
});

/**
 * LE CAS 4 (Julien, 2026-11-08, lot 3a), revu aux lots 3 et 4 du 2026-11-17 : l'application WhatsApp Business, un numéro
 * dedans, mais pas celui-là. « Comment voulez-vous utiliser WhatsApp ? » propose alors un 2e compte dans l'application
 * (deux au plus) ou l'API ; l'application demande s'il faut fournir un numéro. Oui, un numéro de chez nous mis DANS
 * l'application, puis la fenêtre de Meta la garde (`fourni_application`), et la console retient la voie de l'application
 * chez le serveur.
 */
test('🔴 le cas 4 : l’application, pas ce numéro-là, un 2e compte, un numéro de chez nous mis dans l’application, puis la garder (lots 3 et 4)', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { lecturesAvantCode: 100 });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-non').click();
  await page.getByTestId('question-application-oui').click();
  await expect(page.getByTestId('question-numero-application')).toContainText('Avez-vous déjà un numéro qui fonctionne sur cette application ?');
  await expect(page.getByTestId('question-numero-application')).toContainText('Un numéro installé dans votre application WhatsApp Business.');
  await page.getByTestId('question-numero-application-oui').click();
  await expect(page.getByTestId('question-meme-numero')).toContainText('Voulez-vous utiliser ce numéro-là ?');
  await expect(page.getByTestId('question-meme-numero')).toContainText('Celui de votre application WhatsApp Business.');
  await expect(page.getByTestId('question-deploiement')).toHaveCount(0);
  await expect(page.getByTestId('question-fournir')).toHaveCount(0);
  await page.getByTestId('question-meme-numero-non').click();
  // Pas ce numéro-là (lot 4) : un 2e compte dans l'application, ou l'API. Rien d'autre avant la réponse.
  await expect(page.getByTestId('question-deploiement')).toHaveAttribute('data-variante', 'second');
  await expect(page.getByTestId('deploiement-application')).toContainText('Un 2e compte dans l’application WhatsApp Business');
  await expect(page.getByTestId('question-fournir')).toHaveCount(0);
  await expect(page.getByTestId('question-numero')).toHaveCount(0);
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toHaveCount(0);
  await page.getByTestId('question-deploiement-application').click();
  const fournir = page.getByTestId('question-fournir');
  await expect(fournir).toContainText('Souhaitez-vous qu’on vous fournisse un numéro ?');
  await expect(fournir).toContainText('Un numéro britannique dédié, que vous mettez dans votre application WhatsApp Business.');
  // Le 2e compte se crée dans l'application qu'on a déjà : rien à installer.
  await expect(page.getByTestId('note-installer-application')).toHaveCount(0);
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toHaveCount(0);
  await page.getByTestId('question-fournir-oui').click();
  const issue = page.getByTestId('issue-fourni-application');
  await expect(issue).toContainText('Un numéro de chez nous, dans votre application WhatsApp Business');
  await expect(issue).toContainText('inclus en formule Pro');
  // Son prix selon l'espace (lot 5 du 2026-11-17) : une Free le lit avec la formule Pro qui l'inclut.
  await expect(issue.getByTestId('prix-numero-fourni')).toHaveText('Ce numéro coûte 3,50 € par mois en formule Free, et il est inclus en formule Pro.');
  await expect(issue).toContainText('le code de vérification s’affiche sur la page de connexion');
  await expect(issue).toContainText('appuyez sur le bouton « Ouvrir la fenêtre de Meta », qui relie ainsi votre application à Messaging Me');
  // Comme chaque voie qui garde l'application : Meta se paie avec sa carte.
  await expect(issue.getByTestId('note-carte-application')).toHaveText('Vous payez Meta avec votre carte : la ligne de crédit n’est pas possible avec l’application.');
  await expect(page.getByTestId('issue-installer')).toHaveCount(0);
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toHaveCount(0);
  // Les questions restent : « Oui » à ce numéro-là rouvre la carte de l'application, « Non » repose « Comment voulez-vous
  // utiliser WhatsApp ? », sans réponse ni suite.
  await expect(page.getByTestId('question-meme-numero-non')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('question-meme-numero-oui').click();
  await expect(page.getByTestId('question-deploiement')).toHaveCount(0);
  await expect(page.getByTestId('question-fournir')).toHaveCount(0);
  await expect(page.getByTestId('issue-fourni-application')).toHaveCount(0);
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await page.getByTestId('question-meme-numero-non').click();
  await expect(page.getByTestId('question-deploiement-application')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('question-deploiement-api')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('question-fournir')).toHaveCount(0);
  await page.getByTestId('question-deploiement-application').click();
  await expect(page.getByTestId('question-fournir-oui')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('question-fournir-oui').click();
  await page.getByTestId('choix-fourni-application').click();
  // 🔴 La voie de l'application, retenue chez le serveur : sans elle, il ne montrerait pas le code de l'application.
  await expect.poll(() => etat.destinations).toEqual([{ destination: 'application' }]);
  await expect(page.getByTestId('choix-fourni-ouvert')).toContainText('que vous ajouterez dans l’application WhatsApp Business');
  // 🔴 Le tunnel de la console n'a pas l'encadré « Avant de commencer » : les questions le disent une à une (2026-11-17).
  await expect(page.getByTestId('prerequis-meta')).toHaveCount(0);
  await page.getByTestId('obtenir-numero').click();
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  // Le numéro mis dans l'application : ses étapes et son code, puis la fenêtre qui garde l'application, jamais celle du
  // numéro API.
  await expect(page.getByTestId('etapes-numero-fourni')).toContainText('créez le compte avec ce numéro');
  await expect(page.getByTestId('code-capte')).toContainText('En attente du code de WhatsApp');
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(page.getByTestId('ouvrir-fenetre-meta')).toHaveCount(0);
  await expect(page.getByTestId('suite-fourni-application')).toContainText('Dès le premier jour');
  await expect(page.getByTestId('suite-fourni-application')).not.toContainText('Meta refuse');
  await expect(page.getByTestId('suite-fourni-application').getByTestId('note-carte-application')).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/QR/);
  expect(etat.gestes).toEqual(['obtenir']);
  // 🔴 Un rechargement reprend le numéro dans l'application : la mémoire de l'onglet dit `fourni_application`.
  await page.reload();
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(page.getByTestId('ouvrir-fenetre-meta')).toHaveCount(0);
});

test('🔴 la voie de l’application refusée par le serveur (une API d’avant la route) : rien n’avance, la page le dit (relecture du lot 3)', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { sansRouteDeLaVoie: true });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-non').click();
  await page.getByTestId('question-application-oui').click();
  await page.getByTestId('question-numero-application-non').click();
  await page.getByTestId('question-deploiement-application').click();
  await page.getByTestId('question-fournir-oui').click();
  await page.getByTestId('choix-fourni-application').click();
  await expect.poll(() => etat.destinations).toEqual([{ destination: 'application' }]);
  // Sans la voie retenue, le code de l'application serait caché : la page ne mène pas au paiement du numéro.
  await expect(page.getByTestId('erreur-connexion')).toContainText('Ce choix n’a pas pu être enregistré. Réessayez dans quelques minutes.');
  await expect(page.getByTestId('choix-fourni-ouvert')).toHaveCount(0);
  await expect(page.getByTestId('issue-fourni-application')).toBeVisible();
  expect(etat.gestes).toEqual([]);
});

test('🔴 l’application sans numéro dedans, « Avec l’application » : « Non » au numéro fourni, un numéro à vous à y installer, puis la garder (lots 3 et 4)', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-non').click();
  await page.getByTestId('question-application-oui').click();
  await page.getByTestId('question-numero-application-non').click();
  // Aucun numéro dans l'application, donc pas de « ce numéro-là ? » : comment utiliser WhatsApp (lot 4), puis, avec
  // l'application, la question du numéro fourni.
  await expect(page.getByTestId('question-meme-numero')).toHaveCount(0);
  await expect(page.getByTestId('question-deploiement')).toHaveAttribute('data-variante', 'vide');
  await expect(page.getByTestId('question-fournir')).toHaveCount(0);
  await page.getByTestId('question-deploiement-application').click();
  await expect(page.getByTestId('question-fournir')).toContainText('Souhaitez-vous qu’on vous fournisse un numéro ?');
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toHaveCount(0);
  await page.getByTestId('question-fournir-non').click();
  const installer = page.getByTestId('issue-installer');
  await expect(installer).toContainText('Mettez un numéro à vous dans l’application');
  await expect(installer).toContainText('une ligne mobile, qui reçoit le code de WhatsApp par SMS ou par appel');
  await expect(installer).toContainText('appuyez sur le bouton « Ouvrir la fenêtre de Meta », qui relie ainsi votre application à Messaging Me');
  // Sous l'issue, la carte qui garde l'application : son bouton et le moyen de paiement chez Meta, ni magasins ni QR code.
  await expect(installer.getByTestId('choix-coexistence-ouvert')).toBeVisible();
  await expect(installer.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(installer.getByTestId('note-carte-application')).toBeVisible();
  await expect(page.getByTestId('whatsapp-ordinaire')).toHaveCount(0);
  await expect(installer).not.toContainText(/QR|scann|App Store|Google Play/);
  await expect(page.getByTestId('issue-fourni-application')).toHaveCount(0);
  // « Oui » au numéro fourni : le numéro de chez nous mis dans l'application, à la place (« Oui », « Non », « Avec
  // l’application », « Oui »).
  await page.getByTestId('question-fournir-oui').click();
  await expect(page.getByTestId('issue-installer')).toHaveCount(0);
  await expect(page.getByTestId('issue-fourni-application')).toBeVisible();
  // Un numéro dans l'application, finalement : « ce numéro-là ? » revient, et la suite de l'autre réponse s'efface.
  await page.getByTestId('question-numero-application-oui').click();
  await expect(page.getByTestId('question-meme-numero')).toBeVisible();
  await expect(page.getByTestId('question-deploiement')).toHaveCount(0);
  await expect(page.getByTestId('question-fournir')).toHaveCount(0);
  await expect(page.getByTestId('issue-fourni-application')).toHaveCount(0);
  // Répondre ne retient ni n'attribue rien : seul le bouton d'une issue le fait.
  expect(etat.gestes).toEqual([]);
  expect(etat.destinations).toEqual([]);
});

/*
 * LE LOT 4 DU 2026-11-17 (même plan, après l'essai de la console par Julien) : « Comment voulez-vous utiliser
 * WhatsApp ? » et ses trois variantes, « Oui » au numéro qui ne propose plus que le sien, la bulle de « WhatsApp
 * Business », les étapes à venir sous le paiement du numéro fourni, et le défilement de l'arbre.
 */

/** Le détail de la carte de l'application (« Ce que ça change »), au mot près. */
const BULLE_APPLICATION = 'Le nom et la photo se règlent dans l’application. Elle perd ses listes de diffusion et son message d’absence, et s’ouvre au moins toutes les deux semaines. Pas de ligne de crédit : vous payez Meta avec votre carte.';

/**
 * Les deux cartes de « Comment voulez-vous utiliser WhatsApp ? », au mot près : chacune telle qu'elle se lit (son titre,
 * sa ligne, « Ce que ça change » et sa réponse ; la bulle fermée n'y ajoute rien, `useInnerText`), puis le texte de
 * chaque bulle.
 */
async function cartesDeploiement(page: Page, application: { titre: string; bulle: string }) {
  await expect(page.getByTestId('deploiement-application')).toHaveText(
    `${application.titre} Vous répondez aussi depuis votre téléphone, et votre agent IA répond depuis Messaging Me. Ce que ça change Avec l’application`,
    { useInnerText: true },
  );
  await expect(page.getByTestId('deploiement-application-detail-bulle')).toHaveText(application.bulle);
  await expect(page.getByTestId('deploiement-api')).toHaveText(
    'Directement par l’API officielle Tout passe par Messaging Me : réponses automatiques, campagnes, Inbox à plusieurs. Ce que ça change Par l’API',
    { useInnerText: true },
  );
  await expect(page.getByTestId('deploiement-api-detail-bulle')).toHaveText(
    'Le nom affiché se personnalise chez Meta, qui le relit. Il faut un compte Meta Business : la fenêtre de Meta le crée en chemin.',
  );
}

test('🔴 « Non » à l’application, « Par l’API », « Oui » au numéro : le sien seul, jamais « Fournissez-moi un numéro » (lot 4)', async ({ page }) => {
  // Julien, 2026-11-17 : à qui répond avoir un numéro qu'il pourrait utiliser, « il ne faut pas lui proposer de lui
  // fournir un numéro ».
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-non').click();
  await page.getByTestId('question-application-non').click();
  await page.getByTestId('question-deploiement-api').click();
  await page.getByTestId('question-numero-oui').click();
  const issue = page.getByTestId('issue-api');
  await expect(issue).toContainText('Votre numéro API');
  await expect(issue.getByTestId('choix-apporte')).toBeVisible();
  await expect(page.getByTestId('choix-fourni')).toHaveCount(0);
  await expect(issue).not.toContainText('Fournissez-moi un numéro');
  // Garder son application reste possible, d'un lien.
  await expect(issue.getByTestId('choix-coexistence')).toBeVisible();
  // Son numéro passe par la fenêtre de Meta : rien n'est attribué, payé ni retenu.
  await issue.getByTestId('choix-apporte').click();
  await expect(page.getByTestId('choix-apporte-ouvert')).toBeVisible();
  await expect(page.getByTestId('ouvrir-fenetre-meta')).toBeVisible();
  expect(etat.gestes).toEqual([]);
  expect(etat.destinations).toEqual([]);
});

test('🔴 sans l’application : « Comment voulez-vous utiliser WhatsApp ? », deux cartes d’une ligne, le détail dans une bulle, et l’application à installer d’abord (lot 4)', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-non').click();
  await expect(page.getByTestId('question-deploiement')).toHaveCount(0);
  await page.getByTestId('question-application-non').click();
  // La souris hors de l'arbre : seul le geste du test ouvre une bulle.
  await page.mouse.move(0, 0);
  const question = page.getByTestId('question-deploiement');
  await expect(question).toHaveAttribute('data-variante', 'sans');
  await expect(question).toContainText('Comment voulez-vous utiliser WhatsApp ?');
  await expect(question).toContainText('Deux façons de relier votre numéro à Messaging Me.');
  await cartesDeploiement(page, { titre: 'Avec l’application WhatsApp Business', bulle: BULLE_APPLICATION });
  // Rien de choisi d'avance, rien de la suite.
  await expect(page.getByTestId('question-deploiement-application')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('question-deploiement-api')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('note-installer-application')).toHaveCount(0);
  await expect(page.getByTestId('question-fournir')).toHaveCount(0);
  await expect(page.getByTestId('question-numero')).toHaveCount(0);

  // « Ce que ça change » : la bulle s'ouvre au survol et se referme quand la souris s'en va ; elle s'ouvre aussi au clic
  // seul, sans survol ni focus (le doigt sur un écran tactile) ; Échap la ferme.
  const detail = page.getByTestId('deploiement-api-detail');
  const bulle = page.getByTestId('deploiement-api-detail-bulle');
  await expect(detail).toHaveText('Ce que ça change');
  await expect(bulle).toBeHidden();
  await expect(detail).toHaveAttribute('aria-expanded', 'false');
  await detail.hover();
  await expect(bulle).toBeVisible();
  await expect(detail).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.move(0, 0);
  await expect(bulle).toBeHidden();
  await detail.dispatchEvent('click');
  await expect(bulle).toBeVisible();
  await detail.focus();
  await page.keyboard.press('Escape');
  await expect(bulle).toBeHidden();
  await expect(detail).toHaveAttribute('aria-expanded', 'false');
  // Une bulle à la fois : celle de l'autre carte est restée fermée.
  await expect(page.getByTestId('deploiement-application-detail-bulle')).toBeHidden();

  // L'application : l'installer d'abord, elle est gratuite, ses deux magasins ; puis faut-il fournir un numéro ?
  await page.getByTestId('question-deploiement-application').click();
  await expect(page.getByTestId('question-deploiement-application')).toHaveAttribute('aria-pressed', 'true');
  const note = page.getByTestId('note-installer-application');
  await expect(note).toContainText('Installez d’abord WhatsApp Business sur votre téléphone : elle est gratuite.');
  await expect(note.getByRole('link', { name: 'App Store (iPhone)' })).toHaveAttribute('href', 'https://apps.apple.com/app/whatsapp-business/id1386412985');
  await expect(note.getByRole('link', { name: 'Google Play (Android)' })).toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=com.whatsapp.w4b');
  await expect(page.getByTestId('question-fournir')).toContainText('Souhaitez-vous qu’on vous fournisse un numéro ?');
  await expect(page.getByTestId('question-numero')).toHaveCount(0);
  // L'API, finalement : rien à installer ni de numéro fourni à demander, la question de son numéro.
  await page.getByTestId('question-deploiement-api').click();
  await expect(page.getByTestId('note-installer-application')).toHaveCount(0);
  await expect(page.getByTestId('question-fournir')).toHaveCount(0);
  await expect(page.getByTestId('question-numero')).toContainText('Avez-vous déjà un numéro que vous pourriez utiliser ?');
  // Répondre ne retient ni n'attribue rien.
  expect(etat.gestes).toEqual([]);
  expect(etat.destinations).toEqual([]);
});

test('🔴 l’application sans numéro dedans, puis pour un autre numéro : les mêmes cartes, rien à installer, et « un 2e compte, deux au plus » pour l’autre numéro (lot 4)', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-nsp').click();
  await page.getByTestId('question-application-oui').click();
  await expect(page.getByTestId('question-deploiement')).toHaveCount(0);
  // Aucun numéro dans l'application : les cartes de sans l'application, mais rien à installer.
  await page.getByTestId('question-numero-application-non').click();
  // La souris hors de l'arbre : seul le geste du test ouvre une bulle.
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('question-deploiement')).toHaveAttribute('data-variante', 'vide');
  await cartesDeploiement(page, { titre: 'Avec l’application WhatsApp Business', bulle: BULLE_APPLICATION });
  await page.getByTestId('question-deploiement-application').click();
  await expect(page.getByTestId('question-fournir')).toBeVisible();
  await expect(page.getByTestId('note-installer-application')).toHaveCount(0);
  // Un numéro dedans, mais pas celui-là : un 2e compte dans la même application, qui en porte deux au plus.
  await page.getByTestId('question-numero-application-oui').click();
  await expect(page.getByTestId('question-deploiement')).toHaveCount(0);
  await page.getByTestId('question-meme-numero-non').click();
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('question-deploiement')).toHaveAttribute('data-variante', 'second');
  await cartesDeploiement(page, {
    titre: 'Un 2e compte dans l’application WhatsApp Business',
    bulle: `Une application WhatsApp Business porte deux comptes au plus. ${BULLE_APPLICATION}`,
  });
  // Posée de nouveau, la question n'a pas de réponse : celle donnée sans numéro dans l'application ne reste pas.
  await expect(page.getByTestId('question-deploiement-application')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('question-fournir')).toHaveCount(0);
  // Sa bulle dit la limite, au survol.
  await page.getByTestId('deploiement-application-detail').hover();
  await expect(page.getByTestId('deploiement-application-detail-bulle')).toBeVisible();
  await expect(page.getByTestId('deploiement-application-detail-bulle')).toContainText('deux comptes au plus');
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('deploiement-application-detail-bulle')).toBeHidden();
  await page.getByTestId('question-deploiement-application').click();
  await expect(page.getByTestId('question-fournir')).toBeVisible();
  await expect(page.getByTestId('note-installer-application')).toHaveCount(0);
  // L'API, pour cet autre numéro : la question de son numéro.
  await page.getByTestId('question-deploiement-api').click();
  await expect(page.getByTestId('question-fournir')).toHaveCount(0);
  await expect(page.getByTestId('question-numero')).toBeVisible();
});

test('🟡 la bulle de « WhatsApp Business » : le logo de l’application, ce qu’elle est, et ses deux magasins (lot 4)', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-non').click();
  // La souris hors de l'arbre : seul le geste du test ouvre la bulle.
  await page.mouse.move(0, 0);
  const question = page.getByTestId('question-application');
  const terme = question.getByTestId('bulle-whatsapp-business');
  const bulle = question.getByTestId('bulle-whatsapp-business-bulle');
  // Le terme du titre ouvre la bulle ; fermée, elle n'ajoute rien à ce qu'on lit.
  await expect(terme).toHaveText('WhatsApp Business');
  await expect(question).toContainText('Avez-vous déjà l’application WhatsApp Business ?', { useInnerText: true });
  await expect(bulle).toBeHidden();
  await expect(terme).toHaveAttribute('aria-expanded', 'false');
  await terme.hover();
  await expect(bulle).toBeVisible();
  await expect(terme).toHaveAttribute('aria-expanded', 'true');
  await expect(bulle).toContainText('L’application WhatsApp des professionnels, gratuite : son logo est la bulle verte de WhatsApp, marquée d’un B. Elle est distincte de WhatsApp, l’application ordinaire.');
  // Le logo de l'application, celui de la vitrine, et il se charge : un fichier oublié dans `web/public/` laisserait un
  // cadre vide.
  const logo = bulle.locator('img');
  await expect(logo).toHaveAttribute('src', '/logos/whatsapp-business.png');
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // Ses deux magasins, avec leur icône.
  await expect(bulle.getByRole('link', { name: 'App Store (iPhone)' })).toHaveAttribute('href', 'https://apps.apple.com/app/whatsapp-business/id1386412985');
  await expect(bulle.getByRole('link', { name: 'Google Play (Android)' })).toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=com.whatsapp.w4b');
  await expect(bulle.getByRole('link').locator('svg')).toHaveCount(2);
  await page.mouse.move(0, 0);
  await expect(bulle).toBeHidden();
  // Au clavier : le focus l'ouvre, il passe à ses liens sans la fermer, et Échap la ferme.
  await terme.focus();
  await expect(bulle).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(bulle.getByRole('link', { name: 'App Store (iPhone)' })).toBeFocused();
  await expect(bulle).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bulle).toBeHidden();
  // La bulle n'est pas une réponse : la question attend toujours la sienne.
  await expect(page.getByTestId('question-application-oui')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('question-application-non')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('question-deploiement')).toHaveCount(0);
});

/** Les étapes à venir du numéro fourni : la première en cours (en gras), les suivantes grisées. */
async function etapesAVenir(page: Page, premiere: string, suivantes: readonly string[]) {
  const etapes = page.getByTestId('choix-fourni-ouvert').getByTestId('etapes-a-venir').locator('li');
  await expect(etapes).toHaveText([premiere, ...suivantes]);
  await expect(etapes.first()).toHaveAttribute('aria-current', 'step');
  await expect(etapes.first()).not.toHaveClass(/text-ink-400/);
  for (let i = 1; i <= suivantes.length; i += 1) {
    await expect(etapes.nth(i)).not.toHaveAttribute('aria-current');
    await expect(etapes.nth(i)).toHaveClass(/text-ink-400/);
  }
}
/** Après le numéro fourni par la fenêtre de Meta, puis après le numéro mis dans l'application. */
const ETAPES_FENETRE_META = ['Votre numéro s’affiche, et son code quand Meta l’appelle', 'La fenêtre de Meta : vous y saisissez le numéro et le code'];
const ETAPES_APPLICATION = ['Vous l’ajoutez dans l’application : son code s’affiche ici', 'La fenêtre de Meta garde votre application'];

test.describe('les étapes à venir, grisées, sous le paiement du numéro fourni (lot 4)', () => {
  test('🟡 par la fenêtre de Meta : « Payer le numéro » en cours, puis le numéro et son code, puis la fenêtre de Meta', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    await simulerNumeroFourni(page, { abonnement: null });
    await page.goto('/connecter-whatsapp');
    await page.getByTestId('carte-meta-choisir').click();
    await page.getByTestId('question-compte-non').click();
    await page.getByTestId('question-application-non').click();
    await page.getByTestId('question-deploiement-api').click();
    await page.getByTestId('question-numero-non').click();
    await page.getByTestId('choix-issue-fourni').click();
    await expect(page.getByTestId('payer-numero')).toBeVisible();
    await etapesAVenir(page, 'Payer le numéro', ETAPES_FENETRE_META);
  });

  test('🟡 mis dans l’application : « Payer le numéro » en cours, puis l’y ajouter, puis la fenêtre de Meta qui la garde', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    const etat = await simulerNumeroFourni(page, { abonnement: null });
    await page.goto('/connecter-whatsapp');
    await page.getByTestId('carte-meta-choisir').click();
    await page.getByTestId('question-compte-non').click();
    await page.getByTestId('question-application-non').click();
    await page.getByTestId('question-deploiement-application').click();
    await page.getByTestId('question-fournir-oui').click();
    await page.getByTestId('choix-fourni-application').click();
    await expect.poll(() => etat.destinations).toEqual([{ destination: 'application' }]);
    await expect(page.getByTestId('payer-numero')).toBeVisible();
    await etapesAVenir(page, 'Payer le numéro', ETAPES_APPLICATION);
  });

  test('🟡 le numéro inclus dans le Pro : « Obtenir le numéro » en cours, puis les étapes du numéro une fois obtenu', async ({ page }) => {
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    await simulerNumeroFourni(page, { abonnement: null, inclusDansLePro: true, lecturesAvantCode: 100 });
    await page.goto('/connecter-whatsapp');
    await page.getByTestId('carte-meta-choisir').click();
    await page.getByTestId('question-compte-oui').click();
    await page.getByTestId('choix-fourni').click();
    await expect(page.getByTestId('numero-inclus')).toBeVisible();
    await etapesAVenir(page, 'Obtenir le numéro', ETAPES_FENETRE_META);
    // Le numéro obtenu, ses propres étapes prennent la place des étapes à venir.
    await page.getByTestId('obtenir-numero').click();
    await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
    await expect(page.getByTestId('etapes-a-venir')).toHaveCount(0);
    await expect(page.getByTestId('etapes-numero-fourni')).toBeVisible();
  });
});

test.describe('l’arbre de la console défile seul (lot 4)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('🟡 après chaque réponse, la suite vient entière à l’écran, sans défiler à la main', async ({ page }) => {
    // Julien, 2026-11-17 : « on est obligé de scroller à la main pour descendre à la dernière question ».
    await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
    await simulerNumeroFourni(page, { abonnement: null });
    await page.goto('/connecter-whatsapp');
    await page.getByTestId('carte-meta-choisir').click();
    // Chaque réponse, et ce qui doit venir à l'écran. Hors la première et celle qui remonte changer de branche, chaque
    // réponse se clique dans ce qui vient d'arriver : Playwright n'a pas à défiler pour elle, seul le parcours l'a amenée.
    // « Entière » à l'arrondi du défilement près (95 %) : sans le défilement, la suite apparaît coupée par le bas de
    // l'écran.
    const etapes: Array<[string, string]> = [
      ['question-compte-non', 'question-application'],
      ['question-application-non', 'question-deploiement'],
      ['question-deploiement-api', 'question-numero'],
      ['question-numero-oui', 'issue-api'],
      // Une réponse plus haut change de branche : l'application, un numéro dedans, pas celui-là, un 2e compte, un numéro
      // fourni.
      ['question-application-oui', 'question-numero-application'],
      ['question-numero-application-oui', 'question-meme-numero'],
      ['question-meme-numero-non', 'question-deploiement'],
      ['question-deploiement-application', 'question-fournir'],
      ['question-fournir-oui', 'issue-fourni-application'],
    ];
    for (const [reponse, suite] of etapes) {
      await page.getByTestId(reponse).click();
      // La souris hors de l'arbre : le défilement ne la fait passer sur aucune bulle, qui couvrirait le bouton suivant.
      await page.mouse.move(0, 0);
      await expect(page.getByTestId(suite), `après ${reponse}`).toBeInViewport({ ratio: 0.95 });
    }
  });
});
