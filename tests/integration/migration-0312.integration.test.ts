import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgContactStore } from '../../src/crm/contact-store.pg';

const url = process.env.DATABASE_URL ?? '';
const SQL = readFileSync(new URL('../../db/migrations/0312_contacts_reponse_clic.sql', import.meta.url), 'utf8');

/**
 * LE REMPLISSAGE DE LA 0312 contre un VRAI Postgres (segments Shopify enrichis, lot 4) : la migration est rejouée telle
 * quelle, dans sa transaction, sur des données semées. Ce qu'aucun test du texte ne prouve : le dernier message ENTRANT
 * (réaction comprise, sortant ignoré), le dernier clic ATTRIBUÉ (anonyme ignoré), 🔴 jamais une donnée d'un autre
 * espace (une conversation ou un clic incohérents qui désignent la fiche), 🔴 jamais une fiche purgée (ses clics
 * gardent son identifiant), une date plus récente gardée, et la migration rejouée sans rien changer.
 *
 * ⚠️ Jamais joué en local contre `DATABASE_URL` (l'ancienne production) : joué par le job `integration`.
 */
describe.skipIf(!url)('le remplissage de la migration 0312 (Postgres)', () => {
  let pool: Pool;
  let ici = '';
  let ailleurs = '';
  let A = '';
  let B = '';
  let C = '';
  let D = '';
  const il = (jours: number): Date => new Date(Date.now() - jours * 86_400_000);
  const FUTUR = new Date(Date.now() + 86_400_000);

  const dates = async (id: string): Promise<{ reponse: Date | null; clic: Date | null }> =>
    (await pool.query<{ reponse: Date | null; clic: Date | null }>(
      'select derniere_reponse_le as reponse, dernier_clic_le as clic from contacts where id = $1', [id],
    )).rows[0]!;
  const jouerLaMigration = async (): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(SQL);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 2 });
    const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    ici = await espace('itest-0312');
    ailleurs = await espace('itest-0312-autre');
    const fiche = async (t: string, tel: string) => (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [t, tel],
    )).rows[0]!.id;
    A = await fiche(ici, '+33600312001');
    B = await fiche(ici, '+33600312002');
    C = await fiche(ici, '+33600312003');
    D = await fiche(ici, '+33600312004');
    const conversation = async (t: string, contact: string) => (await pool.query<{ id: string }>(
      `insert into conversations (tenant_id, wa_id, contact_id) values ($1, $2, $3) returning id`, [t, randomUUID(), contact],
    )).rows[0]!.id;
    const message = (conv: string, direction: 'in' | 'out', type: string, le: Date) => pool.query(
      `insert into conversation_messages (conversation_id, direction, type, body, created_at) values ($1, $2, $3, 'x', $4)`,
      [conv, direction, type, le],
    );
    // A : un texte il y a 10 jours, une RÉACTION il y a 3 jours (la plus récente des entrantes), un SORTANT il y a 1 jour.
    const convA = await conversation(ici, A);
    await message(convA, 'in', 'text', il(10));
    await message(convA, 'in', 'reaction', il(3));
    await message(convA, 'out', 'text', il(1));
    // Une conversation INCOHÉRENTE : dans l'autre espace, elle désigne A, avec un entrant il y a 12 heures.
    await message(await conversation(ailleurs, A), 'in', 'text', il(0.5));
    // D : un entrant il y a 2 jours, mais déjà daté dans le futur (rien ne recule).
    await message(await conversation(ici, D), 'in', 'text', il(2));

    const lien = async (t: string) => {
      const code = `itest${randomUUID().slice(0, 8)}`;
      await pool.query(
        `insert into tracked_links (code, tenant_id, template_name, template_language, button_index, destination)
         values ($1, $2, 'itest', 'fr', 0, 'https://client.fr')`, [code, t],
      );
      return code;
    };
    const clic = (code: string, t: string, contact: string | null, le: Date) => pool.query(
      `insert into tracked_link_clicks (code, tenant_id, contact_id, at) values ($1, $2, $3, $4)`, [code, t, contact, le],
    );
    // B : deux clics attribués (20 et 5 jours), un clic ANONYME d'hier ; un clic INCOHÉRENT dans l'autre espace, il y a une heure.
    const codeIci = await lien(ici);
    await clic(codeIci, ici, B, il(20));
    await clic(codeIci, ici, B, il(5));
    await clic(codeIci, ici, null, il(1));
    await clic(await lien(ailleurs), ailleurs, B, il(1 / 24));
    // C : un clic attribué, puis la purge de la fiche (qui garde ses clics, la clé étrangère ne jouant qu'à la suppression).
    await clic(codeIci, ici, C, il(4));
    await new PgContactStore(pool).purgeMany(ici, [C]);
    // Et un message entrant resté rattaché à la fiche purgée (une donnée incohérente) : il ne la redate pas non plus.
    await message(await conversation(ici, C), 'in', 'text', il(4));

    // L'état d'avant la migration : les deux colonnes vides, sauf D, déjà daté dans le futur.
    await pool.query('update contacts set derniere_reponse_le = null, dernier_clic_le = null where tenant_id = any($1::uuid[])', [[ici, ailleurs]]);
    await pool.query('update contacts set derniere_reponse_le = $2 where id = $1', [D, FUTUR]);
    await jouerLaMigration();
  });

  afterAll(async () => {
    for (const t of [ici, ailleurs]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  const proche = (d: Date | null, attendu: Date): void => {
    expect(d).toBeInstanceOf(Date);
    expect(Math.abs(d!.getTime() - attendu.getTime())).toBeLessThan(5_000);
  };

  it('🔴 la dernière réponse : le dernier ENTRANT (réaction comprise), jamais un sortant, jamais un autre espace', async () => {
    const a = await dates(A);
    proche(a.reponse, il(3));
    expect(a.clic).toBeNull();
  });

  it('🔴 le dernier clic : le dernier ATTRIBUÉ, jamais un clic anonyme, jamais un autre espace', async () => {
    const b = await dates(B);
    proche(b.clic, il(5));
    expect(b.reponse).toBeNull();
  });

  it('🔴 une fiche purgée ne reçoit rien, alors que son clic la désigne encore', async () => {
    expect((await pool.query('select 1 from tracked_link_clicks where contact_id = $1', [C])).rowCount).toBe(1);
    expect(await dates(C)).toEqual({ reponse: null, clic: null });
  });

  it('une date plus récente est gardée ; la migration rejouée ne change rien', async () => {
    expect((await dates(D)).reponse).toEqual(FUTUR);
    const avant = await Promise.all([A, B, C, D].map(dates));
    await jouerLaMigration();
    expect(await Promise.all([A, B, C, D].map(dates))).toEqual(avant);
  });
});
