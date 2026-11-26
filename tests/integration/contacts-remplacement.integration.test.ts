import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgContactStore, type RemplacementFait } from '../../src/crm/contact-store.pg';
import { LimiteOffreError } from '../../src/offres/refus';
import type { Offre } from '../../src/offres/offres';

/**
 * « LE PLUS ANCIEN LAISSE SA PLACE » (décision de Julien du 2026-11-24, lot 2 du plan
 * `2026-11-24-contacts-packs-et-remplacement`), sur une vraie base : le verrou par espace, l'ordre (`created_at`, puis
 * `id`), la purge existante, puis la création ; l'entrant d'un Business ; jamais le Pro ni la Free ; la trace sans numéro.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur une base de production. La CI monte un
 * Postgres jetable pour ça (job `integration`), et le banc PGlite le joue sans base.
 */
const url = process.env.DATABASE_URL ?? '';
const LIMITE = 3;
const tel = (n: number) => `+3369995${String(n).padStart(4, '0')}`;
const waId = (n: number) => tel(n).slice(1);

describe.skipIf(!url)('le plus ancien laisse sa place', () => {
  let pool: Pool;
  let t = '';
  const traces: RemplacementFait[] = [];
  const magasin = (offre: Offre) => new PgContactStore(
    pool, undefined, async () => ({ max: LIMITE, offre }), undefined, async (r) => { traces.push(r); },
  );

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    // La limite du Business est aussi posée EN BASE (`business_contacts`) : la porte de l'espace plein relit celle d'un
    // Business dans sa propre requête, avec ses packs (2026-11-26), comme la production où les deux lectures viennent
    // de la même colonne. Sans elle, la porte lirait les 5 000 de la grille.
    t = (await pool.query<{ id: string }>(
      `insert into tenants (name, offre_business, business_contacts) values ('itest-remplacement', true, $1) returning id`, [LIMITE],
    )).rows[0]!.id;
  });
  beforeEach(async () => {
    traces.length = 0;
    await pool.query('delete from contacts where tenant_id = $1', [t]);
    await pool.query('delete from numeros_effaces where tenant_id = $1', [t]);
    await pool.query(
      `insert into tenant_settings (tenant_id, contacts_remplacer_anciens) values ($1, true)
       on conflict (tenant_id) do update set contacts_remplacer_anciens = true`,
      [t],
    );
  });
  afterAll(async () => {
    await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  /** Crée les fiches `ns`, la première la plus ancienne (dates posées : l'horloge peut rendre deux fois la même). */
  async function remplir(store: PgContactStore, ns: number[]): Promise<Record<number, string>> {
    const ids: Record<number, string> = {};
    for (const [i, n] of ns.entries()) {
      ids[n] = (await store.upsertByPhoneReturningId({ tenantId: t, phoneE164: tel(n), profileName: `P${n}`, fields: {}, optInStatus: 'unknown' })).id;
      await pool.query(`update contacts set created_at = now() - make_interval(mins => $3) where tenant_id = $1 and id = $2`, [t, ids[n], 100 - i]);
    }
    return ids;
  }
  const actives = async (): Promise<string[]> => (await pool.query<{ phone_e164: string }>(
    `select phone_e164 from contacts where tenant_id = $1 and deleted_at is null and anonymized_at is null order by phone_e164`, [t],
  )).rows.map((r) => r.phone_e164);

  it('🔴 un Business plein : la création purge le plus ancien, puis crée ; la trace dit l’identifiant, jamais le numéro', async () => {
    const store = magasin('business');
    const ids = await remplir(store, [1, 2, 3]);
    traces.length = 0;
    const r = await store.upsertByPhoneReturningId({ tenantId: t, phoneE164: tel(4), profileName: null, fields: {}, optInStatus: 'unknown', chemin: 'console' });
    expect(r.created).toBe(true);
    expect(await actives()).toEqual([tel(2), tel(3), tel(4)]);
    expect(traces).toEqual([{ tenantId: t, contactIds: [ids[1]], chemin: 'console', listeAgent: [] }]);
    // La purge existante : la fiche anonymisée, et son numéro dans la trace des numéros effacés (le rattrapage Shopify
    // ne la recréera pas).
    const p = await pool.query<{ anonymized_at: Date | null; phone_e164: string | null }>('select anonymized_at, phone_e164 from contacts where id = $1', [ids[1]]);
    expect(p.rows[0]!.anonymized_at).not.toBeNull();
    expect(p.rows[0]!.phone_e164).not.toBe(tel(1));
    expect((await pool.query<{ n: number }>('select count(*)::int as n from numeros_effaces where tenant_id = $1', [t])).rows[0]!.n).toBe(1);
  });

  it('🔴 l’option décochée, ou un Pro et une Free cochés en base : refusé comme avant, rien n’est purgé', async () => {
    await remplir(magasin('business'), [1, 2, 3]);
    traces.length = 0;
    for (const offre of ['pro', 'base'] as const) {
      await expect(magasin(offre).upsertByPhoneReturningId({ tenantId: t, phoneE164: tel(4), profileName: null, fields: {}, optInStatus: 'unknown' }))
        .rejects.toBeInstanceOf(LimiteOffreError);
    }
    await pool.query('update tenant_settings set contacts_remplacer_anciens = false where tenant_id = $1', [t]);
    await expect(magasin('business').creerFicheApi(t, { phoneE164: tel(4) })).rejects.toBeInstanceOf(LimiteOffreError);
    expect(await actives()).toEqual([tel(1), tel(2), tel(3)]);
    expect(traces).toEqual([]);
  });

  it('🔴 un import : la place du fichier entier en une fois ; une fiche que le fichier met à jour n’est jamais purgée', async () => {
    const store = magasin('business');
    const ids = await remplir(store, [1, 2, 3]);
    traces.length = 0;
    const issues = await store.upsertManyByPhone({
      tenantId: t, optInStatus: 'unknown', autorite: 'import',
      contacts: [{ phoneE164: tel(1), profileName: 'Mise à jour', fields: {} }, { phoneE164: tel(10), profileName: null, fields: {} }, { phoneE164: tel(11), profileName: null, fields: {} }],
    });
    expect(issues).toEqual(['updated', 'created', 'created']);
    expect(await actives()).toEqual([tel(1), tel(10), tel(11)]);
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ chemin: 'import' });
    expect([...traces[0]!.contactIds].sort()).toEqual([ids[2], ids[3]].sort());
  });

  it('🔴 ce qui ne tient même pas une fois tout purgé est refusé, sans rien purger', async () => {
    const store = magasin('business');
    await remplir(store, [1, 2, 3]);
    traces.length = 0;
    await expect(store.upsertManyByPhone({
      tenantId: t, optInStatus: 'unknown', autorite: 'import',
      contacts: [10, 11, 12, 13].map((n) => ({ phoneE164: tel(n), profileName: null, fields: {} })),
    })).rejects.toBeInstanceOf(LimiteOffreError);
    expect(await actives()).toEqual([tel(1), tel(2), tel(3)]);
    expect(traces).toEqual([]);
  });

  it('🔴 l’Entreprise compte aussi l’entrant (2026-11-25) : la fiche née d’un entrant, la plus ancienne, laisse sa place', async () => {
    const store = magasin('entreprise');
    expect(await store.upsertFromInbound(t, waId(50), 'Inconnu')).toBe('created');
    await pool.query(`update contacts set created_at = now() - interval '1 day' where tenant_id = $1`, [t]);
    const entrant = (await pool.query<{ id: string }>('select id from contacts where tenant_id = $1 and phone_e164 = $2', [t, tel(50)])).rows[0]!.id;
    await remplir(store, [1, 2]);
    traces.length = 0;
    await store.creerFicheApi(t, { phoneE164: tel(4) });
    expect(await actives()).toEqual([tel(1), tel(2), tel(4)]);
    expect(traces).toEqual([{ tenantId: t, contactIds: [entrant], chemin: 'api', listeAgent: [] }]);
  });

  it('🔴 l’entrant d’une Entreprise pleine, cochée, entre : le plus ancien laisse sa place (2026-11-25)', async () => {
    await pool.query('update tenants set offre_entreprise = true, entreprise_contacts = $2 where id = $1', [t, LIMITE]);
    try {
      const store = magasin('entreprise');
      const ids = await remplir(store, [1, 2, 3]);
      traces.length = 0;
      expect(await store.inconnusRefuses(t, [waId(70)])).toBeNull();
      expect(await actives()).toEqual([tel(2), tel(3)]);
      expect(traces).toEqual([{ tenantId: t, contactIds: [ids[1]], chemin: 'entrant', listeAgent: [] }]);
      // Décochée : l'inconnu est refusé, comme le Business.
      await pool.query('update tenant_settings set contacts_remplacer_anciens = false where tenant_id = $1', [t]);
      await remplir(store, [4]);
      expect(await store.inconnusRefuses(t, [waId(71)])).toEqual({ waIds: new Set([waId(71)]), limite: LIMITE });
    } finally {
      await pool.query('update tenants set offre_entreprise = false, entreprise_contacts = null where id = $1', [t]);
    }
  });

  it('🔴 l’entrant d’un Business plein entre : le plus ancien qui n’écrit pas dans ce lot laisse sa place', async () => {
    const store = magasin('business');
    const ids = await remplir(store, [1, 2, 3]);
    traces.length = 0;
    // Le plus ancien (1) écrit dans le même lot qu'un inconnu (70) : c'est le suivant (2) qui part.
    expect(await store.inconnusRefuses(t, [waId(1), waId(70)])).toBeNull();
    expect(await actives()).toEqual([tel(1), tel(3)]);
    expect(traces).toEqual([{ tenantId: t, contactIds: [ids[2]], chemin: 'entrant', listeAgent: [] }]);
    // Décochée : l'inconnu est refusé, comme avant.
    await pool.query('update tenant_settings set contacts_remplacer_anciens = false where tenant_id = $1', [t]);
    await remplir(store, [4]);
    expect(await store.inconnusRefuses(t, [waId(71)])).toEqual({ waIds: new Set([waId(71)]), limite: LIMITE });
  });

  it('les aperçus le savent : `placesContacts` dit l’option, seulement là où elle joue', async () => {
    await remplir(magasin('business'), [1, 2]);
    expect(await magasin('business').placesContacts(t, [])).toMatchObject({ limite: LIMITE, comptees: 2, remplacer: true });
    expect(await magasin('pro').placesContacts(t, [])).toMatchObject({ remplacer: false });
  });

  it('🔴 deux créations simultanées sur un espace plein : jamais la même fiche purgée deux fois, jamais plus de purges que de créations', async () => {
    const store = magasin('business');
    await remplir(store, [1, 2, 3]);
    traces.length = 0;
    await Promise.all([5, 6].map((n) => store.upsertByPhoneReturningId({ tenantId: t, phoneE164: tel(n), profileName: null, fields: {}, optInStatus: 'unknown' })));
    const purgees = traces.flatMap((r) => r.contactIds);
    expect(new Set(purgees).size).toBe(purgees.length);
    expect(purgees.length).toBeGreaterThanOrEqual(1);
    expect(purgees.length).toBeLessThanOrEqual(2);
    expect((await actives()).length).toBe(3 + 2 - purgees.length);
  });
});
