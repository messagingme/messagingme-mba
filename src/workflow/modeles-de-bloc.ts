import type { WorkflowGraph } from './graph';
import { grapheEditable, type PgWorkflowStore, type Programmation } from './store.pg';
import { RAISON_MAX, type LigneModeleDeBloc, type PgModelesDeBloc } from './modeles-de-bloc.pg';
import { controlesDePublication } from './publication';
import type { Rayon } from './rayon';
import { creerUnModele, type DepsGestionModeles } from '../templates/gestion';
import { lireCreationDeModele } from '../templates/corps';
import type { TemplateButton } from '../meta/templates';
import type { Emission } from '../emails-produit/emission';
import type { AuditSink } from '../audit/journal';
import { journaliser } from '../lib/journal';
import { messageDe, texteDe } from '../lib/erreur';

/**
 * Les templates écrits ou modifiés depuis un bloc du constructeur (menu « Scénario », lot 3, spec
 * `docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md`, décisions 18, 19 et 27). Une ligne de
 * `modeles_de_bloc` (migration 0296) par template créé ainsi : la marque « créé par le builder » et son état tranché par
 * Meta. `etat` n'avance qu'une fois (`en_validation` vers `approuve` ou `refuse`) : le statut rejoué par Meta et le filet
 * ne trouvent plus rien à trancher.
 */
export const ETATS_MODELE_DE_BLOC = ['en_validation', 'approuve', 'refuse'] as const;
export type EtatModeleDeBloc = (typeof ETATS_MODELE_DE_BLOC)[number];

/** La longueur gardée du nom du scénario dans celui du template : assez pour le retrouver dans Contenu > Templates. */
const BASE_MAX = 40;

/**
 * 🔴 LE NOM D'UN TEMPLATE DE BLOC NAÎT ICI, CÔTÉ SERVEUR (décision 19), jamais dans le corps reçu : sinon un client ferait
 * passer pour « créé par le builder » un template qui n'est pas le sien. Le nom du scénario ramené à l'alphabet de Meta
 * (`[a-z0-9_]`, accents retirés, 40 caractères au plus, `scenario` s'il ne reste rien), puis l'horodatage en base 36 :
 * un nom neuf à chaque fois, et jamais le réemploi d'un nom supprimé (bloqué 30 jours chez Meta).
 */
export function nomDuModeleDeBloc(nomScenario: string, maintenant: Date): string {
  const base = nomScenario.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+/, '').slice(0, BASE_MAX).replace(/_+$/, '');
  return `${base || 'scenario'}_${maintenant.getTime().toString(36)}`;
}

/**
 * Les templates (nom, langue) que les blocs d'un graphe envoient, sans doublon. Même lecture que le moteur
 * (`actionOf`, `src/workflow/engine.ts`) : un bloc `template` sans nom n'envoie rien, la langue vaut `fr` par défaut.
 */
export function modelesDuGraphe(g: WorkflowGraph): Array<{ modele: string; langue: string }> {
  const vus = new Map<string, { modele: string; langue: string }>();
  for (const n of g.nodes) {
    if (n.type !== 'template') continue;
    const modele = String(n.data.templateName ?? '').trim();
    if (!modele) continue;
    const langue = String(n.data.language ?? 'fr');
    vus.set(`${modele}|${langue}`, { modele, langue });
  }
  return [...vus.values()];
}

/** Ce dont la création d'un template de bloc a besoin. */
export interface DepsCreationDeBloc {
  gestion: DepsGestionModeles;
  scenarios: Pick<PgWorkflowStore, 'getById'>;
  lignes: Pick<PgModelesDeBloc, 'inserer'>;
  maintenant: () => Date;
}

export type IssueCreationDeBloc =
  | { ok: true; modele: string; langue: string; etat: EtatModeleDeBloc; categorie: string | null; boutons: TemplateButton[] }
  | { ok: false; statut: 400 | 404 | 422; erreur: string };

/** Ce qui ne s'écrit pas dans un bloc (décision 27) : la phrase dit où le faire. */
const HORS_DU_BLOC = {
  carousel: 'Un carousel se crée dans Contenu > Templates, puis se choisit dans la liste du bloc.',
  media: 'Un en-tête image, vidéo ou document se crée dans Contenu > Templates, puis se choisit dans la liste du bloc.',
} as const;

const etatDeMeta = (statut: string): EtatModeleDeBloc => {
  const s = statut.toUpperCase();
  return s === 'APPROVED' ? 'approuve' : s === 'REJECTED' ? 'refuse' : 'en_validation';
};

/**
 * Écrire un template depuis un bloc : le bloc doit exister dans le graphe que l'éditeur ouvre (le brouillon s'il
 * existe) et envoyer un template ; le corps se valide comme dans l'écran Templates (`lireCreationDeModele`), sous un nom
 * généré ici ; la création passe par `creerUnModele`, chemin unique (liens tracés, champs d'adresse, indices). La ligne
 * s'insère APRÈS l'accord de Meta : une création refusée n'en laisse aucune. Le bloc, lui, est patché par la console.
 */
export async function creerModeleDuBloc(
  deps: DepsCreationDeBloc,
  tenantId: string,
  e: { workflowId: string; nodeId: string; corps: Record<string, unknown>; par: string | null },
): Promise<IssueCreationDeBloc> {
  const scenario = await deps.scenarios.getById(e.workflowId, tenantId);
  if (!scenario) return { ok: false, statut: 404, erreur: 'scénario inconnu' };
  const bloc = grapheEditable(scenario).nodes.find((n) => n.id === e.nodeId);
  if (!bloc) return { ok: false, statut: 404, erreur: 'bloc inconnu : enregistrez le scénario, puis réessayez' };
  if (bloc.type !== 'template') return { ok: false, statut: 400, erreur: 'ce bloc n’envoie pas de template' };

  if (e.corps.carousel !== undefined && e.corps.carousel !== null) return { ok: false, statut: 400, erreur: HORS_DU_BLOC.carousel };
  const format = (e.corps.header as { format?: unknown } | null | undefined)?.format;
  if (format === 'IMAGE' || format === 'VIDEO' || format === 'DOCUMENT') return { ok: false, statut: 400, erreur: HORS_DU_BLOC.media };

  const nom = nomDuModeleDeBloc(scenario.name, deps.maintenant());
  const lu = await lireCreationDeModele(deps.gestion, tenantId, e.corps, nom);
  if ('error' in lu) return { ok: false, statut: 400, erreur: lu.error };

  const issue = await creerUnModele(deps.gestion, tenantId, lu.entree, lu.sources);
  if (!('res' in issue)) {
    const erreur = issue.motif === 'compte'
      ? 'Cet espace n’a pas de compte WhatsApp Business relié à Meta : un template ne peut pas s’y créer.'
      : issue.error;
    return { ok: false, statut: issue.statut, erreur };
  }
  const etat = etatDeMeta(issue.res.status);
  await deps.lignes.inserer(tenantId, { workflowId: e.workflowId, modele: nom, langue: lu.entree.language, etat, par: e.par });
  return {
    ok: true, modele: nom, langue: lu.entree.language, etat,
    categorie: issue.res.category ?? null,
    boutons: lu.entree.buttons ?? [],
  };
}

/**
 * ─── Publier ou programmer, et la mise en ligne à l'approbation (décision 18) ───
 *
 * « Publier » pendant la validation d'un template de bloc programme la mise en ligne ; elle se fait à la DERNIÈRE
 * approbation, jamais sous une campagne active (le marchand n'est pas là pour en voir l'effet : une publication à la main
 * reste libre, comme aujourd'hui), et un e-mail dit « en ligne » ou « refusé ». Seuls les templates écrits depuis un bloc
 * (une ligne de `modeles_de_bloc`) sont jugés : un scénario qui n'en a pas se publie exactement comme avant, sans aucune
 * lecture de Meta.
 */

/** Une version programmée, avec ce qu'il faut pour la juger et la dire. */
export type ProgrammationDeScenario = Programmation & { id: string; nom: string; rayon: Rayon };

/** Ce dont la mise en ligne et le tranchage d'un statut ont besoin (le worker, qui reçoit le statut, ne relit rien). */
export interface DepsMiseEnLigne {
  lignes: Pick<PgModelesDeBloc, 'desModeles' | 'trancher' | 'rehabiliter'>;
  scenarios: Pick<
    PgWorkflowStore,
    'lanceursDuScenario' | 'list' | 'programmeesDeLEspace' | 'mettreEnLigneLaVersionProgrammee' | 'annulerProgrammation'
  >;
  emails: { emettre(e: Emission): Promise<unknown> };
  audit: AuditSink;
  /** L'adresse du scénario dans la console (`/workflows?open=<id>`), que les e-mails donnent. */
  lienScenario(workflowId: string): string;
}

/** Ce dont le jugement de « Publier » et le filet ont besoin en plus : relire chez Meta, et les lectures transverses. */
export interface DepsPublication extends DepsMiseEnLigne {
  lignes: Pick<PgModelesDeBloc, 'desModeles' | 'trancher' | 'rehabiliter' | 'attentesAnciennes'>;
  scenarios: DepsMiseEnLigne['scenarios'] & Pick<PgWorkflowStore, 'programmeesAnciennes'>;
  /** Le statut d'un template relu chez Meta, hors de tout cache ; null quand il est illisible. */
  statutModele(tenantId: string, modele: string, langue: string): Promise<{ statut: string; raison: string | null } | null>;
}

/** Le statut d'un modèle tel que la file des webhooks le lit. */
export interface StatutDeModele { modele: string; langue: string; statut: string; raison: string | null }

/**
 * Le statut d'un modèle tranché par Meta, pour chacun de ses consommateurs du worker (l'assistant Shopify, les templates
 * de bloc du constructeur), chacun dans sa propre capture : l'échec de l'un ne saute jamais l'autre.
 */
export function surStatutDesModeles(
  consommateurs: ReadonlyArray<{ nom: string; traiter(tenantId: string, s: StatutDeModele): Promise<unknown> }>,
): (tenantId: string, s: StatutDeModele) => Promise<void> {
  return async (tenantId, s) => {
    for (const c of consommateurs) {
      try {
        await c.traiter(tenantId, s);
      } catch (err) {
        journaliser('warn', 'statut_modele_en_echec', { tenantId, consommateur: c.nom, erreur: texteDe(err).slice(0, 200) });
      }
    }
  };
}

export type JugementDePublication =
  | { type: 'publier' }
  | { type: 'programmer'; attend: Array<{ modele: string; langue: string }> }
  | { type: 'refus'; code: 'modele_refuse' | 'campagne_active'; erreur: string };

/** Ce qu'un statut de Meta tranche ; null : il ne tranche rien (en validation, en pause, désactivé…). */
const etatTranche = (statut: string): 'approuve' | 'refuse' | null => {
  const s = statut.toUpperCase();
  return s === 'APPROVED' ? 'approuve' : s === 'REJECTED' ? 'refuse' : null;
};

const raisonDe = (l: LigneModeleDeBloc): string => `Meta a refusé le template « ${l.modele} » (raison : ${l.raison ?? 'non précisée'})`;

/**
 * Les lignes des templates de bloc qu'un graphe envoie : celles en validation relues chez Meta et tranchées, et celles
 * REFUSÉES relues aussi (relecture de 3a) : Meta a pu les approuver depuis (un appel, une correction), et le refus ne doit
 * pas rester gravé.
 */
async function lignesRelues(deps: DepsPublication, tenantId: string, g: WorkflowGraph): Promise<LigneModeleDeBloc[]> {
  const paires = modelesDuGraphe(g);
  if (paires.length === 0) return [];
  const lignes = await deps.lignes.desModeles(tenantId, paires);
  return Promise.all(lignes.map(async (l) => {
    if (l.etat === 'approuve') return l;
    const s = await deps.statutModele(tenantId, l.modele, l.langue).catch(() => null);
    const etat = s ? etatTranche(s.statut) : null;
    if (!s || !etat) return l;
    if (l.etat === 'refuse') {
      if (etat !== 'approuve') return l;
      return (await deps.lignes.rehabiliter(tenantId, l.modele, l.langue)) ?? { ...l, etat, raison: null };
    }
    // Un autre passage a pu trancher entre-temps (statut, filet) : l'état de Meta fait foi pour ce jugement.
    return (await deps.lignes.trancher(tenantId, l.modele, l.langue, etat, s.raison)) ?? { ...l, etat, raison: s.raison };
  }));
}

/**
 * Le jugement de « Publier » sur le brouillon : publier (rien n'attend Meta), programmer (un template de bloc est encore
 * en validation après relecture), ou refuser (un template refusé ; ou une campagne active, sous laquelle aucune mise en
 * ligne ne se programme). La relecture ne fait que trancher les lignes : elle n'envoie aucun e-mail et ne met rien en
 * ligne ailleurs. Le statut de Meta qui arrive ensuite ne trouve plus rien à trancher : une AUTRE version programmée qui
 * nomme ce template part au passage suivant du filet (dix minutes, vingt au plus), pas avant.
 */
export async function jugerPublication(
  deps: DepsPublication, tenantId: string, workflowId: string, brouillon: WorkflowGraph,
): Promise<JugementDePublication> {
  const lignes = await lignesRelues(deps, tenantId, brouillon);
  const refuse = lignes.find((l) => l.etat === 'refuse');
  if (refuse) return { type: 'refus', code: 'modele_refuse', erreur: `${raisonDe(refuse)} : écrivez-en un autre dans le bloc, ou choisissez un template approuvé.` };
  const attend = lignes.filter((l) => l.etat === 'en_validation').map(({ modele, langue }) => ({ modele, langue }));
  if (attend.length === 0) return { type: 'publier' };
  const campagne = (await deps.scenarios.lanceursDuScenario(tenantId, workflowId)).find((l) => l.type === 'campagne');
  if (campagne) {
    return {
      type: 'refus', code: 'campagne_active',
      erreur: `la campagne « ${campagne.nom} » utilise ce scénario : sa mise en ligne ne peut pas se programmer pendant la validation de Meta. Publiez une fois le template approuvé.`,
    };
  }
  return { type: 'programmer', attend };
}

export type IssueMiseEnLigne = 'rien' | 'attend_modeles' | 'attend_campagne' | 'annulee' | 'en_ligne';

/** Annule À SA DATE et le dit ; rien si une publication explicite ou une programmation plus récente est passée. */
async function annulerEtDire(deps: DepsMiseEnLigne, tenantId: string, p: ProgrammationDeScenario, raison: string): Promise<boolean> {
  if (!(await deps.scenarios.annulerProgrammation(p.id, tenantId, p.le))) return false;
  await deps.emails.emettre({
    cle: 'scenario_programme_refuse', tenantId, a: 'admins', occasion: `${p.id}:${p.le}`,
    valeurs: { scenario: p.nom, raison: raison.slice(0, RAISON_MAX), lien_scenario: deps.lienScenario(p.id) },
  }).catch(() => undefined);
  journaliser('info', 'scenario_programmation_annulee', { tenantId, workflowId: p.id });
  return true;
}

/**
 * Tente la mise en ligne d'une version programmée : un template refusé l'annule (e-mail « refusé ») ; un template en
 * validation ou une campagne active la fait attendre (le filet la retente) ; les contrôles de publication se rejouent
 * (un « Aller à » a pu perdre sa cible) ; sinon elle part, À SA DATE, et l'e-mail « en ligne » le dit, une fois.
 */
export async function tenterMiseEnLigne(deps: DepsMiseEnLigne, tenantId: string, p: ProgrammationDeScenario): Promise<IssueMiseEnLigne> {
  const lignes = await deps.lignes.desModeles(tenantId, modelesDuGraphe(p.graphe));
  const refuse = lignes.find((l) => l.etat === 'refuse');
  if (refuse) return (await annulerEtDire(deps, tenantId, p, raisonDe(refuse))) ? 'annulee' : 'rien';
  if (lignes.some((l) => l.etat === 'en_validation')) return 'attend_modeles';
  if ((await deps.scenarios.lanceursDuScenario(tenantId, p.id)).some((l) => l.type === 'campagne')) return 'attend_campagne';
  const controle = await controlesDePublication(p.graphe, p.id, () => deps.scenarios.list(tenantId, p.rayon));
  if (controle) return (await annulerEtDire(deps, tenantId, p, controle.message)) ? 'annulee' : 'rien';

  const row = await deps.scenarios.mettreEnLigneLaVersionProgrammee(p.id, tenantId, p.le);
  if (!row) return 'rien';
  try {
    await deps.audit(tenantId, { userId: p.par, email: null }, 'workflow.published', { kind: 'workflow', id: p.id }, { blocs: row.graph.nodes.length, programmee: true });
  } catch (err) {
    journaliser('warn', 'scenario_programme_journal_echoue', { tenantId, workflowId: p.id, err: messageDe(err) });
  }
  await deps.emails.emettre({
    cle: 'scenario_programme_en_ligne', tenantId, a: 'admins', occasion: `${p.id}:${p.le}`,
    valeurs: { scenario: p.nom, lien_scenario: deps.lienScenario(p.id) },
  }).catch(() => undefined);
  journaliser('info', 'scenario_programme_en_ligne', { tenantId, workflowId: p.id });
  return 'en_ligne';
}

/**
 * Le statut d'un template tranché par Meta (le worker, depuis la file des webhooks ; le filet, depuis l'API) : la ligne
 * se tranche UNE fois, puis chaque version programmée de l'espace qui nomme ce template tente sa mise en ligne. Un
 * statut rejoué ne trouve plus rien à trancher : ni mise en ligne ni e-mail de plus. Une mise en ligne qui lève
 * n'empêche pas les suivantes.
 */
export async function trancherModeleDeBloc(
  deps: DepsMiseEnLigne, tenantId: string, s: { modele: string; langue: string; statut: string; raison: string | null },
): Promise<'approuve' | 'refuse' | 'rien'> {
  const etat = etatTranche(s.statut);
  if (!etat) return 'rien';
  const ligne = await deps.lignes.trancher(tenantId, s.modele, s.langue, etat, s.raison);
  if (!ligne) {
    // Approuvé après un refus (un appel gagné) : la ligne redevient approuvée. Aucune programmation ne l'attend (un refus
    // les a annulées, et « Publier » ne programme pas sur un template refusé) : rien à mettre en ligne.
    if (etat === 'approuve' && (await deps.lignes.rehabiliter(tenantId, s.modele, s.langue))) return 'approuve';
    return 'rien';
  }
  for (const p of await deps.scenarios.programmeesDeLEspace(tenantId)) {
    if (!modelesDuGraphe(p.graphe).some((m) => m.modele === s.modele && m.langue === s.langue)) continue;
    try {
      await tenterMiseEnLigne(deps, tenantId, p);
    } catch (err) {
      journaliser('error', 'scenario_programme_mise_en_ligne_echouee', { tenantId, workflowId: p.id, err: messageDe(err) });
    }
  }
  return etat;
}

/**
 * Le filet, au cas où un statut ne serait jamais arrivé : les templates de bloc encore en validation depuis plus de
 * `minutes` se relisent chez Meta, puis les versions programmées depuis plus de `minutes` se retentent (celle qui
 * attendait la fin d'une campagne part ici). Rend le nombre de tranchages et de mises en ligne.
 */
export async function relireModelesDeBloc(deps: DepsPublication, minutes: number, limite: number): Promise<number> {
  let faits = 0;
  for (const a of await deps.lignes.attentesAnciennes(minutes, limite)) {
    const s = await deps.statutModele(a.tenantId, a.modele, a.langue).catch(() => null);
    if (s === null) continue;
    if ((await trancherModeleDeBloc(deps, a.tenantId, { modele: a.modele, langue: a.langue, ...s })) !== 'rien') faits += 1;
  }
  for (const p of await deps.scenarios.programmeesAnciennes(minutes, limite)) {
    try {
      if ((await tenterMiseEnLigne(deps, p.tenantId, p)) === 'en_ligne') faits += 1;
    } catch (err) {
      journaliser('error', 'scenario_programme_filet_echoue', { tenantId: p.tenantId, workflowId: p.id, err: messageDe(err) });
    }
  }
  return faits;
}
