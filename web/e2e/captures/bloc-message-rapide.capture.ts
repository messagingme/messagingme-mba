import type { Page } from '@playwright/test';
import { test } from '../aide/test';
import { CHAMPS_DEMO, NAVIGATEUR, TAGS_DEMO, capturer, communs, langue, type Locale } from './donnees-demo';

/**
 * « Le bloc Message rapide » (spec `2026-11-17-fiches-par-bloc-design.md`) : le panneau du bloc puis ses sorties sur la
 * toile, une capture fléchée par étape de la fiche. Le scénario est celui d'une commande prête, de la marque fictive.
 * Rien n'est enregistré : l'API est simulée.
 */
const CLE = 'bloc-message-rapide';
type Graphe = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

const L = {
  fr: {
    corps: 'Bonjour ! Votre commande est prête 🎉 Comment souhaitez-vous la recevoir ?',
    reponses: ['En boutique', 'À domicile'],
    boutique: 'Parfait, elle vous attend dans notre boutique de Lyon.',
    domicile: 'Elle part demain matin, vous recevrez le suivi ici.',
    suite: 'Votre numéro de commande vous sera demandé.',
    lien: { corps: 'Votre devis est prêt.', texte: 'Voir mon devis', url: 'https://votre-marque.test/devis' },
    ajouter: /Réponse rapide/,
  },
  en: {
    corps: 'Hello! Your order is ready 🎉 How would you like to receive it?',
    reponses: ['In store', 'Home delivery'],
    boutique: 'Great, it is waiting for you in our Lyon store.',
    domicile: 'It ships tomorrow morning, you will get the tracking here.',
    suite: 'You will be asked for your order number.',
    lien: { corps: 'Your quote is ready.', texte: 'See my quote', url: 'https://votre-marque.test/devis' },
    ajouter: /Quick reply/,
  },
} as const;

const bloc = (id: string, x: number, y: number, data: Record<string, unknown>) =>
  ({ id, type: 'quick_message', position: { x, y }, data: { wfType: 'quick_message', ...data } });

/** La commande prête : le message à deux réponses, une suite par réponse, et la suite « Puis, sans attendre ». */
function grapheCommande(l: (typeof L)[Locale]): Graphe {
  return {
    nodes: [
      bloc('n1', 0, 80, { body: l.corps, quickReplies: [...l.reponses] }),
      // Serrés, pour que la toile zoome assez : le texte des sorties doit se lire sur la capture.
      bloc('n2', 330, -20, { body: l.boutique }),
      bloc('n3', 330, 105, { body: l.domicile }),
      bloc('n4', 330, 230, { body: l.suite }),
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'btn:0' },
      { id: 'e2', source: 'n1', target: 'n3', sourceHandle: 'btn:1' },
      { id: 'e3', source: 'n1', target: 'n4', sourceHandle: 'ensuite' },
    ],
  };
}

/** Le devis : un message à bouton de lien, seul sur la toile. */
const grapheDevis = (l: (typeof L)[Locale]): Graphe => ({
  nodes: [bloc('n1', 0, 80, { body: l.lien.corps, lienActif: true, lienTexte: l.lien.texte, lienUrl: l.lien.url, quickReplies: [] })],
  edges: [],
});

/** L'éditeur, ses listes, et le scénario `wf1`. Posé avant `communs`, qui passe la main à ces faux pour le reste. */
async function simuler(page: Page, graphe: Graphe, nom: string): Promise<void> {
  const wf = { id: 'wf1', name: nom, graph: graphe, createdAt: '2026-11-17T09:00:00.000Z', updatedAt: '2026-11-17T09:00:00.000Z' };
  await page.route('**/api/backend/**', async (route) => {
    const url = route.request().url();
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (route.request().method() !== 'GET') return json({ ok: true });
    if (/\/workflows\/wf1$/.test(url)) return json({ workflow: wf });
    if (url.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: nom, graph: graphe }] });
    if (url.includes('/email/accounts')) return json({ accounts: [] });
    if (url.includes('/email/templates')) return json({ templates: [] });
    if (url.includes('/templates')) return json({ templates: [] });
    if (url.includes('/flows')) return json({ flows: [] });
    if (url.includes('/tags')) return json({ tags: TAGS_DEMO });
    if (url.includes('/user-fields/usage')) return json({ total: 0, parChamp: {} });
    if (url.includes('/user-fields')) return json({ fields: CHAMPS_DEMO });
    if (url.includes('/settings')) return json({ mbaEnabled: false, rcsEnabled: false, hubspotListsEnabled: false, campaignsPaused: false });
    return json({});
  });
  await communs(page);
}

const poignee = (page: Page, id: string) => page.locator('.react-flow__node').first().locator(`.react-flow__handle[data-handleid="${id}"]`);

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    // Double densité : chaque capture est cadrée sur 640 x 400 autour de sa flèche (`capturer`), soit 1 280 x 800 pixels.
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      await langue(page, locale);
      await simuler(page, grapheCommande(l), locale === 'fr' ? 'Commande prête' : 'Order ready');
      await page.goto('/workflows?open=wf1');
      await page.locator('.react-flow__node').first().click();

      // 1. Le message.
      const corps = page.getByTestId('quick-node-body');
      await capturer(page, CLE, 1, locale, undefined, 'haut', corps, true);
      // 2. Le fichier.
      const fichier = page.getByTestId('quick-node-image-upload').first();
      await fichier.scrollIntoViewIfNeeded();
      await capturer(page, CLE, 2, locale, undefined, 'haut', fichier, true);
      // 3. Les réponses rapides.
      const ajouter = page.getByRole('button', { name: l.ajouter });
      await ajouter.scrollIntoViewIfNeeded();
      await capturer(page, CLE, 3, locale, undefined, 'haut', ajouter, true);

      // 5, 6, 7. Les sorties, sur la toile, panneau fermé.
      await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });
      await capturer(page, CLE, 5, locale, undefined, 'haut', poignee(page, 'btn:1'), true);
      await capturer(page, CLE, 6, locale, undefined, 'haut', poignee(page, 'libre'), true);
      await capturer(page, CLE, 7, locale, undefined, 'haut', poignee(page, 'ensuite'), true);

      // 4. Le bouton de lien, sur le scénario du devis.
      await simuler(page, grapheDevis(l), locale === 'fr' ? 'Devis' : 'Quote');
      await page.goto('/workflows?open=wf1');
      await page.locator('.react-flow__node').first().click();
      const lien = page.locator('label', { has: page.getByTestId('quick-node-lien-actif') });
      await lien.scrollIntoViewIfNeeded();
      await capturer(page, CLE, 4, locale, undefined, 'haut', lien, true);
    });
  });
}
