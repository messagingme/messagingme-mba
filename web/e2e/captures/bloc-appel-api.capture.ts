import { test } from '../aide/test';
import { CHAMPS_DEMO, NAVIGATEUR, langue, type Locale } from './donnees-demo';
import { appelsDemo, bloc, etapeFlechee, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, sur, type Graphe } from './editeur-demo';

/** « Le bloc Appel API » (lot 3) : le statut d'une commande, demandé à la boutique. */
const CLE = 'bloc-appel-api';
const L = {
  fr: { appel: 'Statut de commande', systeme: 'Boutique', reponse: 'Réponse commande', suite: 'Je regarde votre commande…', nom: 'Suivi de commande' },
  en: { appel: 'Order status', systeme: 'Shop', reponse: 'Order answer', suite: 'Let me check your order…', nom: 'Order tracking' },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      const graphe: Graphe = {
        nodes: [
          bloc('n1', 'http', 0, 0, { requestId: 'req1', requeteLabel: l.appel, champCible: 'reponse_commande' }),
          bloc('n2', 'quick_message', 0, 240, { body: l.suite }),
        ],
        edges: [fleche('e1', 'n1', 'n2')],
      };
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom, [], [], [
        ...appelsDemo(l.appel, l.systeme),
        sur('/user-fields/usage', { total: 0, parChamp: {} }),
        sur('/user-fields', { fields: [...CHAMPS_DEMO, { key: 'reponse_commande', label: l.reponse, type: 'json' }] }),
      ]);
      await ouvrir(page);

      await etapeFlechee(page, CLE, 1, locale, page.getByTestId('http-node-requete'));
      await etapeFlechee(page, CLE, 2, locale, page.getByTestId('http-node-champ'));
      await fermerPanneau(page);
      await etapeFlechee(page, CLE, 3, locale, poignee(page, 'libre'));
    });
  });
}
