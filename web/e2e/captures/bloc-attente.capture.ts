import { test } from '../aide/test';
import { NAVIGATEUR, capturer, langue, type Locale } from './donnees-demo';
import { bloc, fleche, ouvrir, simulerEditeur, type Graphe } from './editeur-demo';

/**
 * « Le bloc Attente » (spec `2026-11-17-fiches-par-bloc-design.md`, lot 2) : une relance deux jours après une commande.
 * Les trois modes du panneau, puis le bandeau de l'éditeur quand un message hors template suit une attente longue.
 */
const CLE = 'bloc-attente';
const L = {
  fr: { relance: 'Votre colis est bien arrivé ? Dites-nous ce que vous en pensez.', nom: 'Relance', mode: 'après un délai', bandeau: 'Ce montage ne partira pas.' },
  en: { relance: 'Did your parcel arrive safely? Tell us what you think.', nom: 'Follow-up', mode: 'after a delay', bandeau: 'This setup will not be sent.' },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      // Un message rapide derrière deux jours d'attente : c'est le montage que l'éditeur signale (étape 5).
      const graphe: Graphe = {
        nodes: [
          bloc('n1', 'wait', 0, 0, { waitMode: 'delai', delay: 2, unit: 'days' }),
          bloc('n2', 'quick_message', 0, 220, { body: l.relance }),
        ],
        edges: [fleche('e1', 'n1', 'n2')],
      };
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom);
      await ouvrir(page);

      const mode = page.locator('select', { has: page.locator('option', { hasText: l.mode }) });
      // 1. Quand reprendre ; 2. le délai.
      await capturer(page, CLE, 1, locale, undefined, 'haut', mode, true);
      await capturer(page, CLE, 2, locale, undefined, 'haut', page.locator('input[type="number"]').first(), true);
      // 3. Une date précise.
      await mode.selectOption('date');
      await page.getByTestId('wait-date').fill('2026-12-01T09:00');
      await capturer(page, CLE, 3, locale, undefined, 'haut', page.getByTestId('wait-date'), true);
      // 4. Les heures ouvrées.
      await mode.selectOption('heures_ouvrees');
      await capturer(page, CLE, 4, locale, undefined, 'haut', mode, true);
      // 5. Le bandeau de l'éditeur.
      await capturer(page, CLE, 5, locale, undefined, 'haut', page.getByText(l.bandeau), true);
    });
  });
}
