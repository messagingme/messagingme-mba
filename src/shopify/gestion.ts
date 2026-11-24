import type { LectureModele } from '../api/modele-envoi';
import { domaineShopify, pageApps, type IssueJeton, type IssueVerification } from './connexion';
import type { AccesClients, ClientAbonne, LectureClients } from './clients';
import type { IssueAbonnement } from './abonnements';
import type { Filiere } from '../application/comptes';
import type { ImportInput } from '../crm/import';
import type { ImportReport } from '../crm/types';
import { LimiteOffreError } from '../offres/refus';
import {
  AUTOMATIONS_DISPONIBLES, CATEGORIES_ADMISES, DELAI_PANIER_MAX, DELAI_PANIER_MIN, DONNEES_PAR_EVENEMENT, LIGNE_PANIER_AGENT, estAutomationShopify,
  estDonneeShopify, evenementDe, type AutomationShopify,
  type DonneeShopify, type EvenementShopify,
} from './donnees';
import type { AttenteMessage, AttestationShopify, MessageBranche, OrigineBoutique, PgShopifyStore, VueBoutique } from './store.pg';
import {
  arreterLesParcours, attestationEnVigueur, brancherLePremierBloc, etatDesLignes, PHRASE_ATTESTATION_REQUISE, PHRASE_SHOPIFY_QR_CODE,
  proposerLesMessagesStandard, reglerLigne,
  type DepsLignesShopify, type EtatLigne,
} from './lignes-gestion';
import { prefixeShopify } from './lignes';
import type { DepsReprise } from './reprise';
import type { DepsCollections } from './collections';
import type { ChiffreVentes, Montant } from './chiffre';
import { addDays, todayParis, type DateRange } from '../stats/range';

/**
 * LA GESTION DU CONNECTEUR SHOPIFY, porte unique des outils MCP et de la console (plan 2026-10-21, lot 1) : connecter
 * la boutique, brancher un message sur un événement, lire l'état, couper. Aucune des deux portes n'ajoute de contrôle.
 *
 * Un refus est rendu avec son statut et sa phrase, que l'outil MCP rend tel quel et que la route traduit.
 */

export interface DepsGestionShopify {
  store: Pick<PgShopifyStore, 'lire' | 'connecter' | 'couper' | 'messages' | 'compteurs' | 'compteursPaniers' | 'acces' | 'attentes'>;
  /** `verifierBoutique` lié à `fetchPublic` par le câblage. */
  verifier(domaine: string, clientId: string, secret: string): Promise<IssueVerification>;
  /** Le modèle lu chez Meta, la MÊME lecture que l'envoi public. */
  lireModele(tenantId: string, nom: string, langue: string): Promise<LectureModele>;
  /** `ENCRYPTION_KEY` sait chiffrer : sans elle, aucun secret de boutique ne peut être gardé. Sondé au câblage. */
  chiffrementPret: boolean;
  /** L'import des clients (lot 3) : `demanderJeton` et `lireClientsAbonnes` liés à `fetchPublic` par le câblage. */
  jeton(domaine: string, clientId: string, secret: string): Promise<IssueJeton>;
  lireClients(acces: AccesClients, plafond: number): Promise<LectureClients>;
  /** Les places de l'offre et les numéros déjà présents (`placesContacts`), comptés comme la limite les compte. */
  places(tenantId: string, numeros: readonly string[]): Promise<{ limite: number | null; comptees: number; presents: Set<string>; remplacer: boolean }>;
  /** `importContacts` lié aux magasins de la fiche : le chemin de l'import HubSpot, aucun événement d'automation. */
  importer(input: ImportInput): Promise<ImportReport>;
  /** Le branchement par la console (conception 2026-10-22) : `abonnerWebhooks` lié à `fetchPublic` par le câblage. */
  abonner(acces: { domaine: string; jeton: string }): Promise<IssueAbonnement>;
  /** La filière de l'espace (`filiereDe`) : un modèle sur l'API, un texte sur un numéro relié par QR code. */
  filiere(tenantId: string): Promise<Filiere | null>;
  /** La lecture du chiffre d'affaires attribué (`chiffreVentes`, plan 2026-10-30) : l'état en tire les récupérés. */
  chiffreVentes(tenantId: string, range: DateRange): Promise<ChiffreVentes>;
  /** Les lignes et leurs scénarios (menu « Scénario », lot 5) : `./lignes-gestion.ts`. */
  lignes: DepsLignesShopify;
  /** Le rattrapage des commandes des 60 derniers jours (segments Shopify enrichis, lot 5) : `cablerReprise`, `./reprise.ts`. */
  reprise: DepsReprise;
  /**
   * La lecture des collections des produits achetés (segments Shopify enrichis, lot 6a) : `cablerCollections`,
   * `./collections.ts`. `get_shopify_state` et le volet Shopify des filtres la lisent et l'enfilent.
   */
  collections: DepsCollections;
}

// Le refus d'un message Shopify sur un numéro relié par QR code vit avec l'interrupteur des lignes, qui l'emploie aussi.
export { PHRASE_SHOPIFY_QR_CODE };

export type Refus = { ok: false; statut: 400 | 402 | 409 | 422 | 503; message: string };
export type Issue<T> = { ok: true; valeur: T } | Refus;

const refus = (statut: Refus['statut'], message: string): Refus => ({ ok: false, statut, message });

/** Les chiffres que la carte et l'outil d'état montrent : les 30 derniers jours. */
export const JOURS_COMPTES = 30;
/** Les paniers se comptent sur leur durée de vie : la purge les efface au bout de sept jours. */
export const JOURS_PANIERS = 7;
const VARIABLES_MAX = 10;
const CLIENT_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SECRET = /^[\x21-\x7e]{1,200}$/;

export interface EtatShopify {
  boutique: VueBoutique | null;
  messages: MessageBranche[];
  compteurs: Record<string, number>;
  /**
   * Les paniers des 7 derniers jours : relancés (par issue), fermés à temps (une commande en est née), en attente, comptés
   * sur les paniers ouverts dans ces 7 jours ; et, sur la date de RELANCE (plan 2026-10-30) : les relances parties et les
   * RÉCUPÉRÉS (relancés puis payés), leur montant par devise, les tests à part. 🔴 Récupérés et relances parties se lisent
   * ensemble : rapportés aux relances par panier, un panier ouvert il y a plus de 7 jours mais relancé dedans ferait
   * compter plus de récupérés que de relances (relecture du lot A).
   */
  paniers: {
    relances: Record<string, number>; fermesATemps: number; enAttente: number;
    relancesParties: number; recuperes: number; montantsRecuperes: Montant[]; recuperesTest: number;
  };
  /** La page des apps de la boutique, d'où le marchand désinstalle l'app (aucune API ne le fait). */
  pageApps: string | null;
  /** Les messages préparés par la console dont le modèle attend l'approbation de Meta. */
  attentes: AttenteMessage[];
  /**
   * Les lignes du lot 5 (une par événement) : ce que le circuit envoie depuis la bascule. `messages` et `attentes`, les
   * anciennes tables, restent lus pour les plugins d'avant, le temps que l'ancienne console et ses plugins disparaissent.
   */
  lignes: EtatLigne[];
  /** L'attestation du consentement des clients en vigueur (2026-11-20) ; null si la case n'a jamais été touchée. */
  attestation: AttestationShopify | null;
}

export async function etatShopify(deps: DepsGestionShopify, tenantId: string): Promise<EtatShopify> {
  const boutique = await deps.store.lire(tenantId);
  if (boutique === null) {
    return {
      boutique: null, messages: [], compteurs: {}, pageApps: null, attentes: [], lignes: [], attestation: null,
      paniers: { relances: {}, fermesATemps: 0, enAttente: 0, relancesParties: 0, recuperes: 0, montantsRecuperes: [], recuperesTest: 0 },
    };
  }
  // Les 7 mêmes jours, en dates de Paris (aujourd'hui compris) : la lecture du chiffre compte par jour civil.
  const aujourdhui = todayParis();
  const { paniers: recuperes } = await deps.chiffreVentes(tenantId, { from: addDays(aujourdhui, -(JOURS_PANIERS - 1)), to: aujourdhui });
  return {
    boutique,
    messages: await deps.store.messages(tenantId),
    compteurs: await deps.store.compteurs(tenantId, JOURS_COMPTES),
    // Sept jours : un panier ne vit pas plus (purge), compter au-delà ne compterait rien de plus.
    paniers: {
      ...await deps.store.compteursPaniers(tenantId, JOURS_PANIERS),
      relancesParties: recuperes.relances, recuperes: recuperes.recuperes, montantsRecuperes: recuperes.montants,
      recuperesTest: recuperes.recuperesTest,
    },
    pageApps: pageApps(boutique.domaine),
    attentes: await deps.store.attentes(tenantId),
    lignes: await etatDesLignes(deps.lignes, tenantId),
    // Celle de CETTE boutique seulement : l'attestation d'une boutique d'avant ne se montre pas comme la sienne.
    attestation: await (async () => { const a = await deps.lignes.store.attestation(tenantId); return a?.domaine === boutique.domaine ? a : null; })(),
  };
}

export async function connecterShopify(
  deps: DepsGestionShopify, tenantId: string, saisie: { boutique: unknown; clientId: unknown; secret: unknown }, par: string | null,
  /**
   * 🔴 Par où (conception 2026-10-22) : `console` abonne les webhooks par l'API, `claude_code` jamais (ils sont déclarés
   * dans l'app de la CLI, les doubler ferait tout recevoir deux fois). Requis : un appelant qui l'oublierait ne compile pas.
   */
  origine: OrigineBoutique,
): Promise<Issue<VueBoutique>> {
  const domaine = domaineShopify(saisie.boutique);
  if (domaine === null) return refus(400, 'boutique : le domaine de la boutique, de la forme <nom>.myshopify.com (son nom suffit, celui de l’adresse admin.shopify.com/store/<nom>).');
  // Une clé collée depuis la page de Shopify porte souvent une espace ou un retour à la ligne : nettoyée avant tout.
  const clientId = typeof saisie.clientId === 'string' ? saisie.clientId.trim() : saisie.clientId;
  const secret = typeof saisie.secret === 'string' ? saisie.secret.trim() : saisie.secret;
  const ou = origine === 'console' ? 'la page Settings de l’app, sur le tableau de bord développeur de Shopify' : '« shopify app env show »';
  if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId)) {
    return refus(400, `client_id : l’identifiant de l’app (Client ID), tel que ${ou} le donne.`);
  }
  if (typeof secret !== 'string' || !SECRET.test(secret)) {
    return refus(400, `client_secret : le secret de l’app (Client secret), tel que ${ou} le donne.`);
  }
  if (!deps.chiffrementPret) return refus(503, 'Le chiffrement des secrets n’est pas configuré sur cette instance : impossible de brancher une boutique.');
  // 🔴 La même boutique, avec les clés de l'app de la CLI (relecture du lot 3 de la console) : elle reste `claude_code`.
  // Ses webhooks sont déclarés dans l'app, les abonner aussi par l'API ferait tout recevoir deux fois, et ses demandes
  // RGPD continuent d'arriver (une boutique `console` serait effacée à la désinstallation, sans `shop/redact`).
  const avant = origine === 'console' ? await deps.store.acces(tenantId) : null;
  const memeApp = avant !== null && avant.origine === 'claude_code' && avant.domaine === domaine && avant.clientId === clientId;
  const origineRetenue: OrigineBoutique = memeApp ? 'claude_code' : origine;
  const v = await deps.verifier(domaine, clientId, secret);
  if (!v.ok) return refus(v.code === 'passager' ? 503 : 422, v.message);
  // Une boutique NOUVELLE pour l'espace (aucune, ou un autre domaine) reçoit les messages standard ; un rebranchement de la
  // même, non (Julien, 2026-11-20 : « nouvelles seulement »). Lue AVANT que `connecter` ne la réécrive.
  const deja = await deps.store.lire(tenantId);
  const nouvelle = deja === null || deja.domaine !== domaine;
  const issue = await deps.store.connecter(tenantId, {
    domaine, clientId, secretClair: secret, nom: v.nom, pays: v.pays, devise: v.devise, par, origine: origineRetenue,
  });
  if (issue === 'boutique_ailleurs') {
    return refus(409, 'Cette boutique est déjà branchée à un autre espace Messaging Me : coupez-la d’abord dans cet espace.');
  }
  if (origineRetenue === 'console') {
    // Branchée, mais sans événements tant que l'abonnement n'a pas réussi : le refus le dit, et un nouvel essai est
    // idempotent (un sujet déjà abonné vaut « déjà »).
    const j = await deps.jeton(domaine, clientId, secret);
    if (!j.ok) return refus(j.code === 'passager' ? 503 : 422, j.message);
    const a = await deps.abonner({ domaine, jeton: j.jeton });
    if (!a.ok) return refus(503, `La boutique est branchée, mais ses événements ne sont pas encore abonnés : ${a.message} Rebranchez-la pour réessayer.`);
  }
  const vue = await deps.store.lire(tenantId);
  if (vue === null) return refus(503, 'La boutique n’a pas pu être relue après sa connexion : réessayez.');
  // Les messages standard (Julien, 2026-11-20) : créés et soumis à Meta pour chaque cas qui n'en a pas, lignes éteintes.
  // Jamais levé, jamais un refus du branchement : un cas sans message reste « à compléter » et le reçoit à l'allumage.
  if (nouvelle) await proposerLesMessagesStandard(deps.lignes, tenantId, par);
  return { ok: true, valeur: vue };
}

export interface Branchement {
  evenement: unknown;
  /** Le template approuvé chez Meta, posé dans le premier bloc du scénario de la ligne. Requis pour allumer. */
  modele: unknown;
  langue: unknown;
  /** Les données Shopify de {{1}}, {{2}}... du template, dans l'ordre : seulement avec lui. */
  variables: unknown;
  actif: unknown;
  /** La relance de panier seulement : le délai après la dernière modification du panier, en minutes. */
  delaiMinutes?: unknown;
  /** La relance de panier avec agent IA seulement : l'agent qui répond au bouton « Vous avez une question ? ». */
  agentId?: unknown;
}

/** Ce que rend `set_shopify_message` : les lignes après le geste, et la version programmée que la publication a annulée. */
export interface IssueBranchement {
  lignes: EtatLigne[];
  programmationAnnulee: boolean;
}

/**
 * LE MESSAGE D'UN ÉVÉNEMENT, DEPUIS CLAUDE CODE (menu « Scénario », lot 5, tâche 8) : le template va dans le PREMIER BLOC
 * du scénario de la ligne (`brancherLePremierBloc` : la ligne et son scénario naissent s'ils manquent, la suite est
 * gardée), puis l'interrupteur de la ligne se règle (`reglerLigne` : éteindre arrête ses parcours). Les contrôles chez
 * Meta (approuvé, catégorie admise, nombre de variables) ne valent que pour allumer, comme avant le lot 5.
 */
export async function brancherMessage(
  deps: DepsGestionShopify, tenantId: string, b: Branchement, par: string | null,
): Promise<Issue<IssueBranchement>> {
  if (!estAutomationShopify(b.evenement) || !AUTOMATIONS_DISPONIBLES.includes(b.evenement)) {
    return refus(400, `event : ${AUTOMATIONS_DISPONIBLES.join(', ')}.`);
  }
  const automation: AutomationShopify = b.evenement;
  // L'événement de Shopify qui la porte : ses données, ses catégories admises. La relance avec agent IA est celle du panier.
  const evenement = evenementDe(automation);
  const agentLigne = automation === LIGNE_PANIER_AGENT;
  if (present(b.agentId) && (!agentLigne || typeof b.agentId !== 'string')) {
    return refus(400, `agent_id : pour ${LIGNE_PANIER_AGENT} seulement, l’identifiant d’un agent IA actif (list_agents).`);
  }
  const actif = b.actif === undefined ? true : b.actif;
  if (typeof actif !== 'boolean') return refus(400, 'active : vrai ou faux.');
  // 🔴 Sur un numéro relié par QR code, AUCUN message Shopify ne s'allume (2026-10-24) : ce numéro ne fait que répondre, la
  // porte refuse tout message qu'il écrirait en premier (`premier_contact`), et un message Shopify ne répond à rien.
  // L'éteindre reste permis. Lue avant tout : le refus dit la voie de l'espace.
  const qrCode = (await deps.filiere(tenantId)) === 'application';
  if (qrCode && actif) return refus(409, PHRASE_SHOPIFY_QR_CODE);
  if (qrCode && present(b.modele)) {
    return refus(400, 'template : sur un numéro relié par QR code, les messages Shopify ne peuvent pas partir ; seul active false, qui éteint l’automation, est permis.');
  }
  // Le template : requis pour allumer ; pour éteindre, il se pose s'il est donné, et la ligne éteinte le garde. La relance
  // avec agent IA s'allume sans lui : son message standard (le bouton « Vous avez une question ? » relié à l'agent) se crée.
  let modele: string | null = null;
  if (present(b.modele) || (actif && !agentLigne)) {
    if (typeof b.modele !== 'string' || b.modele.trim() === '' || b.modele.length > 512) return refus(400, 'template : le nom du modèle WhatsApp.');
    modele = b.modele.trim();
  }
  if (typeof b.langue !== 'string' || b.langue.trim() === '' || b.langue.length > 20) return refus(400, 'language : la langue du modèle (fr, en_US...).');
  const variables: DonneeShopify[] = [];
  if (present(b.variables)) {
    if (modele === null) return refus(400, 'variables : seulement avec template, les données de {{1}}, {{2}}... du modèle.');
    if (!Array.isArray(b.variables) || b.variables.length > VARIABLES_MAX) return refus(400, `variables : une liste de ${VARIABLES_MAX} données au plus.`);
    const permises = DONNEES_PAR_EVENEMENT[evenement];
    for (const v of b.variables) {
      if (!estDonneeShopify(v) || !permises.includes(v)) return refus(400, `variables : pour ${evenement}, parmi ${permises.join(', ')}.`);
      variables.push(v);
    }
  }
  const panier = evenement === 'checkout_abandoned';
  if (b.delaiMinutes !== undefined && (!panier || typeof b.delaiMinutes !== 'number' || !Number.isInteger(b.delaiMinutes)
    || b.delaiMinutes < DELAI_PANIER_MIN || b.delaiMinutes > DELAI_PANIER_MAX)) {
    return refus(400, `delay_minutes : pour checkout_abandoned seulement, un nombre entier de ${DELAI_PANIER_MIN} à ${DELAI_PANIER_MAX} minutes.`);
  }

  const boutique = await deps.store.lire(tenantId);
  if (boutique === null) return refus(409, 'Aucune boutique Shopify n’est branchée à cet espace : connect_shopify d’abord.');
  if (boutique.etat === 'coupee') return refus(409, 'La boutique est coupée : rebranchez-la avec connect_shopify avant d’y brancher un message.');
  // Aucune affirmation n'est demandée, relance de panier comprise (décision de Julien du 2026-10-26) : le consentement des
  // clients est la responsabilité du marchand, chaque envoi écrit la fiche consentante, et un STOP reste un STOP.

  // 🔴 L'attestation AVANT toute écriture (relecture du 2026-11-20) : sans elle, rien ne s'allume, et le premier bloc ne doit
  // pas être réécrit (ni une version en attente de Meta annulée) pour un allumage qui sera refusé. Une ligne déjà allumée
  // reste allumée sans elle.
  if (actif && (await deps.lignes.store.ligne(tenantId, automation))?.actif !== true
    && (await attestationEnVigueur(deps.lignes, tenantId, boutique.domaine)) === null) {
    return refus(409, PHRASE_ATTESTATION_REQUISE);
  }

  const langue = b.langue.trim();
  if (actif && modele !== null) {
    const m = await deps.lireModele(tenantId, modele, langue);
    if (m.statut === 'illisible') return refus(503, 'Le modèle n’a pas pu être lu chez Meta : réessayez dans un instant.');
    if (m.statut !== 'approuve') {
      return refus(422, `Le modèle « ${modele} » (${langue}) n’est pas approuvé chez Meta, ou ne peut pas partir : suivez sa validation avec get_template_status.`);
    }
    if (!CATEGORIES_ADMISES[evenement].includes(m.categorie)) {
      return refus(422, `Le modèle « ${modele} » est de catégorie ${m.categorie} : pour ${evenement}, un modèle ${CATEGORIES_ADMISES[evenement].join(' ou ')}.`);
    }
    if (m.variables !== variables.length) {
      return refus(422, `Le modèle « ${modele} » a ${m.variables} variable(s) : variables doit en nommer exactement autant, dans l’ordre.`);
    }
  }
  let programmationAnnulee = false;
  if (modele !== null) {
    const pose = await brancherLePremierBloc(deps.lignes, tenantId, { evenement: automation, modele, langue, variables }, par);
    if (!pose.ok) return pose;
    programmationAnnulee = pose.valeur.programmationAnnulee;
  }
  const r = await reglerLigne(deps.lignes, tenantId, automation, {
    actif, ...(typeof b.delaiMinutes === 'number' ? { delaiMinutes: b.delaiMinutes } : {}), ...(typeof b.agentId === 'string' ? { agentId: b.agentId } : {}),
  }, par);
  if (!r.ok) return r;
  return { ok: true, valeur: { lignes: await etatDesLignes(deps.lignes, tenantId), programmationAnnulee } };
}

/** Un argument donné : ni absent, ni `null`. */
function present(v: unknown): boolean {
  return v !== undefined && v !== null;
}

/**
 * Couper la boutique : plus rien ne part, et ses parcours s'arrêtent tout de suite (décision 15), au mieux ; la règle
 * « encore voulu » les arrête de toute façon à leur prochain pas.
 */
export async function couperShopify(deps: DepsGestionShopify, tenantId: string): Promise<Issue<{ dejaCoupee: boolean; pageApps: string | null }>> {
  const boutique = await deps.store.lire(tenantId);
  if (boutique === null) return refus(409, 'Aucune boutique Shopify n’est branchée à cet espace.');
  const coupee = await deps.store.couper(tenantId, 'coupée depuis Messaging Me');
  if (coupee) await arreterLesParcours(deps.lignes, tenantId, prefixeShopify(boutique.domaine), 'boutique coupée');
  return {
    ok: true,
    valeur: { dejaCoupee: !coupee, pageApps: pageApps(boutique.domaine) },
  };
}

/** Les clients lus par appel, au plus (80 pages de Shopify) : de quoi tenir dans le délai d'un outil. */
export const CLIENTS_LUS_MAX = 20_000;
/** Les fiches qu'un import écrit, au plus, par appel : le relancer prend la suite, sans doublon. */
export const IMPORT_MAX = 5_000;
/** L'étiquette des fiches importées : le marchand les retrouve, et les cible. */
export const ETIQUETTE_SHOPIFY = 'Shopify';

export interface ApercuImport {
  /** Les clients abonnés au marketing (e-mail ou SMS) avec un téléphone valable. */
  abonnes: number;
  /** Les abonnés sans téléphone valable : jamais importés. */
  sansTelephone: number;
  dejaDansLEspace: number;
  nouveaux: number;
  /** Les places que l'offre laisse ; `null` : sans limite. */
  placesLibres: number | null;
  /**
   * Ce qu'un import écrirait au plus : les nouveaux, dans les places libres et la borne d'un appel. Avec l'option « le plus
   * ancien laisse sa place » (lot 2 du 2026-11-24), dans la limite entière : les plus anciens font la place.
   */
  importables: number;
  /** Les contacts les plus anciens qu'importer les `importables` effacerait (0 sans l'option, ou s'il reste la place). */
  effacements: number;
  /** `false` : la lecture s'est arrêtée au plafond, il reste des abonnés plus anciens. */
  complet: boolean;
}

interface Lecture {
  nouveaux: ClientAbonne[]; dejaDansLEspace: number; sansTelephone: number; libres: number | null; complet: boolean;
  /** L'option « le plus ancien laisse sa place » est active : `plafond` est alors la limite entière, au lieu des places libres. */
  remplacer: boolean;
  plafond: number | null;
}

/**
 * Les abonnés de la boutique de l'espace, et ce que l'offre permet d'en importer. Décisions de Julien du 2026-10-22 :
 * les abonnés au marketing seulement, du plus récent au plus ancien ; une fiche déjà présente n'est ni comptée ni
 * touchée.
 */
async function lireAbonnes(deps: DepsGestionShopify, tenantId: string): Promise<Issue<Lecture>> {
  const a = await deps.store.acces(tenantId);
  if (a === null) return refus(409, 'Aucune boutique Shopify n’est branchée : branchez-la d’abord (la carte Shopify de la console, ou la skill shopify du plugin).');
  if (a.etat !== 'connectee') return refus(409, 'La boutique Shopify est coupée : rebranchez-la avant d’importer ses clients.');
  const j = await deps.jeton(a.domaine, a.clientId, a.secret);
  if (!j.ok) return refus(j.code === 'passager' ? 503 : 409, j.message);
  const lecture = await deps.lireClients({ domaine: a.domaine, jeton: j.jeton, pays: a.pays }, CLIENTS_LUS_MAX);
  if (!lecture.ok) return refus(lecture.code === 'passager' ? 503 : 409, lecture.message);
  const places = await deps.places(tenantId, lecture.abonnes.map((c) => c.telephone));
  const nouveaux = lecture.abonnes.filter((c) => !places.presents.has(c.telephone));
  return {
    ok: true,
    valeur: {
      nouveaux, dejaDansLEspace: lecture.abonnes.length - nouveaux.length, sansTelephone: lecture.sansTelephone,
      libres: places.limite === null ? null : Math.max(0, places.limite - places.comptees), complet: lecture.complet,
      remplacer: places.remplacer,
      plafond: places.limite === null ? null : places.remplacer ? places.limite : Math.max(0, places.limite - places.comptees),
    },
  };
}

/** Compter avant d'importer (décision de Julien) : rien ne s'écrit ici. */
export async function apercuImportClients(deps: DepsGestionShopify, tenantId: string): Promise<Issue<ApercuImport>> {
  const l = await lireAbonnes(deps, tenantId);
  if (!l.ok) return l;
  const { nouveaux, dejaDansLEspace, sansTelephone, libres, complet, plafond } = l.valeur;
  const importables = Math.min(nouveaux.length, plafond ?? Infinity, IMPORT_MAX);
  return {
    ok: true,
    valeur: {
      abonnes: nouveaux.length + dejaDansLEspace, sansTelephone, dejaDansLEspace, nouveaux: nouveaux.length, placesLibres: libres,
      importables, effacements: libres === null ? 0 : Math.max(0, importables - libres), complet,
    },
  };
}

export interface BilanImport {
  importes: number;
  /** Des numéros qu'une fiche supprimée portait : l'import les rétablit, comme l'import d'un fichier. */
  retablis: number;
  /** Les nouveaux abonnés laissés dehors : au-delà du nombre choisi. */
  restent: number;
  placesLibres: number | null;
  etiquette: string;
  complet: boolean;
}

/**
 * Importe les `maximum` abonnés nouveaux les plus récents, le nombre que le marchand a choisi après l'aperçu.
 * 🔴 LE CONSENTEMENT DÉPEND DU CHEMIN. Depuis Claude (`declarePar`, la personne connectée), les fiches arrivent
 * consentantes : l'accord est déclaré par le client, sous sa responsabilité (décision de Julien du 2026-10-25, « par
 * principe, sur Claude Code, les contacts importés sont opt in », qui remplace pour Claude celle du 2026-10-22). Depuis
 * la console (`declarePar: null`, requis pour qu'aucun appel ne l'oublie), aucun consentement (un accord e-mail ou SMS
 * n'est pas un accord WhatsApp). Dans les deux cas, l'autorité
 * `import` ne lève jamais un STOP. Un maximum au-delà des places libres est refusé : le marchand gère sa limite, rien
 * ne s'écrit à moitié.
 */
export async function importerClients(
  deps: DepsGestionShopify, tenantId: string, maximum: unknown, declarePar: string | null,
): Promise<Issue<BilanImport>> {
  if (typeof maximum !== 'number' || !Number.isInteger(maximum) || maximum < 1 || maximum > IMPORT_MAX) {
    return refus(400, `max_contacts : un entier de 1 à ${IMPORT_MAX}, le nombre de clients que le marchand a choisi d’importer.`);
  }
  const l = await lireAbonnes(deps, tenantId);
  if (!l.ok) return l;
  const { nouveaux, libres, complet, plafond } = l.valeur;
  // Ce qui serait ÉCRIT, et non le nombre demandé (relecture du lot 3) : 100 demandés pour 3 nouveaux et 50 places passent.
  // Avec l'option « le plus ancien laisse sa place » (lot 2 du 2026-11-24), le plafond est la limite entière : l'import
  // fait purger les plus anciens, comme l'aperçu l'a annoncé.
  if (plafond !== null && Math.min(maximum, nouveaux.length) > plafond) {
    return refus(402, `L’offre ne laisse que ${plafond} place${plafond > 1 ? 's' : ''} de contacts : importez au plus ${plafond} clients, ou passez à l’offre supérieure.`);
  }
  const choisis = nouveaux.slice(0, maximum);
  let rapport: ImportReport = { created: 0, updated: 0, skipped: 0, errors: [] };
  if (choisis.length > 0) {
    try {
      rapport = await deps.importer({
        rows: choisis.map((c) => ({ phone: c.telephone, name: c.nom ?? '' })),
        mapping: { columns: { phone: { target: 'phone' }, name: { target: 'name' } } },
        tenantId, tags: [ETIQUETTE_SHOPIFY], autorite: 'import',
        ...(declarePar !== null
          ? { optIn: true, optInSource: `import Shopify, déclaré dans Claude par ${declarePar}` }
          : { optIn: false }),
      });
    } catch (err) {
      // Deux écritures simultanées à la dernière place : la vérification de l'import tranche, et le dit.
      if (err instanceof LimiteOffreError) return refus(402, err.message);
      throw err;
    }
  }
  return {
    ok: true,
    valeur: {
      importes: rapport.created, retablis: rapport.updated, restent: nouveaux.length - choisis.length,
      placesLibres: libres === null ? null : Math.max(0, libres - rapport.created - rapport.updated),
      etiquette: ETIQUETTE_SHOPIFY, complet,
    },
  };
}
