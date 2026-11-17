import { test, expect } from '../aide/test';
import { mockAccueil } from '../support/accueil';
import { NAVIGATEUR, REGLAGES_ACCUEIL, capturer, communs, langue, type Locale } from './donnees-demo';

/**
 * LES ÉTAPES DE LA CONSOLE de « Prendre un numéro fourni » et de « Garder mon application WhatsApp Business » (Julien,
 * 2026-11-16 : « Montre les vrais écrans quand la personne est dans la console »). Elles s'écrivent `etape-<n>-console`,
 * à côté des étapes de Claude Code de la même fiche. Rien n'est connecté, rien n'est payé.
 */
const FOURNI = 'numero-fourni-par-messaging-me';
const GARDER = 'garder-mon-application-whatsapp-business';
const SANS_NUMERO = {
  hasNumber: false, phoneNumberId: null, number: null, numberStatus: null, codeVerificationStatus: null,
  status: { dot: 'grey', label: 'Aucun numéro', reason: 'Aucun numéro connecté.' },
};

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use(NAVIGATEUR[locale]);

    test(`console (${locale}) : l'Accueil sans numéro`, async ({ page }) => {
      await langue(page, locale);
      await mockAccueil(page, { account: SANS_NUMERO, settings: REGLAGES_ACCUEIL });
      await communs(page);
      await page.reload();
      // 1. « Continuer la mise en service », la seule carte de l'Accueil sans numéro (2026-11-17).
      const lien = page.getByTestId('continuer-mise-en-service');
      await expect(lien).toBeVisible();
      await capturer(page, FOURNI, '1-console', locale, page.getByTestId('reprendre-mise-en-service'), 'haut', lien);
    });

    test(`console (${locale}) : la page Connecter WhatsApp`, async ({ page }) => {
      await langue(page, locale);
      const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      await page.route('**/api/backend/**', (route) => route.fulfill(json({})));
      await page.route('**/api/backend/tenants/*/connexion-numero', (route) => route.fulfill(json({
        etat: { fourni: null, code: null, connecte: null, abonnement: null, inclusDansLePro: true }, empreinte: '0123456789abcdef',
      })));
      await communs(page);
      await page.goto('/connecter-whatsapp');
      await page.getByTestId('carte-meta-choisir').click();
      await page.getByTestId('question-compte-oui').click();
      await page.locator('main').evaluate((m) => { (m as HTMLElement).style.paddingBottom = '320px'; });
      // 2. « Fournissez-moi un numéro », à côté de « J'ai déjà un numéro ».
      const fourni = page.getByTestId('choix-fourni');
      await expect(fourni).toBeVisible();
      await capturer(page, FOURNI, '2-console', locale, fourni, 'haut', fourni);
      // Garder : « Vous pouvez le garder », puis le bouton qui ouvre la fenêtre de Meta.
      await page.getByTestId('choix-coexistence').click();
      const garder = page.getByTestId('choix-coexistence-ouvert');
      await expect(garder).toBeVisible();
      await capturer(page, GARDER, '1-console', locale, garder, 'haut', page.getByTestId('ouvrir-fenetre-coexistence'));
    });
  });
}
