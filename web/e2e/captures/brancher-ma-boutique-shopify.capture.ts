import { test, expect } from '../aide/test';
import { CONTACTS_DEMO, NAVIGATEUR, REGLAGES_DEMO, TAGS_DEMO, capturer, communs, langue, type Locale } from './donnees-demo';

/**
 * « Brancher ma boutique Shopify » : la carte de Paramètres > Général sans boutique, le mode opératoire chez Shopify, les
 * clés collées, l'assistant d'un message (le texte, puis le délai de la relance), l'import des clients abonnés, et la
 * carte d'une boutique branchée. Les états sont ceux que lit `web/e2e/shopify.spec.ts` ; rien n'est branché, rien n'est
 * envoyé.
 */
const CLE = 'brancher-ma-boutique-shopify';
const BOUTIQUE = {
  domaine: 'votre-marque.myshopify.com', nom: 'Votre marque', etat: 'connectee', dernierEvenementLe: '2026-10-24T09:42:00.000Z',
  delaiPanierMinutes: 60, origine: 'console',
};
const VIDE = { boutique: null, messages: [], compteurs: {}, paniers: { relances: {}, fermesATemps: 0, enAttente: 0 }, pageApps: null, attentes: [] };
const message = (evenement: string, variables: string[]) => ({ evenement, modele: `shopify_${evenement}_demo`, langue: 'fr', variables, actif: true });
const COMMANDE = message('order_paid', ['first_name', 'order_number', 'order_total', 'order_status_url']);
const EXPEDITION = message('order_fulfilled', ['first_name', 'order_number', 'carrier', 'tracking_url']);
/** Branchée, les deux messages de commande actifs, la relance pas encore réglée : l'assistant de l'étape 4. */
const A_REGLER = {
  ...VIDE, boutique: BOUTIQUE, pageApps: 'https://admin.shopify.com/store/votre-marque/settings/apps', messages: [COMMANDE, EXPEDITION],
};
/** Branchée depuis un mois : les trois messages actifs, les chiffres des 30 jours. */
const EN_SERVICE = {
  ...A_REGLER,
  messages: [COMMANDE, EXPEDITION, message('checkout_abandoned', ['checkout_url'])],
  compteurs: { envoye: 148, desabonne: 3, sans_telephone: 6 },
  paniers: { relances: { envoye: 21 }, fermesATemps: 7, enAttente: 4 },
};
/** Ce que les envois ont rapporté sur 30 jours (étape 8), en euros, quelques commandes de test à part. */
const VENTES = {
  periode: { from: '2026-10-17', to: '2026-11-15' },
  reel: {
    totaux: [{ devise: 'EUR', brut: '4862.40', prouve: '2915.80', commandes: 58 }],
    sources: [
      { source: 'campagne', campaignId: 'k-automne', nom: 'Collection automne', devise: 'EUR', brut: '2740.10', prouve: '1820.60', commandes: 31 },
      { source: 'relance_panier', campaignId: null, nom: null, devise: 'EUR', brut: '1395.20', prouve: '1095.20', commandes: 17 },
      { source: 'agent', campaignId: null, nom: null, devise: 'EUR', brut: '727.10', prouve: '0', commandes: 10 },
    ],
  },
  test: { totaux: [], sources: [] },
  paniers: { relances: 64, recuperes: 17, montants: [{ devise: 'EUR', montant: '1395.20' }], recuperesTest: 0 },
};
const ROI = {
  devise: 'EUR',
  serie: Array.from({ length: 30 }, (_, i) => ({
    jour: new Date(Date.UTC(2026, 9, 17 + i)).toISOString().slice(0, 10),
    chiffreCumule: (4862.4 * Math.pow((i + 1) / 30, 1.15)).toFixed(2),
    coutCumule: Math.round(212.6 * ((i + 1) / 30) * 100) / 100,
  })),
  depense: 212.6, ramene: '4862.40', prouve: '2915.80', roiPct: 2187, ia: 18.4, estime: true, partiel: false,
  autresDevises: [],
  sources: [
    { source: 'campagne', campaignId: 'k-automne', nom: 'Collection automne', cout: 148.2, brut: '2740.10', roiPct: 1749, partiel: false },
    { source: 'relance_panier', campaignId: null, nom: null, cout: 46, brut: '1395.20', roiPct: 2933, partiel: false },
    { source: 'agent', campaignId: null, nom: null, cout: 18.4, brut: '727.10', roiPct: 3852, partiel: false },
  ],
  autres: null,
};
/** Le suivi des commandes (étape 9) : la boutique branchée le 3 octobre. */
const SEGMENTS = { boutique: { devise: 'EUR', commandesDepuis: '2026-10-03T10:00:00.000Z', coupeeLe: null }, activiteCompleteDepuis: '2026-10-03' };
const APERCU = { abonnes: 412, sansTelephone: 57, dejaDansLEspace: 38, nouveaux: 317, placesLibres: 4812, importables: 317, complet: true };

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use(NAVIGATEUR[locale]);

    test(`${CLE} (${locale})`, async ({ page }) => {
      await langue(page, locale);
      let etat: Record<string, unknown> = VIDE;
      await page.route('**/api/backend/**', async (route) => {
        const req = route.request();
        const chemin = new URL(req.url()).pathname;
        const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
        if (chemin.endsWith('/integrations/shopify/clients/apercu')) return json(APERCU);
        if (chemin.endsWith('/stats/ventes')) return json(VENTES);
        if (chemin.endsWith('/stats/roi')) return json(ROI);
        if (chemin.endsWith('/contacts/segments')) return json(SEGMENTS);
        if (chemin.endsWith('/contacts') && req.method() === 'GET') return json({ contacts: CONTACTS_DEMO, total: 1284 });
        if (chemin.endsWith('/user-fields')) return json({ fields: [] });
        if (chemin.endsWith('/tags')) return json({ tags: TAGS_DEMO });
        if (chemin.endsWith('/integrations/shopify') && req.method() === 'GET') return json(etat);
        if (chemin.endsWith('/integrations/shopify')) return json({});
        if (chemin.endsWith('/settings')) return json({ ...REGLAGES_DEMO, hubspotPortalConnecte: false, hubspotChoixValideLe: null });
        if (chemin.endsWith('/account-status')) return json({ hasNumber: true, hubspotPortal: { connected: false } });
        if (chemin.endsWith('/integrations/batch')) return json({ branche: false });
        if (chemin.endsWith('/settings/agents-peuvent-prendre')) return json({ actif: false });
        if (chemin.endsWith('/contacts/blocked')) return json({ contacts: [] });
        if (chemin.endsWith('/templates')) return json({ templates: [] });
        return json({});
      });
      await communs(page);
      await page.goto('/integrations');
      const carte = page.getByTestId('integration-shopify');
      await expect(carte.getByTestId('shopify-mode-operatoire')).toBeVisible();

      // 1. Les intégrations de Paramètres > Général, et la carte Shopify sans boutique.
      await capturer(page, CLE, 1, locale, page.getByTestId('integrations'), 'haut', carte.getByRole('heading', { name: 'Shopify' }));

      // 2. Le mode opératoire chez Shopify, l'adresse et les droits copiables d'un clic.
      await capturer(page, CLE, 2, locale, carte.getByTestId('shopify-mode-operatoire'), 'haut', carte.getByTestId('shopify-copier-adresse'));

      // 3. Les clés collées (inventées), juste avant « Brancher la boutique ». Rien n'est branché.
      await carte.getByTestId('shopify-boutique').fill('votre-marque.myshopify.com');
      await carte.getByTestId('shopify-client-id').fill('3f9c2e71a8b54d06');
      await carte.getByTestId('shopify-secret').fill('demo-secret-invente');
      const valider = carte.getByTestId('shopify-brancher-valider');
      await expect(valider).toBeEnabled();
      await capturer(page, CLE, 3, locale, valider, 'bas', valider);

      // 4. L'assistant de la relance : le texte proposé, ses données, l'aperçu.
      etat = A_REGLER;
      await page.goto('/integrations');
      await page.getByTestId('integration-shopify-regler-checkout_abandoned').click();
      const assistant = page.getByTestId('shopify-assistant');
      await expect(assistant.getByTestId('shopify-assistant-texte')).toBeVisible();
      await capturer(page, CLE, 4, locale, assistant, 'haut', assistant.getByTestId('shopify-assistant-texte'));

      // 5. Le délai par défaut, la dernière étape, juste avant « Envoyer à Meta ». Rien n'est envoyé.
      await assistant.getByTestId('shopify-assistant-suivant').click();
      await assistant.getByTestId('shopify-delai-60').click();
      const envoyer = assistant.getByTestId('shopify-assistant-envoyer');
      await expect(envoyer).toBeEnabled();
      await capturer(page, CLE, 5, locale, assistant, 'haut', envoyer);

      // 6. L'import des clients abonnés : le compte d'abord, puis combien en importer. Rien n'est importé.
      etat = EN_SERVICE;
      await page.goto('/integrations');
      await page.getByTestId('integration-shopify-importer').click();
      const apercu = page.getByTestId('shopify-import-apercu');
      await expect(apercu).toBeVisible();
      await capturer(page, CLE, 6, locale, apercu, 'haut', page.getByTestId('shopify-import-nombre'));

      // 7. La boutique branchée : ses messages, ses chiffres, et « Couper ».
      await page.goto('/integrations');
      await expect(carte.getByTestId('integration-shopify-compteurs')).toBeVisible();
      await capturer(page, CLE, 7, locale, carte, 'haut', carte.getByTestId('integration-shopify-couper'));

      // 8. Performance Lab > Quantitatif > Shopify : le chiffre, sa part prouvée, le coût et le ROI.
      await page.goto('/dashboard/shopify');
      await expect(page.getByTestId('ventes-total-EUR')).toBeVisible();
      await capturer(page, CLE, 8, locale, undefined, 'haut', page.getByTestId('ventes-total-EUR'));

      // 9. Contacts, les filtres « Achats et activité » : au moins 2 commandes en 90 jours.
      await page.goto('/contacts');
      await page.getByTestId('contacts-toggle-filters').click();
      await page.getByTestId('filtre-commandes-min').fill('2');
      await page.getByTestId('filtre-commandes-jours').fill('90');
      const achats = page.getByTestId('filtres-achats');
      await expect(page.getByTestId('filtres-achats-suivi')).toBeVisible();
      await capturer(page, CLE, 9, locale, achats, 'haut', page.getByTestId('filtre-commandes-min'));
    });
  });
}
