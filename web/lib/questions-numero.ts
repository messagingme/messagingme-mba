/**
 * LES QUESTIONS DU NUMÉRO DANS LA CONSOLE (2026-10-30, plan `docs/superpowers/plans/2026-10-30-tunnel-numero-console-plugin.md`) :
 * celles du tunnel de la vitrine (`scripts/vitrine/tunnel-textes.ts`, l'arbre de Julien), à partir de la deuxième, car
 * l'espace a déjà son offre. `tests/questions-numero-vitrine.test.ts` les tient égales à la vitrine, au mot près, et la
 * skill `mise-en-service` du plugin pose les mêmes. Plus aucune voie par QR code.
 */
type Texte = { readonly fr: string; readonly en: string };

/** Où vérifier qu'on a un compte Meta Business : la console en fait un lien, la vitrine aussi. */
export const META_BUSINESS_URL = 'https://business.facebook.com/';

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
  garder: { fr: 'Votre numéro est déjà dans l’application WhatsApp Business ?', en: 'Is your number already in the WhatsApp Business app?' },
  lien: { fr: 'Vous pouvez la garder', en: 'You can keep it' },
} as const satisfies Record<string, Texte>;

/**
 * Sans l'application : la télécharger, puis brancher TOUT DE SUITE en la gardant (Julien, 2026-10-30) ; si Meta refuse un
 * numéro trop neuf, revenir quelques jours plus tard. Meta ne publie aucun seuil : aucun nombre de jours.
 */
export const ISSUE_TELECHARGER = {
  titre: { fr: 'Téléchargez l’application WhatsApp Business', en: 'Download the WhatsApp Business app' },
  textes: [
    {
      fr: 'Installez l’application WhatsApp Business sur un téléphone, avec le numéro de votre entreprise, puis branchez-le tout de suite en gardant l’application : votre numéro reste sur votre téléphone et envoie aussi depuis Messaging Me.',
      en: 'Install the WhatsApp Business app on a phone, with your business’s number, then connect it right away while keeping the app: your number stays on your phone and also sends from Messaging Me.',
    },
    {
      fr: 'Meta refuse parfois un numéro trop neuf : servez-vous alors de l’application quelques jours, puis revenez le brancher.',
      en: 'Meta sometimes refuses a number that is too new: then use the app for a few days, and come back to connect it.',
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
 * branche en la gardant. Les trois phrases de la vitrine que la console reprend : le numéro et son code, répondre dès le
 * premier jour, et le numéro tout neuf que Meta refuse souvent (aucun nombre de jours).
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
    {
      fr: 'Meta refuse souvent un numéro tout neuf : l’envoi de vos messages depuis Messaging Me attend alors quelques jours, le temps de revenir le brancher, et vous répondez à vos clients depuis l’application en attendant.',
      en: 'Meta often refuses a brand-new number: sending your messages from Messaging Me then waits a few days, until you come back to connect it, and you reply to your customers from the app in the meantime.',
    },
  ],
} as const;

/** La réponse à la question du compte Meta Business. */
export type ReponseCompte = 'oui' | 'non' | 'nsp';
