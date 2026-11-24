import { AIDE_DEPANNAGE, AIDE_GARDER_APPLICATION, AIDE_NUMERO_FOURNI } from '../../web/lib/partage/aide-connexion';
import { creditPaieMeta } from '../../web/lib/partage/credit-whatsapp';
import { CODE_VERIFICATION_FOURNI, ETAPES_NUMERO_FOURNI, SI_SEUL_TEXT_MESSAGE } from '../../web/lib/partage/etapes-numero-fourni';
import { ETAPES_COMPTE_FOURNI, ETAPES_FENETRE_GARDER, ETAPES_RELIER_APPLICATION } from '../../web/lib/partage/etapes-application';
import { CE_QUI_EST_FACTURE, ETAPES_CARTE_META, NUMERO_LIGNE_MIEN, PREREQUIS_LIGNE, PREREQUIS_META } from '../../web/lib/partage/etapes-meta';
import {
  destinationDuNumeroFourni, estFiliereNumero, estModeNumero, prixDuNumero,
  type DestinationNumeroFourni, type FiliereNumero, type ModeNumero, type PrixNumero,
} from '../../web/lib/partage/parcours-numero';
import type { ComptesApplication } from '../application/comptes';
import { phraseDuRefusDePreparation } from '../application/connexion';
import { DUREE_LIEN_NUMERO_MS, type LienNumero } from '../auth/token';
import { lireEtatLigne, tousGardentLApplication, type SourcesEtatLigne } from '../credit-whatsapp/etat-ligne';
import { journaliser } from '../lib/journal';
import { empreinteEtat, modeDeReprise, type EtatConnexion } from '../otp/etat-connexion';
import { RefusOutil } from './saisie';

/** Une lecture de l'état toutes les deux secondes : le code arrive à l'écran comme sur la page (trois secondes). */
export const PAS_ATTENTE_MS = 2_000;
/** L'attente rend la main avant la coupure du proxy. */
export const DELAI_ATTENTE_MS = 25_000;
const EMPREINTE_RE = /^[0-9a-f]{16}$/;

type CreditConnexionNumero = SourcesEtatLigne & {
  option: SourcesEtatLigne['option'] & { numeroAvecCarte(tenantId: string): Promise<boolean> };
};

export interface DepsConnexionNumeroMcp {
  signerLien(lien: LienNumero): Promise<string>;
  etat(tenantId: string): Promise<EtatConnexion>;
  urlConsole: string;
  attendre(ms: number): Promise<void>;
  maintenant(): number;
  comptesApplication: Pick<ComptesApplication, 'preparer'>;
  retenirDestination(tenantId: string, destination: DestinationNumeroFourni): Promise<void>;
  fenetrePartenaire(tenantId: string): Promise<boolean>;
  creditWhatsapp: CreditConnexionNumero;
}
export interface AccompagnementConnexionNumeroMcp {
  demarrer(tenantId: string, userId: string, entree: {
    mode: unknown; filiere?: unknown; numero?: unknown;
  }): Promise<Record<string, unknown>>;
  suivre(tenantId: string, userId: string, entree: {
    etatConnu?: unknown; filiere?: unknown; mode?: unknown;
  }): Promise<Record<string, unknown>>;
}

/**
 * La personne ne voit pas le résultat d'un outil : le lien n'existe pour elle que recopié. À l'essai réel 99
 * (2026-10-13), Claude a écrit « j'ai généré le lien » sans le lien, puis l'a donné dans un bloc de code, qu'un terminal
 * ne replie pas et coupe au bord de l'écran. À l'onboarding du 2026-11-07, il a annoncé le lien et l'heure où il expire
 * sans l'écrire : l'adresse est donc DANS la phrase qui dit de l'écrire, pas seulement dans le champ `url` d'à côté.
 */
const lienEnEntier = (url: string): string => 'Écris ce lien EN ENTIER à la personne, seul sur sa ligne, en texte simple : '
  + `${url} . Elle ne voit pas le résultat de cet outil, un résumé (« j’ai généré le lien », « le lien expire à… ») ne lui `
  + 'donne rien, et un bloc de code le couperait dans un terminal. Dis-lui de garder la page ouverte jusqu’au bout. ';

/** L'adresse du lien de connexion : la page `/brancher` de la console, le jeton après le `#` (jamais envoyé au serveur). */
const adresseDuLien = (urlConsole: string, jeton: string): string => `${urlConsole.replace(/\/+$/, '')}/brancher#${jeton}`;

/**
 * LE FILET DU LIEN (onboarding du 2026-11-07) : tant que rien n'a bougé, chaque réponse de l'attente redit d'écrire le
 * lien, une seule fois. Avec le mode, l'attente en rend un neuf (`lien`, valable une heure) ; sans le mode (un plugin
 * d'avant 0.3.29), elle renvoie à celui de `start_whatsapp_connection`.
 */
export function rappelDuLien(lien: string | null): string {
  const ou = lien === null
    ? 'celui que start_whatsapp_connection t’a rendu (ou rappelle start_whatsapp_connection avec le même mode si son heure est passée).'
    : `celui-ci, valable une heure : ${lien} .`;
  // « un lien de connexion », pas « ce lien » : chaque réponse sans signe en porte un neuf, et ils se valent (jaune de la
  // relecture du lot 1) ; sans cette précision, Claude réécrirait chaque nouveau lien toutes les 25 secondes.
  return ' La personne ne voit pas les résultats de tes outils. Si ton dernier message ne contenait pas un lien de connexion '
    + `EN ENTIER (celui de start_whatsapp_connection ou un précédent : ils se valent), écris-lui maintenant, seul sur sa `
    + `ligne et en texte simple, ${ou} S’il en contenait un, ne le répète pas.`;
}

/** Si la personne revient avant la fin (essai 99) : lui redire où elle en est, puis attendre à nouveau. */
const SI_ELLE_REVIENT = ' Si elle revient avant la fin, rappelle-lui où elle en est (la page du lien, la fenêtre de Meta, '
  + 'le numéro) avant d’attendre à nouveau.';

/**
 * LA PAGE DE DÉPANNAGE, SI ELLE BLOQUE (aide à la connexion, lot 4b) : la fin de chaque consigne de la fenêtre de Meta,
 * à l'adresse de sa langue. Les modes op cités avant le lien : garder l'application (A, `AVANT_LE_LIEN_GARDER`) et le
 * numéro fourni par la fenêtre de Meta (D, `VIDEO_FOURNI`) ; celui de son propre numéro viendra avec sa page (lot 4c).
 */
const SI_ELLE_BLOQUE = ' Si elle bloque (pas de code, une fenêtre de Meta qui refuse son numéro ou ne s’ouvre pas), donne-lui '
  + `la page de dépannage, à l’adresse de sa langue : en français ${AIDE_DEPANNAGE.fr} ; dans une autre langue `
  + `${AIDE_DEPANNAGE.en} .`;

/**
 * Garder l'application, c'est payer Meta avec sa carte (révision du Crédit WhatsApp, lot C) : la phrase de la console
 * (`NOTE_CARTE_APPLICATION`, `web/lib/questions-numero.ts`), que `tests/mcp-numero.test.ts` tient égale.
 */
const CARTE_AVEC_APPLICATION = ' Dis-lui aussi, dans sa langue : « Vous payez Meta avec votre carte : la ligne de crédit n’est pas '
  + 'possible avec l’application. »';

/** Des étapes numérotées sur une ligne : Claude les remet une par ligne, dans la langue de la personne. */
const numerotees = (etapes: readonly string[]): string => etapes.map((t, i) => `${i + 1}) ${t}`).join(' ');

/**
 * Ce qu'il faut chez Meta, dit AVANT le lien et sans poser de question (le guide « compte Meta », décision de Julien du
 * 2026-10-13) : la même source que l'encadré de la page (`PREREQUIS_META`).
 */
const prerequis = (etapes: ReadonlyArray<{ fr: string }>): string =>
  'Avant le lien, dis-lui en quelques lignes ce qu’il faut chez Meta, sans lui poser de question sur ces prérequis : '
  + `${numerotees(etapes.map((e) => e.fr))} `;
/** Au numéro fourni, le dernier prérequis (un numéro libre, sinon on en fournit un) n'a plus de sens : il vient d'en choisir un. */
const PREREQUIS_FOURNI = prerequis(PREREQUIS_META.slice(0, 2));
const PREREQUIS_APPORTE = prerequis(PREREQUIS_META);

/**
 * LA CONNEXION SANS CARTE CHEZ META (lot 3v-2b) : l'espace a pris le Crédit WhatsApp et n'a pas encore de numéro, et
 * `/brancher` ouvre d'elle-même la fenêtre du partenaire en `apporte` et en `fourni`. Ses conditions sont celles de la
 * page (`PREREQUIS_LIGNE`, et en `apporte` le téléphone du numéro, `NUMERO_LIGNE_MIEN`) ; qui paie, le crédit, dont le
 * solde part de zéro. Jamais la carte chez Meta, que le crédit remplace.
 */
const SANS_CARTE = 'Cet espace a droit à la ligne de crédit (l’option prise, ou en Entreprise) : ce lien ouvre la connexion '
  + 'sans carte chez Meta, la page s’en charge d’elle-même. ';
const PREREQUIS_LIGNE_FOURNI = prerequis(PREREQUIS_LIGNE);
const PREREQUIS_LIGNE_APPORTE = prerequis([...PREREQUIS_LIGNE, NUMERO_LIGNE_MIEN]);
const QUI_PAIE_LIGNE = 'Puis qui paie, dans sa langue : « Vos messages se paient par votre ligne de crédit : aucune carte '
  + 'chez Meta. » Hors Entreprise (où elle suit son contrat, illimitée), cette ligne de crédit est prépayée chez Messaging Me et '
  + 'son solde part de zéro : une fois le numéro connecté et sa ligne ouverte, propose-lui de la recharger (buy_credit avec credit '
  + '« whatsapp ») avant ses premiers modèles. ';
/** Le numéro de la personne déjà dans une application WhatsApp : la ligne ne paie pas un numéro qui la garde. */
const SI_NUMERO_DANS_WHATSAPP_LIGNE = 'Si son numéro sert dans WhatsApp ou dans l’application WhatsApp Business, dis-lui '
  + 'd’abord qu’avec la ligne de crédit il n’y marchera plus : ses clients lui écriront dans Messaging Me, et elle leur '
  + 'répondra là (la console, ou toi). Pour garder l’application, rappelle start_whatsapp_connection avec mode '
  + '« coexistence » : ses messages se paieront alors avec sa carte chez Meta, pas par la ligne de crédit. ';
/** Garder l'application alors que l'espace a pris le Crédit WhatsApp : le dire, pour qu'elle choisisse en connaissance. */
const CREDIT_SANS_APPLICATION = ' Préviens-la aussi : cet espace a pris la ligne de crédit, qui ne paie pas un numéro qui '
  + 'garde l’application ; pour qu’elle paie, un numéro hors de toute application WhatsApp (start_whatsapp_connection avec '
  + 'mode « apporte » ou « fourni »).';

/**
 * CE QUI VA SE PASSER, ET QUI PAIE, DIT AVANT LE LIEN (aide à la connexion, lot 1, 2026-11-09). À l'onboarding du
 * 2026-11-07, la personne a découvert la fenêtre de Meta en chemin, et Claude lui a dit « Meta facture forcément sur ta
 * carte » comme si tout était payant. Les textes viennent de `web/lib/partage/` : la page et les fiches disent les mêmes.
 */
const CODE_EXPLIQUE = `Dis-lui aussi ce qu’est le code de vérification : « ${CODE_VERIFICATION_FOURNI.fr} » `;
const QUI_PAIE_API = `Puis qui paie, dans sa langue : « ${CE_QUI_EST_FACTURE.api.fr} » `;
/** Garder l'application : les cinq temps de la fenêtre de Meta, qui paie (la nuance AVANT la note sur la carte), le mode op. */
const AVANT_LE_LIEN_GARDER = 'Avant le lien, dis-lui en quelques lignes, dans sa langue, ce qui va se passer dans la fenêtre '
  + `de Meta, pour qu’elle ne découvre rien en chemin : ${numerotees(ETAPES_FENETRE_GARDER.map((e) => e.fr))} `
  + `Puis qui paie : « ${CE_QUI_EST_FACTURE.application.fr} »${CARTE_AVEC_APPLICATION} Propose-lui les étapes pour poser `
  // Le compte WhatsApp que ces étapes ouvrent n'existe qu'après la fenêtre de Meta, sur un portefeuille neuf (jaune 7).
  + 'sa carte chez Meta, à suivre une fois le numéro relié (son compte WhatsApp n’existe qu’après la fenêtre de Meta), '
  + `et donne-les-lui si elle le veut : ${numerotees(ETAPES_CARTE_META.map((e) => e.fr))} Donne-lui `
  + `enfin le mode op, écran par écran, à l’adresse de sa langue : en français ${AIDE_GARDER_APPLICATION.fr} ; dans une `
  + `autre langue ${AIDE_GARDER_APPLICATION.en} . `;

/**
 * L'APPEL, PAS LE SMS (lot 2c, décision de Julien du 2026-11-09 : « il faut lourdement insister ») : l'étape `insiste`
 * des étapes du numéro fourni, redite à part après elles, puis la seule exception, dite discrètement. Citées après un
 * deux-points, sans guillemets autour : elles portent déjà les leurs.
 */
const ETAPE_APPEL = ETAPES_NUMERO_FOURNI.filter((e) => e.insiste).map((e) => e.fr).join(' ');
const INSISTE_APPEL = `Insiste lourdement, et redis-le à part après les étapes : ${ETAPE_APPEL} `
  + `Ajoute seulement ensuite, en passant : ${SI_SEUL_TEXT_MESSAGE.fr} `;
/** La suite d'une attente revient à chaque tour : l'insistance n'accompagne que des étapes redonnées (jaune 1 du lot). */
const INSISTE_APPEL_SI_REDONNEES = `Si tu les redonnes, insiste lourdement, et redis-le à part après elles : ${ETAPE_APPEL} `
  + `Ajoute seulement ensuite, en passant : ${SI_SEUL_TEXT_MESSAGE.fr} `;

/**
 * LE MODE OP DU NUMÉRO FOURNI, EN VIDÉO (lot 6 de l'aide à la connexion, 2026-11-13) : la page montre ce parcours de bout
 * en bout depuis Claude Code, puis ses étapes avec leurs captures. Donnée AVANT le lien, comme celle de l'application
 * gardée (`AVANT_LE_LIEN_GARDER`). Pas par la ligne : sa fenêtre n'est pas celle que montre le film.
 */
const VIDEO_FOURNI = 'Avant le lien, donne-lui la page qui montre ce parcours en vidéo (trois minutes), puis ses étapes, à '
  + `l’adresse de sa langue : en français ${AIDE_NUMERO_FOURNI.fr} ; dans une autre langue ${AIDE_NUMERO_FOURNI.en} . `;

/**
 * CE QUE LE NUMÉRO FOURNI COÛTE À L'ESPACE, une seule source pour les trois consignes et la lecture de l'abonnement (lot 2
 * du 2026-11-17) : inclus dans l'offre (rien à payer), payant (3,50 € HT par mois), ou payant PENDANT L'ESSAI du Pro, dont
 * les 3,50 € se déduisent du premier mois de Pro (`surNumeroPayePendantLEssai`). Claude n'annonce jamais un prix que la
 * page ne demande pas, ni ne tait une déduction qu'elle fait.
 */
const ETAPE_PRIX: Record<PrixNumero, string> = {
  inclus: '« Obtenir mon numéro » : il est inclus dans son offre, rien à payer ; le numéro s’affiche sur la page.',
  essai: '« Payer 3,50 € HT par mois » : pendant son essai de la formule Pro, ces 3,50 € sont déduits de sa première facture '
    + 'de formule Pro, et ne lui sont pas remboursés s’il ne la garde pas au bout de l’essai ; une fois le paiement confirmé, le '
    + 'numéro s’affiche sur la page.',
  payant: '« Payer 3,50 € HT par mois » ; une fois le paiement confirmé, le numéro s’affiche sur la page.',
};
const PRIX_DIT: Record<PrixNumero, string> = {
  inclus: 'inclus en formule Pro',
  essai: '3,50 € HT par mois, déduits de la première facture de formule Pro, non remboursés sans formule Pro au bout de l’essai (essai en cours)',
  payant: '3,50 € HT par mois',
};

/**
 * La consigne du numéro fourni : les étapes de la page (`ETAPES_NUMERO_FOURNI`, la même source), encadrées par le lien
 * et le paiement avant, et par le retour vers Claude après « Finish » (essai 99, ordre de Julien). En Pro (J4 de la
 * relecture de B2b), le numéro est inclus : la page l'obtient sans payer, et Claude n'annonce pas un prix qu'elle ne
 * demande pas.
 */
const consigneFourni = (prix: PrixNumero, url: string, ligne: boolean): string =>
  (ligne ? SANS_CARTE + PREREQUIS_LIGNE_FOURNI + CODE_EXPLIQUE + QUI_PAIE_LIGNE : PREREQUIS_FOURNI + CODE_EXPLIQUE + QUI_PAIE_API + VIDEO_FOURNI)
  + lienEnEntier(url) + 'Il ouvre la page de connexion de son numéro, sans se connecter, pendant une heure. Donne-lui ces '
  + 'étapes, numérotées, une par ligne, dans sa langue ; la page affiche les mêmes : '
  + numerotees([
    'Cliquer sur le lien.',
    ETAPE_PRIX[prix],
    ...ETAPES_NUMERO_FOURNI.map((e) => e.fr),
    'Revenir te voir seulement une fois l’écran « Finish » passé.',
  ])
  + ` ${INSISTE_APPEL}`
  + 'Appelle ensuite watch_whatsapp_connection : le code arrivera aussi ici, écris-le-lui en entier dès qu’il arrive.'
  + SI_ELLE_REVIENT;

/**
 * WHATSAPP ORDINAIRE AU MODE APPORTE (jaune 3 de la relecture du lot 3a) : la 3e condition dit de faire passer le numéro
 * dans WhatsApp Business ; il se garde alors en coexistence, que ce lien n'ouvre pas.
 */
const SI_NUMERO_DANS_WHATSAPP = 'Si son numéro sert dans WhatsApp ou dans l’application WhatsApp Business, ne lui donne pas '
  + 'ce lien : rappelle start_whatsapp_connection avec mode égal à « coexistence » (dans WhatsApp, l’application '
  + 'ordinaire, elle installe d’abord WhatsApp Business sur le même téléphone, qui reprend le numéro avec ses '
  + 'conversations), et ne l’envoie jamais vers un autre numéro. ';

const CONSIGNES = {
  apporte: (url: string, ligne: boolean) => (ligne
    ? SANS_CARTE + PREREQUIS_LIGNE_APPORTE + SI_NUMERO_DANS_WHATSAPP_LIGNE + QUI_PAIE_LIGNE
    : PREREQUIS_APPORTE + SI_NUMERO_DANS_WHATSAPP + QUI_PAIE_API) + lienEnEntier(url) + 'Il ouvre la page de connexion de son numéro, sans se connecter, pendant une '
    + 'heure. Sur la page : la fenêtre de Meta, son numéro, et le code qu’elle reçoit elle-même. Appelle ensuite '
    + 'watch_whatsapp_connection pour savoir quand le numéro est connecté.' + SI_ELLE_REVIENT,
  /**
   * La coexistence (plan 2026-10-24, tâche 4) : son numéro reste dans l'application WhatsApp Business. Sans les prérequis
   * de Meta : le dernier (un numéro hors de l'application) le contredirait, et le compte Meta Business, la fenêtre le crée
   * en chemin. La page en dit autant (`COEXISTENCE_PHRASES`, `web/lib/fenetre-meta.ts`).
   */
  coexistence: (url: string, ligne: boolean) => AVANT_LE_LIEN_GARDER + (ligne ? `${CREDIT_SANS_APPLICATION.trim()} ` : '')
    + lienEnEntier(url) + 'Il ouvre la page de connexion de son numéro, '
    + 'sans se connecter, pendant une heure ; son numéro reste dans l’application. Appelle ensuite '
    + 'watch_whatsapp_connection avec mode égal à « coexistence » pour savoir quand le numéro est relié à l’API, '
    + 'l’application gardée.'
    + SI_ELLE_REVIENT,
} as const;

/**
 * L'ATTENTE NE REND PAS LA MAIN (vidéo 2 de l'aide, 2026-11-13) : après deux minutes sans paiement, Claude a terminé son
 * tour en demandant « faites-moi signe », puis le code est arrivé sans que personne le lise. Tour fini, Claude ne peut plus
 * rien écrire avant un message de la personne, qui est sur la page ou dans la fenêtre de Meta, pas dans le terminal : le
 * code n'est arrivé que parce que Julien l'a réclamé.
 */
const RAPPEL_ATTENTE = 'Rappelle watch_whatsapp_connection avec etat_connu égal à cette empreinte pour attendre la suite, '
  + 'sans rendre la main : dès que tu la rends, tu ne peux plus rien écrire avant son prochain message, et elle est sur la '
  + 'page ou dans la fenêtre de Meta, pas ici. Ne lui demande pas de te faire signe pendant cette attente. Ne t’arrête '
  + 'qu’après une quarantaine d’appels de suite sans changement (un quart d’heure environ), en lui disant de t’écrire '
  + 'quand elle reprend.';

/**
 * L'application WhatsApp a appelé le numéro fourni, hors de la voie de l'application (lot 1 du 2026-11-17, vécu cette
 * nuit-là) : la personne l'a tapé dans une application WhatsApp sur son téléphone. Son code n'est jamais transmis.
 */
const APPEL_DE_L_APPLICATION = 'Le numéro a été saisi dans une application WhatsApp sur un téléphone : c’est elle qui vient '
  + 'd’appeler, et son code n’est pas transmis. Dis-le à la personne simplement : ce numéro ne se met pas dans '
  + 'l’application, il se saisit dans la fenêtre de Meta, ouverte depuis la page, où il faut choisir « Appel téléphonique » ; '
  + `le code de Meta s’affichera alors sur la page et ici. ${RAPPEL_ATTENTE}`;

/**
 * Ce que le numéro fourni mis dans l'application permet dès le premier jour. 🔴 Plus de « Meta refuse souvent un numéro
 * tout neuf, revenez dans quelques jours » (Julien, 2026-11-11 : « on a testé qu'un nouveau numéro peut être coex sans
 * problème, on ne dit pas de connerie sur ce sujet ») : la console, la vitrine et le plugin l'ont retiré aussi.
 */
const NUMERO_NEUF = 'dès le premier jour, elle répond à ses clients depuis l’application.';
/**
 * La dernière étape du numéro fourni mis dans l'application : le bouton de la page, la même fenêtre qu'en coexistence.
 * Son libellé est celui de `COEXISTENCE_BOUTON` (`web/lib/fenetre-meta.ts`), que `tests/mcp-numero.test.ts` tient égal.
 */
const GARDER_APRES_COMPTE = 'Une fois le compte créé dans l’application, « Ouvrir la fenêtre de Meta » sur la '
  + 'page : dans la fenêtre de Meta, saisir ce numéro et confirmer dans l’application, sur le téléphone.';

/**
 * LE NUMÉRO FOURNI MIS DANS L'APPLICATION (plan 2026-10-31, décision de Julien : « Dans l'application ») : le payer ou
 * l'obtenir, créer avec lui le compte de l'application WhatsApp Business (le pont des codes capte l'appel de
 * vérification de l'application, mesuré le 2026-10-21), puis la fenêtre de Meta en coexistence sur ce même numéro. Les
 * étapes sont celles de la page (`ETAPES_COMPTE_FOURNI`, puis le bouton de la coexistence).
 */
const consigneFourniApplication = (prix: PrixNumero, url: string, ligne: boolean): string =>
  // Borné au code de CRÉATION du compte de l'application (jaune 5) : la vérification que la fenêtre de Meta demande
  // ensuite sur un numéro fourni n'a jamais été mesurée, elle est à l'essai réel du lot.
  CODE_EXPLIQUE + 'Le code de création du compte de l’application se tape dans l’application WhatsApp Business, pas dans '
  + 'la fenêtre de Meta. '
  + AVANT_LE_LIEN_GARDER.replace('dans la fenêtre de Meta', 'dans la fenêtre de Meta, une fois le compte de l’application créé')
  + (ligne ? `${CREDIT_SANS_APPLICATION.trim()} ` : '')
  + lienEnEntier(url) + 'Il ouvre la page de connexion de son numéro, sans se connecter, pendant une heure. Donne-lui ces '
  + 'étapes, numérotées, une par ligne, dans sa langue ; la page affiche les mêmes : '
  + numerotees([
    'Cliquer sur le lien.',
    ETAPE_PRIX[prix],
    ...ETAPES_COMPTE_FOURNI.map((e) => e.fr),
    GARDER_APRES_COMPTE,
  ])
  + ` Dis-lui aussi, avant de commencer : ${NUMERO_NEUF} Appelle ensuite watch_whatsapp_connection avec mode égal à `
  + '« fourni_application » : le code de vérification de l’application arrivera aussi ici, écris-le-lui en entier dès '
  + 'qu’il arrive.' + SI_ELLE_REVIENT;

/**
 * Le compte de l'application est CRÉÉ (un code capté depuis l'attribution, que `codeDeLEspace` ne montre plus après 15
 * minutes) : il ne reste qu'à le garder. Vécu par Johan le 2026-11-06 : la suite redonnait les étapes de création du compte
 * et « le code arrivera aussi ici », et il a tourné en rond jusqu'à ce que Julien lui dise de demander la coexistence.
 */
const compteCree = (fourni: string): string => `Le numéro ${fourni} a déjà reçu son code de vérification : son compte de `
  + 'l’application WhatsApp Business est créé. Ne redonne PAS les étapes de création du compte. Il ne reste qu’une étape, '
  + 'garder l’application : sur la page, « Ouvrir la fenêtre de Meta », puis, dans la fenêtre de Meta, '
  + 'saisir ce numéro et confirmer dans l’application, sur le téléphone. Si la page n’est plus ouverte, ou si l’heure du '
  + 'lien est passée, start_whatsapp_connection avec mode « coexistence » donne un lien neuf qui ouvre directement cette '
  + 'fenêtre : écris-le-lui en entier (ce mot reste dans ton appel, jamais dans ce que tu lui dis). Si l’application '
  + `redemande un code, il arrivera ici. Rappelle-lui : ${NUMERO_NEUF} ${RAPPEL_ATTENTE}`;

/**
 * Un numéro fourni déjà vérifié une fois, dont on ne sait pas où il est allé (un lien d'avant la migration 0280, ou un
 * parcours mené dans la console) : UNE question que la personne sait trancher, sur son propre téléphone, plutôt que les
 * étapes d'un numéro neuf dans la fenêtre de Meta, que Meta refuse pour un numéro déjà dans l'application.
 */
const destinationInconnue = (fourni: string): string => `Le numéro ${fourni} a déjà reçu un code de vérification, mais `
  + `il n’est pas encore relié. Pose UNE question à la personne : « Le numéro ${fourni} est-il dans l’application WhatsApp `
  + 'Business de votre téléphone ? ». Oui : start_whatsapp_connection avec mode « coexistence » (ce mot reste dans ton '
  + 'appel). Non : start_whatsapp_connection avec mode « fourni », la fenêtre de Meta.';

/** Ce que Claude dit ensuite sur le numéro fourni mis dans l'application, tant qu'il n'est pas relié. `null` : la suite commune. */
function suiteFourniApplication(e: EtatConnexion): string | null {
  if (e.connecte) return null;
  if (e.code) {
    return 'Écris ce code en entier à la personne, en texte simple : elle le saisit dans l’application WhatsApp Business, '
      + `pour y créer le compte avec ce numéro (pas dans la fenêtre de Meta). Puis : ${GARDER_APRES_COMPTE} Rappelle-lui : ${NUMERO_NEUF} `
      + RAPPEL_ATTENTE;
  }
  if (e.fourni && e.codeDejaCapte) return compteCree(e.fourni);
  if (e.fourni) {
    return `Le numéro ${e.fourni} est attribué. Redonne à la personne les étapes de la page si elle ne les a plus : `
      + `${numerotees([...ETAPES_COMPTE_FOURNI.map((x) => x.fr), GARDER_APRES_COMPTE])} Le code arrivera aussi ici. ${RAPPEL_ATTENTE}`;
  }
  return null;
}

/**
 * La coexistence pas encore faite (plan 2026-10-24) : un espace relié par QR code reste « connecté » par son compte de
 * l'application jusqu'à ce que Meta relie le numéro, et WhatsApp en délie l'appareil en chemin. Rien de cela n'est la fin.
 */
const COEXISTENCE_EN_COURS = 'Le numéro n’est pas encore relié à l’API, l’application WhatsApp Business gardée. Redis à la '
  + 'personne, si elle en a besoin : dans la fenêtre '
  + 'de Meta, elle saisit le numéro de son application WhatsApp Business, puis confirme dans l’application, sur son '
  + 'téléphone. Le branchement s’achève quand coexistence vaut true (un numéro relié par QR code reste dit connecté '
  + `jusque-là). ${RAPPEL_ATTENTE}`;

/**
 * La filière application WhatsApp Business (2026-10-22) : pas de fenêtre de Meta, un QR code sur la page, scanné depuis
 * le téléphone qui porte le numéro. Les étapes sont celles de la page (`web/lib/partage/etapes-application.ts`).
 */
const SUIVRE_APPLICATION = ' Appelle ensuite watch_whatsapp_connection avec filiere égal à « application » pour savoir quand le numéro est relié.';
const CONSIGNES_APPLICATION = {
  apporte: (url: string) => lienEnEntier(url) + 'Il ouvre, sur un ordinateur, la page de connexion de son numéro, sans se connecter, pendant une heure : un '
    + 'QR code. Donne-lui ces étapes, numérotées, une par ligne, dans sa langue ; la page affiche les mêmes : '
    + numerotees(['Ouvrir le lien sur un ordinateur.', ...ETAPES_RELIER_APPLICATION.map((e) => e.fr)])
    + SUIVRE_APPLICATION + SI_ELLE_REVIENT,
  fourni: (prix: PrixNumero, url: string) => lienEnEntier(url) + 'Il ouvre, sur un ordinateur, la page de connexion de son numéro, sans se '
    + 'connecter, pendant une heure. Donne-lui ces étapes, numérotées, une par ligne, dans sa langue ; la page affiche les mêmes : '
    + numerotees([
      'Ouvrir le lien sur un ordinateur.',
      ETAPE_PRIX[prix],
      ...ETAPES_COMPTE_FOURNI.map((e) => e.fr),
      ...ETAPES_RELIER_APPLICATION.map((e) => e.fr),
    ])
    + ' Le code de vérification arrivera aussi ici : écris-le-lui en entier dès qu’il arrive.' + SUIVRE_APPLICATION + SI_ELLE_REVIENT,
} as const;

/** Ce que Claude dit ensuite sur la filière application, selon l'état du compte. `null` : rien de propre à la filière. */
function suiteApplication(e: EtatConnexion): string | null {
  switch (e.application?.statut) {
    case 'relie':
      return 'Le numéro de l’application WhatsApp Business est relié : le branchement est fini. Relis get_setup_state avant '
        + 'd’annoncer la suite. Le crédit offert au premier numéro arrive quelques secondes après : s’il est encore à 0, relis '
        + 'une fois quelques secondes plus tard.';
    case 'en_attente':
      return 'Dis à la personne de scanner le QR code de la page avec le téléphone qui porte le numéro : '
        + `${numerotees(ETAPES_RELIER_APPLICATION.slice(0, 2).map((x) => x.fr))} ${RAPPEL_ATTENTE}`;
    // Plus aucun nouveau QR code (Julien, 2026-10-30) : la suite d'un espace relié ainsi est de garder l'application et de
    // passer le même numéro par Meta (`coexistence`), comme le dit la skill `mise-en-service`.
    case 'banni':
      return 'WhatsApp a coupé ce numéro : il ne peut plus être relié. Dis-le à la personne, et propose la suite : un autre '
        + 'numéro par la fenêtre de Meta (start_whatsapp_connection), qui crée le compte Meta Business en chemin.';
    case 'deconnecte':
      return 'L’appareil a été retiré depuis le téléphone : plus rien ne passe. Propose la suite : garder l’application '
        + 'WhatsApp Business et relier le même numéro par Meta (start_whatsapp_connection, mode « coexistence »), la fenêtre '
        + 'de Meta créant le compte Meta Business en chemin. Ne propose pas de nouveau QR code.';
    case 'sommeil':
      return 'Le numéro dort (aucun message depuis longtemps). Propose la suite : garder l’application WhatsApp Business et '
        + 'relier le même numéro par Meta (start_whatsapp_connection, mode « coexistence »), la fenêtre de Meta créant le '
        + 'compte Meta Business en chemin. Ne propose pas de nouveau QR code.';
    default:
      return null;
  }
}

/**
 * QUI PAIE META POUR LE NUMÉRO CONNECTÉ (lot 3v-2b) : sa carte (la suite d'avant), la ligne de crédit (sa ligne posée, ou
 * l'option payée qui l'attend, pour un numéro qui ne garde pas l'application : `creditPaieMeta`, la règle de
 * `get_setup_state`), ou sa carte quand même : connecté avec elle alors que la ligne aurait pu le prendre (l'option payée,
 * ou une Entreprise), il ne passera jamais sur la ligne, Meta refusant sa reconnexion (`numeroAvecCarte`, décision de
 * Julien du 2026-11-13).
 */
type PaiementDuNumero = 'carte' | 'credit' | 'attente' | 'avec_carte';
const RELIRE_APRES_CONNEXION = 'Relis ensuite get_setup_state avant d’annoncer la suite : la connexion change l’état de '
  + 'l’espace. Le crédit IA offert au premier numéro arrive quelques secondes après : s’il est encore à 0, relis une fois '
  + 'quelques secondes plus tard.';
const CONNECTE_PAR_LE_CREDIT = 'Le numéro est connecté : le branchement est fini. Ses messages se paient par la ligne '
  + 'de crédit, sans carte chez Meta : ne lui demande aucune carte. Si le solde de cette ligne de crédit est à zéro (get_credit '
  + 'le dit, dans credit_whatsapp ; jamais en Entreprise, où elle est illimitée), propose-lui de la recharger (buy_credit avec '
  + `credit « whatsapp ») avant ses premiers modèles. ${RELIRE_APRES_CONNEXION}`;
/** L'option payée, la ligne pas encore posée (pose refusée, ou la pose automatique coupée) : la recharge attend la ligne. */
const CONNECTE_EN_ATTENTE = 'Le numéro est connecté sans carte chez Meta : ne lui demande aucune carte. Sa ligne de crédit '
  + 's’ouvre sous 24 h ouvrées au plus ; la recharge de la ligne de crédit vient ensuite (get_credit le montrera), '
  + `elle n’est pas possible avant. ${RELIRE_APRES_CONNEXION}`;
/** La carte chez Meta paie : ses étapes, celles de la console. */
const AJOUTER_SA_CARTE = 'Dis-lui tout de suite d’ajouter sa carte chez Meta, sans laquelle les modèles ne partent pas : '
  + numerotees(ETAPES_CARTE_META.map((e) => e.fr));
/** Le texte (1) de la console, dit à la personne : le Support est la seule suite (décision de Julien du 2026-11-13). */
const CONNECTE_AVEC_CARTE = 'Le numéro est connecté avec sa carte chez Meta : le branchement est fini, mais la ligne de '
  + 'crédit ne peut pas le prendre en charge (Meta refuse de le reconnecter sans carte). Dis-le à la personne : pour '
  + `changer, elle écrit au Support de la console. C’est donc sa carte chez Meta qui paie ses messages. ${AJOUTER_SA_CARTE} `
  + RELIRE_APRES_CONNEXION;
const SUITES_CONNECTE: Readonly<Record<Exclude<PaiementDuNumero, 'carte'>, string>> = {
  credit: CONNECTE_PAR_LE_CREDIT, attente: CONNECTE_EN_ATTENTE, avec_carte: CONNECTE_AVEC_CARTE,
};

/** Lu seulement quand le numéro est connecté. Une lecture qui échoue garde la suite d'avant, la carte, et se journalise. */
async function paiementDuNumero(deps: DepsConnexionNumeroMcp, tenantId: string): Promise<PaiementDuNumero> {
  try {
    const wa = deps.creditWhatsapp;
    const [etat, numeros, offre] = await Promise.all([lireEtatLigne(wa, tenantId), wa.vue.numeros(tenantId), wa.option.offre(tenantId)]);
    const avecApplication = tousGardentLApplication(numeros);
    // La ligne aurait pu prendre ce numéro : l'option payée l'attend, ou une Entreprise (sa ligne se pose à la connexion).
    // Ailleurs, la règle ne se lit pas : aucune course à attendre pour un numéro connecté, comme toujours, avec sa carte.
    const ligneAttendue = !avecApplication && (etat === 'en_attente' || (etat === 'a_prendre' && offre === 'entreprise'));
    const avecCarte = ligneAttendue && await wa.option.numeroAvecCarte(tenantId);
    if (avecCarte) return 'avec_carte';
    if (!creditPaieMeta(etat, avecApplication, avecCarte)) return 'carte';
    return etat === 'en_attente' ? 'attente' : 'credit';
  } catch (err) {
    journaliser('error', 'mcp_paiement_du_numero_illisible', { tenantId, err });
    return 'carte';
  }
}

/**
 * 🔴 LA COURSE DE LA CONNEXION SANS CARTE (rouge de la relecture du lot 3v-2b) : le numéro est relié (`linkTenant`) AVANT
 * d'être marqué arrivé par la fenêtre du partenaire et d'avoir sa ligne (quelques secondes d'appels à Meta) ; entre les
 * deux, `numeroAvecCarte` le lit connecté avec sa carte. On relit donc tant qu'elle le dit, jusqu'à la fin de l'attente
 * et au moins cinq pas : un vrai numéro connecté avec sa carte le reste jusqu'au bout.
 */
async function paiementStable(deps: DepsConnexionNumeroMcp, tenantId: string, debut: number): Promise<PaiementDuNumero> {
  const limite = Math.max(debut + DELAI_ATTENTE_MS, deps.maintenant() + 5 * PAS_ATTENTE_MS);
  let p = await paiementDuNumero(deps, tenantId);
  while (p === 'avec_carte' && deps.maintenant() + PAS_ATTENTE_MS <= limite) {
    await deps.attendre(PAS_ATTENTE_MS);
    p = await paiementDuNumero(deps, tenantId);
  }
  return p;
}

const RIEN_ENCORE = 'Rien n’a encore bougé. Si la personne revient sans avoir avancé, redonne-lui le lien en entier et ses '
  + `étapes (start_whatsapp_connection en rend un neuf si l’heure est passée). ${RAPPEL_ATTENTE}`;

/** Où va le numéro fourni : la destination retenue (0280), à défaut le mode que Claude a passé (un lien d'avant 0280). */
function destinationDe(e: EtatConnexion, mode?: string): DestinationNumeroFourni | undefined {
  if (e.destination) return e.destination;
  if (mode === 'fourni_application') return 'application';
  if (mode === 'fourni') return 'api';
  return undefined;
}

/**
 * Ce que Claude dit ensuite, selon l'étape. À l'essai 99, il attendait en silence pendant que la personne ne savait plus
 * où aller, et annonçait le crédit lu avant la connexion (0 €) alors que le crédit offert venait d'arriver.
 * `mode` : le mode demandé. En coexistence (plan 2026-10-24), tant qu'aucun numéro de Meta n'est relié, le compte de
 * l'application d'un espace relié par QR code n'est pas la fin. Le numéro fourni mis dans l'application (plan 2026-10-31)
 * a ses propres étapes avant la fenêtre de Meta. 🔴 Elles suivent la destination RETENUE (migration 0280), et le `mode`
 * seulement à défaut (plan 2026-11-06) : un appel sans `mode`, ou une session reprise, ne retombe plus sur la fenêtre de
 * Meta d'un numéro neuf.
 */
function suiteDe(e: EtatConnexion, filiere: FiliereNumero, mode?: string, paiement: PaiementDuNumero = 'carte'): string {
  if (mode === 'coexistence' && (e.connecte === null || e.application !== undefined)) return COEXISTENCE_EN_COURS;
  const destination = filiere === 'api' ? destinationDe(e, mode) : undefined;
  const fourniApplication = destination === 'application' ? suiteFourniApplication(e) : null;
  if (fourniApplication) return fourniApplication;
  const application = suiteApplication(e);
  if (application) return application;
  if (filiere === 'application' && e.code) {
    return 'Écris ce code en entier à la personne, en texte simple : elle le saisit dans l’application WhatsApp Business, '
      + `puis scanne le QR code de la page. ${RAPPEL_ATTENTE}`;
  }
  if (e.connecte?.aActiver) {
    return 'Le numéro est relié, mais Meta ne l’a pas encore activé : la vérification n’est pas allée au bout. Dis-le à la '
      + 'personne : elle peut la terminer dans l’Accueil de la console (« Activer le numéro »).';
  }
  if (e.connecte) {
    if (paiement !== 'carte') return SUITES_CONNECTE[paiement];
    // Le crédit offert est écrit après la liaison, une fois Meta interrogé (relecture du lot) : quelques secondes.
    return `Le numéro est connecté : le branchement est fini. ${AJOUTER_SA_CARTE} Relis ensuite `
      + 'get_setup_state avant d’annoncer la suite : la connexion change l’état de l’espace. Le crédit offert au premier '
      + 'numéro arrive quelques secondes après : s’il est encore à 0, relis une fois quelques secondes plus tard.';
  }
  if (e.code) {
    return 'Écris ce code en entier à la personne, en texte simple : elle le saisit dans la fenêtre de Meta (il s’affiche '
      + `aussi sur la page), puis va jusqu’au dernier écran, « Finish ». ${RAPPEL_ATTENTE}`;
  }
  if (e.fourni && e.codeDejaCapte && destination === undefined) return destinationInconnue(e.fourni);
  if (e.fourni && e.appelApplication) return APPEL_DE_L_APPLICATION;
  if (e.fourni) {
    return `Le numéro ${e.fourni} est attribué. Redonne à la personne les étapes de la page si elle ne les a plus : `
      + `${numerotees(ETAPES_NUMERO_FOURNI.map((x) => x.fr))} ${INSISTE_APPEL_SI_REDONNEES}Le code arrivera aussi ici. ${RAPPEL_ATTENTE}`;
  }
  if (e.abonnement?.statut === 'actif') {
    // Payé, mais la réserve s'est vidée entre-temps : la page dit « en préparation », Claude aussi.
    return 'Le paiement est reçu, mais le numéro est encore en préparation : la page l’affichera dès qu’il est prêt. '
      + `Dis-le à la personne, sans lui redonner le lien. ${RAPPEL_ATTENTE}`;
  }
  return RIEN_ENCORE;
}

/**
 * Les deux suites d'une attente SANS SIGNE de la personne (ni paiement, ni numéro attribué, ni code, ni connexion) : les
 * seules où elle n'a peut-être jamais eu le lien, donc les seules qui portent le filet (`rappelDuLien`).
 */
const sansSigne = (suite: string): boolean => suite === COEXISTENCE_EN_COURS || suite === RIEN_ENCORE;

/**
 * LE MODE DU LIEN NEUF DE L'ATTENTE, ou `null` (jaune 1 de la relecture du lot 1) : l'attente ne signe un lien que là où
 * start_whatsapp_connection l'aurait donné tel quel, et sans rien écrire. Sur l'API seulement (la filière application,
 * par QR code, n'est plus proposée, et start y refuse coexistence et fourni_application). Et pour un numéro fourni, dans
 * le mode de la destination RETENUE (migration 0280), celle que la suite de l'attente suit : un lien d'un autre mode
 * ouvrirait la fenêtre de Meta pendant que la suite dit de taper le code dans l'application, et le code serait perdu
 * (une demande de plus sur les dix que Meta tolère en 72 heures). Une destination retenue écarte aussi apporte et
 * coexistence, SAUF la reprise que le serveur prescrit lui-même (`modeDeReprise`, jaune B1 de la relecture du lot 2) : un
 * numéro fourni déjà dans l'application, son compte créé, se garde par la fenêtre de Meta (`coexistence`) ; c'est la
 * suite de Johan (2026-11-06), et sans ce cas une attente de plus d'une heure n'y aurait aucun lien neuf.
 * 🔴 Tant qu'AUCUN numéro fourni n'est attribué, la destination retenue n'est qu'une intention : la personne qui change
 * d'avis (« finalement j'ai déjà un numéro », Julien, 2026-11-18) reçoit le lien de son propre numéro (`apporte`) ou de
 * son application gardée (`coexistence`). Aucun code de numéro fourni ne peut alors se perdre, et la suite de ces deux
 * modes ne lit rien de la destination sans numéro attribué (`suiteFourniApplication` rend null).
 */
export function modeDuLienNeuf(
  e: Pick<EtatConnexion, 'destination' | 'fourni' | 'connecte' | 'codeDejaCapte'>, filiere: FiliereNumero, mode: unknown,
): ModeNumero | null {
  if (filiere !== 'api' || !estModeNumero(mode)) return null;
  if (mode === 'coexistence' && modeDeReprise(e) === 'coexistence') return mode;
  if ((mode === 'apporte' || mode === 'coexistence') && e.fourni === null) return mode;
  const retenu = e.destination === 'api' ? 'fourni' : e.destination === 'application' ? 'fourni_application' : null;
  if (mode === 'fourni' || mode === 'fourni_application') return mode === retenu ? mode : null;
  return retenu === null ? mode : null;
}

/** L'état tel que Claude le lit. Le code en clair n'y figure qu'à part (`code`), quand il est arrivé. */
function vueEtat(e: EtatConnexion): Record<string, unknown> {
  return {
    ...(e.application ? { filiere: 'application', compte_application: e.application.statut } : {}),
    numero_fourni: e.fourni,
    code_recu_le: e.code?.recuLe ?? null,
    connecte: e.connecte !== null && !e.connecte.aActiver,
    a_activer: e.connecte?.aActiver === true,
    abonnement: e.abonnement?.statut ?? null,
    prochaine_echeance: e.abonnement?.periodeFin ?? null,
    inclus_dans_le_pro: e.inclusDansLePro,
    numero_connecte: e.connecte ? (e.connecte.chiffres ? `+${e.connecte.chiffres}` : null) : null,
    // Relié en coexistence (plan 2026-10-24) : le numéro reste dans l'application WhatsApp Business.
    coexistence: e.connecte?.coexistence === true,
  };
}
export function creerAccompagnementConnexionNumeroMcp(
  deps: DepsConnexionNumeroMcp,
): AccompagnementConnexionNumeroMcp {
  return {
    async demarrer(tenantId, userId, entree) {
      const mode = entree.mode;
      if (!estModeNumero(mode)) {
        throw new RefusOutil('mode : « fourni », « apporte », « coexistence » ou « fourni_application »', 'invalid_args');
      }
      const filiere = entree.filiere ?? 'api';
      if (!estFiliereNumero(filiere)) throw new RefusOutil('filiere : « api » ou « application »', 'invalid_args');
      if ((mode === 'coexistence' || mode === 'fourni_application') && filiere !== 'api') {
        throw new RefusOutil(`${mode} : la filière est « api »`, 'invalid_args');
      }
      const etat = await deps.etat(tenantId);
      const relie = mode === 'coexistence' && etat.application !== undefined ? null : etat.connecte;
      if (relie?.aActiver) {
        throw new RefusOutil('Un numéro est déjà relié à cet espace, mais Meta ne l’a pas encore activé : il reste à finir sa '
          + 'vérification, dans l’Accueil de la console (« Activer le numéro »).', 'conflict');
      }
      if (relie) throw new RefusOutil('Cet espace a déjà un numéro WhatsApp connecté : il n’y a rien à brancher.', 'conflict');
      if (filiere === 'api' && mode === 'fourni' && modeDeReprise(etat) === 'coexistence') {
        throw new RefusOutil(`Le numéro fourni ${etat.fourni} est déjà dans l’application WhatsApp Business (son code de `
          + 'vérification y est arrivé) : la suite est de garder l’application, start_whatsapp_connection avec mode « coexistence ».', 'conflict');
      }
      const destination = destinationDuNumeroFourni(mode);
      if (filiere === 'api' && destination !== null && etat.destination !== destination) {
        await deps.retenirDestination(tenantId, destination);
      }
      if (filiere === 'application' && mode === 'apporte') {
        const brut = typeof entree.numero === 'string' ? entree.numero.replace(/[^0-9]/g, '') : '';
        if (!brut) throw new RefusOutil('numero : le numéro du compte WhatsApp Business, au format international (indicatif compris)', 'invalid_args');
        const p = await deps.comptesApplication.preparer(tenantId, { numero: brut, fourniId: null });
        if (!p.ok) throw new RefusOutil(phraseDuRefusDePreparation(p.raison), p.raison === 'numero_invalide' ? 'invalid_args' : 'conflict');
      }
      const ligne = filiere === 'api' && await deps.fenetrePartenaire(tenantId);
      const jeton = await deps.signerLien({ tenantId, userId, mode, ...(filiere === 'application' ? { filiere } : {}) });
      const url = adresseDuLien(deps.urlConsole, jeton);
      return {
        url,
        expire_le: new Date(deps.maintenant() + DUREE_LIEN_NUMERO_MS).toISOString(),
        consigne: filiere === 'application'
          ? (mode === 'fourni' ? CONSIGNES_APPLICATION.fourni(prixDuNumero(etat), url) : CONSIGNES_APPLICATION.apporte(url))
          : (mode === 'fourni' ? consigneFourni(prixDuNumero(etat), url, ligne)
            : mode === 'fourni_application' ? consigneFourniApplication(prixDuNumero(etat), url, ligne) : CONSIGNES[mode](url, ligne))
            + SI_ELLE_BLOQUE,
      };
    },

    async suivre(tenantId, userId, entree) {
      const filiere: FiliereNumero = entree.filiere === 'application' ? 'application' : 'api';
      const mode = typeof entree.mode === 'string' ? entree.mode : undefined;
      const connu = entree.etatConnu;
      if (connu !== undefined && (typeof connu !== 'string' || !EMPREINTE_RE.test(connu))) {
        throw new RefusOutil('etat_connu : l’empreinte rendue par l’appel précédent (16 caractères hexadécimaux)', 'invalid_args');
      }
      const debut = deps.maintenant();
      for (;;) {
        const e = await deps.etat(tenantId);
        const empreinte = empreinteEtat(e);
        const change = connu === undefined || empreinte !== connu;
        if (change || deps.maintenant() - debut + PAS_ATTENTE_MS > DELAI_ATTENTE_MS) {
          const suite = suiteDe(e, filiere, mode, e.connecte && !e.connecte.aActiver ? await paiementStable(deps, tenantId, debut) : 'carte');
          const filet = sansSigne(suite);
          const modeLien = filet ? modeDuLienNeuf(e, filiere, mode) : null;
          const lien = modeLien === null
            ? null
            : adresseDuLien(deps.urlConsole, await deps.signerLien({ tenantId, userId, mode: modeLien }));
          return {
            change,
            etat: vueEtat(e),
            code: e.code?.code ?? null,
            empreinte,
            lien,
            suite: filet ? suite + rappelDuLien(lien) : suite,
          };
        }
        await deps.attendre(PAS_ATTENTE_MS);
      }
    },
  };
}
