import type { FastifyInstance } from 'fastify';
import type { Guard } from '../auth/middleware';
import type { TagCount } from '../crm/tag-store.pg';
import { espaceVerifie, nonEmpty } from './scope';
import { normaliserEtiquette } from '../crm/poser-etiquette';

export interface TagsRouteDeps {
  listDistinct(tenantId: string): Promise<TagCount[]>;
  create(tenantId: string, name: string): Promise<boolean>;
  rename(tenantId: string, from: string, to: string): Promise<number>;
  remove(tenantId: string, tag: string): Promise<number>;
}

/** L'issue d'un renommage ou d'une suppression d'étiquette : la route la traduit en statut, l'outil en refus. */
export type IssueEtiquette<T> = { ok: true; valeur: T } | { ok: false; statut: 400; erreur: string };

/**
 * Renomme une étiquette sur toutes les fiches (elle rejoint l'étiquette `to` si elle existe déjà). Partagée par
 * `PATCH /tags` et l'outil `rename_tag` (lot 1 du CSM virtuel, B10).
 */
export async function renommerEtiquette(
  deps: Pick<TagsRouteDeps, 'rename'>, tenantId: string, from: unknown, to: unknown,
): Promise<IssueEtiquette<{ renamed: number }>> {
  if (!nonEmpty(from) || !nonEmpty(to)) return { ok: false, statut: 400, erreur: 'from et to requis' };
  const de = from.trim();
  // Bornée comme toute pose (64 caractères) : plus longue, l'étiquette ne pourrait plus être ni renommée ni retirée par
  // les outils, qui annoncent cette borne.
  const vers = normaliserEtiquette(to);
  if (de === vers) return { ok: false, statut: 400, erreur: 'from et to identiques' };
  return { ok: true, valeur: { renamed: await deps.rename(tenantId, de, vers) } };
}

/** Retire une étiquette de toutes les fiches. Partagée par `DELETE /tags` et l'outil `delete_tag` (B10). */
export async function supprimerEtiquette(
  deps: Pick<TagsRouteDeps, 'remove'>, tenantId: string, tag: unknown,
): Promise<IssueEtiquette<{ removed: number }>> {
  if (!nonEmpty(tag)) return { ok: false, statut: 400, erreur: 'tag requis' };
  return { ok: true, valeur: { removed: await deps.remove(tenantId, tag.trim()) } };
}

/** Gestion des tags (menu Contenu), admin-only. Modèle mixte : table `tags` (tags déclarés, créés à vide)
 *  + tags portés par les contacts (`contacts.tags`). listDistinct = union des deux (cf. PgTagStore). */
export function registerTags(app: FastifyInstance, deps: TagsRouteDeps, garde: Guard): void {
  const opts = { preHandler: garde };

  app.get('/tenants/:tenantId/tags', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    return reply.code(200).send({ tags: await deps.listDistinct(tenant) });
  });

  // Créer (déclarer) un tag réutilisable, même sans contact.
  app.post('/tenants/:tenantId/tags', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const b = (req.body ?? {}) as { name?: unknown };
    if (!nonEmpty(b.name)) return reply.code(400).send({ error: 'name requis' });
    const name = normaliserEtiquette(b.name);
    const created = await deps.create(tenant, name);
    return reply.code(created ? 201 : 200).send({ name, created });
  });

  app.patch('/tenants/:tenantId/tags', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const b = (req.body ?? {}) as { from?: unknown; to?: unknown };
    const r = await renommerEtiquette(deps, tenant, b.from, b.to);
    return r.ok ? reply.code(200).send(r.valeur) : reply.code(r.statut).send({ error: r.erreur });
  });

  app.delete('/tenants/:tenantId/tags', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const r = await supprimerEtiquette(deps, tenant, (req.query as { tag?: string }).tag);
    return r.ok ? reply.code(200).send(r.valeur) : reply.code(r.statut).send({ error: r.erreur });
  });
}
