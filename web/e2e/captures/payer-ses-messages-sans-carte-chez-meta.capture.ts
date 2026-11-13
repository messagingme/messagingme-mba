import type { Page } from '@playwright/test';
import { test, expect } from '../aide/test';
import { mockAccueil } from '../support/accueil';
import { OFFRE_PRO } from './offre-demo';
import { NAVIGATEUR, capturer, communs, langue, type Locale } from './donnees-demo';

/**
 * « Payer ses messages sans carte chez Meta » (lot 3v-2d) : le Crédit WhatsApp, de la prise de l'option à la recharge.
 * 1. l'option dans l'onglet Crédit WhatsApp de la page Offre, à prendre ;
 * 2. la connexion du numéro sans carte : « Votre numéro, ou le nôtre ? », « J’utilise un numéro existant », puis « Connecter mon numéro » ;
 * 3. le solde, le prix d'un message vers la France et les quatre recharges.
 * Les états sont ceux que le serveur rend (simulés) ; rien n'est payé, aucune fenêtre ne s'ouvre.
 */
const CLE = 'payer-ses-messages-sans-carte-chez-meta';
const json = (b: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

const OFFRES_ACHAT = [{ offre: 'wa_50', htCentimes: 5_000 }, { offre: 'wa_100', htCentimes: 10_000 }, { offre: 'wa_250', htCentimes: 25_000 }, { offre: 'wa_500', htCentimes: 50_000 }];
const PRIX_FRANCE = [
  { categorie: 'marketing', prixMicroEur: 74_760 }, { categorie: 'utility', prixMicroEur: 26_040 },
  { categorie: 'authentication', prixMicroEur: 26_040 }, { categorie: 'service', prixMicroEur: 26_040 },
];
/** L'option en vente, pas encore prise : 30 € HT par numéro et par mois, la formule Pro payée ou dans son essai. */
const OPTION = { disponible: true, prixHtCentimes: 3000, placesMax: 20, places: 0, couverts: 0, statut: null, finPrevueLe: null, formulePayee: true, prisePossible: true };
/** Un espace sans numéro sur la ligne : l'onglet paraît pour prendre l'option. */
const SANS_LIGNE = {
  soldeMicroEur: 0, prixFrance: PRIX_FRANCE, franchiseServiceParNumero: 1000, ligneArretee: false, historique: [],
  achat: { disponible: true, permis: 'sans_ligne', offres: OFFRES_ACHAT }, option: OPTION,
};
/** Un numéro sur la ligne, un premier achat et une journée d'envois ; la courbe part de zéro, la veille de l'achat. */
const SUR_LA_LIGNE = {
  soldeMicroEur: 49_850_480, prixFrance: PRIX_FRANCE, franchiseServiceParNumero: 1000, ligneArretee: false,
  serie: [
    { jour: '2026-11-09', soldeMicroEur: 0, consommationMicroEur: 0 },
    { jour: '2026-11-10', soldeMicroEur: 49_850_480, consommationMicroEur: 149_520 },
  ],
  achat: { disponible: true, permis: 'ok', offres: OFFRES_ACHAT },
  option: { ...OPTION, places: 1, couverts: 1, statut: 'actif' },
  historique: [
    { id: 'envois:2026-11-10', raison: 'envois', deltaMicroEur: -149_520, jour: '2026-11-10', at: '2026-11-10T18:00:00.000Z', messages: 2, reference: null, facture: false },
    { id: 'm1', raison: 'achat', deltaMicroEur: 50_000_000, jour: null, at: '2026-11-10T09:00:00.000Z', messages: null, reference: 'cs_demo', facture: true },
  ],
};

/** L'onglet Crédit WhatsApp de la page Offre, avec cette vue du crédit. */
async function onglet(page: Page, vue: unknown): Promise<void> {
  await page.route('**/api/backend/**', (route) => route.fulfill(json({})));
  await communs(page);
  await page.route('**/api/backend/**', async (route) => {
    const chemin = new URL(route.request().url()).pathname;
    if (chemin.endsWith('/credit-whatsapp')) return route.fulfill(json(vue));
    if (chemin.endsWith('/offre')) return route.fulfill(json({ ...OFFRE_PRO, ongletCreditWhatsapp: true }));
    if (chemin.endsWith('/offre/factures')) return route.fulfill(json({ plusSurStripe: false, factures: [] }));
    return route.fallback();
  });
  await page.goto('/offre?tab=whatsapp');
}

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use(NAVIGATEUR[locale]);

    test(`${CLE} (${locale}) : prendre l'option`, async ({ page }) => {
      await langue(page, locale);
      await onglet(page, SANS_LIGNE);
      await expect(page.getByTestId('credit-wa-option-prendre')).toBeVisible();
      await capturer(page, CLE, 1, locale, page.getByTestId('credit-wa-option'), 'haut', page.getByTestId('credit-wa-option-prendre'));
    });

    test(`${CLE} (${locale}) : connecter son numéro sans carte`, async ({ page }) => {
      await langue(page, locale);
      await mockAccueil(page, { account: { hasNumber: false, phoneNumberId: null, number: null, numberStatus: null, codeVerificationStatus: null, status: { dot: 'grey', label: 'Aucun numéro', reason: 'Aucun numéro connecté.' } } });
      await communs(page);
      await page.route('**/api/backend/**', async (route) => {
        const chemin = new URL(route.request().url()).pathname;
        if (chemin.endsWith('/credit-whatsapp/etat')) return route.fulfill(json({ etat: 'en_attente', enVente: true, avecApplication: false, fenetrePartenaire: true }));
        if (chemin.endsWith('/embedded-signup/config')) return route.fulfill(json({ enabled: true, appId: 'app-demo', configId: 'cfg-demo', graphVersion: 'v25.0', solutionId: 'sol-demo' }));
        return route.fallback();
      });
      await page.goto('/connecter-whatsapp');
      await page.getByTestId('ligne-numero-mien').click();
      await expect(page.getByTestId('carte-credit-wa-connecter-ligne')).toBeVisible();
      await capturer(page, CLE, 2, locale, page.getByTestId('ligne-numero-mien-suite'), 'bas', page.getByTestId('carte-credit-wa-connecter-ligne'));
    });

    test(`${CLE} (${locale}) : recharger`, async ({ page }) => {
      await langue(page, locale);
      await onglet(page, SUR_LA_LIGNE);
      await expect(page.getByTestId('credit-wa-recharger')).toBeVisible();
      await capturer(page, CLE, 3, locale, page.getByTestId('credit-wa-recharger'), 'haut', page.getByTestId('credit-wa-offre-wa_100'));
    });
  });
}
