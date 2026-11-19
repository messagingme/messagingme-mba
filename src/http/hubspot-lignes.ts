import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { forbidNonAdmin, type Guard } from '../auth/middleware';
import { espaceVerifie, estUuid } from './scope';
import { FAMILLES_HUBSPOT, MESSAGES } from '../hubspot/lignes';
import { creerLigne, etatDesLignes, reglerLigne, supprimerLigne, REFUS_LIGNE_INCONNUE, type DepsLignesHubspot } from '../hubspot/lignes-gestion';

/**
 * AUTOMATION > HUBSPOT (menu « Scénario », lot 6b, tâche 4) : les lignes d'étape, de rendez-vous et de scénarios lancés par
 * un workflow, sur le contrat que la console du lot 6c lit. Les rôles de l'écran Automation : la lecture à tout compte
 * authentifié, les écritures aux administrateurs (`forbidNonAdmin`, une automation allumée écrit au client sans relecture).
 * Chaque refus porte `error`, une phrase que la console affiche telle quelle, et parfois un `code` (`a_completer`,
 * `etape_deja_reglee`).
 */
export interface HubspotLignesRouteDeps {
  gestion: DepsLignesHubspot;
}

const corpsCreation = z.object({ famille: z.unknown(), config: z.unknown().optional(), nom: z.string().max(120).optional() }).strict();
// Ce soir, l'interrupteur seul : changer la configuration d'une ligne attendra (le contrat de 6c).
const corpsReglage = z.object({ actif: z.boolean() }).strict();

const estFamille = (x: unknown): x is (typeof FAMILLES_HUBSPOT)[number] => typeof x === 'string' && (FAMILLES_HUBSPOT as readonly string[]).includes(x);

export function registerHubspotLignes(app: FastifyInstance, deps: HubspotLignesRouteDeps, garde: Guard): void {
  const opts = { preHandler: garde };

  app.get('/tenants/:tenantId/hubspot/lignes', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    return reply.code(200).send(await etatDesLignes(deps.gestion, tenant));
  });

  app.post('/tenants/:tenantId/hubspot/lignes', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    if (forbidNonAdmin(req, reply)) return;
    const corps = corpsCreation.safeParse(req.body ?? {});
    if (!corps.success) {
      const champ = corps.error.issues[0]?.path[0];
      return reply.code(400).send({ error: champ === 'nom' ? MESSAGES.nom : MESSAGES.famille });
    }
    if (!estFamille(corps.data.famille)) return reply.code(400).send({ error: MESSAGES.famille });
    const r = await creerLigne(deps.gestion, tenant, {
      famille: corps.data.famille, config: corps.data.config, ...(corps.data.nom !== undefined ? { nom: corps.data.nom } : {}),
    });
    if (!r.ok) return reply.code(r.statut).send({ error: r.message, ...(r.code ? { code: r.code } : {}) });
    return reply.code(201).send({ ligne: r.valeur });
  });

  app.put('/tenants/:tenantId/hubspot/lignes/:id', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    if (forbidNonAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    if (!estUuid(id)) return reply.code(404).send({ error: REFUS_LIGNE_INCONNUE });
    const corps = corpsReglage.safeParse(req.body ?? {});
    if (!corps.success) return reply.code(400).send({ error: 'Seul l’interrupteur d’une ligne se règle ici : envoyez { actif: true } ou { actif: false }.' });
    const r = await reglerLigne(deps.gestion, tenant, id, corps.data.actif);
    if (!r.ok) return reply.code(r.statut).send({ error: r.message, ...(r.code ? { code: r.code } : {}) });
    return reply.code(200).send({ ligne: r.valeur });
  });

  app.delete('/tenants/:tenantId/hubspot/lignes/:id', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    if (forbidNonAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    if (!estUuid(id)) return reply.code(404).send({ error: REFUS_LIGNE_INCONNUE });
    const r = await supprimerLigne(deps.gestion, tenant, id);
    if (!r.ok) return reply.code(r.statut).send({ error: r.message });
    return reply.code(204).send();
  });
}
