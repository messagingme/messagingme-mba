import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgMemoireDesMedias } from '../../src/meta/memoire-medias.pg';
import { PgRcsMediaStore } from '../../src/rcs/media-store.pg';
import { newMediaCode } from '../../src/ids/code';
import type { CleMediaMeta } from '../../src/meta/template-media';

/**
 * LA MÉMOIRE DURABLE DES DÉPÔTS CHEZ META (migration 0288), sur une vraie base : lue par espace, numéro, fournisseur et
 * usage, bornée à l'âge demandé, effacée par la suppression de l'espace (cascade) et par celle du fichier de la
 * médiathèque.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local ne pointe pas sur une base jetable. La CI monte un
 * Postgres jetable pour ça (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe.skipIf(!url)('la mémoire des fichiers déposés chez Meta', () => {
  let pool: Pool;
  let memoire: PgMemoireDesMedias;
  let t = '';
  let autre = '';
  const cle = (over: Partial<CleMediaMeta> = {}): CleMediaMeta => ({
    tenantId: t, numero: 'PN-1', fournisseur: 'meta', usage: 'fichier', adresse: 'https://api.messagingme.app/m/x.png', ...over,
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    memoire = new PgMemoireDesMedias(pool);
    t = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-memoire-medias') returning id`)).rows[0]!.id;
    autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-memoire-medias-autre') returning id`)).rows[0]!.id;
  });
  beforeEach(async () => {
    await pool.query('delete from medias_meta where tenant_id = any($1)', [[t, autre]]);
    await pool.query('delete from rcs_media where tenant_id = any($1)', [[t, autre]]);
  });
  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1)', [[t, autre]]);
    await pool.end();
  });

  it('un dépôt noté se relit, avec son type, son nom et sa date ; un second dépôt le remplace', async () => {
    await memoire.noter(cle(), { mediaId: 'MID-1', type: 'image', nom: 'photo.png' }, null);
    expect(await memoire.lire(cle(), 7)).toMatchObject({ mediaId: 'MID-1', type: 'image', nom: 'photo.png' });
    await memoire.noter(cle(), { mediaId: 'MID-2', type: 'image', nom: 'photo.png' }, null);
    expect((await memoire.lire(cle(), 7))!.mediaId).toBe('MID-2');
    expect((await pool.query('select 1 from medias_meta where tenant_id = $1', [t])).rowCount).toBe(1);
  });

  it('🔴 jamais repris pour un autre espace, un autre numéro, un autre fournisseur ou un autre usage', async () => {
    await memoire.noter(cle(), { mediaId: 'MID-1', type: 'image', nom: null }, null);
    expect(await memoire.lire(cle({ tenantId: autre }), 7)).toBeNull();
    expect(await memoire.lire(cle({ numero: 'PN-2' }), 7)).toBeNull();
    expect(await memoire.lire(cle({ fournisseur: '360dialog' }), 7)).toBeNull();
    expect(await memoire.lire(cle({ usage: 'visuel' }), 7)).toBeNull();
    expect(await memoire.lire(cle({ adresse: 'https://api.messagingme.app/m/y.png' }), 7)).toBeNull();
  });

  it('🔴 au-delà de l’âge demandé, plus rien ne se relit ; au-delà de 30 jours, le dépôt suivant de l’espace l’efface', async () => {
    await memoire.noter(cle(), { mediaId: 'MID-1', type: 'image', nom: null }, null);
    await pool.query(`update medias_meta set televerse_le = now() - interval '8 days' where tenant_id = $1`, [t]);
    expect(await memoire.lire(cle(), 7)).toBeNull();
    await pool.query(`update medias_meta set televerse_le = now() - interval '31 days' where tenant_id = $1`, [t]);
    await memoire.noter(cle({ adresse: 'https://api.messagingme.app/m/y.png' }), { mediaId: 'MID-2', type: 'image', nom: null }, null);
    const restes = await pool.query<{ media_id: string }>('select media_id from medias_meta where tenant_id = $1', [t]);
    expect(restes.rows.map((r) => r.media_id)).toEqual(['MID-2']);
  });

  it('🔴 un fichier supprimé de la médiathèque oublie ses dépôts, ceux de l’autre espace restent', async () => {
    const store = new PgRcsMediaStore(pool, null);
    const code = newMediaCode();
    await store.deposer(t, { code, mime: 'image/png', bytes: PNG, nom: 'photo.png' }, null);
    await memoire.noter(cle(), { mediaId: 'MID-1', type: 'image', nom: null }, code);
    await memoire.noter(cle({ tenantId: autre }), { mediaId: 'MID-9', type: 'image', nom: null }, code);
    expect(await store.supprimer(t, code)).toEqual({ issue: 'supprime' });
    expect(await memoire.lire(cle(), 7)).toBeNull();
    expect((await memoire.lire(cle({ tenantId: autre }), 7))!.mediaId).toBe('MID-9');
  });

  it('la suppression d’un espace emporte ses dépôts (cascade)', async () => {
    const jetable = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-memoire-medias-jetable') returning id`)).rows[0]!.id;
    await memoire.noter(cle({ tenantId: jetable }), { mediaId: 'MID-1', type: 'image', nom: null }, null);
    await pool.query('delete from tenants where id = $1', [jetable]);
    expect((await pool.query('select 1 from medias_meta where tenant_id = $1', [jetable])).rowCount).toBe(0);
  });
});
