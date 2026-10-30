import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PreHandler } from '../auth/middleware';
import { espaceVerifie } from './scope';
import { LANGUES } from '../emails-produit/catalogue';
import type { PgEmailsProduitStore } from '../emails-produit/store.pg';
import type { PgConversionsMetaStore } from '../pub/conversions-meta.pg';
import { navigateurDe } from '../pub/inscription';

/**
 * LES PRÉFÉRENCES D'E-MAILS DE LA PERSONNE CONNECTÉE (lot 7) : la langue de ses e-mails et ses deux abonnements
 * (commerciaux, transferts), pour la page « Mon compte ». La console y écrit aussi la langue choisie dans son
 * sélecteur, seul endroit où elle est connue.
 *
 * Elles appartiennent à la PERSONNE (`identities`), pas au compte d'un espace : une adresse qui a trois espaces a une
 * langue et une désinscription. La session porte le compte ; la route lit l'identité de CE compte dans l'espace de
 * l'adresse, vérifié par l'étape d'espace (`espaceVerifie`), jamais une identité tirée du corps.
 *
 * Même chose pour son accord publicitaire (`/moi/partage-meta`, pixel, lot 2) : l'interrupteur de la page de compte
 * accorde comme il retire. 🔴 Retirer abandonne aussitôt ce qui attendait encore pour la personne : rien ne part après.
 */

export interface EmailsMoiDeps {
  store: Pick<PgEmailsProduitStore, 'identiteDuCompte' | 'preferences' | 'poserLangue' | 'desinscrire' | 'reabonner'>;
  /** L'accord publicitaire de la personne (pixel, lot 2). */
  partage: Pick<PgConversionsMetaStore, 'consentement' | 'poserConsentement'>;
}

const majSchema = z.object({
  langue: z.enum(LANGUES).optional(),
  commerciaux: z.boolean().optional(),
  transferts: z.boolean().optional(),
}).strict();

const partageSchema = z.object({ accord: z.boolean() }).strict();

export function registerEmailsMoi(app: FastifyInstance, deps: EmailsMoiDeps, garde: PreHandler): void {
  const opts = { preHandler: garde };

  const identite = async (req: { auth?: { userId: string } }): Promise<string | null> =>
    req.auth ? deps.store.identiteDuCompte(espaceVerifie(req), req.auth.userId) : null;

  const lire = async (identityId: string) => {
    const p = await deps.store.preferences(identityId);
    if (p === null) return null;
    return {
      langue: p.langue,
      commerciaux: !p.desinscriptions.includes('commercial'),
      transferts: !p.desinscriptions.includes('transfert'),
    };
  };

  app.get('/tenants/:tenantId/moi/emails', opts, async (req, reply) => {
    const id = await identite(req);
    const p = id ? await lire(id) : null;
    if (p === null) return reply.code(404).send({ error: 'compte sans identité' });
    return reply.code(200).send(p);
  });

  app.put('/tenants/:tenantId/moi/emails', opts, async (req, reply) => {
    const lu = majSchema.safeParse(req.body ?? {});
    if (!lu.success) return reply.code(400).send({ error: 'langue (fr ou en), commerciaux et transferts (vrai ou faux), tous facultatifs' });
    const id = await identite(req);
    if (id === null) return reply.code(404).send({ error: 'compte sans identité' });
    const { langue, commerciaux, transferts } = lu.data;
    if (langue !== undefined) await deps.store.poserLangue(id, langue);
    if (commerciaux !== undefined) await (commerciaux ? deps.store.reabonner(id, 'commercial') : deps.store.desinscrire(id, 'commercial'));
    if (transferts !== undefined) await (transferts ? deps.store.reabonner(id, 'transfert') : deps.store.desinscrire(id, 'transfert'));
    return reply.code(200).send(await lire(id));
  });

  const lirePartage = async (identityId: string) => {
    const c = await deps.partage.consentement(identityId);
    return c === null ? null : { accord: c.accord, depuis: c.depuis === null ? null : c.depuis.toISOString() };
  };

  app.get('/tenants/:tenantId/moi/partage-meta', opts, async (req, reply) => {
    const id = await identite(req);
    const p = id ? await lirePartage(id) : null;
    if (p === null) return reply.code(404).send({ error: 'compte sans identité' });
    return reply.code(200).send(p);
  });

  app.put('/tenants/:tenantId/moi/partage-meta', opts, async (req, reply) => {
    const lu = partageSchema.safeParse(req.body ?? {});
    if (!lu.success) return reply.code(400).send({ error: 'accord (vrai ou faux) requis' });
    const id = await identite(req);
    if (id === null) return reply.code(404).send({ error: 'compte sans identité' });
    // Le navigateur de CETTE requête : Meta l'exige pour un événement de site web, il servira aux faits suivants.
    await deps.partage.poserConsentement(id, lu.data.accord, navigateurDe(req));
    return reply.code(200).send(await lirePartage(id));
  });
}
