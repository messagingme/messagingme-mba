import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgAutomationStore } from '../../src/automation/store.pg';

/**
 * L'attestation de l'accord marketing d'une automation (colonnes `accord_marketing_*`, migration 0271 ; lot 3b du plan
 * mm-hubspot du 2026-11-02). Frère de `automation-possession.integration.test.ts`.
 *
 * Ce test tape la vraie base, parce que c'est le seul endroit où se prouvent : l'aller-retour des colonnes par `COLS`
 * (une colonne oubliée là rend l'accord nul partout, sans qu'aucun type ne bouge : le piège de `possede_par`), le tampon
 * d'origine gardé par l'UPDATE lui-même, l'adresse résolue dans l'écriture et le CHECK de la migration.
 *
 * Ne PAS le lancer en local : le DATABASE_URL du .env local pointe sur l'ancienne base de production (CLAUDE.md du dépôt).
 * La CI monte un Postgres jetable (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';

describe.skipIf(!url)('automations : l attestation de l accord marketing', () => {
  let pool: Pool;
  let store: PgAutomationStore;
  let tenantId = '';
  let autreTenant = '';
  let workflowId = '';
  let marie = '';
  let paul = '';
  let horsEspace = '';

  const base = () => ({
    name: 'Mot-cle rdv', triggerKind: 'keyword' as const, triggerConfig: { keywords: ['rdv'] },
    conditionGroup: null, workflowId, startNodeId: null, cooldownSeconds: null, enabled: true,
  });
  const colonnes = async (id: string) => (await pool.query<{ par: string | null; email: string | null; le: Date | null }>(
    'select accord_marketing_par as par, accord_marketing_email as email, accord_marketing_le as le from automations where id = $1',
    [id],
  )).rows[0]!;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgAutomationStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-automation-accord') returning id`)).rows[0]!.id;
    autreTenant = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-automation-accord-autre') returning id`)).rows[0]!.id;
    workflowId = (await pool.query<{ id: string }>(
      `insert into workflows (tenant_id, name, graph) values ($1, 'itest', '{"nodes":[],"edges":[]}'::jsonb) returning id`,
      [tenantId],
    )).rows[0]!.id;
    const compte = async (t: string, email: string) => (await pool.query<{ id: string }>(
      `insert into users (tenant_id, email, role, password_hash) values ($1, $2, 'admin', 'x') returning id`, [t, email],
    )).rows[0]!.id;
    marie = await compte(tenantId, 'itest-accord-marie@example.test');
    paul = await compte(tenantId, 'itest-accord-paul@example.test');
    horsEspace = await compte(autreTenant, 'itest-accord-autre@example.test');
  });

  afterAll(async () => {
    if (tenantId) await pool.query('delete from tenants where id = any($1::uuid[])', [[tenantId, autreTenant]]);
    await pool.end();
  });

  it('🔴 créée attestée : qui, son adresse et quand, relus par `listEnabled` (le chemin chaud), `getById` et `list`', async () => {
    const { id } = await store.create(tenantId, { ...base(), accordMarketing: { par: marie } });
    const chaud = (await store.listEnabled(tenantId, ['keyword'])).find((a) => a.id === id);
    expect(chaud?.accordMarketing).toMatchObject({ par: marie, email: 'itest-accord-marie@example.test' });
    expect(chaud?.accordMarketing?.le).toBeInstanceOf(Date);
    expect((await store.getById(id, tenantId))?.accordMarketing?.par).toBe(marie);
    expect((await store.list(tenantId)).find((a) => a.id === id)?.accordMarketing?.par).toBe(marie);
  });

  it('créée sans la case : non attestée, partout', async () => {
    const { id } = await store.create(tenantId, base());
    expect((await store.listEnabled(tenantId, ['keyword'])).find((a) => a.id === id)?.accordMarketing).toBeNull();
    expect(await colonnes(id)).toEqual({ par: null, email: null, le: null });
  });

  it('🔴 recochée par un autre compte : le tampon D ORIGINE est gardé ; décochée : effacé ; absente : rien ne bouge', async () => {
    const { id } = await store.create(tenantId, { ...base(), accordMarketing: { par: marie } });
    const origine = await colonnes(id);
    expect(await store.update(id, tenantId, { name: 'Renommee', accordMarketing: { par: paul } })).toBe(true);
    expect(await colonnes(id)).toEqual(origine);
    expect(await store.update(id, tenantId, { name: 'Renommee encore' })).toBe(true);
    expect(await colonnes(id)).toEqual(origine);
    expect(await store.update(id, tenantId, { accordMarketing: null })).toBe(true);
    expect(await colonnes(id)).toEqual({ par: null, email: null, le: null });
    // Recochée après l'effacement : c'est une nouvelle attestation, au nom de qui la coche.
    expect(await store.update(id, tenantId, { accordMarketing: { par: paul } })).toBe(true);
    expect(await colonnes(id)).toMatchObject({ par: paul, email: 'itest-accord-paul@example.test' });
  });

  it('🔴 le compte d un AUTRE espace ne prête pas son adresse', async () => {
    const { id } = await store.create(tenantId, { ...base(), accordMarketing: { par: horsEspace } });
    expect((await colonnes(id)).email).toBeNull();
  });

  it('🔴 le CHECK de 0271 refuse un « qui » sans « quand »', async () => {
    const { id } = await store.create(tenantId, base());
    await expect(pool.query('update automations set accord_marketing_par = $2 where id = $1', [id, marie])).rejects.toThrow(/automations_accord_marketing_chk/);
    await expect(pool.query(`update automations set accord_marketing_email = 'x@y.z' where id = $1`, [id])).rejects.toThrow(/automations_accord_marketing_chk/);
  });
});
