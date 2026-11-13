import { test, expect, type Page } from './aide/test';

/**
 * LE BANDEAU DE LA CONVERSION (révision du Crédit WhatsApp, lot C, moment 2) : la formule payée, l'option en vente et ni
 * prise ni payée (`a_prendre`), un administrateur d'un Pro ou d'un Business le voit sur chaque page ; « Voir le Crédit
 * WhatsApp » mène à l'onglet, la croix le masque pour de bon. Le serveur est simulé.
 */
const TENANT = 'tenant-e2e';
const LIMITES = {
  utilisateurs: 3, admins: 2, contacts: 5000, envoisModelesMois: null, automations: null, suppressionsJour: null, adressesWebhook: 5,
  journalWebhooksJours: 30, conservationJours: 90, commissionPct: 20, badge: false, numeroInclus: true,
};
const PRO = ['inbox', 'scenarios', 'statistiques', 'agent_meta', 'aide', 'assistants', 'email', 'console'];

async function monter(page: Page, o: { etat?: string; enVente?: boolean; role?: 'admin' | 'agent'; offre?: string; onglet?: boolean; numeroAvecCarte?: boolean } = {}) {
  const lectures: string[] = [];
  await page.addInitScript((s) => { window.localStorage.setItem('mba.session', JSON.stringify(s)); },
    { token: 'e2e-token', email: 'x@e2e.test', role: o.role ?? 'admin', tenantId: TENANT });
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/backend/**', async (route) => {
    const chemin = new URL(route.request().url()).pathname;
    if (chemin.endsWith('/credit-whatsapp/etat')) {
      lectures.push(chemin);
      return route.fulfill(json({ etat: o.etat ?? 'a_prendre', enVente: o.enVente ?? true, avecApplication: false, numeroAvecCarte: o.numeroAvecCarte ?? false }));
    }
    if (chemin.endsWith(`/tenants/${TENANT}/offre`)) {
      return route.fulfill(json({
        offre: o.offre ?? 'pro', fonctions: PRO, limites: LIMITES, usage: { envoisModelesMois: null, contacts: 12, automations: 1, membres: 2 },
        grille: { free: { fonctions: [], limites: LIMITES }, pro: { fonctions: PRO, limites: LIMITES }, entreprise: { fonctions: PRO, limites: LIMITES } },
        prixPro: null, essai: null, sieges: null, suiteDuNumero: null, abonnement: null, upgradeUrl: 'https://console.e2e.test/offre',
        ongletCreditWhatsapp: o.onglet ?? true,
      }));
    }
    return route.fulfill(json({}));
  });
  return lectures;
}

test('🔴 la formule payée, l’option à prendre : le bandeau sur chaque page, « Voir le Crédit WhatsApp » mène à l’onglet', async ({ page }) => {
  await monter(page);
  await page.goto('/support');
  const bandeau = page.getByTestId('bandeau-ligne-credit');
  await expect(bandeau).toContainText(
    'Votre formule est active : vous pouvez maintenant payer vos messages chez Messaging Me, sans carte chez Meta, 30 € HT par numéro et par mois.',
  );
  await page.getByTestId('bandeau-ligne-credit-voir').click();
  await expect(page).toHaveURL(/\/offre\?tab=whatsapp$/);
});

test('🔴 la croix le masque, et il ne revient pas au chargement suivant (aucune lecture de plus)', async ({ page }) => {
  const lectures = await monter(page);
  await page.goto('/support');
  await page.getByTestId('bandeau-ligne-credit-masquer').click();
  await expect(page.getByTestId('bandeau-ligne-credit')).toHaveCount(0);
  const avant = lectures.length;
  // 🔴 Une absence ne se vérifie qu'une fois le mécanisme passé : l'offre relue (ce qui monte le bandeau), puis un temps.
  const offre = page.waitForResponse((r) => r.url().endsWith(`/tenants/${TENANT}/offre`));
  await page.reload();
  await offre;
  await page.waitForTimeout(500);
  await expect(page.getByTestId('bandeau-ligne-credit')).toHaveCount(0);
  expect(lectures.length).toBe(avant);
});

test('aucun bandeau : l’option prise, payée ou en essai, hors vente, ou un numéro connecté avec sa carte (l’état lu)', async ({ page }) => {
  // Le numéro connecté avec sa carte : l'option ne s'y vend plus (décision de Julien du 2026-11-13), le bandeau qui la
  // propose se tait comme l'e-mail du même moment.
  for (const cas of [{ etat: 'active' }, { etat: 'en_attente' }, { etat: 'essai' }, { enVente: false }, { numeroAvecCarte: true }]) {
    await monter(page, cas);
    // 🔴 L'état LU d'abord : avant sa réponse, l'absence du bandeau ne prouverait rien.
    const lue = page.waitForResponse((r) => r.url().endsWith('/credit-whatsapp/etat'));
    await page.goto('/support');
    await lue;
    await page.waitForTimeout(500);
    await expect(page.getByTestId('bandeau-ligne-credit'), JSON.stringify(cas)).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('ni un membre, ni une Free, ni un Pro sans l’onglet Crédit WhatsApp (option hors vente) : aucune lecture de l’état, aucun bandeau', async ({ page }) => {
  for (const cas of [{ role: 'agent' as const }, { offre: 'base' }, { onglet: false }]) {
    const lectures = await monter(page, cas);
    // L'offre lue (ce qui déciderait du montage), puis un temps : aucune lecture de l'état ne doit suivre.
    const offre = page.waitForResponse((r) => r.url().endsWith(`/tenants/${TENANT}/offre`));
    await page.goto('/support');
    await offre;
    await page.waitForTimeout(500);
    await expect(page.getByTestId('bandeau-ligne-credit'), JSON.stringify(cas)).toHaveCount(0);
    expect(lectures, JSON.stringify(cas)).toEqual([]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});
