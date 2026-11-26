import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgTenantSettingsStore } from '../../src/settings/store.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LE MESSAGE DE PASSAGE À UN HUMAIN GARDÉ EN BASE (migration 0328), contre un VRAI Postgres.
 *
 * Meta cache le bloc `handoff` d'un passage éteint (MUTAC, 2026-11-26) : cette colonne est la seule mémoire du choix,
 * et le balayage la relit à chaque bascule. Ce qui ne se prouve qu'ici : l'écriture en `jsonb` et sa relecture par le
 * vrai code, l'isolation par espace, et qu'une valeur illisible se lit « aucun choix » au lieu de casser le balayage.
 *
 * ⚠️ Jamais joué en local (le `DATABASE_URL` local pointe une ancienne base de production), joué par le job `integration`.
 */
describe.skipIf(!url)('message de passage en base (Postgres)', () => {
  let pool: Pool;
  let settings: PgTenantSettingsStore;
  let tenantId: string;
  let autreTenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    settings = new PgTenantSettingsStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-message-passage') returning id`)).rows[0]!.id;
    autreTenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-message-passage-autre') returning id`)).rows[0]!.id;
  });

  afterAll(async () => {
    for (const t of [tenantId, autreTenantId]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  it('🔴 le choix écrit se relit tel quel, pour son seul espace, sans toucher au mode du passage', async () => {
    expect(await settings.lireMessagePassage(tenantId)).toBeNull();
    await settings.setMbaHandoffMode(tenantId, 'business_hours');

    await settings.poserMessagePassage(tenantId, { message_selection: 'AGENT' });
    expect(await settings.lireMessagePassage(tenantId)).toEqual({ message_selection: 'AGENT' });

    await settings.poserMessagePassage(tenantId, { message_selection: 'CUSTOM', message: 'Un conseiller vous répond ici.' });
    expect(await settings.lireMessagePassage(tenantId)).toEqual({ message_selection: 'CUSTOM', message: 'Un conseiller vous répond ici.' });

    expect((await settings.get(tenantId)).mbaHandoffMode).toBe('business_hours');
    expect(await settings.lireMessagePassage(autreTenantId)).toBeNull();
  });

  it('une valeur illisible en base se lit « aucun choix », jamais une erreur', async () => {
    await pool.query(
      `update tenant_settings set mba_handoff_message = '{"message_selection": "CUSTOM"}'::jsonb where tenant_id = $1`,
      [tenantId],
    );
    expect(await settings.lireMessagePassage(tenantId)).toBeNull();
  });
});
