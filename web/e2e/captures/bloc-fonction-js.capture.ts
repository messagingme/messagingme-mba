import { test } from '../aide/test';
import { CHAMPS_DEMO, NAVIGATEUR, langue, type Locale } from './donnees-demo';
import { bloc, etapeFlechee, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, sur, type Graphe } from './editeur-demo';

/** « Le bloc Fonction JS » (lot 3) : le statut d'une commande tiré de la réponse d'un Appel API. */
const CLE = 'bloc-fonction-js';
const L = {
  fr: { reponse: 'Réponse commande', statut: 'Statut commande', suite: 'Votre commande est : {{statut_commande}}.', nom: 'Suivi de commande', essai: '{"statut":"expédiée"}' },
  en: { reponse: 'Order answer', statut: 'Order status', suite: 'Your order is: {{statut_commande}}.', nom: 'Order tracking', essai: '{"statut":"shipped"}' },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      const graphe: Graphe = {
        nodes: [
          bloc('n1', 'js', 0, 0, { js: 'return JSON.parse(valeur).statut;', champSource: 'reponse_commande', champCible: 'statut_commande' }),
          bloc('n2', 'quick_message', 0, 240, { body: l.suite }),
        ],
        edges: [fleche('e1', 'n1', 'n2')],
      };
      const champs = [...CHAMPS_DEMO, { key: 'reponse_commande', label: l.reponse, type: 'json' }, { key: 'statut_commande', label: l.statut, type: 'text' }];
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom, [], [], [
        [(url, methode) => methode === 'POST' && url.includes('/js-test'), { ok: true, valeur: JSON.parse(l.essai).statut }],
        sur('/user-fields/usage', { total: 0, parChamp: {} }),
        sur('/user-fields', { fields: champs }),
      ]);
      await ouvrir(page);

      await etapeFlechee(page, CLE, 1, locale, page.getByTestId('js-node-source'));
      await etapeFlechee(page, CLE, 2, locale, page.getByTestId('js-node-code'));
      await page.getByTestId('js-node-valeur-essai').fill(l.essai);
      await page.getByTestId('js-node-essayer').click();
      await page.getByTestId('js-node-resultat').waitFor();
      await etapeFlechee(page, CLE, 3, locale, page.getByTestId('js-node-essayer'));
      await etapeFlechee(page, CLE, 4, locale, page.getByTestId('js-node-cible'));
      await fermerPanneau(page);
      await etapeFlechee(page, CLE, 5, locale, poignee(page, 'libre'));
    });
  });
}
