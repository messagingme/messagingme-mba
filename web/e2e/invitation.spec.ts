import { test, expect, type Page } from './aide/test';
import { MIN_MOT_DE_PASSE } from '../lib/partage/mot-de-passe';

/**
 * LA PAGE D'UNE INVITATION (lot identité C) : la seule porte d'un compte créé par une invitation.
 *
 * 🔴 CE QUE CES TESTS TIENNENT : la page dit l'espace et qui invite (nom ET adresse) ; elle demande le mot de passe
 * ACTUEL à une adresse qui en a déjà un (sans minimum de longueur), et d'en choisir un sinon ; un mot de passe faux laisse
 * l'invitation valable ; et sans aperçu lisible (l'API d'avant le lot, une panne), l'ancien formulaire SANS Google, parce
 * que l'ancien bouton créait un espace neuf au lieu d'accepter.
 *
 * Les réponses de l'API sont celles de `src/auth/routes.ts`, recopiées à la main : aucun serveur ne tourne derrière.
 * Le bouton Google se reconnaît à sa lecture de `/auth/config` : sur cette page, lui seul la fait.
 */

type Reponse = { status?: number; body: unknown };
type Repondeur = (chemin: string, methode: string, corps: Record<string, unknown> | null) => Reponse | undefined;
type Appel = { chemin: string; methode: string; corps: Record<string, unknown> | null };

const SESSION_AGENT = { token: 'jeton-agent', user: { email: 'invite@e2e.test', role: 'agent', tenantId: 't1' } };
const APERCU = { espace: 'Acme', adresse: 'invite@e2e.test', invitant: { nom: 'Boss', adresse: 'boss@e2e.test' }, aUnMotDePasse: true };

async function monter(page: Page, repondeur: Repondeur): Promise<Appel[]> {
  const appels: Appel[] = [];
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname.replace('/api/backend', '');
    const corps = req.postData() ? (req.postDataJSON() as Record<string, unknown>) : null;
    appels.push({ chemin, methode: req.method(), corps });
    const r = repondeur(chemin, req.method(), corps)
      ?? (chemin === '/auth/config' ? { body: { googleClientId: '', googleEnabled: false } } : { body: {} });
    return route.fulfill({ status: r.status ?? 200, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  return appels;
}

const appelsVers = (appels: Appel[], fin: string): Appel[] => appels.filter((a) => a.chemin.endsWith(fin));

test.describe('La page d’une invitation', () => {
  test('🔴 elle dit l’espace et qui invite, et demande le mot de passe ACTUEL à une adresse qui en a un', async ({ page }) => {
    const appels = await monter(page, (chemin) => {
      if (chemin === '/auth/invitations/apercu') return { body: APERCU };
      if (chemin === '/auth/invitations/accept') return { body: SESSION_AGENT };
      return undefined;
    });
    await page.goto('/invite/jeton-invitation');
    const apercu = page.getByTestId('apercu-invitation');
    await expect(apercu).toContainText('Boss (boss@e2e.test)');
    await expect(apercu).toContainText('Acme');
    await expect(apercu).toContainText('invite@e2e.test');
    const champ = page.locator('input[type="password"]');
    await expect(champ).toHaveAttribute('placeholder', /mot de passe actuel|current password/);
    // Un mot de passe d'avant le minimum de 12 caractères se connecte toujours : le champ « actuel » n'en impose aucun.
    expect(await champ.getAttribute('minlength')).toBeNull();
    await expect(page.getByRole('link', { name: /Mot de passe oublié|Forgot password/ })).toBeVisible();
    // Le bouton Google est là (il lit `/auth/config`), en acceptation de CETTE invitation.
    await expect.poll(() => appelsVers(appels, '/auth/config').length).toBeGreaterThan(0);
    await champ.fill('dix-carac.');
    await page.getByRole('button', { name: /Rejoindre l’espace|Join the workspace/ }).click();
    await page.waitForURL('**/inbox', { timeout: 15_000 });
    expect(appelsVers(appels, '/auth/invitations/accept')[0]?.corps).toEqual({ token: 'jeton-invitation', password: 'dix-carac.' });
  });

  test('une adresse sans mot de passe en choisit un, au minimum du serveur', async ({ page }) => {
    await monter(page, (chemin) => (chemin === '/auth/invitations/apercu' ? { body: { ...APERCU, aUnMotDePasse: false } } : undefined));
    await page.goto('/invite/jeton-invitation');
    await expect(page.getByTestId('apercu-invitation')).toContainText('Acme');
    const champ = page.locator('input[type="password"]');
    // Le minimum partagé avec le serveur (`MIN_MOT_DE_PASSE`), revenu de 12 à 8 le 2026-11-11 : jamais un nombre recopié.
    expect(Number(await champ.getAttribute('minlength'))).toBe(MIN_MOT_DE_PASSE);
    await expect(page.getByRole('link', { name: /Déjà activé|Already activated/ })).toBeVisible();
  });

  test('🔴 un mot de passe actuel faux : le message, et l’invitation reste valable (on réessaie et on entre)', async ({ page }) => {
    let essais = 0;
    await monter(page, (chemin) => {
      if (chemin === '/auth/invitations/apercu') return { body: APERCU };
      if (chemin === '/auth/invitations/accept') {
        essais += 1;
        return essais === 1
          ? { status: 403, body: { error: 'mot de passe incorrect', code: 'mot_de_passe_incorrect' } }
          : { body: SESSION_AGENT };
      }
      return undefined;
    });
    await page.goto('/invite/jeton-invitation');
    await page.locator('input[type="password"]').fill('pas-le-bon');
    await page.getByRole('button', { name: /Rejoindre l’espace|Join the workspace/ }).click();
    await expect(page.getByText(/Mot de passe incorrect|Incorrect password/)).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem('mba.session'))).toBeNull();
    await page.locator('input[type="password"]').fill('le-bon-mot-de-passe');
    await page.getByRole('button', { name: /Rejoindre l’espace|Join the workspace/ }).click();
    await page.waitForURL('**/inbox', { timeout: 15_000 });
  });

  test('🔴 sans aperçu lisible (l’API d’avant le lot répond 404) : l’ancien formulaire, SANS bouton Google', async ({ page }) => {
    const appels = await monter(page, (chemin) => {
      if (chemin === '/auth/invitations/apercu') return { status: 404, body: { error: 'Not Found' } };
      if (chemin === '/auth/invitations/accept') return { body: SESSION_AGENT };
      return undefined;
    });
    await page.goto('/invite/jeton-invitation');
    await expect(page.getByRole('button', { name: /Activer mon compte|Activate my account/ })).toBeVisible();
    await expect(page.getByTestId('apercu-invitation')).toHaveCount(0);
    await page.locator('input[type="password"]').fill('motdepasse-long');
    await page.getByRole('button', { name: /Activer mon compte|Activate my account/ }).click();
    await page.waitForURL('**/inbox', { timeout: 15_000 });
    // Après tout le parcours, pas avant : un bouton Google monté par erreur lit `/auth/config` dans un effet, qui pourrait
    // arriver après une assertion faite trop tôt.
    expect(appelsVers(appels, '/auth/config')).toEqual([]);
  });

  test('🔴 sans aperçu, une adresse qui a déjà un mot de passe : le 403 fait demander l’ACTUEL, sans minimum', async ({ page }) => {
    await monter(page, (chemin) => {
      if (chemin === '/auth/invitations/apercu') return { status: 503, body: { error: 'indisponible' } };
      if (chemin === '/auth/invitations/accept') return { status: 403, body: { error: 'mot de passe incorrect', code: 'mot_de_passe_incorrect' } };
      return undefined;
    });
    await page.goto('/invite/jeton-invitation');
    await page.locator('input[type="password"]').fill('nouveau-mot-de-passe');
    await page.getByRole('button', { name: /Activer mon compte|Activate my account/ }).click();
    const champ = page.locator('input[type="password"]');
    await expect(champ).toHaveAttribute('placeholder', /mot de passe actuel|current password/);
    expect(await champ.getAttribute('minlength')).toBeNull();
    await expect(page.getByRole('link', { name: /Mot de passe oublié|Forgot password/ })).toBeVisible();
  });

  test('une invitation morte : la page le dit et mène à la connexion, sans formulaire', async ({ page }) => {
    await monter(page, (chemin) => (chemin === '/auth/invitations/apercu' ? { status: 400, body: { error: 'invitation invalide ou expirée' } } : undefined));
    await page.goto('/invite/jeton-invitation');
    await expect(page.getByText(/n’est plus valable|no longer valid/)).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Se connecter|Sign in/ })).toBeVisible();
  });
});
