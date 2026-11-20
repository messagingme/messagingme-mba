import { test, expect, type Page } from './aide/test';

/**
 * TOOLS > INTÉGRATIONS (2026-10-26) : les cartes Batch, HubSpot, Salesforce et Shopify ont quitté Paramètres > Général.
 * Une ancienne ancre (`/parametres#integration-…`, dans des e-mails déjà partis et la page d'aide publique) mène à la même
 * carte, Général dit où elles sont parties, et un manager n'entre pas dans l'écran (il est aux admins, comme ses routes).
 */
const ADMIN = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };

// Une vue d'offre minimale (forme de `accueil-bienvenue.spec.ts`) : seule l'Entreprise ouvre les connecteurs CRM.
const SANS_CRM = ['inbox', 'scenarios', 'statistiques', 'email', 'console'];
const LIMITES = {
  utilisateurs: 3, admins: null, contacts: null, envoisModelesMois: null, automations: null, suppressionsJour: null,
  adressesWebhook: 5, journalWebhooksJours: 30, conservationJours: 90, commissionPct: 20, badge: false, numeroInclus: true,
};
const GRILLE = {
  free: { fonctions: [], limites: LIMITES }, pro: { fonctions: SANS_CRM, limites: LIMITES },
  entreprise: { fonctions: [...SANS_CRM, 'crm'], limites: LIMITES },
};
const VUE_OFFRE = (o: 'pro' | 'entreprise') => ({
  offre: o, fonctions: GRILLE[o].fonctions, limites: LIMITES, grille: GRILLE, upgradeUrl: 'https://console.e2e.test/offre',
  usage: { envoisModelesMois: 0, contacts: 0, automations: 0, membres: 1 },
});

async function monter(page: Page, role = 'admin', offre?: 'pro' | 'entreprise') {
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), { ...ADMIN, role });
  await page.route('**/api/backend/**', async (route) => {
    const chemin = new URL(route.request().url()).pathname;
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/offre') && offre) return json(VUE_OFFRE(offre));
    if (chemin.endsWith('/integrations/batch')) return json({ branche: false });
    if (chemin.endsWith('/settings')) return json({ timezone: 'Europe/Paris' });
    if (chemin.endsWith('/settings/agents-peuvent-prendre')) return json({ actif: false });
    if (chemin.endsWith('/contacts/blocked')) return json({ contacts: [] });
    if (chemin.endsWith('/unread-count')) return json({ count: 0 });
    if (chemin.endsWith('/me')) return json({ email: ADMIN.email, name: 'Jean Test', role });
    return json({});
  });
}

test('🔴 « Intégrations » est la première entrée de Tools, et la page porte les cartes', async ({ page }) => {
  await monter(page);
  await page.goto('/integrations');
  await expect(page.getByRole('heading', { name: 'Intégrations', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Intégrations', exact: true })).toHaveAttribute('href', '/integrations');
  // Un volet par outil, replié : on déplie celui qu'on règle.
  for (const cle of ['shopify', 'batch', 'hubspot', 'salesforce', 'dynamics']) {
    await expect(page.getByTestId(`volet-${cle}`)).not.toHaveAttribute('open', /.*/);
  }
  await expect(page.getByTestId('integration-hubspot')).toBeHidden();
  await page.getByTestId('volet-hubspot').locator('summary').click();
  await expect(page.getByTestId('integration-hubspot')).toBeVisible();
});

test('🔴 en Pro, HubSpot, Salesforce et Dynamics 365 disent qu’ils sont dans l’offre Entreprise, sans carte', async ({ page }) => {
  await monter(page, 'admin', 'pro');
  await page.goto('/integrations');
  for (const cle of ['hubspot', 'salesforce', 'dynamics']) {
    const volet = page.getByTestId(`volet-${cle}`);
    await volet.locator('summary').click();
    await expect(volet.getByTestId('hors-offre-crm')).toContainText('Inclus dans l’offre Entreprise.');
  }
  await expect(page.getByTestId('integration-hubspot')).toHaveCount(0);
  await expect(page.getByTestId('integration-contact-dynamics')).toHaveCount(0);
});

test('🔴 en Entreprise, Salesforce sans app et Dynamics 365 proposent de nous écrire, objet prérempli ; HubSpot a sa carte', async ({ page }) => {
  await monter(page, 'admin', 'entreprise');
  await page.goto('/integrations#integration-hubspot');
  await expect(page.getByTestId('integration-hubspot')).toBeVisible();
  for (const cle of ['salesforce', 'dynamics']) {
    const volet = page.getByTestId(`volet-${cle}`);
    await volet.locator('summary').click();
    await expect(volet.getByRole('link', { name: 'Nous contacter' })).toHaveAttribute('href', `/support?sujet=${cle}`);
  }
  await page.getByTestId('volet-dynamics').getByRole('link', { name: 'Nous contacter' }).click();
  await expect(page.getByTestId('support-sujet')).toHaveValue('Connecter Dynamics 365');
});

test('🔴 une ancienne ancre de Paramètres mène à la même carte dans Intégrations', async ({ page }) => {
  await monter(page);
  await page.goto('/parametres#integration-shopify');
  await expect(page).toHaveURL(/\/integrations#integration-shopify$/);
  await expect(page.getByTestId('integration-shopify')).toBeVisible();
});

test('Paramètres > Général n’a plus les cartes, et dit où elles sont parties', async ({ page }) => {
  await monter(page);
  await page.goto('/parametres');
  await expect(page.getByTestId('param-integrations-deplacees').getByRole('link')).toHaveAttribute('href', '/integrations');
  await expect(page.getByTestId('integration-hubspot')).toHaveCount(0);
  await expect(page.getByTestId('integration-shopify')).toHaveCount(0);
});

test('🔴 un manager n’entre pas dans Intégrations', async ({ page }) => {
  await monter(page, 'manager');
  await page.goto('/integrations');
  await expect(page).toHaveURL(/\/inbox/);
});
