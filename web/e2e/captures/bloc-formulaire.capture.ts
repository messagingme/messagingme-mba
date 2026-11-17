import { test } from '../aide/test';
import { NAVIGATEUR, langue, type Locale } from './donnees-demo';
import { bloc, etapeFlechee, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, sur, type Graphe } from './editeur-demo';

/** « Le bloc Formulaire » (spec `2026-11-17-fiches-par-bloc-design.md`, lot 3) : une demande de devis par formulaire. */
const CLE = 'bloc-formulaire';
const L = {
  fr: { form: 'Demande de devis', accroche: 'Remplissez ce formulaire, une minute suffit.', cta: 'Ouvrir', merci: 'Merci, nous revenons vers vous.', aide: 'Besoin d’aide ? Écrivez-nous ici.', email: 'E-mail', ville: 'Ville' },
  en: { form: 'Quote request', accroche: 'Fill in this form, it takes a minute.', cta: 'Open', merci: 'Thank you, we will get back to you.', aide: 'Need help? Write to us here.', email: 'Email', ville: 'City' },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      const graphe: Graphe = {
        nodes: [
          bloc('n1', 'flow', 0, 40, { flowId: 'f1', flowName: l.form, body: l.accroche, cta: l.cta, rangement: {} }),
          bloc('n2', 'quick_message', 360, -20, { body: l.merci }),
          bloc('n3', 'quick_message', 360, 140, { body: l.aide }),
        ],
        edges: [fleche('e1', 'n1', 'n2', 'rempli'), fleche('e2', 'n1', 'n3')],
      };
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.form, [], [], [
        sur('/sorties', { source: 'messagingme', sorties: [{ cle: 'email', libelle: l.email, cible: 'email' }, { cle: 'ville', libelle: l.ville, cible: 'ville' }] }),
        sur('/flows', { flows: [{ id: 'f1', name: l.form, status: 'PUBLISHED', fields: [], cta: l.cta, createdAt: '2026-11-01T09:00:00.000Z' }] }),
      ]);
      await ouvrir(page);

      await etapeFlechee(page, CLE, 1, locale, page.locator('select', { has: page.locator('option', { hasText: l.form }) }));
      await etapeFlechee(page, CLE, 2, locale, page.getByPlaceholder(locale === 'fr' ? /Défaut : « Formulaire/ : /Default: “Form/));
      await etapeFlechee(page, CLE, 3, locale, page.getByTestId('formulaire-rangement'));
      await fermerPanneau(page);
      await etapeFlechee(page, CLE, 4, locale, poignee(page, 'rempli'));
      await etapeFlechee(page, CLE, 5, locale, poignee(page, 'libre'));
    });
  });
}
