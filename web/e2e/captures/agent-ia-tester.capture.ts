import { test, expect } from '../aide/test';
import { NAVIGATEUR, capturer, communs, langue, type Locale } from './donnees-demo';
import { AG, TEXTES, agentDemo, simulerAgent, type EtatDemo } from './agent-ia-demo';

/**
 * « Tester un agent IA et lire son historique » : un essai et sa réponse, les outils appelés (l'un simulé), une sortie,
 * les essais précédents et « Reprendre », puis l'onglet Historique. Les formes sont celles de
 * `web/e2e/agents-tester.spec.ts` ; l'essai est simulé, aucun modèle n'est appelé.
 */
const CLE = 'agent-ia-tester';
const JOUR = 86_400_000;
const ilYa = (jours: number, heures = 0) => new Date(Date.now() - jours * JOUR - heures * 3_600_000).toISOString();

const D = {
  fr: {
    question: 'Bonjour, la veste camel existe en 38 ?',
    reponse: 'Vous échangez avec un assistant automatique.\n\nBonjour ! Oui, la veste camel existe en 38, en boutique comme en ligne. Voulez-vous venir l’essayer ?',
    requete: 'veste camel taille 38', source: 'Veste camel', extrait: 'Disponible du 34 au 44, en boutique et en ligne.',
    tag: 'interesse_veste', note: 'Essai : la pose du tag n’a PAS eu lieu.',
    question2: 'Oui, samedi à Lyon, c’est possible ?',
    reponse2: 'Parfait, je vous réserve un essayage samedi à la boutique de Lyon. À samedi !',
    essais: [
      { id: 'e1', q: 'Vous livrez en Belgique ?', r: 'Oui, nous livrons en Belgique en 3 à 5 jours ouvrés.', sortie: null, appels: [{ nom: 'mba_chercher_connaissance', status: 'ok' }], h: 2 },
      { id: 'e2', q: 'Je veux être remboursé, mon colis est abîmé.', r: null, sortie: 'humain', appels: [{ nom: 'mba_escalader_humain', status: 'ok' }], h: 5 },
      { id: 'e3', q: 'Vous avez des chaussures ?', r: 'Je ne trouve pas cette information : je passe la main à un conseiller.', sortie: null, appels: [], h: 26 },
    ],
    historique: [
      { id: 'h1', operation: 'modification', libelle: 'Fiche de l’agent : objectif, ton', origine: 'formulaire', jours: 0 },
      { id: 'h2', operation: 'modification', libelle: 'Modèle : google/gemini-2.5-flash', origine: 'formulaire', jours: 1 },
      { id: 'h3', operation: 'suppression', libelle: 'Fiche de connaissance supprimée : Soldes d’hiver', origine: 'formulaire', jours: 2, avant: { titre: 'Soldes d’hiver', corps: 'Les soldes d’hiver commencent le 7 janvier, en boutique et en ligne.' } },
      { id: 'h4', operation: 'modification', libelle: 'Fiche de l’agent : règles d’arrêt', origine: 'formulaire', jours: 3 },
      { id: 'h5', operation: 'modification', libelle: 'Activation : brouillon, puis actif', origine: 'mcp', jours: 4 },
    ],
  },
  en: {
    question: 'Hello, does the camel jacket come in a 38?',
    reponse: 'You are chatting with an automated assistant.\n\nHello! Yes, the camel jacket comes in a 38, in store and online. Would you like to come and try it on?',
    requete: 'camel jacket size 38', source: 'Camel jacket', extrait: 'Available from 34 to 44, in store and online.',
    tag: 'jacket_interest', note: 'Test: the tag was NOT set.',
    question2: 'Yes, Saturday in Lyon, is that possible?',
    reponse2: 'Perfect, I am booking you a fitting on Saturday at the Lyon store. See you Saturday!',
    essais: [
      { id: 'e1', q: 'Do you deliver to Belgium?', r: 'Yes, we deliver to Belgium within 3 to 5 working days.', sortie: null, appels: [{ nom: 'mba_chercher_connaissance', status: 'ok' }], h: 2 },
      { id: 'e2', q: 'I want a refund, my parcel is damaged.', r: null, sortie: 'humain', appels: [{ nom: 'mba_escalader_humain', status: 'ok' }], h: 5 },
      { id: 'e3', q: 'Do you sell shoes?', r: 'I cannot find this information: I am handing over to an advisor.', sortie: null, appels: [], h: 26 },
    ],
    historique: [
      { id: 'h1', operation: 'modification', libelle: 'Agent record: objective, tone', origine: 'formulaire', jours: 0 },
      { id: 'h2', operation: 'modification', libelle: 'Model: google/gemini-2.5-flash', origine: 'formulaire', jours: 1 },
      { id: 'h3', operation: 'suppression', libelle: 'Knowledge entry deleted: Winter sales', origine: 'formulaire', jours: 2, avant: { titre: 'Winter sales', corps: 'Winter sales start on 7 January, in store and online.' } },
      { id: 'h4', operation: 'modification', libelle: 'Agent record: stop rules', origine: 'formulaire', jours: 3 },
      { id: 'h5', operation: 'modification', libelle: 'Activation: draft, then active', origine: 'mcp', jours: 4 },
    ],
  },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use(NAVIGATEUR[locale]);

    test(`${CLE} (${locale})`, async ({ page }) => {
      const d = D[locale];
      const sortie = TEXTES[locale].sorties[0].code;
      const etat: EtatDemo = {
        locale, agent: agentDemo(locale, { status: 'active' }),
        essai: {
          texte: d.reponse, sortie: null,
          appels: [
            { nom: 'mba_chercher_connaissance', arguments: JSON.stringify({ requete: d.requete }), status: 'ok',
              contenu: { sources: [{ titre: d.source, contenu: d.extrait, url: `${TEXTES[locale].site}${locale === 'fr' ? '/collection-automne' : '/autumn-collection'}` }] } },
            { nom: 'mba_poser_tag', arguments: JSON.stringify({ tag: d.tag }), status: 'ok', contenu: { simule: true, tag: d.tag, note: d.note } },
          ],
          usage: { tokensIn: 1840, tokensOut: 92, coutMicroEur: 760 },
        },
        essais: d.essais.map((e) => ({
          id: e.id, messages: [{ role: 'user', content: e.q }], reponse: e.r, sortie: e.sortie, appels: [...e.appels],
          tokensEntree: 1650, tokensSortie: 80, coutMicroEur: 690, createdAt: ilYa(0, e.h),
        })),
        historique: d.historique.map((h) => ({
          id: h.id, surface: 'agent', element: 'agent', operation: h.operation, libelle: h.libelle,
          avant: 'avant' in h ? h.avant : null, apres: null, origine: h.origine, acteurEmail: 'lea@votre-marque.test', acteurId: 'u1',
          at: ilYa(h.jours, 3),
        })),
      };
      await langue(page, locale);
      await simulerAgent(page, etat);
      await communs(page);

      // 1. Une question de client, et la réponse de l'agent, la mention d'IA en tête.
      await page.goto(`/agents?id=${AG}&tab=tester`);
      await expect(page.getByTestId('test-saisie')).toBeVisible();
      await page.getByTestId('test-saisie').fill(d.question);
      await page.getByTestId('test-envoyer').click();
      await expect(page.getByTestId('test-tour-assistant')).toBeVisible();
      await capturer(page, CLE, 1, locale, page.getByTestId('test-saisie'), 'bas', page.getByTestId('test-tour-assistant'));

      // 2. « Ce que l'agent a fait » : la recherche exécutée, ce qu'elle a reçu ; le tag, simulé.
      await page.getByTestId('test-appel-detail-0').click();
      await capturer(page, CLE, 2, locale, page.getByTestId('test-appels'), 'haut', page.getByTestId('test-simule-1'));

      // 3. Un essai qui finit par une sortie : le bandeau dit laquelle.
      etat.essai = { texte: d.reponse2, sortie, appels: [], usage: { tokensIn: 2100, tokensOut: 60, coutMicroEur: 820 } };
      await page.getByTestId('test-saisie').fill(d.question2);
      await page.getByTestId('test-envoyer').click();
      await expect(page.getByTestId('test-sortie')).toBeVisible();
      await capturer(page, CLE, 3, locale, page.getByTestId('test-sortie'), 'bas', page.getByTestId('test-sortie'));

      // 4. « Vos essais précédents » : la sortie et les outils de chacun, « Reprendre ».
      await expect(page.getByTestId('test-historique')).toBeVisible();
      await capturer(page, CLE, 4, locale, page.getByTestId('test-historique'), 'haut', page.getByTestId('test-essai-reprendre-e1'));

      // 5. L'onglet Historique : qui, quand, d'où ; une fiche supprimée dont le contenu est déplié.
      await page.goto(`/agents?id=${AG}&tab=historique`);
      await expect(page.getByTestId('historique-lignes')).toBeVisible();
      await page.getByTestId('historique-voir-h3').click();
      await capturer(page, CLE, 5, locale, undefined, 'haut', page.getByTestId('historique-voir-h3'));
    });
  });
}
