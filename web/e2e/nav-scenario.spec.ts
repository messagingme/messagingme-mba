import { test, expect, type Page } from './aide/test';

/**
 * LE MENU « SCÉNARIO » DANS LA BARRE (menu « Scénario », lot 7 ; spec du 2026-11-18, § 2) : il remplace « Automation »,
 * porte le Builder (l'ancien Contenu > Scénario) et l'Automation rangée par source, Shopify avec une boutique, HubSpot
 * avec un portail relié, Autres toujours. L'arbre et ses filtres sont tenus sans navigateur (`web/lib/nav.test.ts`) ; ici,
 * on regarde ce que la barre MONTRE : le groupe ouvert sur la page, l'entrée éclairée, et les sources selon ce que l'API
 * dit de l'espace.
 */
const ADMIN = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
const BOUTIQUE = {
  domaine: 'ma-boutique.myshopify.com', nom: 'Ma Boutique', etat: 'connectee', dernierEvenementLe: null,
  delaiPanierMinutes: 60, origine: 'console', pauseLe: null,
};

async function monter(page: Page, o: { boutique: boolean; portail: boolean; ecran: string }): Promise<void> {
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), ADMIN);
  await page.route('**/api/backend/**', async (route) => {
    const chemin = route.request().url().split('?')[0]!;
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/integrations/shopify')) {
      return json({ boutique: o.boutique ? BOUTIQUE : null, compteurs: {}, paniers: { relances: {}, fermesATemps: 0, enAttente: 0 }, pageApps: null, lignes: [] });
    }
    if (chemin.endsWith('/settings')) return json({ mbaEnabled: false, timezone: 'Europe/Paris', businessHours: {}, hubspotPortalConnecte: o.portail });
    if (chemin.endsWith('/automations')) return json({ automations: [] });
    if (chemin.endsWith('/workflows')) return json({ workflows: [] });
    if (chemin.endsWith('/unread-count')) return json({ count: 0 });
    if (chemin.endsWith('/me')) return json({ email: ADMIN.email, name: 'Jean Test', role: 'admin' });
    return json({});
  });
  // Les deux lectures de la barre doivent avoir RÉPONDU avant toute assertion d'absence : sinon une entrée encore cachée
  // faute de réponse ferait passer le test sur une lecture fautive (même garde que `quanti-shopify.spec.ts`).
  const boutiqueLue = page.waitForResponse((r) => r.url().includes('/integrations/shopify'));
  const portailLu = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/settings'));
  await page.goto(o.ecran);
  await Promise.all([boutiqueLue, portailLu]);
}

/** Les adresses des entrées d'un groupe de la barre, dans l'ordre affiché (le groupe ouvert). */
const adressesDuGroupe = (page: Page, cle: string) =>
  page.getByTestId(`nav-groupe-${cle}`).locator('xpath=..').locator('a').evaluateAll((liens) => liens.map((a) => a.getAttribute('href')));

test.describe('Barre : le menu « Scénario »', () => {
  test('🔴 sur Autres : Scénario et Automation ouverts, Autres éclairé ; Shopify et HubSpot avec leur source, dans l’ordre', async ({ page }) => {
    await monter(page, { boutique: true, portail: true, ecran: '/automations' });
    await expect(page.getByTestId('nav-groupe-scenario')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-groupe-automation')).toHaveAttribute('aria-expanded', 'true');
    // Relu jusqu'à l'accord : la page lit aussi les réglages, sa réponse peut précéder celle de la barre.
    await expect.poll(() => adressesDuGroupe(page, 'automation')).toEqual(['/automations/shopify', '/automations/hubspot', '/automations']);
    await expect.poll(() => adressesDuGroupe(page, 'scenario')).toEqual(['/workflows', '/automations/shopify', '/automations/hubspot', '/automations']);
    const autres = page.locator('aside').getByRole('link', { name: 'Autres', exact: true });
    await expect(autres).toHaveAttribute('href', '/automations');
    await expect(autres).toHaveClass(/bg-brand-50/);
    // « Automation » n'est plus une entrée de premier niveau : seulement le nom d'un sous-groupe.
    await expect(page.locator('aside').getByRole('link', { name: 'Automation', exact: true })).toHaveCount(0);
  });

  test('🔴 sans boutique ni portail : ni Shopify ni HubSpot, Autres reste', async ({ page }) => {
    await monter(page, { boutique: false, portail: false, ecran: '/automations' });
    await expect(page.getByTestId('nav-groupe-automation')).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => adressesDuGroupe(page, 'automation')).toEqual(['/automations']);
    await expect(page.locator('aside a[href="/automations/shopify"]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/automations/hubspot"]')).toHaveCount(0);
  });

  test('🔴 sur le Builder : Scénario ouvert, Builder éclairé, et plus aucun « Scénario » dans Contenu', async ({ page }) => {
    await monter(page, { boutique: false, portail: false, ecran: '/workflows' });
    await expect(page.getByTestId('nav-groupe-scenario')).toHaveAttribute('aria-expanded', 'true');
    // Automation reste repliée : ce n'est pas la page ouverte.
    await expect(page.getByTestId('nav-groupe-automation')).toHaveAttribute('aria-expanded', 'false');
    const builder = page.locator('aside').getByRole('link', { name: 'Builder', exact: true });
    await expect(builder).toHaveAttribute('href', '/workflows');
    await expect(builder).toHaveClass(/bg-brand-50/);
    // L'adresse n'a pas bougé, et une seule entrée y mène.
    expect(new URL(page.url()).pathname).toBe('/workflows');
    // Contenu ouvert : ses groupes de canal et sa Bibliothèque, plus de lien « Scénario » entre Email et elle.
    await page.getByTestId('nav-groupe-contenu').click();
    await expect(page.getByTestId('nav-groupe-contenu-bibliotheque')).toBeVisible();
    await expect(page.locator('aside').getByRole('link', { name: 'Scénario', exact: true })).toHaveCount(0);
    await expect(page.locator('aside a[href="/workflows"]')).toHaveCount(1);
  });

  test('la page Shopify garde son entrée, éclairée, même sans boutique (arrivée par un lien)', async ({ page }) => {
    await monter(page, { boutique: false, portail: false, ecran: '/automations/shopify' });
    await expect(page.getByTestId('automations-shopify-sans-boutique')).toBeVisible();
    const shopify = page.locator('aside a[href="/automations/shopify"]');
    await expect(shopify).toHaveCount(1);
    await expect(shopify).toHaveClass(/bg-brand-50/);
    await expect(page.locator('aside a[href="/automations/hubspot"]')).toHaveCount(0);
  });
});
