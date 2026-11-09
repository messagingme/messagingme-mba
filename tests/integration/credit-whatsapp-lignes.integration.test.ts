import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgLignesCreditStore } from '../../src/credit-whatsapp/lignes.pg';

/**
 * LES NUMÉROS SUR LA LIGNE DU CRÉDIT WHATSAPP SUR UNE VRAIE BASE (migration 0264, tâches 4 et 8).
 *
 * 🔴 CE QU'AUCUN TEST UNITAIRE NE VOIT : le `on conflict` de la pose contre l'index partiel (un prédicat qui diverge
 * échoue à chaque pose, en production), une ligne retirée qui libère le numéro pour une nouvelle, et la lecture du numéro
 * DANS son espace, avec son fournisseur et sa coexistence.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur une base de production. La CI monte un
 * Postgres jetable pour ça (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';

describe.skipIf(!url)('les numéros sur la ligne du Crédit WhatsApp (0264)', () => {
  let pool: Pool;
  let lignes: PgLignesCreditStore;
  const espaces: string[] = [];

  async function espace(): Promise<string> {
    const id = (await pool.query<{ id: string }>(`insert into tenants (name) values ('credit-wa-lignes') returning id`)).rows[0]!.id;
    espaces.push(id);
    return id;
  }

  /** Un numéro de l'espace sur son compte WhatsApp ; `fournisseur` absent = sans compte propre (notre portefeuille). */
  async function numero(tenantId: string, id: string, o: { fournisseur?: 'meta' | '360dialog'; coexistence?: boolean; delie?: boolean } = {}): Promise<void> {
    const waba = `waba-${id}`;
    await pool.query(`insert into waba (id, tenant_id, name) values ($1, $2, 'itest')`, [waba, tenantId]);
    if (o.fournisseur !== undefined) {
      await pool.query(`insert into waba_credentials (waba_id, tenant_id, business_token_enc, fournisseur) values ($1, $2, 'x', $3)`, [waba, tenantId, o.fournisseur]);
    }
    await pool.query(
      `insert into phone_numbers (id, tenant_id, waba_id, display_phone_number, coexistence, delie_le)
       values ($1, $2, $3, '+33 6 00 00 00 00', $4, case when $5 then now() end)`,
      [id, tenantId, waba, o.coexistence ?? false, o.delie ?? false],
    );
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(url) });
    lignes = new PgLignesCreditStore(pool);
  });

  afterAll(async () => {
    if (espaces.length > 0) await pool.query('delete from tenants where id = any($1::uuid[])', [espaces]);
    await pool.end();
  });

  it('🔴 une ligne en cours par numéro : la seconde pose est refusée sans erreur, une ligne retirée libère le numéro', async () => {
    const t = await espace();
    await numero(t, 'itest-cwa-1');
    expect(await lignes.poser(t, 'itest-cwa-1', 'waba-itest-cwa-1', 'ops', 'essai')).toBe(true);
    expect(await lignes.poser(t, 'itest-cwa-1', 'waba-itest-cwa-1', 'ops', 'encore')).toBe(false);
    expect(await lignes.ligneDuNumero('itest-cwa-1')).toMatchObject({ tenantId: t, origine: 'ops', arreteeLe: null });
    expect(await lignes.arreter(t, 'itest-cwa-1')).toBe(true);
    expect((await lignes.ligneDuNumero('itest-cwa-1'))?.arreteeLe).not.toBeNull();
    expect(await lignes.retirer(t, 'itest-cwa-1')).toBe(true);
    expect(await lignes.ligneDuNumero('itest-cwa-1')).toBeNull();
    expect(await lignes.retirer(t, 'itest-cwa-1')).toBe(false);
    expect(await lignes.poser(t, 'itest-cwa-1', 'waba-itest-cwa-1', 'ops', 'nouvel essai')).toBe(true);
    expect(await lignes.lignesDeLEspace(t)).toHaveLength(1);
  });

  it('🔴 la ligne couvre tout le compte WhatsApp du numéro, et une ligne retirée se lit encore 35 jours pour les accusés', async () => {
    const t = await espace();
    await numero(t, 'itest-cwa-a');
    // Un second numéro du MÊME compte (ajouté ou remplacé), et un numéro d'un autre compte.
    await pool.query(
      `insert into phone_numbers (id, tenant_id, waba_id, display_phone_number) values ('itest-cwa-b', $1, 'waba-itest-cwa-a', '+33 6 00 00 00 01')`,
      [t],
    );
    await numero(t, 'itest-cwa-c');
    expect(await lignes.poser(t, 'itest-cwa-a', 'waba-itest-cwa-a', 'ops', 'essai')).toBe(true);
    expect(await lignes.ligneDuNumero('itest-cwa-b')).toMatchObject({ tenantId: t, phoneNumberId: 'itest-cwa-a', retireeLe: null });
    expect(await lignes.ligneDuNumero('itest-cwa-c')).toBeNull();
    expect((await lignes.numerosDeLEspace(t)).map((n) => [n.phoneNumberId, n.wabaId])).toEqual([
      ['itest-cwa-a', 'waba-itest-cwa-a'], ['itest-cwa-b', 'waba-itest-cwa-a'], ['itest-cwa-c', 'waba-itest-cwa-c'],
    ]);

    expect(await lignes.retirer(t, 'itest-cwa-a')).toBe(true);
    expect(await lignes.ligneDuNumero('itest-cwa-a')).toBeNull();
    expect(await lignes.ligneDuNumero('itest-cwa-b')).toBeNull();
    expect((await lignes.ligneDesAccuses('itest-cwa-a'))?.retireeLe).not.toBeNull();
    expect((await lignes.ligneDesAccuses('itest-cwa-b'))?.phoneNumberId).toBe('itest-cwa-a');
    expect(await lignes.ligneDesAccuses('itest-cwa-c')).toBeNull();

    // Au-delà de 35 jours, plus aucun accusé ne la lit (un magasin neuf : le cache de l'autre garde sa lecture).
    await pool.query(`update lignes_credit_whatsapp set retiree_le = now() - interval '36 days' where tenant_id = $1`, [t]);
    expect(await new PgLignesCreditStore(pool).ligneDesAccuses('itest-cwa-a')).toBeNull();
  });

  it('🔴 un numéro se lit dans SON espace seulement, avec son fournisseur, sa coexistence et son état délié', async () => {
    const t = await espace();
    const autre = await espace();
    await numero(t, 'itest-cwa-meta');
    await numero(t, 'itest-cwa-360', { fournisseur: '360dialog' });
    await numero(t, 'itest-cwa-coex', { fournisseur: 'meta', coexistence: true, delie: true });
    expect(await lignes.numeroDeLEspace(t, 'itest-cwa-meta')).toEqual({ wabaId: 'waba-itest-cwa-meta', fournisseur: 'meta', coexistence: false, delie: false });
    expect(await lignes.numeroDeLEspace(t, 'itest-cwa-360')).toMatchObject({ fournisseur: '360dialog' });
    expect(await lignes.numeroDeLEspace(t, 'itest-cwa-coex')).toMatchObject({ fournisseur: 'meta', coexistence: true, delie: true });
    expect(await lignes.numeroDeLEspace(autre, 'itest-cwa-meta')).toBeNull();
    expect(await lignes.numeroDeLEspace(t, 'itest-cwa-inconnu')).toBeNull();
  });

  it('🔴 la marque d’un numéro arrivé par la fenêtre du partenaire (relecture du lot E, jaunes 3 et 4) : posée dans son espace seul, une fois, et relue par la liste', async () => {
    const t = await espace();
    const autre = await espace();
    await numero(t, 'itest-cwa-pl-1');
    await numero(t, 'itest-cwa-pl-2');
    expect(await lignes.marquerParLaLigne(t, 'itest-cwa-pl-1')).toBe(true);
    // Un espace ne marque jamais le numéro d'un autre (le filtre `tenant_id`, seul contrôle sous le rôle de l'application).
    expect(await lignes.marquerParLaLigne(autre, 'itest-cwa-pl-2')).toBe(false);
    const moment = async () => (await pool.query<{ le: Date | null }>(`select par_la_ligne_le as le from phone_numbers where id = 'itest-cwa-pl-1'`)).rows[0]!.le;
    const premier = await moment();
    expect(premier).not.toBeNull();
    // Rejouée, la marque garde son premier moment.
    expect(await lignes.marquerParLaLigne(t, 'itest-cwa-pl-1')).toBe(true);
    expect((await moment())?.getTime()).toBe(premier!.getTime());
    expect((await lignes.numerosDeLEspace(t)).map((n) => [n.phoneNumberId, n.attendLigne])).toEqual([
      ['itest-cwa-pl-1', true], ['itest-cwa-pl-2', false],
    ]);
  });

  it('🔴 une ligne posée après la marque l’éteint pour de bon : retirée ensuite, le numéro n’attend plus rien (le rouge de la relecture du lot E5)', async () => {
    // Sans cela, une Entreprise dont la ligne a été retirée relisait « en attente » pour toujours, et plus personne ne lui
    // disait d'ajouter sa carte chez Meta, alors que Meta bloquait ses envois.
    const t = await espace();
    await numero(t, 'itest-cwa-pl-3');
    expect(await lignes.marquerParLaLigne(t, 'itest-cwa-pl-3')).toBe(true);
    expect((await lignes.numerosDeLEspace(t))[0]?.attendLigne).toBe(true);
    expect(await lignes.poser(t, 'itest-cwa-pl-3', 'waba-itest-cwa-pl-3', 'ops', 'essai 236')).toBe(true);
    expect((await lignes.numerosDeLEspace(t))[0]?.attendLigne).toBe(false);
    expect(await lignes.retirer(t, 'itest-cwa-pl-3')).toBe(true);
    expect((await lignes.numerosDeLEspace(t))[0]?.attendLigne).toBe(false);
    // Rejouée, la marque garde son premier moment : la ligne posée depuis l'éteint toujours.
    expect(await lignes.marquerParLaLigne(t, 'itest-cwa-pl-3')).toBe(true);
    expect((await lignes.numerosDeLEspace(t))[0]?.attendLigne).toBe(false);
  });
});
