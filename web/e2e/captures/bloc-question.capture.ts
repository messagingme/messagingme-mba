import { test } from '../aide/test';
import { NAVIGATEUR, capturer, langue, type Locale } from './donnees-demo';
import { bloc, centrer, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, type Graphe } from './editeur-demo';

/**
 * « Le bloc Question » (spec `2026-11-17-fiches-par-bloc-design.md`, lot 2) : la taille d'une commande, choisie dans un
 * menu et rangée dans le champ « Taille », avec une relance après deux jours sans réponse.
 */
const CLE = 'bloc-question';

const L = {
  fr: {
    question: 'Quelle taille souhaitez-vous pour votre commande ?', bouton: 'Choisir ma taille',
    lignes: [['S', '36 à 38'], ['M', '40 à 42'], ['L', '44 à 46']], merci: 'Parfait, c’est noté !', nom: 'Taille',
  },
  en: {
    question: 'Which size would you like for your order?', bouton: 'Pick my size',
    lignes: [['S', 'UK 8 to 10'], ['M', 'UK 12 to 14'], ['L', 'UK 16 to 18']], merci: 'Great, noted!', nom: 'Size',
  },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      const graphe: Graphe = {
        nodes: [
          bloc('n1', 'question', 0, 40, {
            body: l.question, buttonLabel: l.bouton, rows: l.lignes.map(([title, description]) => ({ title, description })),
            champReponse: 'taille', rangerLigne: true, timeoutValue: 2, timeoutUnit: 'days',
          }),
          bloc('n2', 'quick_message', 380, -10, { body: l.merci }),
          bloc('n3', 'action', 380, 200, { actionKind: 'add_tag', tag: 'sans-reponse' }),
        ],
        edges: [
          fleche('e1', 'n1', 'n2', 'row:0'), fleche('e2', 'n1', 'n2', 'row:1'), fleche('e3', 'n1', 'n2', 'row:2'),
          fleche('e4', 'n1', 'n3', 'timeout'),
        ],
      };
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom);
      await ouvrir(page);

      const etape = async (n: number, cible: ReturnType<typeof page.getByTestId>) => {
        await centrer(cible);
        await capturer(page, CLE, n, locale, undefined, 'haut', cible, true);
      };
      // 1 à 5. Le panneau, de haut en bas.
      await etape(1, page.getByTestId('question-node-body'));
      await etape(2, page.getByTestId('question-add-row'));
      await etape(3, page.getByTestId('question-node-champ'));
      await etape(4, page.locator('label', { has: page.getByTestId('question-node-attendre-fichier') }));
      await etape(5, page.getByTestId('question-node-timeout'));
      // 6. Les sorties, sur la toile.
      await fermerPanneau(page);
      await capturer(page, CLE, 6, locale, undefined, 'haut', poignee(page, 'row:1'), true);
    });
  });
}
