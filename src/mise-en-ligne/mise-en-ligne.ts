import { randomUUID } from 'node:crypto';
import { DELAI_SCENARIO_MAX_S, DELAI_SCENARIO_MIN_S } from '../../web/lib/partage/repondeur-modes';
import type { EtatVue, ResultatAction, VueMiseEnLigne } from '../../web/lib/partage/mise-en-ligne';
import { makeJournal, type AuditSink } from '../audit/journal';
import { canonique } from '../campaign/confirmation';
import { estUuid } from '../http/scope';
import { refus, type Issue } from '../lib/issue';
import { journaliser } from '../lib/journal';
import { sha256Hex } from '../lib/signature';
import { refusFonction } from '../offres/refus';
import { choisirRepondeur, type DepsReglageRepondeur } from '../repondeur/reglage';
import type { WorkflowGraph } from '../workflow/graph';
import type { DepsPublication } from '../workflow/modeles-de-bloc';
import { controlesDePublication } from '../workflow/publication';
import { publierScenario, type ScenariosAPublier } from '../workflow/publier';
import type { WorkflowRow } from '../workflow/store.pg';
import type { VersionScenario, VersionScenarioLue } from '../workflow/versions.pg';
import type { LigneMiseEnLigne, PgMisesEnLigne } from './store.pg';

/**
 * LE OUI DE MISE EN LIGNE (lot 1 du CSM virtuel, B2, plan `docs/superpowers/plans/2026-11-24-csm-lot1-c-clic-et-versions.md`,
 * décisions de Julien du 24 novembre). Le CSM prépare une mise en ligne et la montre ; un admin connecté clique sur UN
 * bouton qui nomme l'effet, et ce clic vaut accord. Le serveur garantit, sans que le client le voie :
 *  - le clic est celui d'un admin connecté : il passe par la route de la console, qu'aucun jeton OAuth n'ouvre (le CSM
 *    n'a aucun outil qui clique) ;
 *  - il vaut pour ce qui a été montré : le clic relit l'état et recalcule l'empreinte, et ce qui part est ce qui a été
 *    montré (le graphe gardé), pas un brouillon modifié depuis ;
 *  - un bouton pas cliqué expire en 24 heures ; cliqué, il sert une fois, et un second clic rend le résultat ;
 *  - un admin retiré ou un accès révoqué avant l'exécution la bloque ;
 *  - tout part au journal : le clic, puis le résultat ; chaque action laisse aussi sa propre trace (publication, répondeur).
 * Le libellé du bouton et le récapitulatif sont écrits ICI, à partir des actions : le CSM ne choisit pas les mots du
 * bouton qui vaut accord.
 *
 * L'exécution court dans la requête du clic, sous un bail (deux exécutions ne courent jamais ensemble). Une exécution
 * coupée (une panne, un redémarrage) se reprend par la même route : la page le dit, un admin reclique, et l'exécution
 * repart après le dernier résultat écrit. Chaque action est rejouable sans double effet (republier le même graphe ne
 * fait pas de version, rebrancher le même répondeur ne change rien).
 */

/** Le contrat de la vue, partagé avec la page de la console (`web/lib/partage/mise-en-ligne.ts`). */
export { TYPES_ACTION, type EtatVue, type ResultatAction, type TypeAction, type VueMiseEnLigne } from '../../web/lib/partage/mise-en-ligne';

export const DUREE_MISE_EN_LIGNE_MS = 24 * 60 * 60 * 1000;
export const ACTIONS_MAX = 10;
/** Le bail d'une exécution, renouvelé à chaque action : une exécution tuée se reprend deux minutes après au pire. */
export const BAIL_EXECUTION_S = 120;

/** Ce que le CSM demande. */
export type DemandeAction =
  | { type: 'publier'; scenario: string }
  | { type: 'restaurer'; scenario: string; version: number }
  | { type: 'repondeur'; scenario: string; delaiHeures?: number };

/** Ce qui est gardé de chaque action : ce qui a été montré, et qui partira tel quel. */
export type ActionGardee =
  | { type: 'publier'; scenario: string; nom: string; graphe: WorkflowGraph }
  | { type: 'restaurer'; scenario: string; nom: string; version: number; publieeLe: string; graphe: WorkflowGraph }
  | { type: 'repondeur'; scenario: string; nom: string; delaiS: number };

export interface DepsMisesEnLigne {
  store: Pick<PgMisesEnLigne, 'inserer' | 'lire' | 'accepter' | 'reclamer' | 'noterResultat' | 'terminer' | 'relacher'>;
  /** Les scénarios de l'espace, système exclu (`PgWorkflowStore`, passé entier : ses méthodes lisent `this`). */
  scenarios: ScenariosAPublier & { getById(id: string, tenantId: string): Promise<WorkflowRow | null> };
  /** Les versions publiées (`PgVersionsScenario`, passé entier : ses méthodes lisent `this`). */
  versions: {
    lire(tenantId: string, workflowId: string, numero: number): Promise<VersionScenarioLue | null>;
    lister(tenantId: string, workflowId: string): Promise<VersionScenario[]>;
  };
  /** Le jugement des templates de bloc et le ménage : les dépendances de la publication de la console. */
  publication: DepsPublication;
  /** « Qui répond au client » : le même réglage que la carte de l'Accueil et `set_default_responder`. */
  repondeur: DepsReglageRepondeur;
  audit: AuditSink;
  maintenant(): number;
}

const INCONNUE = 'mise en ligne introuvable dans cet espace';
const EXPIREE = 'ce bouton a expiré (24 heures après sa préparation) : demandez à Claude de préparer à nouveau la mise en ligne.';
const MODIFIEE = 'ce qui vous a été montré a changé depuis : demandez à Claude de vous remontrer la mise en ligne.';
const CLIC_RETIRE = 'l’administrateur qui a accepté ne l’est plus : rien d’autre n’a été fait.';
const ACCES_REVOQUE = 'l’accès qui a préparé cette mise en ligne a été révoqué, ou sa personne retirée : rien d’autre n’a été fait.';
const SCENARIO_INCONNU = 'scénario introuvable dans cet espace';

/** Le graphe sans la position de ses blocs : la règle de `forme` du store (déplacer un bloc n'est pas publier). */
const sansPositions = (g: WorkflowGraph): unknown => ({ edges: g.edges, nodes: g.nodes.map(({ position: _p, ...reste }) => reste) });
const memeForme = (a: WorkflowGraph, b: WorkflowGraph): boolean => canonique(sansPositions(a)) === canonique(sansPositions(b));

interface Releve {
  gardees: ActionGardee[];
  /** L'état relu autour de chaque action (ce qui est en ligne, le répondeur actuel) : il entre dans l'empreinte. */
  contexte: unknown[];
}

/**
 * Relit l'état de chaque action, dans l'ordre qui tient (les publications, dans l'ordre demandé, puis le répondeur),
 * sans rien écrire. La proposition et le clic passent par elle : le clic refuse ce que la proposition aurait refusé.
 */
async function relever(deps: DepsMisesEnLigne, tenant: string, demandes: readonly DemandeAction[]): Promise<Issue<Releve>> {
  if (demandes.length === 0 || demandes.length > ACTIONS_MAX) return refus(400, `une mise en ligne porte de 1 à ${ACTIONS_MAX} actions`);
  // L'offre, pour TOUTE action (publier, restaurer, répondeur : la fonction des scénarios, comme « Publier » de la
  // console) ; relue au clic aussi : un espace redescendu en Base depuis la préparation est refusé.
  if (!(await deps.repondeur.offres.offreDe(tenant)).droits.fonctions.has('scenarios')) return refusFonction('scenarios');
  const ordonnees = [...demandes.filter((d) => d.type !== 'repondeur'), ...demandes.filter((d) => d.type === 'repondeur')];
  const publiesIci = new Set<string>();
  const gardees: ActionGardee[] = [];
  const contexte: unknown[] = [];
  for (const d of ordonnees) {
    if (!estUuid(d.scenario)) return refus(404, SCENARIO_INCONNU);
    const wf = await deps.scenarios.getById(d.scenario, tenant);
    // Le constructeur seul : un scénario d'automation (Shopify, HubSpot) se publie dans son écran.
    if (!wf || wf.rayon !== 'general') return refus(404, SCENARIO_INCONNU);
    if (d.type === 'repondeur') {
      if (gardees.some((g) => g.type === 'repondeur')) return refus(400, 'une mise en ligne branche le répondeur une fois au plus');
      const reglage = await deps.repondeur.reglages.get(tenant);
      const delaiS = d.delaiHeures === undefined ? reglage.repondeurDelaiScenarioS : d.delaiHeures * 3600;
      if (!Number.isInteger(delaiS) || delaiS < DELAI_SCENARIO_MIN_S || delaiS > DELAI_SCENARIO_MAX_S) {
        return refus(400, `le délai du scénario va de ${DELAI_SCENARIO_MIN_S / 3600} à ${DELAI_SCENARIO_MAX_S / 3600} heures`);
      }
      const publieIci = publiesIci.has(wf.id);
      if (!publieIci && wf.graph.nodes.length === 0) {
        return refus(409, `le scénario « ${wf.name} » n’est pas publié : ajoutez sa publication à cette mise en ligne`);
      }
      gardees.push({ type: 'repondeur', scenario: wf.id, nom: wf.name, delaiS });
      contexte.push({
        repondeur: {
          mode: reglage.repondeurMode, agent: reglage.repondeurAgentId, scenario: reglage.repondeurWorkflowId,
          adresse: reglage.repondeurAdresseId, delaiS: reglage.repondeurDelaiScenarioS,
        },
        ...(publieIci ? {} : { enLigne: sansPositions(wf.graph) }),
      });
      continue;
    }
    if (publiesIci.has(wf.id)) return refus(400, `le scénario « ${wf.name} » est publié deux fois dans cette mise en ligne`);
    let gardee: ActionGardee;
    if (d.type === 'publier') {
      if (!wf.draftGraph) return refus(409, `le scénario « ${wf.name} » n’a pas de brouillon à publier`);
      gardee = { type: 'publier', scenario: wf.id, nom: wf.name, graphe: wf.draftGraph };
    } else {
      if (!Number.isInteger(d.version) || d.version < 1) return refus(400, 'numéro de version invalide');
      const v = await deps.versions.lire(tenant, wf.id, d.version);
      if (!v) return refus(404, `le scénario « ${wf.name} » n’a pas de version ${d.version}`);
      if (memeForme(v.graph, wf.graph)) return refus(409, `la version ${d.version} du scénario « ${wf.name} » est déjà celle en ligne`);
      gardee = { type: 'restaurer', scenario: wf.id, nom: wf.name, version: v.numero, publieeLe: v.publieeLe, graphe: v.graph };
    }
    // Les contrôles du graphe, ceux de « Publier » (`controlesDePublication`) : le jugement des templates de bloc chez
    // Meta, lui, se fait à l'exécution, comme à la publication.
    const controle = await controlesDePublication(gardee.graphe, wf.id, () => deps.scenarios.list(tenant, 'general'), 'general');
    if (controle !== null) return refus(422, `le scénario « ${wf.name} » ne peut pas être publié : ${controle.message}`, { code: controle.code });
    gardees.push(gardee);
    contexte.push({ enLigne: sansPositions(wf.graph) });
    publiesIci.add(wf.id);
  }
  return { ok: true, valeur: { gardees, contexte } };
}

/** L'empreinte de ce qui est montré : les graphes sans leurs positions (déplacer un bloc ne change pas ce qui part). */
const empreinteDe = (r: Releve): string => sha256Hex(canonique({
  actions: r.gardees.map((g) => (g.type === 'repondeur' ? g : { ...g, graphe: sansPositions(g.graphe) })),
  contexte: r.contexte,
}));

const demandeDe = (g: ActionGardee): DemandeAction => {
  switch (g.type) {
    case 'publier': return { type: 'publier', scenario: g.scenario };
    case 'restaurer': return { type: 'restaurer', scenario: g.scenario, version: g.version };
    case 'repondeur': return { type: 'repondeur', scenario: g.scenario, delaiHeures: g.delaiS / 3600 };
  }
};

/** Le bouton nomme l'effet (décision du 24 novembre) : « Activer sur WhatsApp » dès que le parcours répondra. */
export function libelleDe(gardees: readonly ActionGardee[]): string {
  if (gardees.some((g) => g.type === 'repondeur')) return 'Activer sur WhatsApp';
  const seule = gardees.length === 1 ? gardees[0] : undefined;
  if (seule?.type === 'restaurer') return `Restaurer la version ${seule.version}`;
  return 'Publier les modifications';
}

const blocs = (g: WorkflowGraph): string => `${g.nodes.length} bloc${g.nodes.length > 1 ? 's' : ''}`;
const heures = (s: number): string => {
  const h = s / 3600;
  return h >= 48 && h % 24 === 0 ? `${h / 24} jours` : `${h} heure${h > 1 ? 's' : ''}`;
};
const jour = (iso: string): string => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

/** Qui répond au client aujourd'hui, en mots : le récapitulatif dit ce que le clic remplace. */
async function repondeurActuel(deps: DepsMisesEnLigne, tenant: string): Promise<string> {
  const r = await deps.repondeur.reglages.get(tenant);
  switch (r.repondeurMode) {
    case 'agent': {
      const a = r.repondeurAgentId === null ? null : await deps.repondeur.agents.complet(tenant, r.repondeurAgentId);
      return a ? `l’agent IA « ${a.label} »` : 'un agent IA';
    }
    case 'scenario': {
      const wf = r.repondeurWorkflowId === null ? null : await deps.scenarios.getById(r.repondeurWorkflowId, tenant);
      return wf && wf.rayon === 'general' ? `le scénario « ${wf.name} »` : 'un scénario';
    }
    case 'mba': return 'l’agent de Meta';
    case 'application': return 'votre application';
    case 'equipe': return 'l’équipe';
  }
}

async function recapitulatifDe(deps: DepsMisesEnLigne, tenant: string, gardees: readonly ActionGardee[]): Promise<string[]> {
  const lignes: string[] = [];
  for (const g of gardees) {
    switch (g.type) {
      case 'publier':
        lignes.push(`Le scénario « ${g.nom} » est publié tel qu’il a été préparé (${blocs(g.graphe)}).`);
        break;
      case 'restaurer':
        lignes.push(`Le scénario « ${g.nom} » revient à sa version ${g.version}, publiée le ${jour(g.publieeLe)} (${blocs(g.graphe)}).`);
        break;
      case 'repondeur':
        lignes.push(`Le scénario « ${g.nom} » répond à qui vous écrit sur WhatsApp sans être déjà pris en charge, au plus une `
          + `fois toutes les ${heures(g.delaiS)} par contact. Aujourd’hui, c’est ${await repondeurActuel(deps, tenant)} qui répond.`);
        break;
    }
  }
  return lignes;
}

export function vueDe(l: LigneMiseEnLigne): VueMiseEnLigne {
  const etat: EtatVue = l.etat === 'proposee' ? (l.expiree ? 'expiree' : 'proposee')
    : l.etat === 'acceptee' ? (l.enCours ? 'en_cours' : 'interrompue')
      : l.etat;
  return {
    id: l.id,
    libelle: l.libelle,
    recapitulatif: l.recapitulatif,
    etat,
    expireLe: l.expireLe,
    accepteeLe: l.accepteeLe,
    termineeLe: l.termineeLe,
    actions: l.actions.map((a, i) => ({
      type: a.type, scenario: a.scenario, nom: a.nom, ...(a.type === 'restaurer' ? { version: a.version } : {}), resultat: l.resultat[i] ?? null,
    })),
  };
}

/**
 * Prépare une mise en ligne et la garde, sans rien publier ni brancher. `personne` : celle du jeton OAuth (le CSM agit
 * en son nom) et l'accès par lequel elle l'a fait.
 */
export async function proposer(
  deps: DepsMisesEnLigne, tenant: string, personne: { userId: string; autorisationId: string | null }, demandes: readonly DemandeAction[],
): Promise<Issue<VueMiseEnLigne>> {
  const r = await relever(deps, tenant, demandes);
  if (!r.ok) return r;
  const { gardees } = r.valeur;
  const { id } = await deps.store.inserer(tenant, {
    proposeePar: personne.userId,
    autorisationId: personne.autorisationId,
    libelle: libelleDe(gardees),
    recapitulatif: await recapitulatifDe(deps, tenant, gardees),
    actions: gardees,
    empreinte: empreinteDe(r.valeur),
    expireLe: new Date(deps.maintenant() + DUREE_MISE_EN_LIGNE_MS),
  });
  return lireVue(deps, tenant, id);
}

/** Une mise en ligne de l'espace, telle que la page et l'outil la montrent. */
export async function lireVue(deps: Pick<DepsMisesEnLigne, 'store'>, tenant: string, id: string): Promise<Issue<VueMiseEnLigne>> {
  if (!estUuid(id)) return refus(404, INCONNUE);
  const l = await deps.store.lire(tenant, id);
  return l ? { ok: true, valeur: vueDe(l) } : refus(404, INCONNUE);
}

/**
 * 🔴 LE CLIC D'UN ADMIN (la route de la console, jamais un outil MCP). Proposée : relit l'état, recalcule l'empreinte et
 * accepte en une requête, puis exécute. Acceptée et interrompue : reprend. Faite ou échouée : rend le résultat, sans
 * rien refaire.
 */
export async function accepter(deps: DepsMisesEnLigne, tenant: string, id: string, admin: { userId: string }): Promise<Issue<VueMiseEnLigne>> {
  if (!estUuid(id)) return refus(404, INCONNUE);
  const l = await deps.store.lire(tenant, id);
  if (!l) return refus(404, INCONNUE);
  if (l.etat === 'proposee') {
    if (l.expiree) return refus(409, EXPIREE, { code: 'expiree' });
    const r = await relever(deps, tenant, l.actions.map(demandeDe));
    if (!r.ok) {
      return refus(409, `ce qui vous a été montré n’est plus possible : ${r.erreur}. Demandez à Claude de préparer à nouveau la mise en ligne.`, { code: 'impossible' });
    }
    const issue = await deps.store.accepter(tenant, id, admin.userId, empreinteDe(r.valeur));
    if (issue === 'inconnue') return refus(404, INCONNUE);
    if (issue === 'expiree') return refus(409, EXPIREE, { code: 'expiree' });
    if (issue === 'modifiee') return refus(409, MODIFIEE, { code: 'modifiee' });
    if (issue === 'ok') {
      await makeJournal(deps.audit)(tenant, { auth: admin }, 'mise_en_ligne.acceptee', { kind: 'mise_en_ligne', id }, {
        libelle: l.libelle, actions: l.actions.length,
      });
    }
    // `deja` : un autre clic est passé entre la lecture et l'acceptation ; on rejoint son exécution.
  }
  await executer(deps, tenant, id);
  return lireVue(deps, tenant, id);
}

/**
 * Exécute les actions qui restent, dans l'ordre, sous le bail. Une action refusée arrête tout (`echouee`) ; une panne
 * rend le bail et laisse la mise en ligne acceptée, à reprendre. Rien n'est fait sans le bail.
 */
async function executer(deps: DepsMisesEnLigne, tenant: string, id: string): Promise<void> {
  const jeton = randomUUID();
  const prise = await deps.store.reclamer(tenant, id, jeton, BAIL_EXECUTION_S);
  if (!prise) return;
  const journal = makeJournal(deps.audit);
  const auteur = { auth: { userId: prise.accepteePar } };
  const echouer = async (index: number, code: string): Promise<void> => {
    if (await deps.store.terminer(tenant, id, jeton, 'echouee')) {
      await journal(tenant, auteur, 'mise_en_ligne.echouee', { kind: 'mise_en_ligne', id }, { action: index + 1, code });
    }
  };
  // 🔴 Une exécution coupée APRÈS avoir noté un refus, avant de conclure : la reprise conclut sur ce refus, elle ne repart
  // jamais après lui (le répondeur se brancherait sur une publication refusée).
  const refusee = prise.resultat.findIndex((r) => !r.ok);
  if (refusee !== -1) {
    const r = prise.resultat[refusee]!;
    await echouer(refusee, r.ok ? 'refus' : r.code);
    return;
  }
  if (!prise.clicValide || !prise.accesValide) {
    const r: ResultatAction = { ok: false, code: 'acces_revoque', message: prise.clicValide ? ACCES_REVOQUE : CLIC_RETIRE };
    if (await deps.store.noterResultat(tenant, id, jeton, r, BAIL_EXECUTION_S)) await echouer(prise.resultat.length, r.code);
    return;
  }
  for (let i = prise.resultat.length; i < prise.actions.length; i++) {
    let r: ResultatAction;
    try {
      r = await executerAction(deps, tenant, prise.actions[i]!, auteur);
    } catch (err) {
      // Une panne n'est pas un refus : le bail se rend, la mise en ligne reste acceptée, un admin la reprend.
      journaliser('error', 'mise_en_ligne_interrompue', { tenantId: tenant, id, action: i + 1, erreur: err instanceof Error ? err.message : String(err) });
      await deps.store.relacher(tenant, id, jeton);
      return;
    }
    if (!(await deps.store.noterResultat(tenant, id, jeton, r, BAIL_EXECUTION_S))) return;
    if (!r.ok) {
      await echouer(i, r.code);
      return;
    }
  }
  if (await deps.store.terminer(tenant, id, jeton, 'faite')) {
    await journal(tenant, auteur, 'mise_en_ligne.faite', { kind: 'mise_en_ligne', id }, { actions: prise.actions.length });
  }
}

async function executerAction(
  deps: DepsMisesEnLigne, tenant: string, a: ActionGardee, auteur: { auth: { userId: string } },
): Promise<ResultatAction> {
  if (a.type === 'repondeur') {
    const r = await choisirRepondeur(deps.repondeur, tenant, { mode: 'scenario', workflowId: a.scenario, delaiS: a.delaiS },
      { userId: auteur.auth.userId, origine: 'mcp' });
    if (!r.ok) return { ok: false, code: typeof r.details?.code === 'string' ? r.details.code : `refus_${r.statut}`, message: r.erreur };
    return { ok: true, etat: 'branche' };
  }
  const avant = await deps.scenarios.getById(a.scenario, tenant);
  if (!avant || avant.rayon !== 'general') return { ok: false, code: 'not_found', message: `le scénario « ${a.nom} » n’existe plus` };
  const issue = await publierScenario({ scenarios: deps.scenarios, publication: deps.publication, journal: makeJournal(deps.audit) }, tenant, avant, a.graphe, auteur);
  if (issue.type === 'refus') return { ok: false, code: issue.code ?? `refus_${issue.statut}`, message: issue.message };
  return { ok: true, etat: issue.type === 'programme' ? 'programme' : 'publie' };
}
