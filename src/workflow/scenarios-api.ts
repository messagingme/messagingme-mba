import type { CodeApi } from '../api/erreurs';
import { STATUT_PAR_CODE } from '../api/erreurs';
import { modeleLuDe, verdictModele } from '../api/modele-envoi';
import { parseParamHints } from '../crm/template';
import type { IndiceDuTemplate } from '../crm/template-hints.pg';
import type { TemplateSummary } from '../meta/templates';
import type { Fonction } from '../offres/offres';
import { corpsRefusFonction, STATUT_REFUS_OFFRE } from '../offres/refus';
import { parseGraph, type WorkflowGraph } from './graph';
import { mintNodeCodes } from './node-codes';
import { ouvertureApi, type OuvertureApi } from './ouverture-api';
import { empreinteRecette, lireRecette, referencesDe, type Recette } from './recette';
import { cleTemplateRecette, compilerRecette, decompilerGraphe, type ReferencesResolues, type TemplateResolu } from './recette-graphe';
import type { LigneApi } from './store.pg';
import { entreeDuGraphe } from '../../web/lib/partage/ouverture-scenario';

/**
 * CRÉER, RELIRE, REMPLACER ET SUPPRIMER UN SCÉNARIO PAR L'API OU LE MCP (spec
 * `docs/superpowers/specs/2026-11-02-scenarios-api-design.md`). Le seul chemin : `POST|GET|PUT|DELETE /v1/scenarios`
 * et les outils `create_scenario`, `get_scenario`, `update_scenario`, `delete_scenario` appellent ces quatre fonctions et
 * n'ont aucune logique à eux. Une route et un outil qui jugeraient différemment la même recette seraient le défaut
 * corrigé par `ouvertureApi`.
 *
 * 🔴 TOUTE ÉCRITURE PUBLIE (décision de Julien) : aucun brouillon par l'API. Un template qui n'est pas approuvé fait
 * refuser l'appel entier, rien n'est enregistré.
 */

export type { LigneApi };

export interface MagasinScenariosApi {
  creerPublieParApi(tenantId: string, nom: string, graphe: WorkflowGraph): Promise<{ id: string; code: string } | { nomPris: string }>;
  lireParApi(tenantId: string, ref: string): Promise<LigneApi | null>;
  remplacerPublieParApi<R>(id: string, tenantId: string, nom: string, graphe: WorkflowGraph, controle: (l: LigneApi) => R | null):
    Promise<'ok' | 'inconnu' | { nomPris: string } | { refus: R }>;
  supprimerParApi(id: string, tenantId: string): Promise<'ok' | 'inconnu' | 'console' | { utilise: string[] }>;
}

export interface DepsScenariosApi {
  scenarios: MagasinScenariosApi;
  offres: { offreDe(tenantId: string): Promise<{ droits: { fonctions: ReadonlySet<Fonction> } }> };
  /** Les templates du WABA, tels que Meta les rend (`[]` sans WABA). */
  templates(tenantId: string): Promise<readonly TemplateSummary[]>;
  /** Les associations « variable vers champ » posées dans la console. */
  indices: { listerParEspace(tenantId: string): Promise<readonly IndiceDuTemplate[]> };
  agents(tenantId: string): Promise<ReadonlyArray<{ id: string; label: string; actif: boolean; sorties: ReadonlyArray<{ code: string; label: string }> }>>;
  /** Les clés des champs de l'espace. */
  champs(tenantId: string): Promise<readonly string[]>;
  /** La raison d'un refus du fichier, ou `null` : `verifierFichierDuBloc`, le chemin de l'envoi. */
  verifierFichier(tenantId: string, url: string): Promise<string | null>;
  /**
   * Les places de téléchargement de la copie (`placesDeTelechargement`, les mêmes que la création d'un modèle) : chaque
   * fichier peut peser 16 Mo en mémoire. Absentes : aucune limite (tests).
   */
  places?: { prendre(): (() => void) | null };
  /** L'horloge du délai total de vérification ; absente : `Date.now`. */
  maintenant?: () => number;
  tenantCode(tenantId: string): Promise<string>;
  journal(tenantId: string, action: 'workflow.published' | 'workflow.deleted', workflowId: string, details: Record<string, unknown>, auteur: Auteur): Promise<void>;
}

export type Origine = 'api' | 'mcp';
/**
 * Qui a écrit : la personne derrière un jeton OAuth (`userId`), et ce qui a ouvert l'appel (`cle:<id>` ou `oauth:<id>`,
 * jamais le secret). Une écriture qui publie un parcours envoyant de vrais messages se signe au journal.
 */
export interface Auteur { userId: string | null; acces: string | null }
const ANONYME: Auteur = { userId: null, acces: null };

/** Ce que rendent la création, la lecture et le remplacement. */
export interface VueScenario {
  id: string;
  code: string;
  nom: string;
  origine: 'console' | 'api';
  /** Le code `nod_` du bloc d'entrée : `/v1/sends` le vise pour un scénario qui ouvre par un message. */
  entreeCode: string | null;
  recette: Recette;
  /** À renvoyer au remplacement (`If-Match`) : il est refusé si la recette a changé entre-temps. */
  empreinte: string;
  ouverture: OuvertureApi | null;
}

export type ResultatScenario<T> =
  | { ok: true; valeur: T }
  | { ok: false; statut: number; code: CodeApi; message: string; details?: Record<string, unknown> };

const echec = (code: CodeApi, message: string, details?: Record<string, unknown>): ResultatScenario<never> =>
  ({ ok: false, statut: STATUT_PAR_CODE[code] ?? 400, code, message, ...(details ? { details } : {}) });

/**
 * Le délai total de la vérification des fichiers d'une recette : au-delà, l'appel est refusé au lieu de traîner jusqu'à
 * la coupure de Cloudflare (100 s), qui laisserait l'appelant sans réponse.
 */
export const DELAI_FICHIERS_MS = 60_000;

const introuvable = (): ResultatScenario<never> => echec('scenario_not_found', 'scénario introuvable dans cet espace');

async function horsOffre(deps: DepsScenariosApi, tenantId: string): Promise<ResultatScenario<never> | null> {
  if ((await deps.offres.offreDe(tenantId)).droits.fonctions.has('scenarios')) return null;
  const corps = corpsRefusFonction('scenarios');
  return { ok: false, statut: STATUT_REFUS_OFFRE, code: corps.code, message: corps.error, details: { upgradeUrl: corps.upgradeUrl } };
}

/** Le template tel que la recette le juge : la lecture partagée de `/v1/sends` (`verdictModele`), jamais une règle voisine. */
function templateResolu(t: TemplateSummary | undefined, indices: readonly IndiceDuTemplate[]): TemplateResolu {
  if (!t) return { etat: 'absent' };
  if (t.status !== 'APPROVED') return { etat: 'non_approuve', statut: t.status };
  // Les réponses rapides d'un carrousel vivent dans ses cartes (`card:<i>:btn:<j>`), qu'une recette ne relie pas : un
  // clic n'aurait aucune suite et la conversation partirait à l'équipe sans rien recevoir.
  if (t.isCarousel) return { etat: 'non_envoyable', raison: 'c’est un carrousel, que les scénarios de l’API ne savent pas encore relier' };
  const v = verdictModele(modeleLuDe(t), t.language);
  if (v.statut === 'approuve') {
    const lus = indices
      .filter((i) => i.name === t.name && i.language === t.language)
      .flatMap((i) => parseParamHints([{ position: i.position, source: i.source }]) ?? []);
    return { etat: 'approuve', boutons: (t.buttons ?? []).map((b) => ({ ...b })), variables: v.variables, indices: lus };
  }
  if (v.statut === 'non_envoyable') return { etat: 'non_envoyable', raison: v.raison };
  if (v.statut === 'categorie_non_admise') return { etat: 'non_envoyable', raison: `sa catégorie (${v.categorie}) ne part pas d’un scénario` };
  return { etat: 'non_envoyable', raison: 'sa catégorie est illisible chez Meta' };
}

/** Lit la recette, va chercher ce qu'elle nomme, vérifie ses fichiers et la compile. Rien n'est écrit. */
async function preparer(deps: DepsScenariosApi, tenantId: string, corps: unknown, precedent: WorkflowGraph | null):
  Promise<ResultatScenario<{ recette: Recette; graphe: WorkflowGraph }>> {
  const lu = lireRecette(corps);
  if (!lu.ok) return echec(lu.code, lu.message, { chemin: lu.chemin });
  const recette = lu.valeur;
  const noms = referencesDe(recette.entree);
  const [templates, indices, agents, champs] = await Promise.all([
    noms.templates.length > 0 ? deps.templates(tenantId) : Promise.resolve([]),
    noms.templates.length > 0 ? deps.indices.listerParEspace(tenantId) : Promise.resolve([]),
    noms.agents.length > 0 ? deps.agents(tenantId) : Promise.resolve([]),
    noms.champs.length > 0 ? deps.champs(tenantId) : Promise.resolve([]),
  ]);
  const refs: ReferencesResolues = {
    templates: new Map(noms.templates.map(({ nom, langue }) => [
      cleTemplateRecette(nom, langue),
      templateResolu(templates.find((t) => t.name === nom && t.language === langue), indices),
    ])),
    agents: new Map(agents.map((a) => [a.id, { actif: a.actif, label: a.label, sorties: a.sorties }])),
    champs: new Set(champs),
  };
  const compile = compilerRecette(recette.entree, refs, precedent);
  if (!compile.ok) return echec(compile.code, compile.message, { chemin: compile.chemin });
  // Les fichiers en dernier : un téléchargement par adresse, seulement pour une recette qui tient debout.
  const maintenant = deps.maintenant ?? Date.now;
  const debut = maintenant();
  for (const url of noms.fichiers) {
    if (maintenant() - debut > DELAI_FICHIERS_MS) {
      return echec('file_refused', `la vérification des fichiers est trop longue : le fichier ${url} n’a pas été lu. Donnez des adresses qui répondent vite`, { url });
    }
    const rendre = deps.places ? deps.places.prendre() : () => {};
    if (rendre === null) {
      return echec('file_refused', 'toutes les places de téléchargement sont prises : réessayez dans un instant', { url });
    }
    let raison: string | null;
    try {
      raison = await deps.verifierFichier(tenantId, url);
    } finally {
      rendre();
    }
    if (raison !== null) return echec('file_refused', `le fichier ${url} est refusé : ${raison}`, { url });
  }
  const graphe = parseGraph(mintNodeCodes(compile.valeur, await deps.tenantCode(tenantId)));
  if (graphe === null) return echec('invalid_body', 'le scénario compilé est invalide');
  // Ce que l'envoi refuserait est refusé à l'écriture : la même règle que `/v1/sends` et la console.
  const ouverture = ouvertureApi(graphe);
  if (ouverture.ouverture === null) return echec('unsendable_target', `ce scénario ne pourrait pas partir : ${ouverture.raison}`);
  return { ok: true, valeur: { recette, graphe } };
}

/** La vue rendue à l'appelant, relue depuis le graphe enregistré : ce qu'il lit est ce qui tourne. */
function vueDe(l: Pick<LigneApi, 'id' | 'code' | 'name' | 'origine' | 'graph'>): ResultatScenario<VueScenario> {
  const entree = decompilerGraphe(l.graph);
  if (!entree.ok) return echec(entree.code, entree.message);
  const ouverture = ouvertureApi(l.graph);
  return {
    ok: true,
    valeur: {
      id: l.id, code: l.code ?? '', nom: l.name, origine: l.origine,
      entreeCode: (entreeDuGraphe(l.graph)?.data.code as string | undefined) ?? null,
      recette: { nom: l.name, entree: entree.valeur }, empreinte: empreinteRecette(entree.valeur),
      ouverture: ouverture.ouverture,
    },
  };
}

export async function creerScenario(
  deps: DepsScenariosApi, tenantId: string, corps: unknown, origine: Origine, auteur: Auteur = ANONYME,
): Promise<ResultatScenario<VueScenario>> {
  const offre = await horsOffre(deps, tenantId);
  if (offre) return offre;
  const p = await preparer(deps, tenantId, corps, null);
  if (!p.ok) return p;
  const cree = await deps.scenarios.creerPublieParApi(tenantId, p.valeur.recette.nom, p.valeur.graphe);
  if ('nomPris' in cree) return echec('scenario_name_taken', `un scénario de l’espace s’appelle déjà « ${p.valeur.recette.nom} »`, { id: cree.nomPris });
  await deps.journal(tenantId, 'workflow.published', cree.id, { origine, blocs: p.valeur.graphe.nodes.length }, auteur);
  return vueDe({ id: cree.id, code: cree.code, name: p.valeur.recette.nom, origine: 'api', graph: p.valeur.graphe });
}

export async function lireScenario(deps: DepsScenariosApi, tenantId: string, ref: string): Promise<ResultatScenario<VueScenario>> {
  const offre = await horsOffre(deps, tenantId);
  if (offre) return offre;
  const l = await deps.scenarios.lireParApi(tenantId, ref);
  return l ? vueDe(l) : introuvable();
}

/** L'empreinte de ce qu'une ligne décrit ; `null` si elle ne se décrit plus. */
const empreinteDe = (g: WorkflowGraph): string | null => {
  const d = decompilerGraphe(g);
  return d.ok ? empreinteRecette(d.valeur) : null;
};

export async function remplacerScenario(
  deps: DepsScenariosApi, tenantId: string, ref: string, corps: unknown, empreinte: string | undefined, origine: Origine,
  auteur: Auteur = ANONYME,
): Promise<ResultatScenario<VueScenario>> {
  const offre = await horsOffre(deps, tenantId);
  if (offre) return offre;
  if (empreinte === undefined || empreinte.trim() === '') {
    return echec('precondition_required', 'l’empreinte lue manque : passez celle de GET /v1/scenarios/{id} dans If-Match ou dans « empreinte »');
  }
  const avant = await deps.scenarios.lireParApi(tenantId, ref);
  if (!avant) return introuvable();
  if (avant.origine !== 'api') return echec('scenario_managed_in_console', 'ce scénario a été créé dans la console : seule la console le modifie');
  const p = await preparer(deps, tenantId, corps, avant.graph);
  if (!p.ok) return p;

  // Le contrôle tourne SOUS LE VERROU de la ligne (`remplacerPublieParApi`) : entre la lecture d'avant et l'écriture, la
  // console a pu publier ou enregistrer un brouillon.
  type Refus = ResultatScenario<never>;
  const controle = (l: LigneApi): Refus | null => {
    if (l.origine !== 'api') return echec('scenario_managed_in_console', 'ce scénario a été créé dans la console : seule la console le modifie');
    const publie = empreinteDe(l.graph);
    if (publie === null) return echec('scenario_not_describable', 'modifié dans la console, ce scénario ne se décrit plus par une recette : seule la console le modifie');
    if (publie !== empreinte.trim()) return echec('scenario_changed', 'le scénario a changé depuis votre lecture : relisez-le et renvoyez sa nouvelle empreinte');
    // Un brouillon de la console qui décrit autre chose serait effacé par la publication : refusé. Un brouillon qui
    // n'a bougé que des blocs (l'éditeur réenregistre à l'ouverture) ne bloque rien.
    if (l.draftGraph && l.draftGraph.nodes.length > 0 && empreinteDe(l.draftGraph) !== publie) {
      return echec('scenario_changed', 'une modification de la console attend d’être publiée sur ce scénario : publiez-la ou abandonnez-la dans la console, puis relisez-le');
    }
    return null;
  };
  const r = await deps.scenarios.remplacerPublieParApi(avant.id, tenantId, p.valeur.recette.nom, p.valeur.graphe, controle);
  if (r === 'inconnu') return introuvable();
  if (r !== 'ok' && 'nomPris' in r) return echec('scenario_name_taken', `un autre scénario de l’espace s’appelle déjà « ${p.valeur.recette.nom} »`, { id: r.nomPris });
  if (r !== 'ok') return r.refus;
  await deps.journal(tenantId, 'workflow.published', avant.id, { origine, blocs: p.valeur.graphe.nodes.length }, auteur);
  return vueDe({ id: avant.id, code: avant.code ?? '', name: p.valeur.recette.nom, origine: 'api', graph: p.valeur.graphe });
}

export async function supprimerScenario(
  deps: DepsScenariosApi, tenantId: string, ref: string, origine: Origine, auteur: Auteur = ANONYME,
): Promise<ResultatScenario<{ id: string; supprime: true }>> {
  const offre = await horsOffre(deps, tenantId);
  if (offre) return offre;
  const l = await deps.scenarios.lireParApi(tenantId, ref);
  if (!l) return introuvable();
  const r = await deps.scenarios.supprimerParApi(l.id, tenantId);
  if (r === 'inconnu') return introuvable();
  if (r === 'console') return echec('scenario_managed_in_console', 'ce scénario a été créé dans la console : seule la console le supprime');
  if (r !== 'ok') return echec('scenario_in_use', `ce scénario sert encore : ${r.utilise.join(', ')}. Retirez-le d’abord de là, puis réessayez`, { utilise: r.utilise });
  await deps.journal(tenantId, 'workflow.deleted', l.id, { origine }, auteur);
  return { ok: true, valeur: { id: l.id, supprime: true } };
}

