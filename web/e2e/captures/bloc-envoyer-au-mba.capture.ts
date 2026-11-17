import { test } from '../aide/test';
import { NAVIGATEUR, langue, type Locale } from './donnees-demo';
import { bloc, etapeFlechee, fermerPanneau, fleche, ouvrir, simulerEditeur, type Graphe } from './editeur-demo';

/** « Le bloc Envoyer au MBA » (lot 3) : « posez-nous votre question », puis l'agent de Meta. Il est éteint ici. */
const CLE = 'bloc-envoyer-au-mba';
const L = {
  fr: { message: 'Posez-nous votre question, nous vous répondons tout de suite.', nom: 'Questions' },
  en: { message: 'Ask us your question, we answer right away.', nom: 'Questions' },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      const graphe: Graphe = {
        nodes: [bloc('n1', 'vers_mba', 380, 40, {}), bloc('n0', 'quick_message', 0, 40, { body: l.message })],
        edges: [fleche('e1', 'n0', 'n1')],
      };
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom);
      await ouvrir(page);

      // 1. Le bloc sur la toile, sans sortie ; 2. le panneau qui prévient que l'agent de Meta est éteint.
      const panneauEteint = page.getByTestId('vers-mba-eteint');
      await fermerPanneau(page);
      await etapeFlechee(page, CLE, 1, locale, page.locator('.react-flow__node').first());
      await page.locator('.react-flow__node').first().click();
      await etapeFlechee(page, CLE, 2, locale, panneauEteint);
    });
  });
}
