/**
 * LES QUESTIONS DU NUMÉRO DANS LA CONSOLE (2026-10-30, plan `docs/superpowers/plans/2026-10-30-tunnel-numero-console-plugin.md`) :
 * celles du tunnel de la vitrine (`scripts/vitrine/tunnel-textes.ts`, l'arbre de Julien), à partir de la deuxième, car
 * l'espace a déjà son offre. `tests/questions-numero-vitrine.test.ts` les tient égales à la vitrine, au mot près, et la
 * skill `mise-en-service` du plugin pose les mêmes. Plus aucune voie par QR code.
 */
import { AIDE_COMPTE_META_BUSINESS, AIDE_PAYER_META } from './partage/aide-connexion';

type Texte = { readonly fr: string; readonly en: string };

/** Où vérifier qu'on a un compte Meta Business : la console en fait un lien, la vitrine aussi. */
export const META_BUSINESS_URL = 'https://business.facebook.com/';

/**
 * LA PREMIÈRE QUESTION, LA FORMULE (lot 3b, Julien, 2026-11-09 : le premier écran d'un espace neuf « commence par les
 * quatre cartes de la vitrine », l'essai du Pro « bien visible »). La question, son aide et les quatre cartes, aux mots de
 * la vitrine (`scripts/vitrine/tunnel-textes.ts`, `tests/questions-numero-vitrine.test.ts`) ; les prix sont ceux du
 * code, que la vitrine lit, et le test les tient égaux. Les boutons, eux, sont ceux de la console (`ChoixOffre`).
 */
export const QUESTION_OFFRE = {
  texte: { fr: 'Quelle formule voulez-vous ?', en: 'Which plan do you want?' },
  precision: { fr: 'Vous pourrez en changer plus tard.', en: 'You can change it later.' },
  aide: {
    fr: 'Free se pilote uniquement depuis un agent IA comme Claude Code ou Codex : sans lui, Free ne marche pas. Sans agent IA, choisissez Pro : la console, pour vous et votre équipe, avec un numéro fourni.',
    en: 'Free is driven only from an AI agent such as Claude Code or Codex: without one, Free does not work. Without an AI agent, choose Pro: the console, for you and your team, with a provided number.',
  },
  nsp: { fr: 'Je ne sais pas', en: 'I don’t know' },
} as const satisfies Record<string, Texte>;

/** Les quatre formules d'un espace, dans l'ordre de la vitrine. */
export type FormuleChoisie = 'free' | 'pro' | 'business' | 'entreprise';

export const CARTES_OFFRE: ReadonlyArray<{
  readonly offre: FormuleChoisie; readonly libelle: Texte; readonly titre: Texte; readonly badge?: Texte;
  readonly plus: readonly Texte[]; readonly moins: readonly Texte[];
}> = [
  {
    offre: 'free', libelle: { fr: 'Free', en: 'Free' },
    titre: { fr: 'Free, 0 € d’abonnement', en: 'Free, €0 a month' },
    plus: [
      { fr: 'Tout se fait en parlant à Claude Code ou Codex : votre numéro, votre agent IA, vos messages.', en: 'Everything happens by talking to Claude Code or Codex: your number, your AI agent, your messages.' },
      { fr: 'Sans limite de durée.', en: 'With no time limit.' },
    ],
    moins: [
      { fr: 'Pas de console : il faut un agent IA comme Claude Code ou Codex.', en: 'No console: you need an AI agent such as Claude Code or Codex.' },
      { fr: '100 contacts et 1 000 modèles envoyés par mois.', en: '100 contacts and 1,000 templates sent a month.' },
    ],
  },
  {
    offre: 'pro', libelle: { fr: 'Pro', en: 'Pro' },
    titre: { fr: 'Pro, 49 € HT par mois', en: 'Pro, €49 excl. VAT a month' },
    badge: { fr: '14 jours d’essai gratuit', en: '14-day free trial' },
    plus: [
      { fr: 'La console : l’Inbox de l’équipe, les campagnes, les tableaux de bord.', en: 'The console: the team Inbox, campaigns, dashboards.' },
      { fr: 'Un numéro fourni, inclus.', en: 'A provided number, included.' },
      { fr: '14 jours d’essai la première fois.', en: 'A 14-day trial the first time.' },
    ],
    moins: [{ fr: 'Une carte demandée dès l’essai.', en: 'A card required from the trial.' }],
  },
  {
    offre: 'business', libelle: { fr: 'Business', en: 'Business' },
    titre: { fr: 'Business, 349 € HT par mois', en: 'Business, €349 excl. VAT a month' },
    plus: [
      { fr: 'Tout Pro, plus le Meta Business Agent et HubSpot.', en: 'Everything in Pro, plus the Meta Business Agent and HubSpot.' },
      { fr: '5 utilisateurs et un accompagnement les deux premiers mois.', en: '5 users and dedicated support for the first two months.' },
    ],
    moins: [{ fr: 'Sur facture, après un échange avec nous.', en: 'Invoiced, after a conversation with us.' }],
  },
  {
    offre: 'entreprise', libelle: { fr: 'Entreprise', en: 'Enterprise' },
    titre: { fr: 'Entreprise, sur devis', en: 'Enterprise, on quote' },
    plus: [
      { fr: 'Tout Business, plus le RCS, Salesforce et Dynamics, l’analyse des conversations et les publicités Click-to-WhatsApp.', en: 'Everything in Business, plus RCS, Salesforce and Dynamics, conversation analysis and Click-to-WhatsApp ads.' },
      { fr: 'Contacts, utilisateurs et webhooks à votre mesure.', en: 'Contacts, users and webhooks sized for you.' },
    ],
    moins: [{ fr: 'Un devis selon votre volume.', en: 'A quote based on your volume.' }],
  },
];

/**
 * QUI PAIE META, juste après l'offre (révision du Crédit WhatsApp, lot B, textes validés par Julien le 2026-11-06) : deux
 * cartes, chaque bouton sous la sienne. La carte du moyen de paiement chez Meta (son libellé et ses deux liens, Julien,
 * 2026-11-09, lot 3a) mène à l'arbre du numéro ; la carte du Crédit WhatsApp est
 * grisée tant qu'il n'est pas en vente en ligne (en Free, il vient avec la formule Pro ; ailleurs, sur demande). Les mêmes
 * mots que la vitrine (`tests/questions-numero-vitrine.test.ts`) ; la console y ajoute l'état de l'espace (`QuiRegleMeta`).
 *
 * ⚠️ `carte.texte` et `grisee` sont les mots de la VITRINE, tenus égaux par le test de parité : la console dit ses
 * variantes validées (`QuiRegleMeta` : « Vous connectez votre numéro, et Meta vous facture vos modèles sur ce moyen de
 * paiement. », « Sur demande :
 * écrivez-nous depuis le Support. ») ; le titre, la question, sa précision et le texte du Crédit WhatsApp sont communs
 * (jaune 8 de la relecture du lot B).
 */
export const QUESTION_PAIEMENT = {
  texte: { fr: 'Qui paie vos messages à Meta ?', en: 'Who pays Meta for your messages?' },
  precision: { fr: 'Meta facture chaque modèle que vous envoyez.', en: 'Meta bills each template you send.' },
  carte: {
    titre: {
      fr: 'Je mets un moyen de paiement (Visa / Mastercard) sur mon compte Meta Business',
      en: 'I add a payment method (Visa / Mastercard) to my Meta Business account',
    },
    texte: { fr: 'Meta vous facture vos modèles sur ce moyen de paiement.', en: 'Meta bills your templates to this payment method.' },
    /** Ses deux liens, les fiches de la vitrine (`AIDE_PAYER_META`, `AIDE_COMPTE_META_BUSINESS`). */
    liens: [
      { libelle: { fr: 'Pourquoi un moyen de paiement ?', en: 'Why a payment method?' }, href: AIDE_PAYER_META },
      { libelle: { fr: 'Qu’est-ce qu’un compte Meta Business ?', en: 'What is a Meta Business account?' }, href: AIDE_COMPTE_META_BUSINESS },
    ],
  },
  credit: {
    titre: { fr: 'Crédit WhatsApp', en: 'WhatsApp credit' },
    texte: {
      fr: 'Vous prépayez vos messages chez Messaging Me, sans carte chez Meta : 30 € HT par numéro et par mois, avec la formule Pro ou Business.',
      en: 'You prepay your messages at Messaging Me, with no card at Meta: €30 excl. VAT per number per month, with the Pro or Business plan.',
    },
  },
  grisee: {
    free: { fr: 'Avec la formule Pro.', en: 'With the Pro plan.' },
    pro: { fr: 'Sur demande : écrivez-nous.', en: 'On request: write to us.' },
  },
} as const;

/**
 * « VOTRE NUMÉRO, OU LE NÔTRE ? » (Julien, 2026-11-10, lot 3v) : l'option du Crédit WhatsApp payée, le numéro passe par
 * la fenêtre du partenaire, le nôtre (le numéro fourni) comme le sien. Le sien, s'il sert déjà dans l'application
 * WhatsApp du téléphone, reçoit AVANT la fenêtre la phrase validée (`application`, précédée d'`ISSUE_API.garder`).
 * 🔴 Jamais « quitter l'application » : personne ne le comprend.
 */
export const QUESTION_LIGNE_NUMERO = {
  texte: { fr: 'Votre numéro, ou le nôtre ?', en: 'Your number, or ours?' },
  mien: { fr: 'Le mien', en: 'Mine' },
  notre: { fr: 'Le vôtre', en: 'Yours' },
  // Le titre de la carte chez Meta s'y cite tel quel : il se lit dans `QUESTION_PAIEMENT`, jamais recopié (jaune 5 de la
  // relecture du lot 3v).
  application: {
    fr: `Avec le Crédit WhatsApp, il n’y marchera plus : vos clients vous écriront dans Messaging Me, et vous leur répondrez là (la console ou Claude). Pour garder l’application : « ${QUESTION_PAIEMENT.carte.titre.fr} », ou un numéro de chez nous.`,
    en: `With WhatsApp credit, it will no longer work there: your customers will write to you in Messaging Me, and you will reply there (the console or Claude). To keep the app: “${QUESTION_PAIEMENT.carte.titre.en}”, or a number from us.`,
  },
} as const satisfies Record<string, Texte>;

// Les conditions de la fenêtre du partenaire vivent avec celles de la carte (lot 3v-2b) : le serveur MCP les lit aussi.
export { NUMERO_LIGNE_MIEN, PREREQUIS_LIGNE } from './partage/etapes-meta';

/** Les voies qui gardent l'application WhatsApp Business : le Crédit WhatsApp n'y est pas possible (spec, décision 8). */
export const NOTE_CARTE_APPLICATION: Texte = {
  fr: 'Vous payez Meta avec votre carte : le Crédit WhatsApp n’est pas possible avec l’application.',
  en: 'You pay Meta with your card: WhatsApp credit is not possible with the app.',
};

/**
 * Au moment de payer l'option, quand tous les numéros de l'espace gardent l'application (décision 8) : la carte
 * « Crédit WhatsApp » (`QuiRegleMeta`) et l'onglet Crédit WhatsApp le disent pareil.
 */
export const AVERTISSEMENT_APPLICATION: Texte = {
  fr: 'Vos numéros connectés gardent l’application WhatsApp Business : ils restent payés par votre carte chez Meta, le Crédit WhatsApp n’est pas possible avec l’application. L’option sert à connecter un nouveau numéro, sans l’application.',
  en: 'Your connected numbers keep the WhatsApp Business app: they stay paid by your card at Meta, WhatsApp credit is not possible with the app. The option is for connecting a new number, without the app.',
};

export const QUESTION_COMPTE = {
  texte: { fr: 'Avez-vous un compte Meta Business ?', en: 'Do you have a Meta Business account?' },
  precision: { fr: 'L’ancien Business Manager : le compte de votre entreprise chez Meta.', en: 'Formerly Business Manager: your business’s account at Meta.' },
  oui: { fr: 'Oui', en: 'Yes' },
  non: { fr: 'Non', en: 'No' },
  nsp: { fr: 'Je ne sais pas', en: 'I don’t know' },
  noteNon: { fr: 'Rien à préparer : la fenêtre de Meta vous le fera créer en chemin.', en: 'Nothing to prepare: Meta’s window will have you create it along the way.' },
  /** La note de « Je ne sais pas », coupée autour du lien vers business.facebook.com. */
  noteNsp: {
    avant: { fr: 'Pour le vérifier : ', en: 'To check: ' },
    apres: {
      fr: '. Si vous faites de la publicité sur Facebook ou Instagram, vous en avez sans doute un. Sinon, la fenêtre de Meta vous le fera créer en chemin.',
      en: '. If you advertise on Facebook or Instagram, you probably have one. Otherwise, Meta’s window will have you create it along the way.',
    },
  },
} as const satisfies Record<string, Texte | Record<string, Texte>>;

export const QUESTION_APPLICATION = {
  texte: { fr: 'Avez-vous déjà l’application WhatsApp Business ?', en: 'Do you already have the WhatsApp Business app?' },
  precision: { fr: 'L’application des professionnels, distincte de WhatsApp.', en: 'The app for businesses, separate from WhatsApp.' },
  oui: { fr: 'Oui', en: 'Yes' },
  non: { fr: 'Non', en: 'No' },
  /** Après « Non », avant la 4e question, avec les deux magasins (Julien, 2026-10-31). */
  noteNon: { fr: 'Vous allez devoir télécharger l’application WhatsApp Business.', en: 'You will need to download the WhatsApp Business app.' },
} as const satisfies Record<string, Texte>;

/**
 * LE CAS 4 (Julien, 2026-11-08, lot 3a) : l'application WhatsApp Business, mais pour un autre numéro. Oui, on la garde ;
 * Non, un numéro de chez nous, relié par la fenêtre de Meta (`ISSUE_AUTRE_NUMERO`), l'application gardant le sien.
 */
export const QUESTION_MEME_NUMERO = {
  texte: { fr: 'Voulez-vous utiliser ce numéro-là ?', en: 'Do you want to use that number?' },
  precision: { fr: 'Celui de votre application WhatsApp Business.', en: 'The one in your WhatsApp Business app.' },
  oui: { fr: 'Oui', en: 'Yes' },
  non: { fr: 'Non', en: 'No' },
} as const satisfies Record<string, Texte>;

/** Le cas 4, Non : le titre et la première phrase de l'issue de la vitrine ; le bouton ouvre le numéro fourni (`fourni`). */
export const ISSUE_AUTRE_NUMERO = {
  titre: { fr: 'Un numéro de chez nous, relié par Meta', en: 'A number from us, connected through Meta' },
  texte: {
    fr: 'Nous vous fournissons un numéro, 3,50 € HT par mois en formule Free, inclus en formule Pro : la fenêtre de Meta le relie à l’API officielle de WhatsApp, il envoie vos messages, et votre agent IA répond. Votre application WhatsApp Business garde le sien.',
    en: 'We provide a number, €3.50 excl. VAT a month with the Free plan, included in Pro: Meta’s window connects it to the official WhatsApp API, it sends your messages, and your AI agent answers. Your WhatsApp Business app keeps its own.',
  },
} as const satisfies Record<string, Texte>;

/** WHATSAPP ORDINAIRE (lot 3a) : la phrase vit dans la source partagée, que lisent aussi la 3e condition chez Meta et Claude. */
export { WHATSAPP_ORDINAIRE } from './partage/etapes-meta';

/** Sans compte Meta Business ni application (Julien, 2026-10-31) : a-t-on un numéro à mettre dans l'application ? */
export const QUESTION_NUMERO = {
  texte: { fr: 'Avez-vous déjà un numéro que vous pourriez utiliser ?', en: 'Do you already have a number you could use?' },
  precision: { fr: 'Le numéro que vous mettrez dans l’application WhatsApp Business.', en: 'The number you will put in the WhatsApp Business app.' },
  oui: { fr: 'Oui', en: 'Yes' },
  non: { fr: 'Non', en: 'No' },
} as const satisfies Record<string, Texte>;

/** Avec un compte Meta Business : le numéro API, et la ligne qui rappelle qu'on peut garder son application. */
export const ISSUE_API = {
  titre: { fr: 'Votre numéro API', en: 'Your API number' },
  garder: { fr: 'Votre numéro sert déjà dans WhatsApp ou dans l’application WhatsApp Business ?', en: 'Is your number already used in WhatsApp or in the WhatsApp Business app?' },
  lien: { fr: 'Vous pouvez le garder', en: 'You can keep it' },
} as const satisfies Record<string, Texte>;

/**
 * Sans l'application : la télécharger, puis brancher TOUT DE SUITE en la gardant (Julien, 2026-10-30). Un numéro neuf passe
 * en coexistence sans attendre (testé, Julien, 2026-11-11) : aucune mise en garde sur un refus de Meta.
 */
export const ISSUE_TELECHARGER = {
  titre: { fr: 'Téléchargez l’application WhatsApp Business', en: 'Download the WhatsApp Business app' },
  textes: [
    {
      fr: 'Installez l’application WhatsApp Business sur un téléphone, avec le numéro de votre entreprise, puis branchez-le tout de suite en gardant l’application : votre numéro reste sur votre téléphone et envoie aussi depuis Messaging Me.',
      en: 'Install the WhatsApp Business app on a phone, with your business’s number, then connect it right away while keeping the app: your number stays on your phone and also sends from Messaging Me.',
    },
  ],
  /** Les fiches officielles de l'application, celles de la vitrine (`MAGASINS`), avec leur icône (`@/lib/icones`). */
  magasins: [
    { libelle: { fr: 'App Store (iPhone)', en: 'App Store (iPhone)' }, href: 'https://apps.apple.com/app/whatsapp-business/id1386412985', icone: 'appstore' },
    { libelle: { fr: 'Google Play (Android)', en: 'Google Play (Android)' }, href: 'https://play.google.com/store/apps/details?id=com.whatsapp.w4b', icone: 'googleplay' },
  ],
} as const;

/**
 * Sans numéro (Julien, 2026-10-31) : nous le fournissons, et il va DANS l'application (« Dans l'application »), puis se
 * branche en la gardant. Les deux phrases de la vitrine que la console reprend : le numéro et son code, puis répondre dès
 * le premier jour et brancher le numéro en gardant l'application.
 */
export const ISSUE_FOURNI = {
  titre: { fr: 'Téléchargez l’application, nous vous fournissons le numéro', en: 'Download the app, we provide the number' },
  textes: [
    {
      fr: 'Installez l’application WhatsApp Business sur votre téléphone et créez-y votre compte avec le numéro que nous vous fournissons, 3,50 € HT par mois en formule Free, inclus en formule Pro : son code de vérification s’affiche sur la page de Messaging Me.',
      en: 'Install the WhatsApp Business app on your phone and create your account there with the number we provide, €3.50 excl. VAT a month with the Free plan, included in Pro: its verification code shows on the Messaging Me page.',
    },
    {
      fr: 'Dès le premier jour, vous répondez à vos clients depuis l’application. Puis branchez le numéro en gardant l’application, pour que vos confirmations, rappels et relances partent aussi de Messaging Me.',
      en: 'From day one, you reply to your customers from the app. Then connect the number while keeping the app, so your confirmations, reminders and follow-ups also go out from Messaging Me.',
    },
  ],
} as const;

/** La réponse à la question du compte Meta Business. */
export type ReponseCompte = 'oui' | 'non' | 'nsp';
