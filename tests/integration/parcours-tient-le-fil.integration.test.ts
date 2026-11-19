import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgInboxStore } from '../../src/inbox/store.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LA RÈGLE UNIQUE « UN PARCOURS TIENT LE FIL », CONTRE UNE VRAIE BASE (2026-11-19, `src/inbox/parcours-tient-le-fil.ts`).
 *
 * Tout se joue dans le SQL : le statut du parcours, sa soupape de 24 h, l'espace, et la marge du démarrage qui ne compte
 * que les envois du scénario et des campagnes. Sa lecture (`parcoursTientLeFil`, la remise et la prise par l'équipe) et
 * l'écriture gardée (`setControlOwner` avec `saufParcours`, le balayage et la prise par l'équipe) partagent le même
 * prédicat ; les deux sont exercées ici. `marquerEscalade` et `listHeldControl` ont leurs propres fichiers.
 */
describe.skipIf(!url)('la règle unique : un parcours tient le fil', () => {
  let pool: Pool;
  let store: PgInboxStore;
  let tenantId: string;
  let autreTenant: string;
  let wf: string;
  let autreWf: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgInboxStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-tient-le-fil') returning id`)).rows[0]!.id;
    autreTenant = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-tient-le-fil-autre') returning id`)).rows[0]!.id;
    wf = (await pool.query<{ id: string }>(`insert into workflows (tenant_id, name) values ($1, 'itest') returning id`, [tenantId])).rows[0]!.id;
    autreWf = (await pool.query<{ id: string }>(`insert into workflows (tenant_id, name) values ($1, 'itest') returning id`, [autreTenant])).rows[0]!.id;
  });
  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[tenantId, autreTenant]]);
    await pool.end();
  });

  async function fil(waId: string, owner = 'app_workflow'): Promise<string> {
    return (await pool.query<{ id: string }>(
      `insert into conversations (tenant_id, wa_id, control_owner, last_message_at, last_direction) values ($1, $2, $3, now(), 'out') returning id`,
      [tenantId, waId, owner],
    )).rows[0]!.id;
  }
  async function parcours(t: string, w: string, waId: string, status: string, bougeDepuis: string): Promise<void> {
    await pool.query(
      `insert into workflow_runs (workflow_id, tenant_id, wa_id, current_node, status, updated_at) values ($1, $2, $3, 'b', $4, now() - $5::interval)`,
      [w, t, waId, status, bougeDepuis],
    );
  }
  async function message(conv: string, direction: 'in' | 'out', origin: string | null, ilYa: string): Promise<void> {
    await pool.query(
      `insert into conversation_messages (conversation_id, direction, type, body, origin, created_at) values ($1, $2, 'text', 'x', $3, now() - $4::interval)`,
      [conv, direction, origin, ilYa],
    );
  }
  const tient = (waId: string): Promise<boolean> => store.parcoursTientLeFil(tenantId, waId);

  it('🔴 un parcours qui ATTEND ou qui DORT (une Attente) tient le fil', async () => {
    await fil('33600009501');
    await parcours(tenantId, wf, '33600009501', 'waiting', '1 minute');
    expect(await tient('33600009501')).toBe(true);
    await fil('33600009502');
    await parcours(tenantId, wf, '33600009502', 'sleeping', '3 hours');
    expect(await tient('33600009502')).toBe(true);
  });

  it('🔴 la soupape : un parcours qui n’a rien écrit depuis plus de 24 h ne tient plus le fil', async () => {
    await fil('33600009503');
    await parcours(tenantId, wf, '33600009503', 'waiting', '25 hours');
    expect(await tient('33600009503')).toBe(false);
  });

  it('un parcours fini (`done`) ou remonté (`inbox`) ne tient pas le fil ; sans parcours non plus', async () => {
    await fil('33600009504');
    await parcours(tenantId, wf, '33600009504', 'done', '0 seconds');
    await parcours(tenantId, wf, '33600009504', 'inbox', '0 seconds');
    expect(await tient('33600009504')).toBe(false);
    expect(await tient('33600009599')).toBe(false); // ni conversation ni parcours
  });

  it('🔴 le parcours d’un AUTRE espace pour le même numéro ne tient pas ce fil', async () => {
    await fil('33600009505');
    await parcours(autreTenant, autreWf, '33600009505', 'waiting', '0 seconds');
    expect(await tient('33600009505')).toBe(false);
  });

  it('🔴 la fenêtre du démarrage : un envoi du scénario ou d’une campagne de moins de 2 min tient le fil, parcours pas encore écrit', async () => {
    const a = await fil('33600009506');
    await message(a, 'out', 'scenario', '3 seconds');
    expect(await tient('33600009506')).toBe(true);
    const b = await fil('33600009507');
    await message(b, 'out', 'campagne', '30 seconds');
    expect(await tient('33600009507')).toBe(true);
    // Passé la marge, l'envoi seul ne tient plus rien.
    const c = await fil('33600009508');
    await message(c, 'out', 'scenario', '3 minutes');
    expect(await tient('33600009508')).toBe(false);
  });

  it('🔴 la marge se FERME à la réponse du contact : sa réponse à une campagne de template seul doit être traitée (relecture)', async () => {
    // Démontré par la relecture du 2026-11-19 : un contact qui répondait en moins de 2 min à une campagne sans scénario
    // était ignoré de la remise, de la prise par l'équipe et du mode application, qui lisent tous cette règle.
    const a = await fil('33600009513');
    await message(a, 'out', 'campagne', '20 seconds');
    await message(a, 'in', null, '5 seconds');
    expect(await tient('33600009513')).toBe(false);
    // Même règle pour un scénario fini qui a écrit juste avant la réponse « à côté » du contact.
    const b = await fil('33600009514');
    await message(b, 'out', 'scenario', '40 seconds');
    await message(b, 'in', null, '1 second'); // pas « 0 » : l'horloge du banc est grossière, l'ordre doit être sûr
    expect(await tient('33600009514')).toBe(false);
    // Un nouvel envoi APRÈS la réponse rouvre la marge (le scénario repart et écrit d'abord).
    await message(b, 'out', 'scenario', '0 seconds');
    expect(await tient('33600009514')).toBe(true);
  });

  it('🔴 l’écho de l’agent de Meta, une réponse de l’équipe ou un message du contact ne comptent pas dans la marge', async () => {
    const a = await fil('33600009509');
    await message(a, 'out', 'mba', '2 seconds');
    await message(a, 'out', 'humain', '2 seconds');
    await message(a, 'in', null, '1 second');
    expect(await tient('33600009509')).toBe(false);
  });

  it('🔴 l’écriture gardée (`saufParcours`) ne retire pas un fil `app_workflow` qu’un parcours tient', async () => {
    await fil('33600009510');
    await parcours(tenantId, wf, '33600009510', 'sleeping', '10 seconds');
    expect(await store.setControlOwner(tenantId, '33600009510', 'mba', { par: { cause: 'automatique : test' }, only: ['app_workflow'], saufParcours: true })).toBe(false);
    const owner = async (w: string): Promise<string> =>
      (await pool.query<{ control_owner: string }>(`select control_owner from conversations where tenant_id = $1 and wa_id = $2`, [tenantId, w])).rows[0]!.control_owner;
    expect(await owner('33600009510')).toBe('app_workflow');
    // Sans l'option (un geste délibéré), l'écriture a lieu.
    expect(await store.setControlOwner(tenantId, '33600009510', 'app_human', { par: { cause: 'automatique : test' } })).toBe(true);
    // Sans parcours, l'écriture gardée a lieu.
    await fil('33600009511');
    expect(await store.setControlOwner(tenantId, '33600009511', 'mba', { par: { cause: 'automatique : test' }, saufParcours: true })).toBe(true);
    // La règle ne vise que le fil d'un scénario : un fil de l'équipe se rend, parcours ou non.
    await fil('33600009512', 'app_human');
    await parcours(tenantId, wf, '33600009512', 'waiting', '0 seconds');
    expect(await store.setControlOwner(tenantId, '33600009512', 'mba', { par: { cause: 'automatique : test' }, saufParcours: true })).toBe(true);
  });
});
