import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgInboxStore } from '../../src/inbox/store.pg';

/**
 * La loupe de l'Inbox (`recherche` de `listConversations`, demande de Julien du 2026-11-26) : nom, numéro, dernier
 * message, combinée au dossier, jokers de LIKE littéraux, et jamais d'un espace à l'autre.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ancienne base de production. La CI
 * monte un Postgres jetable (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';

const entrant = (waId: string, messageId: string, body: string, profileName: string | null) => ({
  phoneNumberId: 'pn-itest', waId, messageId, type: 'text', body, buttonPayload: null, profileName, field: 'messages',
});

describe.skipIf(!url)('la loupe de l’Inbox', () => {
  let pool: Pool;
  let store: PgInboxStore;
  let tenantId = '';
  let autreTenantId = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgInboxStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-inbox-recherche') returning id`)).rows[0]!.id;
    autreTenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-inbox-recherche-autre') returning id`)).rows[0]!.id;
    await store.recordInbound(tenantId, entrant('33611110001', 'wamid.itest-rech-1', 'ma commande 100% arrivée', 'Marie Dupont'));
    await store.recordInbound(tenantId, entrant('33622220002', 'wamid.itest-rech-2', 'bonjour', 'Paul Martin'));
    await store.recordInbound(autreTenantId, entrant('33633330003', 'wamid.itest-rech-3', 'bonjour', 'Marie Autre'));
    // `recordInbound` n'écrit que le message : la fiche du contact, qui porte le nom, est créée par le webhook. Ici, à
    // la main, rattachée à sa conversation comme en production.
    for (const [espace, waId, nom] of [[tenantId, '33611110001', 'Marie Dupont'], [tenantId, '33622220002', 'Paul Martin'], [autreTenantId, '33633330003', 'Marie Autre']]) {
      const contact = (await pool.query<{ id: string }>(
        `insert into contacts (tenant_id, phone_e164, profile_name) values ($1, $2, $3) returning id`, [espace, `+${waId}`, nom],
      )).rows[0]!.id;
      await pool.query('update conversations set contact_id = $1 where tenant_id = $2 and wa_id = $3', [contact, espace, waId]);
    }
  });

  afterAll(async () => {
    for (const t of [tenantId, autreTenantId]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  const numeros = async (recherche: string, autres: { archivees?: boolean } = {}): Promise<string[]> =>
    (await store.listConversations(tenantId, { recherche, ...autres })).map((c) => c.waId).sort();

  it('par nom, sans casse, et jamais dans un autre espace', async () => {
    expect(await numeros('marie')).toEqual(['33611110001']);
  });

  it('par numéro tapé avec + et espaces', async () => {
    expect(await numeros('+33 6 2222')).toEqual(['33622220002']);
  });

  it('par le dernier message', async () => {
    expect(await numeros('COMMANDE')).toEqual(['33611110001']);
  });

  it('🔴 les jokers de LIKE sont littéraux : « % » ne trouve que le message qui porte « % »', async () => {
    expect(await numeros('%')).toEqual(['33611110001']);
    expect(await numeros('_')).toEqual([]);
  });

  it('se combine au dossier, et vide rend tout', async () => {
    expect(await numeros('marie', { archivees: true })).toEqual([]);
    expect(await numeros('  ')).toEqual(['33611110001', '33622220002']);
  });
});
