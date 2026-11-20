import { test, expect } from '../aide/test';
import { CONTACTS_DEMO, NAVIGATEUR, REGLAGES_DEMO, TAGS_DEMO, capturer, communs, langue, type Locale } from './donnees-demo';
import { bloc, centrer, fermerPanneau, fleche, ouvrir, simulerEditeur, type Graphe, type Reponse } from './editeur-demo';

/**
 * « Brancher ma boutique Shopify » : la carte de Tools > Intégrations sans boutique, le mode opératoire chez Shopify, les
 * clés collées, les automations de l'écran Automation, le scénario du panier dans le builder (son premier message, puis
 * sa suite), l'import des clients abonnés, la carte d'une boutique branchée (pause, couper), le retour sur investissement
 * et les filtres d'achats. Les états sont ceux que lisent `web/e2e/shopify.spec.ts` et `web/e2e/workflow-shopify.spec.ts` ;
 * rien n'est branché, rien n'est envoyé.
 */
const CLE = 'brancher-ma-boutique-shopify';
const BOUTIQUE = {
  domaine: 'votre-marque.myshopify.com', nom: 'Votre marque', etat: 'connectee', dernierEvenementLe: '2026-10-24T09:42:00.000Z',
  delaiPanierMinutes: 60, origine: 'console', pauseLe: null,
};
const VIDE = { boutique: null, compteurs: {}, paniers: { relances: {}, fermesATemps: 0, enAttente: 0 }, pageApps: null, lignes: [] };
const ligne = (evenement: string, o: Record<string, unknown> = {}) => ({
  evenement, actif: true, workflowId: `wf-${evenement}`, scenario: evenement, modele: `${evenement}_demo`, langue: 'fr',
  etatChezMeta: 'APPROVED', blocs: 1, versionProgrammee: false, ...o,
});
/** L'écran Automation (étape 4) : la commande payée active, l'expédition pas encore créée, le panier en validation. */
const AUTOMATIONS = {
  ...VIDE, boutique: BOUTIQUE, pageApps: 'https://admin.shopify.com/store/votre-marque/settings/apps',
  lignes: [ligne('order_paid', { blocs: 2 }), ligne('checkout_abandoned', { etatChezMeta: 'PENDING', blocs: 3 })],
};
/** Branchée depuis un mois : les trois automations actives, les chiffres des 30 jours. */
const EN_SERVICE = {
  ...AUTOMATIONS,
  lignes: [ligne('order_paid', { blocs: 2 }), ligne('order_fulfilled'), ligne('checkout_abandoned', { blocs: 3 })],
  compteurs: { envoye: 148, desabonne: 3, sans_telephone: 6 },
  paniers: { relances: { envoye: 21 }, fermesATemps: 7, enAttente: 4 },
};
/** Ce que les envois ont rapporté sur 30 jours (étape 9), en euros : une ligne par automation (décision 32). */
const VENTES = {
  periode: { from: '2026-10-17', to: '2026-11-15' },
  reel: {
    totaux: [{ devise: 'EUR', brut: '4862.40', prouve: '2915.80', commandes: 58 }],
    sources: [
      { source: 'campagne', campaignId: 'k-automne', nom: 'Collection automne', devise: 'EUR', brut: '2740.10', prouve: '1820.60', commandes: 31 },
      { source: 'relance_panier', campaignId: null, nom: null, devise: 'EUR', brut: '1395.20', prouve: '1095.20', commandes: 17 },
      { source: 'agent', campaignId: null, nom: null, devise: 'EUR', brut: '414.70', prouve: '0', commandes: 6 },
      { source: 'commande_payee', campaignId: null, nom: null, devise: 'EUR', brut: '312.40', prouve: '0', commandes: 4 },
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
    coutCumule: Math.round(222.2 * ((i + 1) / 30) * 100) / 100,
  })),
  depense: 222.2, ramene: '4862.40', prouve: '2915.80', roiPct: 2088, ia: 18.4, estime: true, partiel: false,
  autresDevises: [],
  sources: [
    { source: 'campagne', campaignId: 'k-automne', nom: 'Collection automne', cout: 148.2, brut: '2740.10', roiPct: 1749, partiel: false },
    { source: 'relance_panier', campaignId: null, nom: null, cout: 46, brut: '1395.20', roiPct: 2933, partiel: false },
    { source: 'agent', campaignId: null, nom: null, cout: 18.4, brut: '414.70', roiPct: 2154, partiel: false },
    { source: 'commande_payee', campaignId: null, nom: null, cout: 9.6, brut: '312.40', roiPct: 3154, partiel: false },
  ],
  autres: null,
};
/** Le suivi des commandes (étape 10) : la boutique branchée le 3 octobre. */
const SEGMENTS = { boutique: { devise: 'EUR', commandesDepuis: '2026-10-03T10:00:00.000Z', coupeeLe: null }, activiteCompleteDepuis: '2026-10-03' };
const APERCU = { abonnes: 412, sansTelephone: 57, dejaDansLEspace: 38, nouveaux: 317, placesLibres: 4812, importables: 317, complet: true };

/** Le scénario du panier (étapes 5 et 6) : son premier message verrouillé, une Attente d'un jour, puis un rappel. */
const PANIER = {
  fr: {
    nom: 'Panier abandonné',
    relance: 'Bonjour, vous avez laissé des articles dans votre panier. Il vous attend ici : {{1}} À très vite ! Répondez STOP pour ne plus recevoir ces messages.',
    rappel: 'Votre panier vous attend toujours : {{1}} Une question ? Répondez-nous ici. Répondez STOP pour ne plus recevoir ces messages.',
  },
  en: {
    nom: 'Abandoned checkout',
    relance: 'Hello, you left items in your cart. It is waiting for you here: {{1}} See you soon! Reply STOP to stop these messages.',
    rappel: 'Your cart is still waiting for you: {{1}} A question? Reply to us here. Reply STOP to stop these messages.',
  },
} as const;
const LIEN_DU_PANIER = [{ position: 1, source: { type: 'variable', key: 'checkout_url' } }];
const modele = (locale: Locale, name: string, body: string) => ({
  id: `tpl-${name}`, name, status: 'APPROVED', category: 'MARKETING', language: locale, body, headerFormat: null,
  isCarousel: false, editable: true, buttons: [],
});

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
        if (chemin.endsWith('/automations')) return json({ automations: [] });
        if (chemin.endsWith('/workflows')) return json({ workflows: [] });
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

      // 1. Les intégrations de Tools > Intégrations, et la carte Shopify sans boutique.
      await capturer(page, CLE, 1, locale, page.getByTestId('integrations'), 'haut', carte.getByRole('heading', { name: 'Shopify' }));

      // 2. Le mode opératoire chez Shopify, l'adresse et les droits copiables d'un clic.
      await capturer(page, CLE, 2, locale, carte.getByTestId('shopify-mode-operatoire'), 'haut', carte.getByTestId('shopify-copier-adresse'));

      // 3. Les clés collées (inventées), juste avant « Brancher la boutique ». Rien n'est branché.
      await carte.getByTestId('shopify-boutique').fill('votre-marque.myshopify.com');
      await carte.getByTestId('shopify-client-id').fill('3f9c2e71a8b54d06');
      await carte.getByTestId('shopify-secret').fill('demo-secret-invente');
      await carte.getByTestId('shopify-attestation-case').check();
      const valider = carte.getByTestId('shopify-brancher-valider');
      await expect(valider).toBeEnabled();
      await capturer(page, CLE, 3, locale, valider, 'bas', valider);

      // 4. Scénario > Automation > Shopify, sa page : trois automations, leur état, l'interrupteur de celle qui n'existe pas
      // encore.
      etat = AUTOMATIONS;
      await page.goto('/automations/shopify');
      const section = page.getByTestId('automations-shopify');
      await expect(section.getByTestId('automations-shopify-etat-order_fulfilled')).toBeVisible();
      await capturer(page, CLE, 4, locale, section, 'haut', section.getByTestId('automations-shopify-interrupteur-order_fulfilled'));

      // 7. L'import des clients abonnés : le compte d'abord, puis combien en importer. Rien n'est importé.
      etat = EN_SERVICE;
      await page.goto('/integrations');
      await page.getByTestId('integration-shopify-importer').click();
      const apercu = page.getByTestId('shopify-import-apercu');
      await expect(apercu).toBeVisible();
      await capturer(page, CLE, 7, locale, apercu, 'haut', page.getByTestId('shopify-import-nombre'));

      // 8. La boutique branchée : ses chiffres, la pause, et « Couper ».
      await page.goto('/integrations');
      await expect(carte.getByTestId('integration-shopify-compteurs')).toBeVisible();
      await capturer(page, CLE, 8, locale, carte, 'haut', carte.getByTestId('integration-shopify-pause-interrupteur'));

      // 9. Performance Lab > Quantitatif > Shopify : le chiffre, sa part prouvée, le coût et le ROI par source.
      await page.goto('/dashboard/shopify');
      await expect(page.getByTestId('ventes-total-EUR')).toBeVisible();
      await capturer(page, CLE, 9, locale, undefined, 'haut', page.getByTestId('ventes-total-EUR'));

      // 10. Contacts, les filtres « Achats et activité » : au moins 2 commandes en 90 jours.
      await page.goto('/contacts');
      await page.getByTestId('contacts-toggle-filters').click();
      await page.getByTestId('filtre-commandes-min').fill('2');
      await page.getByTestId('filtre-commandes-jours').fill('90');
      const achats = page.getByTestId('filtres-achats');
      await expect(page.getByTestId('filtres-achats-suivi')).toBeVisible();
      await capturer(page, CLE, 10, locale, achats, 'haut', page.getByTestId('filtre-commandes-min'));

      // 5 et 6, en dernier : les faux de l'éditeur passent devant tous ceux d'au-dessus.
      const p = PANIER[locale];
      const relance = modele(locale, 'relance_panier', p.relance);
      const rappel = modele(locale, 'rappel_panier', p.rappel);
      const envoi = (id: string, y: number, t: typeof relance, verrouille: boolean) => bloc(id, 'template', 0, y, {
        templateName: t.name, language: locale, templateButtons: [], variables: LIEN_DU_PANIER, ...(verrouille ? { verrouille: true } : {}),
      });
      const graphe: Graphe = {
        nodes: [envoi('n1', 0, relance, true), bloc('n2', 'wait', 0, 260, { delay: 1, unit: 'days' }), envoi('n3', 420, rappel, false)],
        edges: [fleche('e1', 'n1', 'n2'), fleche('e2', 'n2', 'n3')],
      };
      const scenario = {
        id: 'wf1', name: p.nom, rayon: 'shopify', graph: graphe, draftGraph: graphe,
        createdAt: '2026-11-19T09:00:00.000Z', updatedAt: '2026-11-19T09:00:00.000Z',
      };
      const lu = (filtre: (url: string) => boolean, reponse: unknown): Reponse => [(url, methode) => methode === 'GET' && filtre(url), reponse];
      await simulerEditeur(page, graphe, p.nom, [relance, rappel], [], [
        lu((u) => /\/workflows\/wf1\/modeles$/.test(u), { modeles: [], programmee: null }),
        lu((u) => /\/workflows\/wf1$/.test(u), { workflow: scenario }),
        lu((u) => u.split('?')[0]!.endsWith('/workflows'), { workflows: [] }),
        lu((u) => u.includes('/integrations/shopify'), {
          ...EN_SERVICE, lignes: [ligne('checkout_abandoned', { workflowId: 'wf1', scenario: p.nom, modele: 'relance_panier', langue: locale, blocs: 3 })],
        }),
        lu((u) => /\/nodes(\?|$)/.test(u), { nodes: [] }),
      ]);
      await ouvrir(page);
      await expect(page.getByTestId('panneau-premier-bloc')).toBeVisible();

      // 5. Le premier message : son template, et sa variable reliée au lien du panier (une donnée Shopify).
      const variable = page.getByTestId('template-node-variable-1');
      await expect(variable).toHaveValue('var:checkout_url');
      await centrer(variable);
      await capturer(page, CLE, 5, locale, undefined, 'haut', variable, true);

      // 6. La suite, sur la toile : une Attente d'un jour, puis un rappel.
      await fermerPanneau(page);
      await capturer(page, CLE, 6, locale, undefined, 'haut', page.locator('.react-flow__node[data-id="n2"]'), true);
    });
  });
}
