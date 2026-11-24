import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgContactStore, type BulkTarget } from '../../src/crm/contact-store.pg';

/**
 * L'EXPORT CSV D'UNE SÉLECTION (`PgContactStore.lignesAExporter`), sur une vraie base : les fiches vivantes de l'espace,
 * la cible de l'action en masse, les plus récentes d'abord, la limite, et des champs de la fiche les SEULES clés
 * demandées. Ce que la route en fait : `tests/contacts-export.test.ts`.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ancienne base de production. La CI monte
 * un Postgres jetable pour ça (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';
const tel = (n: number) => `+3369992${String(n).padStart(4, '0')}`;

describe.skipIf(!url)('l’export CSV d’une sélection de contacts', () => {
  let pool: Pool;
  let store: PgContactStore;
  let t = '';
  let autre = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgContactStore(pool);
    t = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-export-contacts') returning id`)).rows[0]!.id;
    autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-export-contacts-autre') returning id`)).rows[0]!.id;
  });
  beforeEach(async () => {
    await pool.query('delete from contacts where tenant_id = any($1::uuid[])', [[t, autre]]);
  });
  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[t, autre]]);
    await pool.end();
  });

  async function creer(tenant: string, n: number, o: { creeLe?: string; champs?: Record<string, unknown>; tags?: string[] } = {}): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164, profile_name, fields, tags, opt_in_status, created_at)
       values ($1, $2, $3, $4, $5, 'opted_in', $6) returning id`,
      [tenant, tel(n), `Contact ${n}`, JSON.stringify(o.champs ?? {}), o.tags ?? [], o.creeLe ?? '2026-01-01T10:00:00Z'],
    );
    return r.rows[0]!.id;
  }
  const TOUT: BulkTarget = { filters: {}, excludeIds: [] };

  it('🔴 les fiches vivantes de l’espace seul, les plus récentes d’abord, jusqu’à la limite', async () => {
    await creer(t, 1, { creeLe: '2026-01-01T10:00:00Z' });
    await creer(t, 2, { creeLe: '2026-01-03T10:00:00Z' });
    await creer(t, 3, { creeLe: '2026-01-02T10:00:00Z' });
    const supprimee = await creer(t, 4, { creeLe: '2026-01-04T10:00:00Z' });
    await pool.query('update contacts set deleted_at = now() where id = $1', [supprimee]);
    await creer(autre, 5, { creeLe: '2026-01-05T10:00:00Z' });

    const lues = await store.lignesAExporter(t, TOUT, [], 10);
    expect(lues.map((l) => l.phoneE164)).toEqual([tel(2), tel(3), tel(1)]);
    expect((await store.lignesAExporter(t, TOUT, [], 2)).map((l) => l.phoneE164)).toEqual([tel(2), tel(3)]);
    // Nommée par son identifiant, une fiche d'un autre espace n'est pas rendue.
    const ailleurs = (await pool.query<{ id: string }>('select id from contacts where tenant_id = $1', [autre])).rows[0]!.id;
    expect(await store.lignesAExporter(t, { ids: [ailleurs, supprimee] }, [], 10)).toEqual([]);
  });

  it('🔴 des champs de la fiche ne remontent que les clés demandées', async () => {
    await creer(t, 1, { champs: { prenom: 'Léa', ville: 'Lyon', hs_contact_secteur: 'BTP', score: 12 }, tags: ['vip'] });
    const [l] = await store.lignesAExporter(t, TOUT, ['prenom', 'score', 'absent'], 10);
    expect(l).toMatchObject({
      phoneE164: tel(1), bsuid: null, externalId: null, profileName: 'Contact 1', optInStatus: 'opted_in',
      createdAt: '2026-01-01T10:00:00.000Z',
    });
    expect(l!.champs).toEqual({ prenom: 'Léa', score: 12 });
    // Aucune clé demandée : un objet vide, jamais `null` ni la fiche entière.
    expect((await store.lignesAExporter(t, TOUT, [], 10))[0]!.champs).toEqual({});
  });

  it('🔴 la liste paginée (`query`) a un ordre total : des fiches de même date ne se répètent ni ne se perdent d’une page à l’autre', async () => {
    // Un import pose la même date sur tout son lot.
    const ids: string[] = [];
    for (let n = 1; n <= 5; n++) ids.push(await creer(t, n, { creeLe: '2026-02-01T10:00:00Z' }));
    const pages = [0, 2, 4].map((offset) => store.query(t, {}, 2, offset));
    const lues = (await Promise.all(pages)).flat().map((c) => c.id);
    expect(lues).toEqual([...ids].sort().reverse());
  });

  it('la cible par filtres et exclusions est celle de l’action en masse', async () => {
    const a = await creer(t, 1, { tags: ['vip'] });
    await creer(t, 2, { tags: ['vip'] });
    await creer(t, 3);
    const lues = await store.lignesAExporter(t, { filters: { tags: ['vip'] }, excludeIds: [a] }, [], 10);
    expect(lues.map((l) => l.phoneE164)).toEqual([tel(2)]);
  });
});
