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
} = {}) {
  const etat = {
    numero: null as string | null, lectures: 0, gestes: [] as string[],
    abonnement: (o.abonnement === undefined ? 'actif' : o.abonnement) as 'actif' | 'resilie' | null, retours: [] as string[],
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

  await page.getByTestId('question-compte-oui').click();
  await page.getByTestId('choix-fourni').click();
  await page.getByTestId('obtenir-numero').click();
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  // 🔴 L'appel, pas le SMS (lot 2c) : l'étape en gras est celle de « Phone call », l'exception dite à part, en petit.
  const appel = page.getByTestId('etapes-numero-fourni').locator('li[data-insiste]');
  await expect(appel).toHaveCount(1);
  await expect(appel).toContainText('choisissez « Phone call » (l’appel), surtout pas « Text message »');
  await expect(appel).toHaveCSS('font-weight', '600');
  await expect(page.getByTestId('si-seul-text-message')).toContainText('ne propose que « Text message », prenez-le');
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
 * le compte Meta Business, puis l'application WhatsApp Business. Plus aucune voie par QR code. Depuis le 2026-11-12
 * (plan `docs/superpowers/plans/2026-11-12-arbre-numero-sans-application.md`), sans compte ni application, plus rien à
 * télécharger : le numéro API, ou un numéro de chez nous relié par la fenêtre de Meta.
 */
test('🔴 sans compte Meta Business ni application, avec un numéro : le numéro API, sans rien à télécharger (2026-11-12)', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await expect(page.getByTestId('question-compte')).toContainText('Avez-vous un compte Meta Business ?');
  // Rien n'est choisi tant qu'on n'a pas répondu.
  await expect(page.getByTestId('choix-fourni')).toHaveCount(0);
  await page.getByTestId('question-compte-non').click();
  await expect(page.getByTestId('note-compte')).toContainText('la fenêtre de Meta vous le fera créer en chemin');
  await expect(page.getByTestId('question-application')).toContainText('Avez-vous déjà l’application WhatsApp Business ?');
  await page.getByTestId('question-application-non').click();
  // 🔴 La question du numéro tout de suite : ni note « il faudra la télécharger », ni magasins.
  await expect(page.getByTestId('question-numero')).toContainText('Avez-vous déjà un numéro que vous pourriez utiliser ?');
  await expect(page.getByTestId('question-numero')).toContainText('Le numéro de votre entreprise, relié à l’API officielle de WhatsApp.');
  await expect(page.locator('main')).not.toContainText(/télécharger|Téléchargez|App Store|Google Play/);
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
  await expect(page.getByTestId('question-numero-oui')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('question-application-oui').click();
  await expect(page.getByTestId('question-numero')).toHaveCount(0);
  await expect(page.getByTestId('issue-api')).toHaveCount(0);
  // Avec l'application, ce numéro-là ? (le cas 4, lot 3a) : rien ne s'ouvre avant la réponse.
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
  await page.getByTestId('question-compte-nsp').click();
  await expect(page.getByTestId('note-compte').getByRole('link', { name: 'business.facebook.com' })).toHaveAttribute('href', 'https://business.facebook.com/');
  await page.getByTestId('question-application-oui').click();
  await page.getByTestId('question-meme-numero-oui').click();
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/télécharger|Téléchargez/);
});

test('avec un compte Meta Business : le numéro API, libre ou fourni, et « Vous pouvez le garder »', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('question-compte-oui').click();
  await expect(page.getByTestId('issue-api')).toContainText('Votre numéro API');
  await expect(page.getByTestId('choix-fourni')).toBeVisible();
  await expect(page.getByTestId('choix-apporte')).toBeVisible();
  await expect(page.getByTestId('question-application')).toHaveCount(0);
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

test('🔴 sans compte, sans application, sans numéro : un numéro de chez nous, relié par la fenêtre de Meta, jamais dans l’application (2026-11-12)', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { abonnement: 'actif', lecturesAvantCode: 100 });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('question-compte-non').click();
  await page.getByTestId('question-application-non').click();
  await page.getByTestId('question-numero-non').click();
  const issue = page.getByTestId('issue-fourni');
  await expect(issue).toContainText('Un numéro de chez nous, relié par Meta');
  await expect(issue).toContainText('la fenêtre de Meta le relie à l’API officielle de WhatsApp');
  // 🔴 Rien sur l'application : ni à télécharger, ni à garder, ni ses magasins.
  await expect(issue).not.toContainText(/application|Téléchargez|App Store|Google Play/);
  await expect(page.getByTestId('issue-api')).toHaveCount(0);
  await page.getByTestId('choix-issue-fourni').click();
  await expect(page.getByTestId('choix-fourni-ouvert')).toContainText('que vous connecterez dans la fenêtre de Meta');
  // Au numéro fourni, la condition d'un numéro à soi se tait, comme chez Claude (jaune 10 du lot 3a).
  await expect(page.getByTestId('prerequis-meta').locator('li')).toHaveCount(2);
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

test('🔴 la reprise d’un numéro fourni mis dans l’application avant le 2026-11-12 : sa variante, ses étapes, puis la garder', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  // L'onglet a gardé la variante d'avant (`fourni_application`), et le numéro est déjà attribué.
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

test('🟡 avec l’application et ce numéro-là, aucune 4e question ni numéro proposé', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('question-compte-nsp').click();
  await page.getByTestId('question-application-oui').click();
  await page.getByTestId('question-meme-numero-oui').click();
  await expect(page.getByTestId('question-numero')).toHaveCount(0);
  await expect(page.getByTestId('issue-fourni')).toHaveCount(0);
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
});

/**
 * LE CAS 4 (Julien, 2026-11-08, lot 3a) : l'application WhatsApp Business, mais pas pour ce numéro-là. Aucun numéro ne
 * part vers la coexistence : un numéro de chez nous, relié par la fenêtre de Meta, et l'application garde le sien.
 */
test('🔴 le cas 4 : l’application, pas ce numéro-là, donc un numéro de chez nous par la fenêtre de Meta (lot 3a)', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  const etat = await simulerNumeroFourni(page, { lecturesAvantCode: 100 });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('question-compte-non').click();
  await page.getByTestId('question-application-oui').click();
  await expect(page.getByTestId('question-meme-numero')).toContainText('Voulez-vous utiliser ce numéro-là ?');
  await expect(page.getByTestId('question-meme-numero')).toContainText('Celui de votre application WhatsApp Business.');
  await page.getByTestId('question-meme-numero-non').click();
  const issue = page.getByTestId('issue-autre-numero');
  await expect(issue).toContainText('Un numéro de chez nous, relié par Meta');
  await expect(issue).toContainText('Votre application WhatsApp Business garde le sien.');
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toHaveCount(0);
  await expect(page.getByTestId('question-numero')).toHaveCount(0);
  // Les questions restent : « Oui » rouvre la carte de l'application, « Non » rend le numéro de chez nous.
  await expect(page.getByTestId('question-meme-numero-non')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('question-meme-numero-oui').click();
  await expect(page.getByTestId('issue-autre-numero')).toHaveCount(0);
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await page.getByTestId('question-meme-numero-non').click();
  await page.getByTestId('choix-autre-numero').click();
  // Au numéro fourni, la condition d'un numéro à soi se tait, comme chez Claude (jaune 10 du lot 3a).
  await expect(page.getByTestId('prerequis-meta').locator('li')).toHaveCount(2);
  await page.getByTestId('obtenir-numero').click();
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  // Par la fenêtre de Meta, le code par l'appel (lot 2c), jamais dans l'application.
  await expect(page.getByTestId('etapes-numero-fourni').locator('li[data-insiste]')).toContainText('Phone call');
  await expect(page.getByTestId('code-capte')).toContainText('En attente du code de Meta');
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toHaveCount(0);
  expect(etat.gestes).toEqual(['obtenir']);
});
