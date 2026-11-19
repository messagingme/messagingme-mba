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

/**
 * Les cas de la relecture du correctif du balayage (2026-11-19, `71981d5f6`) : chacun attrape une mutation que les cas
 * ci-dessus laissent passer (le délai écrit en dur, `status <> 'done'`, le numéro sans l'espace). Chaque cas a son
 * espace, pour ne dépendre d'aucun ordre. Le dernier, qui documentait la fenêtre du démarrage, est inversé : la règle
 * unique (`src/inbox/parcours-tient-le-fil.ts`) la ferme par l'envoi du scénario, enregistré avant le parcours.
 */
describe.skipIf(!url)('PgInboxStore.listHeldControl : les cas de la relecture', () => {
  let pool: Pool;
  let store: PgInboxStore;
  const espaces: string[] = [];
  const H = 3600 * 1000;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgInboxStore(pool);
  });
  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [espaces]);
    await pool.end();
  });

  async function espace(nom: string): Promise<{ t: string; w: string }> {
    const t = (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    espaces.push(t);
    const w = (await pool.query<{ id: string }>(`insert into workflows (tenant_id, name) values ($1, 'rv') returning id`, [t])).rows[0]!.id;
    return { t, w };
  }
  async function fil(t: string, waId: string, prisDepuis: string | null): Promise<string> {
    return (await pool.query<{ id: string }>(
      `insert into conversations (tenant_id, wa_id, control_owner, control_changed_at, last_message_at, last_direction)
       values ($1, $2, 'app_workflow', case when $3::text is null then null else now() - $3::interval end, now(), 'out') returning id`,
      [t, waId, prisDepuis],
    )).rows[0]!.id;
  }
  async function parcours(t: string, w: string, waId: string, status: string, bougeDepuis: string): Promise<void> {
    await pool.query(
      `insert into workflow_runs (workflow_id, tenant_id, wa_id, current_node, status, updated_at)
       values ($1, $2, $3, 'tpl', $4, now() - $5::interval)`,
      [w, t, waId, status, bougeDepuis],
    );
  }
  const dansLeLot = async (t: string, waId: string, delaiMs: number): Promise<boolean> =>
    (await store.listHeldControl(5000, delaiMs)).some((c) => c.tenantId === t && c.waId === waId);

  it('(a) délai 0 : aucun fil de scénario dans le lot, parcours ou non', async () => {
    const { t } = await espace('rv-zero');
    await fil(t, '33600009401', null);
    expect(await dansLeLot(t, '33600009401', 0)).toBe(false);
  });

  it('(b) un parcours `inbox` récent ne garde pas le fil', async () => {
    const { t, w } = await espace('rv-inbox');
    await fil(t, '33600009402', null);
    await parcours(t, w, '33600009402', 'inbox', '0 seconds');
    expect(await dansLeLot(t, '33600009402', 24 * H)).toBe(true);
  });

  it('(c) un parcours périmé ET un parcours frais : le frais garde le fil', async () => {
    const { t, w } = await espace('rv-deux');
    await fil(t, '33600009403', '6 days');
    await parcours(t, w, '33600009403', 'waiting', '30 hours');
    await parcours(t, w, '33600009403', 'sleeping', '10 minutes');
    expect(await dansLeLot(t, '33600009403', 24 * H)).toBe(false);
  });

  it('(d) le parcours frais d’un AUTRE contact du même espace ne garde pas ce fil', async () => {
    const { t, w } = await espace('rv-autre-contact');
    await fil(t, '33600009404', null);
    await parcours(t, w, '33600009499', 'waiting', '0 seconds');
    expect(await dansLeLot(t, '33600009404', 24 * H)).toBe(true);
  });

  it('(e) la garde suit le délai PASSÉ, pas 24 h écrites en dur', async () => {
    const { t, w } = await espace('rv-delai');
    await fil(t, '33600009405', '6 days');
    await parcours(t, w, '33600009405', 'waiting', '3 hours');
    expect(await dansLeLot(t, '33600009405', 2 * H)).toBe(true);
    expect(await dansLeLot(t, '33600009405', 24 * H)).toBe(false);
  });

  it('🔴 (f) LA FENÊTRE DU DÉMARRAGE : premier envoi parti, parcours pas encore écrit, le fil reste au scénario', async () => {
    // L'état de `runFrom` entre `apply` et `runs.start` : le template est enregistré dans la conversation, le parcours
    // n'existe pas encore. L'envoi du scénario tient le fil pendant la marge du démarrage.
    const { t } = await espace('rv-fenetre-demarrage');
    const conv = await fil(t, '33600009406', null);
    await pool.query(
      `insert into conversation_messages (conversation_id, direction, type, body, origin) values ($1, 'out', 'template', 'Template « tpl »', 'scenario')`,
      [conv],
    );
    expect(await dansLeLot(t, '33600009406', 24 * H)).toBe(false);
  });

  it('(g) la phrase de l’agent de Meta, toute récente, ne garde pas le fil d’un scénario fini', async () => {
    const { t } = await espace('rv-echo-agent');
    const conv = await fil(t, '33600009407', '2 days');
    await pool.query(
      `insert into conversation_messages (conversation_id, direction, type, body, origin) values ($1, 'out', 'mba', 'Bonjour', 'mba')`,
      [conv],
    );
    expect(await dansLeLot(t, '33600009407', 24 * H)).toBe(true);
  });
});
