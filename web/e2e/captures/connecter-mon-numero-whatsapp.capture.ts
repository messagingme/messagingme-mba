import { test, expect } from '../aide/test';
import { mockAccueil } from '../support/accueil';
import { NAVIGATEUR, OFFRE_PRO, REGLAGES_ACCUEIL, capturer, communs, langue, type Locale } from './donnees-demo';
import { fenetreMeta } from './fenetre-meta';

/**
 * « Connecter mon numéro WhatsApp, et lire son état », dans l'ordre du tunnel de la console (Julien, 2026-11-17) : la
 * formule, la question du paiement (la formule faite au-dessus), les questions du numéro une fois la carte chez Meta
 * choisie, la fenêtre de Meta (sa forme générique, `fenetre-meta.ts`), puis un numéro connecté et son état. Rien n'est
 * connecté, rien n'est payé.
 */
const CLE = 'connecter-mon-numero-whatsapp';
/** Le numéro de la marque fictive, dans la plage réservée à la fiction. */
const COMPTE = {
  number: '+33 6 39 98 01 00', verifiedName: 'Votre marque', ownerBusinessName: 'Votre marque', phoneNumberId: 'pn-demo',
};
const VOLUMES = {
  whatsapp: { envoyes: 1284, recus: 937 }, rcs: null,
};

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use(NAVIGATEUR[locale]);

    test(`${CLE} (${locale}) : la fenêtre de Meta`, async ({ page }) => {
      // 4. La fenêtre de Meta n'est pas la nôtre : sa forme générique, en trois étapes, comme le film du démarrage.
      await page.setContent(fenetreMeta(locale));
      await capturer(page, CLE, 4, locale);
    });

    test(`${CLE} (${locale}) : la formule`, async ({ page }) => {
      await langue(page, locale);
      const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      await page.route('**/api/backend/**', (route) => route.fulfill(json({})));
      await communs(page);
      // Un espace neuf, en Free, entré par la mise en service : la formule d'abord. Posée après `communs`, elle prime.
      await page.route('**/api/backend/tenants/*/offre', (route) => route.fulfill(json({
        ...OFFRE_PRO, offre: 'free', fonctions: [], prixPro: { moisCentimes: 4900, anCentimes: 49000 },
        essai: { jours: 14, possible: true, finLe: null }, abonnement: null,
      })));
      await page.goto('/connecter-whatsapp?suite=demarrer');
      // 1. Choisir sa formule : les quatre cartes, l'essai du Pro en tête de la sienne.
      await expect(page.getByTestId('choix-offre')).toBeVisible();
      await capturer(page, CLE, 1, locale, page.getByTestId('choix-offre'), 'haut', page.getByTestId('offre-choisir-pro'));
    });

    test(`${CLE} (${locale}) : la page Connecter WhatsApp`, async ({ page }) => {
      await langue(page, locale);
      const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      await page.route('**/api/backend/**', (route) => route.fulfill(json({})));
      await page.route('**/api/backend/tenants/*/connexion-numero', (route) => route.fulfill(json({
        etat: { fourni: null, code: null, connecte: null, abonnement: null, inclusDansLePro: true }, empreinte: '0123456789abcdef',
      })));
      await communs(page);
      // Au retour de Stripe, la formule Pro souscrite : l'étape 1 est faite.
      await page.goto('/connecter-whatsapp?suite=demarrer&pro=recu');
      // 2. Comment payer vos messages Meta : les deux choix, rien de choisi d'avance.
      await expect(page.getByTestId('qui-regle-meta')).toBeVisible();
      await capturer(page, CLE, 2, locale, page.getByTestId('tunnel-numero'), 'haut', page.getByTestId('carte-meta-choisir'));
      // 3. La carte chez Meta choisie, l'étape du numéro s'ouvre : « Oui » au compte Meta Business, puis votre numéro ou
      // le nôtre. Un peu d'air en bas laisse la page descendre jusque-là.
      await page.getByTestId('carte-meta-choisir').click();
      await page.getByTestId('question-compte-oui').click();
      await page.locator('main').evaluate((m) => { (m as HTMLElement).style.paddingBottom = '160px'; });
      await capturer(page, CLE, 3, locale, page.getByTestId('tunnel-numero-meta'), 'haut', page.getByTestId('choix-fourni'));
    });

    test(`${CLE} (${locale}) : numéro connecté`, async ({ page }) => {
      await langue(page, locale);
      await mockAccueil(page, { account: COMPTE, settings: REGLAGES_ACCUEIL, volumes: VOLUMES });
      await communs(page);
      await page.reload();
      // 5. L'état du numéro : sa carte, le compte WhatsApp Business, et les chiffres.
      await expect(page.getByTestId('numero-card')).toBeVisible();
      await capturer(page, CLE, 5, locale, page.getByTestId('numero-card'));
    });
  });
}
