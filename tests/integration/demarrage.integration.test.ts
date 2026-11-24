import '../../src/charger-env';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgDemarrageStore } from '../../src/demarrage/store.pg';

/**
 * « BIEN DÉMARRER », EN BASE (plan 2026-11-24-guide-demarrage, lot 1). Chaque signal se coche par le vrai objet qui le
 * prouve, les objets qui n'en sont pas (brouillon, scénario système, bulle éteinte, boutique coupée) ne cochent rien, et
 * 🔴 un autre espace qui a tout ne coche RIEN ici : la requête porte `tenant_id = $1` dans chaque sous-requête.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ancienne base de production.
 */
const url = process.env.DATABASE_URL ?? '';
const RIEN = { numero: false, outil: false, scenarioOuCampagne: false, agent: false, bulle: false };

describe.skipIf(!url)('« Bien démarrer », en base', () => {
  let pool: Pool;
  let t1 = '';
  let t2 = '';
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    t1 = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-demarrage-1') returning id`)).rows[0]!.id;
    t2 = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-demarrage-2') returning id`)).rows[0]!.id;
  });
  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[t1, t2]]);
    await pool.end();
  });

  const numero = async (tenant: string, hubspot: boolean): Promise<string> => {
    const waba = `itest-dem-waba-${randomUUID()}`;
    const pn = `itest-dem-pn-${randomUUID()}`;
    await pool.query(`insert into waba (id, tenant_id, name) values ($1, $2, 'itest')`, [waba, tenant]);
    await pool.query(`insert into phone_numbers (id, waba_id, tenant_id, hubspot_connected) values ($1, $2, $3, $4)`, [pn, waba, tenant, hubspot]);
    return pn;
  };
  const boutique = (tenant: string, etat: 'connectee' | 'coupee') => pool.query(
    `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre, etat) values ($1, $2, 'itest', 'x', $3)`,
    [tenant, `itest-${randomUUID().slice(0, 8)}.myshopify.com`, etat],
  );
  const scenario = (tenant: string, publie: boolean, systeme: string | null) => pool.query(
    `insert into workflows (tenant_id, name, published_at, systeme) values ($1, 'itest-demarrage', $2, $3)`,
    [tenant, publie ? new Date() : null, systeme],
  );
  const campagne = (tenant: string, status: string) => pool.query(
    `insert into campaigns (tenant_id, phone_number_id, name, category, template_name, template_language, status)
     values ($1, 'itest', 'itest-demarrage', 'utility', 'itest', 'fr', $2)`,
    [tenant, status],
  );
  const agent = (tenant: string, status: string) => pool.query(
    `insert into agents (tenant_id, label, mention_ia, modele, status) values ($1, $2, 'IA', 'itest', $3)`,
    [tenant, `itest-${randomUUID().slice(0, 8)}`, status],
  );
  const bulle = (tenant: string, actif: boolean) => pool.query(
    // La phrase est unique par espace (`widgets_phrase_key`) : une par bulle.
    `insert into widgets (tenant_id, code, nom, phrase, actif) values ($1, gen_random_uuid()::text, 'itest', gen_random_uuid()::text, $2)`,
    [tenant, actif],
  );

  it('🔴 un espace neuf ne coche rien, et un autre espace qui a tout ne lui coche rien', async () => {
    const store = new PgDemarrageStore(pool);
    expect(await store.etat(t1)).toEqual(RIEN);

    await numero(t2, true);
    await boutique(t2, 'connectee');
    await scenario(t2, true, null);
    await campagne(t2, 'completed');
    await agent(t2, 'active');
    await bulle(t2, true);
    expect(await store.etat(t2)).toEqual({ numero: true, outil: true, scenarioOuCampagne: true, agent: true, bulle: true });
    expect(await store.etat(t1)).toEqual(RIEN);
  });

  it('ce qui n’en est pas une preuve ne coche rien', async () => {
    const store = new PgDemarrageStore(pool);
    await boutique(t1, 'coupee');
    await scenario(t1, false, null);
    await scenario(t1, true, 'repondeur');
    await campagne(t1, 'draft');
    await campagne(t1, 'failed');
    await agent(t1, 'draft');
    await agent(t1, 'disabled');
    await bulle(t1, false);
    expect(await store.etat(t1)).toEqual(RIEN);
  });

  it('chaque signal se coche par le vrai objet', async () => {
    const store = new PgDemarrageStore(pool);
    await numero(t1, false);
    expect(await store.etat(t1)).toEqual({ ...RIEN, numero: true });

    // HubSpot activé sur un numéro de l'espace suffit, sans boutique.
    await numero(t1, true);
    expect((await store.etat(t1)).outil).toBe(true);

    // Programmée suffit : la personne l'a lancée.
    await campagne(t1, 'scheduled');
    expect((await store.etat(t1)).scenarioOuCampagne).toBe(true);

    await agent(t1, 'active');
    await bulle(t1, true);
    expect(await store.etat(t1)).toEqual({ numero: true, outil: true, scenarioOuCampagne: true, agent: true, bulle: true });
  });
});
