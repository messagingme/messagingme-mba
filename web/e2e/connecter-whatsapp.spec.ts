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
 * le compte Meta Business, puis l'application WhatsApp Business. Plus aucune voie par QR code.
 */
test('🔴 sans compte Meta Business ni application : la télécharger, brancher tout de suite, et le numéro trop neuf', async ({ page }) => {
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
  // Avant la 4e question, « il faudra la télécharger », avec les deux magasins et leur icône (Julien, 2026-10-31).
  const note = page.getByTestId('note-application');
  await expect(note).toContainText('Vous allez devoir télécharger l’application WhatsApp Business.');
  await expect(note.getByRole('link', { name: 'App Store (iPhone)' })).toHaveAttribute('href', /id1386412985/);
  await expect(note.getByRole('link', { name: 'Google Play (Android)' })).toHaveAttribute('href', /com\.whatsapp\.w4b/);
  await expect(note.getByRole('link').locator('svg')).toHaveCount(2);
  // La 4e question (Julien, 2026-10-31) : avec son propre numéro, télécharger l’application et brancher tout de suite.
  await expect(page.getByTestId('question-numero')).toContainText('Avez-vous déjà un numéro que vous pourriez utiliser ?');
  await page.getByTestId('question-numero-oui').click();
  await expect(page.getByTestId('issue-telecharger')).toContainText('branchez-le tout de suite');
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(page.getByTestId('numero-trop-neuf')).toContainText('revenez le brancher');
  await expect(page.getByTestId('issue-telecharger').getByRole('link', { name: 'Google Play (Android)' })).toHaveAttribute('href', /com\.whatsapp\.w4b/);
  await expect(page.locator('main')).not.toContainText(/QR/);
  // Comme sur la vitrine : les questions restent affichées, la réponse choisie en évidence, et une autre change la suite.
  await expect(page.getByTestId('question-compte-non')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('question-compte-oui')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('question-application-non')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('question-application-oui').click();
  await expect(page.getByTestId('issue-telecharger')).toHaveCount(0);
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retour' })).toHaveCount(0);
});

test('« Je ne sais pas » : où le vérifier, puis l’application gardée, sans la télécharger', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('question-compte-nsp').click();
  await expect(page.getByTestId('note-compte').getByRole('link', { name: 'business.facebook.com' })).toHaveAttribute('href', 'https://business.facebook.com/');
  await page.getByTestId('question-application-oui').click();
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(page.getByTestId('issue-telecharger')).toHaveCount(0);
  await expect(page.getByTestId('numero-trop-neuf')).toHaveCount(0);
});

test('avec un compte Meta Business : le numéro API, libre ou fourni, et « Vous pouvez la garder »', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('question-compte-oui').click();
  await expect(page.getByTestId('issue-api')).toContainText('Votre numéro API');
  await expect(page.getByTestId('choix-fourni')).toBeVisible();
  await expect(page.getByTestId('choix-apporte')).toBeVisible();
  await expect(page.getByTestId('question-application')).toHaveCount(0);
  await page.getByTestId('choix-coexistence').click();
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(page.getByTestId('issue-telecharger')).toHaveCount(0);
  // « Retour » ramène aux questions, la réponse gardée en évidence ; une autre réponse change la suite.
  await page.getByRole('button', { name: 'Retour' }).click();
  await expect(page.getByTestId('question-compte-oui')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('issue-api')).toBeVisible();
  await page.getByTestId('question-compte-non').click();
  await expect(page.getByTestId('issue-api')).toHaveCount(0);
  await expect(page.getByTestId('question-application')).toBeVisible();
});

test('🔴 sans compte, sans application, sans numéro : le numéro fourni va dans l’application, puis se garde (2026-10-31)', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: 'actif', lecturesAvantCode: 100 });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('question-compte-non').click();
  await page.getByTestId('question-application-non').click();
  await page.getByTestId('question-numero-non').click();
  await expect(page.getByTestId('issue-fourni')).toContainText('nous vous fournissons le numéro');
  await expect(page.getByTestId('issue-fourni')).toContainText('Dès le premier jour');
  await expect(page.getByTestId('issue-fourni').getByRole('link', { name: 'App Store (iPhone)' })).toBeVisible();
  // Avec l’application déjà là, aucun numéro n’est proposé ; sans elle et sans numéro, si.
  await expect(page.getByTestId('issue-telecharger')).toHaveCount(0);
  await page.getByTestId('choix-fourni-application').click();
  await expect(page.getByTestId('choix-fourni-ouvert')).toContainText('que vous ajouterez dans l’application WhatsApp Business');
  await page.getByTestId('obtenir-numero').click();
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  await expect(page.getByTestId('etapes-numero-fourni')).toContainText('créez le compte avec ce numéro');
  await expect(page.getByTestId('code-capte')).toContainText('En attente du code de WhatsApp');
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(page.getByTestId('ouvrir-fenetre-meta')).toHaveCount(0);
  await expect(page.getByTestId('suite-fourni-application')).toContainText('Meta refuse souvent un numéro tout neuf');
  await expect(page.locator('main')).not.toContainText(/QR/);
  // 🔴 Un rechargement reprend le numéro DANS sa variante (la mémoire de l’onglet), pas celle de la fenêtre de Meta.
  await page.reload();
  await expect(page.getByTestId('numero-fourni')).toHaveText('+441235619343');
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
  await expect(page.getByTestId('ouvrir-fenetre-meta')).toHaveCount(0);
});

test('🟡 avec l’application, aucune 4e question ni numéro proposé', async ({ page }) => {
  await mockAccueil(page, { account: SANS_NUMERO, inscription: { complete: {} } });
  await simulerNumeroFourni(page, { abonnement: null });
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('question-compte-nsp').click();
  await page.getByTestId('question-application-oui').click();
  await expect(page.getByTestId('question-numero')).toHaveCount(0);
  await expect(page.getByTestId('issue-fourni')).toHaveCount(0);
  await expect(page.getByTestId('ouvrir-fenetre-coexistence')).toBeVisible();
});
