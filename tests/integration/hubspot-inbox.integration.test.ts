import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgInboxHubspotStore, UUID_ZERO } from '../../src/hubspot/inbox';

const url = process.env.DATABASE_URL ?? '';

/**
 * LE CURSEUR DU BALAYAGE `hubspot-inbox`, contre une vraie base (lot 1 de l'Inbox HubSpot).
 *
 * 🔴 Le défaut que ce test garde (relecture du lot, 2026-11-06) : `created_at` est stocké à la MICROSECONDE, le pilote
 * `pg` le rend dans un `Date` tronqué à la milliseconde. Un curseur écrit depuis ce `Date` vaut `.043` pour un message à
 * `.043689`, et `(created_at, id) > (curseur, id)` est vrai POUR LE MESSAGE DÉJÀ POUSSÉ : il serait relu et republié dans
 * l'Inbox HubSpot à chaque tour (15 s). Un faux store ne peut pas le voir, le défaut vit dans la conversion.
 *
 * Jamais joué en local (le `DATABASE_URL` local pointe une ancienne production), joué par le job `integration`.
 */
describe.skipIf(!url)('balayage Inbox HubSpot : le curseur garde la microseconde (Postgres)', () => {
  let pool: Pool;
  let store: PgInboxHubspotStore;
  let tenantId = '';
  let messageId = '';

  /** Un instant dont les trois derniers chiffres sont non nuls : c'est là que la troncature mord. */
  const INSTANT = '2026-11-06T10:00:00.043689Z';
  const LOIN = '2100-01-01T00:00:00.000000Z';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 3 });
    store = new PgInboxHubspotStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-inbox-hubspot') returning id`)).rows[0]!.id;
    const conversationId = (await pool.query<{ id: string }>(
      `insert into conversations (tenant_id, wa_id, last_message_at) values ($1, '33600009101', $2::timestamptz) returning id`,
      [tenantId, INSTANT],
    )).rows[0]!.id;
    messageId = (await pool.query<{ id: string }>(
      `insert into conversation_messages (conversation_id, direction, type, body, created_at)
       values ($1, 'in', 'text', 'bonjour', $2::timestamptz) returning id`,
      [conversationId, INSTANT],
    )).rows[0]!.id;
    await store.brancher(tenantId, '77');
    // Lot 1 bis : seules les conversations ENTRÉES dans l'Inbox sont lues par la suite du balayage.
    await store.ouvrirEntree(tenantId, conversationId);
    // Le curseur posé AVANT le message, pour que le premier tour le trouve.
    await pool.query(`update tenant_settings set hubspot_inbox_curseur_le = '2026-11-06T09:00:00Z' where tenant_id = $1`, [tenantId]);
  });

  afterAll(async () => {
    if (tenantId) await pool.query('delete from tenants where id = $1', [tenantId]).catch(() => {});
    await pool.end().catch(() => {});
  });

  const espace = async () => {
    const e = (await store.espacesBranches()).find((x) => x.tenantId === tenantId);
    expect(e).toBeDefined();
    return e!;
  };

  it('le message est lu une fois, avec son instant à la MICROSECONDE', async () => {
    const lus = await store.messagesApres(await espace(), LOIN, 50);
    expect(lus.map((m) => m.id)).toEqual([messageId]);
    expect(lus[0]!.createdAt).toBe(INSTANT);
  });

  it('🔴 le curseur avancé sur ce message ne le ramène PAS au tour suivant', async () => {
    const [m] = await store.messagesApres(await espace(), LOIN, 50);
    await store.avancer(tenantId, m!.createdAt, m!.id);
    const e = await espace();
    expect(e.curseurLe).toBe(INSTANT);
    expect(await store.messagesApres(e, LOIN, 50)).toEqual([]);
  });

  it('🔴 le curseur ne recule jamais (un tour qui a lu une borne plus ancienne ne le ramène pas en arrière)', async () => {
    await store.avancer(tenantId, '2026-11-06T09:30:00.000000Z', UUID_ZERO);
    expect((await espace()).curseurLe).toBe(INSTANT);
  });

  it('la borne est un instant à la microseconde, selon l’horloge de la base', async () => {
    expect(await store.borne()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });
});
