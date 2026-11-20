import { test } from '../aide/test';
import { NAVIGATEUR, capturer, langue, type Locale } from './donnees-demo';
import { bloc, centrer, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, type Graphe } from './editeur-demo';

/**
 * « Le bloc Envoi template » (spec `2026-11-17-fiches-par-bloc-design.md`, lot 2) : un rendez-vous à confirmer, avec un
 * template à deux réponses rapides, puis un rappel sans bouton. Une capture fléchée par étape de la fiche.
 */
const CLE = 'bloc-envoi-template';

const L = {
  fr: {
    rdv: { body: 'Bonjour {{1}}, votre rendez-vous à la boutique de {{2}} est demain à 10 h. Pouvez-vous nous le confirmer ?', boutons: ['Je confirme', 'Je décale'] },
    rappel: 'Bonjour {{1}}, petit rappel : votre rendez-vous est demain à 10 h.',
    merci: 'Merci, à demain !', autreJour: 'Quel jour vous arrangerait ?', apresRappel: 'Une question avant votre venue ? Écrivez-nous ici.',
    nom: ['Rendez-vous', 'Rappel'],
  },
  en: {
    rdv: { body: 'Hello {{1}}, your appointment at our {{2}} store is tomorrow at 10am. Can you confirm it?', boutons: ['I confirm', 'Reschedule'] },
    rappel: 'Hello {{1}}, a quick reminder: your appointment is tomorrow at 10am.',
    merci: 'Thank you, see you tomorrow!', autreJour: 'Which day would suit you?', apresRappel: 'A question before you come? Write to us here.',
    nom: ['Appointment', 'Reminder'],
  },
} as const;

const modele = (locale: Locale, name: string, body: string, boutons: readonly string[]) => ({
  id: `tpl-${name}`, name, status: 'APPROVED', category: 'UTILITY', language: locale, body, headerFormat: null, isCarousel: false,
  buttons: boutons.map((text) => ({ type: 'QUICK_REPLY', text })),
});
/** Le prénom WhatsApp en {{1}}, la ville en {{2}} : les champs choisis quand le template a été écrit. */
const INDICATIONS = [{ position: 1, source: { type: 'attribute', key: 'name' } }, { position: 2, source: { type: 'field', key: 'ville' } }];

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      const rdv = modele(locale, 'rdv_confirmation', l.rdv.body, l.rdv.boutons);
      const rappel = modele(locale, 'rappel_rdv', l.rappel, []);
      const templates = [rdv, rappel];
      const envoi = (id: string, x: number, y: number, t: typeof rdv) =>
        bloc(id, 'template', x, y, { templateName: t.name, language: locale, templateButtons: t.buttons, variables: [] });
      const message = (id: string, x: number, y: number, body: string) => bloc(id, 'quick_message', x, y, { body });

      const grapheRdv: Graphe = {
        nodes: [envoi('n1', 0, 60, rdv), message('n2', 360, -20, l.merci), message('n3', 360, 140, l.autreJour)],
        edges: [fleche('e1', 'n1', 'n2', 'btn:0'), fleche('e2', 'n1', 'n3', 'btn:1')],
      };
      await langue(page, locale);
      await simulerEditeur(page, grapheRdv, l.nom[0], templates, INDICATIONS);
      await ouvrir(page);

      // 1. Le template à envoyer.
      const liste = page.locator('select', { has: page.locator('option', { hasText: 'rdv_confirmation' }) });
      await capturer(page, CLE, 1, locale, undefined, 'haut', liste, true);
      // 2. Les variables.
      const variables = page.getByTestId('template-node-variables');
      await centrer(variables);
      await capturer(page, CLE, 2, locale, undefined, 'haut', variables, true);
      // 3 et 4. Les sorties, sur la toile.
      await fermerPanneau(page);
      await capturer(page, CLE, 3, locale, undefined, 'haut', poignee(page, 'btn:1'), true);
      await capturer(page, CLE, 4, locale, undefined, 'haut', poignee(page, 'libre'), true);

      // 5. La relance, sur la sortie « Pas de réponse » (un délai posé sous « Si le contact ne répond pas »).
      const grapheRelance: Graphe = {
        nodes: [
          bloc('n1', 'template', 0, 60, { templateName: rdv.name, language: locale, templateButtons: rdv.buttons, variables: [], timeoutValue: 30, timeoutUnit: 'minutes' }),
          message('n2', 360, -20, l.merci), message('n3', 360, 140, l.autreJour), envoi('n4', 360, 300, rappel),
        ],
        edges: [fleche('e1', 'n1', 'n2', 'btn:0'), fleche('e2', 'n1', 'n3', 'btn:1'), fleche('e3', 'n1', 'n4', 'timeout')],
      };
      await simulerEditeur(page, grapheRelance, l.nom[0], templates, INDICATIONS);
      await ouvrir(page, false);
      await capturer(page, CLE, 5, locale, undefined, 'haut', poignee(page, 'timeout'), true);

      // 6. Un template sans bouton et ce qui le suit.
      const grapheRappel: Graphe = {
        nodes: [envoi('n1', 0, 0, rappel), message('n2', 0, 260, l.apresRappel)],
        edges: [fleche('e1', 'n1', 'n2')],
      };
      await simulerEditeur(page, grapheRappel, l.nom[1], templates, INDICATIONS);
      await ouvrir(page, false);
      await capturer(page, CLE, 6, locale, undefined, 'haut', poignee(page, 'libre'), true);

      // 7. Écrire ou modifier le template sans quitter le scénario (menu « Scénario », lot 3) : les deux boutons, sous la liste.
      await simulerEditeur(page, grapheRdv, l.nom[0], templates, INDICATIONS);
      await ouvrir(page);
      const modifier = page.getByTestId('template-modifier');
      await centrer(modifier);
      await capturer(page, CLE, 7, locale, undefined, 'haut', modifier, true);

      // 8. La sortie « En cas d'échec » (2026-11-20) : le rappel non livré passe à l'équipe.
      const grapheEchec: Graphe = {
        nodes: [envoi('n1', 0, 0, rappel), message('n2', 0, 260, l.apresRappel), bloc('n3', 'inbox', 360, 120, {})],
        edges: [fleche('e1', 'n1', 'n2'), fleche('e2', 'n1', 'n3', 'non_livre')],
      };
      await simulerEditeur(page, grapheEchec, l.nom[1], templates, INDICATIONS);
      await ouvrir(page, false);
      await capturer(page, CLE, 8, locale, undefined, 'haut', poignee(page, 'non_livre'), true);
    });
  });
}
