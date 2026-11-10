/**
 * LES PAGES D'AIDE QUE CLAUDE DONNE PENDANT LA CONNEXION DU NUMÉRO (spec `docs/superpowers/specs/2026-11-08-aide-
 * connexion-numero-design.md`, lot 1) : des adresses de la vitrine, en français et en anglais. Le lot 4b y ajoutera le
 * guide, le dépannage et les autres modes op. `tests/aide-connexion-adresses.test.ts` exige que chacune soit une page
 * de `site/` et figure au plan du site : une page renommée casserait le lien sans autre bruit.
 */
export const VITRINE_AIDE = 'https://app.messagingme.fr';

/** Le mode op « garder mon application WhatsApp Business » (fiche `garder-mon-application-whatsapp-business`). */
export const AIDE_GARDER_APPLICATION: { readonly fr: string; readonly en: string } = {
  fr: `${VITRINE_AIDE}/aide/garder-mon-application-whatsapp-business/`,
  en: `${VITRINE_AIDE}/en/help/keep-my-whatsapp-business-app/`,
};

/**
 * Les deux liens de la carte « Je mets un moyen de paiement (Visa / Mastercard) sur mon compte Meta Business » (lot 3a,
 * décision de Julien du 2026-11-09) : pourquoi Meta veut un moyen de paiement (la fenêtre de 24 heures et ce qui se
 * facture, en attendant la page des modèles du lot 4), et ce qu'est un compte Meta Business.
 */
export const AIDE_POURQUOI_PAIEMENT: { readonly fr: string; readonly en: string } = {
  fr: `${VITRINE_AIDE}/aide/la-fenetre-de-24-heures/`,
  en: `${VITRINE_AIDE}/en/help/the-24-hour-window/`,
};
export const AIDE_COMPTE_META_BUSINESS: { readonly fr: string; readonly en: string } = {
  fr: `${VITRINE_AIDE}/aide/ce-qu-il-faut-chez-meta/`,
  en: `${VITRINE_AIDE}/en/help/what-you-need-at-meta/`,
};

/** Toutes les adresses de ce fichier, pour le test qui les vérifie. */
export const ADRESSES_AIDE_CONNEXION: readonly string[] = [
  AIDE_GARDER_APPLICATION.fr, AIDE_GARDER_APPLICATION.en,
  AIDE_POURQUOI_PAIEMENT.fr, AIDE_POURQUOI_PAIEMENT.en,
  AIDE_COMPTE_META_BUSINESS.fr, AIDE_COMPTE_META_BUSINESS.en,
];
