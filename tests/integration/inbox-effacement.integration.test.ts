import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgInboxStore } from '../../src/inbox/store.pg';

/**
 * L'effacement des messages d'une conversation au oui (lot 1 du CSM virtuel, B10, livraison 2b) : `etatDesMessages` dit
 * combien de messages le bouton effacera et lequel est le plus récent, et le clic refuse si l'un ou l'autre a changé ;
 * `effacerMessages` est l'écriture du bouton « Effacer le contenu » de l'Inbox.
 *
 * 🔴 CE QUE CE TEST PROTÈGE : les deux sont bornés à l'espace et à LA conversation. Une conversation d'un autre espace se lit
 * `null` (jamais ses messages) et ne s'efface pas ; les voisines ne sont ni comptées ni effacées ; le plus récent est
 * celui du fil. Deux sous-requêtes scalaires et un `delete ... using` ne se prouvent pas en relisant leur texte : ce test
 * tape la VRAIE base.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ancienne base de production. La CI monte
 * un Postgres jetable (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';

const WA_ID = '33600000043';
const AUTRE_WA_ID = '33600000044';
const entrant = (messageId: string, body: string, waId = WA_ID) => ({
  phoneNumberId: 'pn-itest', waId, messageId, type: 'text', body, buttonPayload: null, profileName: null, field: 'messages',
});

describe.skipIf(!url)('effacement des messages d une conversation', () => {
  let pool: Pool;
  let store: PgInboxStore;
  let tenantId = '';
  let autreTenantId = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgInboxStore(pool);
    tenantId = (await pool.query<{ id: string }>(
      `insert into tenants (name) values ('itest-inbox-effacement') returning id`,
    )).rows[0]!.id;
    autreTenantId = (await pool.query<{ id: string }>(
      `insert into tenants (name) values ('itest-inbox-effacement-autre') returning id`,
    )).rows[0]!.id;
  });

  afterAll(async () => {
    for (const t of [tenantId, autreTenantId]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  it('🔴 lit les messages d’UNE conversation de l’espace seulement ; l’effacement les retire tous, la conversation reste', async () => {
    await store.recordInbound(tenantId, entrant('wamid.itest-eff-1', 'bonjour'));
    await store.recordInbound(tenantId, entrant('wamid.itest-eff-2', 'encore moi'));
    // Les voisines : une autre conversation de l'espace, et une de l'autre espace. Ni comptées, ni effacées.
    await store.recordInbound(tenantId, entrant('wamid.itest-eff-3', 'un autre contact', AUTRE_WA_ID));
    await store.recordInbound(autreTenantId, entrant('wamid.itest-eff-4', 'un autre client'));
    // Le second message de la conversation, une minute plus tard : le plus récent ne dépend pas de l'horloge du test.
    await pool.query(`update conversation_messages set created_at = created_at + interval '1 minute' where meta_message_id = 'wamid.itest-eff-2'`);
    const conversation = async (t: string, waId: string): Promise<string> => (await pool.query<{ id: string }>(
      'select id from conversations where tenant_id = $1 and wa_id = $2', [t, waId],
    )).rows[0]!.id;
    const message = async (wamid: string): Promise<string> => (await pool.query<{ id: string }>(
      'select id from conversation_messages where meta_message_id = $1', [wamid],
    )).rows[0]!.id;
    const conv = await conversation(tenantId, WA_ID);
    const voisine = await conversation(tenantId, AUTRE_WA_ID);
    const ailleurs = await conversation(autreTenantId, WA_ID);
    expect(await store.etatDesMessages(tenantId, conv)).toEqual({ nombre: 2, dernier: await message('wamid.itest-eff-2') });
    // Un autre espace, ou une conversation inconnue : `null`, jamais ses messages.
    expect(await store.etatDesMessages(autreTenantId, conv)).toBeNull();
    expect(await store.etatDesMessages(tenantId, '00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await store.effacerMessages(autreTenantId, conv)).toBeNull();
    expect(await store.etatDesMessages(tenantId, conv)).toMatchObject({ nombre: 2 });
    expect(await store.effacerMessages(tenantId, conv)).toBe(2);
    expect(await store.etatDesMessages(tenantId, conv)).toEqual({ nombre: 0, dernier: null });
    expect(await store.etatDesMessages(tenantId, voisine)).toEqual({ nombre: 1, dernier: await message('wamid.itest-eff-3') });
    expect(await store.etatDesMessages(autreTenantId, ailleurs)).toEqual({ nombre: 1, dernier: await message('wamid.itest-eff-4') });
  });
});
