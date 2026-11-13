import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import { CODE_VERIFICATION_FOURNI, ETAPES_NUMERO_FOURNI, SI_SEUL_TEXT_MESSAGE } from '../../web/lib/partage/etapes-numero-fourni';
import { CE_QUI_EST_FACTURE, ETAPES_CARTE_META, NUMERO_LIGNE_MIEN, PREREQUIS_LIGNE, PREREQUIS_META } from '../../web/lib/partage/etapes-meta';
import { creditPaieMeta } from '../../web/lib/partage/credit-whatsapp';
import { lireEtatLigne, tousGardentLApplication } from '../credit-whatsapp/etat-ligne';
import { journaliser } from '../lib/journal';
import { AIDE_DEPANNAGE, AIDE_GARDER_APPLICATION } from '../../web/lib/partage/aide-connexion';
import type { AnnotationsMcp, DepsMcp, OutilMcp, PersonneMcp } from './outils';
import { RefusOutil, valeurOuRefus } from './saisie';
import { MESSAGE_OPERATIONS_LOURDES } from '../auth/plafond-partage';
import type { Issue } from '../lib/issue';
import { DUREE_LIEN_NUMERO_MS, type LienNumero } from '../auth/token';
import { empreinteEtat, modeDeReprise, type EtatConnexion } from '../otp/etat-connexion';
import type { DestinationNumeroFourni } from '../otp/store.pg';
import type { EtatDeLEspace } from '../stripe/abonnements.pg';
import { ETAPES_COMPTE_FOURNI, ETAPES_FENETRE_GARDER, ETAPES_RELIER_APPLICATION } from '../../web/lib/partage/etapes-application';
import type { ComptesApplication } from '../application/comptes';
import { phraseDuRefusDePreparation } from '../application/connexion';

/**
 * LES OUTILS DE LA CONNEXION DU NUMÉRO (lot 3c, livraison A, spec `docs/superpowers/specs/2026-10-06-lien-attente-abonnement-design.md`).
 *
 * Le client ne passe jamais par la console (décision de Julien du 2026-10-06) : `start_whatsapp_connection` lui donne
 * un lien qui ouvre la page de connexion du numéro de SON espace, sans écran de connexion, pendant une heure ;
 * `watch_whatsapp_connection` attend le prochain changement (numéro attribué, code capté, numéro connecté) et rend le
 * code pour que Claude l'affiche dans le terminal.
 *
 * 🔴 Les deux exigent une PERSONNE : le lien agit en son nom (la garde relit à chaque appel qu'elle est encore admin),
 * et l'attente rend un code de vérification. Invisibles derrière une clé d'API.
 */
export interface DepsNumeroMcp {
  /** Signe le jeton du lien (`signLienNumero`, avec le secret des sessions). */
  signerLien(l: LienNumero): Promise<string>;
  /** L'état de la connexion, la MÊME lecture que la page (`lireEtatConnexion`). */
  etat(tenantId: string): Promise<EtatConnexion>;
  /** L'adresse de la console (`APP_URL`), où vit la page `/brancher`. */
  urlConsole: string;
  attendre(ms: number): Promise<void>;
  maintenant(): number;
  /** Le portail client de Stripe pour l'espace (`ouvrirPortail`, livraison B) : une adresse, ou un refus. */
  ouvrirPortail(tenantId: string, payeur: string): Promise<Issue<{ url: string }>>;
  /** L'état de l'abonnement et ses dates (lot 4) : la SEULE lecture (`PgAbonnementsNumeroStore.etatDeLEspace`). */
  abonnement(tenantId: string): Promise<EtatDeLEspace | null>;
  /** Un nouveau paiement de l'abonnement (lot 4, réabonnement du même numéro), retour sur `/paiement-recu`. */
  ouvrirAbonnement(tenantId: string, payeur: string): Promise<Issue<{ url: string }>>;
  /**
   * La suite du numéro fourni que le Pro vivant annonce (lot 6, B2b, `PgAbonnementsOffreStore.suiteDuNumero`) : une
   * lecture légère, faite à chaque réponse d'outil pour le rappel.
   */
  suiteDuPro(tenantId: string): Promise<{ finPrevueLe: Date | null; rendreNumero: boolean } | null>;
  /** Rendre le numéro à la fin du Pro (`PgAbonnementsOffreStore.rendreLeNumero`) : `false` sans Pro vivant. */
  rendreLeNumero(tenantId: string, rendre: boolean): Promise<boolean>;
  /** La filière application (2026-10-22) : son propre numéro se prépare dès le lien, que la page relie par QR code. */
  comptesApplication: Pick<ComptesApplication, 'preparer'>;
  /** Retient où va le numéro fourni (`PgNumerosFournisStore.retenirDestination`, migration 0280), relu par `modeDeReprise`. */
  retenirDestination(tenantId: string, destination: DestinationNumeroFourni): Promise<void>;
  /**
   * La fenêtre du partenaire est-elle ouverte à l'espace (`solutionDuPartenaire`, lot E du Crédit WhatsApp, lot 3v-2b) ?
   * Sans numéro : l'option payée (ou une Entreprise), et `/brancher` ouvre alors d'elle-même la connexion sans carte, en
   * `apporte` et en `fourni`. Avec un numéro : le numéro de l'essai connecté avec la carte chez Meta, puis l'option prise,
   * qui se reconnecte depuis l'onglet Crédit WhatsApp (sa carte paie encore Meta d'ici là).
   */
  fenetrePartenaire(tenantId: string): Promise<boolean>;
}

const jour = (d: Date | null): string | null => (d === null ? null : d.toISOString().slice(0, 10));
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * Le rappel que porte chaque réponse d'outil MCP de l'espace (lot 4) : en retard, la date de la coupure ; suspendu, la
 * coupure et, si le numéro est gardé, sa libération. Rien dans les autres états. `src/mcp/serveur.ts` l'ajoute.
 */
export function rappelDeLAbonnement(a: EtatDeLEspace | null): string | null {
  if (a === null) return null;
  if (a.etat === 'en_retard') {
    // Sans date de coupure, rien ne sera coupé (un autre numéro que le numéro fourni envoie) : aucune date inventée.
    return a.coupureLe === null
      ? 'Rappel : le renouvellement de l’abonnement du numéro WhatsApp fourni a échoué. resubscribe_number donne le lien pour régler.'
      : `Rappel : le renouvellement de l’abonnement du numéro WhatsApp a échoué. Sans paiement, ses envois seront coupés le ${jour(a.coupureLe)}. `
        + 'resubscribe_number donne le lien pour régler.';
  }
  if (a.etat === 'suspendu') {
    return a.finiLe !== null
      ? `Les envois du numéro WhatsApp sont coupés : son abonnement est terminé. Sans réabonnement, le numéro sera libéré le ${jour(a.liberationLe)}. `
        + 'resubscribe_number donne le lien pour se réabonner au même numéro.'
      : 'Les envois du numéro WhatsApp sont coupés : son abonnement est impayé. resubscribe_number donne le lien pour régler.';
  }
  return null;
}

/**
 * L'attente rend la main au plus tard au bout de 25 secondes : le proxy de `api.messagingme.app` coupe une réponse à
 * 45 (`proxy_read_timeout 45s`, NPM, lu le 2026-10-06), et la marge couvre la dernière lecture et la réponse.
 */
/**
 * Le rappel de la suite du numéro à la fin prévue du Pro (lot 6, B2b, décision de Julien : la console, Claude et un
 * e-mail l'annoncent). Rien tant que le Pro court sans fin, ni sans numéro fourni (`null`).
 */
export function rappelDeLaSuiteDuPro(s: { finPrevueLe: Date | null; rendreNumero: boolean } | null): string | null {
  if (s === null || s.finPrevueLe === null) return null;
  return s.rendreNumero
    ? `Rappel : la formule Pro de l’espace se termine le ${jour(s.finPrevueLe)}, et le numéro WhatsApp fourni sera alors rendu (ses `
      + 'envois coupés, puis libéré 7 jours après). return_number_at_plan_end avec rendre = false le garde.'
    : `Rappel : la formule Pro de l’espace se termine le ${jour(s.finPrevueLe)}. Le numéro WhatsApp fourni passera alors à 3,50 € HT `
      + 'par mois sur la même carte ; return_number_at_plan_end avec rendre = true le rend à la place.';
}

export const DELAI_ATTENTE_MS = 25_000;
/** Une lecture de l'état toutes les deux secondes : le code arrive à l'écran comme sur la page (trois secondes). */
export const PAS_ATTENTE_MS = 2_000;
/** La forme d'une empreinte (`empreinteEtat`) : seize chiffres hexadécimaux. */
const EMPREINTE_RE = /^[0-9a-f]{16}$/;

/** Une écriture est toujours `destructiveHint: true` (règle du répertoire de Claude, voir `AnnotationsMcp`). */
const ecriture = (title: string, idempotentHint: boolean): AnnotationsMcp =>
  ({ title, readOnlyHint: false, destructiveHint: true, idempotentHint, openWorldHint: false });

function signataire(personne: PersonneMcp | null): string {
  if (personne === null) throw new RefusOutil('connexion OAuth requise : cet outil agit au nom d’une personne');
  return personne.userId;
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
 * à l'adresse de sa langue. Le mode op du parcours n'existe encore que pour garder l'application (A, cité dans
 * `AVANT_LE_LIEN_GARDER`) ; ceux du numéro fourni et de son propre numéro viendront avec leurs pages (lot 4c).
 */
const SI_ELLE_BLOQUE = ' Si elle bloque (pas de code, une fenêtre de Meta qui refuse son numéro ou ne s’ouvre pas), donne-lui '
  + `la page de dépannage, à l’adresse de sa langue : en français ${AIDE_DEPANNAGE.fr} ; dans une autre langue `
  + `${AIDE_DEPANNAGE.en} .`;

/**
 * Garder l'application, c'est payer Meta avec sa carte (révision du Crédit WhatsApp, lot C) : la phrase de la console
 * (`NOTE_CARTE_APPLICATION`, `web/lib/questions-numero.ts`), que `tests/mcp-numero.test.ts` tient égale.
 */
const CARTE_AVEC_APPLICATION = ' Dis-lui aussi, dans sa langue : « Vous payez Meta avec votre carte : le Crédit WhatsApp n’est pas '
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
const SANS_CARTE = 'Cet espace a droit au Crédit WhatsApp (l’option prise, ou en Entreprise) : ce lien ouvre la connexion '
  + 'sans carte chez Meta, la page s’en charge d’elle-même. ';
const PREREQUIS_LIGNE_FOURNI = prerequis(PREREQUIS_LIGNE);
const PREREQUIS_LIGNE_APPORTE = prerequis([...PREREQUIS_LIGNE, NUMERO_LIGNE_MIEN]);
const QUI_PAIE_LIGNE = 'Puis qui paie, dans sa langue : « Vos messages se paient par votre Crédit WhatsApp : aucune carte '
  + 'chez Meta. » Hors Entreprise (où il suit son contrat, illimité), ce crédit est prépayé chez Messaging Me et part de '
  + 'zéro : une fois le numéro connecté et sa ligne ouverte, propose-lui de le recharger (buy_credit avec credit '
  + '« whatsapp ») avant ses premiers modèles. ';
/** Le numéro de la personne déjà dans une application WhatsApp : la ligne ne paie pas un numéro qui la garde. */
const SI_NUMERO_DANS_WHATSAPP_LIGNE = 'Si son numéro sert dans WhatsApp ou dans l’application WhatsApp Business, dis-lui '
  + 'd’abord qu’avec le Crédit WhatsApp il n’y marchera plus : ses clients lui écriront dans Messaging Me, et elle leur '
  + 'répondra là (la console, ou toi). Pour garder l’application, rappelle start_whatsapp_connection avec mode '
  + '« coexistence » : ses messages se paieront alors avec sa carte chez Meta, pas par le crédit. ';
/** Garder l'application alors que l'espace a pris le Crédit WhatsApp : le dire, pour qu'elle choisisse en connaissance. */
const CREDIT_SANS_APPLICATION = ' Préviens-la aussi : cet espace a pris le Crédit WhatsApp, qui ne paie pas un numéro qui '
  + 'garde l’application ; pour qu’il paie, un numéro hors de toute application WhatsApp (start_whatsapp_connection avec '
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
 * La consigne du numéro fourni : les étapes de la page (`ETAPES_NUMERO_FOURNI`, la même source), encadrées par le lien
 * et le paiement avant, et par le retour vers Claude après « Finish » (essai 99, ordre de Julien). En Pro (J4 de la
 * relecture de B2b), le numéro est inclus : la page l'obtient sans payer, et Claude n'annonce pas un prix qu'elle ne
 * demande pas.
 */
const consigneFourni = (inclusDansLePro: boolean, url: string, ligne: boolean): string =>
  (ligne ? SANS_CARTE + PREREQUIS_LIGNE_FOURNI + CODE_EXPLIQUE + QUI_PAIE_LIGNE : PREREQUIS_FOURNI + CODE_EXPLIQUE + QUI_PAIE_API)
  + lienEnEntier(url) + 'Il ouvre la page de connexion de son numéro, sans se connecter, pendant une heure. Donne-lui ces '
  + 'étapes, numérotées, une par ligne, dans sa langue ; la page affiche les mêmes : '
  + numerotees([
    'Cliquer sur le lien.',
    inclusDansLePro
      ? '« Obtenir mon numéro » : il est inclus dans son offre, rien à payer ; le numéro s’affiche sur la page.'
      : '« Payer 3,50 € HT par mois » ; une fois le paiement confirmé, le numéro s’affiche sur la page.',
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
 * Ce que le numéro fourni mis dans l'application permet dès le premier jour. 🔴 Plus de « Meta refuse souvent un numéro
 * tout neuf, revenez dans quelques jours » (Julien, 2026-11-11 : « on a testé qu'un nouveau numéro peut être coex sans
 * problème, on ne dit pas de connerie sur ce sujet ») : la console, la vitrine et le plugin l'ont retiré aussi.
 */
const NUMERO_NEUF = 'dès le premier jour, elle répond à ses clients depuis l’application.';
/**
 * La dernière étape du numéro fourni mis dans l'application : le bouton de la page, la même fenêtre qu'en coexistence.
 * Son libellé est celui de `COEXISTENCE_BOUTON` (`web/lib/fenetre-meta.ts`), que `tests/mcp-numero.test.ts` tient égal.
 */
const GARDER_APRES_COMPTE = 'Une fois le compte créé dans l’application, « Garder mon application WhatsApp Business » sur la '
  + 'page : dans la fenêtre de Meta, saisir ce numéro et confirmer dans l’application, sur le téléphone.';

/**
 * LE NUMÉRO FOURNI MIS DANS L'APPLICATION (plan 2026-10-31, décision de Julien : « Dans l'application ») : le payer ou
 * l'obtenir, créer avec lui le compte de l'application WhatsApp Business (le pont des codes capte l'appel de
 * vérification de l'application, mesuré le 2026-10-21), puis la fenêtre de Meta en coexistence sur ce même numéro. Les
 * étapes sont celles de la page (`ETAPES_COMPTE_FOURNI`, puis le bouton de la coexistence).
 */
const consigneFourniApplication = (inclusDansLePro: boolean, url: string, ligne: boolean): string =>
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
    inclusDansLePro
      ? '« Obtenir mon numéro » : il est inclus dans son offre, rien à payer ; le numéro s’affiche sur la page.'
      : '« Payer 3,50 € HT par mois » ; une fois le paiement confirmé, le numéro s’affiche sur la page.',
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
  + 'garder l’application : sur la page, « Garder mon application WhatsApp Business », puis, dans la fenêtre de Meta, '
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
  fourni: (inclusDansLePro: boolean, url: string) => lienEnEntier(url) + 'Il ouvre, sur un ordinateur, la page de connexion de son numéro, sans se '
    + 'connecter, pendant une heure. Donne-lui ces étapes, numérotées, une par ligne, dans sa langue ; la page affiche les mêmes : '
    + numerotees([
      'Ouvrir le lien sur un ordinateur.',
      inclusDansLePro
        ? '« Obtenir mon numéro » : il est inclus dans son offre, rien à payer ; le numéro s’affiche sur la page.'
        : '« Payer 3,50 € HT par mois » ; une fois le paiement confirmé, le numéro s’affiche sur la page.',
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
 * QUI PAIE META POUR LE NUMÉRO CONNECTÉ (lot 3v-2b) : sa carte (la suite d'avant), le Crédit WhatsApp (sa ligne posée, ou
 * l'option payée qui l'attend, pour un numéro qui ne garde pas l'application : `creditPaieMeta`, la règle de
 * `get_setup_state`), ou sa carte ENCORE, l'option prise sur le numéro de l'essai connecté avec elle, qui se reconnecte
 * sans carte depuis l'onglet (le serveur ne rouvre la fenêtre du partenaire à un espace connecté que pour ce cas).
 */
type PaiementDuNumero = 'carte' | 'credit' | 'attente' | 'reconnecter' | 'regler' | 'support';
const RELIRE_APRES_CONNEXION = 'Relis ensuite get_setup_state avant d’annoncer la suite : la connexion change l’état de '
  + 'l’espace. Le crédit IA offert au premier numéro arrive quelques secondes après : s’il est encore à 0, relis une fois '
  + 'quelques secondes plus tard.';
const CONNECTE_PAR_LE_CREDIT = 'Le numéro est connecté : le branchement est fini. Ses messages se paient par le Crédit '
  + 'WhatsApp, sans carte chez Meta : ne lui demande aucune carte. Si le solde de ce Crédit WhatsApp est à zéro (get_credit '
  + 'le dit, dans credit_whatsapp ; jamais en Entreprise, où il est illimité), propose-lui de le recharger (buy_credit avec '
  + `credit « whatsapp ») avant ses premiers modèles. ${RELIRE_APRES_CONNEXION}`;
/** L'option payée, la ligne pas encore posée (pose refusée, ou la pose automatique coupée) : la recharge attend la ligne. */
const CONNECTE_EN_ATTENTE = 'Le numéro est connecté sans carte chez Meta : ne lui demande aucune carte. Sa ligne de Crédit '
  + 'WhatsApp s’ouvre sous 24 h ouvrées au plus ; la recharge du Crédit WhatsApp vient ensuite (get_credit le montrera), '
  + `elle n’est pas possible avant. ${RELIRE_APRES_CONNEXION}`;
const CONNECTE_A_RECONNECTER = 'Le numéro est connecté avec sa carte chez Meta, qui paie encore ses messages : l’espace a '
  + 'pris le Crédit WhatsApp, et le numéro se reconnecte sans carte depuis l’onglet Crédit WhatsApp de la page Offre de la '
  + 'console (« Reconnecter mon numéro sans carte chez Meta »). Dis-le-lui ; d’ici là, sans carte chez Meta, ses modèles '
  + `ne partent pas. ${RELIRE_APRES_CONNEXION}`;
/** Le bouton de l'onglet n'existe que pour une option à jour : l'option en retard se règle d'abord, au même onglet. */
const CONNECTE_A_REGLER = 'Le numéro est connecté avec sa carte chez Meta, qui paie encore ses messages : le paiement de '
  + 'l’option Crédit WhatsApp n’est pas à jour. Dis-lui de le régler dans l’onglet Crédit WhatsApp de la page Offre de la '
  + 'console ; le numéro s’y reconnectera ensuite sans carte. D’ici là, sans carte chez Meta, ses modèles ne partent pas. '
  + RELIRE_APRES_CONNEXION;
/** En Entreprise, pas de bouton : notre équipe passe le numéro sur le Crédit WhatsApp. */
const CONNECTE_PAR_LE_SUPPORT = 'Le numéro est connecté avec sa carte chez Meta, qui paie encore ses messages. En '
  + 'Entreprise, notre équipe le passe sur le Crédit WhatsApp : dis-lui de nous écrire depuis le Support de la console. '
  + RELIRE_APRES_CONNEXION;
const SUITES_CONNECTE: Readonly<Record<Exclude<PaiementDuNumero, 'carte'>, string>> = {
  credit: CONNECTE_PAR_LE_CREDIT, attente: CONNECTE_EN_ATTENTE, reconnecter: CONNECTE_A_RECONNECTER,
  regler: CONNECTE_A_REGLER, support: CONNECTE_PAR_LE_SUPPORT,
};

/** Lu seulement quand le numéro est connecté. Une lecture qui échoue garde la suite d'avant, la carte, et se journalise. */
async function paiementDuNumero(deps: DepsMcp, tenantId: string): Promise<PaiementDuNumero> {
  try {
    const wa = deps.agentIa.creditWhatsapp;
    if (await deps.numero.fenetrePartenaire(tenantId)) {
      // Le numéro de l'essai connecté avec sa carte, l'option prise (V4 de la session du crédit) : le bouton de
      // l'onglet n'existe que pour une option à jour, hors Entreprise.
      const [offre, option] = await Promise.all([wa.option.offre(tenantId), wa.option.options.vivante(tenantId)]);
      if (offre === 'entreprise') return 'support';
      return option?.statut === 'actif' ? 'reconnecter' : 'regler';
    }
    const [etat, numeros] = await Promise.all([lireEtatLigne(wa, tenantId), wa.vue.numeros(tenantId)]);
    if (!creditPaieMeta(etat, tousGardentLApplication(numeros))) return 'carte';
    return etat === 'en_attente' ? 'attente' : 'credit';
  } catch (err) {
    journaliser('error', 'mcp_paiement_du_numero_illisible', { tenantId, err });
    return 'carte';
  }
}

/**
 * 🔴 LA COURSE DE LA CONNEXION SANS CARTE (rouge de la relecture du lot) : le numéro est relié (`linkTenant`) AVANT que sa
 * ligne soit posée ou qu'il soit marqué arrivé par la fenêtre du partenaire (quelques secondes d'appels à Meta) ; entre
 * les deux, la règle le lit comme le numéro de l'essai connecté avec sa carte. On relit donc tant qu'elle dit « carte qui
 * paie encore », jusqu'à la fin de l'attente et au moins cinq pas : un vrai numéro à reconnecter le reste jusqu'au bout.
 */
async function paiementStable(deps: DepsMcp, tenantId: string, debut: number): Promise<PaiementDuNumero> {
  const limite = Math.max(debut + DELAI_ATTENTE_MS, deps.numero.maintenant() + 5 * PAS_ATTENTE_MS);
  let p = await paiementDuNumero(deps, tenantId);
  while ((p === 'reconnecter' || p === 'regler' || p === 'support') && deps.numero.maintenant() + PAS_ATTENTE_MS <= limite) {
    await deps.numero.attendre(PAS_ATTENTE_MS);
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
function suiteDe(e: EtatConnexion, filiere: 'api' | 'application', mode?: string, paiement: PaiementDuNumero = 'carte'): string {
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
    return 'Le numéro est connecté : le branchement est fini. Dis-lui tout de suite d’ajouter sa carte chez Meta, sans '
      + `laquelle les modèles ne partent pas : ${numerotees(ETAPES_CARTE_META.map((e) => e.fr))} Relis ensuite `
      + 'get_setup_state avant d’annoncer la suite : la connexion change l’état de l’espace. Le crédit offert au premier '
      + 'numéro arrive quelques secondes après : s’il est encore à 0, relis une fois quelques secondes plus tard.';
  }
  if (e.code) {
    return 'Écris ce code en entier à la personne, en texte simple : elle le saisit dans la fenêtre de Meta (il s’affiche '
      + `aussi sur la page), puis va jusqu’au dernier écran, « Finish ». ${RAPPEL_ATTENTE}`;
  }
  if (e.fourni && e.codeDejaCapte && destination === undefined) return destinationInconnue(e.fourni);
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

const MODES = ['fourni', 'apporte', 'coexistence', 'fourni_application'] as const;
type ModeNumero = (typeof MODES)[number];
const estMode = (m: unknown): m is ModeNumero => typeof m === 'string' && (MODES as readonly string[]).includes(m);

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
 */
export function modeDuLienNeuf(
  e: Pick<EtatConnexion, 'destination' | 'fourni' | 'connecte' | 'codeDejaCapte'>, filiere: 'api' | 'application', mode: unknown,
): ModeNumero | null {
  if (filiere !== 'api' || !estMode(mode)) return null;
  if (mode === 'coexistence' && modeDeReprise(e) === 'coexistence') return mode;
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

export const OUTILS_NUMERO: OutilMcp[] = [
  {
    ...ficheOutilMcp('return_number_at_plan_end'),
    fonction: null,
    description:
      'Chooses what becomes of the provided WhatsApp number at the END of the workspace\'s Pro plan: rendre = true '
      + 'gives it back (its sends are cut when Pro ends, then it is released 7 days later); rendre = false keeps it, at '
      + '€3.50 excl. VAT a month on the same card as Pro. Reversible while Pro runs; refused without a running Pro. '
      + 'This choice belongs to the person and is made at their explicit request.',
    annotations: ecriture('Give back the number when Pro ends', true),
    entree: {
      type: 'object',
      properties: { rendre: { type: 'boolean', description: 'true: give the number back when Pro ends; false: keep it.' } },
      required: ['rendre'],
      additionalProperties: false,
    },
    async executer(deps: DepsMcp, tenantId, args, personne) {
      signataire(personne);
      if (typeof args.rendre !== 'boolean') throw new RefusOutil('paramètre « rendre » requis : true ou false');
      if (!(await deps.numero.rendreLeNumero(tenantId, args.rendre))) {
        throw new RefusOutil('Cet espace n’a pas de formule Pro en cours : il n’y a pas de fin de formule Pro où rendre le numéro.');
      }
      return { rendre_numero: args.rendre };
    },
  },
  {
    ...ficheOutilMcp('get_number_subscription'),
    fonction: null,
    description:
      'The subscription of the provided WhatsApp number (€3.50 excl. VAT a month): its status (actif, en_retard after '
      + 'a failed payment, resilie), the end of the paid period, and the number. `abonnement: null`: the workspace has '
      + 'no paid provided number. `inclus_dans_le_pro: true`: the workspace\'s plan (Pro, Business or Entreprise) includes the number, there is '
      + 'nothing to pay.',
    annotations: { title: 'Read the number subscription', readOnlyHint: true, openWorldHint: false },
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps: DepsMcp, tenantId) {
      // L'état calculé est un complément : une lecture qui échoue ne prive pas Claude du statut (jaune 7 de A).
      const [e, a] = await Promise.all([deps.numero.etat(tenantId), deps.numero.abonnement(tenantId).catch(() => null)]);
      return {
        abonnement: e.abonnement?.statut ?? null,
        prochaine_echeance: e.abonnement?.periodeFin ?? null,
        numero_fourni: e.fourni,
        prix: e.inclusDansLePro ? 'inclus en formule Pro' : '3,50 € HT par mois',
        inclus_dans_le_pro: e.inclusDansLePro,
        // Lot 4 : l'état calculé (actif, fin_prevue, en_retard, suspendu, libere) et ses dates.
        etat: a?.etat ?? null,
        fin_prevue: iso(a?.finPrevueLe),
        coupure_le: iso(a?.coupureLe),
        liberation_le: iso(a?.liberationLe),
      };
    },
  },
  {
    ...ficheOutilMcp('manage_number_subscription'),
    fonction: null,
    description:
      'Returns the URL of the Stripe customer portal for the number subscription: change card, read invoices, '
      + 'cancel. The person acts on that page themselves. Counts toward the workspace\'s heavy operations.',
    // Monde ouvert : une session est créée chez Stripe. Une de plus à chaque appel. Destructrice pour la règle du
    // répertoire de Claude (voir `AnnotationsMcp`).
    annotations: { title: 'Manage the number subscription', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps: DepsMcp, tenantId, _args, personne) {
      const payeur = signataire(personne);
      const c = await deps.couteux.consommer(tenantId);
      if (!c.accepte) throw new RefusOutil(`${MESSAGE_OPERATIONS_LOURDES} (réessayer dans ${Math.max(1, Math.ceil(c.attenteMs / 1000))} s)`);
      return valeurOuRefus(await deps.numero.ouvrirPortail(tenantId, payeur));
    },
  },
  {
    ...ficheOutilMcp('resubscribe_number'),
    fonction: null,
    description:
      'Renews the subscription of the provided WhatsApp number when it is unpaid or ended, and returns the URL the '
      + 'person uses. Unpaid (late, or suspended for non-payment): the Stripe portal, to pay the open invoice or change '
      + 'card. Ended, number still held: a new payment, which gives back the SAME number without going through Meta\'s '
      + 'window again. Cancellation scheduled: the portal, to undo it. Counts toward the workspace\'s heavy operations.',
    // Monde ouvert : une session est créée chez Stripe. Destructrice pour la règle du répertoire de Claude.
    annotations: { title: 'Renew the number subscription', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps: DepsMcp, tenantId, _args, personne) {
      const payeur = signataire(personne);
      const a = await deps.numero.abonnement(tenantId);
      if (a === null || a.etat === 'libere') {
        throw new RefusOutil('Cet espace n’a plus d’abonnement de numéro à renouveler : pour un nouveau numéro fourni, '
          + 'start_whatsapp_connection en mode « fourni ».');
      }
      if (a.etat === 'actif') throw new RefusOutil('L’abonnement du numéro est actif : rien à renouveler.');
      const c = await deps.couteux.consommer(tenantId);
      if (!c.accepte) throw new RefusOutil(`${MESSAGE_OPERATIONS_LOURDES} (réessayer dans ${Math.max(1, Math.ceil(c.attenteMs / 1000))} s)`);
      if (a.etat === 'suspendu' && a.finiLe !== null) {
        return {
          ...valeurOuRefus(await deps.numero.ouvrirAbonnement(tenantId, payeur)),
          consigne: 'Donne ce lien à la personne : le paiement rend le même numéro, et ses envois repartent dès que Stripe '
            + 'l’a confirmé (get_number_subscription le dit).',
        };
      }
      return {
        ...valeurOuRefus(await deps.numero.ouvrirPortail(tenantId, payeur)),
        consigne: a.etat === 'fin_prevue'
          ? 'Donne ce lien à la personne : dans le portail de Stripe, elle peut annuler la résiliation programmée.'
          : 'Donne ce lien à la personne : dans le portail de Stripe, elle paie la facture en attente ou change de carte.',
      };
    },
  },
  {
    ...ficheOutilMcp('start_whatsapp_connection'),
    fonction: null,
    description:
      'Returns the link that opens the connection page of the workspace\'s WhatsApp number, without going through the '
      + 'console, valid for one hour: the person goes through Meta\'s window there. `fourni`: a dedicated number is '
      + 'provided (€3.50 excl. VAT a month, paid on the page before it is assigned; included, with nothing to pay, for '
      + 'a workspace on Pro), whose verification code arrives here through watch_whatsapp_connection. `apporte`: the '
      + 'person\'s own number, used in no WhatsApp app; a number used in WhatsApp (the regular app, once the person '
      + 'installed WhatsApp Business on the same phone, which takes it over with its chats) or in the WhatsApp Business '
      + 'app goes through `coexistence`, never to another number. `coexistence`: the person\'s own number, kept in the WhatsApp Business app on their phone; messages sent '
      + 'through Messaging Me are official templates billed by Meta, those typed in the app stay free (filiere api only). '
      + 'Without a Meta Business account, Meta\'s window creates it along the way, in `apporte` and `fourni` as in '
      + '`coexistence`: a person without the WhatsApp Business app connects their number, or a provided one, as an API '
      + 'number, with no app to install. `fourni_application` is no longer offered, only resumed: a number we provide, '
      + 'already put IN the WhatsApp Business app (its verification code arrives here), then kept there through Meta\'s '
      + 'window, like coexistence; still accepted for a connection started that way, which numero.reprise of '
      + 'get_setup_state names (filiere api only). When the workspace took WhatsApp credit and has no number yet, the link of `fourni` and '
      + '`apporte` opens the connection without a card at Meta, and the consigne gives its conditions; the credit never '
      + 'pays a number that keeps the app. '
      + 'Refused if the workspace already has a connected number, except `coexistence` for a number linked by QR code, '
      + 'which moves to the API on the same number.',
    // Il ne touche rien chez un tiers et ne crée rien : un lien signé de plus à chaque appel.
    annotations: ecriture('Open the WhatsApp number connection', false),
    entree: {
      type: 'object',
      properties: {
        mode: {
          type: 'string', enum: ['fourni', 'apporte', 'coexistence', 'fourni_application'],
          description: 'fourni: a number we provide; apporte: the person\'s own number; coexistence: the person\'s own number, '
            + 'kept in the WhatsApp Business app; fourni_application: a number we provide, already put in the WhatsApp '
            + 'Business app and kept there (no longer offered, only resumed).',
        },
        // 🔴 Plus aucune voie par QR code proposée (Julien, 2026-10-30) : sans compte Meta Business, la fenêtre de Meta
        // crée le compte en chemin. Depuis le 2026-11-12, sans l'application, le numéro se relie en numéro API (apporte ou
        // fourni) : on ne la fait plus télécharger. La valeur `application` reste acceptée pour un lien déjà en cours ;
        // rien ne la propose plus.
        filiere: {
          type: 'string', enum: ['api', 'application'],
          description: 'Leave it out: api, the official WhatsApp API. application, the link of the WhatsApp Business app by QR '
            + 'code, is no longer offered: never propose it. Without a Meta Business account, Meta\'s window creates the '
            + 'account along the way: the person connects their own number (apporte) or a number we provide (fourni) as an '
            + 'API number, or keeps the WhatsApp Business app they already have (coexistence).',
        },
        numero: {
          type: 'string', maxLength: 30,
          description: 'With filiere application and mode apporte only: the phone number of the WhatsApp Business app account, in '
            + 'international format (country code included).',
        },
      },
      required: ['mode'],
      additionalProperties: false,
    },
    async executer(deps: DepsMcp, tenantId, args, personne) {
      const userId = signataire(personne);
      const mode = args.mode;
      if (mode !== 'fourni' && mode !== 'apporte' && mode !== 'coexistence' && mode !== 'fourni_application') {
        throw new RefusOutil('mode : « fourni », « apporte », « coexistence » ou « fourni_application »');
      }
      const filiere = args.filiere ?? 'api';
      if (filiere !== 'api' && filiere !== 'application') throw new RefusOutil('filiere : « api » ou « application »');
      // La coexistence EST l'API officielle : le numéro de l'application WhatsApp Business passe aussi sur l'API Cloud.
      if ((mode === 'coexistence' || mode === 'fourni_application') && filiere !== 'api') {
        throw new RefusOutil(`${mode} : la filière est « api »`);
      }
      const etat = await deps.numero.etat(tenantId);
      // 🔴 Le passage du QR code (plan 2026-10-24) : quand la seule chose reliée est un compte de l'application
      // (`etat.application`, présent seulement sans numéro de Meta), la coexistence le fait passer sur l'API, sur le même
      // numéro. Tout autre mode reste refusé, et un numéro de Meta relié refuse aussi la coexistence.
      const relie = mode === 'coexistence' && etat.application !== undefined ? null : etat.connecte;
      if (relie?.aActiver) {
        throw new RefusOutil('Un numéro est déjà relié à cet espace, mais Meta ne l’a pas encore activé : il reste à finir sa '
          + 'vérification, dans l’Accueil de la console (« Activer le numéro »).');
      }
      if (relie) throw new RefusOutil('Cet espace a déjà un numéro WhatsApp connecté : il n’y a rien à brancher.');
      // 🔴 Un numéro fourni déjà mis dans l'application et vérifié (Johan, 2026-11-06) : la fenêtre de Meta d'un numéro neuf
      // le refuserait, et retenir `api` effacerait la seule chose qui dit où il est. Sa seule suite : garder l'application.
      if (filiere === 'api' && mode === 'fourni' && modeDeReprise(etat) === 'coexistence') {
        throw new RefusOutil(`Le numéro fourni ${etat.fourni} est déjà dans l’application WhatsApp Business (son code de `
          + 'vérification y est arrivé) : la suite est de garder l’application, start_whatsapp_connection avec mode « coexistence ».');
      }
      // La destination du numéro fourni (migration 0280), que la suite de l'attente et la reprise d'une session relisent.
      // Pas pour `coexistence` : elle peut porter le numéro de la personne, et non le numéro fourni de l'espace. 🔴 Écrite
      // seulement quand elle CHANGE : son heure dit depuis quand un code prouve le compte de l'application, et un lien
      // redemandé sur la même voie ne doit pas faire oublier un compte déjà créé.
      if (filiere === 'api' && (mode === 'fourni' || mode === 'fourni_application')) {
        const destination = mode === 'fourni' ? 'api' : 'application';
        if (etat.destination !== destination) await deps.numero.retenirDestination(tenantId, destination);
      }
      if (filiere === 'application' && mode === 'apporte') {
        // Son propre numéro : le compte se prépare maintenant, la page n'aura plus qu'à afficher son QR code.
        const brut = typeof args.numero === 'string' ? args.numero.replace(/[^0-9]/g, '') : '';
        if (!brut) throw new RefusOutil('numero : le numéro du compte WhatsApp Business, au format international (indicatif compris)');
        const p = await deps.numero.comptesApplication.preparer(tenantId, { numero: brut, fourniId: null });
        if (!p.ok) throw new RefusOutil(phraseDuRefusDePreparation(p.raison));
      }
      // La connexion sans carte (lot 3v-2b) : la règle même de la page, qui l'ouvre d'elle-même en `apporte` et `fourni`
      // (`solutionDuPartenaire`, que la configuration du lien rend) ; la consigne dit ses conditions, et le crédit qui paie.
      const ligne = filiere === 'api' && await deps.numero.fenetrePartenaire(tenantId);
      const jeton = await deps.numero.signerLien({ tenantId, userId, mode, ...(filiere === 'application' ? { filiere } : {}) });
      const url = adresseDuLien(deps.numero.urlConsole, jeton);
      return {
        url,
        expire_le: new Date(deps.numero.maintenant() + DUREE_LIEN_NUMERO_MS).toISOString(),
        consigne: filiere === 'application'
          ? (mode === 'fourni' ? CONSIGNES_APPLICATION.fourni(etat.inclusDansLePro, url) : CONSIGNES_APPLICATION.apporte(url))
          : (mode === 'fourni' ? consigneFourni(etat.inclusDansLePro, url, ligne)
            : mode === 'fourni_application' ? consigneFourniApplication(etat.inclusDansLePro, url, ligne) : CONSIGNES[mode](url, ligne))
            + SI_ELLE_BLOQUE,
      };
    },
  },
  {
    ...ficheOutilMcp('watch_whatsapp_connection'),
    fonction: null,
    description:
      'Waits for the next change in the number connection (number assigned, verification code received, number '
      + `connected) and returns the state, after ${DELAI_ATTENTE_MS / 1000} seconds at most. With the fingerprint `
      + 'returned by the previous call (etat_connu), only something new wakes it up; without it, the state is returned '
      + 'at once. When `code` is present, it is the code the person copies into Meta\'s window. Successive calls follow '
      + 'the connection until `connecte: true`; with mode `coexistence`, until `coexistence: true`, a number linked by QR '
      + 'code staying `connecte` until Meta links it to the API, the WhatsApp Business app kept. With mode '
      + '`fourni_application`, the code is typed in the WhatsApp Business app, not in Meta\'s window. `lien`: while nothing '
      + 'has moved yet, a fresh link to the same connection page, signed for the given mode; null without a mode, or when '
      + 'that mode differs from the way already chosen.',
    // Écriture parce qu'il rend un code de vérification ; NON idempotent depuis le lot 1 de l'aide à la connexion (jaune 3) :
    // tant que rien n'a bougé, chaque réponse signe un lien neuf, comme chaque appel de start_whatsapp_connection.
    annotations: ecriture('Follow the WhatsApp number connection', false),
    entree: {
      type: 'object',
      properties: {
        etat_connu: {
          type: 'string', maxLength: 16, pattern: EMPREINTE_RE.source,
          description: 'The fingerprint returned by the previous call; absent on the initial call.',
        },
        filiere: { type: 'string', enum: ['api', 'application'], description: 'The filiere chosen with start_whatsapp_connection (default api).' },
        mode: {
          type: 'string', enum: ['fourni', 'apporte', 'coexistence', 'fourni_application'],
          description: 'The mode chosen with start_whatsapp_connection: coexistence and fourni_application change what is '
            + 'awaited, and the fresh link (`lien`) is signed for it.',
        },
      },
      additionalProperties: false,
    },
    async executer(deps: DepsMcp, tenantId, args, personne) {
      const userId = signataire(personne);
      const filiere = args.filiere === 'application' ? 'application' : 'api';
      const mode = typeof args.mode === 'string' ? args.mode : undefined;
      const connu = args.etat_connu;
      if (connu !== undefined && (typeof connu !== 'string' || !EMPREINTE_RE.test(connu))) {
        throw new RefusOutil('etat_connu : l’empreinte rendue par l’appel précédent (16 caractères hexadécimaux)');
      }
      const debut = deps.numero.maintenant();
      for (;;) {
        const e = await deps.numero.etat(tenantId);
        const empreinte = empreinteEtat(e);
        const change = connu === undefined || empreinte !== connu;
        // 🔴 Jamais de lecture au-delà du délai : la boucle s'arrête d'elle-même, même si l'appelant a abandonné.
        if (change || deps.numero.maintenant() - debut + PAS_ATTENTE_MS > DELAI_ATTENTE_MS) {
          const suite = suiteDe(e, filiere, mode, e.connecte && !e.connecte.aActiver ? await paiementStable(deps, tenantId, debut) : 'carte');
          const filet = sansSigne(suite);
          // Un lien neuf, signé comme celui de start_whatsapp_connection (même personne, même espace), dans le seul mode
          // que start aurait donné tel quel et que la suite suit (`modeDuLienNeuf`), sur l'API.
          const modeLien = filet ? modeDuLienNeuf(e, filiere, mode) : null;
          const lien = modeLien === null
            ? null
            : adresseDuLien(deps.numero.urlConsole, await deps.numero.signerLien({ tenantId, userId, mode: modeLien }));
          return {
            change,
            etat: vueEtat(e),
            code: e.code?.code ?? null,
            empreinte,
            lien,
            suite: filet ? suite + rappelDuLien(lien) : suite,
          };
        }
        await deps.numero.attendre(PAS_ATTENTE_MS);
      }
    },
  },
];
