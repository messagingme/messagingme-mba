import { makeTraceOps, type AuditSink } from '../../audit/journal';
import { classerErreurMeta } from '../../api/refus-meta';
import type { VerrousCourts } from '../../db/verrous-courts';
import { journaliser } from '../../lib/journal';
import { TokenInvalidError } from '../../meta/credentials';
import { MetaApiError } from '../../meta/errors';
import type { TemplateSummary } from '../../meta/templates';
import { flowsDesBoutons, type IndicesSource } from './meta';
import type { CreationMeta, EntreeMeta, IssueMeta } from './meta-execution';
import {
  planifierDuplication,
  templatesEtFlowsDuGraphe,
  type ChoixDuplication,
  type EtatDuplication,
  type PlanDuplication,
  type TemplateDeLaWaba,
} from './plan';
import type { CopieEcrite, EspaceDuplication, PgDuplicationStore } from './store.pg';

/** Le bail couvre aussi les appels à Meta (au plus `PLAFOND_META` objets, quelques secondes chacun). */
const BAIL_DUPLICATION_MS = 5 * 60_000;

type RefusLectureMeta = 'meta_illisible' | 'jeton_invalide' | 'meta_refuse';

export interface DependancesDuplicationScenario {
  store: Pick<PgDuplicationStore, 'espaces' | 'scenarios' | 'lireEtat' | 'ecrire' | 'flowsSource'>;
  /** Les templates de la WABA de l'espace, lus chez Meta sans cache ; `null` = l'espace n'a pas de WABA. */
  templatesDe(tenantId: string): Promise<TemplateDeLaWaba[] | null>;
  /** Les modèles entiers de la source, avec leurs adresses d'origine restaurées ; `null` = pas de WABA. */
  modelesDe(tenantId: string): Promise<TemplateSummary[] | null>;
  indicesDe(tenantId: string, modeles: ReadonlyArray<{ nom: string; langue: string }>): Promise<IndicesSource[]>;
  /** La création chez Meta, avant la transaction de base. */
  executerChezMeta(destination: string, entree: EntreeMeta): Promise<IssueMeta>;
  offreOuvreScenarios(tenantId: string): Promise<boolean>;
  creditIaOuvert(tenantId: string): Promise<boolean>;
  /** Le référentiel des tags, au mieux. */
  declareTags(tenantId: string, tags: string[]): Promise<void>;
  /** Une duplication à la fois par destination, pour toutes les copies de l'API. */
  verrous: Pick<VerrousCourts, 'prendre' | 'relacher'>;
  audit: AuditSink;
}

export interface DemandeApercuDuplication {
  source: string;
  scenarioId: string;
  destination: string;
}

export interface DemandeDuplication extends DemandeApercuDuplication {
  empreinte: string;
  dupliquer?: ChoixDuplication;
  auteur: string;
}

/** Ce que l'écran affiche : le plan sans son graphe ni la configuration complète de ses déclencheurs. */
function apercuDe(plan: PlanDuplication) {
  return {
    nomCopie: plan.nomCopie,
    debranches: plan.graphe.debranches,
    templates: plan.graphe.templates,
    champsACreer: plan.champsACreer,
    champsEnConflit: plan.champsEnConflit,
    champsInconnus: plan.champsInconnus,
    templatesAbsents: plan.templatesAbsents,
    templatesNonApprouves: plan.templatesNonApprouves,
    declencheursCopies: plan.declencheurs.copies.map((c) => ({ nom: c.name, type: c.triggerKind })),
    declencheursRetires: plan.declencheurs.retires,
    motsRetires: plan.declencheurs.motsRetires,
    dependances: plan.dependances,
    references: plan.references,
    meta: plan.meta,
    signaux: plan.signaux,
    blocages: plan.blocages,
    empreinte: plan.empreinte,
  };
}

export type ApercuDuplication = ReturnType<typeof apercuDe>;

export type LectureEspaces =
  | { issue: 'ok'; espaces: EspaceDuplication[] }
  | { issue: 'impossible' };

export type LectureScenarios =
  | { issue: 'ok'; scenarios: Array<{ id: string; nom: string }> }
  | { issue: 'impossible' };

export type IssueApercuDuplication =
  | { issue: 'ok'; apercu: ApercuDuplication }
  | { issue: 'inconnu' | RefusLectureMeta | 'impossible' };

export interface DuplicationReussie extends CopieEcrite {
  champsCrees: string[];
  crees: CreationMeta[];
  declencheursRetires: PlanDuplication['declencheurs']['retires'];
  motsRetires: PlanDuplication['declencheurs']['motsRetires'];
}

export type IssueDuplication =
  | { issue: 'ok'; copie: DuplicationReussie }
  | { issue: 'inconnu' | RefusLectureMeta }
  | { issue: 'verrou_impossible' | 'verrou_occupe' }
  | { issue: 'empreinte_perimee' | 'choix_invalides' }
  | { issue: 'bloquee'; blocages: string[] }
  | { issue: 'arret_meta'; refus: string; crees: CreationMeta[]; champsCrees: string[] }
  | { issue: 'ecriture_apres_meta'; crees: CreationMeta[] }
  | { issue: 'impossible' };

export interface DuplicationScenario {
  espaces(): Promise<LectureEspaces>;
  scenarios(tenantId: string): Promise<LectureScenarios>;
  apercu(demande: DemandeApercuDuplication): Promise<IssueApercuDuplication>;
  dupliquer(demande: DemandeDuplication): Promise<IssueDuplication>;
}

/**
 * L'application de duplication entre espaces. Son interface porte les quatre gestes de l'écran ; l'assemblage, le
 * verrou et l'ordre Meta -> base restent locaux au module et ne fuient plus dans l'adaptateur HTTP.
 */
export function creerDuplicationScenario(deps: DependancesDuplicationScenario): DuplicationScenario {
  const tracer = makeTraceOps(deps.audit);

  const assembler = async ({ source, scenarioId, destination }: DemandeApercuDuplication): Promise<EtatDuplication | null | RefusLectureMeta> => {
    const base = await deps.store.lireEtat(source, scenarioId, destination);
    if (base === null) return null;
    let templatesDestination: TemplateDeLaWaba[] | null;
    try {
      templatesDestination = await deps.templatesDe(destination);
    } catch (err) {
      journaliser('warn', 'ops_duplication_templates_illisibles', { err, destination });
      if (err instanceof TokenInvalidError) return 'jeton_invalide';
      if (err instanceof MetaApiError) {
        const code = classerErreurMeta(err).code;
        if (code === 'meta_auth_failed') return 'jeton_invalide';
        if (code === 'meta_rejected') return 'meta_refuse';
      }
      return 'meta_illisible';
    }
    const tousSource = await deps.modelesDe(source).catch((err: unknown) => {
      journaliser('warn', 'ops_duplication_templates_source_illisibles', { err, source });
      return null;
    });
    const duGraphe = templatesEtFlowsDuGraphe(base.scenario.graphe);
    const modelesSource = tousSource?.filter((t) => duGraphe.templates.some((x) => x.nom === t.name && x.langue === t.language)) ?? null;
    const idsFlows = [...duGraphe.blocsFlow.map((b) => b.flowId), ...(modelesSource ?? []).flatMap(flowsDesBoutons)];
    const [flowsSource, indicesSource, offreOuvreScenarios, creditIaOuvert] = await Promise.all([
      deps.store.flowsSource(source, idsFlows),
      modelesSource === null
        ? Promise.resolve([])
        : deps.indicesDe(source, modelesSource.map((t) => ({ nom: t.name, langue: t.language }))),
      deps.offreOuvreScenarios(destination),
      base.dependances.agents.length === 0 ? Promise.resolve(true) : deps.creditIaOuvert(destination),
    ]);
    return { ...base, templatesDestination, modelesSource, flowsSource, indicesSource, offreOuvreScenarios, creditIaOuvert };
  };

  const apercu = async (demande: DemandeApercuDuplication): Promise<IssueApercuDuplication> => {
    try {
      const etat = await assembler(demande);
      if (etat === null) return { issue: 'inconnu' };
      if (typeof etat === 'string') return { issue: etat };
      return { issue: 'ok', apercu: apercuDe(planifierDuplication(etat)) };
    } catch (err) {
      journaliser('error', 'ops_duplication_apercu_impossible', { err, ...demande });
      return { issue: 'impossible' };
    }
  };

  const dupliquer = async (demande: DemandeDuplication): Promise<IssueDuplication> => {
    const { source, scenarioId, destination, empreinte, dupliquer: choix, auteur } = demande;
    let prise: Awaited<ReturnType<DependancesDuplicationScenario['verrous']['prendre']>>;
    try {
      prise = await deps.verrous.prendre([[`duplication-scenario:${destination}`, BAIL_DUPLICATION_MS]]);
    } catch (err) {
      journaliser('error', 'ops_duplication_impossible', { err, par: auteur, destination });
      return { issue: 'verrou_impossible' };
    }
    if (prise === null) return { issue: 'verrou_occupe' };
    let meta: IssueMeta | null = null;
    try {
      const etat = await assembler({ source, scenarioId, destination });
      if (etat === null) return { issue: 'inconnu' };
      if (typeof etat === 'string') return { issue: etat };
      const plan = planifierDuplication(etat, choix);
      // L'empreinte précède les cases : un état changé dit « relancez l'aperçu », même si une case est devenue invalide.
      if (plan.empreinte !== empreinte) return { issue: 'empreinte_perimee' };
      if (plan.choixInvalides.length > 0) return { issue: 'choix_invalides' };
      if (plan.blocages.length > 0) return { issue: 'bloquee', blocages: plan.blocages };
      if (plan.copiesMeta.flows.length + plan.copiesMeta.templates.length > 0) {
        meta = await deps.executerChezMeta(destination, {
          copies: plan.copiesMeta,
          champsAvantMeta: plan.champsAvantMeta,
          modelesSource: etat.modelesSource ?? [],
          flowsSource: etat.flowsSource,
          indicesSource: etat.indicesSource,
        });
        if (!meta.ok) {
          journaliser('warn', 'ops_duplication_arretee_chez_meta', {
            par: auteur, source, scenarioId, destination, refus: meta.refus, crees: meta.crees,
          });
          return { issue: 'arret_meta', refus: meta.refus, crees: meta.crees, champsCrees: meta.champsCrees };
        }
      }
      const copie = await deps.store.ecrire(destination, source, etat.scenario, plan, meta?.flows);
      const tags = [...new Set([...plan.graphe.tags, ...plan.declencheurs.tags, ...plan.tagsDependances])];
      try {
        await deps.declareTags(destination, tags);
      } catch (err) {
        journaliser('warn', 'ops_duplication_tags_non_declares', { err, destination });
      }
      const crees = meta?.crees ?? [];
      journaliser('info', 'ops_duplication_scenario', {
        par: auteur, source, scenarioId, destination, copie: copie.scenarioId, nom: copie.nom,
        secretsCopies: copie.dependancesCopiees.sourcesAvecSecret, creesChezMeta: crees,
      });
      await tracer(destination, auteur, 'ops.scenario_duplique', {
        scenario: copie.nom,
        copies: {
          ...copie.dependancesCopiees,
          templates: crees.flatMap((x) => (x.sorte === 'template' ? [`${x.nom} (${x.langue})`] : [])),
          flows: crees.flatMap((x) => (x.sorte === 'flow' ? [x.nom] : [])),
        },
      });
      return {
        issue: 'ok',
        copie: {
          ...copie,
          champsCrees: [...new Set([...(meta?.champsCrees ?? []), ...copie.champsCrees])],
          crees,
          declencheursRetires: plan.declencheurs.retires,
          motsRetires: plan.declencheurs.motsRetires,
        },
      };
    } catch (err) {
      journaliser('error', 'ops_duplication_impossible', {
        err,
        par: auteur,
        source,
        scenarioId,
        destination,
        empreinte,
        dupliquer: choix,
        creesChezMeta: meta?.crees ?? [],
      });
      if (meta?.ok && meta.crees.length > 0) return { issue: 'ecriture_apres_meta', crees: meta.crees };
      return { issue: 'impossible' };
    } finally {
      await deps.verrous.relacher(prise).catch(() => undefined);
    }
  };

  return {
    async espaces() {
      try {
        return { issue: 'ok', espaces: await deps.store.espaces() };
      } catch (err) {
        journaliser('error', 'ops_duplication_espaces_illisibles', { err });
        return { issue: 'impossible' };
      }
    },
    async scenarios(tenantId) {
      try {
        return { issue: 'ok', scenarios: await deps.store.scenarios(tenantId) };
      } catch (err) {
        journaliser('error', 'ops_duplication_scenarios_illisibles', { err, tenantId });
        return { issue: 'impossible' };
      }
    },
    apercu,
    dupliquer,
  };
}
