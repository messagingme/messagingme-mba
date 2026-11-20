// scripts/vitrine/aide-claude-textes.ts
// Les pages « Depuis Claude Code » de la doc développeurs (plan du centre d'aide, tâche 7) : UNE source, en français et
// en anglais, sur le modèle de la FAQ du plugin (`scripts/plugin/faq.ts`). `npm run vitrine:aide` les écrit sur le
// gabarit du centre d'aide ; `tests/vitrine-aide.test.ts` exige que chaque outil cité existe dans le catalogue MCP.
//
// 🔴 Chaque étape dit ce qu'on dit à Claude, les outils qu'il appelle (leurs vrais noms, `web/lib/partage/catalogue-mcp.ts`)
// et ce qu'il répond, relus dans `src/mcp/` et dans les skills du plugin. Les commandes viennent de `web/lib/demarrer.ts`.
import { DUREE_CODE_MS } from '../../src/campaign/confirmation';
import { AUTORISATION_CODEX, COMMANDE_DEMARRAGE, COMMANDES_CODEX, COMMANDES_PLUGIN, SERVEUR_PLUGIN_MCP } from '../../web/lib/demarrer';
import { TEXTES_TUNNEL } from './tunnel-textes';

export interface Bilingue {
  readonly fr: string;
  readonly en: string;
}

/**
 * Une étape : ce que la personne tape ou dit (`dire`, un texte entre accents graves s'affiche comme une commande), les
 * outils que Claude appelle, et ce qu'il fait ou répond.
 */
export interface EtapeClaude {
  readonly titre: Bilingue;
  readonly dire: Bilingue;
  readonly outils: readonly string[];
  readonly reponse: Bilingue;
  /** Ce qu'on tape dans Codex à la place, quand ça diffère (le même plugin, lot 4a-2 de l'aide à la connexion). */
  readonly codex?: Bilingue;
}

export interface PageClaude {
  readonly cle: string;
  readonly adresse: Bilingue;
  readonly titre: Bilingue;
  readonly chapeau: Bilingue;
  readonly etapes: readonly EtapeClaude[];
  readonly bonASavoir?: Bilingue;
  /** La page demande l'offre Pro (outils de la fonction `console` ou `statistiques`). */
  readonly offrePro?: boolean;
  /** Un film de `site/films/` (et sa version `-en`), 16:9. */
  readonly film?: string;
  /**
   * Son rang dans la rubrique « Démarrer avec Claude Code ou Codex » du centre d'aide (lot 4a de l'aide à la connexion) :
   * la page y paraît telle quelle, à côté des fiches, au lieu d'être recopiée en fiche. Absent : une page d'usage, rangée
   * dans « Depuis Claude Code ».
   */
  readonly demarrer?: number;
  /** Des questions de la FAQ du plugin (`scripts/plugin/faq.ts`), par leur identifiant, données telles quelles après les étapes. */
  readonly faq?: readonly string[];
}

const MINUTES_CODE = Math.round(DUREE_CODE_MS / 60_000);
/** « Dans un terminal » et la note de la page d'autorisation de Codex : les mots de la fin du tunnel, jamais recopiés. */
const CODEX = { fr: TEXTES_TUNNEL.fr.appels.etapesFree, en: TEXTES_TUNNEL.en.appels.etapesFree };
const majuscule = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

export const PAGES_CLAUDE: readonly PageClaude[] = [
  {
    cle: 'installer-le-plugin',
    demarrer: 1,
    adresse: { fr: '/developpeurs/installer-le-plugin/', en: '/en/developers/install-the-plugin/' },
    titre: { fr: 'Installer le plugin et relier votre espace', en: 'Install the plugin and link your workspace' },
    chapeau: {
      fr: 'Deux commandes, une autorisation, et Claude Code ou Codex pilote votre WhatsApp. L’espace se crée à l’autorisation, avec Google ou votre adresse e-mail.',
      en: 'Two commands, one authorization, and Claude Code or Codex runs your WhatsApp. The workspace is created at authorization, with Google or your email address.',
    },
    film: 'cas-onboarding',
    etapes: [
      {
        titre: { fr: 'Ajouter le plugin', en: 'Add the plugin' },
        dire: { fr: `\`${COMMANDES_PLUGIN[0]}\` puis, séparément, \`${COMMANDES_PLUGIN[1]}\``, en: `\`${COMMANDES_PLUGIN[0]}\` then, separately, \`${COMMANDES_PLUGIN[1]}\`` },
        outils: [],
        reponse: {
          fr: 'Claude Code installe le plugin Messaging Me : ses outils et ses consignes. Tapez les deux commandes l’une après l’autre : collées, Claude Code n’en lancerait qu’une.',
          en: 'Claude Code installs the Messaging Me plugin: its tools and its instructions. Type the two commands one after the other: pasted together, Claude Code would only run one.',
        },
        codex: {
          fr: `${majuscule(CODEX.fr.installer.codex)}, \`${COMMANDES_CODEX[0]}\` puis \`${COMMANDES_CODEX[1]}\``,
          en: `${majuscule(CODEX.en.installer.codex)}, \`${COMMANDES_CODEX[0]}\` then \`${COMMANDES_CODEX[1]}\``,
        },
      },
      {
        titre: { fr: 'Autoriser l’accès', en: 'Authorize access' },
        dire: { fr: `\`/mcp\`, choisissez \`${SERVEUR_PLUGIN_MCP}\`, puis Authenticate`, en: `\`/mcp\`, choose \`${SERVEUR_PLUGIN_MCP}\`, then Authenticate` },
        outils: [],
        reponse: {
          fr: 'Une page s’ouvre dans votre navigateur : continuez avec Google (sans compte, votre espace naît à ce moment, sans formulaire), créez votre espace avec votre adresse e-mail (nous vous envoyons un lien, où vous nommez votre espace et choisissez un mot de passe), ou connectez-vous avec votre mot de passe si vous en avez déjà un. Puis autorisez.',
          en: 'A page opens in your browser: continue with Google (with no account yet, your workspace is created right then, with no form), create your workspace with your email address (we email you a link, where you name your workspace and choose a password), or sign in with your password if you already have one. Then authorize.',
        },
        codex: {
          fr: `${majuscule(CODEX.fr.relier.codex)}, \`${AUTORISATION_CODEX}\`. ${CODEX.fr.relier.codexNote}`,
          en: `${majuscule(CODEX.en.relier.codex)}, \`${AUTORISATION_CODEX}\`. ${CODEX.en.relier.codexNote}`,
        },
      },
      {
        titre: { fr: 'Lancer la mise en service', en: 'Start the setup' },
        dire: { fr: `\`${COMMANDE_DEMARRAGE}\``, en: `\`${COMMANDE_DEMARRAGE}\`` },
        outils: ['get_setup_state'],
        reponse: {
          fr: 'Claude lit où en est votre espace et propose l’étape suivante : connecter le numéro, construire l’agent IA, poser la bulle WhatsApp sur votre site. Une mise en service interrompue reprend où elle s’était arrêtée.',
          en: 'Claude reads where your workspace stands and offers the next step: connect the number, build the AI agent, put the WhatsApp bubble on your site. An interrupted setup resumes where it stopped.',
        },
      },
    ],
    faq: ['mettre-a-jour-le-plugin'],
  },
  {
    cle: 'connecter-son-numero',
    demarrer: 2,
    adresse: { fr: '/developpeurs/connecter-son-numero/', en: '/en/developers/connect-your-number/' },
    titre: { fr: 'Connecter votre numéro WhatsApp depuis Claude', en: 'Connect your WhatsApp number from Claude' },
    chapeau: {
      fr: 'Claude vous donne le lien de la fenêtre de Meta, suit la connexion pendant que vous la faites, et vous dit quand le numéro est prêt.',
      en: 'Claude gives you the link to Meta’s window, follows the connection while you go through it, and tells you when the number is ready.',
    },
    film: 'claude-numero',
    etapes: [
      {
        titre: { fr: 'Choisir le numéro', en: 'Choose the number' },
        dire: { fr: 'Connecte mon numéro WhatsApp.', en: 'Connect my WhatsApp number.' },
        outils: ['get_setup_state'],
        reponse: {
          fr: 'Claude rappelle ce que Meta exige (un compte Meta Business) et demande quel numéro utiliser : un numéro que nous fournissons, le vôtre s’il ne sert dans aucune application WhatsApp, ou celui de votre application WhatsApp Business, qui y reste (un numéro de WhatsApp, l’application ordinaire, y passe d’abord, avec ses conversations).',
          en: 'Claude recalls what Meta requires (a Meta Business account) and asks which number to use: a number we provide, yours if it is used in no WhatsApp app, or the number of your WhatsApp Business app, which stays in it (a number of WhatsApp, the regular app, moves to it first, with its chats).',
        },
      },
      {
        titre: { fr: 'Ouvrir le lien', en: 'Open the link' },
        dire: { fr: 'Un numéro fourni, s’il te plaît.', en: 'A provided number, please.' },
        outils: ['start_whatsapp_connection'],
        reponse: {
          fr: 'Claude dit d’abord ce qu’il faut chez Meta, comment arrive le code et qui paie vos messages, puis écrit le lien, valable une heure, et les étapes de la fenêtre de Meta, une par ligne : les mêmes que sur la page.',
          en: 'Claude first says what you need at Meta, how the code arrives and who pays for your messages, then writes the link, valid for one hour, and the steps of Meta’s window, one per line: the same as on the page.',
        },
      },
      {
        titre: { fr: 'Suivre la connexion', en: 'Follow the connection' },
        dire: { fr: 'J’ai ouvert la fenêtre de Meta.', en: 'I opened Meta’s window.' },
        outils: ['watch_whatsapp_connection'],
        reponse: {
          fr: 'Claude suit la connexion et vous écrit le code de vérification dès qu’il arrive : vous le tapez dans la fenêtre de Meta, puis vous allez jusqu’au dernier écran, « Finish ».',
          en: 'Claude follows the connection and writes the verification code as soon as it arrives: you type it into Meta’s window, then go all the way to the last screen, “Finish”.',
        },
      },
      {
        titre: { fr: 'Ajouter la carte chez Meta', en: 'Add the card at Meta' },
        dire: { fr: 'C’est fini ?', en: 'Is it done?' },
        outils: ['get_setup_state'],
        reponse: {
          fr: 'Claude confirme le numéro connecté et vous donne les étapes pour ajouter une carte Visa ou Mastercard chez Meta : sans elle, les modèles ne partent pas.',
          en: 'Claude confirms the connected number and gives you the steps to add a Visa or Mastercard card at Meta: without it, templates do not go out.',
        },
      },
    ],
    bonASavoir: {
      fr: 'Le premier numéro de votre espace reçoit 1 € de crédit IA dès que Meta l’a vérifié. Le détail de ce qu’il faut chez Meta est dans le guide du compte Meta Business.',
      en: 'Your workspace’s first number receives €1 of AI credit as soon as Meta has verified it. What you need at Meta is detailed in the Meta Business account guide.',
    },
  },
  {
    cle: 'brancher-sa-boutique-shopify',
    demarrer: 6,
    adresse: { fr: '/developpeurs/brancher-sa-boutique-shopify/', en: '/en/developers/connect-your-shopify-store/' },
    titre: { fr: 'Brancher votre boutique Shopify depuis Claude', en: 'Connect your Shopify store from Claude' },
    chapeau: {
      fr: 'Confirmation, expédition, relance des paniers : Claude crée l’app dans votre compte Shopify et la branche. Vous n’avez qu’à cliquer « Installer ». Offre Free.',
      en: 'Confirmation, shipping, checkout reminder: Claude creates the app in your Shopify account and connects it all. You sign in and click “Install”. Free plan.',
    },
    film: 'cas-shopify',
    etapes: [
      {
        titre: { fr: 'Demander le branchement', en: 'Ask for the connection' },
        dire: { fr: 'Branche ma boutique Shopify.', en: 'Connect my Shopify store.' },
        outils: ['get_setup_state', 'get_shopify_state'],
        reponse: {
          fr: 'Claude vérifie que votre numéro WhatsApp est connecté, puis annonce le chemin : cinq minutes, deux gestes pour vous. Il lui faut Node.js sur votre ordinateur : s’il manque, il vous propose de l’installer.',
          en: 'Claude checks that your WhatsApp number is connected, then tells you the way: five minutes, two gestures for you. It needs Node.js on your computer: if it is missing, it offers to install it.',
        },
      },
      {
        titre: { fr: 'Vous connecter à Shopify', en: 'Sign in to Shopify' },
        dire: { fr: 'C’est bon, je suis connecté.', en: 'Done, I am signed in.' },
        outils: [],
        reponse: {
          fr: 'Une fenêtre de Shopify s’ouvre : connectez-vous avec le compte qui gère votre boutique. Claude crée alors l’app Messaging Me dans votre propre organisation Shopify, avec l’outil de Shopify : aucune validation de Shopify n’est nécessaire.',
          en: 'A Shopify window opens: sign in with the account that manages your store. Claude then creates the Messaging Me app in your own Shopify organization, with Shopify’s own tool: no Shopify review is needed.',
        },
      },
      {
        titre: { fr: 'Installer l’app', en: 'Install the app' },
        dire: { fr: 'Installée.', en: 'Installed.' },
        outils: ['connect_shopify'],
        reponse: {
          fr: 'Claude vous donne un lien : cliquez « Installer ». Le message « This app hasn’t been reviewed » est normal, c’est votre propre app. Claude branche la boutique, puis vous demande de rendre le téléphone obligatoire au paiement (Paramètres > Paiement, dans Shopify) : sans téléphone, une commande ne reçoit rien sur WhatsApp.',
          en: 'Claude gives you a link: click “Install”. The “This app hasn’t been reviewed” message is expected, it is your own app. Claude connects the store, then asks you to make the phone required at checkout (Settings > Checkout, in Shopify): without a phone, an order receives nothing on WhatsApp.',
        },
      },
      {
        titre: { fr: 'Allumer les messages de commande', en: 'Switch on the order messages' },
        dire: { fr: 'Montre-moi mes messages Shopify.', en: 'Show me my Shopify messages.' },
        outils: ['get_shopify_state', 'set_shopify_message'],
        reponse: {
          fr: 'Vos messages sont déjà écrits et soumis à Meta au branchement, avec le prénom, le numéro de commande, le montant et le lien de suivi. Claude vous les montre, puis allume ceux que vous voulez une fois approuvés (de quelques minutes à 24 heures) : rien ne part avant. Vous pouvez fermer Claude Code entre-temps et revenir avec « termine mes messages Shopify ». Avec l’offre Pro, vous les retouchez ou leur donnez une suite dans la console.',
          en: 'Your messages are already written and submitted to Meta when the store is connected, with the first name, the order number, the total and the tracking link. Claude shows them, then switches on the ones you want once approved (from a few minutes to 24 hours): nothing goes out before. You can close Claude Code meanwhile and come back with “finish my Shopify messages”. On the Pro plan, you rework them or give them a follow-up in the console.',
        },
      },
      {
        titre: { fr: 'Relancer les paniers abandonnés', en: 'Remind abandoned checkouts' },
        dire: { fr: 'Allume la relance des paniers abandonnés, une heure après.', en: 'Switch on the abandoned checkout reminder, one hour later.' },
        outils: ['set_shopify_message'],
        reponse: {
          fr: 'Le premier message part une fois par panier, avec le lien qui le rouvre, au délai choisi (de 15 min à 72 h) ; rien ne part si une commande en est née. C’est un message marketing, qui finit par « Répondez STOP pour ne plus recevoir ces messages » : un client qui répond STOP n’en reçoit plus.',
          en: 'The first message goes out once per checkout, with the link that reopens it, after the chosen delay (15 min to 72 h); nothing goes out if an order came out of it. It is a marketing message, which ends by telling the customer to reply STOP: a customer who replies STOP gets no more of them.',
        },
      },
      {
        titre: { fr: 'Importer vos clients', en: 'Import your customers' },
        dire: { fr: 'Importe mes clients Shopify.', en: 'Import my Shopify customers.' },
        outils: ['preview_shopify_customers', 'import_shopify_customers'],
        reponse: {
          fr: 'Claude compte d’abord, sans rien écrire : vos clients abonnés à votre marketing qui ont un téléphone, ceux déjà là, et les places que votre offre laisse. Vous choisissez combien en importer. En le demandant, vous déclarez qu’ils ont accepté vos messages WhatsApp ; un client qui a dit STOP le reste.',
          en: 'Claude counts first, writing nothing: your customers subscribed to your marketing who have a phone, those already there, and the places your plan leaves. You choose how many to import. By asking, you declare they agreed to your WhatsApp messages; a customer who said STOP stays opted out.',
        },
      },
      {
        titre: { fr: 'Cibler par les commandes', en: 'Target by orders' },
        dire: { fr: 'Mes clients qui ont commandé au moins 2 fois en 90 jours, en France.', en: 'My customers who ordered at least twice in 90 days, in France.' },
        outils: [],
        reponse: {
          fr: 'Avec l’offre Pro, Claude retrouve les contacts par leurs commandes payées : combien, combien dépensé, depuis quand rien. Les commandes comptent depuis le branchement de la boutique, remboursements non déduits.',
          en: 'On the Pro plan, Claude finds the contacts by their paid orders: how many, how much spent, how long since the last one. Orders count from when the store was connected, refunds not deducted.',
        },
      },
      {
        titre: { fr: 'Voir ce que WhatsApp a rapporté', en: 'See what WhatsApp brought in' },
        dire: { fr: 'Combien mes messages WhatsApp ont rapporté ce mois-ci ?', en: 'How much did my WhatsApp messages bring in this month?' },
        outils: ['get_revenue_stats'],
        reponse: {
          fr: 'Claude donne le chiffre d’affaires des commandes payées dans les 5 jours après un message, par devise et par source (campagne, automation Shopify, scénario, agent), et sa part prouvée : le reste est une concordance dans le temps. Les commandes de test sont à part.',
          en: 'Claude gives the revenue of orders paid within 5 days after a message, per currency and per source (campaign, Shopify automation, scenario, agent), and its proven part: the rest is a match in time. Test orders are kept apart.',
        },
      },
      {
        titre: { fr: 'Suivre, ou couper', en: 'Check, or cut' },
        dire: { fr: 'Où en est ma boutique ?', en: 'How is my store doing?' },
        outils: ['get_shopify_state', 'disconnect_shopify'],
        reponse: {
          fr: 'Claude dit si la boutique est en pause, l’état de chaque automation, le dernier événement reçu, les envois des 30 derniers jours et les paniers récupérés. « Coupe Shopify » arrête tous les messages ; l’app reste installée, Claude vous donne la page où la désinstaller.',
          en: 'Claude tells whether the store is paused, the state of each automation, the last event received, the last 30 days of sends and the recovered checkouts. “Cut Shopify” stops every message; the app stays installed, Claude gives you the page to uninstall it.',
        },
      },
    ],
    bonASavoir: {
      fr: 'Un client qui a répondu STOP ne reçoit rien. Les modèles du mois et la limite de contacts de votre offre comptent : la fiche d’un nouveau client compte. Chaque message apparaît dans Campagnes, une ligne par commande, et part même quand l’agent ou votre équipe tient la conversation. Une demande d’effacement transmise par Shopify efface la fiche du client.',
      en: 'A customer who replied STOP receives nothing. The month’s templates and your plan’s contact limit count: a new customer’s record counts. Each message shows in Campaigns, one line per order, and goes out even when the agent or your team holds the conversation. An erasure request sent by Shopify erases the customer’s record.',
    },
  },
  {
    cle: 'repondre-a-une-conversation',
    adresse: { fr: '/developpeurs/repondre-a-une-conversation/', en: '/en/developers/reply-to-a-conversation/' },
    titre: { fr: 'Répondre à un client depuis Claude', en: 'Reply to a customer from Claude' },
    chapeau: {
      fr: 'Claude lit vos conversations, vous dit si la fenêtre de 24 heures est ouverte, et répond pour vous quand vous le lui demandez.',
      en: 'Claude reads your conversations, tells you whether the 24-hour window is open, and replies for you when you ask.',
    },
    film: 'claude-repondre',
    etapes: [
      {
        titre: { fr: 'Voir qui vous a écrit', en: 'See who wrote to you' },
        dire: { fr: 'Qui m’a écrit aujourd’hui ?', en: 'Who wrote to me today?' },
        outils: ['list_conversations'],
        reponse: {
          fr: 'Claude liste les conversations récentes, la plus récente d’abord, avec le dernier message de chacune.',
          en: 'Claude lists the recent conversations, most recent first, with the last message of each.',
        },
      },
      {
        titre: { fr: 'Lire une conversation', en: 'Read a conversation' },
        dire: { fr: 'Montre-moi celle de Léa.', en: 'Show me Léa’s.' },
        outils: ['get_conversation'],
        reponse: {
          fr: 'Claude résume l’échange et vous dit si la fenêtre de 24 heures est ouverte, c’est-à-dire si Léa vous a écrit dans les vingt-quatre dernières heures.',
          en: 'Claude sums up the exchange and tells you whether the 24-hour window is open, that is whether Léa wrote to you in the last twenty-four hours.',
        },
      },
      {
        titre: { fr: 'Répondre dans la fenêtre', en: 'Reply within the window' },
        dire: { fr: 'Réponds-lui que sa commande part demain.', en: 'Tell her that her order ships tomorrow.' },
        outils: ['reply_in_open_window'],
        reponse: {
          fr: 'La fenêtre est ouverte : Claude envoie le message, tel qu’elle le lira. Fenêtre fermée, l’envoi est refusé, et Claude vous propose un modèle.',
          en: 'The window is open: Claude sends the message, as she will read it. With the window closed, the send is refused, and Claude offers you a template.',
        },
      },
      {
        titre: { fr: 'Hors de la fenêtre, un modèle', en: 'Outside the window, a template' },
        dire: { fr: 'Envoie-lui le modèle de suivi de commande.', en: 'Send her the order follow-up template.' },
        outils: ['list_templates', 'send_template_to_contact'],
        reponse: {
          fr: 'Claude choisit le modèle approuvé, remplit ses variables avec la fiche de Léa et l’envoie.',
          en: 'Claude picks the approved template, fills in its variables from Léa’s record and sends it.',
        },
      },
    ],
  },
  {
    cle: 'preparer-une-campagne',
    adresse: { fr: '/developpeurs/preparer-une-campagne/', en: '/en/developers/prepare-a-campaign/' },
    titre: { fr: 'Préparer et lancer une campagne depuis Claude', en: 'Prepare and launch a campaign from Claude' },
    chapeau: {
      fr: 'Dites à qui écrire et quoi envoyer : Claude prépare un brouillon, vous montre le récapitulatif, et ne lance qu’avec votre oui et son code.',
      en: 'Say who to write to and what to send: Claude prepares a draft, shows you the summary, and only launches with your yes and its code.',
    },
    film: 'claude-campagne',
    offrePro: true,
    etapes: [
      {
        titre: { fr: 'Trouver les destinataires', en: 'Find the recipients' },
        dire: { fr: 'Qui a parlé de la collection d’automne cette semaine ?', en: 'Who talked about the autumn collection this week?' },
        outils: ['list_conversations', 'find_contacts'],
        reponse: {
          fr: 'Claude retrouve les contacts concernés et leur nombre. Il faut au moins un critère : il n’existe pas de cible « tout le monde ».',
          en: 'Claude finds the contacts concerned and how many there are. At least one criterion is needed: there is no “everyone” target.',
        },
      },
      {
        titre: { fr: 'Préparer la campagne', en: 'Prepare the campaign' },
        dire: { fr: 'Prépare une campagne avec le modèle de la collection d’automne pour eux, envoi demain à 10 h.', en: 'Prepare a campaign with the autumn collection template for them, sending tomorrow at 10 am.' },
        outils: ['prepare_campaign'],
        reponse: {
          fr: 'Claude crée un brouillon, visible dans la console, sans rien envoyer, et vous montre le récapitulatif : combien partent, qui est écarté et pourquoi, cinq noms, la date en heure de Paris, et un code de confirmation.',
          en: 'Claude creates a draft, visible in the console, without sending anything, and shows you the summary: how many go out, who is left out and why, five names, the date in Paris time, and a confirmation code.',
        },
      },
      {
        titre: { fr: 'Dire oui', en: 'Say yes' },
        dire: { fr: 'Oui, lance-la.', en: 'Yes, launch it.' },
        outils: ['launch_campaign'],
        reponse: {
          fr: 'Claude lance avec le code du récapitulatif : la campagne est programmée pour la date choisie, ou part tout de suite si aucune date n’a été donnée.',
          en: 'Claude launches with the summary’s code: the campaign is scheduled for the chosen date, or starts right away if no date was given.',
        },
      },
      {
        titre: { fr: 'Suivre les résultats', en: 'Follow the results' },
        dire: { fr: 'Où en est la campagne ?', en: 'How is the campaign doing?' },
        outils: ['get_campaign_stats'],
        reponse: {
          fr: 'Claude lit les envois, les lectures et les réponses de la campagne.',
          en: 'Claude reads the campaign’s sends, reads and replies.',
        },
      },
    ],
    bonASavoir: {
      fr: `Le code de confirmation sert une fois, pendant ${MINUTES_CODE} minutes, et pour la campagne exactement telle que résumée : si quelque chose change, Claude la prépare à nouveau. Un modèle marketing ne part qu’aux contacts qui ont donné leur consentement, et ceux qui ont répondu STOP sont écartés.`,
      en: `The confirmation code works once, for ${MINUTES_CODE} minutes, and only for the campaign exactly as summarized: if anything changes, Claude prepares it again. A marketing template only reaches contacts who gave their consent, and those who replied STOP are left out.`,
    },
  },
];
