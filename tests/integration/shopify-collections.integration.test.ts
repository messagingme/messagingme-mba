import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgContactStore, type ContactFilters } from '../../src/crm/contact-store.pg';
import { FiltreContactInvalide } from '../../src/crm/contact-filters';
import { PgShopifyStore, type DetailsCommande } from '../../src/shopify/store.pg';
import { PgCollectionsStore, REFUS_SANS_DROIT, REFUS_SANS_LECTURE, type ProduitLu } from '../../src/shopify/collections.pg';
import { ligneDansLaCollection } from '../../src/crm/segments';
import type { LigneDeCommande } from '../../src/shopify/donnees';
import { CLES_SEGMENT as S, filtreSegment as seg } from '../../web/lib/partage/segments';

const url = process.env.DATABASE_URL ?? '';

/**
 * LES COLLECTIONS DES PRODUITS ACHETÉS contre un VRAI Postgres (segments Shopify enrichis, lot 6a, migration 0314). Ce
 * qu'aucun faux ne prouve : la migration relue en base (contraintes sous leur nom, cascade, index), l'inscription des
 * produits vus dans les lignes, la RÉSERVATION par bail et jeton (un porteur périmé n'écrit plus rien), le remplacement en
 * bloc des collections, l'état de la lecture, 🔴 le critère « a acheté dans la collection » sur deux espaces (aucune fuite,
 * même aux mêmes identifiants), 🔴 son refus sans lecture aboutie ou pour une collection inconnue, l'effacement du
 * branchement, et l'index servi par la sous-requête du critère.
 *
 * ⚠️ Jamais joué en local contre `DATABASE_URL` (l'ancienne production) : joué par le job `integration`, ou sur le banc
 * PGlite (une requête à la fois : la concurrence réelle de `skip locked` ne s'y voit pas, seules ses règles).
 */
describe.skipIf(!url)('les collections des produits achetés (Postgres)', () => {
  let pool: Pool;
  let contacts: PgContactStore;
  let shopify: PgShopifyStore;
  let cache: PgCollectionsStore;
  let ici = '';
  let ailleurs = '';
  let A = '';
  let B = '';
  let C = '';
  let X = '';

  const ligne = (ligneId: string, produitId: string | null, o: Partial<LigneDeCommande> = {}): LigneDeCommande => ({
    ligneId, produitId, varianteId: null, sku: null, titre: `Produit ${produitId ?? 'sur mesure'}`, varianteTitre: null, quantite: 1,
    carteCadeau: false, ...o,
  });
  const details = (ilYA: number, lignes: LigneDeCommande[]): DetailsCommande => ({
    payeeLe: new Date(Date.now() - ilYA * 86_400_000), montant: '30', devise: 'EUR', test: false, lignes: { lignes, tronquees: false },
  });
  const F = (ids: string[], jours?: number): ContactFilters => ({ fieldFilters: [seg(S.collection, { collections: ids, ...(jours ? { jours } : {}) })] });
  const qui = async (f: ContactFilters, t = ici): Promise<string[]> => {
    const lignes = await contacts.query(t, f, 500, 0);
    expect(await contacts.count(t, f)).toBe(lignes.length);
    return lignes.map((c) => c.id).sort();
  };
  const tries = (...ids: string[]): string[] => [...ids].sort();
  const lu = (produitId: string, collections: Array<[string, string]>, o: Partial<ProduitLu> = {}): ProduitLu => ({
    produitId, titre: `Produit ${produitId}`, collections: collections.map(([collectionId, titre]) => ({ collectionId, titre })), incompletes: false, ...o,
  });
  /** Une lecture complète de l'espace : chaque produit réservé reçoit ses collections. */
  const lire = async (t: string, catalogue: Record<string, Array<[string, string]>>) => {
    await cache.synchroniser(t);
    for (;;) {
      const lot = await cache.reserver(t, 10);
      if (lot.produits.length === 0) break;
      await cache.ecrire(t, lot.jeton, lot.produits.map((id) => lu(id, catalogue[id] ?? [])));
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    contacts = new PgContactStore(pool);
    shopify = new PgShopifyStore(pool, randomBytes(32).toString('hex'));
    cache = new PgCollectionsStore(pool);
    const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    ici = await espace('itest-collections');
    ailleurs = await espace('itest-collections-autre');
    const fiche = async (t: string, tel: string) => (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [t, tel])).rows[0]!.id;
    A = await fiche(ici, '+33600614001');
    B = await fiche(ici, '+33600614002');
    C = await fiche(ici, '+33600614003');
    X = await fiche(ailleurs, '+33600614001');
    for (const t of [ici, ailleurs]) {
      await pool.query(
        `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre, devise) values ($1, $2, 'cid', 'x', 'EUR')`,
        [t, `itest-${randomUUID().slice(0, 8)}.myshopify.com`],
      );
    }
    // A : le sérum (8801) il y a 10 jours, la crème (8802) il y a 100 jours. B : le sérum il y a 200 jours.
    // C : une carte cadeau (9900) et une ligne sur mesure. Un identifiant illisible (20 chiffres) n'entre pas au cache.
    await shopify.lierCommande(ici, '6001', null, A, details(10, [ligne('1', '8801')]));
    await shopify.lierCommande(ici, '6002', null, A, details(100, [ligne('2', '8802')]));
    await shopify.lierCommande(ici, '6003', null, B, details(200, [ligne('3', '8801')]));
    await shopify.lierCommande(ici, '6004', null, C, details(5, [ligne('4', '9900', { carteCadeau: true }), ligne('5', null), ligne('6', '1'.repeat(20))]));
    // Un autre espace : les MÊMES identifiants de commande et de produit, la même collection.
    await shopify.lierCommande(ailleurs, '6001', null, X, details(2, [ligne('1', '8801')]));
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[ici, ailleurs]]);
    await pool.end();
  });

  it('🔴 la migration relue en base : contraintes sous leur nom, cascade, index', async () => {
    const contraintes = await pool.query<{ conname: string; def: string; confdeltype: string }>(
      `select conname, pg_get_constraintdef(oid) as def, confdeltype from pg_constraint
        where conrelid in ('shopify_produits'::regclass, 'shopify_produit_collections'::regclass, 'shopify_collections_lecture'::regclass)
        order by conname`,
    );
    const par = new Map(contraintes.rows.map((r) => [r.conname, r]));
    expect(par.get('shopify_produit_collections_produit_fkey')).toMatchObject({ confdeltype: 'c' });
    expect(par.get('shopify_produit_collections_produit_fkey')!.def).toContain('REFERENCES shopify_produits(tenant_id, produit_id) ON DELETE CASCADE');
    expect(par.get('shopify_collections_lecture_issue_check')!.def).toMatch(/lue.*sans_droit.*refusee.*erreur/);
    for (const nom of ['shopify_produits_produit_id_check', 'shopify_produits_titre_check', 'shopify_produit_collections_collection_id_check',
      'shopify_produit_collections_titre_check', 'shopify_collections_lecture_message_check']) {
      expect(par.has(nom), nom).toBe(true);
    }
    const index = await pool.query<{ indexdef: string }>(`select indexdef from pg_indexes where indexname = 'shopify_produit_collections_collection'`);
    expect(index.rows[0]!.indexdef).toContain('(tenant_id, collection_id)');
    // Un identifiant illisible est refusé par la table elle-même.
    await expect(pool.query(`insert into shopify_produits (tenant_id, produit_id) values ($1, 'abc')`, [ici])).rejects.toMatchObject({ code: '23514' });
  });

  it('🔴 sans lecture aboutie, le critère est REFUSÉ par chaque lecture, jamais « personne » ; le droit manquant le dit', async () => {
    await expect(contacts.count(ici, F(['4401']))).rejects.toThrow(REFUS_SANS_LECTURE);
    await expect(contacts.query(ici, F(['4401']))).rejects.toThrow(FiltreContactInvalide);
    await expect(contacts.contactIdsForTarget(ici, { filters: F(['4401']) })).rejects.toThrow(FiltreContactInvalide);
    await expect(contacts.applyEditsMany(ici, { filters: F(['4401']) }, { addTags: ['ete'] })).rejects.toThrow(FiltreContactInvalide);
    // Une demande, puis l'issue « droit manquant » : la phrase du refus le dit.
    expect(await cache.demander(ici)).toBeInstanceOf(Date);
    await cache.noterIssue(ici, 'sans_droit', 'manque read_products');
    await expect(contacts.count(ici, F(['4401']))).rejects.toThrow(REFUS_SANS_DROIT);
    expect((await pool.query(`select count(*)::int as n from contacts where tenant_id = $1 and 'ete' = any(tags)`, [ici])).rows[0]!.n).toBe(0);
  });

  it('les produits vus entrent au cache : hors cartes cadeaux, hors lignes sans produit, hors identifiants illisibles, dans l’espace', async () => {
    expect(await cache.aLire(ici)).toBe(true);
    expect(await cache.synchroniser(ici)).toBe(2);
    expect(await cache.synchroniser(ici)).toBe(0);
    const ids = (await pool.query<{ produit_id: string }>(`select produit_id from shopify_produits where tenant_id = $1 order by produit_id`, [ici])).rows.map((r) => r.produit_id);
    expect(ids).toEqual(['8801', '8802']);
    expect((await pool.query(`select 1 from shopify_produits where tenant_id = $1`, [ailleurs])).rowCount).toBe(0);
  });

  it('🔴 la réservation : par lots, les jamais lus d’abord ; un lot tenu ne se reprend pas ; un bail mort, si ; un jeton périmé n’écrit rien', async () => {
    const premier = await cache.reserver(ici, 1);
    expect(premier.produits).toEqual(['8801']);
    const second = await cache.reserver(ici, 10);
    expect(second.produits).toEqual(['8802']);
    expect(await cache.reserver(ici, 10)).toMatchObject({ produits: [] });
    // Le premier porteur meurt : son bail expire, un autre passage reprend son produit.
    await pool.query(`update shopify_produits set bail_jusqua = now() - interval '1 second' where tenant_id = $1 and produit_id = '8801'`, [ici]);
    const repris = await cache.reserver(ici, 10);
    expect(repris.produits).toEqual(['8801']);
    expect(await cache.ecrire(ici, premier.jeton, [lu('8801', [['4401', 'Été']])])).toBe(0);
    // Le bon porteur écrit ; une libération rend le bail du second.
    expect(await cache.ecrire(ici, repris.jeton, [lu('8801', [['4401', 'Été'], ['4402', 'Soins']])])).toBe(1);
    await cache.liberer(ici, second.jeton);
    expect((await pool.query(`select bail_jusqua, jeton from shopify_produits where tenant_id = $1 and produit_id = '8802'`, [ici])).rows[0]).toEqual({ bail_jusqua: null, jeton: null });
    expect(await cache.resteALire(ici)).toBe(true);
  });

  /**
   * La vraie concurrence : une AUTRE connexion tient un produit (un autre job au milieu de sa réservation). `skip locked`
   * le saute sans l'attendre. ⚠️ Sauté sur le banc PGlite : une seule session, aucun verrou d'une autre connexion n'y
   * existe ; joué par le job `integration` de la CI, sur un vrai Postgres.
   */
  it.skipIf(url.startsWith('pglite'))('🔴 skip locked : un produit verrouillé par une autre connexion est sauté, sans l’attendre', async () => {
    const t = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-collections-verrou') returning id`)).rows[0]!.id;
    try {
      await pool.query(`insert into shopify_produits (tenant_id, produit_id) values ($1, '7001'), ($1, '7002')`, [t]);
      const verrou = await pool.connect();
      try {
        await verrou.query('begin');
        await verrou.query(`select 1 from shopify_produits where tenant_id = $1 and produit_id = '7001' for update`, [t]);
        const attente = new Promise<never>((_r, rejeter) => setTimeout(() => rejeter(new Error('la réservation attend le verrou d’une autre connexion')), 5000));
        const lot = await Promise.race([cache.reserver(t, 10), attente]);
        expect(lot.produits).toEqual(['7002']);
      } finally {
        await verrou.query('rollback');
        verrou.release();
      }
    } finally {
      await pool.query('delete from tenants where id = $1', [t]);
    }
  });

  it('🔴 les collections d’un produit sont REMPLACÉES en bloc à chaque lecture ; le titre connu reste si Shopify n’en rend pas', async () => {
    await lire(ici, { 8802: [['4402', 'Soins']] });
    expect(await cache.resteALire(ici)).toBe(false);
    expect(await cache.aLire(ici)).toBe(false);
    // Relu (un jour plus tard) : sorti de « Été », et Shopify ne rend plus son titre.
    await pool.query(`update shopify_produits set collections_lues_le = now() - interval '25 hours' where tenant_id = $1 and produit_id = '8801'`, [ici]);
    expect(await cache.aLire(ici)).toBe(true);
    const lot = await cache.reserver(ici, 10);
    expect(lot.produits).toEqual(['8801']);
    await cache.ecrire(ici, lot.jeton, [lu('8801', [['4402', 'Soins']], { titre: null, incompletes: true })]);
    const p = (await pool.query(`select titre, collections_incompletes from shopify_produits where tenant_id = $1 and produit_id = '8801'`, [ici])).rows[0];
    expect(p).toEqual({ titre: 'Produit 8801', collections_incompletes: true });
    const pc = (await pool.query<{ collection_id: string }>(`select collection_id from shopify_produit_collections where tenant_id = $1 and produit_id = '8801'`, [ici])).rows;
    expect(pc.map((r) => r.collection_id)).toEqual(['4402']);
    // Remise en état pour la suite : 8801 dans « Été » et « Soins », 8802 dans « Soins ».
    await pool.query(`update shopify_produits set collections_lues_le = now() - interval '25 hours' where tenant_id = $1 and produit_id = '8801'`, [ici]);
    await lire(ici, { 8801: [['4401', 'Été'], ['4402', 'Soins']] });
  });

  it('l’état : la demande ne repart pas tant qu’elle attend son issue ; l’issue « lue » pose la date ; une issue ne crée jamais l’état', async () => {
    // Un état neuf (celui du refus d'avant part).
    await pool.query(`delete from shopify_collections_lecture where tenant_id = $1`, [ici]);
    const d = await cache.demander(ici);
    expect(d).toBeInstanceOf(Date);
    expect(await cache.demander(ici)).toBeNull();
    await cache.noterIssue(ici, 'lue', null);
    const e = (await cache.etat(ici))!;
    expect(e).toMatchObject({ issue: 'lue', message: null, incompletes: false });
    expect(e.lueLe).toBeInstanceOf(Date);
    // Juste après une issue : pas de nouvelle demande avant une minute.
    expect(await cache.demander(ici)).toBeNull();
    await pool.query(`update shopify_collections_lecture set issue_le = now() - interval '2 minutes', demandee_le = now() - interval '3 minutes' where tenant_id = $1`, [ici]);
    const d2 = await cache.demander(ici);
    expect(d2).toBeInstanceOf(Date);
    await cache.annulerDemande(ici, d2!);
    expect((await cache.etat(ici))!.demandeeLe).toBeNull();
    // 🔴 Postgres garde la microseconde, `pg` rend une Date à la milliseconde : l'annulation compare à la milliseconde.
    // L'horloge de PGlite est à la milliseconde : la date est posée ici à la microseconde, pour qu'il ne masque rien.
    await pool.query(`update shopify_collections_lecture set demandee_le = '2026-11-24T10:00:00.123456Z' where tenant_id = $1`, [ici]);
    await cache.annulerDemande(ici, new Date('2026-11-24T10:00:00.123Z'));
    expect((await cache.etat(ici))!.demandeeLe).toBeNull();
    // Aucune ligne pour l'autre espace : une issue ne la crée pas.
    await cache.noterIssue(ailleurs, 'lue', null);
    expect(await cache.etat(ailleurs)).toBeNull();
    // Le suivi des segments dit la date de la lecture aboutie ; l'autre espace, non.
    expect((await contacts.suiviSegments(ici)).boutique?.collectionsLuesLe).toEqual(e.lueLe);
    expect((await contacts.suiviSegments(ailleurs)).boutique).not.toHaveProperty('collectionsLuesLe');
  });

  it('les collections lues : celles qui portent le plus de produits d’abord, cherchables par titre ou identifiant, dans l’espace', async () => {
    expect(await cache.collections(ici, undefined, 50)).toEqual([
      { collectionId: '4402', titre: 'Soins', produits: 2 },
      { collectionId: '4401', titre: 'Été', produits: 1 },
    ]);
    expect((await cache.collections(ici, 'été', 50)).map((c) => c.collectionId)).toEqual(['4401']);
    expect((await cache.collections(ici, '4402', 50)).map((c) => c.collectionId)).toEqual(['4402']);
    expect(await cache.collections(ici, '%', 50)).toEqual([]);
    expect(await cache.collections(ailleurs, undefined, 50)).toEqual([]);
  });

  it('🔴 « a acheté dans la collection » : CHACUNE des collections, la fenêtre, jamais une carte cadeau, jamais un autre espace', async () => {
    expect(await qui(F(['4402']))).toEqual(tries(A, B));
    expect(await qui(F(['4401']))).toEqual(tries(A, B));
    // A a acheté un produit de chacune ; B aussi (8801 est dans les deux).
    expect(await qui(F(['4401', '4402']))).toEqual(tries(A, B));
    // Sur 30 jours : seule la commande de A (8801, il y a 10 jours).
    expect(await qui(F(['4402'], 30))).toEqual([A]);
    // Un autre espace a les mêmes identifiants et aucune lecture : refusé, jamais les fiches d'ici ni « personne ».
    await expect(qui(F(['4401']), ailleurs)).rejects.toThrow(FiltreContactInvalide);
    // Le même espace, l'autre en a une lecture aboutie mais sans cette collection : refusé aussi.
    await pool.query(`insert into shopify_collections_lecture (tenant_id, lue_le, issue, issue_le) values ($1, now(), 'lue', now())`, [ailleurs]);
    await expect(qui(F(['4401']), ailleurs)).rejects.toThrow(/la collection 4401 n’est pas connue/);
  });

  it('🔴 une collection inconnue à la dernière lecture est refusée, nommée ; avec une connue, aussi', async () => {
    await expect(contacts.count(ici, F(['4499']))).rejects.toThrow(/la collection 4499 n’est pas connue/);
    await expect(contacts.count(ici, F(['4401', '4498', '4499']))).rejects.toThrow(/les collections 4498, 4499 ne sont pas connues/);
  });

  it('🔴 l’index (tenant_id, collection_id) SERT la sous-requête que le critère pose, et la requête entière s’exécute', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local enable_seqscan = off');
      const plan = (await client.query<{ 'QUERY PLAN': string }>(
        `explain select pc.produit_id from shopify_produit_collections pc where pc.tenant_id = $1 and pc.collection_id = $2`, [ici, '4401'],
      )).rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(plan).toContain('shopify_produit_collections_collection');
      const fragment = ligneDansLaCollection('4401', () => '$2');
      const n = (await client.query(`select l.ligne_id from shopify_commande_lignes l where l.tenant_id = $1 and ${fragment}`, [ici, '4401'])).rowCount;
      expect(n).toBe(2);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('🔴 l’effacement du branchement emporte le cache des collections et l’état, jamais ceux d’un autre espace', async () => {
    await pool.query(`insert into shopify_produits (tenant_id, produit_id, collections_lues_le) values ($1, '8801', now())`, [ailleurs]);
    await pool.query(`insert into shopify_produit_collections (tenant_id, produit_id, collection_id, titre) values ($1, '8801', '4401', 'Été')`, [ailleurs]);
    const reste = async (t: string, table: string) => Number((await pool.query<{ n: string }>(`select count(*) as n from ${table} where tenant_id = $1`, [t])).rows[0]!.n);
    await shopify.effacerBoutique(ici);
    for (const table of ['shopify_produits', 'shopify_produit_collections', 'shopify_collections_lecture']) {
      expect(await reste(ici, table), table).toBe(0);
      expect(await reste(ailleurs, table), table).toBe(1);
    }
    // Effacé, le critère redevient refusé : aucune lecture n'a abouti.
    await expect(contacts.count(ici, F(['4401']))).rejects.toThrow(REFUS_SANS_LECTURE);
  });
});
