import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgInboxStore } from '../../src/inbox/store.pg';
import { PgTrackedLinkStore } from '../../src/links/tracked-links.pg';
import { PgContactStore } from '../../src/crm/contact-store.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LA DATE DE DERNIÈRE ACTIVITÉ D'UNE FICHE (migration 0273, spec des segments du 2026-10-31) : écrite par le message reçu
 * (réaction comprise) et par le clic attribué, jamais sur la fiche d'un autre espace au même numéro, et effacée avec la
 * fiche par la purge. Ce qu'aucun faux ne prouve : la jointure par la conversation et le scope de l'espace.
 *
 * ⚠️ Jamais joué en local (le `DATABASE_URL` local pointe l'ancienne production) : joué par le job `integration`.
 */
describe.skipIf(!url)('la dernière activité d’une fiche (Postgres)', () => {
  let pool: Pool;
  let inbox: PgInboxStore;
  let liens: PgTrackedLinkStore;
  let contacts: PgContactStore;
  let ici = '';
  let ailleurs = '';
  let ficheIci = '';
  let ficheAilleurs = '';
  const WA_ID = '33600400001';

  const activite = async (id: string): Promise<Date | null> =>
    (await pool.query<{ le: Date | null }>('select derniere_activite_le as le from contacts where id = $1', [id])).rows[0]!.le;
  const entrant = (type: string, body: string | null) => ({
    phoneNumberId: 'pn-itest', waId: WA_ID, messageId: `wamid.itest-activite-${randomUUID()}`, type, body, buttonPayload: null,
    profileName: null, field: 'messages',
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    inbox = new PgInboxStore(pool);
    liens = new PgTrackedLinkStore(pool);
    contacts = new PgContactStore(pool);
    ici = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-activite') returning id`)).rows[0]!.id;
    ailleurs = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-activite-autre') returning id`)).rows[0]!.id;
    const fiche = async (t: string) => (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [t, `+${WA_ID}`],
    )).rows[0]!.id;
    ficheIci = await fiche(ici);
    ficheAilleurs = await fiche(ailleurs);
  });
  afterAll(async () => {
    for (const t of [ici, ailleurs]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  it('🔴 un message reçu date la fiche de SON espace, pas celle d’un autre espace au même numéro', async () => {
    expect(await activite(ficheIci)).toBeNull();
    await inbox.recordInbound(ici, entrant('text', 'bonjour'));
    const le = await activite(ficheIci);
    expect(le).toBeInstanceOf(Date);
    expect(Date.now() - le!.getTime()).toBeLessThan(60_000);
    expect(await activite(ficheAilleurs)).toBeNull();
  });

  it('une réaction compte, et la date ne recule jamais', async () => {
    await pool.query(`update contacts set derniere_activite_le = now() - interval '40 days' where id = $1`, [ficheIci]);
    await inbox.recordInbound(ici, entrant('reaction', null));
    expect(Date.now() - (await activite(ficheIci))!.getTime()).toBeLessThan(60_000);
    await pool.query(`update contacts set derniere_activite_le = now() + interval '1 day' where id = $1`, [ficheIci]);
    const futur = await activite(ficheIci);
    await inbox.recordInbound(ici, entrant('text', 'encore'));
    expect(await activite(ficheIci)).toEqual(futur);
  });

  it('un message redélivré par Meta (même identifiant) ne redate pas la fiche', async () => {
    const m = entrant('text', 'une fois');
    await inbox.recordInbound(ici, m);
    await pool.query(`update contacts set derniere_activite_le = now() - interval '5 days' where id = $1`, [ficheIci]);
    const avant = await activite(ficheIci);
    await inbox.recordInbound(ici, m);
    expect(await activite(ficheIci)).toEqual(avant);
  });

  it('🔴 un clic attribué date la fiche dans l’espace du lien ; un clic anonyme, rien', async () => {
    const code = `itest${randomUUID().slice(0, 8)}`;
    await pool.query(
      `insert into tracked_links (code, tenant_id, template_name, template_language, button_index, destination)
       values ($1, $2, 'itest', 'fr', 0, 'https://client.fr')`,
      [code, ici],
    );
    await pool.query(`update contacts set derniere_activite_le = null where id = any($1::uuid[])`, [[ficheIci, ficheAilleurs]]);
    await liens.recordClick(code, ici);
    expect(await activite(ficheIci)).toBeNull();
    await liens.recordClick(code, ici, ficheIci);
    expect(await activite(ficheIci)).toBeInstanceOf(Date);
    // Un contact d'un autre espace présenté avec le lien d'ici n'est jamais daté.
    await liens.recordClick(code, ici, ficheAilleurs);
    expect(await activite(ficheAilleurs)).toBeNull();
    // Une fiche supprimée entre la lecture du jeton et le clic n'est pas datée.
    const supprimee = (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164, deleted_at) values ($1, '+33600400099', now()) returning id`, [ici],
    )).rows[0]!.id;
    await liens.recordClick(code, ici, supprimee);
    expect(await activite(supprimee)).toBeNull();
  });

  it('🔴 la purge de la fiche efface sa date', async () => {
    expect(await activite(ficheIci)).not.toBeNull();
    await contacts.purgeMany(ici, [ficheIci]);
    expect(await activite(ficheIci)).toBeNull();
  });
});
