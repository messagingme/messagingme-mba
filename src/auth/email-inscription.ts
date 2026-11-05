import { renderBrandedEmail } from '../support/email-templates';
import { escapeHtml } from '../crm/render';
import { HEURES_LIEN_INSCRIPTION } from '../../web/lib/partage/inscription';

/**
 * L'E-MAIL DU LIEN D'INSCRIPTION (lot identité B). Il part vers une adresse saisie par n'importe qui, qui n'a peut-être
 * rien demandé : 🔴 il ne reprend AUCUN texte saisi (ni nom d'espace, ni nom), sinon nos e-mails transporteraient le
 * message d'un anonyme, signé Messaging Me. Au vouvoiement, comme la console, en français ou en anglais selon la langue
 * de la page qui a fait la demande. Sans « Business Agent » dans l'en-tête : c'est le nom du produit de Meta.
 */

/** L'étiquette Resend de ces e-mails, que le webhook de Resend lit pour compter leurs rebonds et leurs plaintes. */
export const ETIQUETTE_INSCRIPTION = { name: 'categorie', value: 'inscription' } as const;

export interface EmailInscription {
  subject: string;
  text: string;
  html: string;
  tags: Array<{ name: string; value: string }>;
}

const TEXTES = {
  fr: {
    sujet: 'Confirmez votre adresse pour créer votre espace Messaging Me',
    titre: 'Créez votre espace Messaging Me',
    corps: 'Une demande de création d’un espace Messaging Me a été faite avec cette adresse. Pour créer votre espace, ouvrez ce lien : vous y choisirez son nom et votre mot de passe.',
    duree: `Le lien est valable ${HEURES_LIEN_INSCRIPTION} heures et ne sert qu’une fois.`,
    ignorer: 'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : rien ne sera créé.',
    bouton: 'Créer mon espace',
    secours: 'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
    pied: 'Messaging Me, la plateforme conversationnelle WhatsApp.',
  },
  en: {
    sujet: 'Confirm your address to create your Messaging Me workspace',
    titre: 'Create your Messaging Me workspace',
    corps: 'A request to create a Messaging Me workspace was made with this address. To create your workspace, open this link: you will choose its name and your password there.',
    duree: `The link is valid for ${HEURES_LIEN_INSCRIPTION} hours and works only once.`,
    ignorer: 'If you did not make this request, ignore this message: nothing will be created.',
    bouton: 'Create my workspace',
    secours: 'If the button does not work, copy this link into your browser:',
    pied: 'Messaging Me, the WhatsApp conversational platform.',
  },
} as const;

/** Le lien de la page qui consomme le jeton : jeton dans le chemin, comme `/reset`, éprouvé par les messageries. */
export function lienInscription(appUrl: string, jeton: string, langue: 'fr' | 'en'): string {
  return `${appUrl.replace(/\/+$/, '')}/signup/confirm/${encodeURIComponent(jeton)}?lang=${langue}`;
}

export function emailInscription(langue: 'fr' | 'en', lien: string): EmailInscription {
  const t = TEXTES[langue];
  return {
    subject: t.sujet,
    text: `${t.corps}\n\n${lien}\n\n${t.duree}\n${t.ignorer}`,
    html: renderBrandedEmail({
      title: t.titre,
      bodyHtml: `<p>${escapeHtml(t.corps)}</p><p>${escapeHtml(t.ignorer)}</p>`,
      ctaLabel: t.bouton,
      ctaUrl: lien,
      preheader: t.duree,
      footnote: t.duree,
      phrases: { lang: langue, secours: t.secours, pied: t.pied },
      sousTitre: null,
    }),
    tags: [{ ...ETIQUETTE_INSCRIPTION }],
  };
}
