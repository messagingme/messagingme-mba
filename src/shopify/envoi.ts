import { compteurEnvoiRefuse, type OptionsEnvoiPublic, type RapportEnvoi, type ResultatEnvoiPublic } from '../api/envoi-public';
import { VALEUR_VARIABLE_MAX } from '../api/variables';
import type { Filiere } from '../application/comptes';
import type { DepsJobPremier, IssueJobPremier } from '../application/premier-message';
import type { ParcoursEvenementDeCampagne } from '../campaign/parcours-evenement';
import type { TemplateParam } from '../crm/template';
import { journaliser } from '../lib/journal';
import type { SourceOffres } from '../offres/offre.pg';
import { ORIGINE_MAX } from '../workflow/evenement';
import type { DonneeShopify } from './donnees';
import type { PremierBloc } from './premier-bloc';
import type { PgShopifyStore } from './store.pg';

/**
 * L'ENVOI D'UN MESSAGE SHOPIFY, troisième adaptateur de `lancerEnvoiPublic` après `POST /v1/sends` et
 * `send_template_to_contact` (plan 2026-10-21, relecture du lot 1) ; depuis le lot 5 du menu « Scénario », le PREMIER
 * BLOC d'une ligne (`./premier-bloc.ts`), et le pont du parcours d'événement (lot 4b) quand le bloc a une suite.
 *
 * 🔴 PAS LE MOTEUR DE SCÉNARIO : une automation ordinaire ne reprend jamais le fil (`automatisme_ordinaire`), donc une
 * confirmation ne partirait pas quand l'agent de Meta ou un opérateur tient la conversation, et quand elle part, elle clôt
 * le parcours en cours et la session d'agent IA. L'envoi public ne touche pas au fil, lit la catégorie du modèle chez
 * Meta, applique `optInAllows` (un MARKETING ne part qu'à une fiche consentante), le STOP, la limite des modèles du mois
 * et les gardes du numéro, et crée la fiche (limite de contacts comprise). C'est le parcours qui naît ensuite, sur le
 * message déjà accepté par Meta, qui reprend le fil pour la suite (décision 2 : le premier message part toujours).
 *
 * Cinq choix d'adaptateur, et rien d'autre :
 *   - la clé d'idempotence est la clé métier (`shopify:<boutique>:orders/paid:<id>`) : un webhook rejoué relit le rapport
 *     au lieu de renvoyer ;
 *   - 🔴 le destinataire porte TOUJOURS `consent: opted_in` et sa source (décision de Julien du 2026-10-26 : le
 *     consentement des clients est la responsabilité du marchand, aucune question ne le lui demande). La fiche devient
 *     consentante, et `appliquerConsentement` ne lève jamais un STOP : la fiche reste désabonnée, le tri l'écarte ;
 *   - le compteur ne décompte rien : le plafond de l'API publique est fait pour les intégrations, une vente flash ne doit
 *     pas y buter (la limite des modèles du mois, elle, s'applique dans le cycle) ;
 *   - 🔴 les valeurs partent en variables du destinataire, TOUTES (la suite du parcours peut demander une donnée que le
 *     premier message n'affiche pas), jamais écrites sur la fiche (le lien de commande porte une clé d'accès), et une
 *     ligne de Campagnes porte le nom de l'événement ; un envoi où personne ne part n'en laisse aucune ;
 *   - le pont n'est posé que par l'appelant (`pontDuPremierBloc`), jamais lu d'un corps.
 */

export type EnvoyerPublic = (
  tenantId: string, corps: unknown, compter: (unites: number) => Promise<boolean>, options: OptionsEnvoiPublic,
) => Promise<ResultatEnvoiPublic>;

export interface EnvoiShopify {
  tenantId: string;
  cle: string;
  /** Le nom de la ligne dans Campagnes. */
  nomLigne: string;
  modele: string;
  langue: string;
  /** Les sources du premier bloc, position par position (celles du template, remplacées par celles du bloc). */
  params: readonly TemplateParam[];
  /** TOUTES les données de l'événement : les variables du destinataire (`variablesDuDestinataire`). */
  valeurs: Partial<Record<DonneeShopify, string>>;
  telephone: string;
  /** La source du consentement écrit sur la fiche (`shopify:<boutique>`, bornée par `MAX_OPT_IN_SOURCE`). */
  sourceConsentement: string;
  /** Le pont du parcours d'événement (`pontDuPremierBloc`) ; absent, le premier message part seul. */
  parcoursEvenement?: ParcoursEvenementDeCampagne;
}

/** Ce que devient un événement : l'issue inscrite, comptée par la carte. `en_cours` n'en est pas une (on réessaie). */
export type IssueEnvoi =
  | 'envoye' | 'desabonne' | 'sans_consentement' | 'bloque' | 'limite_contacts' | 'limite_modeles' | 'modele_refuse'
  | 'numero_indisponible' | 'sans_telephone' | 'refuse' | 'en_cours';

/**
 * Les variables du destinataire : toutes les données reçues. 🔴 Une valeur plus longue que ce qu'une variable porte
 * (`VALEUR_VARIABLE_MAX`) n'y entre que si le premier message la demande : sinon une donnée que ce message n'affiche pas
 * ferait refuser le destinataire, donc la confirmation (anti-objectif 1). La suite qui la demanderait la dira manquante.
 */
export function variablesDuDestinataire(
  valeurs: Partial<Record<DonneeShopify, string>>, params: readonly TemplateParam[],
): Record<string, string> {
  const demandees = new Set(params.flatMap((p) => (p.source.type === 'variable' ? [p.source.key] : [])));
  return Object.fromEntries(Object.entries(valeurs).filter((e): e is [string, string] =>
    e[1] !== undefined && (e[1].length <= VALEUR_VARIABLE_MAX || demandees.has(e[0]))));
}

export async function envoyerShopify(envoyer: EnvoyerPublic, e: EnvoiShopify): Promise<IssueEnvoi> {
  const variables = variablesDuDestinataire(e.valeurs, e.params);
  const corps = {
    idempotencyKey: e.cle,
    target: { template: { name: e.modele, language: e.langue } },
    params: e.params.map((p) => ({ position: p.position, source: p.source })),
    recipients: [{
      phone: e.telephone, consent: 'opted_in', consentSource: e.sourceConsentement,
      ...(Object.keys(variables).length > 0 ? { variables } : {}),
    }],
  };
  const r = await envoyer(e.tenantId, corps, async () => true, {
    // `neeDe` : une fiche que ce message crée est née d'un envoi Shopify ; jamais écrite, le premier 131026 la supprime.
    nom: e.nomLigne, sansCampagneVide: true, neeDe: 'shopify',
    ...(e.parcoursEvenement !== undefined ? { parcoursEvenement: e.parcoursEvenement } : {}),
  });
  return issueDeLEnvoi(r);
}

/**
 * Ce que devient un premier bloc envoyé par le cœur public, lu sur sa réponse : la même lecture pour Shopify et pour les
 * lignes HubSpot (lot 6b), jamais deux tables qui divergeraient.
 */
export function issueDeLEnvoi(r: ResultatEnvoiPublic): IssueEnvoi {
  if (compteurEnvoiRefuse(r)) return 'refuse';
  const c = r.corps as { code?: unknown; limite?: unknown } | null;
  if (r.statut === 201 || r.statut === 200) return issueDuRapport(r.corps as RapportEnvoi);
  if (r.statut === 402) return c?.limite === 'envoisModelesMois' ? 'limite_modeles' : 'refuse';
  if (r.statut === 409 && c?.code === 'idempotency_in_progress') return 'en_cours';
  if (r.statut === 409) return 'numero_indisponible';
  // La même clé avec un autre corps : le message a été rebranché entre deux tentatives. Rien n'est parti.
  if (r.statut === 422 && c?.code === 'idempotency_key_reused') return 'refuse';
  if (r.statut === 404 || r.statut === 422) return 'modele_refuse';
  return 'refuse';
}

/**
 * Le pont d'un premier bloc prêt (menu « Scénario », lot 5, appel A6) : seulement s'il a une suite, que l'offre de
 * l'espace a la fonction `scenarios`, et que l'origine tient dans `ORIGINE_MAX`. Sinon le premier message part seul et
 * aucun parcours ne naît : en Free, seule la première étape part (§ 5.6) ; une origine trop longue (domaine et jeton à
 * leur maximum) se journalise chez l'appelant.
 */
export function pontDuPremierBloc(
  bloc: Extract<PremierBloc, { etat: 'pret' }>, origine: string, offreAScenarios: boolean, type: ParcoursEvenementDeCampagne['type'],
): ParcoursEvenementDeCampagne | undefined {
  if (!bloc.aUneSuite || !offreAScenarios || origine.length > ORIGINE_MAX) return undefined;
  return { workflowId: bloc.workflowId, noeudId: bloc.noeudId, type, origine, boutons: bloc.boutons };
}

/**
 * Le pont d'un premier bloc prêt, l'offre lue seulement quand le bloc a une suite (le cache court de l'offre, passé
 * ENTIER). Une origine trop longue sur une offre qui a `scenarios` se journalise : le premier message part seul. `type` :
 * celui du parcours qui naîtra (`evenement_shopify`, ou `evenement_hubspot` au lot 6b), REQUIS : un oubli ne compile pas
 * plutôt que de faire naître un parcours Shopify d'une ligne HubSpot.
 */
export async function pontSelonLOffre(
  offres: SourceOffres, tenantId: string, bloc: Extract<PremierBloc, { etat: 'pret' }>, origine: string,
  type: ParcoursEvenementDeCampagne['type'],
): Promise<ParcoursEvenementDeCampagne | undefined> {
  if (!bloc.aUneSuite) return undefined;
  const scenarios = (await offres.offreDe(tenantId)).droits.fonctions.has('scenarios');
  const pont = pontDuPremierBloc(bloc, origine, scenarios, type);
  if (pont === undefined && scenarios) journaliser('warn', 'shopify_pont_origine_trop_longue', { tenantId, longueur: origine.length });
  return pont;
}

/**
 * LES ISSUES D'UN TEXTE D'UN NUMÉRO RELIÉ PAR QR CODE (plan 2026-10-23, tâche 5), que le job de la file « écrire en
 * premier » inscrit encore pour un message déjà en file. Le lot 5 n'en envoie plus : une ligne Shopify part par un
 * template. `filiere_differente` : le premier bloc (un template) ne part pas d'un numéro relié par QR code.
 */
export type IssueTexte =
  | 'en_file' | 'pas_sur_whatsapp' | 'gele' | 'numero_coupe' | 'refuse_whatsapp' | 'filiere_differente' | 'envoi_incertain'
  | 'expire' | 'abandonne' | 'texte_trop_long' | 'premier_contact';
export type IssueShopify = IssueEnvoi | IssueTexte;

/** L'issue finale du job, inscrite chez Shopify : la même, `filiere_api` lue comme un croisement. */
export function issueDuJobPremier(i: IssueJobPremier): IssueShopify {
  return i === 'filiere_api' ? 'filiere_differente' : i;
}

export interface DepsEnvoiShopify {
  envoyer: EnvoyerPublic;
  /** La filière de l'espace, lue à l'envoi (`filiereDe`) : un espace a pu passer de l'une à l'autre depuis le réglage. */
  filiere(tenantId: string): Promise<Filiere | null>;
}

/**
 * L'envoi du premier bloc : un template, qui ne part que par la filière API. Sur un numéro relié par QR code (filière
 * application), rien ne part (`filiere_differente`). Un espace sans filière (son numéro retiré) tente l'envoi public,
 * qui le dit (`numero_indisponible`).
 */
export async function envoyerPremierBloc(d: DepsEnvoiShopify, e: EnvoiShopify): Promise<IssueShopify> {
  if ((await d.filiere(e.tenantId)) === 'application') return 'filiere_differente';
  return envoyerShopify(d.envoyer, e);
}

/**
 * L'issue finale d'un message Shopify écrit en premier, inscrite par le job de la file (`traiterPremierMessage`, worker) :
 * celle de l'événement (`reference` = sa clé) ou celle du panier (`reference` = son jeton), dans l'espace. Les autres
 * origines (Claude, l'API, une réponse) ne gardent aucune issue.
 */
export function noterIssueShopify(store: Pick<PgShopifyStore, 'noterIssue' | 'noterIssuePanier'>): DepsJobPremier['noterIssue'] {
  return async (origine, tenantId, reference, issue) => {
    if (reference === null) return;
    if (origine === 'shopify_commande') await store.noterIssue(tenantId, reference, issueDuJobPremier(issue));
    else if (origine === 'shopify_panier') await store.noterIssuePanier(tenantId, reference, issueDuJobPremier(issue));
  };
}

function issueDuRapport(rapport: RapportEnvoi): IssueEnvoi {
  if (rapport.recipientCount > 0) return 'envoye';
  const motif = rapport.skipped[0]?.reason;
  if (motif === 'opted_out') return 'desabonne';
  if (motif === 'no_consent') return 'sans_consentement';
  if (motif === 'blocked_contact') return 'bloque';
  if (motif === 'plan_limit_reached') return 'limite_contacts';
  if (motif === 'invalid_phone' || motif === 'no_phone' || motif === 'invalid_recipient') return 'sans_telephone';
  return 'refuse';
}
