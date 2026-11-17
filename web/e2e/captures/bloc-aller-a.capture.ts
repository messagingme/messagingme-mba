import { test } from '../aide/test';
import { NAVIGATEUR, langue, type Locale } from './donnees-demo';
import { bloc, etapeFlechee, fermerPanneau, fleche, ouvrir, simulerEditeur, sur, type Graphe } from './editeur-demo';

/** « Le bloc Aller à » (lot 3) : après une réponse, retour à la question du scénario « Menu principal ». */
const CLE = 'bloc-aller-a';
const CIBLE = 'nod_demo_01JD3K8Z9Q4X7V2M5N6P8R0T5A';
const L = {
  fr: { menu: 'Menu principal', question: 'Que souhaitez-vous faire ?', merci: 'C’est noté, merci !', nom: 'Après-vente' },
  en: { menu: 'Main menu', question: 'What would you like to do?', merci: 'Noted, thank you!', nom: 'After-sales' },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      const graphe: Graphe = {
        nodes: [
          bloc('n1', 'aller_a', 380, 40, { cible: CIBLE, cibleLibelle: `${l.menu}, Question` }),
          bloc('n0', 'quick_message', 0, 40, { body: l.merci }),
        ],
        edges: [fleche('e1', 'n0', 'n1')],
      };
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom, [], [], [
        sur('/nodes', { nodes: [{ code: CIBLE, type: 'question', name: 'Question', workflowId: 'wf2', workflowName: l.menu, summary: l.question }] }),
      ], [{ id: 'wf2', name: l.menu }]);
      await ouvrir(page);

      await etapeFlechee(page, CLE, 1, locale, page.getByTestId('aller-a-scenario'));
      await etapeFlechee(page, CLE, 2, locale, page.getByTestId('aller-a-bloc'));
      await fermerPanneau(page);
      await etapeFlechee(page, CLE, 3, locale, page.locator('.react-flow__node').first());
    });
  });
}
