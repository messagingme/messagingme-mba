import type { FastifyInstance } from 'fastify';
import type { Guard } from '../auth/middleware';
import { corpsDuRefus } from '../lib/issue';
import { accepter, lireVue, type DepsMisesEnLigne } from '../mise-en-ligne/mise-en-ligne';
import { espaceVerifie } from './scope';

/**
 * LA PAGE DU OUI DE MISE EN LIGNE (lot 1 du CSM virtuel, B2) : la lecture et le clic, sous la garde d'ADMIN de la console.
 * 🔴 C'est la seule porte du clic : aucun jeton OAuth ni clé d'API n'ouvre une route de la console (la garde ne connaît
 * que la session signée de la connexion, `verifySession`), une session d'observation y est en lecture seule, et aucun
 * outil MCP n'appelle `accepter` (`tests/mcp-mise-en-ligne.test.ts`). Le CSM ne peut donc pas dire oui à la place du
 * client. Un clic sur une mise en ligne faite rend son résultat ; une mise en ligne interrompue se reprend par lui.
 */
export function registerMisesEnLigne(app: FastifyInstance, deps: DepsMisesEnLigne, garde: Guard): void {
  const opts = { preHandler: garde };

  app.get('/tenants/:tenantId/mises-en-ligne/:id', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const { id } = req.params as { id: string };
    const r = await lireVue(deps, tenant, id);
    return r.ok ? reply.send(r.valeur) : reply.code(r.statut).send(corpsDuRefus(r));
  });

  app.post('/tenants/:tenantId/mises-en-ligne/:id/accepter', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const { id } = req.params as { id: string };
    const userId = req.auth?.userId;
    if (!userId) return reply.code(401).send({ error: 'authentification requise' });
    const r = await accepter(deps, tenant, id, { userId });
    return r.ok ? reply.send(r.valeur) : reply.code(r.statut).send(corpsDuRefus(r));
  });
}
