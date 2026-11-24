import { test, expect, type Page } from './aide/test';
import { reponseDuBuilder } from './aide/routes-builder';

/**
 * LES PARCOURS SHOPIFY, CAMPAGNE ET SCÉNARIO DE LA CARTE QUI ACCOMPAGNE (plan 2026-11-24-guide-demarrage, lot 4). Ce que
 * seul un test de bout en bout voit : sur le vrai écran, la carte cadre la bonne cible et passe seule à l'étape suivante
 * quand le geste est fait (le volet Shopify ouvert, l'assistant de campagne passé à l'étape suivante, le scénario créé).
 * Le parcours agent IA a son propre fichier (`guide-agent.spec.ts`).
 */
const PRO = ['inbox', 'scenarios', 'statistiques', 'email', 'console', 'assistants'];
const lim = {
  utilisateurs: 3, admins: null, contacts: null, envoisModelesMois: null, automations: null, suppressionsJour: null,
  adressesWebhook: 5, journalWebhooksJours: 30, conservationJours: 90, commissionPct: 20, badge: false, numeroInclus: true,
};
const OFFRE = {
  offre: 'pro', fonctions: PRO, limites: lim, usage: { envoisModelesMois: 0, contacts: 0, automations: 0, membres: 1 },
  grille: { free: { fonctions: [], limites: lim }, pro: { fonctions: PRO, limites: lim }, entreprise: { fonctions: PRO, limites: lim } },
  upgradeUrl: 'https://console.e2e.test/offre',
};
const SHOPIFY_VIDE = { boutique: null, compteurs: {}, paniers: { relances: {}, fermesATemps: 0, enAttente: 0 }, pageApps: null, lignes: [] };

/** Monte la console avec un parcours déjà lancé (l'état de l'onglet), et les faux appels des trois écrans. */
async function monter(page: Page, parcours: 'shopify' | 'campagne' | 'scenario', ecran: string) {
  await page.addInitScript((p) => {
    window.localStorage.setItem('mba.session', JSON.stringify({ token: 't', email: 'lea@e2e.test', role: 'admin', tenantId: 't-e2e' }));
    // Posé une seule fois : un rechargement garde ensuite l'état que la carte a écrit.
    if (!window.sessionStorage.getItem('mba.guide')) {
      window.sessionStorage.setItem('mba.guide', JSON.stringify({ parcours: p, etape: 0, replie: false, fini: false }));
    }
  }, parcours);
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname.replace('/api/backend', '');
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/me')) return json({ email: 'lea@e2e.test', name: 'Léa', role: 'admin' });
    if (chemin.endsWith('/offre')) return json(OFFRE);
    if (chemin.endsWith('/integrations/shopify')) return json(SHOPIFY_VIDE);
    if (chemin.endsWith('/integrations/batch')) return json({ branche: false });
    if (chemin.endsWith('/account-status')) return json({ hasNumber: false, hubspotPortal: { connected: false } });
    if (chemin.endsWith('/settings')) return json({ mbaEnabled: false, rcsEnabled: false, timezone: 'Europe/Paris', businessHours: {} });
    if (chemin.endsWith('/workflows') && req.method() === 'POST') {
      return json({ id: 'wf1', name: 'Bienvenue', graph: { nodes: [], edges: [] } }, 201);
    }
    if (chemin.endsWith('/workflows')) return json({ workflows: [] });
    const duBuilder = reponseDuBuilder(chemin);
    if (duBuilder !== undefined) return json(duBuilder);
    if (chemin.endsWith('/contacts')) return json({ contacts: [], total: 0 });
    if (chemin.endsWith('/unread-count')) return json({ count: 0 });
    return json({});
  });
  await page.goto(ecran);
}

const titre = (page: Page) => page.getByTestId('guide-titre');

test.describe('La carte qui accompagne : Shopify, campagne, scénario', () => {
  test('🔴 Shopify : le volet cadré, ouvert, fait passer à « Créez l’appli chez Shopify »', async ({ page }) => {
    await monter(page, 'shopify', '/integrations');
    await expect(titre(page)).toHaveText(/Ouvrez le volet Shopify/);
    await expect(page.getByTestId('guide-cadre')).toBeVisible();
    await page.getByTestId('volet-shopify').locator('summary').click();
    await expect(titre(page)).toHaveText(/Créez l’appli chez Shopify/);
    await page.getByTestId('guide-suivant').click();
    await expect(titre(page)).toHaveText(/Collez ce que Shopify vous a donné/);
  });

  test('🔴 campagne : des contacts à l’assistant, chaque étape franchie fait avancer la carte', async ({ page }) => {
    await monter(page, 'campagne', '/contacts');
    await expect(titre(page)).toHaveText(/Ajoutez vos contacts/);
    await page.getByTestId('guide-suivant').click();
    await expect(titre(page)).toHaveText(/Nommez votre campagne/);
    await page.getByTestId('guide-y-aller').click();
    await expect(page).toHaveURL(/\/campaigns\/nouvelle/);
    await expect(page.getByTestId('guide-cadre')).toBeVisible();
    await page.getByTestId('assistant-nom').fill('Soldes d’hiver');
    // La carte a aussi son « Suivant » : on vise celui de l'assistant.
    await page.getByTestId('assistant-campagne').getByRole('button', { name: 'Suivant' }).click();
    await expect(titre(page)).toHaveText(/Choisissez le canal/);
  });

  test('🔴 scénario : créé, il ouvre le canevas et la carte passe à « Construisez-le bloc par bloc »', async ({ page }) => {
    await monter(page, 'scenario', '/workflows');
    await expect(titre(page)).toHaveText(/Créez votre scénario/);
    await page.getByTestId('workflow-nouveau-nom').fill('Bienvenue');
    // 🔴 La carte ne couvre jamais sa cible : le champ et son bouton sont en haut à droite, elle descend.
    await expect(page.getByTestId('guide-carte')).toHaveAttribute('data-place', 'bas');
    await page.getByRole('button', { name: 'Créer un scénario' }).click();
    await expect(page.getByTestId('workflow-canevas')).toBeVisible();
    await expect(titre(page)).toHaveText(/Construisez-le bloc par bloc/);
    await page.getByTestId('guide-suivant').click();
    await expect(titre(page)).toHaveText(/Publiez/);
  });
});
