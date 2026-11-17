import { test } from '../aide/test';
import { NAVIGATEUR, capturer, langue, type Locale } from './donnees-demo';
import { bloc, centrer, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, type Graphe } from './editeur-demo';

/**
 * « Le bloc Condition » (spec `2026-11-17-fiches-par-bloc-design.md`, lot 2) : deux familles, les clientes fidèles
 * pendant les heures d'ouverture, puis les contacts de Belgique ou de Suisse, et « Sinon ».
 */
const CLE = 'bloc-condition';
const L = {
  fr: { fideles: 'Clientes fidèles', etranger: 'Belgique ou Suisse', vip: 'Une conseillère vous répond tout de suite.', frontiere: 'Livraison offerte dès 80 €.', autres: 'Voici nos nouveautés.', nom: 'Accueil' },
  en: { fideles: 'Loyal customers', etranger: 'Belgium or Switzerland', vip: 'An advisor answers you right away.', frontiere: 'Free delivery from €80.', autres: 'Here are our new arrivals.', nom: 'Welcome' },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      const message = (id: string, x: number, y: number, body: string) => bloc(id, 'quick_message', x, y, { body });
      const graphe: Graphe = {
        nodes: [
          bloc('n1', 'condition', 0, 60, {
            familles: [
              { code: 'true', nom: l.fideles, groupe: { match: 'all', clauses: [
                { kind: 'tag', op: 'has', tag: 'clientes-fideles' }, { kind: 'business_hours', op: 'within' },
              ] } },
              { code: 'etranger', nom: l.etranger, groupe: { match: 'all', clauses: [{ kind: 'pays', op: 'is_one_of', values: ['BE', 'CH'] }] } },
            ],
          }),
          message('n2', 360, -20, l.vip), message('n3', 360, 110, l.frontiere), message('n4', 360, 240, l.autres),
        ],
        edges: [fleche('e1', 'n1', 'n2', 'true'), fleche('e2', 'n1', 'n3', 'famille:etranger'), fleche('e3', 'n1', 'n4', 'false')],
      };
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom);
      await ouvrir(page);

      const etape = async (n: number, cible: ReturnType<typeof page.getByTestId>) => {
        await centrer(cible);
        await capturer(page, CLE, n, locale, undefined, 'haut', cible, true);
      };
      // 1. Ajouter une condition ; 2. les combiner ; 3. un champ Système ; 4. une famille de plus.
      await etape(1, page.getByRole('button', { name: locale === 'fr' ? 'Ajouter une condition' : 'Add a condition' }).first());
      await etape(2, page.getByRole('combobox').filter({ has: page.locator('option', { hasText: locale === 'fr' ? 'toutes les conditions sont vraies' : 'all conditions are true' }) }).first());
      await etape(3, page.getByTestId('condition-pays').first());
      await etape(4, page.getByTestId('famille-ajouter'));
      // 5. Les sorties, sur la toile.
      await fermerPanneau(page);
      await capturer(page, CLE, 5, locale, undefined, 'haut', poignee(page, 'false'), true);
    });
  });
}
