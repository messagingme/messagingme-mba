import { test, expect, type Page } from './aide/test';
import { signupAdresseConnue } from './aide/inscription';

/**
 * 🔴 L'INSCRIPTION PAR E-MAIL PROUVÉE PAR UN LIEN (lot identité B, 2026-11-05). Une adresse inconnue ne crée rien à la
 * demande : l'écran dit qu'un lien est parti, sans ouvrir de session. Le lien mène à une page qui n'appelle RIEN avant
 * l'envoi (une messagerie qui l'ouvre pour l'examiner ne consomme rien), où l'on nomme l'espace et choisit son mot de
 * passe, puis l'arrivée habituelle (le tunnel, le Pro, ou le retour à l'onglet de connexion d'une application).
 * Les réponses de l'API sont celles de `src/auth/routes.ts`, recopiées à la main.
 */

type Reponse = { status?: number; body: unknown };
type Appel = { chemin: string; methode: string; corps: unknown };

const SESSION_NEUVE = { token: 'jeton-neuf', user: { email: 'neuve@b.co', role: 'admin', tenantId: 'tNeuf' } };
const AUTRE_SESSION = { token: 'jeton-autre', email: 'autre@b.co', role: 'admin', tenantId: 'tAutre' };

async function monter(page: Page, repondeur: (chemin: string) => Reponse | undefined): Promise<Appel[]> {
  const appels: Appel[] = [];
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname.replace('/api/backend', '');
    let corps: unknown = null;
    try { corps = req.postDataJSON(); } catch { corps = null; }
    appels.push({ chemin, methode: req.method(), corps });
    const r = repondeur(chemin)
      ?? (chemin === '/auth/config' ? { body: { googleClientId: '', googleEnabled: false } } : { body: {} });
    return route.fulfill({ status: r.status ?? 200, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  return appels;
}

/** L'étape de l'adresse (« adresse d'abord ») : l'adresse seule, puis « Continuer ». */
async function remplirLaDemande(page: Page): Promise<void> {
  await page.locator('input[type="email"]').fill('neuve@b.co');
  await page.getByRole('button', { name: /^(Continuer|Continue)$/ }).click();
}

async function remplirLeLien(page: Page): Promise<void> {
  await page.getByPlaceholder(/Mon entreprise|My company/).fill('Mon espace');
  await page.locator('input[type="password"]').fill('mot-de-passe-du-clic');
  await page.getByRole('button', { name: /Créer mon espace|Create my workspace/ }).click();
}

test.describe('Inscription par e-mail : la demande du lien', () => {
  test('🔴 une adresse inconnue : « lien envoyé », aucune session, et la demande porte la langue et l’offre', async ({ page }) => {
    const appels = await monter(page, (chemin) => (chemin === '/auth/signup' ? { status: 202, body: { lienEnvoye: true } } : undefined));
    await page.goto('/signup?offre=pro');
    await remplirLaDemande(page);
    await expect(page.getByText(/Vérifiez votre boîte de réception|Check your inbox/)).toBeVisible();
    await expect(page.getByText('neuve@b.co')).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem('mba.session'))).toBeNull();
    const demande = appels.find((a) => a.chemin === '/auth/signup');
    expect(demande?.corps).toMatchObject({ email: 'neuve@b.co', langue: 'fr', offre: 'pro' });
    // « Utiliser une autre adresse » rend le formulaire.
    await page.getByRole('button', { name: /Utiliser une autre adresse|Use another address/ }).click();
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('venue d’une demande d’autorisation : la demande le dit, et « Continuer » ramène à /autoriser', async ({ page }) => {
    const appels = await monter(page, (chemin) => (chemin === '/auth/signup' ? { status: 202, body: { lienEnvoye: true } } : undefined));
    await page.goto('/signup?demande=d-e2e');
    await remplirLaDemande(page);
    await expect(page.getByText(/Ouvrez le lien sur cet ordinateur|Open the link on this computer/)).toBeVisible();
    expect(appels.find((a) => a.chemin === '/auth/signup')?.corps).toMatchObject({ application: true });
    await page.getByRole('button', { name: /^Continuer$|^Continue$/ }).click();
    await page.waitForURL('**/autoriser?demande=d-e2e', { timeout: 15_000 });
  });

  test('🔴 l’étape de l’adresse n’envoie que l’adresse : ni mot de passe, ni nom d’espace, ni accord', async ({ page }) => {
    const appels = await monter(page, (chemin) => (chemin === '/auth/signup' ? { status: 202, body: { lienEnvoye: true } } : undefined));
    await page.goto('/signup');
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await remplirLaDemande(page);
    await expect(page.getByText(/Vérifiez votre boîte de réception|Check your inbox/)).toBeVisible();
    const corps = appels.find((a) => a.chemin === '/auth/signup')?.corps as Record<string, unknown>;
    expect(Object.keys(corps).sort()).toEqual(['email', 'langue']);
  });

  test('une adresse connue : l’étape du mot de passe, puis l’espace tout de suite', async ({ page }) => {
    const signup = signupAdresseConnue({ status: 201, body: SESSION_NEUVE });
    const appels = await monter(page, (chemin) => (chemin === '/auth/signup' ? signup() : undefined));
    await page.goto('/signup');
    await remplirLaDemande(page);
    await expect(page.getByText(/Cette adresse a déjà un compte|This address already has an account/)).toBeVisible();
    await page.getByPlaceholder(/Mon entreprise|My company/).fill('Deuxième espace');
    await page.locator('input[type="password"]').fill('mot-de-passe-du-compte');
    await page.getByRole('button', { name: /Ajouter l’espace|Add the workspace/ }).click();
    await page.waitForURL('**/connecter-whatsapp?suite=demarrer', { timeout: 15_000 });
    expect(appels.filter((a) => a.chemin === '/auth/signup')[1]?.corps).toMatchObject({
      email: 'neuve@b.co', workspaceName: 'Deuxième espace', password: 'mot-de-passe-du-compte',
    });
  });

  test('un défi anti-robot refusé le dit, et le formulaire reste', async ({ page }) => {
    await monter(page, (chemin) => (chemin === '/auth/signup'
      ? { status: 403, body: { error: 'La vérification anti-robot n’a pas abouti : réessayez.', code: 'defi' } }
      : undefined));
    await page.goto('/signup');
    await remplirLaDemande(page);
    await expect(page.getByText('La vérification anti-robot n’a pas abouti : réessayez.')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});

test.describe('Inscription par e-mail : la page du lien', () => {
  test('🔴 aucun appel avant l’envoi ; au clic, le jeton du chemin, le mot de passe du clic, et l’arrivée du Pro', async ({ page }) => {
    const appels = await monter(page, (chemin) => (chemin === '/auth/signup/confirm'
      ? { status: 201, body: { ...SESSION_NEUVE, inscription: { offre: 'pro', application: false, langue: 'fr' } } }
      : undefined));
    await page.goto('/signup/confirm/jeton-e2e?lang=fr');
    await expect(page.getByRole('button', { name: /Créer mon espace|Create my workspace/ })).toBeVisible();
    expect(appels.filter((a) => a.chemin.startsWith('/auth/signup'))).toEqual([]);
    await remplirLeLien(page);
    await page.waitForURL('**/offre?fonction=console', { timeout: 15_000 });
    expect(appels.find((a) => a.chemin === '/auth/signup/confirm')?.corps).toMatchObject({
      jeton: 'jeton-e2e', workspaceName: 'Mon espace', password: 'mot-de-passe-du-clic',
    });
    const session = await page.evaluate(() => window.localStorage.getItem('mba.session'));
    expect(JSON.parse(session ?? '{}')).toMatchObject({ token: 'jeton-neuf', tenantId: 'tNeuf' });
  });

  test('venue d’une application : la page dit de revenir à l’onglet de connexion, sans ouvrir le tunnel', async ({ page }) => {
    await monter(page, (chemin) => (chemin === '/auth/signup/confirm'
      ? { status: 201, body: { ...SESSION_NEUVE, inscription: { offre: null, application: true, langue: 'fr' } } }
      : undefined));
    await page.goto('/signup/confirm/jeton-e2e');
    await remplirLeLien(page);
    await expect(page.getByText(/Revenez à l’onglet de connexion|Go back to your application/)).toBeVisible();
    expect(page.url()).toContain('/signup/confirm/');
  });

  test('🔴 un lien mort le dit et propose une nouvelle demande, sans vider la session ouverte dans le navigateur', async ({ page }) => {
    await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), AUTRE_SESSION);
    await monter(page, (chemin) => (chemin === '/auth/signup/confirm'
      ? { status: 400, body: { error: 'Ce lien ne vaut plus', code: 'lien_invalide' } }
      : undefined));
    await page.goto('/signup/confirm/jeton-mort');
    await remplirLeLien(page);
    await expect(page.getByText(/Ce lien ne vaut plus|This link is no longer valid/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Refaire une demande|Request a new link/ })).toBeVisible();
    expect(JSON.parse(await page.evaluate(() => window.localStorage.getItem('mba.session')) ?? '{}')).toMatchObject({ token: 'jeton-autre' });
  });

  test('l’appel est en mode étape : même un 401 ne viderait pas la session ouverte', async ({ page }) => {
    await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), AUTRE_SESSION);
    await monter(page, (chemin) => (chemin === '/auth/signup/confirm' ? { status: 401, body: { error: 'refus' } } : undefined));
    await page.goto('/signup/confirm/jeton-x');
    await remplirLeLien(page);
    await expect(page.getByText('refus')).toBeVisible();
    expect(JSON.parse(await page.evaluate(() => window.localStorage.getItem('mba.session')) ?? '{}')).toMatchObject({ token: 'jeton-autre' });
  });

  test('une adresse déjà connue renvoie vers la connexion', async ({ page }) => {
    await monter(page, (chemin) => (chemin === '/auth/signup/confirm'
      ? { status: 409, body: { error: 'Cette adresse a déjà un compte : connectez-vous.', code: 'adresse_connue' } }
      : undefined));
    await page.goto('/signup/confirm/jeton-connu');
    await remplirLeLien(page);
    await expect(page.getByRole('link', { name: /Se connecter|Sign in/ })).toHaveAttribute('href', '/login');
  });
});
