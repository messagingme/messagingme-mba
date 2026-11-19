import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgUserStore } from '../../src/user/store.pg';

/**
 * LA FENÊTRE DE BIENVENUE, EN BASE (plan 2026-11-19-accueil-pro, migration 0303). Un compte créé après la migration naît
 * sans choix (`accueil_choisi_le` vide) ; le marquage ne touche que le compte nommé, dans SON espace, et garde sa
 * première date ; un identifiant lu dans un autre espace ne rend jamais l'état d'autrui.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ancienne base de production.
 */
const url = process.env.DATABASE_URL ?? '';

describe.skipIf(!url)('la fenêtre de bienvenue, en base', () => {
  let pool: Pool;
  let t1 = '';
  let t2 = '';
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    t1 = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-accueil-1') returning id`)).rows[0]!.id;
    t2 = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-accueil-2') returning id`)).rows[0]!.id;
  });
  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[t1, t2]]);
    await pool.end();
  });

  const compte = async (tenant: string, email: string): Promise<string> =>
    (await pool.query<{ id: string }>(
      `insert into users (tenant_id, email, role, password_hash) values ($1, $2, 'admin', 'x') returning id`,
      [tenant, email],
    )).rows[0]!.id;

  it('🔴 un compte neuf la voit ; le marquage ne touche que lui, dans son espace, et garde sa première date', async () => {
    const users = new PgUserStore(pool);
    const lea = await compte(t1, 'itest-accueil-lea@example.test');
    const max = await compte(t1, 'itest-accueil-max@example.test');
    expect(await users.accueilAFaire(lea, t1)).toBe(true);
    expect(await users.accueilAFaire(max, t1)).toBe(true);
    // Lu depuis un autre espace : jamais l'état d'autrui.
    expect(await users.accueilAFaire(lea, t2)).toBe(false);

    // Un marquage depuis le mauvais espace n'écrit rien.
    await users.marquerAccueil(lea, t2);
    expect(await users.accueilAFaire(lea, t1)).toBe(true);

    await users.marquerAccueil(lea, t1);
    expect(await users.accueilAFaire(lea, t1)).toBe(false);
    expect(await users.accueilAFaire(max, t1)).toBe(true);

    const premiere = (await pool.query<{ d: Date }>('select accueil_choisi_le as d from users where id = $1', [lea])).rows[0]!.d;
    await users.marquerAccueil(lea, t1);
    const seconde = (await pool.query<{ d: Date }>('select accueil_choisi_le as d from users where id = $1', [lea])).rows[0]!.d;
    expect(seconde.getTime()).toBe(premiere.getTime());
  });
});
