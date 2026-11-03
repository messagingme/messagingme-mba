import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgContactStore, type ContactFilters } from '../../src/crm/contact-store.pg';
import { CLES_SEGMENT as S, filtreSegment as seg } from '../../web/lib/partage/segments';

const url = process.env.DATABASE_URL ?? '';

/**
 * LES CRITÈRES DE SEGMENT contre un VRAI Postgres (spec du 2026-10-31) : commandes, dépense, dernière commande, activité,
 * pays. Ce qu'un test pur ne dit pas : que le SQL compte exactement ce qu'il faut, qu'une fiche jamais active ou sans
 * commande est rendue par les critères qui la décrivent, et 🔴 qu'aucune donnée d'un autre espace ne compte, même une
 * ligne de commande incohérente qui pointerait une fiche d'ici.
 *
 * ⚠️ Jamais joué en local (le `DATABASE_URL` local pointe l'ancienne production) : joué par le job `integration`.
 */
describe.skipIf(!url)('les critères de segment (Postgres)', () => {
  let pool: Pool;
  let store: PgContactStore;
  let ici: string;
  let ailleurs: string;
  let numero = 0;

  const fiche = async (t: string, phone: string, activiteIlYA: number | null, supprimee = false): Promise<string> =>
    (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164, derniere_activite_le, deleted_at)
       values ($1, $2, case when $3::int is null then null else now() - $3::int * interval '1 day' end,
               case when $4::boolean then now() end)
       returning id`,
      [t, phone, activiteIlYA, supprimee],
    )).rows[0]!.id;

  const commande = async (t: string, contactId: string, ilYA: number, montant: string | null, devise: string | null): Promise<void> => {
    numero += 1;
    await pool.query(
      `insert into shopify_commandes (tenant_id, commande_id, contact_id, payee_le, montant, devise)
       values ($1, $2, $3, now() - $4::int * interval '1 day', $5, $6)`,
      [t, `itest-${numero}`, contactId, ilYA, montant, devise],
    );
  };

  const F = (...f: ReturnType<typeof seg>[]): ContactFilters => ({ fieldFilters: f });

  /** Les numéros que la liste rend pour ces filtres, triés, et le compte qui doit leur correspondre. */
  const qui = async (f: ContactFilters, t = ici): Promise<string[]> => {
    const lignes = await store.query(t, f, 500, 0);
    expect(await store.count(t, f)).toBe(lignes.length);
    return lignes.map((c) => c.phoneE164 ?? '').sort();
  };

  const C1 = '+33600300001'; // trois commandes EUR (3, 25 et 200 jours), active il y a 5 jours
  const C2 = '+32470300002'; // une commande EUR il y a 10 jours, une USD il y a 5 jours, active il y a 100 jours
  const C3 = '+14165300003'; // aucune commande, jamais active (Canada)
  const C5 = '+33600300005'; // une commande sans montant ni devise il y a 2 jours, jamais active

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    store = new PgContactStore(pool);
    ici = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-segments') returning id`)).rows[0]!.id;
    ailleurs = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-segments-autre') returning id`)).rows[0]!.id;
    await pool.query(
      `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre, devise)
       values ($1, $2, 'itest', 'itest', 'EUR')`,
      [ici, `itest-segments-${Date.now()}.myshopify.com`],
    );
    const c1 = await fiche(ici, C1, 5);
    const c2 = await fiche(ici, C2, 100);
    const c3 = await fiche(ici, C3, null);
    const c4 = await fiche(ici, '+33600300004', 1, true);
    const c5 = await fiche(ici, C5, null);
    await commande(ici, c1, 3, '30', 'EUR');
    await commande(ici, c1, 25, '40', 'EUR');
    await commande(ici, c1, 200, '100', 'EUR');
    await commande(ici, c2, 10, '600', 'EUR');
    await commande(ici, c2, 5, '1000', 'USD');
    await commande(ici, c4, 1, '5000', 'EUR');
    await commande(ici, c5, 2, null, null);
    // Ailleurs : le même numéro que C1, actif, cinq commandes ; et une ligne INCOHÉRENTE rangée ailleurs qui pointe C3.
    const b1 = await fiche(ailleurs, C1, 0);
    for (let i = 0; i < 5; i += 1) await commande(ailleurs, b1, 1, '9999', 'EUR');
    await commande(ailleurs, c3, 1, '9999', 'EUR');
  });
  afterAll(async () => {
    for (const t of [ici, ailleurs]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  it('le nombre de commandes : toutes devises, sur une période ou depuis le suivi, zéro compris', async () => {
    expect(await qui(F(seg(S.commandes, { min: 2, jours: 90 })))).toEqual([C2, C1].sort());
    expect(await qui(F(seg(S.commandes, { min: 3 })))).toEqual([C1]);
    // 🔴 C3 n'a aucune commande ICI : la ligne rangée dans l'autre espace ne compte pas.
    expect(await qui(F(seg(S.commandes, { max: 0 })))).toEqual([C3]);
    expect(await qui(F(seg(S.commandes, { min: 1, max: 1, jours: 7 })))).toEqual([C1, C2, C5].sort());
  });

  it('la dépense : la devise de la boutique seulement, un montant inconnu ne pèse rien', async () => {
    expect(await qui(F(seg(S.depense, { min: 500 })))).toEqual([C2]);
    expect(await qui(F(seg(S.depense, { max: 100 })))).toEqual([C3, C5].sort());
    expect(await qui(F(seg(S.depense, { min: 50, max: 200, jours: 90 })))).toEqual([C1]);
  });

  it('la dernière commande exige une commande', async () => {
    expect(await qui(F(seg(S.derniereCommande, { max: 4 })))).toEqual([C1, C5].sort());
    expect(await qui(F(seg(S.derniereCommande, { min: 4 })))).toEqual([C2]);
    expect(await qui(F(seg(S.derniereCommande, { min: 0 })))).toEqual([C1, C2, C5].sort());
  });

  it('actif exclut le jamais actif, inactif l’inclut', async () => {
    expect(await qui(F(seg(S.actif, 30)))).toEqual([C1]);
    expect(await qui(F(seg(S.inactif, 30)))).toEqual([C2, C3, C5].sort());
  });

  it('le pays par l’indicatif, +1 compris', async () => {
    expect(await qui(F(seg(S.pays, ['BE'])))).toEqual([C2]);
    expect(await qui(F(seg(S.pays, ['US'])))).toEqual([C3]);
    expect(await qui(F(seg(S.pays, ['FR']), seg(S.commandes, { min: 1 })))).toEqual([C1, C5].sort());
  });

  it('🔴 rien d’un autre espace, et l’autre espace ne voit que le sien', async () => {
    expect(await qui(F(seg(S.commandes, { min: 5 })))).toEqual([]);
    expect(await qui(F(seg(S.commandes, { min: 5 })), ailleurs)).toEqual([C1]);
    expect(await qui(F(seg(S.actif, 1)), ailleurs)).toEqual([C1]);
    expect(await qui(F(seg(S.actif, 1)))).toEqual([]);
  });

  it('le suivi : la boutique de l’espace, rien ailleurs', async () => {
    const s = await store.suiviSegments(ici);
    expect(s.boutique?.devise).toBe('EUR');
    expect(s.boutique?.coupeeLe).toBeNull();
    expect(s.boutique?.commandesDepuis).toBeInstanceOf(Date);
    expect(await store.suiviSegments(ailleurs)).toEqual({ boutique: null });
  });
});
