import { test, expect } from './aide/test';

/**
 * L'ONGLET « CRÉDITS » DE `/ops` (Entreprise illimitée, lot C ; route `GET /ops/credits`, tenue côté serveur par
 * `tests/ops.test.ts` et `tests/integration/suivi-credits.integration.test.ts`).
 *
 * Ce que ces tests protègent à l'écran : le montant à facturer d'une Entreprise (aucun autre écran ne le donne), la
 * somme des plafonds IA des Entreprises à clé face au budget d'équipe de Vercel et l'alerte quand elle le dépasse (rouge
 * de la relecture du lot B), et une API plus ancienne qui dit « pas encore disponible » au lieu d'une erreur brute.
 */
const SESSION_OPS = { token: 'session-ops-e2e', email: 'exploitant@e2e.test' };
const DEUX = (mois: number, precedent: number) => ({ moisMicroEur: mois, moisPrecedentMicroEur: precedent });
const ENTREPRISE = {
  tenantId: 't-groupama', nom: 'Groupama PJ', offre: 'entreprise',
  ia: { illimite: true, soldeMicroEur: 4_824_285, consommation: DEUX(180_000, 120_000), plafondMicroEur: 100_000_000, plafondAtteint: false, cle: true },
  whatsapp: { surLaLigne: false, soldeMicroEur: 0, consommation: DEUX(0, 0) },
  aFacturer: DEUX(180_000, 120_000),
};
const PREPAYE = {
  tenantId: 't-free', nom: 'Essai Dupont', offre: 'base',
  ia: { illimite: false, soldeMicroEur: 5_794_909, consommation: DEUX(205_091, 0), plafondMicroEur: null, plafondAtteint: false, cle: false },
  whatsapp: { surLaLigne: false, soldeMicroEur: 0, consommation: DEUX(0, 0) },
  aFacturer: null,
};
const vue = (dollars: number) => ({
  espaces: [ENTREPRISE, PREPAYE], plafondIaParDefautMicroEur: 100_000_000,
  plafondsEntreprisesAvecCleMicroEur: dollars * 920_000, plafondsEntreprisesAvecCleDollars: dollars,
});

async function ouvrir(page: import('@playwright/test').Page, o: { credits?: { status: number; body: unknown }; budget?: number } = {}) {
  await page.addInitScript((s) => window.localStorage.setItem('mba.sessionOps', JSON.stringify(s)), SESSION_OPS);
  await page.route('**/api/backend/**', async (route) => {
    const chemin = route.request().url().split('?')[0]!;
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/ops/credits')) {
      const c = o.credits ?? { status: 200, body: vue(108.7) };
      return json(c.body, c.status);
    }
    if (chemin.endsWith('/ops/vercel')) {
      const limite = o.budget ?? 100;
      return json({ configure: true, limiteDollars: limite, depenseEquipeDollars: 0, depenseClesMensuellesDollars: 0.53, depenseRetenueDollars: 0.53, part: 0.53 / limite });
    }
    return json({});
  });
  await page.goto('/ops?tab=credits');
}

test.describe('Ops : l’onglet Crédits', () => {
  test('🔴 le montant à facturer d’une Entreprise, ses deux mois, son plafond ; un prépayé n’a rien à facturer', async ({ page }) => {
    await ouvrir(page, { budget: 300 });
    await expect(page.getByTestId('mba-tab-credits')).toHaveAttribute('aria-selected', 'true');
    const e = page.getByTestId('ops-credits-t-groupama');
    await expect(e).toContainText('Groupama PJ');
    await expect(e).toContainText('Entreprise');
    await expect(e).toContainText(/illimité · plafond 100,00\s€/);
    await expect(e.getByTestId('ops-credits-a-facturer')).toHaveText(/0,18\s€ \/ 0,12\s€/);
    const p = page.getByTestId('ops-credits-t-free');
    await expect(p).toContainText('Free');
    await expect(p.getByTestId('ops-credits-a-facturer')).toHaveText('prépayé');
    // 108,70 $ de plafonds sous un budget de 300 $ : pas d'alerte.
    await expect(page.getByTestId('ops-credits-somme')).toContainText(/300\s\$US|300\s\$|\$300/);
    await expect(page.getByTestId('ops-credits-depassement')).toHaveCount(0);
  });

  test('🔴 la somme des plafonds au-delà du budget d’équipe : l’écran le dit, en rouge', async ({ page }) => {
    await ouvrir(page, { budget: 100 });
    await expect(page.getByTestId('ops-credits-depassement')).toContainText(/une seule Entreprise qui s’emballe couperait l’IA de tous les clients/);
  });

  test('une API plus ancienne (404) : « pas encore disponible », pas une erreur brute', async ({ page }) => {
    await ouvrir(page, { credits: { status: 404, body: { message: 'Route GET:/ops/credits not found' } } });
    await expect(page.getByTestId('ops-credits-erreur')).toContainText(/pas encore disponible/);
  });
});
