import type { FastifyInstance } from 'fastify';
import type { Guard } from '../auth/middleware';
import type { EtatDemarrage } from '../demarrage/store.pg';
import { espaceVerifie } from './scope';

/** La progression « Bien démarrer » de la console (plan 2026-11-24-guide-demarrage, lot 1). */
export interface DemarrageRouteDeps {
  etat(tenantId: string): Promise<EtatDemarrage>;
}

/**
 * Réservée aux administrateurs, comme l'Accueil et les écrans où mènent les étapes. L'espace est celui que la garde a
 * vérifié (`espaceVerifie`), jamais celui de l'URL tel quel.
 */
export function registerDemarrage(app: FastifyInstance, deps: DemarrageRouteDeps, garde: Guard): void {
  app.get('/tenants/:tenantId/demarrage', { preHandler: garde }, async (req, reply) => {
    const tenant = espaceVerifie(req);
    return reply.code(200).send(await deps.etat(tenant));
  });
}
