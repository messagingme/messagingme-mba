/**
 * CE QU'IL FAUT CHEZ META, ÉCRIT UNE SEULE FOIS (le guide « compte Meta », décision de Julien du 2026-10-13). La page
 * « Connecter WhatsApp » (`ParcoursNumero`), le bandeau de l'Accueil et les outils MCP (`start_whatsapp_connection`,
 * `get_setup_state`) lisent ces textes : la console et Claude ne peuvent pas dire deux choses différentes.
 *
 * Sources relues le 2026-10-13 : la doc Embedded Signup de Meta (connexion par des identifiants Facebook ou Meta
 * Business, portefeuille et compte WhatsApp créables dans la fenêtre, numéro hors de l'application WhatsApp), l'aide
 * « Créer un portefeuille business » (1710077379203657) et « Ajouter une carte de crédit à votre compte sur la
 * plateforme WhatsApp Business » (488291839463771). Les libellés entre guillemets sont ceux des écrans de Meta.
 */

/** Avant de connecter un numéro. */
export const PREREQUIS_META: ReadonlyArray<{ fr: string; en: string }> = [
  {
    fr: 'Un compte Meta Business, c’est-à-dire un portefeuille d’entreprise (l’ancien Business Manager) : c’est lui qui '
      + 'portera votre compte WhatsApp, votre numéro et votre carte. Vous y entrez avec votre profil Facebook, ou avec '
      + 'un compte Meta géré par votre organisation.',
    en: 'A Meta Business account, that is a business portfolio (formerly Business Manager): it will hold your WhatsApp '
      + 'account, your number and your card. You sign in with your Facebook profile, or with a managed Meta account from '
      + 'your organization.',
  },
  {
    // Mesuré à l'essai 161 (2026-10-25) : la fenêtre de Meta fait créer le portefeuille en chemin (« Créez un
    // portefeuille business » : nom, e-mail, pays, site), puis propose « Ajouter un moyen de paiement ».
    fr: 'Pas encore de portefeuille ? Rien à préparer : la fenêtre de Meta vous le fait créer en chemin, avec votre '
      + 'profil Facebook (le nom de votre entreprise, une adresse e-mail, le pays et le site), puis vous propose un moyen '
      + 'de paiement. Vous pouvez aussi le créer avant, sur business.facebook.com : ouvrez le menu sous « Accueil » en '
      + 'haut à gauche, puis créez un portefeuille business.',
    en: 'No portfolio yet? Nothing to prepare: Meta’s window has you create it along the way, with your Facebook profile '
      + '(your business name, an email address, the country and the website), then offers a payment method. You can '
      + 'also create it beforehand on business.facebook.com: open the menu under “Home” at the top left, then create a '
      + 'business portfolio.',
  },
  {
    // Le numéro de l'application WhatsApp Business peut y rester (la coexistence de Meta, en production depuis le
    // 2026-10-25) : c'est le bouton de la page, `COEXISTENCE_BOUTON` (`web/lib/fenetre-meta.ts`), dont le nom est cité.
    fr: 'Un numéro libre, qui ne sert pas dans l’application WhatsApp, ou celui de votre application WhatsApp Business, '
      + 'qui y reste avec « Garder mon application WhatsApp Business ». Pas de numéro libre ? Nous vous en fournissons un.',
    en: 'A spare number, not used in the WhatsApp app, or the number of your WhatsApp Business app, which stays in it '
      + 'with “Keep my WhatsApp Business app”. No spare number? We provide one.',
  },
];

/**
 * QUI PAIE QUOI, SELON LE CHEMIN (aide à la connexion, lot 1, 2026-11-09, demande de Julien : « être moins systématique
 * sur le fait que ça sera payant »). Avec l'application gardée, ce que la personne y tape reste gratuit ; sur un numéro
 * API, tout passe par Messaging Me. Source des réponses facturées : la page Pricing de Meta, relue le 2026-10-29 (fin du
 * service gratuit le 2026-10-01, franchise de 1 000 messages livrés par mois et par numéro). Aucun prix ici.
 */
export const CE_QUI_EST_FACTURE: {
  readonly application: { readonly fr: string; readonly en: string };
  readonly api: { readonly fr: string; readonly en: string };
} = {
  application: {
    fr: 'Ce que vous tapez dans l’application WhatsApp Business reste gratuit. Ce que Messaging Me envoie pour vous (vos '
      + 'modèles, et les réponses au-delà de la franchise mensuelle de Meta) est facturé par Meta, sur une carte à poser '
      + 'chez Meta avant votre premier modèle.',
    en: 'What you type in the WhatsApp Business app stays free. What Messaging Me sends for you (your templates, and '
      + 'replies beyond Meta’s monthly allowance) is billed by Meta, on a card to add at Meta before your first template.',
  },
  api: {
    // Le Crédit WhatsApp paie Meta sans carte (jaune 4 de la relecture du lot 1) : un numéro API n'est pas toujours sur
    // une carte, ce que la question « Qui paie vos messages à Meta ? » (`web/lib/questions-numero.ts`) dit déjà.
    fr: 'Tout ce qui part de ce numéro passe par Messaging Me : Meta facture vos modèles, et les réponses au-delà de sa '
      + 'franchise mensuelle, sur une carte à poser chez Meta juste après la connexion, sauf avec le Crédit WhatsApp, qui '
      + 'les prépaie chez Messaging Me.',
    en: 'Everything this number sends goes through Messaging Me: Meta bills your templates, and replies beyond its monthly '
      + 'allowance, on a card to add at Meta right after the connection, except with WhatsApp credit, which prepays them '
      + 'at Messaging Me.',
  },
};

/** Après la connexion : la carte chez Meta, sans laquelle les modèles ne partent pas. */
export const ETAPES_CARTE_META: ReadonlyArray<{ fr: string; en: string }> = [
  {
    fr: 'Sur business.facebook.com, ouvrez le Gestionnaire WhatsApp, page « Vue d’ensemble ».',
    en: 'On business.facebook.com, open WhatsApp Manager, “Overview” page.',
  },
  {
    fr: 'Sur votre compte WhatsApp, cliquez sur les trois points, puis sur « Gérer les paramètres du compte ».',
    en: 'On your WhatsApp account, click the three dots, then “Manage account settings”.',
  },
  {
    fr: 'Dans l’onglet « Paramètres », ouvrez « Paramètres de paiement », puis « Ajouter un moyen de paiement ».',
    en: 'In the “Settings” tab, open “Payment settings”, then “Add payment method”.',
  },
  {
    fr: 'Saisissez une carte Visa ou Mastercard (Meta n’accepte ni American Express ni PayPal), puis les informations de '
      + 'votre entreprise ; Meta peut demander vos informations fiscales.',
    en: 'Enter a Visa or Mastercard card (Meta accepts neither American Express nor PayPal), then your business '
      + 'details; Meta may ask for your tax information.',
  },
  {
    fr: 'Il faut être propriétaire du compte WhatsApp, ou avoir le droit « Gérer le compte WhatsApp ». Sans carte '
      + 'valable, seules les réponses dans la fenêtre de 24 h partent : les modèles (campagnes, relances) sont bloqués.',
    en: 'You must own the WhatsApp account, or have the “Manage WhatsApp account” permission. Without a valid card, only '
      + 'replies within the 24-hour window go out: templates (campaigns, follow-ups) are blocked.',
  },
];
