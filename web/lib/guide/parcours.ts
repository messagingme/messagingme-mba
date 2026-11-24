/**
 * LES PARCOURS GUIDÉS (plan 2026-11-24-guide-demarrage, lot 3) : la carte qui accompagne la personne de page en page,
 * cadre le bouton à toucher et passe seule à l'étape suivante quand le geste est fait. Logique pure, tenue par
 * `parcours.test.ts` ; l'écran est `components/GuideCompagnon.tsx`, monté par la coquille.
 *
 * 🔴 UNE CIBLE EST UN `data-testid` QUI EXISTE DANS LA CONSOLE : `parcours.test.ts` refuse une cible qui n'apparaît
 * plus nulle part dans `web/`, sans quoi une refonte d'écran ferait pointer la carte dans le vide en silence.
 * Une cible absente de l'écran à un instant donné (un bouton qui n'existe qu'à la fin d'un entretien) laisse la carte
 * sans cadre : elle ne se ferme pas pour autant.
 */

export type CleParcours = 'agent' | 'shopify' | 'campagne' | 'scenario';

/**
 * Quand l'étape est faite. `page` : l'adresse (chemin et requête) répond au motif ; `present` : un élément est apparu ;
 * `clic` : la personne a touché la cible ; `manuel` : seulement par « Suivant » (une étape qui explique).
 */
export type Passage =
  | { type: 'page'; motif: RegExp }
  | { type: 'present'; testid: string }
  | { type: 'clic' }
  | { type: 'manuel' };

export interface EtapeGuide {
  /** L'écran où l'étape se joue (motif sur chemin + requête), et son adresse pour « Y aller ». */
  page: { motif: RegExp; href: string };
  /** Le `data-testid` de l'élément cadré. */
  cible: string;
  titre: { fr: string; en: string };
  texte: { fr: string; en: string };
  passage: Passage;
}

export interface Parcours { cle: CleParcours; nom: { fr: string; en: string }; etapes: readonly EtapeGuide[]; fin: { fr: string; en: string } }

const FICHE_AGENT = /^\/agents\?(.*&)?id=/;
const INTEGRATIONS = /^\/integrations(\?.*)?$/;
const CAMPAGNE = /^\/campaigns\/nouvelle(\?.*)?$/;
const SCENARIOS = /^\/workflows(\?.*)?$/;
const CONTACTS = /^\/contacts(\?.*)?$/;

export const PARCOURS: Readonly<Record<CleParcours, Parcours>> = {
  agent: {
    cle: 'agent',
    nom: { fr: 'Votre agent IA', en: 'Your AI agent' },
    fin: {
      // Le clic ne dit pas si l'activation a réussi (relecture du lot 3) : la fin renvoie à l'état affiché, sans l'affirmer.
      fr: 'Vérifiez en haut de la fiche que votre agent est « Actif ». Il répond alors là où vous l’avez choisi : « Qui répond au client », sur l’Accueil.',
      en: 'Check at the top of the page that your agent is “Active”. It then answers where you chose it: “Who answers the customer”, on Home.',
    },
    etapes: [
      {
        page: { motif: /^\/agents(\?(?!(.*&)?id=).*)?$/, href: '/agents' },
        cible: 'agent-nouveau-label',
        titre: { fr: 'Créez votre agent', en: 'Create your agent' },
        texte: {
          fr: 'Donnez-lui un nom interne (« Conseiller boutique », par exemple), puis « Créer ». Vos clients ne le verront pas.',
          en: 'Give it an internal name (“Store advisor”, for example), then “Create”. Your customers will not see it.',
        },
        passage: { type: 'page', motif: FICHE_AGENT },
      },
      {
        page: { motif: FICHE_AGENT, href: '/agents' },
        cible: 'mba-tab-construction',
        titre: { fr: 'Restez dans « Construire en parlant »', en: 'Stay in “Build by talking”' },
        texte: {
          fr: 'C’est ici que votre agent s’écrit : vous discutez avec l’assistant, il rédige l’agent pour vous. Les autres onglets serviront plus tard, pour l’affiner.',
          en: 'This is where your agent gets written: you talk with the assistant, it drafts the agent for you. The other tabs are for refining it later.',
        },
        passage: { type: 'manuel' },
      },
      {
        page: { motif: FICHE_AGENT, href: '/agents' },
        cible: 'setup-saisie',
        titre: { fr: 'Décrivez votre activité', en: 'Describe your business' },
        texte: {
          fr: 'Deux ou trois phrases suffisent : ce que vous vendez, à qui, et les questions qu’on vous pose le plus. L’assistant vous posera ensuite les siennes.',
          en: 'Two or three sentences are enough: what you sell, to whom, and the questions you get most. The assistant will then ask its own.',
        },
        passage: { type: 'present', testid: 'setup-garder-activer' },
      },
      {
        page: { motif: FICHE_AGENT, href: '/agents' },
        cible: 'setup-garder-activer',
        titre: { fr: 'Relisez, puis activez', en: 'Review, then activate' },
        texte: {
          fr: 'L’assistant propose ce que votre agent dira. Gardez ce qui vous va, puis le bouton encadré, « … et activer ».',
          en: 'The assistant proposes what your agent will say. Keep what suits you, then the framed button, “… and activate”.',
        },
        passage: { type: 'clic' },
      },
    ],
  },
  shopify: {
    cle: 'shopify',
    nom: { fr: 'Votre boutique Shopify', en: 'Your Shopify store' },
    fin: {
      fr: 'Vérifiez que la boutique apparaît branchée dans le volet Shopify. Les messages de commande se règlent ensuite dans Scénario, Shopify.',
      en: 'Check that the store shows as connected in the Shopify panel. Order messages are then set in Scenario, Shopify.',
    },
    etapes: [
      {
        page: { motif: INTEGRATIONS, href: '/integrations' },
        cible: 'volet-shopify',
        titre: { fr: 'Ouvrez le volet Shopify', en: 'Open the Shopify panel' },
        texte: {
          fr: 'Cliquez sur Shopify : le volet s’ouvre sur la marche à suivre et le formulaire de branchement.',
          en: 'Click Shopify: the panel opens on the steps to follow and the connection form.',
        },
        passage: { type: 'present', testid: 'shopify-mode-operatoire' },
      },
      {
        page: { motif: INTEGRATIONS, href: '/integrations' },
        cible: 'shopify-mode-operatoire',
        titre: { fr: 'Créez l’appli chez Shopify', en: 'Create the app at Shopify' },
        texte: {
          fr: 'Suivez ces étapes dans un autre onglet, chez Shopify : elles vous donnent l’identifiant et le secret de l’appli. Revenez ici ensuite.',
          en: 'Follow these steps in another tab, at Shopify: they give you the app’s ID and secret. Then come back here.',
        },
        passage: { type: 'manuel' },
      },
      {
        page: { motif: INTEGRATIONS, href: '/integrations' },
        cible: 'shopify-boutique',
        titre: { fr: 'Collez ce que Shopify vous a donné', en: 'Paste what Shopify gave you' },
        texte: {
          fr: 'L’adresse de la boutique, l’identifiant et le secret de l’appli, puis cochez l’attestation.',
          en: 'The store address, the app’s ID and secret, then tick the attestation.',
        },
        passage: { type: 'manuel' },
      },
      {
        page: { motif: INTEGRATIONS, href: '/integrations' },
        cible: 'shopify-brancher-valider',
        titre: { fr: 'Branchez la boutique', en: 'Connect the store' },
        texte: {
          fr: 'Un clic sur le bouton encadré : la console vérifie les clés et s’abonne aux commandes de la boutique.',
          en: 'One click on the framed button: the console checks the keys and subscribes to the store’s orders.',
        },
        passage: { type: 'clic' },
      },
    ],
  },
  campagne: {
    cle: 'campagne',
    nom: { fr: 'Votre première campagne', en: 'Your first campaign' },
    fin: {
      fr: 'Vérifiez dans Campagnes qu’elle est partie ou programmée : son suivi y montre les envois, les lectures et les réponses.',
      en: 'Check in Campaigns that it has been sent or scheduled: its tracking shows sends, reads and replies.',
    },
    etapes: [
      {
        page: { motif: CONTACTS, href: '/contacts' },
        cible: 'contacts-ajouter-menu',
        titre: { fr: 'Ajoutez vos contacts', en: 'Add your contacts' },
        texte: {
          fr: '« Rajouter des contacts », puis « Importer un CSV » (ou un contact à la main). Déjà des contacts ? Passez à la suite.',
          en: '“Add contacts”, then “Import a CSV” (or one contact by hand). Already have contacts? Move on.',
        },
        // Arriver dans l'assistant vaut « contacts faits » (relecture du lot 4) : sinon la carte renverrait aux contacts.
        passage: { type: 'page', motif: CAMPAGNE },
      },
      {
        page: { motif: CAMPAGNE, href: '/campaigns/nouvelle' },
        cible: 'etape-nom',
        titre: { fr: 'Nommez votre campagne', en: 'Name your campaign' },
        texte: {
          fr: 'Un nom pour la retrouver dans le suivi, puis « Suivant ». Vos contacts ne le voient pas.',
          en: 'A name to find it later in tracking, then “Next”. Your contacts do not see it.',
        },
        passage: { type: 'present', testid: 'etape-canal' },
      },
      {
        page: { motif: CAMPAGNE, href: '/campaigns/nouvelle' },
        cible: 'etape-canal',
        titre: { fr: 'Choisissez le canal', en: 'Choose the channel' },
        texte: {
          fr: 'WhatsApp pour commencer, puis « Suivant ».',
          en: 'WhatsApp to start with, then “Next”.',
        },
        passage: { type: 'present', testid: 'etape-contenu' },
      },
      {
        page: { motif: CAMPAGNE, href: '/campaigns/nouvelle' },
        cible: 'etape-contenu',
        titre: { fr: 'Choisissez le message', en: 'Choose the message' },
        texte: {
          fr: 'Un premier message à une liste passe par un modèle approuvé par Meta : choisissez-en un, ou créez-le ici. L’approbation prend souvent quelques minutes.',
          en: 'A first message to a list goes through a template approved by Meta: pick one, or create it here. Approval often takes a few minutes.',
        },
        passage: { type: 'present', testid: 'etape-audience' },
      },
      {
        page: { motif: CAMPAGNE, href: '/campaigns/nouvelle' },
        cible: 'etape-audience',
        titre: { fr: 'Choisissez les destinataires', en: 'Choose the recipients' },
        texte: {
          fr: 'Tous vos contacts, ou une partie (une étiquette, un filtre), puis « Suivant ».',
          en: 'All your contacts, or some of them (a tag, a filter), then “Next”.',
        },
        passage: { type: 'present', testid: 'etape-recap' },
      },
      {
        page: { motif: CAMPAGNE, href: '/campaigns/nouvelle' },
        cible: 'bouton-lancer',
        titre: { fr: 'Relisez, puis lancez', en: 'Review, then launch' },
        texte: {
          fr: 'Le récapitulatif dit qui reçoit quoi et ce que ça coûte. Le bouton encadré envoie pour de vrai.',
          en: 'The summary says who gets what and what it costs. The framed button really sends.',
        },
        passage: { type: 'clic' },
      },
    ],
  },
  scenario: {
    cle: 'scenario',
    nom: { fr: 'Votre premier scénario', en: 'Your first scenario' },
    fin: {
      fr: 'Vérifiez que le scénario est marqué publié. Il démarre ensuite selon son premier bloc.',
      en: 'Check that the scenario is marked as published. It then starts according to its first block.',
    },
    etapes: [
      {
        page: { motif: SCENARIOS, href: '/workflows' },
        cible: 'workflow-nouveau-nom',
        titre: { fr: 'Créez votre scénario', en: 'Create your scenario' },
        texte: {
          fr: 'Donnez-lui un nom, puis « Créer un scénario ». Vos contacts ne le voient pas.',
          en: 'Give it a name, then “Create a scenario”. Your contacts do not see it.',
        },
        passage: { type: 'present', testid: 'workflow-canevas' },
      },
      {
        page: { motif: SCENARIOS, href: '/workflows' },
        cible: 'workflow-canevas',
        titre: { fr: 'Construisez-le bloc par bloc', en: 'Build it block by block' },
        texte: {
          fr: 'Le premier bloc dit ce qui démarre le scénario : cliquez dessus pour le régler. Tirez ensuite une flèche depuis un bloc pour ajouter le suivant (un message, une question, une attente).',
          en: 'The first block says what starts the scenario: click it to set it. Then drag an arrow from a block to add the next one (a message, a question, a wait).',
        },
        passage: { type: 'manuel' },
      },
      {
        page: { motif: SCENARIOS, href: '/workflows' },
        cible: 'workflow-publier',
        titre: { fr: 'Publiez', en: 'Publish' },
        texte: {
          fr: 'Tant qu’il n’est pas publié, le scénario ne démarre pour personne. Le bouton encadré le met en service.',
          en: 'Until it is published, the scenario starts for no one. The framed button puts it into service.',
        },
        passage: { type: 'clic' },
      },
    ],
  },
};

/** L'état d'un parcours en cours, gardé dans l'onglet (`sessionStorage`) : il survit à la navigation, pas à l'onglet. */
export interface EtatGuide { parcours: CleParcours; etape: number; replie: boolean; fini: boolean }

export const CLE_STOCKAGE = 'mba.guide';
/** L'événement qui lance un parcours (`detail` : sa clé). La coquille l'écoute. */
export const GUIDE_EVENT = 'mba:guide';

export function lireEtat(brut: string | null): EtatGuide | null {
  if (!brut) return null;
  try {
    const v = JSON.parse(brut) as Partial<EtatGuide>;
    if (typeof v.parcours !== 'string' || !(v.parcours in PARCOURS)) return null;
    const p = PARCOURS[v.parcours as CleParcours];
    const etape = typeof v.etape === 'number' && Number.isInteger(v.etape) ? Math.min(Math.max(v.etape, 0), p.etapes.length - 1) : 0;
    return { parcours: p.cle, etape, replie: v.replie === true, fini: v.fini === true };
  } catch {
    return null;
  }
}

/** L'étape se joue-t-elle sur l'adresse courante (chemin + requête) ? */
export function surLaPage(e: EtapeGuide, adresse: string): boolean {
  return e.page.motif.test(adresse);
}

/** L'étape est-elle faite, d'après l'adresse et ce qui est à l'écran ? (`clic` et `manuel` se jugent ailleurs.) */
export function passageAtteint(e: EtapeGuide, adresse: string, present: (testid: string) => boolean): boolean {
  if (e.passage.type === 'page') return e.passage.motif.test(adresse);
  if (e.passage.type === 'present') return present(e.passage.testid);
  return false;
}

/**
 * Avance tant que l'étape courante est déjà faite : une personne qui a créé son agent avant de lancer le guide ne doit
 * pas rester bloquée sur « Créez votre agent ». S'arrête à la dernière étape ; une étape `clic` ou `manuel` n'avance
 * jamais d'ici.
 */
export function avancer(etat: EtatGuide, adresse: string, present: (testid: string) => boolean): EtatGuide {
  const p = PARCOURS[etat.parcours];
  let i = etat.etape;
  while (i < p.etapes.length - 1 && passageAtteint(p.etapes[i]!, adresse, present)) i += 1;
  return i === etat.etape ? etat : { ...etat, etape: i };
}
