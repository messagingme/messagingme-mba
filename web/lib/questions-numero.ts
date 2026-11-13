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
  /** Le lien vers la grille des formules de la vitrine (2026-11-13, à la place de « Vous pourrez en changer plus tard »). */
  precision: { fr: 'Pour comparer les formules', en: 'Compare the plans' },
  tarifs: { fr: 'https://app.messagingme.fr/tarifs/', en: 'https://app.messagingme.fr/en/pricing/' },
} as const satisfies Record<string, Texte>;

/** Les quatre formules d'un espace, dans l'ordre de la vitrine. */
export type FormuleChoisie = 'free' | 'pro' | 'business' | 'entreprise';

export const CARTES_OFFRE: ReadonlyArray<{
  readonly offre: FormuleChoisie; readonly libelle: Texte; readonly titre: Texte; readonly badge?: Texte;
  /** Le prix en grand, son unité dessous, et une ligne au pied (Free : ce qu'il faut pour s'en servir), 2026-11-13. */
  readonly prix: Texte; readonly unite?: Texte; readonly note?: Texte;
  readonly plus: readonly Texte[]; readonly moins: readonly Texte[];
}> = [
  {
    offre: 'free', libelle: { fr: 'Free', en: 'Free' }, titre: { fr: 'Free', en: 'Free' },
    prix: { fr: '0 €', en: '€0' }, unite: { fr: 'sans limite de durée', en: 'with no time limit' },
    note: { fr: 'Besoin d’un IDE ou de Claude Code / Codex', en: 'Needs an IDE or Claude Code / Codex' },
    plus: [], moins: [],
  },
  {
    offre: 'pro', libelle: { fr: 'Pro', en: 'Pro' }, titre: { fr: 'Pro', en: 'Pro' },
    badge: { fr: '14 jours d’essai gratuit', en: '14-day free trial' },
    prix: { fr: '49 €', en: '€49' }, unite: { fr: 'par mois', en: 'a month' },
    plus: [], moins: [],
  },
  {
    offre: 'business', libelle: { fr: 'Business', en: 'Business' }, titre: { fr: 'Business', en: 'Business' },
    prix: { fr: '349 €', en: '€349' }, unite: { fr: 'par mois', en: 'a month' },
    plus: [], moins: [],
  },
  {
    offre: 'entreprise', libelle: { fr: 'Entreprise', en: 'Enterprise' }, titre: { fr: 'Entreprise', en: 'Enterprise' },
    prix: { fr: 'Sur devis', en: 'On quote' },
    plus: [], moins: [],
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
  // La console n'a pas d'emoji (tests/web-icones.test.ts) : la vitrine ajoute le sien.
  precision: { fr: 'Eh oui, Meta facture chaque modèle que vous envoyez', en: 'Yes, Meta bills each template you send' },
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
    titre: { fr: 'Ligne de crédit', en: 'Credit line' },
    texte: {
      fr: 'Vous prépayez vos messages chez Messaging Me, sans carte chez Meta : 30 € par numéro et par mois, avec la formule Pro ou Business.',
      en: 'You prepay your messages at Messaging Me, with no card at Meta: €30 per number per month, with the Pro or Business plan.',
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
  // Les réponses disent ce que la personne a ou n'a pas (Julien, 2026-11-13) : « Le mien » / « Le vôtre » ne se
  // comprenaient pas sous la carte. Les clés restent `mien` et `notre` (attributs de test, état de la carte).
  mien: { fr: 'J’utilise un numéro existant', en: 'I’ll use an existing number' },
  notre: { fr: 'J’ai besoin d’un numéro', en: 'I need a number' },
  // Le titre de la carte chez Meta s'y cite tel quel : il se lit dans `QUESTION_PAIEMENT`, jamais recopié (jaune 5 de la
  // relecture du lot 3v).
  application: {
    fr: `Avec la ligne de crédit, il n’y marchera plus : vos clients vous écriront dans Messaging Me, et vous leur répondrez là (la console ou Claude). Pour garder l’application : « ${QUESTION_PAIEMENT.carte.titre.fr} », ou un numéro de chez nous.`,
    en: `With the credit line, it will no longer work there: your customers will write to you in Messaging Me, and you will reply there (the console or Claude). To keep the app: “${QUESTION_PAIEMENT.carte.titre.en}”, or a number from us.`,
  },
} as const satisfies Record<string, Texte>;

// Les conditions de la fenêtre du partenaire vivent avec celles de la carte (lot 3v-2b) : le serveur MCP les lit aussi.
export { NUMERO_LIGNE_MIEN, PREREQUIS_LIGNE } from './partage/etapes-meta';

/** Les voies qui gardent l'application WhatsApp Business : le Crédit WhatsApp n'y est pas possible (spec, décision 8). */
export const NOTE_CARTE_APPLICATION: Texte = {
  fr: 'Vous payez Meta avec votre carte : la ligne de crédit n’est pas possible avec l’application.',
  en: 'You pay Meta with your card: the credit line is not possible with the app.',
};

/**
 * Au moment de payer l'option, quand tous les numéros de l'espace gardent l'application (décision 8) : la carte
 * « Crédit WhatsApp » (`QuiRegleMeta`) et l'onglet Crédit WhatsApp le disent pareil.
 */
export const AVERTISSEMENT_APPLICATION: Texte = {
  fr: 'Vos numéros connectés gardent l’application WhatsApp Business : ils restent payés par votre carte chez Meta, la ligne de crédit n’est pas possible avec l’application. L’option sert à connecter un nouveau numéro, sans l’application.',
  en: 'Your connected numbers keep the WhatsApp Business app: they stay paid by your card at Meta, the credit line is not possible with the app. The option is for connecting a new number, without the app.',
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

/**
 * Sans compte Meta Business (ou sans le savoir). « Non » mène tout droit à la question du numéro : on ne fait plus
 * télécharger l'application (Julien, 2026-11-12), le numéro se relie en numéro API et la fenêtre de Meta crée le compte.
 */
export const QUESTION_APPLICATION = {
  texte: { fr: 'Avez-vous déjà l’application WhatsApp Business ?', en: 'Do you already have the WhatsApp Business app?' },
  precision: { fr: 'L’application des professionnels, distincte de WhatsApp.', en: 'The app for businesses, separate from WhatsApp.' },
  oui: { fr: 'Oui', en: 'Yes' },
  non: { fr: 'Non', en: 'No' },
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

/**
 * UN NUMÉRO DE CHEZ NOUS, RELIÉ PAR LA FENÊTRE DE META (mode `fourni`) : le titre et la première phrase de l'issue
 * `fourni` de la vitrine (Julien, 2026-11-12 : sans compte Meta Business, ni application, ni numéro ; la fenêtre de Meta
 * crée le compte en chemin). Le cas 4 (`ISSUE_AUTRE_NUMERO`) dit la même chose, plus ce que garde l'application.
 */
export const ISSUE_FOURNI = {
  titre: { fr: 'Un numéro de chez nous, relié par Meta', en: 'A number from us, connected through Meta' },
  texte: {
    fr: 'Nous vous fournissons un numéro, 3,50 € par mois en formule Free, inclus en formule Pro : la fenêtre de Meta le relie à l’API officielle de WhatsApp, il envoie vos messages, et votre agent IA répond.',
    en: 'We provide a number, €3.50 a month with the Free plan, included in Pro: Meta’s window connects it to the official WhatsApp API, it sends your messages, and your AI agent answers.',
  },
} as const satisfies Record<string, Texte>;

/** Le cas 4, Non : le titre et la première phrase de l'issue de la vitrine ; le bouton ouvre le numéro fourni (`fourni`). */
export const ISSUE_AUTRE_NUMERO = {
  titre: ISSUE_FOURNI.titre,
  texte: {
    fr: `${ISSUE_FOURNI.texte.fr} Votre application WhatsApp Business garde le sien.`,
    en: `${ISSUE_FOURNI.texte.en} Your WhatsApp Business app keeps its own.`,
  },
} as const satisfies Record<string, Texte>;

/** WHATSAPP ORDINAIRE (lot 3a) : la phrase vit dans la source partagée, que lisent aussi la 3e condition chez Meta et Claude. */
export { WHATSAPP_ORDINAIRE } from './partage/etapes-meta';

/**
 * Les fiches officielles de WhatsApp Business, sous la phrase de WhatsApp ordinaire (on l'installe sur le même téléphone
 * pour reprendre le numéro), celles de l'issue `garder` de la vitrine (`MAGASINS`), avec leur icône (`@/lib/icones`).
 */
export const MAGASINS_APPLICATION = [
  { libelle: { fr: 'App Store (iPhone)', en: 'App Store (iPhone)' }, href: 'https://apps.apple.com/app/whatsapp-business/id1386412985', icone: 'appstore' },
  { libelle: { fr: 'Google Play (Android)', en: 'Google Play (Android)' }, href: 'https://play.google.com/store/apps/details?id=com.whatsapp.w4b', icone: 'googleplay' },
] as const;

/**
 * Sans compte Meta Business ni application (Julien, 2026-10-31, revu le 2026-11-12) : a-t-on un numéro ? Oui, le numéro
 * API (`ISSUE_API`) ; Non, un numéro de chez nous relié par la fenêtre de Meta (`ISSUE_FOURNI`). Plus rien ne va DANS
 * l'application.
 */
export const QUESTION_NUMERO = {
  texte: { fr: 'Avez-vous déjà un numéro que vous pourriez utiliser ?', en: 'Do you already have a number you could use?' },
  precision: { fr: 'Le numéro de votre entreprise, relié à l’API officielle de WhatsApp.', en: 'Your business’s number, connected to the official WhatsApp API.' },
  oui: { fr: 'Oui', en: 'Yes' },
  non: { fr: 'Non', en: 'No' },
} as const satisfies Record<string, Texte>;

/**
 * Avec un compte Meta Business, ou sans l'application avec un numéro : le numéro API, et la ligne qui rappelle qu'on
 * peut garder son application (WhatsApp ordinaire y passe d'abord).
 */
export const ISSUE_API = {
  titre: { fr: 'Votre numéro API', en: 'Your API number' },
  garder: { fr: 'Votre numéro sert déjà dans WhatsApp ou dans l’application WhatsApp Business ?', en: 'Is your number already used in WhatsApp or in the WhatsApp Business app?' },
  lien: { fr: 'Vous pouvez le garder', en: 'You can keep it' },
} as const satisfies Record<string, Texte>;

/**
 * LA REPRISE D'UN NUMÉRO FOURNI MIS DANS L'APPLICATION (mode `fourni_application`, le « parcours C ») : l'arbre ne le
 * propose plus depuis le 2026-11-12, mais un numéro déjà attribué ainsi (le lien de Claude, ou la mémoire de l'onglet)
 * reprend là où il en était, avec ce qu'il permet et la suite. Plus aucun chiffre de jours : un numéro neuf passe en
 * coexistence sans attendre (testé, Julien, 2026-11-11).
 */
export const SUITE_FOURNI_APPLICATION: Texte = {
  fr: 'Dès le premier jour, vous répondez à vos clients depuis l’application. Puis branchez le numéro en gardant l’application, pour que vos confirmations, rappels et relances partent aussi de Messaging Me.',
  en: 'From day one, you reply to your customers from the app. Then connect the number while keeping the app, so your confirmations, reminders and follow-ups also go out from Messaging Me.',
};

/** La réponse à la question du compte Meta Business. */
export type ReponseCompte = 'oui' | 'non' | 'nsp';
