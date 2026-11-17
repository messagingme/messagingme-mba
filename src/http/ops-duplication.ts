import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { auteurOps, type PreHandler } from '../auth/middleware';
import { estUuid } from './scope';
import { journaliser } from '../lib/journal';
import { makeTraceOps, type AuditSink } from '../audit/journal';
import { TokenInvalidError } from '../meta/credentials';
import type { VerrousCourts } from '../db/verrous-courts';
import type { PgDuplicationStore } from '../ops/duplication/store.pg';
import { planifierDuplication, type EtatDuplication, type PlanDuplication, type TemplateDeLaWaba } from '../ops/duplication/plan';

/**
 * DUPLIQUER UN SCÉNARIO D'UN ESPACE À L'AUTRE DEPUIS /ops (lot 1 ; spec
 * `docs/superpowers/specs/2026-11-16-duplication-scenario-entre-espaces-design.md`). Quatre routes, derrière la garde
 * d'exploitation (`makeRequireOps`, la même instance que `/ops`) :
 *  - `GET /ops/duplication/espaces` : les espaces, avec la présence d'une WABA ;
 *  - `GET /ops/duplication/espaces/:tenantId/scenarios` : les scénarios publics d'un espace ;
 *  - `POST /ops/duplication/apercu` `{ source, scenarioId, destination }` : le récapitulatif, sans rien écrire ;
 *  - `POST /ops/duplication` `{ …, empreinte }` : la copie, si l'état est encore celui de l'aperçu.
 *
 * 🔴 CE LOT N'ÉCRIT RIEN CHEZ META : il LIT les templates de la WABA de destination. Une lecture qui échoue rend un 422
 * lisible, jamais une liste vide qui se lirait « aucun template ».
 * 🔴 JAMAIS DE 5XX : Cloudflare en mange le corps. Une panne imprévue rend 422 lisible. La ligne de journal porte l'auteur
 * (`par`), comme chaque écriture de `/ops`.
 */
export interface OpsDuplicationDeps {
  store: Pick<PgDuplicationStore, 'espaces' | 'scenarios' | 'lireEtat' | 'ecrire'>;
  /** Les templates de la WABA de l'espace, lus chez Meta sans cache ; `null` = l'espace n'a pas de WABA. */
  templatesDe(tenantId: string): Promise<TemplateDeLaWaba[] | null>;
  offreOuvreScenarios(tenantId: string): Promise<boolean>;
  /** Le référentiel des tags, au mieux (comme la duplication dans un même espace). */
  declareTags(tenantId: string, tags: string[]): Promise<void>;
  /** Une duplication à la fois par destination, pour toutes les copies de l'API (double clic, deux onglets). */
  verrous: Pick<VerrousCourts, 'prendre' | 'relacher'>;
  /** Le journal d'activité : la duplication y laisse sa trace DANS la destination, signée de l'exploitant (lot 2). */
  audit: AuditSink;
}

const BAIL_DUPLICATION_MS = 2 * 60_000;

/** Au plus 20 cases par sorte : un scénario désigne rarement plus de quelques dépendances. */
const ids = z.array(z.string().uuid()).max(20);
const corpsApercu = z.object({ source: z.string(), scenarioId: z.string(), destination: z.string() });
const corpsDuplication = corpsApercu.extend({
  empreinte: z.string().regex(/^[0-9a-f]{64}$/),
  dupliquer: z.object({ agents: ids, requetes: ids, modelesEmail: ids }).optional(),
});

const INCONNU = { error: 'espace ou scénario inconnu' };
const META_ILLISIBLE = 'les templates de l’espace de destination n’ont pas pu être lus chez Meta : réessayez dans un instant';
const JETON_INVALIDE = 'le jeton WhatsApp de l’espace de destination est invalide : reconnectez son numéro, puis relancez l’aperçu';

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
    signaux: plan.signaux,
    blocages: plan.blocages,
    empreinte: plan.empreinte,
  };
}

export function registerOpsDuplication(app: FastifyInstance, deps: OpsDuplicationDeps, garde: PreHandler): void {
  const opts = { preHandler: garde };
  const tracer = makeTraceOps(deps.audit);

  /**
   * L'état complet : la base, puis les WABA et l'offre. `null` = espace ou scénario inconnu ; `meta` / `jeton` = les
   * templates de la DESTINATION illisibles (bloquant). Ceux de la SOURCE ne servent qu'à comparer des boutons : illisibles,
   * ils valent `null` et le plan le signale.
   */
  const assembler = async (source: string, scenarioId: string, destination: string): Promise<EtatDuplication | null | 'meta' | 'jeton'> => {
    const base = await deps.store.lireEtat(source, scenarioId, destination);
    if (base === null) return null;
    let templatesDestination: TemplateDeLaWaba[] | null;
    try {
      templatesDestination = await deps.templatesDe(destination);
    } catch (err) {
      journaliser('warn', 'ops_duplication_templates_illisibles', { err, destination });
      return err instanceof TokenInvalidError ? 'jeton' : 'meta';
    }
    const templatesSource = await deps.templatesDe(source).catch((err: unknown) => {
      journaliser('warn', 'ops_duplication_templates_source_illisibles', { err, source });
      return null;
    });
    return { ...base, templatesDestination, templatesSource, offreOuvreScenarios: await deps.offreOuvreScenarios(destination) };
  };
  const refusMeta = (e: 'meta' | 'jeton') => ({ error: e === 'jeton' ? JETON_INVALIDE : META_ILLISIBLE });

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
      if (etat === 'meta' || etat === 'jeton') return reply.code(422).send(refusMeta(etat));
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
    try {
      const etat = await assembler(c.source, c.scenarioId, c.destination);
      if (etat === null) return reply.code(404).send(INCONNU);
      if (etat === 'meta' || etat === 'jeton') return reply.code(422).send(refusMeta(etat));
      const plan = planifierDuplication(etat, c.dupliquer);
      // Une case qui désigne ce que le scénario ne désigne pas (un agent d'un autre espace glissé dans le corps) : rien.
      if (plan.choixInvalides.length > 0) return reply.code(400).send({ error: 'une dépendance cochée n’est pas désignée par ce scénario' });
      if (plan.empreinte !== c.empreinte) return reply.code(409).send({ error: 'le scénario ou l’espace de destination a changé : relancez l’aperçu' });
      if (plan.blocages.length > 0) return reply.code(422).send({ error: 'la duplication est bloquée', blocages: plan.blocages });
      const copie = await deps.store.ecrire(c.destination, c.source, etat.scenario, plan);
      const tags = [...new Set([...plan.graphe.tags, ...plan.declencheurs.tags, ...plan.tagsDependances])];
      try {
        await deps.declareTags(c.destination, tags);
      } catch (err) {
        // Au mieux : un tag se pose par son nom, il manquera seulement au référentiel.
        journaliser('warn', 'ops_duplication_tags_non_declares', { err, destination: c.destination });
      }
      journaliser('info', 'ops_duplication_scenario', {
        par, source: c.source, scenarioId: c.scenarioId, destination: c.destination, copie: copie.scenarioId, nom: copie.nom,
        secretsCopies: copie.dependancesCopiees.sourcesAvecSecret,
      });
      // La trace DANS la destination, que ses administrateurs lisent dans leur journal d'activité.
      await tracer(c.destination, par, 'ops.scenario_duplique', { scenario: copie.nom, copies: copie.dependancesCopiees });
      return reply.code(201).send({
        ...copie,
        declencheursRetires: plan.declencheurs.retires,
        motsRetires: plan.declencheurs.motsRetires,
      });
    } catch (err) {
      journaliser('error', 'ops_duplication_impossible', { err, par, ...c });
      return reply.code(422).send({ error: 'la duplication n’a pas pu aller au bout : rien n’a été écrit, relancez l’aperçu' });
    } finally {
      await deps.verrous.relacher(prise).catch(() => undefined);
    }
  });
}
