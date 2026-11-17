import { test } from '../aide/test';
import { MODELE_AUTOMNE, NAVIGATEUR, langue, type Locale } from './donnees-demo';
import { bloc, etapeFlechee, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, sur, type Graphe } from './editeur-demo';

/** « Le bloc Message RCS » (lot 3) : l'offre d'automne en RCS, avec le template WhatsApp en repli. */
const CLE = 'bloc-message-rcs';
const L = {
  fr: { texte: 'La collection d’automne arrive : -20 % avec le code AUTOMNE20.', oui: 'Je veux', voir: 'Voir', merci: 'Parfait, voici le lien de la collection.', nom: 'Automne RCS' },
  en: { texte: 'The autumn collection is here: 20% off with the code AUTOMNE20.', oui: 'I want it', voir: 'See', merci: 'Great, here is the collection link.', nom: 'Autumn RCS' },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      const graphe: Graphe = {
        nodes: [
          bloc('n1', 'rcs_message', 0, 60, {
            rcsSource: 'libre', text: l.texte, imageUrl: '/demo/automne.jpg',
            suggestions: [
              { kind: 'reply', text: l.oui, postbackData: 'btn_1' },
              { kind: 'openUrl', text: l.voir, url: 'https://votre-marque.test/automne', postbackData: 'btn_2' },
            ],
          }),
          bloc('n2', 'quick_message', 380, -40, { body: l.merci }),
          bloc('n3', 'template', 380, 200, { templateName: MODELE_AUTOMNE.name, language: 'fr', templateButtons: MODELE_AUTOMNE.buttons, variables: [] }),
        ],
        edges: [fleche('e1', 'n1', 'n2', 'btn:0'), fleche('e2', 'n1', 'n3', 'unreachable')],
      };
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom, [MODELE_AUTOMNE], [], [
        sur('/settings', { mbaEnabled: false, rcsEnabled: true, hubspotListsEnabled: false, campaignsPaused: false }),
        sur('/rcs-messages', { messages: [] }),
      ]);
      await ouvrir(page);

      await etapeFlechee(page, CLE, 1, locale, page.getByTestId('rcs-node-source-libre'));
      await etapeFlechee(page, CLE, 2, locale, page.getByTestId('rcs-node-text'));
      await etapeFlechee(page, CLE, 3, locale, page.getByTestId('rcs-node-message-add-button'));
      await fermerPanneau(page);
      await etapeFlechee(page, CLE, 4, locale, poignee(page, 'unreachable'));
      await etapeFlechee(page, CLE, 5, locale, poignee(page, 'sent'));
    });
  });
}
