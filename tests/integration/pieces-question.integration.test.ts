import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgPiecesQuestion } from '../../src/workflow/pieces-question.pg';
import { PgContactStore } from '../../src/crm/contact-store.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LA TABLE DES PIÈCES D'UN BLOC QUESTION (migration 0269, spec du 2026-11-02).
 *
 * 🔴 POURQUOI EN INTÉGRATION. Ce que la table garantit n'existe qu'en base : une seule pièce par contact et par champ
 * (la clé primaire, sur laquelle l'écriture fait son upsert), et rien qui survive à l'espace ou à la fiche supprimés
 * (les cascades). La purge d'un contact, qui ANONYMISE la fiche au lieu de la supprimer, efface ses lignes elle-même.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ancienne base de production. La CI monte
 * un Postgres jetable pour ça (job `integration`).
 */
describe.skipIf(!url)('la table des pièces d’un bloc Question (Postgres, 0269)', () => {
  let pool: Pool;
  let t = '';
  let contact = '';
  const piece = (cle: string, wamid: string, mention: string) => pool.query(
    `insert into pieces_question (tenant_id, contact_id, cle_champ, meta_message_id, mention) values ($1, $2, $3, $4, $5)`,
    [t, contact, cle, wamid, mention],
  );
  const lignes = async () => (await pool.query<{ n: string }>(
    'select count(*)::text as n from pieces_question where tenant_id = $1', [t],
  )).rows[0]!.n;

  beforeAll(async () => { pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 }); });
  afterAll(async () => { if (t) await pool.query('delete from tenants where id = $1', [t]); await pool.end(); });
  beforeEach(async () => {
    if (t) await pool.query('delete from tenants where id = $1', [t]);
    t = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-pieces-question') returning id`)).rows[0]!.id;
    contact = (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164) values ($1, '+33600000269') returning id`, [t],
    )).rows[0]!.id;
  });

  it('une seule pièce par contact et par champ : un second insert brut est refusé (23505)', async () => {
    await piece('piece_identite', 'wamid.A', 'Pièce reçue le 02/11/2026 à 14 h 32 (photo)');
    await expect(piece('piece_identite', 'wamid.B', 'Pièce reçue le 02/11/2026 à 14 h 40 (pdf)')).rejects.toMatchObject({ code: '23505' });
    await piece('justificatif', 'wamid.B', 'Pièce reçue le 02/11/2026 à 14 h 40 (pdf)');
    expect(await lignes()).toBe('2');
  });

  it('la fiche supprimée emporte ses pièces, l’espace supprimé aussi', async () => {
    await piece('piece_identite', 'wamid.A', 'Pièce reçue le 02/11/2026 à 14 h 32 (photo)');
    await pool.query('delete from contacts where id = $1', [contact]);
    expect(await lignes()).toBe('0');

    contact = (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164) values ($1, '+33600000270') returning id`, [t],
    )).rows[0]!.id;
    await piece('piece_identite', 'wamid.C', 'Pièce reçue le 02/11/2026 à 15 h 00 (photo)');
    const espace = t;
    await pool.query('delete from tenants where id = $1', [espace]);
    t = '';
    const reste = await pool.query('select 1 from pieces_question where tenant_id = $1', [espace]);
    expect(reste.rowCount).toBe(0);
  });

  it('une mention vide ou trop longue est refusée (23514)', async () => {
    await expect(piece('piece_identite', 'wamid.A', '')).rejects.toMatchObject({ code: '23514' });
    await expect(piece('piece_identite', 'wamid.A', 'x'.repeat(201))).rejects.toMatchObject({ code: '23514' });
  });

  describe('le magasin (PgPiecesQuestion)', () => {
    const magasin = () => new PgPiecesQuestion(pool);

    it('une seconde pièce sur le même champ remplace la première, par le numéro du contact', async () => {
      await magasin().noter(t, '33600000269', 'piece_identite', 'wamid.A', 'Pièce reçue le 02/11/2026 à 14 h 32 (photo)');
      await magasin().noter(t, '33600000269', 'piece_identite', 'wamid.B', 'Pièce reçue le 02/11/2026 à 14 h 40 (PDF)');
      expect(await magasin().liensPossibles(t, '33600000269')).toEqual([
        { cle: 'piece_identite', metaMessageId: 'wamid.B', mention: 'Pièce reçue le 02/11/2026 à 14 h 40 (PDF)' },
      ]);
    });

    it('un autre espace ne lit rien ; un numéro inconnu n’écrit rien et ne lève pas', async () => {
      await magasin().noter(t, '33600000269', 'piece_identite', 'wamid.A', 'Pièce reçue le 02/11/2026 à 14 h 32 (photo)');
      const autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-pieces-question-2') returning id`)).rows[0]!.id;
      try {
        await pool.query(`insert into contacts (tenant_id, phone_e164) values ($1, '+33600000269')`, [autre]);
        expect(await magasin().liensPossibles(autre, '33600000269')).toEqual([]);
      } finally {
        await pool.query('delete from tenants where id = $1', [autre]);
      }
      await magasin().noter(t, '33699999999', 'piece_identite', 'wamid.Z', 'Pièce reçue le 02/11/2026 à 14 h 32 (photo)');
      expect(await lignes()).toBe('1');
    });

    it('🔴 la purge d’une fiche (anonymisée, pas supprimée) efface ses pièces', async () => {
      await magasin().noter(t, '33600000269', 'piece_identite', 'wamid.A', 'Pièce reçue le 02/11/2026 à 14 h 32 (photo)');
      await new PgContactStore(pool).purgeMany(t, [contact]);
      expect(await lignes()).toBe('0');
    });
  });
});
