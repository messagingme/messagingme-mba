import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgInboxStore } from '../../src/inbox/store.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * Le message du client qui attend encore une réponse (`saisieSansReponse`), lu par le bloc « Envoyer au MBA »
 * (2026-11-12). Joué par le job `integration` de la CI, jamais en local (le DATABASE_URL du poste pointe l'ancienne
 * production). Ce qu'il verrouille : le dernier message vient du client -> son texte ; le scénario a parlé après ->
 * rien ; une réaction après notre message ne compte pas ; un appui de bouton sans texte -> rien ; un autre espace n'est
 * jamais lu.
 */
describe.skipIf(!url)('PgInboxStore.saisieSansReponse (Postgres)', () => {
  let pool: Pool;
  let store: PgInboxStore;
  let tenant: string;
  let autre: string;
  const WA = '33650000777';

  const espace = async (nom: string): Promise<string> =>
    (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
  const fil = async (t: string): Promise<string> =>
    (await pool.query<{ id: string }>(`insert into conversations (tenant_id, wa_id) values ($1, $2) returning id`, [t, WA])).rows[0]!.id;
  const message = async (conv: string, direction: 'in' | 'out', type: string, body: string | null, at: string) => {
    await pool.query(
      `insert into conversation_messages (conversation_id, direction, type, body, created_at) values ($1, $2, $3, $4, $5::timestamptz)`,
      [conv, direction, type, body, at],
    );
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    store = new PgInboxStore(pool);
    tenant = await espace('itest-saisie-sans-reponse');
    autre = await espace('itest-saisie-sans-reponse-autre');
  });

  afterAll(async () => {
    for (const id of [tenant, autre]) if (id) await pool.query('delete from tenants where id = $1', [id]);
    await pool.end();
  });

  it('🔴 rend le message du client tant qu’il est le dernier, puis rien dès que le scénario a parlé après lui', async () => {
    const conv = await fil(tenant);
    expect(await store.saisieSansReponse(tenant, WA)).toBeNull(); // aucune conversation écrite
    await message(conv, 'out', 'template', 'Template « envoi_devis »', '2026-11-12T16:00:00Z');
    expect(await store.saisieSansReponse(tenant, WA)).toBeNull(); // le dernier est le nôtre
    await message(conv, 'in', 'text', 'Avez-vous une carence ?', '2026-11-12T16:00:10Z');
    expect(await store.saisieSansReponse(tenant, WA)).toBe('Avez-vous une carence ?');
    await message(conv, 'out', 'text', 'Je vous écoute, posez-nous votre question', '2026-11-12T16:00:20Z');
    expect(await store.saisieSansReponse(tenant, WA)).toBeNull(); // le scénario a répondu
    await message(conv, 'in', 'reaction', '👍', '2026-11-12T16:00:30Z');
    expect(await store.saisieSansReponse(tenant, WA)).toBeNull(); // une réaction n'est pas un message
    await message(conv, 'in', 'button', null, '2026-11-12T16:00:40Z');
    expect(await store.saisieSansReponse(tenant, WA)).toBeNull(); // un appui sans texte
    // Un autre espace, même numéro : jamais lu.
    const conv2 = await fil(autre);
    await message(conv2, 'in', 'text', 'message d’un autre espace', '2026-11-12T16:01:00Z');
    expect(await store.saisieSansReponse(tenant, WA)).toBeNull();
    expect(await store.saisieSansReponse(autre, WA)).toBe('message d’un autre espace');
  });
});
