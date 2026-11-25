import { test, expect } from '../aide/test';
import { mockAccueil } from '../support/accueil';
import { NAVIGATEUR, REGLAGES_ACCUEIL, capturer, chiffresAccueil, communs, langue, type Locale } from './donnees-demo';
import { AG, TEXTES, agentDemo, offreBusiness, outilMaison, simulerAgent, type EtatDemo } from './agent-ia-demo';

/**
 * « Construire un agent IA » : créer l'agent, la voie de l'assistant (décrire, donner le site, garder ou jeter, « Pour
 * finir »), celle des onglets (identité, objectif, règles d'arrêt), l'en-tête, l'activation, puis « Qui répond au
 * client » sur l'Accueil. Les formes sont celles de `web/e2e/agents-*.spec.ts` et `accueil-qui-repond.spec.ts`.
 */
const CLE = 'construire-un-agent-ia';
const COMPTE = (locale: Locale) => ({
  number: '+33 6 39 98 01 00', phoneNumberId: 'pn-demo',
  verifiedName: locale === 'fr' ? 'Votre marque' : 'Your brand', ownerBusinessName: locale === 'fr' ? 'Votre marque' : 'Your brand',
  // Le statut est un texte du serveur : en anglais sur la capture anglaise.
  status: locale === 'fr'
    ? { dot: 'green', label: 'Compte opérationnel', reason: 'Numéro connecté, qualité verte.' }
    : { dot: 'green', label: 'Account operational', reason: 'Number connected, green quality.' },
});

const D = {
  fr: {
    nouveau: 'Conseiller boutique',
    debut: [
      { role: 'user', content: 'Il répond aux questions sur notre collection et nos commandes, et propose un rendez-vous en boutique.' },
      { role: 'assistant', content: 'Bien noté. Et de quoi l’agent ne doit-il jamais parler ? Par exemple : les prix négociés, les promotions à venir, la concurrence.' },
      { role: 'user', content: 'Des promotions à venir, et de la concurrence.' },
      { role: 'assistant', content: 'D’accord. D’où viennent ses réponses de fond : votre site, un catalogue, une grille de tailles ?' },
    ],
    message3: 'Notre site, et une grille de tailles que je peux vous joindre.',
    reponse3: 'Parfait. À quel moment l’agent doit-il faire autre chose que répondre ?\n1. Prendre un rendez-vous\n2. Lancer un de vos scénarios\n3. Passer la main à un humain\n4. Rien de plus',
    site: [
      { role: 'user', content: 'Notre site : https://votre-marque.test' },
      { role: 'assistant', content: 'J’importe les pages de https://votre-marque.test : elles vous attendent dans l’onglet Base de connaissance, à relire. Passons à la suite : quand l’agent doit-il lâcher un contact qui ne répond plus ?' },
    ],
    message5: 'Après 30 minutes, et vouvoiement, phrases courtes, pas d’emoji.',
    reponse5: 'Voici ce que j’ai compris. Relisez chaque ligne : gardez, corrigez ou jetez.',
    changements: [
      { champ: 'fiche.objectif', label: 'Objectif de l’agent', avant: 'Aider les clients.', apres: TEXTES.fr.objectif },
      { champ: 'fiche.ton', label: 'Ton', avant: '', apres: 'Vouvoiement, phrases courtes, pas d’emoji.' },
      { champ: 'fiche.reglesTransfert', label: 'Quand passer la main à un humain', avant: '', apres: TEXTES.fr.transferts },
      { champ: 'fiche.sorties', label: 'Règles d’arrêt', avant: '', apres: 'hors_sujet : La demande sort complètement du sujet' },
      { champ: 'outil.lancer_scenario.0', label: 'Outil « Lancer un scénario »', avant: '', apres: 'Prise de rendez-vous, dès que le contact veut venir essayer en boutique.' },
    ],
    fin: 'C’est noté : vouvoiement, phrases courtes, pas d’emoji.\n\nPour finir :\n1. Base de connaissance : relisez les fiches importées de https://votre-marque.test une fois l’import fini.\n2. Outils : après « Enregistrer », l’outil qui lance « Prise de rendez-vous » naît « Inactif » : onglet « Outils », « Modifier » sur sa ligne, cochez « Autoriser l’agent à faire ça seul », puis cliquez « Activer ».\n3. Modèle : l’agent utilise google/gemini-2.5-flash. Changez-le dans l’onglet « Modèle » si besoin.\n4. Tester : parlez-lui dans l’onglet « Tester », il vous répond comme à un client.\n5. Activer : quand le test vous convient, cliquez sur « Activer » en haut de la fiche.',
    code: 'insulte', libelle: 'Le client insulte l’agent',
    manques: [
      // Les étapes du serveur depuis le 2026-11-25 : objectif, base de connaissance, et la recherche quand elle est remplie.
      { onglet: 'connaissance', message: 'La base de connaissance est vide : l’agent transférerait toutes les questions de fond.' },
    ],
    manquesVide: [
      { onglet: 'objectif', message: 'L’objectif de l’agent est vide : c’est le champ qui pèse le plus sur ce qu’il répondra.' },
      { onglet: 'connaissance', message: 'La base de connaissance est vide : l’agent transférerait toutes les questions de fond.' },
    ],
    radioAgent: 'Un agent IA',
  },
  en: {
    nouveau: 'Store advisor',
    debut: [
      { role: 'user', content: 'It answers questions about our collection and orders, and offers an appointment in store.' },
      { role: 'assistant', content: 'Noted. And what must the agent never talk about? For example: negotiated prices, upcoming sales, competitors.' },
      { role: 'user', content: 'Upcoming sales, and competitors.' },
      { role: 'assistant', content: 'All right. Where do its substantive answers come from: your website, a catalogue, a size chart?' },
    ],
    message3: 'Our website, and a size chart I can attach.',
    reponse3: 'Perfect. When must the agent do something other than answer?\n1. Book an appointment\n2. Start one of your scenarios\n3. Hand over to a human\n4. Nothing more',
    site: [
      { role: 'user', content: 'Our website: https://your-brand.test' },
      { role: 'assistant', content: 'I am importing the pages of https://your-brand.test: they wait for you in the Knowledge base tab, to reread. Next: when should the agent let go of a contact who stops answering?' },
    ],
    message5: 'After 30 minutes, and formal, short sentences, no emoji.',
    reponse5: 'Here is what I understood. Reread each line: keep, edit or drop.',
    changements: [
      { champ: 'fiche.objectif', label: 'The agent’s objective', avant: 'Help customers.', apres: TEXTES.en.objectif },
      { champ: 'fiche.ton', label: 'Tone', avant: '', apres: 'Formal, short sentences, no emoji.' },
      { champ: 'fiche.reglesTransfert', label: 'When to hand over to a human', avant: '', apres: TEXTES.en.transferts },
      { champ: 'fiche.sorties', label: 'Stop rules', avant: '', apres: 'off_topic: The request is completely off topic' },
      { champ: 'outil.lancer_scenario.0', label: 'Tool “Start a scenario”', avant: '', apres: 'Book an appointment, as soon as the contact wants to come and try on in store.' },
    ],
    fin: 'Noted: formal, short sentences, no emoji.\n\nTo finish:\n1. Knowledge base: reread the entries imported from https://your-brand.test once the import is done.\n2. Tools: after “Save”, the tool that starts “Book an appointment” is born “Inactive”: “Tools” tab, “Edit” on its line, tick “Allow the agent to do this on its own”, then click “Activate”.\n3. Model: the agent uses google/gemini-2.5-flash. Change it in the “Model” tab if needed.\n4. Test: talk to it in the “Test” tab, it answers you as it would a customer.\n5. Activate: when the test suits you, click “Activate” at the top of the record.',
    code: 'insult', libelle: 'The customer insults the agent',
    manques: [
      { onglet: 'connaissance', message: 'The knowledge base is empty: the agent would hand over every substantive question.' },
    ],
    manquesVide: [
      { onglet: 'objectif', message: 'The agent’s objective is empty: it is the field that weighs most on what it answers.' },
      { onglet: 'connaissance', message: 'The knowledge base is empty: the agent would hand over every substantive question.' },
    ],
    radioAgent: 'An AI agent',
  },
} as const;

type Tour = { role: 'user' | 'assistant'; content: string };

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use(NAVIGATEUR[locale]);

    test(`${CLE} (${locale}) : la liste et l'assistant`, async ({ page }) => {
      const d = D[locale];
      const l = TEXTES[locale];
      const etat: EtatDemo = {
        locale, agent: agentDemo(locale, { vide: true }), manques: [...d.manquesVide],
        liste: [{ id: 'ag-sav', label: l.autre, status: 'active', sorties: [], modele: 'anthropic/claude-haiku-4.5' }],
      };
      await langue(page, locale);
      await simulerAgent(page, etat);
      await communs(page);
      await offreBusiness(page);

      // 1. « Créer un agent » : le nom interne tapé, juste avant « Créer ». Rien n'est créé.
      await page.goto('/agents');
      await expect(page.getByTestId('agent-ligne-ag-sav')).toBeVisible();
      await page.getByTestId('agent-nouveau-label').fill(d.nouveau);
      await capturer(page, CLE, 1, locale, undefined, 'haut', page.getByTestId('agent-creer'));

      // 2. La fiche neuve, sur « Construire en parlant » : la conversation vide, les neuf onglets à gauche.
      await page.goto(`/agents?id=${AG}&tab=construction`);
      await expect(page.getByTestId('setup-vide')).toBeVisible();
      await capturer(page, CLE, 2, locale, undefined, 'haut', page.getByTestId('mba-tab-construction'));

      // 3. L'entretien en cours : une question à la fois, et le nombre de points qui restent.
      etat.entretien = { messages: [...d.debut] as Tour[], manquants: ['bascules', 'silence', 'humain', 'identite'] };
      etat.reponseEntretien = { message: d.reponse3, proposition: null, changements: [], couverture: { manquants: ['silence', 'humain', 'identite'], total: 10, pointOuvert: null } };
      await page.goto(`/agents?id=${AG}&tab=construction`);
      await expect(page.getByTestId('setup-tour-assistant').first()).toBeVisible();
      await page.getByTestId('setup-saisie').fill(d.message3);
      await page.getByTestId('setup-envoyer').click();
      await expect(page.getByTestId('setup-entretien')).toBeVisible();
      await page.waitForTimeout(800);
      await capturer(page, CLE, 3, locale, page.getByTestId('setup-entretien'), 'bas', page.getByTestId('setup-entretien'));

      // 4. Le site donné dans la conversation : il s'importe pendant qu'on continue ; le trombone à côté de la saisie.
      etat.entretien = { messages: [...d.debut, ...d.site] as Tour[], manquants: ['silence', 'humain', 'identite'] };
      await page.goto(`/agents?id=${AG}&tab=construction`);
      await expect(page.getByTestId('setup-tour-assistant').nth(2)).toBeVisible();
      await page.waitForTimeout(800);
      await capturer(page, CLE, 4, locale, page.getByTestId('setup-saisie'), 'bas', page.getByTestId('setup-joindre'));

      // 5. « Ce que ça changerait » : une ligne jetée, le bouton qui compte celles qui partiront, « Enregistrer et activer »
      // en geste principal. Rien n'est enregistré.
      etat.reponseEntretien = {
        message: d.reponse5, proposition: { fiche: {}, outils: [] }, changements: [...d.changements],
        couverture: { manquants: [], total: 10, pointOuvert: null },
      };
      await page.getByTestId('setup-saisie').fill(d.message5);
      await page.getByTestId('setup-envoyer').click();
      await expect(page.getByTestId('setup-diff')).toBeVisible();
      await page.getByTestId('setup-jeter-fiche.ton').click();
      await capturer(page, CLE, 5, locale, page.getByTestId('setup-diff'), 'haut', page.getByTestId('setup-garder-activer'));

      // 6. Le dernier message de l'assistant et sa liste « Pour finir » ; « Recommencer » en haut de la conversation.
      etat.entretien = {
        messages: [...d.debut, ...d.site, { role: 'user', content: d.message5 }, { role: 'assistant', content: d.fin }] as Tour[],
        auteurs: [...d.debut, ...d.site, 1, 2].map((_, i) => (i % 2 === 0 ? 'lea@votre-marque.test' : null)), manquants: [],
      };
      await page.goto(`/agents?id=${AG}&tab=construction`);
      await expect(page.getByTestId('setup-tour-assistant').last()).toContainText(locale === 'fr' ? 'Pour finir' : 'To finish');
      await page.waitForTimeout(800);
      await capturer(page, CLE, 6, locale, page.getByTestId('setup-saisie'), 'bas', page.getByTestId('setup-tour-assistant').last());
    });

    test(`${CLE} (${locale}) : les onglets, l'en-tête et l'activation`, async ({ page }) => {
      const d = D[locale];
      const etat: EtatDemo = { locale, agent: agentDemo(locale), manques: [...d.manques], messagesTenus: 486 };
      await langue(page, locale);
      await simulerAgent(page, etat);
      await communs(page);

      // 7. Identité et ton, rempli.
      await page.goto(`/agents?id=${AG}&tab=identite`);
      await expect(page.getByTestId('agent-ton')).toBeVisible();
      await capturer(page, CLE, 7, locale, undefined, 'haut', page.getByTestId('mba-tab-identite'));

      // 8. L'onglet « Objectif » : l'objectif seul, et le renvoi vers les outils (2026-11-25).
      await page.goto(`/agents?id=${AG}&tab=objectif`);
      await expect(page.getByTestId('agent-objectif')).toBeVisible();
      await capturer(page, CLE, 8, locale, undefined, 'haut', page.getByTestId('agent-objectif'));

      // 9. Les règles d'arrêt, facultatives, dans l'outil « Terminer » : une règle tapée juste avant « Ajouter ».
      etat.outils = [outilMaison('terminer', locale)];
      await page.goto(`/agents?id=${AG}&tab=outils`);
      await page.getByTestId('toujours-modifier-terminer').click();
      await page.getByTestId('agent-sortie-code').fill(d.code);
      await page.getByTestId('agent-sortie-label').fill(d.libelle);
      await capturer(page, CLE, 9, locale, page.getByTestId('outil-regles-arret'), 'bas', page.getByTestId('agent-sortie-ajouter'));
      etat.outils = [];

      // 10. L'en-tête : le modèle, la pastille, « 2 étapes à finir » et les messages échangés.
      await page.goto(`/agents?id=${AG}&tab=modele`);
      await expect(page.getByTestId('entete-agent-etapes')).toBeVisible();
      await capturer(page, CLE, 10, locale, undefined, 'haut', page.getByTestId('entete-agent-etapes'));

      // 11. Tout est réglé : « Activer », à côté de la pastille Brouillon.
      etat.manques = [];
      await page.goto(`/agents?id=${AG}&tab=outils`);
      await expect(page.getByTestId('agent-activer')).toBeVisible();
      await capturer(page, CLE, 11, locale, undefined, 'haut', page.getByTestId('agent-activer'));
    });

    test(`${CLE} (${locale}) : qui répond au client`, async ({ page }) => {
      const d = D[locale];
      const l = TEXTES[locale];
      await langue(page, locale);
      await mockAccueil(page, {
        account: COMPTE(locale), settings: REGLAGES_ACCUEIL,
        quiRepond: {
          mode: 'equipe', modeEffectif: 'equipe', agentId: null, workflowId: null, delaiS: 86400, mbaAllume: false,
          mbaConfigurable: true, modeleDisponible: true, adresseId: null, adressesActives: [],
          agentsActifs: [{ id: AG, label: l.agent }, { id: 'ag-sav', label: l.autre }],
          scenariosPublies: [{ id: 'wf-bienvenue', name: l.scenarioBienvenue }],
        },
      });
      await chiffresAccueil(page);
      await communs(page);
      await page.reload();
      const carte = page.getByTestId('qui-repond');
      await expect(carte).toBeVisible();
      // 12. « Un agent IA », l'agent choisi, juste avant « Enregistrer ». Rien n'est enregistré.
      await carte.getByRole('radio', { name: d.radioAgent }).check();
      await page.getByTestId('qui-repond-agent').selectOption(AG);
      await capturer(page, CLE, 12, locale, carte, 'bas', page.getByTestId('qui-repond-enregistrer'));
    });
  });
}
