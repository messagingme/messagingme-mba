import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { auteurOps, type PreHandler } from '../auth/middleware';
import { estUuid } from './scope';
import { journaliser } from '../lib/journal';
import { makeTraceOps, type AuditSink } from '../audit/journal';
import { TokenInvalidError } from '../meta/credentials';
import { MetaApiError } from '../meta/errors';
import { classerErreurMeta } from '../api/refus-meta';
import type { VerrousCourts } from '../db/verrous-courts';
import type { TemplateSummary } from '../meta/templates';
import type { PgDuplicationStore } from '../ops/duplication/store.pg';
import { flowsDesBoutons, type IndicesSource } from '../ops/duplication/meta';
import type { EntreeMeta, IssueMeta } from '../ops/duplication/meta-execution';
import {
  planifierDuplication, templatesEtFlowsDuGraphe, type EtatDuplication, type PlanDuplication, type TemplateDeLaWaba,
} from '../ops/duplication/plan';

/**
 * DUPLIQUER UN SCÉNARIO D'UN ESPACE À L'AUTRE DEPUIS /ops (lots 1 à 3 ; spec
 * `docs/superpowers/specs/2026-11-16-duplication-scenario-entre-espaces-design.md`). Quatre routes, derrière la garde
 * d'exploitation (`makeRequireOps`, la même instance que `/ops`) :
 *  - `GET /ops/duplication/espaces` : les espaces, avec la présence d'une WABA ;
 *  - `GET /ops/duplication/espaces/:tenantId/scenarios` : les scénarios publics d'un espace ;
 *  - `POST /ops/duplication/apercu` `{ source, scenarioId, destination }` : le récapitulatif, sans rien écrire ;
 *  - `POST /ops/duplication` `{ …, empreinte, dupliquer }` : la copie, si l'état est encore celui de l'aperçu.
 *
 * 🔴 META D'ABORD, TOUT OU RIEN (lot 3) : les templates et Flows cochés se recréent chez Meta AVANT la transaction de
 * base (`executerChezMeta`) ; au premier refus, rien n'est écrit en base et la réponse liste ce qui a été créé chez Meta.
 * Les lectures : les templates des DEUX WABA (celle de destination illisible rend un 422 lisible, jamais une liste vide
 * qui se lirait « aucun template »), puis les Flows et les indications que désignent ceux de la source.
 * 🔴 JAMAIS DE 5XX : Cloudflare en mange le corps. Une panne imprévue rend 422 lisible. La ligne de journal porte l'auteur
 * (`par`), comme chaque écriture de `/ops`.
 */
export interface OpsDuplicationDeps {
  store: Pick<PgDuplicationStore, 'espaces' | 'scenarios' | 'lireEtat' | 'ecrire' | 'flowsSource'>;
  /** Les templates de la WABA de l'espace, lus chez Meta sans cache ; `null` = l'espace n'a pas de WABA. */
  templatesDe(tenantId: string): Promise<TemplateDeLaWaba[] | null>;
  /**
   * Les templates de la WABA de l'espace, lus EN ENTIER chez Meta sans cache, l'adresse d'origine remise à la place de
   * nos liens tracés (`listerModeles` de `templates/gestion.ts`) ; `null` = pas de WABA (lot 3).
   */
  modelesDe(tenantId: string): Promise<TemplateSummary[] | null>;
  /** Les indications de variables de ces templates dans l'espace (`template_param_hints`). */
  indicesDe(tenantId: string, modeles: ReadonlyArray<{ nom: string; langue: string }>): Promise<IndicesSource[]>;
  /** La création chez Meta, avant la transaction de base (`executerChezMeta`, lot 3). */
  executerChezMeta(destination: string, entree: EntreeMeta): Promise<IssueMeta>;
  offreOuvreScenarios(tenantId: string): Promise<boolean>;
  /** La destination peut-elle consommer de l'IA ? Lu seulement quand le scénario propose un agent. */
  creditIaOuvert(tenantId: string): Promise<boolean>;
  /** Le référentiel des tags, au mieux (comme la duplication dans un même espace). */
  declareTags(tenantId: string, tags: string[]): Promise<void>;
  /** Une duplication à la fois par destination, pour toutes les copies de l'API (double clic, deux onglets). */
  verrous: Pick<VerrousCourts, 'prendre' | 'relacher'>;
  /** Le journal d'activité : la duplication y laisse sa trace DANS la destination, signée de l'exploitant (lot 2). */
  audit: AuditSink;
}

/** Le bail couvre aussi les appels à Meta du lot 3 (au plus `PLAFOND_META` objets, quelques secondes chacun). */
const BAIL_DUPLICATION_MS = 5 * 60_000;

/** Pourquoi les templates de la destination ne se lisent pas : passager (`meta`), jeton à reconnecter, refus durable. */
type RefusMeta = 'meta' | 'jeton' | 'refuse';

/** Au plus 20 cases par sorte : un scénario désigne rarement plus de quelques dépendances. */
const ids = z.array(z.string().uuid()).max(20);
/** Un template par son nom (la forme de Meta) et sa langue ; un Flow par son id Meta, tout en chiffres. */
const templatesCoches = z.array(z.object({ nom: z.string().regex(/^[a-z0-9_]{1,512}$/), langue: z.string().regex(/^[A-Za-z_]{2,15}$/) })).max(20);
const flowsCoches = z.array(z.string().regex(/^\d{1,30}$/)).max(20);
const corpsApercu = z.object({ source: z.string(), scenarioId: z.string(), destination: z.string() });
const corpsDuplication = corpsApercu.extend({
  empreinte: z.string().regex(/^[0-9a-f]{64}$/),
  dupliquer: z.object({
    agents: ids, requetes: ids, modelesEmail: ids, templates: templatesCoches.optional(), flows: flowsCoches.optional(),
  }).optional(),
});

const INCONNU = { error: 'espace ou scénario inconnu' };
const META_ILLISIBLE = 'les templates de l’espace de destination n’ont pas pu être lus chez Meta : réessayez dans un instant';
const JETON_INVALIDE = 'le jeton WhatsApp de l’espace de destination est invalide : reconnectez son numéro, puis relancez l’aperçu';
/** Un refus durable de Meta (un espace sans jeton propre lit avec le nôtre, que sa WABA ne connaît pas) : réessayer n'y changerait rien. */
const META_REFUSE = 'Meta refuse la lecture des templates de l’espace de destination : vérifiez que son compte WhatsApp est relié à notre application, puis relancez l’aperçu';

/** Ce que l'écran affiche : le plan sans le graphe (seulement ses blocs débranchés) ni la config des déclencheurs. */
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
    // Bloc par bloc : l'écran en tire les blocs qu'une case rebranche (lot 3).
    references: plan.references,
    meta: plan.meta,
    signaux: plan.signaux,
    blocages: plan.blocages,
    empreinte: plan.empreinte,
  };
}

export function registerOpsDuplication(app: FastifyInstance, deps: OpsDuplicationDeps, garde: PreHandler): void {
  const opts = { preHandler: garde };
  const tracer = makeTraceOps(deps.audit);

  /**
   * L'état complet : la base, puis les WABA, les Flows et les indications, et l'offre. `null` = espace ou scénario
   * inconnu ; `meta` / `jeton` = les templates de la DESTINATION illisibles (bloquant). Ceux de la SOURCE servent à
   * comparer des boutons et à recréer un absent : illisibles, ils valent `null`, et le plan n'offre aucune recréation.
   */
  const assembler = async (source: string, scenarioId: string, destination: string): Promise<EtatDuplication | null | RefusMeta> => {
    const base = await deps.store.lireEtat(source, scenarioId, destination);
    if (base === null) return null;
    let templatesDestination: TemplateDeLaWaba[] | null;
    try {
      templatesDestination = await deps.templatesDe(destination);
    } catch (err) {
      journaliser('warn', 'ops_duplication_templates_illisibles', { err, destination });
      if (err instanceof TokenInvalidError) return 'jeton';
      if (err instanceof MetaApiError) {
        const c = classerErreurMeta(err).code;
        if (c === 'meta_auth_failed') return 'jeton';
        if (c === 'meta_rejected') return 'refuse';
      }
      return 'meta';
    }
    const tousSource = await deps.modelesDe(source).catch((err: unknown) => {
      journaliser('warn', 'ops_duplication_templates_source_illisibles', { err, source });
      return null;
    });
    // Seuls les templates que le scénario envoie : leurs Flows et leurs indications se lisent ensuite.
    const duGraphe = templatesEtFlowsDuGraphe(base.scenario.graphe);
    const modelesSource = tousSource?.filter((t) => duGraphe.templates.some((x) => x.nom === t.name && x.langue === t.language)) ?? null;
    const idsFlows = [...duGraphe.blocsFlow.map((b) => b.flowId), ...(modelesSource ?? []).flatMap(flowsDesBoutons)];
    const [flowsSource, indicesSource, offreOuvreScenarios, creditIaOuvert] = await Promise.all([
      deps.store.flowsSource(source, idsFlows),
      modelesSource === null ? Promise.resolve([]) : deps.indicesDe(source, modelesSource.map((t) => ({ nom: t.name, langue: t.language }))),
      deps.offreOuvreScenarios(destination),
      base.dependances.agents.length === 0 ? Promise.resolve(true) : deps.creditIaOuvert(destination),
    ]);
    return { ...base, templatesDestination, modelesSource, flowsSource, indicesSource, offreOuvreScenarios, creditIaOuvert };
  };
  const refusMeta = (e: RefusMeta) => ({ error: e === 'jeton' ? JETON_INVALIDE : e === 'refuse' ? META_REFUSE : META_ILLISIBLE });
  const estRefus = (e: EtatDuplication | null | RefusMeta): e is RefusMeta => e === 'meta' || e === 'jeton' || e === 'refuse';

  /** Le corps validé, ou `null` une fois la réponse envoyée (400 mal formé, 404 identifiant qui n'est pas un UUID). */
  const lireCorps = <C extends z.infer<typeof corpsApercu>>(lu: z.ZodSafeParseResult<C>, reply: FastifyReply): C | null => {
    if (!lu.success) { void reply.code(400).send({ error: 'corps invalide : source, scenarioId et destination sont requis' }); return null; }
    if (!estUuid(lu.data.source) || !estUuid(lu.data.scenarioId) || !estUuid(lu.data.destination)) { void reply.code(404).send(INCONNU); return null; }
    return lu.data;
  };

  app.get('/ops/duplication/espaces', opts, async (_req, reply) => {
    try {
      return reply.code(200).send({ espaces: await deps.store.espaces() });
    } catch (err) {
      journaliser('error', 'ops_duplication_espaces_illisibles', { err });
      return reply.code(422).send({ error: 'les espaces n’ont pas pu être lus : réessayez' });
    }
  });

  app.get('/ops/duplication/espaces/:tenantId/scenarios', opts, async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    if (!estUuid(tenantId)) return reply.code(404).send({ error: 'espace inconnu' });
    try {
      return reply.code(200).send({ scenarios: await deps.store.scenarios(tenantId) });
    } catch (err) {
      journaliser('error', 'ops_duplication_scenarios_illisibles', { err, tenantId });
      return reply.code(422).send({ error: 'les scénarios n’ont pas pu être lus : réessayez' });
    }
  });

  app.post('/ops/duplication/apercu', opts, async (req, reply) => {
    const c = lireCorps(corpsApercu.safeParse(req.body), reply);
    if (c === null) return reply;
    try {
      const etat = await assembler(c.source, c.scenarioId, c.destination);
      if (etat === null) return reply.code(404).send(INCONNU);
      if (estRefus(etat)) return reply.code(422).send(refusMeta(etat));
      return reply.code(200).send({ apercu: apercuDe(planifierDuplication(etat)) });
    } catch (err) {
      journaliser('error', 'ops_duplication_apercu_impossible', { err, ...c });
      return reply.code(422).send({ error: 'l’aperçu n’a pas pu être calculé : réessayez' });
    }
  });

  app.post('/ops/duplication', opts, async (req, reply) => {
    const c = lireCorps(corpsDuplication.safeParse(req.body), reply);
    if (c === null) return reply;
    const par = auteurOps(req);
    let prise: Awaited<ReturnType<OpsDuplicationDeps['verrous']['prendre']>>;
    try {
      prise = await deps.verrous.prendre([[`duplication-scenario:${c.destination}`, BAIL_DUPLICATION_MS]]);
    } catch (err) {
      journaliser('error', 'ops_duplication_impossible', { err, par, destination: c.destination });
      return reply.code(422).send({ error: 'la duplication n’a pas pu commencer : réessayez dans un instant' });
    }
    if (prise === null) return reply.code(409).send({ error: 'une duplication vers cet espace est déjà en cours' });
    let meta: IssueMeta | null = null;
    try {
      const etat = await assembler(c.source, c.scenarioId, c.destination);
      if (etat === null) return reply.code(404).send(INCONNU);
      if (estRefus(etat)) return reply.code(422).send(refusMeta(etat));
      const plan = planifierDuplication(etat, c.dupliquer);
      // L'empreinte d'abord : un agent supprimé dans la source depuis l'aperçu se dit « relancez l'aperçu », pas « case
      // invalide » (relecture du lot 2).
      if (plan.empreinte !== c.empreinte) return reply.code(409).send({ error: 'le scénario ou l’espace de destination a changé : relancez l’aperçu' });
      // Une case qui désigne ce que le scénario ne désigne pas (un agent d'un autre espace glissé dans le corps) : rien.
      if (plan.choixInvalides.length > 0) return reply.code(400).send({ error: 'une dépendance cochée n’est pas désignée par ce scénario' });
      if (plan.blocages.length > 0) return reply.code(422).send({ error: 'la duplication est bloquée', blocages: plan.blocages });
      if (plan.copiesMeta.flows.length + plan.copiesMeta.templates.length > 0) {
        meta = await deps.executerChezMeta(c.destination, {
          copies: plan.copiesMeta, champsAvantMeta: plan.champsAvantMeta,
          modelesSource: etat.modelesSource ?? [], flowsSource: etat.flowsSource, indicesSource: etat.indicesSource,
        });
        if (!meta.ok) {
          journaliser('warn', 'ops_duplication_arretee_chez_meta', {
            par, source: c.source, scenarioId: c.scenarioId, destination: c.destination, refus: meta.refus, crees: meta.crees,
          });
          return reply.code(422).send({
            error: `la duplication s’est arrêtée chez Meta : ${meta.refus}. Rien n’a été écrit dans l’espace ; ce qui a déjà été créé chez Meta y reste`,
            crees: meta.crees, champsCrees: meta.champsCrees,
          });
        }
      }
      const copie = await deps.store.ecrire(c.destination, c.source, etat.scenario, plan, meta?.flows);
      const tags = [...new Set([...plan.graphe.tags, ...plan.declencheurs.tags, ...plan.tagsDependances])];
      try {
        await deps.declareTags(c.destination, tags);
      } catch (err) {
        // Au mieux : un tag se pose par son nom, il manquera seulement au référentiel.
        journaliser('warn', 'ops_duplication_tags_non_declares', { err, destination: c.destination });
      }
      const creesChezMeta = meta?.crees ?? [];
      journaliser('info', 'ops_duplication_scenario', {
        par, source: c.source, scenarioId: c.scenarioId, destination: c.destination, copie: copie.scenarioId, nom: copie.nom,
        secretsCopies: copie.dependancesCopiees.sourcesAvecSecret, creesChezMeta,
      });
      // La trace DANS la destination, que ses administrateurs lisent dans leur journal d'activité.
      await tracer(c.destination, par, 'ops.scenario_duplique', {
        scenario: copie.nom,
        copies: {
          ...copie.dependancesCopiees,
          templates: creesChezMeta.flatMap((x) => (x.sorte === 'template' ? [`${x.nom} (${x.langue})`] : [])),
          flows: creesChezMeta.flatMap((x) => (x.sorte === 'flow' ? [x.nom] : [])),
        },
      });
      return reply.code(201).send({
        ...copie,
        champsCrees: [...new Set([...(meta?.champsCrees ?? []), ...copie.champsCrees])],
        crees: creesChezMeta,
        declencheursRetires: plan.declencheurs.retires,
        motsRetires: plan.declencheurs.motsRetires,
      });
    } catch (err) {
      journaliser('error', 'ops_duplication_impossible', { err, par, ...c, creesChezMeta: meta?.crees ?? [] });
      // Après les créations chez Meta, elles y restent : la réponse les nomme (une nouvelle duplication réutilisera les
      // templates, désormais présents dans la destination).
      if (meta?.ok && meta.crees.length > 0) {
        return reply.code(422).send({
          error: 'la duplication n’a pas pu s’écrire dans l’espace : ce qui a été créé chez Meta y reste, relancez l’aperçu',
          crees: meta.crees,
        });
      }
      return reply.code(422).send({ error: 'la duplication n’a pas pu aller au bout : rien n’a été écrit, relancez l’aperçu' });
    } finally {
      await deps.verrous.relacher(prise).catch(() => undefined);
    }
  });
}
