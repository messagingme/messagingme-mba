import { test, expect, type Page } from '../aide/test';
import { NAVIGATEUR, capturer, communs, langue, type Locale } from './donnees-demo';
import { AG, RQ, SRC, TEXTES, WF_BIENVENUE, WF_RDV, agentDemo, outilMaison, simulerAgent, type EtatDemo } from './agent-ia-demo';

/**
 * « Donner des outils à un agent IA » : « Toujours là », les mots d'un geste, la grille « Quel outil ajouter ? », une
 * capture par carte (tag, information, bloc, scénario, connecteur, MCP, action, enchaînement, qualification), puis la
 * liste des outils posés. Les formes sont celles de `web/e2e/agents-outils.spec.ts` ; aucun outil n'est créé, chaque
 * formulaire est photographié juste avant « Enregistrer ».
 */
const CLE = 'agent-ia-outils';

const D = {
  fr: {
    champs: [{ key: 'ville', label: 'Ville', type: 'text' }, { key: 'taille', label: 'Taille', type: 'text' }, { key: 'boutique', label: 'Boutique préférée', type: 'text' }, { key: 'sujet', label: 'Sujet de la demande', type: 'text' }],
    tags: [{ tag: 'essayage_boutique', count: 41 }, { tag: 'clientes-fideles', count: 186 }],
    blocs: [
      { workflowId: WF_RDV, scenario: 'Prise de rendez-vous', code: 'nod_plan', nom: 'Le plan d’accès de la boutique', type: 'template', envoyable: true, raison: null },
      { workflowId: WF_RDV, scenario: 'Prise de rendez-vous', code: 'nod_creneau', nom: 'Le choix du créneau', type: 'quick_message', envoyable: false, raison: 'ce bloc attend une réponse du client : utilisez « Lancer un scénario »' },
      { workflowId: WF_RDV, scenario: 'Prise de rendez-vous', code: 'nod_merci', nom: 'Le message de confirmation', type: 'quick_message', envoyable: true, raison: null },
    ],
    requete: { label: 'Statut de commande', chemin: '/commandes/{{ref}}' }, systeme: 'Boutique',
    mcp: { title: 'Créer un ticket', name: 'zendesk_creer_ticket' },
    tag: { valeur: 'essayage_boutique', titre: 'Tag essayage', quand: 'Appelle cet outil dès que le contact veut venir essayer un article en boutique. Il sait déjà qui est le contact : ne lui demande rien.', pas: 'N’appelle pas cet outil pour une simple question sur un article.' },
    champ: { titre: 'Enregistrer : Ville', quand: 'Appelle cet outil dès que le contact te donne sa ville. Passe la valeur telle qu’il l’a donnée.', valeurs: 'Lyon\nParis\nBordeaux' },
    bloc: { quand: 'Appelle cet outil dès que le contact demande comment venir à la boutique. Le message part aussitôt : n’en répète pas le contenu.' },
    scenario: { quand: 'Appelle cet outil dès que le contact veut prendre rendez-vous en boutique. Le scénario prend alors la conversation et tu te retires : n’écris rien à côté.' },
    action: { nom: 'Résiliation', consigne: 'Quand le client demande à résilier sa carte de fidélité. Dis-lui que c’est noté et qu’il recevra une confirmation par e-mail sous 48 heures.', champs: [['Numéro de carte', 'texte'], ['Motif', 'liste']], valeurs: 'Déménagement, Prix, Autre' },
    enchainement: { titre: 'Demande de rappel', quand: 'Appelle cet outil dès que le contact demande à être rappelé par un conseiller, avec les informations qu’il a déjà données.', q1: 'Son prénom', q2: 'Sa ville' },
    qualif: { q1: 'Le sujet de sa demande', q2: 'Sa boutique préférée' },
  },
  en: {
    champs: [{ key: 'city', label: 'City', type: 'text' }, { key: 'size', label: 'Size', type: 'text' }, { key: 'store', label: 'Favourite store', type: 'text' }, { key: 'topic', label: 'Request topic', type: 'text' }],
    tags: [{ tag: 'store_fitting', count: 41 }, { tag: 'loyal-customers', count: 186 }],
    blocs: [
      { workflowId: WF_RDV, scenario: 'Book an appointment', code: 'nod_plan', nom: 'The store access map', type: 'template', envoyable: true, raison: null },
      { workflowId: WF_RDV, scenario: 'Book an appointment', code: 'nod_creneau', nom: 'The time slot choice', type: 'quick_message', envoyable: false, raison: 'this block waits for a customer reply: use “Start a scenario”' },
      { workflowId: WF_RDV, scenario: 'Book an appointment', code: 'nod_merci', nom: 'The confirmation message', type: 'quick_message', envoyable: true, raison: null },
    ],
    requete: { label: 'Order status', chemin: '/orders/{{ref}}' }, systeme: 'Shop',
    mcp: { title: 'Create a ticket', name: 'zendesk_create_ticket' },
    tag: { valeur: 'store_fitting', titre: 'Fitting tag', quand: 'Call this tool as soon as the contact wants to come and try an item on in store. It already knows who the contact is: ask nothing.', pas: 'Do not call this tool for a mere question about an item.' },
    champ: { titre: 'Save: City', quand: 'Call this tool as soon as the contact gives you their city. Pass the value as given.', valeurs: 'Lyon\nParis\nBordeaux' },
    bloc: { quand: 'Call this tool as soon as the contact asks how to get to the store. The message is sent right away: do not repeat its content.' },
    scenario: { quand: 'Call this tool as soon as the contact wants to book an appointment in store. The scenario then takes the conversation and you step back: write nothing alongside.' },
    action: { nom: 'Cancellation', consigne: 'When the customer asks to cancel their loyalty card. Tell them it is noted and they will get an email confirmation within 48 hours.', champs: [['Card number', 'texte'], ['Reason', 'liste']], valeurs: 'Moving, Price, Other' },
    enchainement: { titre: 'Callback request', quand: 'Call this tool as soon as the contact asks to be called back by an advisor, with the details they already gave.', q1: 'Their first name', q2: 'Their city' },
    qualif: { q1: 'The topic of their request', q2: 'Their favourite store' },
  },
} as const;

/** L'état de départ : trois gestes de « Toujours là » actifs, rien d'autre de posé. */
function etatDeDepart(locale: Locale): EtatDemo {
  const d = D[locale];
  const l = TEXTES[locale];
  return {
    locale, agent: agentDemo(locale),
    outils: [outilMaison('terminer', locale), outilMaison('escalader', locale), outilMaison('chercher_connaissance', locale)],
    champs: [...d.champs], tags: [...d.tags], blocs: [...d.blocs],
    scenarios: [{ id: WF_RDV, name: l.scenarioRdv, nodeCount: 6 }, { id: WF_BIENVENUE, name: l.scenarioBienvenue, nodeCount: 3 }],
    requetes: [{
      id: RQ, tenantId: 't-demo', sourceId: SRC, label: d.requete.label, methode: 'GET', chemin: d.requete.chemin, parametres: [], entetes: [],
      corps: { mode: 'aucun' }, variables: [{ nom: 'ref', type: 'string', origine: { type: 'modele' }, requis: true }],
      outputPaths: ['statut'], valeursTest: {}, outils: 0, scenarios: [], updatedAt: '2026-11-12T09:00:00.000Z',
    }],
    sources: [{ id: SRC, kind: 'http', label: d.systeme, baseUrl: 'https://api.votre-marque.test/v1', authKind: 'bearer', authHeaderName: null, aAuthentification: true, status: 'active', lastOkAt: null, lastError: null, outilsActifs: 1, agents: 1 }],
    offrables: [{
      ...outilMaison('lire_contact', locale), id: 'mcp-ticket', origin: 'mcp', sourceId: 'mcp-zendesk', name: d.mcp.name, title: d.mcp.title,
      binding: { outilDistant: 'create_ticket' }, risk: 'write', actif: false,
    }],
    adresses: [],
  };
}

/** Ouvre l'onglet Outils, puis une carte de la grille. */
async function carte(page: Page, type: string): Promise<void> {
  await page.goto(`/agents?id=${AG}&tab=outils`);
  await expect(page.getByTestId('outils-toujours-la')).toBeVisible();
  await page.getByTestId('agent-outils-ajouter').click();
  await page.getByTestId(`mba-type-${type}`).click();
}

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use(NAVIGATEUR[locale]);

    test(`${CLE} (${locale}) : Toujours là et la grille`, async ({ page }) => {
      await langue(page, locale);
      await simulerAgent(page, etatDeDepart(locale));
      await communs(page);

      // 1. « Toujours là » : trois gestes actifs, deux à activer.
      await page.goto(`/agents?id=${AG}&tab=outils`);
      await expect(page.getByTestId('outils-toujours-la')).toBeVisible();
      await capturer(page, CLE, 1, locale, page.getByTestId('outils-toujours-la'), 'haut', page.getByTestId('toujours-activer-marquer_urgent'));

      // 2. « Modifier » sur « Passer la main à un humain » : son nom, quand l'appeler, quand ne pas l'appeler.
      await page.getByTestId('toujours-modifier-escalader').click();
      await expect(page.getByTestId('outil-o-escalader')).toBeVisible();
      await capturer(page, CLE, 2, locale, page.getByTestId('toujours-ligne-escalader'), 'haut', page.getByTestId('outil-description-o-escalader'));

      // 3. « Ajouter un outil » : la grille « Quel outil ajouter ? ».
      await page.goto(`/agents?id=${AG}&tab=outils`);
      await page.getByTestId('agent-outils-ajouter').click();
      await expect(page.getByTestId('mba-type-connecteur')).toBeEnabled();
      await capturer(page, CLE, 3, locale, page.getByTestId('mba-types'), 'haut', page.getByTestId('mba-types'));
    });

    test(`${CLE} (${locale}) : les cartes`, async ({ page }) => {
      const d = D[locale];
      await langue(page, locale);
      await simulerAgent(page, etatDeDepart(locale));
      await communs(page);
      const form = page.getByTestId('agent-outil-form');
      const enregistrer = page.getByTestId('agent-outil-form-enregistrer');
      const mots = async (titre: string | null, quand: string, pas?: string) => {
        if (titre !== null) await page.getByTestId('agent-outil-form-titre').fill(titre);
        await page.getByTestId('agent-outil-form-quand').fill(quand);
        if (pas) await page.getByTestId('agent-outil-form-pasquand').fill(pas);
      };

      // 4. Poser un tag : l'étiquette, les mots, juste avant « Enregistrer ».
      await carte(page, 'tag');
      await page.getByTestId('mba-cible-tag').fill(d.tag.valeur);
      await mots(d.tag.titre, d.tag.quand, d.tag.pas);
      await expect(enregistrer).toBeEnabled();
      await capturer(page, CLE, 4, locale, form, 'haut', enregistrer);

      // 5. Enregistrer une information : le champ, ses valeurs permises ; le titre qui le cite.
      await carte(page, 'champ');
      await page.getByTestId('mba-cible-champ').selectOption(d.champs[0]!.key);
      await page.getByTestId('mba-cible-valeurs').fill(d.champ.valeurs);
      await mots(null, d.champ.quand);
      await capturer(page, CLE, 5, locale, form, 'haut', page.getByTestId('mba-cible-valeurs'));

      // 6. Envoyer un bloc : le scénario, le bloc (un autre grisé, avec sa raison), la case d'autonomie cochée.
      await carte(page, 'bloc');
      await page.getByTestId('mba-cible-bloc-scenario').selectOption(WF_RDV);
      await page.getByTestId('mba-cible-bloc-nod_plan').check();
      await mots(null, d.bloc.quand);
      await page.getByTestId('agent-outil-form-autonomie').locator('input').check();
      await capturer(page, CLE, 6, locale, form, 'bas', page.getByTestId('agent-outil-form-autonomie'));

      // 7. Lancer un scénario : un scénario en ligne, la case d'autonomie cochée.
      await carte(page, 'scenario');
      await page.getByTestId('mba-cible-scenario').selectOption(WF_RDV);
      await mots(null, d.scenario.quand);
      await page.getByTestId('agent-outil-form-autonomie').locator('input').check();
      await capturer(page, CLE, 7, locale, form, 'bas', page.getByTestId('mba-cible-scenario'));

      // 8. Appeler un connecteur API : l'appel déclaré dans Tools > Connecteurs API, « Ajouter à cet agent ».
      await carte(page, 'connecteur');
      await expect(page.getByTestId(`requete-nouvel-outil-${RQ}`)).toBeVisible();
      await capturer(page, CLE, 8, locale, page.getByTestId('agent-choix-appel'), 'haut', page.getByTestId(`requete-nouvel-outil-${RQ}`));

      // 9. Appeler un outil MCP : l'outil importé que l'agent n'a pas encore, « Ajouter ».
      await carte(page, 'mcp');
      await expect(page.getByTestId('mcp-rattacher-mcp-ticket')).toBeVisible();
      await capturer(page, CLE, 9, locale, page.getByTestId('agent-outils-mcp'), 'haut', page.getByTestId('mcp-rattacher-mcp-ticket'));

      // 10. Déclencher une action : son nom, sa consigne, deux champs ; le rappel du webhook à abonner.
      await carte(page, 'action');
      await page.getByTestId('agent-action-nom').fill(d.action.nom);
      await page.getByTestId('agent-action-consigne').fill(d.action.consigne);
      for (const [i, [libelle, type]] of d.action.champs.entries()) {
        await page.getByTestId('agent-action-champ-ajouter').click();
        await page.getByTestId(`agent-action-champ-libelle-${i}`).fill(libelle);
        await page.getByTestId(`agent-action-champ-type-${i}`).selectOption(type);
      }
      await page.getByTestId('agent-action-champ-valeurs-1').fill(d.action.valeurs);
      await capturer(page, CLE, 10, locale, form, 'haut', page.getByTestId('agent-action-champ-ajouter'));

      // 11. Enchaîner des étapes : deux questions, un tag, puis le scénario en dernier.
      await carte(page, 'enchainement');
      await mots(d.enchainement.titre, d.enchainement.quand);
      const ajouterEtape = async (type: string) => page.getByTestId('agent-etape-ajouter').selectOption(type);
      await ajouterEtape('demander');
      await page.getByTestId('agent-etape-0').getByTestId('agent-etape-question').fill(d.enchainement.q1);
      await page.getByTestId('agent-etape-0').getByTestId('mba-cible-champ').selectOption('prenom');
      await ajouterEtape('demander');
      await page.getByTestId('agent-etape-1').getByTestId('agent-etape-question').fill(d.enchainement.q2);
      await page.getByTestId('agent-etape-1').getByTestId('mba-cible-champ').selectOption(d.champs[0]!.key);
      await ajouterEtape('tag');
      await page.getByTestId('agent-etape-2').getByTestId('mba-cible-tag').fill(d.tag.valeur);
      await ajouterEtape('scenario');
      await page.getByTestId('agent-etape-3').getByTestId('mba-cible-scenario').selectOption(WF_RDV);
      await page.getByTestId('agent-outil-form-autonomie').locator('input').check();
      await capturer(page, CLE, 11, locale, form, 'bas', page.getByTestId('agent-etape-ajouter'));

      // 12. Qualifier et transférer : « Quand l'appeler » déjà rempli, deux questions, puis « À traiter ».
      await carte(page, 'qualification');
      // La carte s'ouvre sur une première question, vide.
      await page.getByTestId('agent-etape-0').getByTestId('agent-etape-question').fill(d.qualif.q1);
      await page.getByTestId('agent-etape-0').getByTestId('mba-cible-champ').selectOption(d.champs[3]!.key);
      await page.getByTestId('agent-question-ajouter').click();
      await page.getByTestId('agent-etape-1').getByTestId('agent-etape-question').fill(d.qualif.q2);
      await page.getByTestId('agent-etape-1').getByTestId('mba-cible-champ').selectOption(d.champs[2]!.key);
      await capturer(page, CLE, 12, locale, form, 'bas', page.getByTestId('agent-qualification-fin'));
    });

    test(`${CLE} (${locale}) : la liste des outils posés`, async ({ page }) => {
      const d = D[locale];
      const l = TEXTES[locale];
      const etat = etatDeDepart(locale);
      etat.outils!.push(
        outilMaison('poser_tag', locale, { id: 'o-tag', name: 'tag_essayage', title: d.tag.titre, binding: { handler: 'poser_tag', tag: d.tag.valeur } }),
        outilMaison('lancer_scenario', locale, { id: 'o-rdv', name: 'prise_de_rendez_vous', title: l.scenarioRdv, binding: { handler: 'lancer_scenario', workflowId: WF_RDV }, actif: false, autonome: true }),
        outilMaison('envoyer_bloc', locale, { id: 'o-plan', name: 'plan_acces', title: d.blocs[0]!.nom, binding: { handler: 'envoyer_bloc', workflowId: WF_RDV, code: 'nod_plan' }, actif: false, autonome: false }),
        {
          ...outilMaison('lire_contact', locale), id: 'o-commande', origin: 'http', sourceId: SRC, requestId: RQ, name: 'statut_commande',
          title: d.requete.label, binding: {}, risk: 'read', nature: 'integre', outputPaths: ['statut'],
        },
      );
      await langue(page, locale);
      await simulerAgent(page, etat);
      await communs(page);

      // 13. Les outils posés : le scénario relu, juste avant « Activer » ; le bloc sans autonomie, que sa ligne signale.
      await page.goto(`/agents?id=${AG}&tab=outils`);
      await expect(page.getByTestId('outil-ligne-o-rdv')).toBeVisible();
      await capturer(page, CLE, 13, locale, page.getByTestId('outils-poses'), 'haut', page.getByTestId('outil-activer-o-rdv'));
    });
  });
}
