import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgBossQueue } from '../../src/queue/pgboss';
import { PgOpsStore } from '../../src/ops/store.pg';

const url = process.env.DATABASE_URL ?? '';

/** Un payload Meta d'un compte, fait des `changes` donnés. */
const payload = (...changes: unknown[]) => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba-itest', changes }] });

describe.skipIf(!url)('les webhooks reçus du balayage des webhooks muets (Postgres)', () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 2 }); });
  afterAll(async () => { await pool.end(); });

  it('🔴 les notifications du compte ne comptent pas ; un message, un payload mixte ou une forme inattendue, si', async () => {
    const schema = 'pgboss_itest_wm';
    const queue = new PgBossQueue(url, schema, { max: 2, supervise: false });
    await queue.start();
    try {
      // Forme relevée en production le 2026-11-06 : une connexion de numéro par Embedded Signup.
      const compte = { field: 'account_update', value: { event: 'PARTNER_ADDED', waba_info: { waba_id: '1' } } };
      const message = { field: 'messages', value: { metadata: { phone_number_id: '1' }, messages: [{ id: 'wamid.itest', from: '33600000000' }] } };
      await queue.enqueue('webhook', payload(compte));
      await queue.enqueue('webhook', payload({ field: 'phone_number_quality_update', value: { event: 'FLAGGED' } }));
      await queue.enqueue('webhook', payload(message));
      await queue.enqueue('webhook', payload(compte, message));
      await queue.enqueue('webhook', payload({ field: 'un_champ_neuf', value: { messages: [] } }));
      await queue.enqueue('webhook', payload({ value: {} }));
      await queue.enqueue('webhook', { object: 'whatsapp_business_account' });
      await queue.enqueue('webhook-status', payload(message));
      // Comptés : le message, le mixte, le champ inconnu, le change sans champ et le payload sans change.
      expect(await new PgOpsStore(pool, schema).webhooksRecusDepuis(60)).toBe(5);
    } finally {
      await queue.stop();
      await pool.query(`drop schema if exists ${schema} cascade`).catch(() => {});
    }
  });
});
