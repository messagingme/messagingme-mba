import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgInboxStore } from '../../src/inbox/store.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LE BALAYAGE NE REND PAS UN FIL QU'UN PARCOURS EN COURS TIENT (défaut mesuré chez MUTAC le 2026-11-19).
 *
 * Le lot du balayage (`listHeldControl`) prenait un fil `app_workflow` sur la seule date de prise du fil
 * (`control_changed_at`). Or un scénario qui démarre sur un fil déjà à lui ne la remet pas à jour, et une conversation
 * née d'un envoi n'en a pas (null, éligible tout de suite) : 3 s ou 4 min après l'envoi d'un template, le fil partait à
 * l'agent de Meta, et le clic sur un bouton du template allait à l'IA au lieu de la branche du scénario. La soupape des
 * 24 h compte désormais depuis la dernière activité du PARCOURS : un parcours qui attend ou dort et qui a bougé dans le
 * délai garde le fil ; un parcours abandonné le rend, comme avant.
 */
describe.skipIf(!url)('PgInboxStore.listHeldControl : un parcours en cours garde son fil', () => {
  let pool: Pool;
  let store: PgInboxStore;
  let tenantId: string;
  let autreTenant: string;
  let workflowId: string;
  let autreWorkflow: string;
  const DELAI_MS = 24 * 3600 * 1000;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgInboxStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-balayage-parcours') returning id`)).rows[0]!.id;
    autreTenant = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-balayage-parcours-autre') returning id`)).rows[0]!.id;
    workflowId = (await pool.query<{ id: string }>(`insert into workflows (tenant_id, name) values ($1, 'itest-balayage') returning id`, [tenantId])).rows[0]!.id;
    autreWorkflow = (await pool.query<{ id: string }>(`insert into workflows (tenant_id, name) values ($1, 'itest-balayage') returning id`, [autreTenant])).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[tenantId, autreTenant]]);
    await pool.end();
  });

  /** Un fil dont le dernier message vient de partir (le template du scénario), tenu par `owner` depuis `prisDepuis`. */
  async function fil(waId: string, owner: 'app_workflow' | 'app_human', prisDepuis: string | null): Promise<void> {
    await pool.query(
      `insert into conversations (tenant_id, wa_id, control_owner, control_changed_at, last_message_at, last_direction)
       values ($1, $2, $3, case when $4::text is null then null else now() - $4::interval end, now(), 'out')`,
      [tenantId, waId, owner, prisDepuis],
    );
  }
  /** Un parcours du contact, dans `status`, dont la dernière écriture remonte à `bougeDepuis`. */
  async function parcours(t: string, w: string, waId: string, status: string, bougeDepuis: string): Promise<void> {
    await pool.query(
      `insert into workflow_runs (workflow_id, tenant_id, wa_id, current_node, status, updated_at)
       values ($1, $2, $3, 'tpl', $4, now() - $5::interval)`,
      [w, t, waId, status, bougeDepuis],
    );
  }
  const dansLeLot = async (waId: string): Promise<boolean> =>
    (await store.listHeldControl(5000, DELAI_MS)).some((c) => c.tenantId === tenantId && c.waId === waId);

  it('🔴 une conversation NÉE d’un envoi (date de prise nulle) dont le parcours attend un clic reste au scénario', async () => {
    await fil('33600009301', 'app_workflow', null);
    await parcours(tenantId, workflowId, '33600009301', 'waiting', '0 seconds');
    expect(await dansLeLot('33600009301')).toBe(false);
  });

  it('🔴 une conversation qui DORT depuis des jours, où un scénario vient de démarrer, reste au scénario (MUTAC)', async () => {
    await fil('33600009302', 'app_workflow', '6 days');
    await parcours(tenantId, workflowId, '33600009302', 'waiting', '3 seconds');
    expect(await dansLeLot('33600009302')).toBe(false);
  });

  it('un parcours ENDORMI (une attente avant le bloc suivant) garde aussi le fil', async () => {
    await fil('33600009303', 'app_workflow', null);
    await parcours(tenantId, workflowId, '33600009303', 'sleeping', '1 hour');
    expect(await dansLeLot('33600009303')).toBe(false);
  });

  it('🔴 la soupape reste : un parcours qui n’a pas bougé depuis plus que le délai rend le fil', async () => {
    await fil('33600009304', 'app_workflow', '6 days');
    await parcours(tenantId, workflowId, '33600009304', 'waiting', '25 hours');
    expect(await dansLeLot('33600009304')).toBe(true);
  });

  it('sans parcours, ou avec un parcours terminé, le fil est rendu comme avant', async () => {
    await fil('33600009305', 'app_workflow', null);
    expect(await dansLeLot('33600009305')).toBe(true);
    await fil('33600009306', 'app_workflow', '6 days');
    await parcours(tenantId, workflowId, '33600009306', 'done', '0 seconds');
    expect(await dansLeLot('33600009306')).toBe(true);
  });

  it('🔴 le parcours d’un AUTRE espace pour le même numéro ne garde pas le fil', async () => {
    await fil('33600009307', 'app_workflow', null);
    await parcours(autreTenant, autreWorkflow, '33600009307', 'waiting', '0 seconds');
    expect(await dansLeLot('33600009307')).toBe(true);
  });

  it('un fil de l’équipe revient comme avant, parcours ou non (son délai se juge ailleurs)', async () => {
    await fil('33600009308', 'app_human', '3 hours');
    await parcours(tenantId, workflowId, '33600009308', 'waiting', '0 seconds');
    expect(await dansLeLot('33600009308')).toBe(true);
  });
});
