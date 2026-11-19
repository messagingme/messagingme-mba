import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Guard } from '../auth/middleware';
import { espaceVerifie } from './scope';

/** Profil de l'utilisateur courant (dérivé de req.auth.userId). Sert au « Bonjour {prénom} » de l'Accueil. */
export interface MeRouteDeps {
  getById(userId: string): Promise<{ email: string; name: string | null; role: string } | null>;
  /**
   * L'adresse est-elle dans `OPS_EMAILS` ? Sert au seul lien « Exploitation » du menu du compte : un confort
   * d'affichage, jamais une autorisation (`/ops` a sa propre garde). Absent : aucun lien.
   */
  estExploitant?(email: string): boolean;
  /**
   * La fenêtre de bienvenue est-elle encore à montrer à ce compte de CET espace (plan 2026-11-19-accueil-pro, migration
   * 0303) ? Requise, comme la suivante : un câblage qui l'oublierait ne compile pas, au lieu de ne rien montrer en silence.
   */
  accueilAFaire(userId: string, tenantId: string): Promise<boolean>;
  /** Le compte a fait son choix dans la fenêtre (le tour, un raccourci, « Ne plus afficher »). Idempotent. */
  marquerAccueil(userId: string, tenantId: string): Promise<void>;
}

/** Le marquage ne porte rien : le compte est celui de la session, jamais un identifiant pris dans le corps. */
const accueilSchema = z.object({}).strict();

export function registerMe(app: FastifyInstance, deps: MeRouteDeps, garde: Guard): void {
  const opts = { preHandler: garde };

  app.get('/tenants/:tenantId/me', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const userId = req.auth?.userId;
    if (!userId) return reply.code(401).send({ error: 'authentification requise' });
    /**
     * La session d'observation de `/ops` n'a pas de compte dans l'espace : son identité `ops-observation` n'est pas
     * un uuid, et la chercher dans `users` lèverait `22P02` (donc un 500). On rend la même forme, sans nom.
     */
    if (req.auth?.impersonated === true) return reply.code(200).send({ email: '', name: null, role: req.auth.role });
    const u = await deps.getById(userId);
    if (!u) return reply.code(404).send({ error: 'utilisateur inconnu' });
    // `exploitation` n'est posé que vrai : la personne elle-même apprend qu'elle a l'accès, personne d'autre.
    // Le rôle EFFECTIF, celui que la garde a posé sur cette requête (jaune 4 de la relecture de A) : en Pro, tout membre est
    // administrateur, et la console relit ici le rôle qu'elle affiche ; celui de la fiche ne vaut qu'en Business et au-delà.
    const role = req.auth?.role ?? u.role;
    // `accueilAFaire` n'est posé que vrai, comme `exploitation` : une réponse ordinaire garde sa forme d'avant, et une
    // console d'avant le champ n'y voit rien. Le compte est lu DANS l'espace de la session (`tenant`).
    const accueil = await deps.accueilAFaire(userId, tenant);
    return reply.code(200).send({
      email: u.email, name: u.name, role,
      ...(deps.estExploitant?.(u.email) ? { exploitation: true } : {}),
      ...(accueil ? { accueilAFaire: true } : {}),
    });
  });

  /**
   * La personne a fait son choix dans la fenêtre de bienvenue : elle ne reviendra plus pour CE compte. La session
   * d'observation de `/ops`, qui n'a pas de compte, n'arrive pas jusqu'ici : la garde refuse ses écritures (403).
   */
  app.post('/tenants/:tenantId/moi/accueil', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const userId = req.auth?.userId;
    if (!userId) return reply.code(401).send({ error: 'authentification requise' });
    const corps = accueilSchema.safeParse(req.body ?? {});
    if (!corps.success) return reply.code(400).send({ error: 'corps inattendu' });
    await deps.marquerAccueil(userId, tenant);
    return reply.code(204).send();
  });
}
