import { test } from '../aide/test';
import { NAVIGATEUR, langue, type Locale } from './donnees-demo';
import { bloc, etapeFlechee, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, sur, type Graphe } from './editeur-demo';

/**
 * « Créer un scénario » (spec `2026-11-17-fiches-par-bloc-design.md`, lot 3) : la liste des scénarios, puis l'éditeur
 * d'une relance de panier. Une capture fléchée par étape de la fiche.
 */
const CLE = 'creer-un-scenario';
const L = {
  fr: {
    nom: 'Relance panier', creer: 'Créer un scénario', corps: 'Votre panier vous attend 🛒 On vous le garde ?',
    reponses: ['Oui, je finalise', 'Non merci'], oui: 'Voici votre panier.', non: 'Pas de souci, à bientôt !',
    autres: ['Commande prête', 'Avis client'], dossier: 'Commandes',
  },
  en: {
    nom: 'Cart reminder', creer: 'Create a scenario', corps: 'Your cart is waiting 🛒 Shall we keep it for you?',
    reponses: ['Yes, I will finish', 'No thanks'], oui: 'Here is your cart.', non: 'No problem, see you soon!',
    autres: ['Order ready', 'Customer review'], dossier: 'Orders',
  },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      const graphe: Graphe = {
        nodes: [
          bloc('n1', 'quick_message', 0, 60, { body: l.corps, quickReplies: [...l.reponses] }),
          bloc('n2', 'quick_message', 360, -10, { body: l.oui }),
          bloc('n3', 'quick_message', 360, 150, { body: l.non }),
        ],
        edges: [fleche('e1', 'n1', 'n2', 'btn:0')],
      };
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom, [], [], [
        sur('/dossiers', { dossiers: [{ id: 'd1', nom: l.dossier }], rangement: { wf1: 'd1', wf2: 'd1' } }),
      ], l.autres.map((name, i) => ({ id: `wf${i + 2}`, name })));

      // 1. Créer le scénario, depuis la liste.
      await page.goto('/workflows');
      await page.getByPlaceholder(locale === 'fr' ? 'Nom du scénario…' : 'Scenario name…').fill(l.nom);
      await etapeFlechee(page, CLE, 1, locale, page.getByRole('button', { name: l.creer }));
      // 2. Poser un bloc ; 3. relier ; 4. essayer ; 5. publier.
      await ouvrir(page, false);
      await etapeFlechee(page, CLE, 2, locale, page.getByTestId('add-node-question'));
      await fermerPanneau(page);
      await etapeFlechee(page, CLE, 3, locale, poignee(page, 'btn:1'));
      await etapeFlechee(page, CLE, 4, locale, page.getByTestId('node-test-n1'));
      // « Publier » n'apparaît qu'avec un brouillon : une modification, comme le ferait le client.
      await page.getByTestId('workflow-autoarrange').click();
      await etapeFlechee(page, CLE, 5, locale, page.getByTestId('workflow-publier'));
      // 6. Ranger, depuis la liste.
      await page.goto('/workflows');
      await etapeFlechee(page, CLE, 6, locale, page.getByTestId('dossier-creer'));
    });
  });
}
