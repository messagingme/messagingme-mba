/**
 * LES PAGES D'AIDE QUE LE PRODUIT CITE (spec `docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md`, lots
 * 1, 4b et 5) : des adresses de la vitrine, en français et en anglais, que la consigne de `start_whatsapp_connection`,
 * `get_setup_state` (`aide`), la console, le questionnaire de la vitrine et les e-mails du produit lisent ici ; la skill
 * de mise en service n'en tape aucune. `tests/aide-connexion-adresses.test.ts` exige que chacune soit une page de
 * `site/` et figure au plan du site : une page renommée casserait le lien sans autre bruit.
 */
export const VITRINE_AIDE = 'https://app.messagingme.fr';

/** Une page d'aide, dans les deux langues de la vitrine. */
export interface AdresseAide { readonly fr: string; readonly en: string }

/** Le mode op « garder mon application WhatsApp Business » (fiche `garder-mon-application-whatsapp-business`). */
export const AIDE_GARDER_APPLICATION: AdresseAide = {
  fr: `${VITRINE_AIDE}/aide/garder-mon-application-whatsapp-business/`,
  en: `${VITRINE_AIDE}/en/help/keep-my-whatsapp-business-app/`,
};

/**
 * « Payer Meta » (lot 4a-2) : pourquoi Meta veut un moyen de paiement, où le poser, et le Crédit WhatsApp. C'est le lien
 * « Pourquoi un moyen de paiement ? » de la carte « Je mets un moyen de paiement (Visa / Mastercard) sur mon compte Meta
 * Business » (lot 3a, décision de Julien du 2026-11-09 ; « Payer Meta » depuis le lot 4b), avec, à côté, ce qu'est un
 * compte Meta Business.
 */
export const AIDE_PAYER_META: AdresseAide = {
  fr: `${VITRINE_AIDE}/aide/payer-meta-poser-votre-carte/`,
  en: `${VITRINE_AIDE}/en/help/pay-meta-add-your-card/`,
};
export const AIDE_COMPTE_META_BUSINESS: AdresseAide = {
  fr: `${VITRINE_AIDE}/aide/ce-qu-il-faut-chez-meta/`,
  en: `${VITRINE_AIDE}/en/help/what-you-need-at-meta/`,
};

/** Le guide du numéro (lot 4a) : l'arbre de `/demarrer/`, de la console et de Claude, en page. */
export const AIDE_GUIDE: AdresseAide = {
  fr: `${VITRINE_AIDE}/aide/guide-du-numero-whatsapp/`,
  en: `${VITRINE_AIDE}/en/help/whatsapp-number-guide/`,
};

/** Le dépannage de la connexion du numéro (lot 4a), que Claude donne quand la personne bloque (lot 4b). */
export const AIDE_DEPANNAGE: AdresseAide = {
  fr: `${VITRINE_AIDE}/aide/depanner-la-connexion-du-numero/`,
  en: `${VITRINE_AIDE}/en/help/troubleshoot-the-number-connection/`,
};

/** Les fiches publiques que les e-mails du produit citent sous leur bouton (lot 5). */
export const AIDE_AGENT_IA: AdresseAide = {
  fr: `${VITRINE_AIDE}/aide/construire-un-agent-ia/`,
  en: `${VITRINE_AIDE}/en/help/build-an-ai-agent/`,
};
export const AIDE_BULLE: AdresseAide = {
  fr: `${VITRINE_AIDE}/aide/poser-une-bulle-whatsapp-sur-mon-site/`,
  en: `${VITRINE_AIDE}/en/help/put-a-whatsapp-bubble-on-my-site/`,
};
export const AIDE_INBOX: AdresseAide = {
  fr: `${VITRINE_AIDE}/aide/repondre-dans-l-inbox/`,
  en: `${VITRINE_AIDE}/en/help/reply-in-the-inbox/`,
};
export const AIDE_OFFRE: AdresseAide = {
  fr: `${VITRINE_AIDE}/aide/choisir-mon-offre/`,
  en: `${VITRINE_AIDE}/en/help/choose-my-plan/`,
};
export const AIDE_SHOPIFY: AdresseAide = {
  fr: `${VITRINE_AIDE}/aide/brancher-ma-boutique-shopify/`,
  en: `${VITRINE_AIDE}/en/help/connect-my-shopify-store/`,
};

/** Toutes les adresses de ce fichier, pour le test qui les vérifie. */
export const ADRESSES_AIDE_CONNEXION: readonly string[] = [
  AIDE_GARDER_APPLICATION, AIDE_PAYER_META, AIDE_COMPTE_META_BUSINESS, AIDE_GUIDE, AIDE_DEPANNAGE,
  AIDE_AGENT_IA, AIDE_BULLE, AIDE_INBOX, AIDE_OFFRE, AIDE_SHOPIFY,
].flatMap((p) => [p.fr, p.en]);
