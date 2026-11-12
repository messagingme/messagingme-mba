// scripts/vitrine/tunnel-textes.ts
// Les textes du tunnel du numéro WhatsApp, en français et en anglais : l'arbre de Julien du 2026-10-30, le même sur
// chaque page qui le porte (la page « Démarrer », Boutiques Shopify, SaaS et app builders), que `tunnel.ts` assemble.
// Plan `docs/superpowers/plans/2026-10-30-tunnel-numero-generique.md`. Le 2026-10-31, Julien y ajoute une quatrième
// question : sans compte Meta Business ni application, « Avez-vous déjà un numéro ? ». Le 2026-11-06, une cinquième, juste
// après l'offre : qui paie Meta (révision du Crédit WhatsApp, lot B). La vente du Crédit WhatsApp est ouverte depuis le
// 2026-11-11 (lot 3v-2) : sa réponse dit où il se prend, la console. Le 2026-11-12 (plan
// `docs/superpowers/plans/2026-11-12-arbre-numero-sans-application.md`), sans compte Meta Business ni application, on ne
// fait plus télécharger l'application : un numéro, le numéro API ; aucun, un numéro de chez nous relié par la fenêtre de
// Meta, qui crée le compte en chemin. Plus de numéro fourni mis dans l'application.
//
// 🔴 CE QUE LE TUNNEL NE DIT PLUS : le numéro relié par code, qui ne faisait que répondre (Julien, 2026-10-30 : « on
// supprime une bonne fois pour toutes l'option QR code »). Chaque voie mène à un numéro de l'API officielle, et
// l'application WhatsApp Business se garde. Ni « QR code » ni « coexistence » face au visiteur, ni « boutique » dans
// les questions : seule la demande à coller s'adapte à la page d'origine (`Origine`).
// Les chiffres viennent du code : les offres de `src/offres/offres.ts`, le numéro fourni de `src/stripe/abonnement.ts`
// (`PRIX_NUMERO_AFFICHE_HT_CENTIMES`, gardé égal par `tests/vitrine-tunnel.test.ts`).
// Les textes sont du HTML écrit par nous (`&nbsp;` compris) ; le français reçoit ses espaces insécables à l'assemblage.

import { DROITS, ESSAI_PRO_JOURS, PRIX_BUSINESS_HT_CENTIMES, PRIX_PRO_HT_CENTIMES } from '../../src/offres/offres';
import { PRIX_OPTION_WA_HT_CENTIMES } from '../../src/stripe/option-credit-whatsapp';
import { AIDE_COMPTE_META_BUSINESS, AIDE_PAYER_META } from '../../web/lib/partage/aide-connexion';
import { ETAPES_NUMERO_FOURNI } from '../../web/lib/partage/etapes-numero-fourni';
import type { Langue } from './cas-textes';

/** Le chemin d'une page de la vitrine, depuis son adresse partagée avec la console et Claude (lot 4b). */
const chemin = (adresse: string): string => new URL(adresse).pathname;

/**
 * L'onglet Crédit WhatsApp de la page Offre de la console, où l'option se prend depuis l'ouverture de la vente (lot 3v-2).
 * `&amp;` : elle entre dans du HTML (la réponse du tunnel, le lien de « Payer Meta »), qui ne passe pas par l'outil anglais.
 */
export const OFFRE_CREDIT_WHATSAPP: Readonly<Record<Langue, string>> = {
  fr: 'https://console.messagingme.app/offre?tab=whatsapp',
  en: 'https://console.messagingme.app/offre?tab=whatsapp&amp;lang=en',
};

/**
 * Le code du numéro fourni par la fenêtre de Meta, en deux phrases de la source unique (aide à la connexion, lots 2c
 * et 3a) : l'étape de l'appel (« Phone call », surtout pas « Text message ») et celle du code qui s'affiche sur la page.
 */
const codeParLAppel = (langue: Langue): string => {
  const appel = ETAPES_NUMERO_FOURNI.find((e) => e.insiste)!;
  const code = ETAPES_NUMERO_FOURNI[ETAPES_NUMERO_FOURNI.indexOf(appel) + 1]!;
  return `${appel[langue]} ${code[langue]}`;
};

/** Le numéro fourni, en centimes HT par mois : la valeur de `PRIX_NUMERO_HT_CENTIMES`, gardée égale par le test. */
export const PRIX_NUMERO_AFFICHE_HT_CENTIMES = 350;

export const euros = (centimes: number, langue: Langue): string => {
  const entier = centimes % 100 === 0;
  const n = (centimes / 100).toFixed(entier ? 0 : 2);
  return langue === 'fr' ? `${n.replace('.', ',')}&nbsp;€` : `€${n}`;
};
/** Une limite chiffrée de l'offre ; une limite absente (illimitée) n'a rien à faire dans une phrase qui la chiffre. */
export const limite = (offre: 'base' | 'pro', nom: 'contacts' | 'envoisModelesMois' | 'utilisateurs'): number => {
  const v = DROITS[offre].limites[nom];
  if (v === null) throw new Error(`tunnel-textes : ${offre}.${nom} est illimité`);
  return v;
};
/** Une phrase du numéro qui ne dépend pas de l'offre. */
const memes = (p: string): Readonly<Record<OffreTunnel, string>> => ({ free: p, pro: p });
export const milliers = (n: number, langue: Langue): string =>
  (langue === 'fr' ? n.toLocaleString('fr-FR').replace(/\s/g, '&nbsp;') : n.toLocaleString('en-US'));
/** L'icône de l'application WhatsApp Business (la bulle au « + »), à côté de la question qui la nomme. */
const LOGO_APPLICATION = '/img/logos/whatsapp-business.png';
const META_BUSINESS = '<a href="https://business.facebook.com/" rel="noopener">business.facebook.com</a>';
/** Les fiches officielles de l'application WhatsApp Business (vérifiées le 2026-10-30 : 200, « WhatsApp Business App »). */
export const MAGASINS = {
  appStore: 'https://apps.apple.com/app/whatsapp-business/id1386412985',
  googlePlay: 'https://play.google.com/store/apps/details?id=com.whatsapp.w4b',
  metaBusiness: 'https://business.facebook.com/',
} as const;

/** La page qui porte le tunnel : la demande à coller en dépend, jamais les questions. */
export type Origine = 'generique' | 'shopify' | 'saas';
/** Les formules qui se branchent depuis le tunnel ; Business et Entreprise se décident avec nous (Julien, 2026-10-30). */
export type OffreTunnel = 'free' | 'pro';
export type FormuleTunnel = OffreTunnel | 'business' | 'entreprise';
/** Un lien externe, sous un mot du lexique ou dans une issue (les magasins d'applications, le compte Meta Business). */
export interface Lien { readonly libelle: string; readonly href: string }
/** Les icônes des deux magasins (Simple Icons, CC0), devant leur libellé : Julien, 2026-10-31, « les 2 petites icônes ». */
const ICONES: Readonly<Record<string, string>> = {
  [MAGASINS.appStore]: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>',
  [MAGASINS.googlePlay]: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.018 13.298l-3.919 2.218-3.515-3.493 3.543-3.521 3.891 2.202a1.49 1.49 0 0 1 0 2.594zM1.337.924a1.486 1.486 0 0 0-.112.568v21.017c0 .217.045.419.124.6l11.155-11.087L1.337.924zm12.207 10.065l3.258-3.238L3.45.195a1.466 1.466 0 0 0-.946-.179l11.04 10.973zm0 2.067l-11 10.933c.298.036.612-.016.906-.183l13.324-7.54-3.23-3.21z"/></svg>',
};
/** Un lien externe en bouton, son icône devant quand il en a une : la note de l'application, les issues et le lexique. */
export const lienHtml = (l: Lien): string => `<a class="bouton bouton-trait" href="${l.href}" rel="noopener">${ICONES[l.href] ?? ''}${l.libelle}</a>`;

/** Une réponse mène à une autre question ou à une issue (`vers`) ; sans `vers`, elle montre l'aide de sa question.
 * `note` : une phrase qui s'affiche sous la question quand on la choisit (où vérifier son compte Meta Business).
 * `offre` : la réponse choisit la formule, et chaque issue ne montre ensuite que les boutons de cette formule.
 * `grisee` : la réponse ne se choisit pas dans le tunnel pour ces formules, et dit pourquoi ou où (le Crédit WhatsApp, qui
 * se prend dans la console, lot 3v-2) ; sous sa carte, elle compte comme une réponse qui mène quelque part. */
export interface Reponse {
  readonly libelle: string; readonly vers?: string; readonly note?: string; readonly offre?: FormuleTunnel;
  readonly grisee?: Readonly<Partial<Record<FormuleTunnel, string>>>;
}
/** `voies` : des cartes côte à côte, et SOUS chacune la réponse de même rang (Julien, 2026-10-27 : sinon on ne sait
 * pas quel bouton va avec quelle carte) ; une réponse sans `vers` (« Je ne sais pas ») reste dessous. */
export interface Question { readonly id: string; readonly texte: string; readonly precision?: string; readonly aide?: string; readonly reponses: readonly Reponse[]; readonly voies?: readonly Voie[]; readonly logo?: string }
/**
 * Une carte d'un choix (une offre), avec ce qu'elle apporte et ce qu'elle coûte. `liens` : des liens texte sous ses
 * lignes (la carte du moyen de paiement chez Meta, aide à la connexion, lot 3a).
 */
export interface Voie {
  readonly titre: string; readonly plus: readonly string[]; readonly moins: readonly string[]; readonly liens?: readonly Lien[];
  /** Une mention mise en avant au-dessus du titre (l'essai du Pro, Julien, 2026-11-09 : « on comprend rien sinon »). */
  readonly badge?: string;
}
/**
 * Une issue : `situation` se lit sans script, quand toutes les issues s'affichent l'une sous l'autre. `autre` mène à une
 * autre issue (le numéro API rappelle qu'on peut garder son application) ; `liens` : des boutons vers l'extérieur (les
 * magasins d'applications). Une issue de branchement porte `numero`, ce que la demande à coller dit du numéro, par
 * formule (le numéro fourni n'a pas le même prix), et `pasAPas`, la fiche d'aide de ce chemin, pour Pro ; une issue
 * `contact` (Business et Entreprise) finit sur la démo et le contact, sans demande à coller.
 */
export type Issue = {
  readonly id: string; readonly situation: string; readonly titre: string; readonly textes: readonly string[];
  readonly autre?: { readonly question: string; readonly lien: string; readonly vers: string };
  readonly liens?: readonly Lien[];
} & (
  | { readonly contact?: undefined; readonly console?: undefined; readonly numero: Readonly<Record<OffreTunnel, string>>; readonly pasAPas: string }
  | { readonly contact: true; readonly console?: undefined; readonly numero?: undefined; readonly pasAPas?: undefined }
  // Le Pro par la console (lot 3c) : la création de l'espace et le pas-à-pas, sans demande à coller.
  | { readonly console: true; readonly contact?: undefined; readonly numero?: undefined; readonly pasAPas: string }
);
/** Un mot du lexique : le mot et sa phrase courte, visibles ; le détail et ses liens, au clic. */
export interface Mot { readonly terme: string; readonly court: string; readonly detail: string; readonly liens?: readonly Lien[] }

export interface TexteTunnel {
  readonly surtitre: string; readonly titre: readonly [string, string]; readonly chapeau: string;
  /** Les mots que personne ne comprend (Julien, 2026-10-24), repliés sous le tunnel, un par ligne et dépliables un à un
   * (Julien, 2026-10-30 : « ça donne pas envie de le lire »). Le titre ne compte pas les mots. */
  readonly lexique: { readonly titre: string; readonly termes: readonly Mot[] };
  readonly questions: readonly Question[]; readonly issues: readonly Issue[];
  readonly plus: string; readonly moins: string; readonly recommencer: string;
  /** Les flèches du carrousel des formules, sur le bureau. */
  readonly defiler: { readonly precedente: string; readonly suivante: string };
  /** L'étape en cours (`{n}` son rang, `{max}` le plus long parcours de l'arbre, que `tunnel.ts` calcule), et le mot
   * de l'issue. */
  readonly progression: string; readonly fin: string;
  /** Les mots des boutons de bout de tunnel : le titre de chaque offre, ses boutons, la demande et sa copie. */
  readonly appels: {
    readonly free: string; readonly pro: string; readonly plugin: string; readonly github: string;
    /** Le titre de la demande en Pro : `lien` mène au pas-à-pas du plugin, dont les étapes sont dans le bloc Free, caché. */
    /** Le titre du bloc Pro au bout de l'arbre : le Pro par Claude Code ou Codex (lot 3c), avec les trois étapes. */
    readonly proAssistant: string;
    readonly copier: string; readonly copie: string;
    readonly compte: string; readonly pasAPas: string;
    /** La fin de Business et Entreprise : son titre, la démo et le contact. */
    readonly equipe: string; readonly demo: string; readonly contacter: string;
    /**
     * LES TROIS ÉTAPES DE LA FREE AVANT LA DEMANDE (Julien, 2026-11-09 : « avant de lui filer le texte à copier coller
     * dans Claude Code, il faut lui (re)donner les étapes », puis « c'est illisible […] des logos Claude Code ou Codex
     * avec la commande en face […] puis des copies d'écran des écrans suivants, faut être visuel ») : installer le plugin,
     * le relier à Messaging Me, coller la demande, presque sans texte. `tunnel.ts` pose le logo de chaque assistant et, en
     * face, ce qu'on y tape (les commandes de `web/lib/demarrer.ts`, celles des manifestes du plugin), avec un indice de
     * deux ou trois mots (`claude`, `codex`) ; à l'étape 2, les écrans de la page d'autorisation qui s'ouvre ensuite.
     */
    readonly etapesFree: {
      readonly installer: { readonly titre: string; readonly claude: string; readonly codex: string };
      readonly relier: {
        readonly titre: string; readonly obligatoire: string; readonly claude: string; readonly codex: string;
        readonly navigateur: string;
        /** Ce que Codex voit sur la page d'autorisation, que le tunnel annonce (jaune de 76a0e2b4). */
        readonly codexNote: string;
        /** Le détour par e-mail, sa capture légendée (jaune de 76a0e2b4). */
        readonly detour: { readonly titre: string; readonly legende: string; readonly alt: string };
        /**
         * Les écrans de `/autoriser`, dans l'ordre : `site/img/demarrer/autoriser-<n>[-en].webp`, capturés sur la vraie
         * page par `web/e2e/captures/demarrer-autoriser.capture.ts` (`npm run aide:captures`).
         */
        readonly ecrans: readonly { readonly legende: string; readonly alt: string }[];
      };
      readonly coller: string;
    };
  };
  /** La demande à coller : son début (la page d'origine et l'offre), la phrase du numéro de l'issue, puis sa fin. */
  readonly demande: { readonly debut: Readonly<Record<Origine, Readonly<Record<OffreTunnel, string>>>>; readonly fin: Readonly<Record<Origine, string>> };
  /**
   * LE GUIDE DU CENTRE D'AIDE (lot 4a de l'aide à la connexion) : le même arbre, à partir de « Qui paie vos messages à
   * Meta ? », pour qui a déjà son offre. `{n}` : le plus long parcours depuis cette question, que `tunnel.ts` calcule.
   * Ses cinq points se lisent en tête, HORS du tunnel : c'est le seul endroit de la page qui nomme la coexistence, le mot
   * que l'on cherche (spec, choix de Claude). Sa fin : le pas-à-pas, la console, et la phrase à dire à Claude, sans le
   * prix (`retirer`), que Claude lit dans l'offre de l'espace.
   */
  readonly guide: {
    readonly adresse: string; readonly titre: string; readonly description: string; readonly chapeau: string;
    readonly points: { readonly titre: string; readonly liste: readonly string[] };
    readonly fin: { readonly pasAPas: string; readonly claude: string; readonly console: string };
    readonly demande: string; readonly retirer: string;
  };
}

const fr = (): TexteTunnel => {
  const numero = euros(PRIX_NUMERO_AFFICHE_HT_CENTIMES, 'fr');
  const offres: readonly Voie[] = [
    {
      titre: 'Free, 0&nbsp;€ d’abonnement',
      plus: ['Tout se fait en parlant à Claude Code ou Codex : votre numéro, votre agent IA, vos messages.', 'Sans limite de durée.'],
      moins: ['Pas de console : il faut un agent IA comme Claude Code ou Codex.', `${milliers(limite('base', 'contacts'), 'fr')} contacts et ${milliers(limite('base', 'envoisModelesMois'), 'fr')} modèles envoyés par mois.`],
    },
    {
      titre: `Pro, ${euros(PRIX_PRO_HT_CENTIMES.mois, 'fr')} HT par mois`,
      badge: `${ESSAI_PRO_JOURS}&nbsp;jours d’essai gratuit`,
      plus: ['La console : l’Inbox de l’équipe, les campagnes, les tableaux de bord.', 'Un numéro fourni, inclus.', `${ESSAI_PRO_JOURS}&nbsp;jours d’essai la première fois.`],
      moins: ['Une carte demandée dès l’essai.'],
    },
    // Business et Entreprise (Julien, 2026-10-30) : leur contenu est celui de la page Tarifs, tenue égale au code.
    {
      titre: `Business, ${euros(PRIX_BUSINESS_HT_CENTIMES.mois, 'fr')} HT par mois`,
      plus: ['Tout Pro, plus le Meta Business Agent et HubSpot.', `${DROITS.business.limites.utilisateurs}&nbsp;utilisateurs et un accompagnement les deux premiers mois.`],
      moins: ['Sur facture, après un échange avec nous.'],
    },
    {
      titre: 'Entreprise, sur devis',
      plus: ['Tout Business, plus le RCS, Salesforce et Dynamics, l’analyse des conversations et les publicités Click-to-WhatsApp.', 'Contacts, utilisateurs et webhooks à votre mesure.'],
      moins: ['Un devis selon votre volume.'],
    },
  ];
  const garder = 'Pas de compte Meta Business ? La fenêtre de Meta le crée en chemin, avec votre profil Facebook, puis vous propose un moyen de paiement.';
  // Qui paie Meta, juste après l'offre (révision du Crédit WhatsApp, lot B, textes validés par Julien le 2026-11-06).
  // La carte chez Meta, dite par Julien le 2026-11-09 (aide à la connexion, lot 3a), avec ses deux liens.
  const paiement: readonly Voie[] = [
    {
      titre: 'Je mets un moyen de paiement (Visa / Mastercard) sur mon compte Meta Business',
      plus: ['Meta vous facture vos modèles sur ce moyen de paiement.'],
      moins: [],
      liens: [
        { libelle: 'Pourquoi un moyen de paiement ?', href: chemin(AIDE_PAYER_META.fr) },
        { libelle: 'Qu’est-ce qu’un compte Meta Business ?', href: chemin(AIDE_COMPTE_META_BUSINESS.fr) },
      ],
    },
    {
      titre: 'Crédit WhatsApp',
      plus: [`Vous prépayez vos messages chez Messaging Me, sans carte chez Meta : ${euros(PRIX_OPTION_WA_HT_CENTIMES, 'fr')} HT par numéro et par mois, avec la formule Pro ou Business.`],
      moins: [],
    },
  ];
  const carteAvecApplication = 'Vous payez Meta avec votre carte : le Crédit WhatsApp n’est pas possible avec l’application.';
  // WhatsApp ordinaire (Julien, 2026-11-08, lot 3a) : le numéro passe dans WhatsApp Business, qui le reprend, puis se garde.
  const whatsappOrdinaire = 'Votre numéro sert dans WhatsApp, l’application ordinaire ? Installez WhatsApp Business sur le même téléphone : elle vous propose de reprendre ce numéro, avec vos conversations.';
  const magasins: readonly Lien[] = [{ libelle: 'App Store (iPhone)', href: MAGASINS.appStore }, { libelle: 'Google Play (Android)', href: MAGASINS.googlePlay }];
  // Un numéro de chez nous, relié par la fenêtre de Meta : le cas 4 et, sans compte ni application ni numéro, l'issue
  // `fourni` (2026-11-12) ; le cas 4 y ajoute ce que garde l'application.
  const deChezNous = 'Un numéro de chez nous, relié par Meta';
  const numeroDeChezNous = `Nous vous fournissons un numéro, ${numero} HT par mois en formule Free, inclus en formule Pro : la fenêtre de Meta le relie à l’API officielle de WhatsApp, il envoie vos messages, et votre agent IA répond.`;
  const metaFacture = 'Meta facture vos messages, et les réponses au-delà d’une franchise mensuelle : un moyen de paiement s’ajoute chez Meta.';
  return {
    surtitre: 'Votre numéro WhatsApp',
    titre: ['Votre branchement', 'commence ici.'],
    chapeau: 'En six questions au plus, sur votre formule, qui paie Meta, votre compte Meta Business, votre application WhatsApp Business et votre numéro, vous savez quoi faire.',
    lexique: {
      titre: 'Les mots de ce guide, expliqués',
      termes: [
        {
          terme: 'Le compte Meta Business', court: 'Le compte de votre entreprise chez Meta, l’ancien Business Manager.',
          detail: 'Si vous faites de la publicité sur Facebook ou Instagram, vous en avez sans doute un. Sinon, rien à préparer : il est gratuit, et la fenêtre de Meta vous le fait créer en chemin, avec votre profil Facebook.',
          liens: [{ libelle: 'Voir mon compte Meta Business', href: MAGASINS.metaBusiness }],
        },
        {
          terme: 'L’application WhatsApp Business', court: 'L’application des professionnels, distincte de WhatsApp.',
          detail: 'Elle s’installe sur un téléphone, avec le numéro de votre entreprise. Gardée, elle continue de vous servir pendant que Messaging Me envoie vos messages.',
          liens: magasins,
        },
        {
          terme: 'Le numéro API', court: 'Le numéro relié par Meta à l’API officielle de WhatsApp.',
          detail: 'C’est lui qui envoie vos messages (confirmations, rappels, relances), pilotés par Messaging Me. Meta facture ses messages.',
        },
        {
          terme: 'Garder votre application', court: 'Votre numéro reste dans l’application et envoie aussi depuis Messaging Me.',
          detail: 'Il devient aussi un numéro API : vous répondez toujours depuis votre téléphone, et vos confirmations, rappels et relances partent de Messaging Me.',
        },
      ],
    },
    // L'arbre de Julien du 2026-10-30 : l'offre, le compte Meta Business, puis l'application WhatsApp Business ; du
    // 2026-10-31 : sans application, le numéro, que nous fournissons à qui n'en a pas ; du 2026-11-06 : qui paie Meta,
    // juste après l'offre ; et du 2026-11-12 : sans application, plus rien à télécharger, le numéro se relie par Meta.
    questions: [
      {
        id: 'offre', texte: 'Quelle formule voulez-vous ?', precision: 'Vous pourrez en changer plus tard.',
        aide: 'Free se pilote uniquement depuis un agent IA comme Claude Code ou Codex : sans lui, Free ne marche pas. Sans agent IA, choisissez Pro : la console, pour vous et votre équipe, avec un numéro fourni.',
        voies: offres,
        reponses: [
          { libelle: 'Free', vers: 'paiement', offre: 'free' },
          { libelle: 'Pro', vers: 'pilote', offre: 'pro' },
          { libelle: 'Business', vers: 'echange', offre: 'business' },
          { libelle: 'Entreprise', vers: 'echange', offre: 'entreprise' },
          { libelle: 'Je ne sais pas' },
        ],
      },
      {
        // Le Pro a la console ET Claude Code (Julien, 2026-11-09, lot 3c) : la console finit ici, Claude Code suit l'arbre.
        id: 'pilote', texte: 'Console ou Claude Code ?', precision: 'La formule Pro a les deux : par où voulez-vous commencer ?',
        reponses: [{ libelle: 'La console', vers: 'console' }, { libelle: 'Claude Code ou Codex', vers: 'paiement' }],
      },
      {
        // Le Crédit WhatsApp ne se prend pas ici : depuis l'ouverture de la vente (2026-11-11, lot 3v-2), dans la console, dès
        // l'essai de la formule Pro ; sa réponse dit où, et la Free, qu'il vient avec la formule Pro.
        id: 'paiement', texte: 'Qui paie vos messages à Meta ?', precision: 'Meta facture chaque modèle que vous envoyez.',
        voies: paiement,
        reponses: [
          { libelle: 'Je mets un moyen de paiement (Visa / Mastercard) sur mon compte Meta Business', vers: 'compte' },
          { libelle: 'Crédit WhatsApp', grisee: { free: 'Avec la formule Pro.', pro: `Dans la console, une fois votre espace créé en formule Pro : <a href="${OFFRE_CREDIT_WHATSAPP.fr}">Offre, onglet Crédit WhatsApp</a> ; l’option se paie dès sa prise, même pendant l’essai.` } },
        ],
      },
      {
        id: 'compte', texte: 'Avez-vous un compte Meta Business ?', precision: 'L’ancien Business Manager : le compte de votre entreprise chez Meta.',
        reponses: [
          { libelle: 'Oui', vers: 'api' },
          { libelle: 'Non', vers: 'application', note: 'Rien à préparer : la fenêtre de Meta vous le fera créer en chemin.' },
          { libelle: 'Je ne sais pas', vers: 'application', note: `Pour le vérifier : ${META_BUSINESS}. Si vous faites de la publicité sur Facebook ou Instagram, vous en avez sans doute un. Sinon, la fenêtre de Meta vous le fera créer en chemin.` },
        ],
      },
      {
        id: 'application', texte: 'Avez-vous déjà l’application WhatsApp Business ?', precision: 'L’application des professionnels, distincte de WhatsApp.', logo: LOGO_APPLICATION,
        // Sans elle, plus rien à télécharger (Julien, 2026-11-12) : la question du numéro, qui mène au numéro API.
        reponses: [{ libelle: 'Oui', vers: 'meme-numero' }, { libelle: 'Non', vers: 'numero' }],
      },
      {
        // Le cas 4 (Julien, 2026-11-08, lot 3a) : l'application, mais pas pour ce numéro-là ; un numéro de chez nous, relié
        // par la fenêtre de Meta, et l'application garde le sien.
        id: 'meme-numero', texte: 'Voulez-vous utiliser ce numéro-là ?', precision: 'Celui de votre application WhatsApp Business.',
        reponses: [{ libelle: 'Oui', vers: 'garder' }, { libelle: 'Non', vers: 'autre-numero' }],
      },
      {
        // Sans compte Meta Business ni application (2026-11-12) : un numéro mène au numéro API, comme avec un compte ;
        // aucun, à un numéro de chez nous, relié par la fenêtre de Meta. Plus rien ne va dans l'application.
        id: 'numero', texte: 'Avez-vous déjà un numéro que vous pourriez utiliser ?', precision: 'Le numéro de votre entreprise, relié à l’API officielle de WhatsApp.',
        reponses: [{ libelle: 'Oui', vers: 'api' }, { libelle: 'Non', vers: 'fourni' }],
      },
    ],
    issues: [
      {
        // Avec un compte Meta Business, ou sans l'application avec un numéro (2026-11-12) : sa demande ne dit donc plus
        // qu'on a un compte, la fenêtre de Meta le crée s'il manque.
        id: 'api', situation: 'Avec un compte Meta Business, ou avec un numéro sans l’application WhatsApp Business', titre: 'Votre numéro API',
        textes: [
          'La fenêtre de Meta prend votre compte Meta Business, ou vous le fait créer en chemin, et relie votre numéro à l’API officielle de WhatsApp : il envoie vos messages, et votre agent IA répond.',
          `Un numéro libre, qui ne sert dans aucune application WhatsApp, devient votre numéro API ; un numéro qui sert déjà dans WhatsApp ou dans l’application WhatsApp Business se garde dans l’application (ci-dessous). Sans numéro, prenez un numéro fourni : ${numero} HT par mois en formule Free, inclus en formule Pro.`,
          metaFacture,
        ],
        autre: { question: 'Votre numéro sert déjà dans WhatsApp ou dans l’application WhatsApp Business ?', lien: 'Vous pouvez le garder', vers: 'garder' },
        numero: {
          free: `Relie mon numéro libre par Meta en numéro API, ou, si je n’ai aucun numéro, fournis-m’en un (${numero} HT par mois) ; s’il me manque un compte Meta Business, guide-moi pour le créer en chemin.`,
          pro: 'Relie mon numéro libre par Meta en numéro API, ou, si je n’ai aucun numéro, fournis-m’en un (inclus en formule Pro) ; s’il me manque un compte Meta Business, guide-moi pour le créer en chemin.',
        },
        pasAPas: '/aide/connecter-mon-numero-whatsapp/',
      },
      {
        // Les magasins sous WhatsApp ordinaire : on installe WhatsApp Business sur le même téléphone (2026-11-12).
        id: 'garder', situation: 'Avec l’application WhatsApp Business', titre: 'Gardez votre application WhatsApp Business',
        textes: [
          'Votre numéro reste dans l’application et envoie aussi depuis Messaging Me : vous répondez toujours depuis votre téléphone, et vos confirmations, rappels et relances partent de Messaging Me.',
          whatsappOrdinaire,
          `${garder} Meta facture les messages partis de Messaging Me, réponses comprises au-delà d’une franchise mensuelle ; ceux que vous tapez dans l’application restent gratuits.`,
          carteAvecApplication,
          'Quelques fonctions de l’application s’arrêtent, comme les listes de diffusion et le message d’absence, et il faut l’ouvrir au moins toutes les deux semaines. Ce que vous y tapez n’apparaît pas dans Messaging Me : votre agent IA ne voit pas vos réponses.',
        ],
        liens: magasins,
        numero: memes('Mon numéro est dans l’application WhatsApp Business et je veux la garder : relie-le par Meta pour qu’il envoie aussi depuis Messaging Me, et s’il me manque un compte Meta Business, guide-moi pour le créer en chemin.'),
        pasAPas: '/aide/garder-mon-application-whatsapp-business/',
      },
      {
        // Le cas 4 (Julien, 2026-11-08, lot 3a) : le numéro fourni par la fenêtre de Meta (`fourni`), l'application
        // WhatsApp Business gardant le sien ; son code se reçoit par l'appel (lot 2c).
        id: 'autre-numero', situation: 'Avec l’application WhatsApp Business, pour un autre numéro', titre: deChezNous,
        textes: [
          `${numeroDeChezNous} Votre application WhatsApp Business garde le sien.`,
          codeParLAppel('fr'),
          garder,
          metaFacture,
        ],
        numero: {
          free: `J’ai déjà l’application WhatsApp Business, mais je veux un autre numéro pour Messaging Me : fournis-m’en un (${numero} HT par mois), relie-le par Meta en numéro API, et guide-moi pour créer mon compte Meta Business en chemin.`,
          pro: 'J’ai déjà l’application WhatsApp Business, mais je veux un autre numéro pour Messaging Me : fournis-m’en un (inclus en formule Pro), relie-le par Meta en numéro API, et guide-moi pour créer mon compte Meta Business en chemin.',
        },
        pasAPas: '/aide/connecter-mon-numero-whatsapp/',
      },
      {
        // Ni compte Meta Business, ni application, ni numéro (Julien, 2026-11-12) : un numéro de chez nous, relié par la
        // fenêtre de Meta (`fourni`), qui crée le compte en chemin ; son code se reçoit par l'appel (lot 2c).
        id: 'fourni', situation: 'Sans l’application WhatsApp Business ni numéro', titre: deChezNous,
        textes: [numeroDeChezNous, codeParLAppel('fr'), garder, metaFacture],
        numero: {
          free: `Je n’ai ni l’application WhatsApp Business ni numéro : fournis-m’en un (${numero} HT par mois), relie-le par Meta en numéro API, et guide-moi pour créer mon compte Meta Business en chemin.`,
          pro: 'Je n’ai ni l’application WhatsApp Business ni numéro : fournis-m’en un (inclus en formule Pro), relie-le par Meta en numéro API, et guide-moi pour créer mon compte Meta Business en chemin.',
        },
        pasAPas: '/aide/connecter-mon-numero-whatsapp/',
      },
      {
        // Le Pro par la console (lot 3c) : la console pose elle-même les questions du numéro.
        id: 'console', situation: 'En formule Pro, depuis la console', titre: 'Créez votre espace : la console vous guide', console: true,
        textes: [
          'La console vous pose les mêmes questions, puis ouvre la fenêtre de Meta : votre numéro, ou un numéro fourni, inclus en formule Pro.',
          `Une fois votre espace créé, choisissez le mensuel ou l’annuel : la page de Stripe ouvre vos ${ESSAI_PRO_JOURS}&nbsp;jours d’essai gratuit, la carte y est demandée, et rien n’est prélevé avant la fin.`,
        ],
        pasAPas: '/aide/connecter-mon-numero-whatsapp/',
      },
      {
        // Business et Entreprise ne se branchent pas seuls (Julien, 2026-10-30 : « request a demo ou contact »), et ce
        // que la page Tarifs en dit (sur facture, essai sur demande, devis) se reprend ici mot pour mot.
        id: 'echange', situation: 'En formule Business ou Entreprise', titre: 'Parlons de votre projet', contact: true,
        textes: [
          'Business et Entreprise se mettent en place après un échange avec nous : nous posons la formule sur votre espace, sur facture, sans paiement en ligne, et nous vous accompagnons dans la mise en service.',
          'Un essai de 14&nbsp;jours de Business est possible sur demande. Entreprise se chiffre sur devis, selon votre volume.',
        ],
      },
    ],
    plus: 'Pour :', moins: 'Contre :',
    defiler: { precedente: 'Formules précédentes', suivante: 'Formules suivantes' },
    recommencer: 'Recommencer',
    progression: 'Question {n} sur {max} au plus', fin: 'Votre chemin',
    appels: {
      free: 'En formule Free, depuis votre assistant IA', pro: 'En formule Pro',
      plugin: 'L’installation pas à pas', github: 'Le dépôt GitHub',
      proAssistant: 'En formule Pro, depuis votre assistant IA',
      copier: 'Copier', copie: 'Copié',
      compte: 'Créer mon espace', pasAPas: 'Le pas-à-pas',
      equipe: 'Avec notre équipe', demo: 'Demander une démo', contacter: 'Nous contacter',
      etapesFree: {
        installer: { titre: 'Installez le plugin', claude: 'une par une', codex: 'dans un terminal' },
        relier: {
          titre: 'Reliez-le à Messaging Me', obligatoire: 'obligatoire',
          claude: 'tapez, puis choisissez', codex: 'dans un terminal',
          navigateur: 'Puis, dans votre navigateur :',
          codexNote: 'La page dit « non vérifié » : c’est normal.',
          detour: {
            titre: 'Sans Google :',
            legende: 'Le lien de l’e-mail : nommez votre espace, puis revenez ici',
            alt: 'La page du lien reçu par e-mail : le nom de l’espace, votre nom et votre mot de passe, puis « Créer mon espace ».',
          },
          ecrans: [
            {
              legende: 'Google, ou votre adresse e-mail',
              alt: 'La page d’autorisation : « Continuer avec Google », « Créer mon espace avec mon adresse e-mail », ou « Connectez-vous » avec un mot de passe.',
            },
            { legende: 'Autorisez votre espace', alt: 'Le choix de l’espace : « Autoriser dans Mon entreprise ».' },
            { legende: 'C’est relié', alt: '« Autorisation accordée » : retour vers Claude Code.' },
          ],
        },
        coller: 'Collez votre demande dans Claude Code ou Codex :',
      },
    },
    demande: {
      debut: {
        generique: { free: 'Mets en service WhatsApp avec la formule Free de Messaging Me.', pro: 'Mets en service WhatsApp avec la formule Pro de Messaging Me.' },
        shopify: { free: 'Branche ma boutique Shopify sur WhatsApp avec la formule Free de Messaging Me.', pro: 'Branche ma boutique Shopify sur WhatsApp avec la formule Pro de Messaging Me.' },
        saas: { free: 'Branche WhatsApp à mon app avec la formule Free de Messaging Me.', pro: 'Branche WhatsApp à mon app avec la formule Pro de Messaging Me.' },
      },
      fin: {
        generique: 'Puis crée mon agent IA à partir de mon site, pour qu’il réponde à mes clients.',
        shopify: 'Envoie la confirmation de commande, l’avis d’expédition et la relance de panier, et crée mon agent IA à partir de mon site.',
        saas: 'Puis crée la clé d’API de mon app, et mon agent IA à partir de mon site.',
      },
    },
    guide: {
      adresse: '/aide/guide-du-numero-whatsapp/',
      titre: 'Connecter son numéro WhatsApp, quelle que soit votre situation : le guide en {n} questions',
      description: 'WhatsApp Business, coexistence ou API : trouvez en {n} questions comment connecter votre numéro WhatsApp, et le pas-à-pas de votre cas.',
      chapeau: 'Répondez aux questions, une à la fois : le guide vous mène au pas-à-pas de votre situation, à la console, et à la phrase à dire à Claude. Ce sont les questions que la page « Connecter WhatsApp » et Claude vous posent.',
      points: {
        titre: 'Les cinq points à vérifier',
        liste: [
          'Qui paie vos messages à Meta : votre carte chez Meta, ou le Crédit WhatsApp, prépayé chez Messaging Me, à prendre dans la console avec la formule Pro ou Business (l’option se paie dès sa prise, même pendant l’essai).',
          'Un compte Meta Business : avec, votre numéro se relie en numéro API ; sans, la fenêtre de Meta vous le fait créer en chemin.',
          'L’application WhatsApp Business : vous la gardez, et Messaging Me envoie les messages automatiques à côté. Meta appelle cela la coexistence.',
          'Un numéro : le vôtre, ou un numéro que nous vous fournissons.',
          'Où sert votre numéro : dans WhatsApp Business, il y reste ; dans WhatsApp, l’application ordinaire, il passe d’abord dans WhatsApp Business ; nulle part, il se relie tel quel.',
        ],
      },
      fin: { pasAPas: 'Le pas-à-pas', claude: 'Depuis Claude Code ou Codex, dites-lui :', console: 'Connecter mon numéro dans la console' },
      demande: 'Connecte mon numéro WhatsApp à Messaging Me.',
      retirer: ' (inclus en formule Pro)',
    },
  };
};

const en = (): TexteTunnel => {
  const numero = euros(PRIX_NUMERO_AFFICHE_HT_CENTIMES, 'en');
  const offres: readonly Voie[] = [
    {
      titre: 'Free, €0 a month',
      plus: ['Everything happens by talking to Claude Code or Codex: your number, your AI agent, your messages.', 'With no time limit.'],
      moins: ['No console: you need an AI agent such as Claude Code or Codex.', `${milliers(limite('base', 'contacts'), 'en')} contacts and ${milliers(limite('base', 'envoisModelesMois'), 'en')} templates sent a month.`],
    },
    {
      titre: `Pro, ${euros(PRIX_PRO_HT_CENTIMES.mois, 'en')} excl. VAT a month`,
      badge: `${ESSAI_PRO_JOURS}-day free trial`,
      plus: ['The console: the team Inbox, campaigns, dashboards.', 'A provided number, included.', `A ${ESSAI_PRO_JOURS}-day trial the first time.`],
      moins: ['A card required from the trial.'],
    },
    {
      titre: `Business, ${euros(PRIX_BUSINESS_HT_CENTIMES.mois, 'en')} excl. VAT a month`,
      plus: ['Everything in Pro, plus the Meta Business Agent and HubSpot.', `${DROITS.business.limites.utilisateurs} users and dedicated support for the first two months.`],
      moins: ['Invoiced, after a conversation with us.'],
    },
    {
      titre: 'Enterprise, on quote',
      plus: ['Everything in Business, plus RCS, Salesforce and Dynamics, conversation analysis and Click-to-WhatsApp ads.', 'Contacts, users and webhooks sized for you.'],
      moins: ['A quote based on your volume.'],
    },
  ];
  const garder = 'No Meta Business account? Meta’s window creates it along the way, with your Facebook profile, then offers a payment method.';
  const paiement: readonly Voie[] = [
    {
      titre: 'I add a payment method (Visa / Mastercard) to my Meta Business account',
      plus: ['Meta bills your templates to this payment method.'],
      moins: [],
      liens: [
        { libelle: 'Why a payment method?', href: chemin(AIDE_PAYER_META.en) },
        { libelle: 'What is a Meta Business account?', href: chemin(AIDE_COMPTE_META_BUSINESS.en) },
      ],
    },
    {
      titre: 'WhatsApp credit',
      plus: [`You prepay your messages at Messaging Me, with no card at Meta: ${euros(PRIX_OPTION_WA_HT_CENTIMES, 'en')} excl. VAT per number per month, with the Pro or Business plan.`],
      moins: [],
    },
  ];
  const carteAvecApplication = 'You pay Meta with your card: WhatsApp credit is not possible with the app.';
  const whatsappOrdinaire = 'Is your number used in WhatsApp, the regular app? Install WhatsApp Business on the same phone: it offers to take over that number, with your chats.';
  const magasins: readonly Lien[] = [{ libelle: 'App Store (iPhone)', href: MAGASINS.appStore }, { libelle: 'Google Play (Android)', href: MAGASINS.googlePlay }];
  const deChezNous = 'A number from us, connected through Meta';
  const numeroDeChezNous = `We provide a number, ${numero} excl. VAT a month with the Free plan, included in Pro: Meta’s window connects it to the official WhatsApp API, it sends your messages, and your AI agent answers.`;
  const metaFacture = 'Meta bills your messages, and replies beyond a monthly allowance: a payment method is added at Meta.';
  return {
    surtitre: 'Your WhatsApp number',
    titre: ['Your setup', 'starts here.'],
    chapeau: 'In six questions at most, about your plan, who pays Meta, your Meta Business account, your WhatsApp Business app and your number, you know what to do.',
    lexique: {
      titre: 'The words of this guide, explained',
      termes: [
        {
          terme: 'The Meta Business account', court: 'Your business’s account at Meta, formerly Business Manager.',
          detail: 'If you advertise on Facebook or Instagram, you probably have one. Otherwise, nothing to prepare: it is free, and Meta’s window has you create it along the way, with your Facebook profile.',
          liens: [{ libelle: 'See my Meta Business account', href: MAGASINS.metaBusiness }],
        },
        {
          terme: 'The WhatsApp Business app', court: 'The app for businesses, separate from WhatsApp.',
          detail: 'It installs on a phone, with your business’s number. Kept, it keeps serving you while Messaging Me sends your messages.',
          liens: magasins,
        },
        {
          terme: 'The API number', court: 'The number connected through Meta to the official WhatsApp API.',
          detail: 'It sends your messages (confirmations, reminders, follow-ups), driven by Messaging Me. Meta bills its messages.',
        },
        {
          terme: 'Keeping your app', court: 'Your number stays in the app and also sends from Messaging Me.',
          detail: 'It also becomes an API number: you still reply from your phone, and your confirmations, reminders and follow-ups go out from Messaging Me.',
        },
      ],
    },
    questions: [
      {
        id: 'offre', texte: 'Which plan do you want?', precision: 'You can change it later.',
        aide: 'Free is driven only from an AI agent such as Claude Code or Codex: without one, Free does not work. Without an AI agent, choose Pro: the console, for you and your team, with a provided number.',
        voies: offres,
        reponses: [
          { libelle: 'Free', vers: 'paiement', offre: 'free' },
          { libelle: 'Pro', vers: 'pilote', offre: 'pro' },
          { libelle: 'Business', vers: 'echange', offre: 'business' },
          { libelle: 'Enterprise', vers: 'echange', offre: 'entreprise' },
          { libelle: 'I don’t know' },
        ],
      },
      {
        id: 'pilote', texte: 'Console or Claude Code?', precision: 'The Pro plan has both: where do you want to start?',
        reponses: [{ libelle: 'The console', vers: 'console' }, { libelle: 'Claude Code or Codex', vers: 'paiement' }],
      },
      {
        id: 'paiement', texte: 'Who pays Meta for your messages?', precision: 'Meta bills each template you send.',
        voies: paiement,
        reponses: [
          { libelle: 'I add a payment method (Visa / Mastercard) to my Meta Business account', vers: 'compte' },
          { libelle: 'WhatsApp credit', grisee: { free: 'With the Pro plan.', pro: `In the console, once your workspace is created on the Pro plan: <a href="${OFFRE_CREDIT_WHATSAPP.en}">Plan, WhatsApp credit tab</a>; the option is paid when taken, even during the trial.` } },
        ],
      },
      {
        id: 'compte', texte: 'Do you have a Meta Business account?', precision: 'Formerly Business Manager: your business’s account at Meta.',
        reponses: [
          { libelle: 'Yes', vers: 'api' },
          { libelle: 'No', vers: 'application', note: 'Nothing to prepare: Meta’s window will have you create it along the way.' },
          { libelle: 'I don’t know', vers: 'application', note: `To check: ${META_BUSINESS}. If you advertise on Facebook or Instagram, you probably have one. Otherwise, Meta’s window will have you create it along the way.` },
        ],
      },
      {
        id: 'application', texte: 'Do you already have the WhatsApp Business app?', precision: 'The app for businesses, separate from WhatsApp.', logo: LOGO_APPLICATION,
        reponses: [{ libelle: 'Yes', vers: 'meme-numero' }, { libelle: 'No', vers: 'numero' }],
      },
      {
        id: 'meme-numero', texte: 'Do you want to use that number?', precision: 'The one in your WhatsApp Business app.',
        reponses: [{ libelle: 'Yes', vers: 'garder' }, { libelle: 'No', vers: 'autre-numero' }],
      },
      {
        id: 'numero', texte: 'Do you already have a number you could use?', precision: 'Your business’s number, connected to the official WhatsApp API.',
        reponses: [{ libelle: 'Yes', vers: 'api' }, { libelle: 'No', vers: 'fourni' }],
      },
    ],
    issues: [
      {
        id: 'api', situation: 'With a Meta Business account, or with a number without the WhatsApp Business app', titre: 'Your API number',
        textes: [
          'Meta’s window takes your Meta Business account, or has you create it along the way, and connects your number to the official WhatsApp API: it sends your messages, and your AI agent answers.',
          `An available number, not used in any WhatsApp app, becomes your API number; a number already used in WhatsApp or in the WhatsApp Business app is kept in the app (below). Without a number, take a provided one: ${numero} excl. VAT a month with the Free plan, included in Pro.`,
          metaFacture,
        ],
        autre: { question: 'Is your number already used in WhatsApp or in the WhatsApp Business app?', lien: 'You can keep it', vers: 'garder' },
        numero: {
          free: `Connect my available number through Meta as an API number, or, if I have no number at all, provide one (${numero} excl. VAT a month); if I lack a Meta Business account, walk me through creating it along the way.`,
          pro: 'Connect my available number through Meta as an API number, or, if I have no number at all, provide one (included in Pro); if I lack a Meta Business account, walk me through creating it along the way.',
        },
        pasAPas: '/en/help/connect-my-whatsapp-number/',
      },
      {
        id: 'garder', situation: 'With the WhatsApp Business app', titre: 'Keep your WhatsApp Business app',
        textes: [
          'Your number stays in the app and also sends from Messaging Me: you still reply from your phone, and your confirmations, reminders and follow-ups go out from Messaging Me.',
          whatsappOrdinaire,
          `${garder} Meta bills the messages sent from Messaging Me, replies included beyond a monthly allowance; those you type in the app stay free.`,
          carteAvecApplication,
          'A few app features stop, such as broadcast lists and the away message, and you need to open the app at least every two weeks. What you type there does not show in Messaging Me: your AI agent does not see your replies.',
        ],
        liens: magasins,
        numero: memes('My number is in the WhatsApp Business app and I want to keep it: connect it through Meta so it also sends from Messaging Me, and if I lack a Meta Business account, walk me through creating it along the way.'),
        pasAPas: '/en/help/keep-my-whatsapp-business-app/',
      },
      {
        id: 'autre-numero', situation: 'With the WhatsApp Business app, for another number', titre: deChezNous,
        textes: [
          `${numeroDeChezNous} Your WhatsApp Business app keeps its own.`,
          codeParLAppel('en'),
          garder,
          metaFacture,
        ],
        numero: {
          free: `I already have the WhatsApp Business app, but I want another number for Messaging Me: provide one (${numero} excl. VAT a month), connect it through Meta as an API number, and walk me through creating my Meta Business account along the way.`,
          pro: 'I already have the WhatsApp Business app, but I want another number for Messaging Me: provide one (included in Pro), connect it through Meta as an API number, and walk me through creating my Meta Business account along the way.',
        },
        pasAPas: '/en/help/connect-my-whatsapp-number/',
      },
      {
        id: 'fourni', situation: 'Without the WhatsApp Business app or a number', titre: deChezNous,
        textes: [numeroDeChezNous, codeParLAppel('en'), garder, metaFacture],
        numero: {
          free: `I have neither the WhatsApp Business app nor a number: provide one (${numero} excl. VAT a month), connect it through Meta as an API number, and walk me through creating my Meta Business account along the way.`,
          pro: 'I have neither the WhatsApp Business app nor a number: provide one (included in Pro), connect it through Meta as an API number, and walk me through creating my Meta Business account along the way.',
        },
        pasAPas: '/en/help/connect-my-whatsapp-number/',
      },
      {
        id: 'console', situation: 'With the Pro plan, from the console', titre: 'Create your workspace: the console guides you', console: true,
        textes: [
          'The console asks you the same questions, then opens Meta’s window: your number, or a provided number, included in Pro.',
          `Once your workspace is created, choose monthly or yearly: Stripe’s page opens your ${ESSAI_PRO_JOURS}-day free trial, your card is asked there, and nothing is charged before the end.`,
        ],
        pasAPas: '/en/help/connect-my-whatsapp-number/',
      },
      {
        id: 'echange', situation: 'With the Business or Enterprise plan', titre: 'Let’s talk about your project', contact: true,
        textes: [
          'Business and Enterprise are set up after a conversation with us: we put the plan on your workspace, invoiced, with no online payment, and we support you through the setup.',
          'A 14-day Business trial is possible on request. Enterprise is priced on quote, based on your volume.',
        ],
      },
    ],
    plus: 'For:', moins: 'Against:',
    defiler: { precedente: 'Previous plans', suivante: 'Next plans' },
    recommencer: 'Start again',
    progression: 'Question {n} of {max} at most', fin: 'Your path',
    appels: {
      free: 'With the Free plan, from your AI assistant', pro: 'With the Pro plan',
      plugin: 'Installation step by step', github: 'The GitHub repository',
      proAssistant: 'With the Pro plan, from your AI assistant',
      copier: 'Copy', copie: 'Copied',
      compte: 'Create my workspace', pasAPas: 'The step-by-step guide',
      equipe: 'With our team', demo: 'Request a demo', contacter: 'Contact us',
      etapesFree: {
        installer: { titre: 'Install the plugin', claude: 'one at a time', codex: 'in a terminal' },
        relier: {
          titre: 'Connect it to Messaging Me', obligatoire: 'required',
          claude: 'type, then select', codex: 'in a terminal',
          navigateur: 'Then, in your browser:',
          codexNote: 'The page says “unverified”: that is expected.',
          detour: {
            titre: 'Without Google:',
            legende: 'The email link: name your workspace, then come back here',
            alt: 'The page of the link received by email: the workspace name, your name and your password, then “Create my workspace”.',
          },
          ecrans: [
            {
              legende: 'Google, or your email address',
              alt: 'The authorization page: “Continue with Google”, “Create my workspace with my email address”, or “Sign in” with a password.',
            },
            { legende: 'Authorize your workspace', alt: 'Choosing the workspace: “Authorize in My company”.' },
            { legende: 'Connected', alt: '“Authorization granted”: back to Claude Code.' },
          ],
        },
        coller: 'Paste your request into Claude Code or Codex:',
      },
    },
    demande: {
      debut: {
        generique: { free: 'Set up WhatsApp with the Messaging Me Free plan.', pro: 'Set up WhatsApp with the Messaging Me Pro plan.' },
        shopify: { free: 'Connect my Shopify store to WhatsApp with the Messaging Me Free plan.', pro: 'Connect my Shopify store to WhatsApp with the Messaging Me Pro plan.' },
        saas: { free: 'Connect WhatsApp to my app with the Messaging Me Free plan.', pro: 'Connect WhatsApp to my app with the Messaging Me Pro plan.' },
      },
      fin: {
        generique: 'Then create my AI agent from my website, so it answers my customers.',
        shopify: 'Send the order confirmation, the shipping notice and the checkout reminder, and create my AI agent from my website.',
        saas: 'Then create my app’s API key, and my AI agent from my website.',
      },
    },
    guide: {
      adresse: '/en/help/whatsapp-number-guide/',
      titre: 'Connect your WhatsApp number, whatever your situation: the guide in {n} questions',
      description: 'WhatsApp Business, coexistence or API: find out in {n} questions how to connect your WhatsApp number, and the walkthrough for your case.',
      chapeau: 'Answer the questions, one at a time: the guide leads you to the walkthrough for your situation, to the console, and to the sentence to tell Claude. They are the questions the “Connect WhatsApp” page and Claude ask you.',
      points: {
        titre: 'The five points to check',
        liste: [
          'Who pays Meta for your messages: your card at Meta, or WhatsApp credit, prepaid at Messaging Me, taken in the console with the Pro or Business plan (the option is paid when taken, even during the trial).',
          'A Meta Business account: with one, your number connects as an API number; without one, Meta’s window has you create it along the way.',
          'The WhatsApp Business app: you keep it, and Messaging Me sends the automated messages alongside. Meta calls this coexistence.',
          'A number: yours, or a number we provide.',
          'Where your number is used: in WhatsApp Business, it stays there; in WhatsApp, the regular app, it first moves to WhatsApp Business; nowhere, it connects as it is.',
        ],
      },
      fin: { pasAPas: 'The walkthrough', claude: 'From Claude Code or Codex, tell it:', console: 'Connect my number in the console' },
      demande: 'Connect my WhatsApp number to Messaging Me.',
      retirer: ' (included in Pro)',
    },
  };
};

export const TEXTES_TUNNEL: Readonly<Record<Langue, TexteTunnel>> = { fr: fr(), en: en() };

/** Une issue qui se branche depuis le tunnel (Free ou Pro), avec sa demande à coller. */
export type IssueBranchement = Extract<Issue, { readonly numero: Readonly<Record<OffreTunnel, string>> }>;

/** La demande à coller d'une issue, pour une offre et une page d'origine : elle reprend les réponses du tunnel. */
export const demandeDe = (t: TexteTunnel, x: IssueBranchement, offre: OffreTunnel, origine: Origine): string =>
  `${t.demande.debut[origine][offre]} ${x.numero[offre]} ${t.demande.fin[origine]}`;
