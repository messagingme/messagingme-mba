import { journaliser } from '../lib/journal';
import { messageDe } from '../lib/erreur';
import type { TemplateSummary } from '../meta/templates';
import type { UserFieldDef } from '../crm/types';
import type { WorkflowGraph } from '../workflow/graph';
import type { PgWorkflowStore } from '../workflow/store.pg';
import type { WorkflowExecutor } from '../workflow/executor';
import { modeleDOuverture } from '../workflow/ouverture-api';
import type { EtatLigneHubspot } from '../http/hubspot-conversation';
import { grapheDUneLigne } from '../shopify/lignes-gestion';
import { blocVerrouille, premierBloc, type LecturesPremierBloc } from '../shopify/premier-bloc';
import { prefixeHubspot } from './origine';
import type { PgLignesHubspot } from './lignes.pg';
import {
  lireConfig, nomParDefaut,
  type ConfigEtape, type ConfigRdv, type FamilleLigneHubspot, type LigneHubspot, type LigneHubspotVue,
} from './lignes';

/**
 * LES LIGNES HUBSPOT, CÔTÉ GESTION (menu « Scénario », lot 6b, tâche 4) : la porte des routes de l'écran Automation >
 * HubSpot, au modèle des lignes Shopify (`src/shopify/lignes-gestion.ts`).
 *
 * 🔴 UNE LIGNE NAÎT ÉTEINTE, AVEC SON SCÉNARIO DU RAYON `hubspot`, PUBLIÉ TOUT DE SUITE. Étape et rendez-vous : un seul
 * bloc, le template VERROUILLÉ (marqué par le serveur, décisions 13 et 23), que leur circuit envoie. Lancé par un workflow :
 * un bloc template NON marqué, le scénario partant comme aujourd'hui (`{ scenario }`, décision 41). Elle ne s'allume qu'avec
 * son premier template publié (`a_completer`). Éteindre ou supprimer une ligne d'étape ou de rendez-vous arrête ses
 * parcours, par le préfixe de son origine, au mieux.
 */

export interface DepsLignesHubspot {
  /** Le magasin des lignes, ENTIER (ses méthodes lisent `this`). */
  lignes: Pick<PgLignesHubspot, 'lister' | 'lire' | 'creer' | 'etapeReglee' | 'allumer' | 'supprimer'>;
  /** Le magasin des scénarios, ENTIER. */
  workflows: Pick<PgWorkflowStore, 'insert' | 'publish' | 'getById' | 'publicationProgrammee'>;
  /** Les indices des templates (`template_param_hints`), ENTIERS : ce que lit le premier bloc. */
  indices: LecturesPremierBloc['indices'];
  /** L'exécuteur des parcours, ENTIER. */
  parcours: Pick<WorkflowExecutor, 'arreterParcours'>;
  /** Les templates de l'espace chez Meta (`listerModeles`) : le statut du premier template. */
  modeles(tenantId: string): Promise<readonly TemplateSummary[]>;
  /** Les champs déclarés dans l'espace : un rendez-vous ne lit qu'une propriété date et heure importée de HubSpot. */
  champs(tenantId: string): Promise<ReadonlyArray<Pick<UserFieldDef, 'key' | 'type'>>>;
  /** Les interrupteurs de Tools > Intégrations > HubSpot (`lireChoixHubspot`), relus à chaque lecture. */
  choix(tenantId: string): Promise<{ automations: boolean; workflows: boolean }>;
  /** La synchro HubSpot du numéro de l'espace (`etatLigneHubspot`). */
  ligneHubspot(tenantId: string): Promise<EtatLigneHubspot>;
}

export type Refus = { ok: false; statut: 400 | 404 | 409; message: string; code?: string };
export type Issue<T> = { ok: true; valeur: T } | Refus;
const refus = (statut: Refus['statut'], message: string, code?: string): Refus => ({ ok: false, statut, message, ...(code ? { code } : {}) });

export const REFUS_LIGNE_INCONNUE = 'Cette ligne n’existe plus : rechargez la page.';
export const REFUS_A_COMPLETER = 'Écrivez d’abord le premier message de ce scénario (un template), publiez-le, puis allumez la ligne.';
export const REFUS_A_COMPLETER_WORKFLOW = 'Publiez d’abord ce scénario, ouvert par un template, puis allumez la ligne.';

/** Le graphe d'un scénario lancé par un workflow : un bloc template à écrire, NON marqué (décision 41). */
function grapheLibre(): WorkflowGraph {
  return { nodes: [{ id: 'depart', type: 'template', position: { x: 0, y: 0 }, data: {} }], edges: [] };
}

/** Les templates de l'espace chez Meta, ou `null` quand la liste ne se lit pas (journalisé, jamais levé). */
async function lireModeles(deps: DepsLignesHubspot, tenantId: string): Promise<readonly TemplateSummary[] | null> {
  try {
    return await deps.modeles(tenantId);
  } catch (err) {
    journaliser('warn', 'hubspot_liste_modeles_illisible', { tenantId, erreur: messageDe(err) });
    return null;
  }
}

/** Le premier template d'un graphe PUBLIÉ : le bloc verrouillé, ou le modèle d'ouverture d'un scénario de workflow. */
function premierModele(famille: FamilleLigneHubspot, graphe: WorkflowGraph): { nom: string; langue: string } | null {
  if (famille === 'workflow') {
    const o = modeleDOuverture(graphe);
    return o !== null && o.templateName.trim() !== '' ? { nom: o.templateName.trim(), langue: o.language } : null;
  }
  const bloc = blocVerrouille(graphe);
  const nom = typeof bloc?.data.templateName === 'string' ? bloc.data.templateName.trim() : '';
  return nom === '' ? null : { nom, langue: String(bloc?.data.language ?? 'fr') };
}

async function vueDe(deps: DepsLignesHubspot, tenantId: string, l: LigneHubspot, modeles: readonly TemplateSummary[]): Promise<LigneHubspotVue> {
  const wf = await deps.workflows.getById(l.workflowId, tenantId);
  // `getById` ignore le rayon : un scénario d'un autre rayon sous cet identifiant n'est pas celui de la ligne.
  const duRayon = wf !== null && wf.rayon === 'hubspot' ? wf : null;
  const ouvre = duRayon === null ? null : premierModele(l.famille, duRayon.graph);
  const tpl = ouvre === null ? undefined : modeles.find((t) => t.name === ouvre.nom && t.language === ouvre.langue);
  return {
    id: l.id, famille: l.famille, config: l.config, actif: l.actif, workflowId: l.workflowId,
    scenario: duRayon?.name ?? null, modele: ouvre?.nom ?? null, langue: ouvre?.langue ?? null, etatChezMeta: tpl?.status ?? null,
    blocs: duRayon?.graph.nodes.length ?? 0,
    versionProgrammee: duRayon !== null && (await deps.workflows.publicationProgrammee(duRayon.id, tenantId)) !== null,
  };
}

/** Les parcours d'une ligne s'arrêtent par le préfixe de leur origine, au mieux : une panne se journalise, le geste passe. */
async function arreterLesParcours(deps: DepsLignesHubspot, tenantId: string, l: LigneHubspot, motif: string): Promise<void> {
  if (l.famille === 'workflow') return;
  try {
    await deps.parcours.arreterParcours(tenantId, { prefixe: prefixeHubspot(l.famille, l.id) }, motif);
  } catch (err) {
    journaliser('error', 'hubspot_arret_parcours_en_echec', { tenantId, motif, erreur: messageDe(err) });
  }
}

export interface EtatDesLignes {
  connecte: boolean;
  /** L'interrupteur « Automations HubSpot » est éteint : ni étape ni rendez-vous ne part. */
  automationsCoupees: boolean;
  /** L'interrupteur « Workflows » est éteint : l'action d'un workflow ne lance rien. */
  workflowsCoupes: boolean;
  lignes: LigneHubspotVue[];
}

export async function etatDesLignes(deps: DepsLignesHubspot, tenantId: string): Promise<EtatDesLignes> {
  const [lignes, choix, ligne] = await Promise.all([deps.lignes.lister(tenantId), deps.choix(tenantId), deps.ligneHubspot(tenantId)]);
  // Illisible chez Meta : les lignes se lisent quand même, sans l'état de leur template.
  const modeles = lignes.length === 0 ? [] : ((await lireModeles(deps, tenantId)) ?? []);
  const vues: LigneHubspotVue[] = [];
  for (const l of lignes) vues.push(await vueDe(deps, tenantId, l, modeles));
  return { connecte: ligne === 'reliee', automationsCoupees: !choix.automations, workflowsCoupes: !choix.workflows, lignes: vues };
}

/**
 * Une ligne neuve et son scénario, ÉTEINTE. Une étape déjà réglée (même paire pipeline et étape) est refusée ; un rendez-vous
 * ne lit qu'une propriété date et heure importée de HubSpot.
 */
export async function creerLigne(
  deps: DepsLignesHubspot, tenantId: string, d: { famille: FamilleLigneHubspot; config: unknown; nom?: string },
): Promise<Issue<LigneHubspotVue>> {
  const lu = lireConfig(d.famille, d.config);
  if (!lu.ok) return refus(400, lu.message);
  if (d.famille === 'rdv') {
    const cle = (lu.config as ConfigRdv).fieldKey;
    const champ = (await deps.champs(tenantId)).find((f) => f.key === cle);
    if (champ?.type !== 'datetime') {
      return refus(400, `La propriété « ${cle} » n’est pas une date et heure importée dans cet espace : importez-la dans Tools > Intégrations > HubSpot, puis choisissez-la ici.`);
    }
  }
  if (d.famille === 'etape') {
    const e = lu.config as ConfigEtape;
    if (await deps.lignes.etapeReglee(tenantId, e.pipelineId, e.stageId)) {
      return refus(409, `L’étape « ${e.stageLabel?.trim() || e.stageId} » a déjà sa ligne : ouvrez-la dans la liste plutôt que d’en créer une seconde.`, 'etape_deja_reglee');
    }
  }
  const nom = d.nom?.trim() || nomParDefaut(d.famille, lu.config);
  const { id: workflowId } = await deps.workflows.insert(tenantId, nom, d.famille === 'workflow' ? grapheLibre() : grapheDUneLigne(), 'hubspot');
  await deps.workflows.publish(workflowId, tenantId);
  const { id } = await deps.lignes.creer(tenantId, { famille: d.famille, config: lu.config, workflowId, nom });
  const ligne = await deps.lignes.lire(tenantId, id);
  if (ligne === null) return refus(404, REFUS_LIGNE_INCONNUE);
  // Un scénario neuf n'a pas encore de template : rien à lire chez Meta.
  return { ok: true, valeur: await vueDe(deps, tenantId, ligne, []) };
}

/** Le premier template de la ligne est-il publié ? Sans lui, la ligne ne s'allume pas. */
async function premierTemplatePublie(deps: DepsLignesHubspot, tenantId: string, l: LigneHubspot): Promise<boolean> {
  if (l.famille === 'workflow') {
    const wf = await deps.workflows.getById(l.workflowId, tenantId);
    return wf !== null && wf.rayon === 'hubspot' && premierModele('workflow', wf.graph) !== null;
  }
  return (await premierBloc({ workflows: deps.workflows, indices: deps.indices }, tenantId, l.workflowId, 'hubspot')).etat === 'pret';
}

/** L'interrupteur d'une ligne. Allumer exige le premier template publié ; éteindre arrête les parcours de la ligne. */
export async function reglerLigne(deps: DepsLignesHubspot, tenantId: string, id: string, actif: boolean): Promise<Issue<LigneHubspotVue>> {
  const l = await deps.lignes.lire(tenantId, id);
  if (l === null) return refus(404, REFUS_LIGNE_INCONNUE);
  if (actif) {
    if (!(await premierTemplatePublie(deps, tenantId, l))) {
      return refus(409, l.famille === 'workflow' ? REFUS_A_COMPLETER_WORKFLOW : REFUS_A_COMPLETER, 'a_completer');
    }
    await deps.lignes.allumer(tenantId, id, true);
  } else {
    await deps.lignes.allumer(tenantId, id, false);
    if (l.actif) await arreterLesParcours(deps, tenantId, l, 'ligne HubSpot éteinte');
  }
  const relue = await deps.lignes.lire(tenantId, id);
  if (relue === null) return refus(404, REFUS_LIGNE_INCONNUE);
  return { ok: true, valeur: await vueDe(deps, tenantId, relue, (await lireModeles(deps, tenantId)) ?? []) };
}

/** La ligne disparaît et ses parcours s'arrêtent ; son scénario reste, hors de toute liste. */
export async function supprimerLigne(deps: DepsLignesHubspot, tenantId: string, id: string): Promise<Issue<null>> {
  const l = await deps.lignes.lire(tenantId, id);
  if (l === null || !(await deps.lignes.supprimer(tenantId, id))) return refus(404, REFUS_LIGNE_INCONNUE);
  await arreterLesParcours(deps, tenantId, l, 'ligne HubSpot supprimée');
  return { ok: true, valeur: null };
}
