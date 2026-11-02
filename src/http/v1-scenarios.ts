import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Guard } from '../auth/middleware';
import { refuser } from '../api/erreurs';
import { compterOuRefuser, type ApiUsageGuard } from '../api/usage-guard';
import {
  creerScenario, lireScenario, remplacerScenario, supprimerScenario, type DepsScenariosApi, type ResultatScenario,
} from '../workflow/scenarios-api';

/**
 * LES SCÉNARIOS PAR L'API (spec `docs/superpowers/specs/2026-11-02-scenarios-api-design.md`) : `POST /v1/scenarios`,
 * `GET|PUT|DELETE /v1/scenarios/{scenarioId}`. La route traduit, le service décide (`src/workflow/scenarios-api.ts`, le
 * même que les outils MCP). La liste `GET /v1/scenarios` reste au catalogue (`v1-catalogues.ts`, sous `sends:create`).
 *
 * Garde attendue : `[makeRequireApiKey, requireScope('scenarios:write')]`, un droit NEUF sans reprise des clés
 * existantes : publier un parcours qui écrit aux contacts n'est ni envoyer, ni créer un modèle. L'espace vient de
 * `req.auth`, jamais de l'URL.
 */
export interface V1ScenariosRouteDeps extends DepsScenariosApi {
  /** Le garde d'usage, injecté au bootstrap. Requis, comme sur les autres modules /v1. */
  usage: ApiUsageGuard;
}

const parametres = z.object({ scenarioId: z.string().min(1).max(100) });

function repondre<T>(reply: FastifyReply, r: ResultatScenario<T>, statutSucces: 200 | 201): FastifyReply {
  if (r.ok) return reply.code(statutSucces).send(r.valeur);
  return reply.code(r.statut).send({ error: r.message, code: r.code, ...r.details });
}

/** L'empreinte du remplacement : `If-Match` (avec ou sans guillemets), sinon `empreinte` dans le corps. */
function empreinteDemandee(entete: unknown, corps: unknown): string | undefined {
  if (typeof entete === 'string' && entete.trim() !== '') return entete.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
  const e = corps !== null && typeof corps === 'object' ? (corps as Record<string, unknown>).empreinte : undefined;
  return typeof e === 'string' ? e : undefined;
}

export function registerV1Scenarios(app: FastifyInstance, deps: V1ScenariosRouteDeps, garde: Guard): void {
  const opts = { preHandler: garde };

  app.post('/v1/scenarios', opts, async (req, reply) => {
    if (!req.auth) return refuser(reply, 401, 'unauthorized', 'clé d’API requise');
    if (!await compterOuRefuser(deps.usage, req, reply, 'scenarios.write')) return reply;
    return repondre(reply, await creerScenario(deps, req.auth.tenantId, req.body, 'api'), 201);
  });

  app.get('/v1/scenarios/:scenarioId', opts, async (req, reply) => {
    if (!req.auth) return refuser(reply, 401, 'unauthorized', 'clé d’API requise');
    if (!await compterOuRefuser(deps.usage, req, reply, 'scenarios.read')) return reply;
    const p = parametres.safeParse(req.params);
    if (!p.success) return refuser(reply, 404, 'scenario_not_found', 'scénario introuvable dans cet espace');
    return repondre(reply, await lireScenario(deps, req.auth.tenantId, p.data.scenarioId), 200);
  });

  app.put('/v1/scenarios/:scenarioId', opts, async (req, reply) => {
    if (!req.auth) return refuser(reply, 401, 'unauthorized', 'clé d’API requise');
    if (!await compterOuRefuser(deps.usage, req, reply, 'scenarios.write')) return reply;
    const p = parametres.safeParse(req.params);
    if (!p.success) return refuser(reply, 404, 'scenario_not_found', 'scénario introuvable dans cet espace');
    // `empreinte` voyage avec la recette, qui la refuserait comme clé inconnue : elle en est retirée ici.
    const corps = req.body !== null && typeof req.body === 'object' && !Array.isArray(req.body)
      ? Object.fromEntries(Object.entries(req.body as Record<string, unknown>).filter(([k]) => k !== 'empreinte'))
      : req.body;
    const empreinte = empreinteDemandee(req.headers['if-match'], req.body);
    return repondre(reply, await remplacerScenario(deps, req.auth.tenantId, p.data.scenarioId, corps, empreinte, 'api'), 200);
  });

  app.delete('/v1/scenarios/:scenarioId', opts, async (req, reply) => {
    if (!req.auth) return refuser(reply, 401, 'unauthorized', 'clé d’API requise');
    if (!await compterOuRefuser(deps.usage, req, reply, 'scenarios.write')) return reply;
    const p = parametres.safeParse(req.params);
    if (!p.success) return refuser(reply, 404, 'scenario_not_found', 'scénario introuvable dans cet espace');
    return repondre(reply, await supprimerScenario(deps, req.auth.tenantId, p.data.scenarioId, 'api'), 200);
  });
}
