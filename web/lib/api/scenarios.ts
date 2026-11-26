'use client';

/**
 * Les scenarios et leurs contenus : formulaires, graphes de blocs, tags, champs.
 *
 * Sorti de `lib/api.ts` le 2026-09-01 (lot 5 du programme II), qui pesait 1 874 lignes. Le socle HTTP
 * (`./http`) etait deja extrait : ce decoupage-ci ne separe que des surfaces d'appel, sans etat partage.
 * `lib/api.ts` reste le point d'entree et reexporte tout, donc AUCUN des 67 importeurs ne change.
 */

import { request } from '../http';
import type { WorkflowNodeType } from '../partage/blocs';
import type { Depart } from '../partage/fenetre-scenario';
import type { VueMiseEnLigne } from '../partage/mise-en-ligne';

// --- Flows (constructeur de formulaire RICHE : texte / image / champ) ---

export type FlowFieldType =
  | 'text' | 'email' | 'phone' | 'number' | 'passcode'
  | 'textarea' | 'date'
  | 'dropdown' | 'radio' | 'checkbox' | 'optin';
export type FlowTextKind = 'heading' | 'subheading' | 'body' | 'caption';
/** Types de champ qui exigent une liste d'options (dropdown/radio/checkbox). */
export const FLOW_CHOICE_TYPES: FlowFieldType[] = ['dropdown', 'radio', 'checkbox'];

/** Condition de visibilité ENVOYÉE : `field` = LIBELLÉ du champ source (le serveur résout libellé -> clé).
 *  Source admissible : champ dropdown/radio/optin situé AVANT l'élément sur le MÊME écran. */
export interface FlowVisibleIfInput {
  field: string;
  op: 'eq' | 'neq';
  value: string | boolean;
}
/** Condition de visibilité STOCKÉE : `fieldKey` = clé dérivée du champ source (pour re-seeder l'édition). */
export interface FlowVisibleIf {
  fieldKey: string;
  op: 'eq' | 'neq';
  value: string | boolean;
}
/** Élément riche envoyé à la création d'un flow, dans l'ordre. `saveTo` (sur un champ) : clé du user field
 *  cible ; absent -> le serveur crée un user field d'après le libellé (mapping par défaut). `options` :
 *  requis pour les champs de choix (dropdown/radio/checkbox). `visibleIf` : affichage conditionnel. */
export type FlowElementInput =
  | { kind: FlowTextKind; text: string; visibleIf?: FlowVisibleIfInput }
  | { kind: 'image'; src: string; visibleIf?: FlowVisibleIfInput }
  | { kind: 'field'; label: string; type: FlowFieldType; required: boolean; saveTo?: string; options?: string[]; visibleIf?: FlowVisibleIfInput };

export interface FlowField {
  label: string;
  type: FlowFieldType;
  required: boolean;
  key: string;
}
/** Élément riche STOCKÉ (les champs portent leur clé dérivée) — sert à pré-remplir l'édition. */
export type FlowElement =
  | { kind: FlowTextKind; text: string; visibleIf?: FlowVisibleIf }
  | { kind: 'image'; src: string; visibleIf?: FlowVisibleIf }
  | { kind: 'field'; label: string; type: FlowFieldType; required: boolean; key: string; options?: string[]; visibleIf?: FlowVisibleIf };
/** Écran STOCKÉ (le serveur normalise : un flow mono-écran historique arrive comme [{ elements }]).
 *  `cta` = bouton « Continuer » d'un écran intermédiaire ; le DERNIER écran porte le cta global du flow. */
export interface FlowScreen {
  title?: string;
  cta?: string;
  elements: FlowElement[];
}
/** Écran ENVOYÉ à la création/édition (1 à 10 écrans, chaque écran >= 1 élément). */
export interface FlowScreenInput {
  title?: string;
  cta?: string;
  elements: FlowElementInput[];
}
export interface FlowSummary {
  id: string;
  name: string;
  status: 'DRAFT' | 'PUBLISHED';
  /** Champs dérivés (kind='field') — pour l'aperçu de la liste. */
  fields: FlowField[];
  /** Écrans riches (null pour les flows antérieurs au modèle) : aperçu détaillé + pré-remplissage de l'édition. */
  screens?: FlowScreen[] | null;
  /** Mapping clé champ -> clé user field, pour restaurer le « enregistrer dans » à l'édition. */
  mapping?: Record<string, string> | null;
  /** Libellé du bouton final (Footer du dernier écran) : null/absent = défaut « Envoyer ». */
  cta?: string | null;
  createdAt: string;
}
export function listFlows(tenantId: string): Promise<{ flows: FlowSummary[] }> {
  return request<{ flows: FlowSummary[] }>(`/tenants/${tenantId}/flows`);
}
/** Un élément qu'un formulaire renvoie, et le champ où le formulaire le range (`''` : nulle part). */
export interface SortieDeFormulaire { cle: string; libelle: string; cible: string }
/**
 * Les éléments d'un formulaire et leur champ, pour le panneau du bloc Formulaire (2026-11-10). `source: 'meta'` = un
 * formulaire du Business Manager, lu chez Meta, que rien ne range. 404 tant que l'API n'a pas cette route.
 */
export function listSortiesFormulaire(tenantId: string, flowId: string): Promise<{ source: 'messagingme' | 'meta'; sorties: SortieDeFormulaire[] }> {
  return request(`/tenants/${tenantId}/flows/${encodeURIComponent(flowId)}/sorties`);
}
export function createFlow(tenantId: string, input: { name: string; screens: FlowScreenInput[]; cta?: string }): Promise<{ id: string; status: string; name: string; fields: FlowField[] }> {
  return request(`/tenants/${tenantId}/flows`, { method: 'POST', body: JSON.stringify(input) });
}
/** Édite un flow DRAFT (réécrit le flow_json). 409 si le flow est PUBLISHED (immuable). */
export function updateFlow(tenantId: string, flowId: string, input: { name: string; screens: FlowScreenInput[]; cta?: string }): Promise<{ id: string; status: string; name: string; fields: FlowField[] }> {
  return request(`/tenants/${tenantId}/flows/${flowId}`, { method: 'PATCH', body: JSON.stringify(input) });
}
/** « Dupliquer pour modifier » : clone un flow (publié ou draft) en un nouveau DRAFT éditable. */
export function duplicateFlow(tenantId: string, flowId: string): Promise<{ id: string; status: string; name: string; fields: FlowField[] }> {
  return request(`/tenants/${tenantId}/flows/${flowId}/duplicate`, { method: 'POST' });
}
export function publishFlow(tenantId: string, flowId: string): Promise<{ id: string; status: string }> {
  return request(`/tenants/${tenantId}/flows/${flowId}/publish`, { method: 'POST' });
}
/** Supprime un formulaire : un DRAFT est supprimé, un PUBLISHED est déprécié côté Meta (immuable). */
export function deleteFlow(tenantId: string, flowId: string): Promise<{ id: string; deleted: boolean }> {
  return request(`/tenants/${tenantId}/flows/${flowId}`, { method: 'DELETE' });
}
/** Compte-rendu de la réconciliation avec le compte WhatsApp Manager (voir POST /flows/refresh). */
export interface FlowRefreshReport {
  /** Formulaires vus chez Meta et créés chez nous (structure inconnue : Meta ne la renvoie pas). */
  importes: number;
  /** Formulaires déjà connus dont le nom ou le passage à « publié » a été aligné sur Meta. */
  majs: number;
  /** Formulaires laissés de côté : statut hors de notre modèle (déprécié, bloqué), ou id d'un autre espace. */
  ignores: number;
  /** Formulaires que nous connaissons et que Meta ne liste plus. Comptés, jamais supprimés d'office. */
  absents: number;
}
/** « Rafraîchir » : va chercher les formulaires du compte WhatsApp Manager et met la liste locale à jour. */
export function refreshFlows(tenantId: string): Promise<FlowRefreshReport> {
  return request(`/tenants/${tenantId}/flows/refresh`, { method: 'POST' });
}

// --- Workflows (bot builder : graphe de blocs) ---

// `rcs_message` : envoi sur le canal RCS, DEUX sorties ('sent' / 'unreachable') -> permet de brancher un
// repli WhatsApp sur les contacts que le RCS n'atteint pas.
// `email` : envoi via une boîte SMTP connectée (node « Envoi de mail »). Action SYNCHRONE best-effort (un
// échec est journalisé côté serveur, jamais bloquant) -> une seule sortie, comme tag/field/action.
// `question` : pose une question au contact, avec un MENU de reponses (liste interactive WhatsApp) ou
// sans menu. Il attend TOUJOURS une reponse, et il est le seul bloc a porter en plus une echeance.
// Sorties : `row:<i>` par ligne du menu, `timeout` a l'echeance, `fichier` quand il attend un fichier et en recoit
// un d'un type coche (`attendreFichier`, `genresFichier`), et l'arete libre pour une reponse ecrite.
// `flow` : envoie un formulaire WhatsApp et attend. Sorties : `rempli` quand le contact le renvoie, l'arete libre
// pour toute autre reponse (et pour le formulaire renvoye si `rempli` n'est reliee a rien).
// `http` : joue un appel DEJA mis au point dans Tools > Connecteurs API et range sa reponse dans un champ du
// contact. Action synchrone non bloquante, comme `tag` ou `action`.
// `aller_a` : « Aller à » (RC5). `data.cible` = le code public (`nod_…`) d'un bloc de n'importe quel scenario de
// l'espace, `data.cibleLibelle` = son nom tel que l'ecran l'a choisi (« Menu principal, Question 2 »). Aucune sortie.
// La liste des types est partagée avec le serveur (`../partage/blocs`) : `NODE_META` est typé dessus.
export type { WorkflowNodeType } from '../partage/blocs';

/** Résultat d'un essai de « Fonction JS » : ce que le bac à sable a produit, ou la faute du client. */
export interface EssaiJs { ok: boolean; valeur: string; erreur?: string }

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}
export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
export interface WorkflowSummary {
  id: string;
  name: string;
  /** Code public « scn_<client>_<ulid> » (schéma A). Absent tant que le backfill n'a pas tourné. */
  code?: string | null;
  /** Le rayon (menu « Scénario ») : `general` au Builder, `shopify` pour une automation. Rendu par `getWorkflow`. */
  rayon?: string;
  /**
   * Le graphe EN LIGNE : celui que les contacts parcourent. Ne change que sur « Publier ».
   *
   * ⚠️ ABSENT de la LISTE depuis le 2026-09-01, et c'est voulu : elle renvoyait deux graphes complets par
   * ligne pour des écrans qui n'affichent qu'un nom. Il n'est présent que sur `getWorkflow(id)`, que
   * l'écran d'édition appelle déjà à l'ouverture. Ce que les écrans en tiraient est devenu `nodeCount`,
   * `hasDraft` et `campaignEligible`.
   */
  graph?: WorkflowGraph;
  /** Le brouillon en attente. null = aucun, ce qui est en ligne est aussi ce qui est édité. Absent de la
   *  liste, comme `graph` : c'est `hasDraft` qui le remplace. */
  draftGraph?: WorkflowGraph | null;
  /** Nombre de blocs. Rendu par la LISTE (calculé en base), absent du détail. */
  nodeCount?: number;
  /** Un brouillon attend-il d'être publié ? Rendu par la LISTE, absent du détail (`draftGraph` y répond). */
  hasDraft?: boolean;
  /**
   * Le scénario peut-il ouvrir une CAMPAGNE ? Rendu par la LISTE, calculé côté serveur avec la MÊME règle
   * que la garde de création : l'écran ne peut donc pas proposer un scénario que la création refuserait.
   */
  campaignEligible?: boolean;
  /**
   * PAR QUOI il ouvre, quand il le peut. Rendu par la LISTE, à côté de `campaignEligible` et jamais à sa
   * place : les trois écrans qui lisent le booléen continuent de le lire.
   *
   * ⚠️ ABSENT = un serveur plus ancien. `web/lib/campagne-scenario.ts` GARDE alors le scénario au lieu de
   * le masquer : le front part sur Vercel à chaque push, l'API suit à la main, et masquer ce qu'on ne sait
   * pas viderait toute la liste entre les deux.
   */
  canalOuverture?: 'whatsapp' | 'rcs' | null;
  /** Dernière mise en ligne. null = jamais publié (scénario neuf, ou antérieur au bouton). */
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
/** Ce que l'éditeur OUVRE : le brouillon s'il existe, sinon la version en ligne (miroir de `grapheEditable`). */
export function grapheEditable(w: WorkflowSummary): WorkflowGraph {
  // ⚠️ À n'appeler QUE sur un scénario venu de `getWorkflow(id)`. La LISTE ne porte plus de graphe, et un
  // repli sur un graphe vide est plus honnête qu'un plantage : l'écran d'édition, seul appelant, charge
  // toujours le détail avant d'ouvrir.
  return w.draftGraph ?? w.graph ?? { nodes: [], edges: [] };
}
/**
 * Ce scénario a-t-il quelque chose EN LIGNE ? Un scénario jamais publié n'a pas de version publiée, donc
 * rien ne s'exécute quand on le déclenche.
 *
 * 🔴 À afficher partout où l'on CHOISIT un scénario à déclencher (automation, webhook entrant, lancement
 * depuis l'inbox). Sans ça, on peut brancher une automation sur un scénario jamais publié : elle se
 * déclencherait normalement et ne ferait rien, sans le moindre message. C'est le seul piège que le brouillon
 * introduit, et il se ferme au moment du choix.
 */
export function estEnLigne(w: WorkflowSummary): boolean {
  // La LISTE ne porte plus de graphe : elle donne le nombre de blocs, calculé en base. On le lit d'abord.
  if (typeof w.nodeCount === 'number') return w.nodeCount > 0;
  // Lecture DÉFENSIVE, comme partout où l'on touche une réponse d'API : ce helper est appelé depuis trois
  // écrans qui ne demandent au scénario que son nom (automations, webhooks, inbox). Une réponse sans `graph`
  // ferait tomber la page ENTIÈRE sur un `.nodes` d'undefined, pour un simple libellé. Vu le 2026-09-01 :
  // 19 tests e2e des webhooks rouges d'un coup.
  return Array.isArray(w.graph?.nodes) && w.graph.nodes.length > 0;
}
/**
 * Éprouve une « Fonction JS » sur une valeur d'essai.
 *
 * ⚠️ LE MÊME BAC À SABLE QUE L'EXÉCUTION, côté serveur : un essai qui réussirait là où le parcours échoue
 * serait pire que pas d'essai du tout. Le résultat arrive toujours en 200, échec compris : la faute du
 * client est le RÉSULTAT de l'essai, pas une panne de la route.
 */
export function essayerFonctionJs(tenantId: string, code: string, valeur: string, champSource?: string): Promise<EssaiJs> {
  return request<EssaiJs>(`/tenants/${tenantId}/workflows/js-test`, {
    // ⚠️ `champSource` DONNE SON NOM AU PARAMÈTRE de la fonction, comme à l'exécution. L'omettre faisait
    // échouer l'essai sur un code que la production accepte, ce qui démentait la promesse ci-dessus.
    method: 'POST', body: JSON.stringify({ code, valeur, ...(champSource ? { champSource } : {}) }),
  });
}

/**
 * Les scénarios du Builder. `tous` : aussi ceux de Shopify et de HubSpot, chacun avec son `rayon`, pour le seul choix
 * qui les lance (l'Inbox). ⚠️ Une API d'avant ignore le paramètre et rend le Builder, sans `rayon` : lire alors `general`.
 */
export function listWorkflows(tenantId: string, rayons?: 'tous'): Promise<{ workflows: WorkflowSummary[] }> {
  return request<{ workflows: WorkflowSummary[] }>(`/tenants/${tenantId}/workflows${rayons ? '?rayons=tous' : ''}`);
}
/**
 * Une liste `tous` rangée par rayon, dans l'ordre du menu, groupes vides retirés : un `<optgroup>` par entrée
 * (l'Inbox, Mes tableaux). Sans `rayon` (une API d'avant), le scénario est du Builder.
 */
export function parRayon(workflows: WorkflowSummary[]): Array<{ rayon: string; nom: string; scenarios: WorkflowSummary[] }> {
  return ([['general', 'Builder'], ['shopify', 'Shopify'], ['hubspot', 'HubSpot']] as const)
    .map(([rayon, nom]) => ({ rayon, nom, scenarios: workflows.filter((w) => (w.rayon ?? 'general') === rayon) }))
    .filter((g) => g.scenarios.length > 0);
}
export function createWorkflow(tenantId: string, name: string, graph?: WorkflowGraph): Promise<{ id: string; name: string; graph: WorkflowGraph }> {
  return request(`/tenants/${tenantId}/workflows`, { method: 'POST', body: JSON.stringify({ name, ...(graph ? { graph } : {}) }) });
}
/**
 * Un scénario et ses DÉPARTS (menu « Scénario », lot 2) : d'où il part, fenêtre ouverte ou fermée, selon son rayon et ce
 * qui le lance. `departs` absent (une API d'avant ce lot) : un départ ouvert à l'entrée, le comportement d'avant.
 */
export function getWorkflow(tenantId: string, id: string): Promise<{ workflow: WorkflowSummary; departs?: Depart[] }> {
  return request<{ workflow: WorkflowSummary; departs?: Depart[] }>(`/tenants/${tenantId}/workflows/${id}`);
}
/**
 * Enregistre le BROUILLON du scénario (jamais la version en ligne, cf. `publishWorkflow`).
 *
 * `brouillon` dans la réponse = reste-t-il quelque chose à publier après cette écriture ? La question se pose
 * au serveur parce qu'un enregistrement identique à la version en ligne n'y laisse aucun brouillon.
 */
/**
 * `graph` dans la réponse : le graphe tel que le serveur l'a enregistré, codes publics des blocs posés (`mintNodeCodes`).
 * Un bloc neuf n'a son code qu'à partir de là : le constructeur le recopie sur sa carte (bouton « copier le code »).
 */
export function updateWorkflow(tenantId: string, id: string, patch: { name?: string; graph?: WorkflowGraph }, opts?: { keepalive?: boolean }): Promise<{ brouillon?: boolean; graph?: WorkflowGraph }> {
  // `keepalive` : la requête survit au déchargement de la page (flush auto-save sur beforeunload / fermeture d'onglet).
  return request(`/tenants/${tenantId}/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(patch), ...(opts?.keepalive ? { keepalive: true } : {}) });
}
export function deleteWorkflow(tenantId: string, id: string): Promise<unknown> {
  return request(`/tenants/${tenantId}/workflows/${id}`, { method: 'DELETE' });
}
/**
 * MET EN LIGNE le brouillon. C'est le seul appel du front qui change quelque chose pour les contacts : tout
 * le reste de l'éditeur n'écrit que le brouillon.
 *
 * Chaque publication garde sa version : on revient à une ancienne par une mise en ligne que Claude prépare (la console
 * ne montre pas encore les versions).
 */
export function publishWorkflow(tenantId: string, id: string): Promise<PublicationDuScenario> {
  return request(`/tenants/${tenantId}/workflows/${id}/publish`, { method: 'POST', body: JSON.stringify({}) });
}

/**
 * Ce que « Publier » rend (menu « Scénario », lot 3) : la version en ligne (200), ou une mise en ligne PROGRAMMÉE (202)
 * quand un template écrit depuis un bloc attend encore l'approbation de Meta.
 */
export type PublicationDuScenario =
  | { id: string; graph: WorkflowGraph; publishedAt: string | null; programmee?: undefined }
  | { id: string; programmee: { le: string; attend: Array<{ modele: string; langue: string }> } };

/** Un template écrit depuis un bloc, et son état chez Meta (`modeles_de_bloc`). */
export interface ModeleDeBloc {
  modele: string;
  langue: string;
  etat: 'en_validation' | 'approuve' | 'refuse';
  raison: string | null;
  creeLe: string;
}

/** La version programmée d'un scénario : ce qu'elle attend encore, ou les campagnes qui retiennent sa mise en ligne. */
export interface ProgrammationVue {
  le: string;
  attend: Array<{ modele: string; langue: string; etat: string; raison: string | null }>;
  campagnes: string[];
}

/** Les templates écrits depuis les blocs du scénario, et sa version programmée. L'éditeur les sonde. */
export function modelesDuScenario(tenantId: string, id: string): Promise<{ modeles: ModeleDeBloc[]; programmee: ProgrammationVue | null }> {
  return request(`/tenants/${tenantId}/workflows/${id}/modeles`);
}

/** Annule la mise en ligne programmée : la version en ligne et le brouillon ne changent pas. */
export function annulerProgrammation(tenantId: string, id: string): Promise<unknown> {
  return request(`/tenants/${tenantId}/workflows/${id}/programmation`, { method: 'DELETE' });
}
/** Duplique un scénario (nom « X (copie) », graphe cloné avec codes de node frais). Renvoie le nouveau scénario. */
export function duplicateWorkflow(tenantId: string, id: string): Promise<{ id: string; name: string; graph: WorkflowGraph }> {
  return request(`/tenants/${tenantId}/workflows/${id}/duplicate`, { method: 'POST', body: JSON.stringify({}) });
}

/** Un bloc (node) aplati depuis les scénarios, pour la page Contenu > Blocs. `code` = nod_... ou null. */
export interface NodeListItem {
  code: string | null;
  type: WorkflowNodeType;
  /** Nom libre du bloc (data.name), vide si non renseigné. */
  name: string;
  workflowId: string;
  workflowName: string;
  summary: string;
}
/**
 * Liste tous les blocs des scénarios du tenant, optionnellement filtrés par type. `scenario` : ceux du RAYON de ce scénario
 * (menu « Scénario », lot 2), pour qu'un « Aller à » reste dans le rayon ; absent, le Builder général.
 */
export function listNodes(tenantId: string, type?: WorkflowNodeType, scenario?: string): Promise<{ nodes: NodeListItem[] }> {
  const qs = new URLSearchParams();
  if (type) qs.set('type', type);
  if (scenario) qs.set('scenario', scenario);
  const s = qs.toString();
  return request<{ nodes: NodeListItem[] }>(`/tenants/${tenantId}/nodes${s ? `?${s}` : ''}`);
}

// --- Contenu : Tags + User fields (édition) ---

export interface TagCount {
  tag: string;
  count: number;
  /** Code public « tag_<client>_<ulid> » (schéma A). null pour un tag utilisé mais jamais déclaré, ou avant backfill. */
  code?: string | null;
}
export function listTags(tenantId: string): Promise<{ tags: TagCount[] }> {
  return request<{ tags: TagCount[] }>(`/tenants/${tenantId}/tags`);
}
export function createTag(tenantId: string, name: string): Promise<{ name: string; created: boolean }> {
  return request(`/tenants/${tenantId}/tags`, { method: 'POST', body: JSON.stringify({ name }) });
}
export function renameTag(tenantId: string, from: string, to: string): Promise<{ renamed: number }> {
  return request(`/tenants/${tenantId}/tags`, { method: 'PATCH', body: JSON.stringify({ from, to }) });
}
export function deleteTag(tenantId: string, tag: string): Promise<{ removed: number }> {
  return request(`/tenants/${tenantId}/tags?tag=${encodeURIComponent(tag)}`, { method: 'DELETE' });
}

// --- Le oui de mise en ligne (lot 1 du CSM virtuel, B2) ---

/** Une mise en ligne préparée par Claude, telle que la page la montre (réservée aux administrateurs). */
export function lireMiseEnLigne(tenantId: string, id: string): Promise<VueMiseEnLigne> {
  return request<VueMiseEnLigne>(`/tenants/${tenantId}/mises-en-ligne/${encodeURIComponent(id)}`);
}

/** Le clic : accepte la mise en ligne (ou reprend une mise en ligne interrompue), et rend où elle en est. */
export function accepterMiseEnLigne(tenantId: string, id: string): Promise<VueMiseEnLigne> {
  return request<VueMiseEnLigne>(`/tenants/${tenantId}/mises-en-ligne/${encodeURIComponent(id)}/accepter`, { method: 'POST', body: '{}' });
}
