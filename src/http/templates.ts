import type { FastifyInstance } from 'fastify';
import { forbidNonAdmin } from '../auth/middleware';
import type { Guard } from '../auth/middleware';
import { espaceVerifie, nonEmpty } from './scope';
import {
  creerUnModele,
  listerModeles,
  modifierUnModele,
  supprimerUnModele,
  type DepsGestionModeles,
  type RefusGestionModele,
} from '../templates/gestion';
import { enteteDe, indicesDe, lireCreationDeModele, parseTemplateFields, sourcesAEnregistrer } from '../templates/corps';

function corpsRefus(r: RefusGestionModele): { error: string; campaigns?: RefusGestionModele['campaigns'] } {
  return { error: r.error, ...(r.campaigns ? { campaigns: r.campaigns } : {}) };
}

/** Routes de modèles : l'adapter valide le transport et traduit les issues du module métier. */
export function registerTemplates(app: FastifyInstance, deps: DepsGestionModeles, garde: Guard): void {
  const opts = { preHandler: garde };

  app.get('/tenants/:tenantId/templates', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    return reply.code(200).send({ templates: await listerModeles(deps, tenant) });
  });

  app.post('/tenants/:tenantId/templates', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    if (forbidNonAdmin(req, reply)) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!nonEmpty(b.name)) return reply.code(400).send({ error: 'name requis' });
    const lu = await lireCreationDeModele(deps, tenant, b, b.name);
    if ('error' in lu) return reply.code(400).send({ error: lu.error });

    const issue = await creerUnModele(deps, tenant, lu.entree, lu.sources);
    if (!('res' in issue)) return reply.code(issue.statut).send({ error: issue.error });
    return reply.code(201).send(issue.res);
  });

  app.get('/tenants/:tenantId/templates/:templateName/param-hints', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const { templateName } = req.params as { templateName: string };
    const q = req.query as { language?: string };
    if (!nonEmpty(q.language)) return reply.code(400).send({ error: 'language requis (query)' });
    const hints = await deps.indices.get(tenant, decodeURIComponent(templateName), q.language);
    return reply.code(200).send({ hints });
  });

  app.patch('/tenants/:tenantId/templates/:templateName', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    if (forbidNonAdmin(req, reply)) return;
    const { templateName } = req.params as { templateName: string };
    const name = decodeURIComponent(templateName);
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!nonEmpty(b.language)) return reply.code(400).send({ error: 'language requis' });
    const parsed = parseTemplateFields(b);
    if ('error' in parsed) return reply.code(400).send({ error: parsed.error });
    const indices = indicesDe(b);
    if (indices === null) return reply.code(400).send({ error: 'paramHints invalides' });
    const entete = enteteDe(b, parsed.fields.header);
    if (entete === 'invalide') return reply.code(400).send({ error: 'enteteDepuisChamp : la clé d’un champ, sur un modèle à en-tête Document seulement' });
    const sources = await sourcesAEnregistrer(deps, tenant, name, b.language, indices, entete, parsed.fields.header);

    const issue = await modifierUnModele(deps, tenant, name, b.language, parsed.fields, sources);
    if ('refus' in issue) return reply.code(issue.refus.statut).send(corpsRefus(issue.refus));
    return reply.code(200).send(issue.res);
  });

  app.delete('/tenants/:tenantId/templates/:templateName', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    if (forbidNonAdmin(req, reply)) return;
    const { templateName } = req.params as { templateName: string };
    const issue = await supprimerUnModele(deps, tenant, decodeURIComponent(templateName));
    if ('refus' in issue) return reply.code(issue.refus.statut).send(corpsRefus(issue.refus));
    return reply.code(200).send(issue.res);
  });
}
