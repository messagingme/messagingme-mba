import { test, expect, type Page } from './aide/test';

/**
 * LA FENÊTRE DE BIENVENUE ET LA VISITE (plan 2026-11-19-accueil-pro, checklist « Bien démarrer » du plan
 * 2026-11-24-guide-demarrage). Ce que seul un test de bout en bout voit : la fenêtre s'ouvre sur `accueilAFaire`, la
 * checklist se coche d'après `/demarrage`, un geste appelle le marquage AVANT de partir, la croix n'appelle rien, la
 * visite pointe de vrais éléments, un membre non administrateur n'a pas la checklist, la carte de l'Accueil la rouvre.
 */
const AG = 't-e2e';
// La vue d'offre, sur la forme de `console-free.spec.ts` : le Pro ouvre la console, la Free non.
const PRO = ['inbox', 'scenarios', 'statistiques', 'email', 'console'];
const limites = (o: string) => ({
  utilisateurs: o === 'free' ? 1 : 3, admins: o === 'free' ? 1 : null, contacts: o === 'free' ? 100 : null, envoisModelesMois: null,
  automations: null, suppressionsJour: null, adressesWebhook: 5, journalWebhooksJours: 30, conservationJours: 90, commissionPct: 20,
  badge: o === 'free', numeroInclus: o !== 'free',
});
// La console rejette une grille sans la ligne Entreprise (`lireVueOffre`) : l'offre resterait inconnue.
const GRILLE = { free: { fonctions: [], limites: limites('free') }, pro: { fonctions: PRO, limites: limites('pro') }, entreprise: { fonctions: PRO, limites: limites('entreprise') } };
const OFFRE = (o: string) => ({
  offre: o, fonctions: o === 'free' ? [] : PRO, limites: limites(o),
  usage: { envoisModelesMois: 0, contacts: 0, automations: 0, membres: 1 }, grille: GRILLE, upgradeUrl: 'https://console.e2e.test/offre',
});

const RIEN = { numero: false, outil: false, scenarioOuCampagne: false, agent: false, bulle: false };

async function monter(page: Page, o: {
  role?: 'admin' | 'agent'; aFaire?: boolean; offre?: string; aNumero?: boolean; demarrage?: Record<string, boolean> | 'absente'; fonctions?: string[];
} = {}) {
  const marques: string[] = [];
  await page.addInitScript((r) => window.localStorage.setItem('mba.session', JSON.stringify({ token: 't', email: 'lea@e2e.test', role: r, tenantId: 't-e2e' })), o.role ?? 'admin');
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.endsWith('/moi/accueil') && req.method() === 'POST') { marques.push(url); return route.fulfill({ status: 204, body: '' }); }
    if (url.endsWith('/me')) return json({ email: 'lea@e2e.test', name: 'Léa', role: o.role ?? 'admin', ...(o.aFaire === false ? {} : { accueilAFaire: true }) });
    if (url.endsWith('/offre')) return json({ ...OFFRE(o.offre ?? 'pro'), ...(o.fonctions ? { fonctions: o.fonctions } : {}) });
    if (url.endsWith('/demarrage')) return o.demarrage === 'absente' ? json({ error: 'Not Found' }, 404) : json(o.demarrage ?? RIEN);
    if (url.endsWith('/account-status')) return json({ hasNumber: o.aNumero ?? false, number: null });
    if (url.endsWith('/conversations/unread-count')) return json({ count: 0 });
    return json({});
  });
  return { marques };
}

test.describe(`L’accueil d’un nouveau membre (${AG})`, () => {
  test('🔴 la checklist se coche d’après l’espace, et un geste marque le compte AVANT de partir', async ({ page }) => {
    const { marques } = await monter(page, { demarrage: { ...RIEN, numero: true } });
    await page.goto('/accueil');
    await expect(page.getByTestId('accueil-bienvenue')).toBeVisible();
    await expect(page.getByTestId('accueil-etape-numero')).toHaveAttribute('data-faite', 'oui');
    await expect(page.getByTestId('accueil-etape-outil')).toHaveAttribute('data-faite', 'non');
    await expect(page.getByTestId('accueil-progression')).toHaveText(/1 étape sur 5|1 of 5/);
    await expect(page.getByTestId('accueil-geste-numero')).toHaveCount(0);
    // Le parcours de la campagne commence par les contacts (plan 2026-11-24-guide-demarrage, lot 4).
    await page.getByTestId('accueil-geste-campagne').click();
    await expect(page).toHaveURL(/\/contacts/);
    expect(marques).toHaveLength(1);
  });

  test('le film de bienvenue se lit dans la fenêtre, à la place du bandeau, servi par la console', async ({ page }) => {
    await monter(page);
    await page.goto('/accueil');
    await page.getByTestId('accueil-film-lire').click();
    const film = page.getByTestId('accueil-film');
    await expect(film).toBeVisible();
    await expect(film).toHaveAttribute('src', /^\/films\/bienvenue\.mp4/);
    // Le fichier existe vraiment dans `web/public/films/` : un lien mort se verrait ici, pas chez le client.
    const reponse = await page.request.get('/films/bienvenue.mp4');
    expect(reponse.status()).toBe(200);
  });

  test('🔴 une route absente (API plus ancienne) montre la checklist sans coche, sans erreur', async ({ page }) => {
    await monter(page, { demarrage: 'absente' });
    await page.goto('/accueil');
    await expect(page.getByTestId('accueil-checklist')).toBeVisible();
    await expect(page.locator('[data-faite="oui"]')).toHaveCount(0);
  });

  test('une offre sans scénarios ne propose que la campagne', async ({ page }) => {
    await monter(page, { fonctions: ['inbox', 'statistiques', 'email', 'console'] });
    await page.goto('/accueil');
    await expect(page.getByTestId('accueil-geste-campagne')).toBeVisible();
    await expect(page.getByTestId('accueil-geste-scenario')).toHaveCount(0);
  });

  test('🔴 la croix ne marque rien, et la fenêtre ne se rouvre pas à la page suivante', async ({ page }) => {
    const { marques } = await monter(page);
    await page.goto('/accueil');
    await page.getByTestId('modale-fermer').click();
    await expect(page.getByTestId('accueil-bienvenue')).toHaveCount(0);
    await page.getByRole('link', { name: 'mini-CRM' }).first().click();
    await expect(page).toHaveURL(/\/contacts/);
    await expect(page.getByTestId('accueil-bienvenue')).toHaveCount(0);
    expect(marques).toEqual([]);
  });

  test('« Faire le tour » marque, puis la visite avance de zone en zone jusqu’à « Terminer »', async ({ page }) => {
    const { marques } = await monter(page);
    await page.goto('/accueil');
    await page.getByTestId('accueil-tour').click();
    await expect(page.getByTestId('visite-bulle')).toBeVisible();
    expect(marques).toHaveLength(1);
    const total = Number((await page.getByTestId('visite-compteur').textContent())!.split('/')[1]);
    expect(total).toBeGreaterThan(3);
    for (let i = 1; i < total; i += 1) await page.getByTestId('visite-suivant').click();
    await expect(page.getByTestId('visite-suivant')).toHaveText(/Terminer|Finish/);
    await page.getByTestId('visite-suivant').click();
    await expect(page.getByTestId('visite-bulle')).toHaveCount(0);
  });

  test('🔴 un membre non administrateur n’a pas la checklist (ses écrans lui sont fermés), mais garde le tour', async ({ page }) => {
    await monter(page, { role: 'agent' });
    await page.goto('/inbox');
    await expect(page.getByTestId('accueil-bienvenue')).toBeVisible();
    await expect(page.getByTestId('accueil-tour')).toBeVisible();
    await expect(page.getByTestId('accueil-checklist')).toHaveCount(0);
    await expect(page.locator('[data-testid^="accueil-geste-"]')).toHaveCount(0);
  });

  test('après un choix, la carte de l’Accueil porte la checklist et la rouvre ; l’aide aussi', async ({ page }) => {
    await monter(page, { aFaire: false, demarrage: { ...RIEN, numero: true, agent: true } });
    await page.goto('/accueil');
    await expect(page.getByTestId('accueil-bienvenue')).toHaveCount(0);
    await expect(page.getByTestId('carte-bien-demarrer-compte')).toHaveText(/2 étapes sur 5|2 of 5/);
    await page.getByTestId('carte-bien-demarrer-continuer').click();
    await expect(page.getByTestId('accueil-bienvenue')).toBeVisible();
    await page.getByTestId('modale-fermer').click();
    await page.getByTestId('aide-bouton').click();
    await page.getByTestId('aide-bien-demarrer').click();
    await expect(page.getByTestId('accueil-bienvenue')).toBeVisible();
  });

  test('tout fait : la carte de l’Accueil disparaît', async ({ page }) => {
    await monter(page, { aFaire: false, demarrage: { numero: true, outil: true, scenarioOuCampagne: true, agent: true, bulle: true } });
    await page.goto('/accueil');
    await expect(page.getByTestId('aide-bouton')).toBeVisible();
    await expect(page.getByTestId('carte-bien-demarrer')).toHaveCount(0);
  });

  test('rien pour un compte qui a déjà choisi, ni en Free ; la visite reste ouverte depuis l’aide', async ({ page }) => {
    await monter(page, { aFaire: false });
    await page.goto('/accueil');
    await expect(page.getByTestId('aide-bouton')).toBeVisible();
    await expect(page.getByTestId('accueil-bienvenue')).toHaveCount(0);
    await page.getByTestId('aide-bouton').click();
    await page.getByTestId('aide-visite').click();
    await expect(page.getByTestId('visite-bulle')).toBeVisible();
  });

  test('🔴 en Free, ni la fenêtre, ni la carte, ni l’entrée de l’aide : aucun bouton mort', async ({ page }) => {
    await monter(page, { offre: 'free' });
    await page.goto('/accueil');
    await expect(page.getByTestId('aide-bouton')).toBeVisible();
    await expect(page.getByTestId('accueil-bienvenue')).toHaveCount(0);
    await expect(page.getByTestId('carte-bien-demarrer')).toHaveCount(0);
    await page.getByTestId('aide-bouton').click();
    await expect(page.getByTestId('aide-visite')).toBeVisible();
    await expect(page.getByTestId('aide-bien-demarrer')).toHaveCount(0);
  });
});
