import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { CleMediaMeta, MediaMemorise, MemoireDesMedias } from './template-media';

/** Au-delà, une entrée ne sert plus (7 jours de lecture) : effacée par l'espace au dépôt suivant, la table reste petite. */
const OUBLI_JOURS = 30;

/** L'adresse ne se garde pas en base, son empreinte suffit à la reconnaître (et une URL peut dépasser la taille d'un index). */
const empreinte = (adresse: string): string => createHash('sha256').update(adresse).digest('hex');

/**
 * LA MÉMOIRE DURABLE DES FICHIERS DÉPOSÉS CHEZ META (migration 0288, plan 2026-11-10). 🔴 Chaque requête porte
 * `tenant_id = $1` : le rôle de l'application contourne la RLS, ce filtre est le seul contrôle entre espaces.
 */
export class PgMemoireDesMedias implements MemoireDesMedias {
  constructor(private readonly pool: Pool) {}

  async lire(cle: CleMediaMeta, maxJours: number): Promise<(MediaMemorise & { televerseLe: number }) | null> {
    const { rows } = await this.pool.query<{ media_id: string; type: MediaMemorise['type']; nom: string | null; televerse_le: Date }>(
      `select media_id, type, nom, televerse_le from medias_meta
        where tenant_id = $1 and numero = $2 and fournisseur = $3 and usage = $4 and empreinte = $5
          and televerse_le > now() - make_interval(days => $6)`,
      [cle.tenantId, cle.numero, cle.fournisseur, cle.usage, empreinte(cle.adresse), maxJours],
    );
    const r = rows[0];
    return r ? { mediaId: r.media_id, type: r.type, nom: r.nom, televerseLe: r.televerse_le.getTime() } : null;
  }

  async noter(cle: CleMediaMeta, media: MediaMemorise, codeMediatheque: string | null): Promise<void> {
    await this.pool.query(
      `insert into medias_meta (tenant_id, numero, fournisseur, usage, empreinte, code_mediatheque, media_id, type, nom)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (tenant_id, numero, fournisseur, usage, empreinte) do update
         set code_mediatheque = excluded.code_mediatheque, media_id = excluded.media_id, type = excluded.type,
             nom = excluded.nom, televerse_le = now()`,
      [cle.tenantId, cle.numero, cle.fournisseur, cle.usage, empreinte(cle.adresse), codeMediatheque, media.mediaId, media.type, media.nom],
    );
    await this.pool.query(
      'delete from medias_meta where tenant_id = $1 and televerse_le < now() - make_interval(days => $2)',
      [cle.tenantId, OUBLI_JOURS],
    );
  }
}

/**
 * Oublie les dépôts d'un fichier de la médiathèque qu'on supprime (`PgRcsMediaStore.supprimer`), pour qu'il ne reparte
 * pas sous son ancien identifiant. Appelé APRÈS la transaction de la suppression, jamais dedans : une erreur ici (table
 * pas encore créée) annulerait la suppression elle-même.
 */
export async function oublierFichierDeLaMediatheque(db: Pick<PoolClient, 'query'>, tenantId: string, code: string): Promise<void> {
  await db.query('delete from medias_meta where tenant_id = $1 and code_mediatheque = $2', [tenantId, code]);
}
