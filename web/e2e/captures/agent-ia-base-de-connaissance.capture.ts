import { test, expect } from '../aide/test';
import { NAVIGATEUR, capturer, communs, langue, type Locale } from './donnees-demo';
import { AG, TEXTES, agentDemo, offreBusiness, simulerAgent, type EtatDemo } from './agent-ia-demo';

/**
 * « Remplir la base de connaissance d'un agent IA » : le site (l'adresse notée par l'assistant, puis l'aperçu), un
 * document, une fiche à la main, un fichier joint à l'assistant, et le tableau des fiches. Les formes sont celles de
 * `web/e2e/agents-connaissance.spec.ts` et `agents-construction.spec.ts`. Rien n'est lu sur un vrai site.
 */
const CLE = 'agent-ia-base-de-connaissance';
const JOUR = 86_400_000;
const ilYa = (jours: number) => new Date(Date.now() - jours * JOUR).toISOString();

const D = {
  fr: {
    pages: ['', '/collection-automne', '/guide-des-tailles', '/livraison-et-retours', '/boutiques', '/contact'],
    ecartee: 'adresse hors du site',
    csv: 'grille-tailles.csv',
    titre: 'Les retouches en boutique',
    corps: 'Les ourlets de pantalon sont faits en boutique, gratuitement, sous 48 heures. Les autres retouches sont sur devis.',
    image: 'tarifs-retouches.png',
    titresImage: ['Ourlet', 'Reprise de taille', 'Changement de fermeture'],
    entretien: [
      { role: 'user', content: 'Il répond aux questions sur notre collection et nos commandes.' },
      { role: 'assistant', content: 'D’accord. D’où viennent ses réponses de fond : votre site, un catalogue, une grille de tarifs ?' },
    ],
    reponse: 'Merci : j’ai bien noté vos tarifs de retouche, ils sont dans la base de connaissance. Passons à la suite : quand l’agent doit-il passer la main à un humain ?',
    fiches: [
      { id: 'f1', titre: 'Livraison en 48 heures', corps: 'Toute commande passée avant 14 heures part le jour même, et arrive en 48 heures en France métropolitaine.', source: { type: 'page', url: 'https://votre-marque.test/livraison-et-retours' }, sourceUrl: 'https://votre-marque.test/livraison-et-retours', derniereLectureAt: ilYa(6), updatedAt: ilYa(6) },
      { id: 'f2', titre: 'Retours gratuits sous 30 jours', corps: 'Vous avez 30 jours pour retourner un article, gratuitement, en boutique ou par la poste avec l’étiquette jointe au colis.', source: { type: 'page', url: 'https://votre-marque.test/livraison-et-retours' }, sourceUrl: 'https://votre-marque.test/livraison-et-retours', derniereLectureAt: ilYa(6), updatedAt: ilYa(6) },
      { id: 'f3', titre: 'Les boutiques et leurs horaires', corps: 'Lyon, Paris et Bordeaux, du mardi au samedi de 10 heures à 19 heures.', source: { type: 'page', url: 'https://votre-marque.test/boutiques' }, sourceUrl: 'https://votre-marque.test/boutiques', derniereLectureAt: ilYa(120), updatedAt: ilYa(120) },
      { id: 'f4', titre: 'Taille, tour de poitrine, tour de taille (lignes 1 à 8)', corps: 'Taille;Poitrine;Taille\n34;80;62\n36;84;66\n38;88;70\n40;92;74', source: { type: 'document', nom: 'grille-tailles.csv' }, sourceUrl: null, derniereLectureAt: ilYa(2), updatedAt: ilYa(2) },
      { id: 'f5', titre: 'Les retouches en boutique', corps: 'Les ourlets de pantalon sont faits en boutique, gratuitement, sous 48 heures. Les autres retouches sont sur devis.', source: { type: 'manuel' }, sourceUrl: null, derniereLectureAt: null, updatedAt: ilYa(1) },
    ],
  },
  en: {
    pages: ['', '/autumn-collection', '/size-guide', '/delivery-and-returns', '/stores', '/contact'],
    ecartee: 'address outside the site',
    csv: 'size-chart.csv',
    titre: 'Alterations in store',
    corps: 'Trouser hems are done in store, free of charge, within 48 hours. Other alterations are quoted.',
    image: 'alteration-prices.png',
    titresImage: ['Hem', 'Waist adjustment', 'Zip replacement'],
    entretien: [
      { role: 'user', content: 'It answers questions about our collection and orders.' },
      { role: 'assistant', content: 'All right. Where do its substantive answers come from: your website, a catalogue, a price list?' },
    ],
    reponse: 'Thank you: I have your alteration prices, they are in the knowledge base. Next: when must the agent hand over to a human?',
    fiches: [
      { id: 'f1', titre: 'Delivery in 48 hours', corps: 'Any order placed before 2 pm ships the same day, and arrives within 48 hours in mainland France.', source: { type: 'page', url: 'https://your-brand.test/delivery-and-returns' }, sourceUrl: 'https://your-brand.test/delivery-and-returns', derniereLectureAt: ilYa(6), updatedAt: ilYa(6) },
      { id: 'f2', titre: 'Free returns within 30 days', corps: 'You have 30 days to return an item, free of charge, in store or by post with the label in the parcel.', source: { type: 'page', url: 'https://your-brand.test/delivery-and-returns' }, sourceUrl: 'https://your-brand.test/delivery-and-returns', derniereLectureAt: ilYa(6), updatedAt: ilYa(6) },
      { id: 'f3', titre: 'Our stores and their opening hours', corps: 'Lyon, Paris and Bordeaux, Tuesday to Saturday from 10 am to 7 pm.', source: { type: 'page', url: 'https://your-brand.test/stores' }, sourceUrl: 'https://your-brand.test/stores', derniereLectureAt: ilYa(120), updatedAt: ilYa(120) },
      { id: 'f4', titre: 'Size, bust, waist (rows 1 to 8)', corps: 'Size;Bust;Waist\n34;80;62\n36;84;66\n38;88;70\n40;92;74', source: { type: 'document', nom: 'size-chart.csv' }, sourceUrl: null, derniereLectureAt: ilYa(2), updatedAt: ilYa(2) },
      { id: 'f5', titre: 'Alterations in store', corps: 'Trouser hems are done in store, free of charge, within 48 hours. Other alterations are quoted.', source: { type: 'manuel' }, sourceUrl: null, derniereLectureAt: null, updatedAt: ilYa(1) },
    ],
  },
} as const;

/** Un PNG d'un pixel : le contenu ne compte pas, la réponse de l'import est simulée. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use(NAVIGATEUR[locale]);

    test(`${CLE} (${locale}) : l'onglet Base de connaissance`, async ({ page }) => {
      const d = D[locale];
      const site = TEXTES[locale].site;
      const etat: EtatDemo = {
        locale, agent: agentDemo(locale), suggestion: site, fiches: [],
        manques: [{ onglet: 'connaissance', message: locale === 'fr'
          ? 'La base de connaissance est vide : l’agent transférerait toutes les questions de fond.'
          : 'The knowledge base is empty: the agent would hand over every substantive question.' }],
        apercu: {
          url: site, portee: 'site', plafondAtteint: false, tempsAtteint: false,
          ecartees: [{ url: 'https://exemple.test/partenaire', raison: d.ecartee }],
          pages: d.pages.map((p, i) => ({ url: `${site}${p}`, fiches: [4, 7, 3, 5, 2, 1][i], caracteres: [5200, 9800, 3100, 6400, 1900, 700][i] })),
        },
        document: { nom: d.csv, nature: 'csv', ecrites: 8, retirees: 0, plafond: 40 },
      };
      await langue(page, locale);
      await simulerAgent(page, etat);
      await communs(page);

      // 1. L'adresse notée par l'assistant, déjà dans le champ, juste avant « Voir ce qui sera importé ».
      await page.goto(`/agents?id=${AG}&tab=connaissance`);
      await expect(page.getByTestId('kb-url-suggeree')).toBeVisible();
      await expect(page.getByTestId('kb-url')).toHaveValue(site);
      await capturer(page, CLE, 1, locale, page.getByTestId('kb-url-suggeree'), 'haut', page.getByTestId('kb-importer'));

      // 2. L'aperçu : six pages lisibles, une adresse écartée, juste avant « Importer ces 6 pages ». Rien n'est importé.
      await page.getByTestId('kb-importer').click();
      await expect(page.getByTestId('kb-apercu')).toBeVisible();
      await capturer(page, CLE, 2, locale, page.getByTestId('kb-apercu'), 'haut', page.getByTestId('kb-confirmer'));

      // 3. Un CSV déposé : le bilan de l'import, au-dessus des cartes.
      await page.goto(`/agents?id=${AG}&tab=connaissance`);
      await page.getByTestId('kb-document-fichier').setInputFiles({ name: d.csv, mimeType: 'text/csv', buffer: Buffer.from('Taille;Poitrine\n34;80\n') });
      await expect(page.getByTestId('kb-bilan')).toBeVisible();
      await capturer(page, CLE, 3, locale, page.getByTestId('kb-bilan'), 'haut', page.getByTestId('kb-document'));

      // 4. Une fiche écrite à la main, juste avant « Ajouter la fiche ».
      await page.goto(`/agents?id=${AG}&tab=connaissance`);
      await page.getByTestId('kb-nouveau-titre').fill(d.titre);
      await page.getByTestId('kb-nouveau-corps').fill(d.corps);
      await capturer(page, CLE, 4, locale, page.getByTestId('kb-ajouter'), 'bas', page.getByTestId('kb-ajouter'));

      // 6. Le tableau des fiches : la provenance, une fiche « À relire », une fiche ouverte pour être corrigée.
      etat.fiches = [...d.fiches];
      etat.manques = [];
      await page.goto(`/agents?id=${AG}&tab=connaissance`);
      await expect(page.getByTestId('kb-tableau')).toBeVisible();
      await page.getByTestId('kb-ouvrir-f5').click();
      await expect(page.getByTestId('kb-fiche-f5')).toBeVisible();
      await capturer(page, CLE, 6, locale, page.getByTestId('kb-tableau'), 'haut', page.getByTestId('kb-perimee-f3'));
    });

    test(`${CLE} (${locale}) : un fichier joint à l'assistant`, async ({ page }) => {
      const d = D[locale];
      const etat: EtatDemo = {
        locale, agent: agentDemo(locale),
        entretien: { messages: [...d.entretien] as Array<{ role: 'user' | 'assistant'; content: string }>, manquants: ['humain', 'identite'] },
        pieceJointe: { fiches: 3, titres: [...d.titresImage], nature: 'image', plafond: 40 },
        reponseEntretien: { message: d.reponse, proposition: null, changements: [], couverture: { manquants: ['humain', 'identite'], total: 10, pointOuvert: null } },
      };
      await langue(page, locale);
      await simulerAgent(page, etat);
      await communs(page);
      await offreBusiness(page);

      // 5. La photo d'une grille de tarifs jointe : l'assistant dit combien de fiches elle a données.
      await page.goto(`/agents?id=${AG}&tab=construction`);
      await expect(page.getByTestId('setup-tour-assistant').first()).toBeVisible();
      await page.getByTestId('setup-fichier').setInputFiles({ name: d.image, mimeType: 'image/png', buffer: PIXEL });
      await expect(page.getByTestId('setup-tour-assistant')).toHaveCount(2);
      await page.waitForTimeout(800);
      await capturer(page, CLE, 5, locale, page.getByTestId('setup-saisie'), 'bas', page.getByTestId('setup-joindre'));
    });
  });
}
