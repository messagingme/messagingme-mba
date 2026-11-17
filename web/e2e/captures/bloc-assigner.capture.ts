import { test } from '../aide/test';
import { NAVIGATEUR, langue, type Locale } from './donnees-demo';
import { bloc, etapeFlechee, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, sur, type Graphe } from './editeur-demo';

/** « Le bloc Assigner à un agent » (lot 3) : un message, puis la conversation confiée à un conseiller. */
const CLE = 'bloc-assigner';
const L = {
  fr: { message: 'Un conseiller vous répond dans quelques minutes.', nom: 'Service client' },
  en: { message: 'An advisor will answer you in a few minutes.', nom: 'Customer service' },
} as const;
const membre = (id: string, name: string, email: string, role: string) =>
  ({ id, email, name, role, disabled: false, pending: false, createdAt: '2026-10-01T09:00:00.000Z', lastLoginAt: null });

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      // Le bloc Assigner en PREMIER du tableau : c'est lui qu'ouvre `ouvrir` et que vise `poignee`.
      const graphe: Graphe = {
        nodes: [
          bloc('n1', 'inbox', 380, 40, { assigneA: 'u2', assigneNom: 'Karim Benali' }),
          bloc('n0', 'quick_message', 0, 40, { body: l.message }),
        ],
        edges: [fleche('e1', 'n0', 'n1')],
      };
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom, [], [], [
        sur('/users', { users: [membre('u1', 'Léa Martin', 'lea@votre-marque.test', 'admin'), membre('u2', 'Karim Benali', 'karim@votre-marque.test', 'agent')] }),
      ]);
      await ouvrir(page);

      await etapeFlechee(page, CLE, 1, locale, page.getByTestId('inbox-node-assignee'));
      await fermerPanneau(page);
      await etapeFlechee(page, CLE, 2, locale, poignee(page, 'libre'));
    });
  });
}
