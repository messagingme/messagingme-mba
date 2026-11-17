import { test } from '../aide/test';
import { CHAMPS_DEMO, NAVIGATEUR, langue, type Locale } from './donnees-demo';
import { bloc, etapeFlechee, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, sur, type Graphe } from './editeur-demo';

/** « Le bloc Envoi de mail » (lot 3) : la confirmation d'un devis, à la cliente et au service commercial. */
const CLE = 'bloc-envoi-de-mail';
const L = {
  fr: { boite: 'Service client', modele: 'Confirmation de devis', sujet: 'Votre devis', suite: 'Votre devis vient de partir par e-mail.', nom: 'Devis' },
  en: { boite: 'Customer service', modele: 'Quote confirmation', sujet: 'Your quote', suite: 'Your quote has just been sent by email.', nom: 'Quote' },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      const graphe: Graphe = {
        nodes: [
          bloc('n1', 'email', 0, 0, { emailAccountId: 'acc1', templateId: 'tpl1', to: [{ kind: 'field', field: 'email' }, { kind: 'literal', value: 'commercial@votre-marque.test' }] }),
          bloc('n2', 'quick_message', 0, 240, { body: l.suite }),
        ],
        edges: [fleche('e1', 'n1', 'n2')],
      };
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom, [], [], [
        sur('/email/accounts', { accounts: [{ id: 'acc1', label: l.boite, host: 'smtp.votre-marque.test', port: 587, secure: false, username: 'contact', fromAddress: 'contact@votre-marque.test', fromName: 'Votre marque', replyTo: null, verifiedAt: '2026-11-01T09:00:00.000Z', createdAt: '2026-11-01T09:00:00.000Z', hasPassword: true }] }),
        sur('/email/templates', { templates: [{ id: 'tpl1', name: l.modele, format: 'basic', subject: l.sujet, body: '…', createdAt: '2026-11-01T09:00:00.000Z', updatedAt: '2026-11-01T09:00:00.000Z' }] }),
        sur('/user-fields/usage', { total: 40, parChamp: { email: 31, ville: 38 } }),
        sur('/user-fields', { fields: [{ key: 'email', label: 'Email', type: 'text' }, ...CHAMPS_DEMO] }),
      ]);
      await ouvrir(page);

      await etapeFlechee(page, CLE, 1, locale, page.getByTestId('email-account-select'));
      await etapeFlechee(page, CLE, 2, locale, page.getByTestId('email-recipient-row-0'));
      await fermerPanneau(page);
      await etapeFlechee(page, CLE, 3, locale, poignee(page, 'libre'));
    });
  });
}
