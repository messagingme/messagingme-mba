import { test } from '../aide/test';
import { CHAMPS_DEMO, NAVIGATEUR, langue, type Locale } from './donnees-demo';
import { appelsDemo, bloc, etapeFlechee, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, sur, type Graphe } from './editeur-demo';

/** « Le bloc Extraire du JSON » (lot 3) : le statut et le nombre d'articles, tirés de la réponse de la boutique. */
const CLE = 'bloc-extraire-du-json';
const L = {
  fr: { appel: 'Statut de commande', systeme: 'Boutique', reponse: 'Réponse commande', statut: 'Statut commande', nb: 'Nombre d’articles', nom: 'Suivi de commande' },
  en: { appel: 'Order status', systeme: 'Shop', reponse: 'Order answer', statut: 'Order status', nb: 'Number of items', nom: 'Order tracking' },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      // L'extraction en PREMIER du tableau (c'est elle qu'ouvre `ouvrir`), derrière l'Appel API qui remplit sa source.
      const graphe: Graphe = {
        nodes: [
          bloc('n1', 'extraire', 0, 240, {
            champSource: 'reponse_commande',
            lignes: [
              { chemin: 'commande.statut', mesure: 'valeur', champCible: 'statut_commande' },
              { chemin: 'articles', mesure: 'nombre', champCible: 'nb_articles' },
            ],
          }),
          bloc('n0', 'http', 0, 0, { requestId: 'req1', requeteLabel: l.appel, champCible: 'reponse_commande' }),
        ],
        edges: [fleche('e1', 'n0', 'n1')],
      };
      const champs = [...CHAMPS_DEMO,
        { key: 'reponse_commande', label: l.reponse, type: 'json' }, { key: 'statut_commande', label: l.statut, type: 'text' },
        { key: 'nb_articles', label: l.nb, type: 'number' }];
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom, [], [], [
        ...appelsDemo(l.appel, l.systeme),
        sur('/user-fields/usage', { total: 0, parChamp: {} }),
        sur('/user-fields', { fields: champs }),
      ]);
      await ouvrir(page);

      await etapeFlechee(page, CLE, 1, locale, page.getByTestId('extraire-source'));
      await etapeFlechee(page, CLE, 2, locale, page.getByTestId('extraire-chemin-0'));
      await etapeFlechee(page, CLE, 3, locale, page.getByTestId('extraire-cible-0'));
      await etapeFlechee(page, CLE, 4, locale, page.getByTestId('extraire-exemple'));
      await fermerPanneau(page);
      await etapeFlechee(page, CLE, 5, locale, poignee(page, 'libre'));
    });
  });
}
