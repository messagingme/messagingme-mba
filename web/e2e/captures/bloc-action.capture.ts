import { test } from '../aide/test';
import { NAVIGATEUR, capturer, langue, type Locale } from './donnees-demo';
import { bloc, centrer, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, type Graphe } from './editeur-demo';

/**
 * « Le bloc Action » (spec `2026-11-17-fiches-par-bloc-design.md`, lot 2) : après la réponse du contact, trois actions
 * dans le même bloc : une étiquette, sa ville recopiée de son dernier message, et son accord pour les campagnes.
 */
const CLE = 'bloc-action';
const L = {
  fr: { merci: 'Merci ! Vous recevrez nos prochaines offres.', nom: 'Inscription' },
  en: { merci: 'Thank you! You will receive our next offers.', nom: 'Sign-up' },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      const graphe: Graphe = {
        nodes: [
          // La première action est le bloc lui-même ; les suivantes vivent dans `suite` (`sousActions`).
          bloc('n1', 'action', 0, 0, {
            actionKind: 'add_tag', tag: 'newsletter',
            suite: [
              { actionKind: 'set_field', fieldKey: 'ville', fieldLabel: 'Ville', valueKind: 'derniere_saisie' },
              { actionKind: 'set_optin' },
            ],
          }),
          bloc('n2', 'quick_message', 0, 240, { body: l.merci }),
        ],
        edges: [fleche('e1', 'n1', 'n2')],
      };
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom);
      await ouvrir(page);

      const etape = async (n: number, cible: ReturnType<typeof page.getByTestId>) => {
        await centrer(cible);
        await capturer(page, CLE, n, locale, undefined, 'haut', cible, true);
      };
      // 1 à 4. Le panneau : la liste d'actions, l'étiquette, la valeur du champ, le consentement.
      await etape(1, page.getByTestId('action-kind').first());
      await etape(2, page.getByPlaceholder('vip, prospect…').first());
      await etape(3, page.getByTestId('champ-valeur-nature'));
      await etape(4, page.getByTestId('action-kind').nth(2));
      // 5. La suite, sur la toile.
      await fermerPanneau(page);
      await capturer(page, CLE, 5, locale, undefined, 'haut', poignee(page, 'libre'), true);
    });
  });
}
