import { test } from '../aide/test';
import { NAVIGATEUR, capturer, langue, type Locale } from './donnees-demo';
import { bloc, centrer, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, type Graphe } from './editeur-demo';

/**
 * « Le bloc Message rapide » (spec `2026-11-17-fiches-par-bloc-design.md`) : le panneau du bloc puis ses sorties sur la
 * toile, une capture fléchée par étape de la fiche. Le scénario est celui d'une commande prête, de la marque fictive.
 * Rien n'est enregistré : l'API est simulée.
 */
const CLE = 'bloc-message-rapide';

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

const message = (id: string, x: number, y: number, data: Record<string, unknown>) => bloc(id, 'quick_message', x, y, data);

/** La commande prête : le message à deux réponses, une suite par réponse, et la suite « Puis, sans attendre ». */
function grapheCommande(l: (typeof L)[Locale]): Graphe {
  return {
    nodes: [
      message('n1', 0, 80, { body: l.corps, quickReplies: [...l.reponses] }),
      // Serrés, pour que la toile zoome assez : le texte des sorties doit se lire sur la capture.
      message('n2', 330, -20, { body: l.boutique }),
      message('n3', 330, 105, { body: l.domicile }),
      message('n4', 330, 230, { body: l.suite }),
    ],
    edges: [fleche('e1', 'n1', 'n2', 'btn:0'), fleche('e2', 'n1', 'n3', 'btn:1'), fleche('e3', 'n1', 'n4', 'ensuite')],
  };
}

/** Le devis : un message à bouton de lien, seul sur la toile. */
const grapheDevis = (l: (typeof L)[Locale]): Graphe => ({
  nodes: [message('n1', 0, 80, { body: l.lien.corps, lienActif: true, lienTexte: l.lien.texte, lienUrl: l.lien.url, quickReplies: [] })],
  edges: [],
});

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    // Double densité : chaque capture est cadrée sur 640 x 400 autour de sa flèche (`capturer`), soit 1 280 x 800 pixels.
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      await langue(page, locale);
      await simulerEditeur(page, grapheCommande(l), locale === 'fr' ? 'Commande prête' : 'Order ready');
      await ouvrir(page);

      // 1. Le message.
      await capturer(page, CLE, 1, locale, undefined, 'haut', page.getByTestId('quick-node-body'), true);
      // 2. Le fichier.
      const fichier = page.getByTestId('quick-node-image-upload').first();
      await centrer(fichier);
      await capturer(page, CLE, 2, locale, undefined, 'haut', fichier, true);
      // 3. Les réponses rapides.
      const ajouter = page.getByRole('button', { name: l.ajouter });
      await centrer(ajouter);
      await capturer(page, CLE, 3, locale, undefined, 'haut', ajouter, true);

      // 5, 6, 7. Les sorties, sur la toile, panneau fermé.
      await fermerPanneau(page);
      await capturer(page, CLE, 5, locale, undefined, 'haut', poignee(page, 'btn:1'), true);
      await capturer(page, CLE, 6, locale, undefined, 'haut', poignee(page, 'libre'), true);
      await capturer(page, CLE, 7, locale, undefined, 'haut', poignee(page, 'ensuite'), true);

      // 4. Le bouton de lien, sur le scénario du devis.
      await simulerEditeur(page, grapheDevis(l), locale === 'fr' ? 'Devis' : 'Quote');
      await ouvrir(page);
      const lien = page.locator('label', { has: page.getByTestId('quick-node-lien-actif') });
      await centrer(lien);
      await capturer(page, CLE, 4, locale, undefined, 'haut', lien, true);
    });
  });
}
