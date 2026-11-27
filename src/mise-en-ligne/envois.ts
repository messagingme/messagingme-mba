import { MAX_FICHES_PAR_SUPPRESSION } from '../../web/lib/partage/catalogue-mcp';
import type { ResultatAction } from '../../web/lib/partage/mise-en-ligne';
import { PREFIXE_ENVOI_API } from '../api/cible-rcs';
import { compteurEnvoiRefuse, type CibleJugee, type RapportEnvoi, type ReponseEnvoi, type ResultatEnvoiPublic } from '../api/envoi-public';
import { DUREE_CLE_IDEMPOTENCE_MS } from '../api/idempotence';
import { makeJournal, type AuditSink } from '../audit/journal';
import { canonique, type EtatConfirme } from '../campaign/confirmation';
import { lancerCampagne, type DepsLancement } from '../campaign/lancement';
import { PAUSES_SANS_REPRISE, messageDePause, type MotifDePause } from '../campaign/pause';
import type { CampaignCategory } from '../campaign/types';
import { messageManqueCredit } from '../credit-whatsapp/estimation';
import type { BulkTarget, FicheASupprimer, PgContactStore } from '../crm/contact-store.pg';
import { effacerContacts, type DepsEffacement } from '../crm/effacement';
import { numeroMasque } from '../emails-produit/alertes';
import { estUuid } from '../http/scope';
import { appelDeLEspace } from '../http/settings';
import type { PgInboxStore } from '../inbox/store.pg';
import { refus, type Issue, type StatutRefus } from '../lib/issue';
import { journaliser } from '../lib/journal';
import type { Fonction } from '../offres/offres';
import { LimiteOffreError, corpsRefusLimite, refusFonction } from '../offres/refus';
import type { MagasinScenariosApi } from '../workflow/scenarios-api';

/**
 * LES ENVOIS AU OUI (lot 1 du CSM virtuel, B8, plan `docs/superpowers/plans/2026-11-26-csm-lot1-h-envois-au-oui.md`,
 * décisions de Julien du 2026-11-26). Une campagne ne part, et des contacts ne s'effacent, que sur le clic d'un admin dans
 * la console : le code de confirmation que Claude recopiait a disparu. Ces actions vivent dans le oui de mise en ligne
 * (`mise-en-ligne.ts`), qui garde ce qui a été montré, relit l'état au clic et reprend une exécution coupée ; ce module en
 * porte le métier :
 *  - `campagne` : lancer (ou programmer à sa date) un brouillon, ou reprendre une campagne en pause, par `lancerCampagne`,
 *    le chemin du bouton « Lancer » de la console ;
 *  - `suppression` : effacer des contacts, par `effacerContacts`, l'effacement de la purge de la console et de
 *    `DELETE /v1/contacts/{id}` ;
 *  - `modele` et `envoi_scenario` (livraison 2) : envoyer un modèle, ou faire partir un scénario, vers UNE personne, par le
 *    cycle de `POST /v1/sends`, sous une clé d'idempotence tirée du oui : une reprise ne renvoie rien ;
 *  - `poussee_optout` (B10, livraison 1c) : choisir l'appel de connecteur prévenu à chaque désabonnement, ou n'en prévenir
 *    aucun, par le MÊME réglage que l'écran des paramètres : brancher un appel fait partir des données de contact chez un
 *    tiers (la table de parité le marque « au clic ») ;
 *  - `effacement_messages` (B10, livraison 2b) : effacer les messages d'une conversation, par la MÊME écriture que le
 *    bouton « Effacer le contenu » de l'Inbox (`effacerMessages`) : rien ne les rattrape, et la fenêtre de 24 heures se
 *    ferme avec eux.
 * 🔴 Une campagne, une suppression et un effacement ne gardent aucune donnée de contact (0316) : des identifiants, l'état
 * d'une campagne, des compteurs. Un envoi à une personne garde, le temps du clic seulement, son numéro (ou sa fiche), les
 * valeurs de ses variables et le numéro masqué que le récapitulatif montre : ils s'effacent quand le oui se ferme
 * (`terminer`) et, pour un bouton expiré ou un clic trop ancien pour reprendre, au balayage horaire du worker
 * (`expurgerEchues`).
 */
export interface DepsEnvoisAuOui {
  /** Le câblage de la route des campagnes : les MÊMES objets que la console et `prepare_campaign`. */
  campagnes: DepsLancement & {
    repo: DepsLancement['repo'] & {
      /** L'état que montre le récapitulatif, relu en base ; `null` hors de l'espace. */
      etatPourConfirmation(tenantId: string, campaignId: string): Promise<EtatConfirme | null>;
      /** Le motif et l'échéance d'une pause ; `null` hors de l'espace. */
      pauseDe(tenantId: string, campaignId: string): Promise<{ motif: MotifDePause | null; jusqua: Date | null } | null>;
    };
  };
  suppression: {
    /** Les fiches vivantes d'une sélection, DANS l'espace (`PgContactStore.selectionAEffacer`). */
    selection(tenantId: string, cible: BulkTarget, limite: number): Promise<FicheASupprimer[]>;
    /** L'effacement de la purge de la console : les MÊMES objets (`effacerContacts`). */
    effacement: DepsEffacement;
  };
  /**
   * La poussée des désabonnements (B10, livraison 1c) : l'appel de connecteur prévenu à chaque refus, que la console règle
   * dans ses paramètres (`GET` et `PATCH .../settings/poussee-optout`).
   */
  pousseeOptout: {
    /** Les appels de connecteur de l'espace, la MÊME liste que l'écran. */
    lister(tenantId: string): Promise<Array<{ id: string; label: string }>>;
    /** L'appel prévenu aujourd'hui, `null` si aucun. */
    actuelle(tenantId: string): Promise<string | null>;
    /** Le MÊME réglage que la route de la console (`setOptoutRequestId`). */
    choisir(tenantId: string, requestId: string | null): Promise<void>;
  };
  /**
   * L'effacement des messages d'une conversation (B10, livraison 2b) : le MÊME dépôt que le bouton « Effacer le contenu »
   * de l'Inbox (`PgInboxStore`, passé entier : ses méthodes lisent `this`).
   */
  effacementMessages: Pick<PgInboxStore, 'etatDesMessages' | 'effacerMessages'>;
  /** Les envois à une personne (livraison 2) : le cycle de `POST /v1/sends`, ses MÊMES dépendances que l'API. */
  individuels: {
    /** La cible jugée sans rien écrire (`jugerCible`) : à la préparation et au clic. */
    jugerCible(tenantId: string, corps: unknown): Promise<CibleJugee>;
    /** Le cycle de `POST /v1/sends`, sans compteur : un envoi parti sur le clic d'un admin est un envoi de la console. */
    envoyer(tenantId: string, corps: unknown): Promise<ResultatEnvoiPublic>;
    /** Les fiches vivantes de l'espace (`PgContactStore`, passé entier : ses méthodes lisent `this`). */
    contacts: Pick<PgContactStore, 'getById' | 'findByPhone'>;
    /** Un scénario du Builder par son identifiant ou son code `scn_` (`PgWorkflowStore`, passé entier). */
    scenarios: Pick<MagasinScenariosApi, 'lireParApi'>;
  };
}

/** La personne d'un envoi, telle que l'outil l'a désignée : son numéro, ou sa fiche. */
export type PersonneDEnvoi = { telephone: string } | { contact: string };

/**
 * Ce qu'un envoi à une personne demande : `valeurs`, les variables du corps dans l'ordre ; `declarePar`, la personne qui a
 * préparé, au nom de qui l'accord du destinataire est déclaré (décision de Julien du 2026-10-25).
 */
type DemandeIndividuelle =
  | ({ type: 'modele'; modele: string; langue: string; valeurs: string[]; declarePar: string } & PersonneDEnvoi)
  | ({ type: 'envoi_scenario'; scenario: string; valeurs: string[]; declarePar: string } & PersonneDEnvoi);

/**
 * Ce qui en est gardé. `scenario` : l'identifiant du scénario, `code` : son code `scn_`, que l'envoi vise. 🔴 `telephone`,
 * `valeurs` et `destinataire` (le numéro masqué montré) s'effacent quand le oui se ferme ou expire : une ligne effacée
 * ne les porte plus (`ACTIONS_SANS_CONTACT`, `store.pg.ts`).
 */
type EnvoiIndividuelGarde =
  | ({ type: 'modele'; nom: string; modele: string; langue: string; categorie: CampaignCategory; valeurs: string[]; declarePar: string; destinataire: string } & PersonneDEnvoi)
  | ({ type: 'envoi_scenario'; nom: string; scenario: string; code: string; categorie: CampaignCategory; valeurs: string[]; declarePar: string; destinataire: string } & PersonneDEnvoi);

/** Ce qu'une exécution sait de son oui : la clé d'idempotence d'un envoi à une personne, et l'heure du clic. */
export interface ContexteExecution {
  /** `oui:<id>:<rang>` : la même à chaque reprise. */
  cle: string;
  /** ISO 8601. */
  accepteeLe: string;
  maintenant: number;
}

/**
 * 🔴 La clé d'idempotence d'un envoi vit 24 heures (`DUREE_CLE_IDEMPOTENCE_MS`) : au-delà, une reprise pourrait envoyer une
 * seconde fois. Un envoi à une personne ne se reprend donc plus 23 heures après le clic.
 */
export const DELAI_DE_REPRISE_INDIVIDUELLE_MS = DUREE_CLE_IDEMPOTENCE_MS - 60 * 60 * 1000;

/** Le récapitulatif d'un envoi à une personne une fois effacé : seul le résultat reste. */
export const RECAPITULATIF_EFFACE = 'Le détail de cet envoi (son destinataire, ses valeurs) a été effacé.';

/** Ce que l'outil demande. */
export type DemandeEnvoi =
  | { type: 'campagne'; campagne: string }
  | { type: 'suppression'; contacts: string[] }
  /** `requete` : l'appel de connecteur à prévenir, `null` pour n'en prévenir aucun. */
  | { type: 'poussee_optout'; requete: string | null }
  | { type: 'effacement_messages'; conversation: string }
  | DemandeIndividuelle;

/** Ce qui est gardé, montré, et ce qui partira tel quel. */
export type EnvoiGarde =
  /** `motif` : celui de la pause d'une reprise (`null` pour un brouillon) ; il est montré, gardé, et relu à l'exécution. */
  | { type: 'campagne'; campagne: string; nom: string; reprise: boolean; etat: EtatConfirme; motif: MotifDePause | null }
  | { type: 'suppression'; contacts: string[]; nom: string }
  /**
   * `actuelle` : l'appel prévenu au moment de la préparation, et `nomActuel` son libellé ; ils entrent dans l'empreinte, et
   * le clic refuse si le réglage a changé.
   */
  | { type: 'poussee_optout'; requete: string | null; nom: string; actuelle: string | null; nomActuel: string | null }
  /**
   * `messages` (le nombre montré) et `dernier` (l'identifiant du plus récent) : ils entrent dans l'empreinte, et le clic
   * comme une reprise refusent si la conversation a reçu ou perdu un message depuis (l'admin n'efface que ce qu'on lui a
   * annoncé, et le même nombre peut être fait d'autres messages).
   */
  | { type: 'effacement_messages'; conversation: string; messages: number; dernier: string; nom: string }
  | EnvoiIndividuelGarde;

const TYPES_D_ENVOI: ReadonlySet<string> = new Set(['campagne', 'suppression', 'modele', 'envoi_scenario', 'poussee_optout', 'effacement_messages']);
export const estDemandeEnvoi = (d: { type: string }): d is DemandeEnvoi => TYPES_D_ENVOI.has(d.type);
export const estEnvoiGarde = (g: { type: string }): g is EnvoiGarde => TYPES_D_ENVOI.has(g.type);

const CAMPAGNE_INCONNUE = 'campagne introuvable dans cet espace';
const SCENARIO_INCONNU = 'scénario introuvable dans cet espace (list_scenarios)';
const CONVERSATION_INCONNUE = 'conversation introuvable dans cet espace (list_conversations)';
const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? 's' : ''}`;
const dateDeParis = (iso: string): string => new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short',
}).format(new Date(iso));

/**
 * Relit ce qu'un envoi ferait, sans rien écrire. La préparation et le clic passent par elle : le clic refuse ce que la
 * préparation aurait refusé, et l'empreinte de ce qui est gardé dit si l'état a bougé depuis.
 */
export async function releverEnvoi(
  deps: DepsEnvoisAuOui, tenant: string, fonctions: ReadonlySet<Fonction>, d: DemandeEnvoi, maintenant: number,
): Promise<Issue<EnvoiGarde>> {
  if (d.type === 'modele' || d.type === 'envoi_scenario') return releverIndividuel(deps, tenant, fonctions, d);
  if (d.type === 'poussee_optout') return releverPoussee(deps, tenant, d.requete);
  if (d.type === 'effacement_messages') return releverEffacement(deps, tenant, fonctions, d.conversation);
  if (d.type === 'campagne') {
    // Les campagnes sont une fonction de la console (Pro et au-delà), comme le bouton « Lancer » : relue au clic aussi.
    if (!fonctions.has('console')) return refusFonction('console');
    if (!estUuid(d.campagne)) return refus(404, CAMPAGNE_INCONNUE);
    const etat = await deps.campagnes.repo.etatPourConfirmation(tenant, d.campagne);
    if (!etat) return refus(404, CAMPAGNE_INCONNUE);
    let motif: MotifDePause | null = null;
    if (etat.status === 'paused') {
      // Une pause que seul un autre geste lève (le numéro délié, l'abonnement impayé) : reprendre la remettrait en pause.
      const pause = await deps.campagnes.repo.pauseDe(tenant, d.campagne);
      motif = pause?.motif ?? null;
      if (pause?.motif && PAUSES_SANS_REPRISE.has(pause.motif)) {
        return refus(409, `${messageDePause(pause.motif, null, undefined)} Elle ne se reprend pas par ce geste.`);
      }
    } else if (etat.status !== 'draft') {
      // Lancée, programmée, terminée : elle a écrit, écrit ou écrira à ses destinataires ; rien n'est à envoyer de plus.
      return refus(409, `la campagne n’est plus en brouillon ni en pause (statut ${etat.status}) : il n’y a rien à envoyer`);
    } else if (etat.prevueLe !== null && Date.parse(etat.prevueLe) <= maintenant) {
      return refus(409, 'la date prévue de la campagne est passée : préparez-la à nouveau, avec une nouvelle date');
    }
    if (etat.recipientCount === 0) return refus(409, 'la campagne n’a aucun destinataire en attente : rien à envoyer');
    return {
      ok: true,
      valeur: { type: 'campagne', campagne: d.campagne, nom: `la campagne du modèle « ${etat.templateName} »`, reprise: etat.status === 'paused', etat, motif },
    };
  }
  if (d.contacts.length === 0 || d.contacts.length > MAX_FICHES_PAR_SUPPRESSION || !d.contacts.every(estUuid)) {
    return refus(400, `une suppression porte de 1 à ${MAX_FICHES_PAR_SUPPRESSION} contacts, par leur identifiant`);
  }
  const fiches = await deps.suppression.selection(tenant, { ids: [...new Set(d.contacts)] }, d.contacts.length);
  if (fiches.length === 0) return refus(409, 'aucun de ces contacts n’existe plus dans cet espace : rien à supprimer');
  // Triés : la même liste de fiches donne la même empreinte, quel que soit l'ordre de la base.
  const contacts = fiches.map((f) => f.id).sort();
  return { ok: true, valeur: { type: 'suppression', contacts, nom: pluriel(contacts.length, 'contact') } };
}

/**
 * La poussée relue : l'appel existe DANS l'espace (🔴 jamais accepté sur sa seule forme : un identifiant pris ailleurs
 * ferait partir la poussée chez un autre client, et la clé étrangère ignore l'espace), et le choix change quelque chose.
 */
async function releverPoussee(deps: DepsEnvoisAuOui, tenant: string, requete: string | null): Promise<Issue<EnvoiGarde>> {
  const actuelle = await deps.pousseeOptout.actuelle(tenant);
  // L'appel en place se nomme : l'admin voit ce qu'il coupe ou remplace (il ne peut pas être supprimé tant qu'il est branché).
  const nomActuel = actuelle === null ? null : (await appelDeLEspace(deps.pousseeOptout, tenant, actuelle))?.label ?? actuelle;
  if (requete === null) {
    if (actuelle === null) return refus(409, 'aucun appel n’est prévenu des désabonnements : il n’y a rien à couper');
    return { ok: true, valeur: { type: 'poussee_optout', requete: null, nom: 'la poussée des désabonnements', actuelle, nomActuel } };
  }
  const r = await appelDeLEspace(deps.pousseeOptout, tenant, requete);
  if (!r) return refus(404, 'cet appel de connecteur n’existe pas dans cet espace (get_optout_push)');
  if (actuelle === requete) return refus(409, `l’appel « ${r.label} » est déjà prévenu à chaque désabonnement : rien à changer`);
  return { ok: true, valeur: { type: 'poussee_optout', requete, nom: `l’appel « ${r.label} »`, actuelle, nomActuel } };
}

/**
 * Pose le réglage montré. 🔴 Relu d'abord, comme la branche des campagnes : au premier clic, `accepter` vient de relire,
 * mais une REPRISE (après une coupure) ne repasse pas par le relevé. Déjà posé (l'écriture était passée avant la coupure) :
 * le résultat, sans réécrire ; changé depuis par quelqu'un d'autre : rien n'est écrit ; l'appel supprimé depuis :
 * introuvable, plutôt qu'une clé étrangère qui ferait échouer chaque reprise. La trace dit quel appel, à la place duquel.
 */
async function executerPoussee(
  deps: DepsEnvoisAuOui, tenant: string, g: Extract<EnvoiGarde, { type: 'poussee_optout' }>, auteur: { auth: { userId: string } }, audit: AuditSink,
): Promise<ResultatAction> {
  const fait: ResultatAction = { ok: true, etat: g.requete === null ? 'debranche' : 'branche' };
  const actuelle = await deps.pousseeOptout.actuelle(tenant);
  if (actuelle === g.requete) return fait;
  if (actuelle !== g.actuelle) {
    return { ok: false, code: 'modifiee', message: 'le réglage a changé depuis votre clic : ce bouton n’a rien écrit. Demandez à Claude un nouveau bouton.' };
  }
  if (g.requete !== null && (await appelDeLEspace(deps.pousseeOptout, tenant, g.requete)) === null) {
    return { ok: false, code: 'not_found', message: 'cet appel de connecteur n’existe plus dans cet espace : rien n’a été écrit.' };
  }
  await deps.pousseeOptout.choisir(tenant, g.requete);
  await makeJournal(audit)(tenant, auteur, 'settings.poussee_optout', { kind: 'settings', id: 'poussee_optout' }, { requestId: g.requete, avant: g.actuelle });
  return fait;
}

/**
 * L'effacement relu : l'Inbox est une fonction de l'offre, comme le bouton « Effacer le contenu » (relue au clic aussi) ;
 * la conversation est DANS l'espace, et elle a des messages à effacer. Leur nombre est ce que l'admin lira.
 */
async function releverEffacement(
  deps: DepsEnvoisAuOui, tenant: string, fonctions: ReadonlySet<Fonction>, conversation: string,
): Promise<Issue<EnvoiGarde>> {
  if (!fonctions.has('inbox')) return refusFonction('inbox');
  if (!estUuid(conversation)) return refus(404, CONVERSATION_INCONNUE);
  const etat = await deps.effacementMessages.etatDesMessages(tenant, conversation);
  if (etat === null) return refus(404, CONVERSATION_INCONNUE);
  if (etat.dernier === null) return refus(409, 'cette conversation n’a aucun message : rien à effacer');
  return { ok: true, valeur: { type: 'effacement_messages', conversation, messages: etat.nombre, dernier: etat.dernier, nom: 'une conversation' } };
}

/**
 * Efface les messages montrés. 🔴 Relu d'abord, comme la poussée : une REPRISE (après une coupure) ne repasse pas par le
 * relevé. Plus aucun message (l'exécution coupée les avait effacés, ou un admin l'a fait depuis l'Inbox) : rien à refaire ;
 * un autre nombre, ou un autre message le plus récent : un message est arrivé (ou parti) depuis le clic, et rien n'est
 * effacé que l'admin n'ait vu annoncé. 🔴 Le nombre seul ne suffit pas : une coupure APRÈS l'effacement, puis autant de
 * messages neufs qu'annoncé, et la reprise les effacerait. La trace est celle de la route de la console, signée de l'admin
 * qui a cliqué.
 */
async function executerEffacement(
  deps: DepsEnvoisAuOui, tenant: string, g: Extract<EnvoiGarde, { type: 'effacement_messages' }>, auteur: { auth: { userId: string } }, audit: AuditSink,
): Promise<ResultatAction> {
  const etat = await deps.effacementMessages.etatDesMessages(tenant, g.conversation);
  if (etat === null) return { ok: false, code: 'not_found', message: CONVERSATION_INCONNUE };
  if (etat.nombre === 0) return { ok: true, etat: 'deja_effacee' };
  if (etat.nombre !== g.messages || etat.dernier !== g.dernier) {
    return {
      ok: false, code: 'modifiee',
      message: 'la conversation a changé depuis votre clic (un message reçu ou envoyé) : ce bouton n’a rien effacé de plus. Demandez à Claude un nouveau bouton.',
    };
  }
  const effaces = await deps.effacementMessages.effacerMessages(tenant, g.conversation);
  if (effaces === null) return { ok: false, code: 'not_found', message: CONVERSATION_INCONNUE };
  await makeJournal(audit)(tenant, auteur, 'conversation.effacee', { kind: 'conversation', id: g.conversation }, { messages: effaces, via: 'mise_en_ligne' });
  return { ok: true, etat: 'effacee', messages: effaces };
}

/** La personne seule, sans le reste de l'action : un numéro, ou une fiche. */
export const personneDe = (p: PersonneDEnvoi): PersonneDEnvoi => ('telephone' in p ? { telephone: p.telephone } : { contact: p.contact });

type CibleIndividuelle = { type: 'modele'; modele: string; langue: string } | { type: 'envoi_scenario'; code: string };

/**
 * Le corps de `POST /v1/sends` d'un envoi à une personne : le MÊME à la préparation, au clic et à chaque reprise, donc la
 * même empreinte sous la même clé. L'accord de la personne est déclaré au nom de celle qui a préparé (décision de Julien du
 * 2026-10-25) ; le chemin partagé l'écrit sur la fiche et refuse d'y lever un STOP (`appliquerConsentement`).
 */
function corpsIndividuel(
  c: CibleIndividuelle, personne: PersonneDEnvoi, valeurs: readonly string[], declarePar: string, cle?: string,
): Record<string, unknown> {
  return {
    ...(cle === undefined ? {} : { idempotencyKey: cle }),
    // `category: utility` ne déclare rien pour un scénario : l'envoi prend la plus stricte de celle-ci et de celle que Meta
    // donne à son template d'ouverture (`categoriePlusStricte`), donc celle de Meta.
    ...(c.type === 'modele' ? { target: { template: { name: c.modele, language: c.langue } } } : { target: { scenario: c.code }, category: 'utility' }),
    ...(valeurs.length > 0 ? { params: valeurs.map((v, i) => ({ position: i + 1, source: { type: 'literal', value: v } })) } : {}),
    recipients: [{
      ...('telephone' in personne ? { phone: personne.telephone } : { contactId: personne.contact }),
      consent: 'opted_in', consentSource: `déclaré dans Claude par ${declarePar}`,
    }],
  };
}

const STATUTS_DE_REFUS: ReadonlySet<number> = new Set([400, 402, 403, 404, 409, 413, 415, 422, 503]);

/** Le refus que l'envoi rendrait (`{ error, code, upgradeUrl }`), avec sa phrase, son code et l'adresse de l'offre. */
function refusDeLEnvoi(r: ReponseEnvoi): Issue<never> {
  const c = r.corps as { error?: unknown; code?: unknown; upgradeUrl?: unknown } | null;
  const statut = (STATUTS_DE_REFUS.has(r.statut) ? r.statut : 422) as StatutRefus;
  const phrase = typeof c?.error === 'string' ? c.error : `refus ${r.statut}`;
  const details = {
    ...(typeof c?.code === 'string' ? { code: c.code } : {}),
    ...(typeof c?.upgradeUrl === 'string' ? { upgradeUrl: c.upgradeUrl } : {}),
  };
  return Object.keys(details).length > 0 ? refus(statut, phrase, details) : refus(statut, phrase);
}

/**
 * Relit un envoi à une personne : la fiche (une personne qui a dit STOP, ou bloquée, est refusée dès la préparation), puis
 * la cible, jugée par les pièces de l'envoi (`jugerCible`) : le modèle approuvé chez Meta et ses variables, le scénario
 * qui peut partir, la catégorie de Meta, qui entre dans ce qui a été montré.
 */
async function releverIndividuel(
  deps: DepsEnvoisAuOui, tenant: string, fonctions: ReadonlySet<Fonction>, d: DemandeIndividuelle,
): Promise<Issue<EnvoiGarde>> {
  // Faire partir un scénario est une fonction des scénarios, relue au clic aussi (`fonctionDe`) ; un modèle part dans
  // toutes les offres, comme depuis l'écran Modèles.
  if (d.type === 'envoi_scenario' && !fonctions.has('scenarios')) return refusFonction('scenarios');
  const personne = personneDe(d);
  const fiche = 'contact' in personne
    ? (estUuid(personne.contact) ? await deps.individuels.contacts.getById(tenant, personne.contact) : null)
    : await deps.individuels.contacts.findByPhone(tenant, personne.telephone);
  if ('contact' in personne && fiche === null) return refus(404, 'contact introuvable dans cet espace', { code: 'contact_not_found' });
  if (fiche?.optInStatus === 'opted_out') return refus(409, 'cette personne a répondu STOP : rien ne lui est écrit', { code: 'opted_out' });
  if (fiche?.blockedAt) return refus(409, 'ce contact est bloqué : rien ne lui est écrit', { code: 'blocked_contact' });
  // Le numéro masqué que le récapitulatif montre, jamais le numéro entier ni le nom.
  const destinataire = numeroMasque('telephone' in personne ? personne.telephone : fiche?.phoneE164 ?? fiche?.bsuid ?? '');
  const commun = { valeurs: [...d.valeurs], declarePar: d.declarePar, destinataire, ...personne };
  if (d.type === 'modele') {
    const cible = { type: 'modele' as const, modele: d.modele, langue: d.langue };
    const j = await deps.individuels.jugerCible(tenant, corpsIndividuel(cible, personne, d.valeurs, d.declarePar));
    if (!j.ok) return refusDeLEnvoi(j.reponse);
    return { ok: true, valeur: { ...cible, nom: `le modèle « ${d.modele} » (${d.langue})`, categorie: j.categorie, ...commun } };
  }
  // Le scénario par son identifiant ou son code ; un nom, l'envoi le résout. Puis son code, que l'envoi vise : une reprise
  // part vers le MÊME scénario (son nom, lui, entre dans l'empreinte : renommé avant le clic, le clic est refusé).
  const ref = estUuid(d.scenario) ? (await deps.individuels.scenarios.lireParApi(tenant, d.scenario))?.code ?? null : d.scenario;
  if (ref === null) return refus(404, SCENARIO_INCONNU, { code: 'scenario_not_found' });
  const j = await deps.individuels.jugerCible(tenant, corpsIndividuel({ type: 'envoi_scenario', code: ref }, personne, d.valeurs, d.declarePar));
  if (!j.ok) return refusDeLEnvoi(j.reponse);
  const ligne = j.workflowId === null ? null : await deps.individuels.scenarios.lireParApi(tenant, j.workflowId);
  if (!ligne?.code) return refus(404, SCENARIO_INCONNU, { code: 'scenario_not_found' });
  return {
    ok: true,
    valeur: { type: 'envoi_scenario', nom: `le scénario « ${ligne.name} »`, scenario: ligne.id, code: ligne.code, categorie: j.categorie, ...commun },
  };
}

/** Le bouton nomme l'effet (décision du 24 novembre) : ce qui part, et à combien. */
export function libelleEnvoi(g: EnvoiGarde): string {
  if (g.type === 'suppression') return `Supprimer ${pluriel(g.contacts.length, 'contact')}`;
  if (g.type === 'modele') return 'Envoyer à 1 contact';
  if (g.type === 'envoi_scenario') return 'Lancer le scénario pour 1 contact';
  if (g.type === 'poussee_optout') return g.requete === null ? 'Couper la poussée des désabonnements' : 'Prévenir cet appel à chaque désabonnement';
  if (g.type === 'effacement_messages') return `Effacer ${pluriel(g.messages, 'message')}`;
  const n = pluriel(g.etat.recipientCount, 'contact');
  if (g.reprise) return `Reprendre l’envoi à ${n}`;
  return g.etat.prevueLe === null ? `Envoyer à ${n}` : `Programmer l’envoi à ${n}`;
}

/** Ce que la page montre au-dessus du bouton, écrit ici (le CSM ne choisit pas les mots de ce qui vaut accord). */
export function recapitulatifEnvoi(g: EnvoiGarde): string[] {
  if (g.type === 'modele' || g.type === 'envoi_scenario') {
    const avec = g.valeurs.length > 0 ? `, avec : ${g.valeurs.map((v) => `« ${v} »`).join(', ')}` : '';
    // Le clic confirme l'accord que la personne qui a préparé a déclaré dans Claude (la fiche le trace à son nom) : l'admin
    // qui clique le lit ici.
    const accord = 'Ce clic confirme l’accord de cette personne pour recevoir vos messages, déclaré dans Claude par celle ou '
      + 'celui qui a préparé cet envoi, sous la responsabilité de l’espace : sa fiche passe en « accepte » (marketing '
      + 'compris). Une personne qui a répondu STOP ne reçoit rien.';
    if (g.type === 'modele') {
      return [`Le modèle « ${g.modele} » (${g.langue}, ${g.categorie}) part vers le ${g.destinataire}${avec}, dès votre clic. Un message parti ne se rattrape pas.`, accord];
    }
    return [
      `Le ${g.nom.replace(/^le /, '')} démarre pour le ${g.destinataire}${avec}, dès votre clic : son premier message part (${g.categorie}), et les réponses suivent le scénario.`,
      'Il reprend la conversation à l’équipe ou à l’agent IA qui la tenait, et remplace un scénario en cours.',
      accord,
    ];
  }
  if (g.type === 'suppression') {
    return [
      `${pluriel(g.contacts.length, 'contact')} ${g.contacts.length > 1 ? 'sont effacés' : 'est effacé'} pour de bon, avec `
        + 'leurs conversations, leurs messages et leur analyse. Un contact qui avait répondu STOP reste désabonné s’il revient.',
      'Claude vous a montré lesquels dans la conversation, avant de vous envoyer ici. La suppression ne se rattrape pas.',
    ];
  }
  if (g.type === 'poussee_optout') {
    if (g.requete === null) {
      return [`L’appel « ${g.nomActuel ?? ''} » n’est plus prévenu des désabonnements. Les refus restent respectés ici : seul votre autre système n’en est plus informé.`];
    }
    return [
      `À chaque désabonnement, ${g.nom} reçoit le numéro de la personne et ce qu’il lit de sa fiche (son nom, ses étiquettes, ses champs) : ces données partent chez ce tiers, dès votre clic.`,
      ...(g.nomActuel === null ? [] : [`Il remplace l’appel « ${g.nomActuel} », prévenu jusqu’ici.`]),
    ];
  }
  if (g.type === 'effacement_messages') {
    // Les mots du bouton de l'Inbox : irréversible, et la fenêtre fermée, qui ne se devine pas.
    const ceux = g.messages === 1
      ? 'Le seul message de cette conversation est effacé pour de bon.'
      : `Les ${g.messages} messages de cette conversation sont effacés pour de bon, reçus comme envoyés.`;
    return [
      `${ceux} La conversation reste dans l’Inbox, vide.`,
      'La fenêtre de 24 heures se calcule sur le dernier message reçu : après l’effacement, elle est fermée, et vous ne '
        + 'pourrez plus répondre librement à ce contact tant qu’il ne vous aura pas réécrit.',
      'Claude vous a montré laquelle dans la conversation, avant de vous envoyer ici. L’effacement ne se rattrape pas.',
    ];
  }
  const e = g.etat;
  const modele = `le modèle « ${e.templateName} » (${e.templateLanguage}, ${e.category})`;
  const n = pluriel(e.recipientCount, 'contact');
  if (g.reprise) {
    // Pourquoi elle s'est arrêtée : une pause pour la qualité du numéro demande de le vérifier avant de reprendre.
    return [
      `La campagne du modèle « ${e.templateName} » (${e.templateLanguage}, ${e.category}), en pause, reprend : ${n} en attente le reçoivent maintenant.`,
      ...(g.motif === null ? [] : [`Elle s’était arrêtée : ${messageDePause(g.motif, null, undefined)}`]),
    ];
  }
  if (e.prevueLe !== null) return [`La campagne envoie ${modele} à ${n}, le ${dateDeParis(e.prevueLe)}.`];
  return [`La campagne envoie ${modele} à ${n}, dès votre clic. Un message parti ne se rattrape pas.`];
}

/**
 * Exécute un envoi accepté. 🔴 Rejouable sans double effet, pour la reprise d'une exécution coupée : une campagne qui
 * n'est plus en brouillon ni en pause est déjà partie (par l'exécution interrompue, ou depuis la console) et n'est pas
 * relancée ; un brouillon en pause est parti puis a été arrêté ; et rien n'est lancé sur un état qui n'est plus celui du
 * clic. Une suppression ne retrouve que les fiches qui restent.
 */
export async function executerEnvoi(
  deps: DepsEnvoisAuOui, tenant: string, g: EnvoiGarde, auteur: { auth: { userId: string } }, audit: AuditSink, ctx: ContexteExecution,
): Promise<ResultatAction> {
  if (g.type === 'modele' || g.type === 'envoi_scenario') return executerIndividuel(deps, tenant, g, ctx);
  if (g.type === 'poussee_optout') return executerPoussee(deps, tenant, g, auteur, audit);
  if (g.type === 'effacement_messages') return executerEffacement(deps, tenant, g, auteur, audit);
  if (g.type === 'campagne') {
    const destinataires = g.etat.recipientCount;
    const etat = await deps.campagnes.repo.etatPourConfirmation(tenant, g.campagne);
    if (!etat) return { ok: false, code: 'not_found', message: CAMPAGNE_INCONNUE };
    if (etat.status !== 'draft' && etat.status !== 'paused') return { ok: true, etat: 'deja_partie', destinataires };
    // Un brouillon lancé ne redevient jamais brouillon : en pause, il est parti, puis a été arrêté.
    if (!g.reprise && etat.status === 'paused') return { ok: true, etat: 'deja_partie', destinataires };
    // 🔴 Rien n'est lancé sur un état qui n'est plus celui du clic. Une exécution coupée APRÈS le lancement, avant d'avoir
    // noté son résultat, se rejoue : elle trouverait sinon une pause posée depuis (par l'admin, ou pour la qualité du
    // numéro) et la lèverait sans clic. Les destinataires en attente et le motif de la pause le disent.
    const pause = etat.status === 'paused' ? await deps.campagnes.repo.pauseDe(tenant, g.campagne) : null;
    if (canonique(etat) !== canonique(g.etat) || (pause?.motif ?? null) !== g.motif) {
      return {
        ok: false, code: 'modifiee',
        message: 'la campagne a changé depuis votre clic (un envoi, une pause) : ce bouton n’a rien relancé. Demandez à Claude un nouveau bouton.',
      };
    }
    const quand = g.reprise || g.etat.prevueLe === null ? null : new Date(g.etat.prevueLe);
    const issue = await lancerCampagne(deps.campagnes, tenant, g.campagne, quand);
    if (issue.ok) return { ok: true, etat: 'programmee' in issue ? 'programmee' : g.reprise ? 'reprise' : 'envoyee', destinataires };
    switch (issue.raison) {
      case 'limite': {
        const l = corpsRefusLimite(new LimiteOffreError(tenant, 'envoisModelesMois', issue.max));
        return { ok: false, code: l.code, message: l.error };
      }
      // La cause du vocabulaire de l'API publique pour un Crédit WhatsApp qui manque.
      case 'credit_whatsapp': return { ok: false, code: 'whatsapp_credit_exhausted', message: messageManqueCredit(issue.manqueMicroEur) };
      case 'inconnue': return { ok: false, code: 'not_found', message: CAMPAGNE_INCONNUE };
      case 'date_passee': return { ok: false, code: 'date_passee', message: 'la date prévue de la campagne est passée : préparez-la à nouveau, avec une nouvelle date' };
      // Déjà en cours ou terminée entre la relecture et le lancement : elle est partie, rien n'est relancé.
      case 'non_programmable': return { ok: true, etat: 'deja_partie', destinataires };
    }
  }
  const fiches = await deps.suppression.selection(tenant, { ids: g.contacts }, g.contacts.length);
  if (fiches.length === 0) return { ok: true, etat: 'supprimes', contacts: 0, conversations: 0, messages: 0 };
  const ids = fiches.map((f) => f.id);
  // L'effacement partagé : la limite du jour d'abord, tout ou rien (levée au-delà de la limite de contacts), puis la purge.
  const e = await effacerContacts(deps.suppression.effacement, tenant, ids);
  if (!e.ok) {
    const l = corpsRefusLimite(new LimiteOffreError(tenant, 'suppressionsJour', e.max));
    return { ok: false, code: l.code, message: l.error };
  }
  // L'audit de la purge de la console, signé de l'admin qui a cliqué, au mieux : un journal en panne ne défait rien.
  const journal = makeJournal(audit);
  for (const id of ids) await journal(tenant, auteur, 'contact.purged', { kind: 'contact', id }, { lot: ids.length, via: 'mise_en_ligne' });
  // Le retrait chez l'agent de Meta part en fond, suivi (`effacerContacts`) : il ne retient pas le clic.
  e.retirerChezMeta();
  return { ok: true, etat: 'supprimes', contacts: e.bilan.purges, conversations: e.bilan.conversations, messages: e.bilan.messages };
}

/**
 * Envoie à une personne, par le cycle de `POST /v1/sends`, sous la clé du oui (`ctx.cle`). 🔴 Rejouable sans double envoi :
 * une exécution coupée après l'envoi retrouve, sous la même clé, le rapport de l'envoi fait (pendant 24 heures, d'où le
 * délai de reprise).
 */
async function executerIndividuel(deps: DepsEnvoisAuOui, tenant: string, g: EnvoiIndividuelGarde, ctx: ContexteExecution): Promise<ResultatAction> {
  if (ctx.maintenant - Date.parse(ctx.accepteeLe) > DELAI_DE_REPRISE_INDIVIDUELLE_MS) {
    // Où chercher : l'envoi, s'il est parti, porte le nom que lui donne le cycle de l'API (`PREFIXE_ENVOI_API`).
    const ligne = g.type === 'modele' ? `« ${PREFIXE_ENVOI_API}${g.modele} »` : `de ${g.nom}`;
    return {
      ok: false, code: 'trop_tard',
      message: `ce clic, du ${dateDeParis(ctx.accepteeLe)}, date de plus de 23 heures : l’envoi ne repart plus d’ici, pour ne `
        + `jamais partir deux fois. Regardez d’abord dans Campagnes si l’envoi ${ligne} de ce jour-là est parti, avant de `
        + 'demander à Claude un nouveau bouton.',
    };
  }
  // Une ligne effacée ne porte plus de quoi envoyer : rien ne part.
  if (!Array.isArray(g.valeurs) || !('telephone' in g || 'contact' in g)) return { ok: false, code: 'efface', message: RECAPITULATIF_EFFACE };
  const cible: CibleIndividuelle = g.type === 'modele' ? { type: 'modele', modele: g.modele, langue: g.langue } : { type: 'envoi_scenario', code: g.code };
  const r = await deps.individuels.envoyer(tenant, corpsIndividuel(cible, personneDe(g), g.valeurs, g.declarePar, ctx.cle));
  // L'envoi du oui ne compte rien : un refus du compteur serait une erreur de câblage, pas un refus à montrer.
  if (compteurEnvoiRefuse(r)) throw new Error('compteur inattendu sur un envoi du oui');
  if (r.statut >= 400) {
    const c = r.corps as { error?: unknown; code?: unknown } | null;
    // 🔴 Une clé encore « en cours » (posée par l'exécution coupée, il y a moins de cinq minutes) n'est pas un refus : c'est
    // une panne, qui se reprend au prochain clic ; la clé rend alors l'envoi fait, ou s'est libérée.
    if (c?.code === 'idempotency_in_progress') throw new Error('un envoi est en cours sous la clé de ce oui : à reprendre');
    return { ok: false, code: typeof c?.code === 'string' ? c.code : `refus_${r.statut}`, message: typeof c?.error === 'string' ? c.error : `refus ${r.statut}` };
  }
  // 201 : l'envoi fait, ou celui qu'une exécution coupée avait fait sous la même clé (le même rapport).
  const rapport = r.corps as RapportEnvoi;
  if (rapport.recipientCount === 0) {
    const motif = rapport.skipped[0]?.reason;
    return { ok: false, code: motif ?? 'ecarte', message: `rien n’est parti : la personne est écartée (${motif ?? 'motif inconnu'})` };
  }
  journaliser('info', 'mise_en_ligne_envoi_individuel', { tenantId: tenant, type: g.type, sendId: rapport.sendId });
  return { ok: true, etat: 'envoye', envoi: rapport.sendId };
}
