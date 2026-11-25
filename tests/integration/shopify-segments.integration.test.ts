import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgContactStore, type ContactFilters } from '../../src/crm/contact-store.pg';
import { FiltreContactInvalide } from '../../src/crm/contact-filters';
import { PgShopifyStore } from '../../src/shopify/store.pg';
import { PgEtiquettesStore } from '../../src/shopify/etiquettes.pg';
import { CLES_SEGMENT as S, filtreSegment } from '../../web/lib/partage/segments';

const url = process.env.DATABASE_URL ?? '';

/**
 * LES SEGMENTS NATIFS SHOPIFY contre un VRAI Postgres (segments Shopify enrichis, lot 6c, migration 0327). Ce qu'aucun faux
 * ne prouve : la migration relue en base (contraintes sous leur nom, cascades), 🔴 chaque écriture sous le jeton de la
 * synchronisation, les membres rattachés aux fiches ACTIVES par les liens, 🔴 les appartenances remplacées à la DERNIÈRE page
 * et jamais avant (une lecture inachevée garde l'ancienne cible et se dit partielle), 🔴 le critère refusé tant qu'un segment
 * n'est pas suivi et lu, puis appliqué, sur deux espaces aux mêmes identifiants (aucune fuite), la purge d'une fiche,
 * l'effacement du branchement et la cascade.
 *
 * ⚠️ Jamais joué en local contre `DATABASE_URL` (l'ancienne production) : joué par le job `integration`, ou sur le banc
 * PGlite.
 */
describe.skipIf(!url)('les segments Shopify (Postgres)', () => {
  let pool: Pool;
  let contacts: PgContactStore;
  let shopify: PgShopifyStore;
  let magasin: PgEtiquettesStore;
  let ici = '';
  let ailleurs = '';
  let A = '';
  let B = '';
  let C = '';
  let X = '';

  const F = (segments: string[], mode: 'toutes' | 'une' = 'toutes'): ContactFilters => ({ fieldFilters: [filtreSegment(S.segmentShopify, { segments, mode })] });
  const qui = async (f: ContactFilters, t = ici): Promise<string[]> => {
    const lignes = await contacts.query(t, f, 500, 0);
    expect(await contacts.count(t, f)).toBe(lignes.length);
    return lignes.map((c) => c.id).sort();
  };
  const tries = (...ids: string[]): string[] => [...ids].sort();
  const membres = async (t: string, segment: string): Promise<string[]> => (await pool.query<{ contact_id: string }>(
    `select contact_id from shopify_segment_membres where tenant_id = $1 and segment_id = $2 order by contact_id`, [t, segment])).rows.map((r) => r.contact_id);
  const segment = async (t: string, id: string) => (await pool.query(
    `select suivi, absent_le is not null as absent, lu_le is not null as lu, partiel, membres, fiches, lecture_debut is not null as en_lecture,
            curseur, requete_asynchrone, lecture_membres from shopify_segments where tenant_id = $1 and segment_id = $2`, [t, id])).rows[0];
  /** Une nouvelle synchronisation et son bail : le jeton qui tient. L'horloge avance d'abord, comme entre deux vraies. */
  const tenir = async (t: string): Promise<string> => {
    await new Promise((r) => setTimeout(r, 5));
    await magasin.regler(t, true);
    await pool.query(`update shopify_etiquettes_synchro set en_cours_depuis = null, bail_jusqua = null, jeton = null, demandee_le = null where tenant_id = $1`, [t]);
    expect(await magasin.demander(t, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
    return (await magasin.prendre(t))!.jeton;
  };
  /** Une lecture complète d'un segment, page par page, sous le jeton. */
  const lire = async (t: string, jeton: string, id: string, pages: string[][]): Promise<void> => {
    for (const [i, clients] of pages.entries()) {
      const apres = i === 0 ? null : `c${i}`;
      expect(await magasin.ecrirePageSegment(t, jeton, id, { apres, clients, suivant: i === pages.length - 1 ? null : `c${i + 1}` })).toBe(true);
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    contacts = new PgContactStore(pool);
    shopify = new PgShopifyStore(pool, randomBytes(32).toString('hex'));
    magasin = new PgEtiquettesStore(pool);
    const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    ici = await espace('itest-segments');
    ailleurs = await espace('itest-segments-autre');
    const fiche = async (t: string, tel: string) =>
      (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [t, tel])).rows[0]!.id;
    A = await fiche(ici, '+33600669001');
    B = await fiche(ici, '+33600669002');
    C = await fiche(ici, '+33600669003');
    X = await fiche(ailleurs, '+33600669001');
    for (const t of [ici, ailleurs]) {
      await pool.query(
        `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre, devise) values ($1, $2, 'cid', 'x', 'EUR')`,
        [t, `itest-${randomUUID().slice(0, 8)}.myshopify.com`],
      );
    }
    // Les liens de la synchronisation : 8001 a deux numéros (A et C), 8002 est B ; dans l'autre espace, 8001 est X.
    const jeton = await tenir(ici);
    await magasin.ecrireRecherche(ici, jeton, {
      cherchees: [A, B, C],
      trouves: [{ contactId: A, clientId: '8001', etiquettes: [] }, { contactId: C, clientId: '8001', etiquettes: [] }, { contactId: B, clientId: '8002', etiquettes: [] }],
      complete: true,
    });
    const autre = await tenir(ailleurs);
    await magasin.ecrireRecherche(ailleurs, autre, { cherchees: [X], trouves: [{ contactId: X, clientId: '8001', etiquettes: [] }], complete: true });
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[ici, ailleurs]]);
    await pool.end();
  });

  it('🔴 la migration relue en base : contraintes sous leur nom, cascades vers la fiche et le segment, index de la cascade', async () => {
    const contraintes = await pool.query<{ conname: string; def: string; confdeltype: string }>(
      `select conname, pg_get_constraintdef(oid) as def, confdeltype from pg_constraint
        where conrelid in ('shopify_segments'::regclass, 'shopify_segment_membres'::regclass) order by conname`,
    );
    const par = new Map(contraintes.rows.map((r) => [r.conname, r]));
    expect(par.get('shopify_segments_pkey')!.def).toBe('PRIMARY KEY (tenant_id, segment_id)');
    expect(par.get('shopify_segment_membres_pkey')!.def).toBe('PRIMARY KEY (tenant_id, segment_id, contact_id)');
    expect(par.get('shopify_segment_membres_contact_id_fkey')).toMatchObject({ confdeltype: 'c', def: 'FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE' });
    expect(par.get('shopify_segment_membres_segment_fkey')).toMatchObject({
      confdeltype: 'c', def: 'FOREIGN KEY (tenant_id, segment_id) REFERENCES shopify_segments(tenant_id, segment_id) ON DELETE CASCADE',
    });
    expect(par.get('shopify_segments_tenant_id_fkey')).toMatchObject({ confdeltype: 'c' });
    for (const nom of ['shopify_segments_segment_id_check', 'shopify_segments_nom_check', 'shopify_segments_requete_check', 'shopify_segments_curseur_check',
      'shopify_segments_requete_asynchrone_check', 'shopify_segments_membres_check', 'shopify_segments_fiches_check', 'shopify_segments_lecture_membres_check']) {
      expect(par.has(nom), nom).toBe(true);
    }
    const index = await pool.query<{ indexdef: string }>(`select indexdef from pg_indexes where indexname = 'shopify_segment_membres_contact'`);
    expect(index.rows[0]!.indexdef).toMatch(/USING btree \(contact_id\)$/);
    await expect(pool.query(`insert into shopify_segments (tenant_id, segment_id, nom) values ($1, 'abc', 'x')`, [ici])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(`insert into shopify_segments (tenant_id, segment_id, nom) values ($1, '1', '')`, [ici])).rejects.toMatchObject({ code: '23514' });
  });

  it('🔴 la liste s’écrit sous le jeton seulement ; complète, elle marque les disparus ; incomplète, personne', async () => {
    expect(await magasin.ecrireSegments(ici, randomUUID(), { segments: [{ segmentId: '11', nom: 'VIP', requete: null }], complete: true })).toBe(false);
    expect(await segment(ici, '11')).toBeUndefined();
    const jeton = await tenir(ici);
    const liste = [{ segmentId: '11', nom: 'VIP', requete: 'number_of_orders >= 3' }, { segmentId: '12', nom: 'Hiver', requete: null }, { segmentId: '13', nom: 'Parti', requete: null }];
    expect(await magasin.ecrireSegments(ici, jeton, { segments: liste, complete: true })).toBe(true);
    expect(await magasin.ecrireSegments(ici, jeton, { segments: liste.slice(0, 2), complete: false })).toBe(true);
    expect(await segment(ici, '13')).toMatchObject({ absent: false });
    expect(await magasin.ecrireSegments(ici, jeton, { segments: liste.slice(0, 2), complete: true })).toBe(true);
    expect(await segment(ici, '13')).toMatchObject({ absent: true });
    // L'autre espace a son propre segment 11, jamais touché par cette liste.
    const autre = await tenir(ailleurs);
    await magasin.ecrireSegments(ailleurs, autre, { segments: [{ segmentId: '11', nom: 'Ailleurs', requete: null }], complete: true });
    expect((await magasin.segments(ici)).map((s) => [s.segmentId, s.nom, s.absent])).toEqual([['12', 'Hiver', false], ['11', 'VIP', false], ['13', 'Parti', true]]);
    expect((await magasin.segments(ailleurs)).map((s) => s.nom)).toEqual(['Ailleurs']);
  });

  it('🔴 le choix : un segment inconnu ou disparu refuse tout ; exactement ces segments ensuite', async () => {
    expect(await magasin.suivreSegments(ici, ['11', '13', '99'])).toEqual({ inconnus: ['13', '99'] });
    expect(await segment(ici, '11')).toMatchObject({ suivi: false });
    expect(await magasin.suivreSegments(ici, ['11'])).toEqual({ inconnus: [] });
    expect(await segment(ici, '11')).toMatchObject({ suivi: true });
    // Le segment 11 de l'autre espace n'est pas suivi par ce choix.
    expect((await magasin.segments(ailleurs))[0]).toMatchObject({ suivi: false });
  });

  it('🔴 sans lecture : le critère est REFUSÉ par chaque lecture, en nommant le segment, jamais « personne »', async () => {
    await expect(contacts.count(ici, F(['11']))).rejects.toThrow(FiltreContactInvalide);
    await expect(contacts.query(ici, F(['11']), 50, 0)).rejects.toThrow(/« VIP » n’ont pas encore été lus/);
    await expect(contacts.count(ici, F(['12']))).rejects.toThrow(/« Hiver » n’est pas suivi/);
    await expect(contacts.count(ici, F(['13']))).rejects.toThrow(/« Parti » n’existe plus/);
    await expect(contacts.count(ici, F(['77']))).rejects.toThrow(/le segment 77 n’est pas connu/);
  });

  it('🔴 la lecture : les membres entrent par les liens (tous les numéros), fiches actives seules ; la dernière page clôt et compte', async () => {
    const jeton = await tenir(ici);
    expect(await magasin.prochainSegment(ici, randomUUID(), [])).toBe('perdu');
    expect(await magasin.prochainSegment(ici, jeton, [])).toEqual({ segmentId: '11', nom: 'VIP', curseur: null, requete: null, lectureDebut: null });
    // Un jeton étranger n'écrit rien.
    expect(await magasin.ecrirePageSegment(ici, randomUUID(), '11', { apres: null, clients: ['8001'], suivant: null })).toBe(false);
    await magasin.ecrirePageSegment(ici, jeton, '11', { apres: null, clients: ['8001', '9999'], suivant: 'c1' });
    expect(await segment(ici, '11')).toMatchObject({ lu: false, en_lecture: true, curseur: 'c1', lecture_membres: 2 });
    expect(await magasin.prochainSegment(ici, jeton, [])).toMatchObject({ segmentId: '11', curseur: 'c1' });
    await magasin.ecrirePageSegment(ici, jeton, '11', { apres: 'c1', clients: ['8002'], suivant: null });
    expect(await membres(ici, '11')).toEqual(tries(A, B, C));
    expect(await segment(ici, '11')).toMatchObject({ lu: true, partiel: false, en_lecture: false, membres: 3, fiches: 3, curseur: null, lecture_membres: 0 });
    expect(await magasin.prochainSegment(ici, jeton, [])).toBeNull();
    expect(await magasin.finir(ici, jeton, 'lue', null)).toBe(true);
    // Le même client 8001 n'a rien écrit dans l'autre espace.
    expect(await membres(ailleurs, '11')).toEqual([]);
  });

  it('🔴 le critère : appliqué une fois lu, tous ou l’un d’eux ; jamais un autre espace aux mêmes identifiants', async () => {
    expect(await qui(F(['11']))).toEqual(tries(A, B, C));
    await expect(contacts.count(ailleurs, F(['11']))).rejects.toThrow(/« Ailleurs » n’est pas suivi/);
    // L'autre espace suit et lit son segment 11 : ses membres restent les siens.
    expect(await magasin.suivreSegments(ailleurs, ['11'])).toEqual({ inconnus: [] });
    const autre = await tenir(ailleurs);
    await lire(ailleurs, autre, '11', [['8001']]);
    await magasin.finir(ailleurs, autre, 'lue', null);
    expect(await qui(F(['11']), ailleurs)).toEqual([X]);
    expect(await qui(F(['11']))).toEqual(tries(A, B, C));
  });

  it('🔴 la relecture REMPLACE à la dernière page ; inachevée, l’ancienne cible reste et le segment se dit partiel', async () => {
    // Shopify ne compte plus 8002 dans le segment : une lecture inachevée (une page, puis une erreur) ne retire rien.
    let jeton = await tenir(ici);
    expect(await magasin.prochainSegment(ici, jeton, [])).toMatchObject({ segmentId: '11', curseur: null });
    await magasin.ecrirePageSegment(ici, jeton, '11', { apres: null, clients: ['8001'], suivant: 'c1' });
    expect(await qui(F(['11']))).toEqual(tries(A, B, C));
    expect(await magasin.finir(ici, jeton, 'erreur', 'panne')).toBe(true);
    expect(await segment(ici, '11')).toMatchObject({ partiel: true, lu: true, fiches: 3 });
    // La synchronisation suivante repart de la première page, et sa dernière retire B.
    jeton = await tenir(ici);
    expect(await magasin.prochainSegment(ici, jeton, [])).toMatchObject({ segmentId: '11', curseur: null, lectureDebut: null });
    await lire(ici, jeton, '11', [['8001']]);
    expect(await qui(F(['11']))).toEqual(tries(A, C));
    expect(await segment(ici, '11')).toMatchObject({ partiel: false, membres: 1, fiches: 2 });
    await magasin.finir(ici, jeton, 'lue', null);
  });

  it('la requête asynchrone : notée, elle date la lecture et remet le compte à zéro ; oubliée, la date reste', async () => {
    const jeton = await tenir(ici);
    await magasin.ecrirePageSegment(ici, jeton, '11', { apres: null, clients: ['8001'], suivant: 'c1' });
    expect(await magasin.noterRequeteSegment(ici, jeton, '11', 'gid://shopify/CustomerSegmentMembersQuery/7')).toBe(true);
    expect(await segment(ici, '11')).toMatchObject({ requete_asynchrone: 'gid://shopify/CustomerSegmentMembersQuery/7', curseur: null, lecture_membres: 0, en_lecture: true });
    const lu = await magasin.prochainSegment(ici, jeton, []);
    expect(lu).toMatchObject({ requete: 'gid://shopify/CustomerSegmentMembersQuery/7', lectureDebut: expect.any(Date) });
    await magasin.noterRequeteSegment(ici, jeton, '11', null);
    expect(await magasin.prochainSegment(ici, jeton, [])).toMatchObject({ requete: null, lectureDebut: (lu as { lectureDebut: Date }).lectureDebut });
    expect(await magasin.noterRequeteSegment(ici, randomUUID(), '11', 'q')).toBe(false);
    await lire(ici, jeton, '11', [['8001']]);
    await magasin.finir(ici, jeton, 'lue', null);
  });

  it('🔴 une page s’écrit seulement si la lecture en est à elle : décoché puis recoché pendant l’appel, le segment repart de sa première page', async () => {
    const jeton = await tenir(ici);
    expect(await magasin.ecrirePageSegment(ici, jeton, '11', { apres: null, clients: ['8001'], suivant: 'c1' })).toBe(true);
    expect(await magasin.suivreSegments(ici, ['12'])).toEqual({ inconnus: [] });
    expect(await magasin.suivreSegments(ici, ['11'])).toEqual({ inconnus: [] });
    // La page 2, demandée avant le décochage, arrive : elle ne s'écrit pas.
    expect(await magasin.ecrirePageSegment(ici, jeton, '11', { apres: 'c1', clients: ['8002'], suivant: null })).toBe(true);
    expect(await segment(ici, '11')).toMatchObject({ lu: false, en_lecture: false, curseur: null, lecture_membres: 0 });
    expect(await membres(ici, '11')).toEqual([]);
    expect(await magasin.prochainSegment(ici, jeton, [])).toMatchObject({ segmentId: '11', curseur: null });
    // Un segment laissé de côté par le passage n'est plus proposé.
    expect(await magasin.prochainSegment(ici, jeton, ['11'])).toBeNull();
    await magasin.finir(ici, jeton, 'lue', null);
  });

  it('🔴 un segment quitté perd ses membres et sa lecture ; la cascade d’une fiche supprimée pour de bon emporte ses appartenances', async () => {
    expect(await magasin.suivreSegments(ici, ['12'])).toEqual({ inconnus: [] });
    expect(await membres(ici, '11')).toEqual([]);
    expect(await segment(ici, '11')).toMatchObject({ suivi: false, lu: false, fiches: 0 });
    await expect(contacts.count(ici, F(['11']))).rejects.toThrow(/n’est pas suivi/);
    expect(await magasin.suivreSegments(ici, ['11'])).toEqual({ inconnus: [] });
    const jeton = await tenir(ici);
    await lire(ici, jeton, '11', [['8001', '8002']]);
    await magasin.finir(ici, jeton, 'lue', null);
    expect(await membres(ici, '11')).toEqual(tries(A, B, C));
    await pool.query(`delete from contacts where id = $1`, [C]);
    expect(await membres(ici, '11')).toEqual(tries(A, B));
  });

  it('🔴 une fiche supprimée, encore reliée à son client, n’entre jamais dans un segment ; restaurée, elle y revient', async () => {
    await pool.query(`update contacts set deleted_at = now() where id = $1`, [A]);
    try {
      expect((await pool.query(`select 1 from shopify_clients where tenant_id = $1 and contact_id = $2`, [ici, A])).rowCount).toBe(1);
      const jeton = await tenir(ici);
      await lire(ici, jeton, '11', [['8001', '8002']]);
      await magasin.finir(ici, jeton, 'lue', null);
      expect(await membres(ici, '11')).toEqual([B]);
    } finally {
      await pool.query(`update contacts set deleted_at = null where id = $1`, [A]);
    }
    const jeton = await tenir(ici);
    await lire(ici, jeton, '11', [['8001', '8002']]);
    await magasin.finir(ici, jeton, 'lue', null);
    expect(await membres(ici, '11')).toEqual(tries(A, B));
  });

  it('🔴 la purge d’une fiche efface ses appartenances ; une fiche purgée n’entre plus jamais dans un segment', async () => {
    await contacts.purgeMany(ici, [B]);
    expect(await membres(ici, '11')).toEqual([A]);
    const jeton = await tenir(ici);
    await lire(ici, jeton, '11', [['8001', '8002']]);
    await magasin.finir(ici, jeton, 'lue', null);
    expect(await membres(ici, '11')).toEqual([A]);
    expect(await membres(ailleurs, '11')).toEqual([X]);
  });

  it('🔴 l’effacement du branchement emporte les segments de l’espace, jamais ceux d’un autre ; le critère redevient refusé', async () => {
    await shopify.effacerBoutique(ici);
    for (const table of ['shopify_segments', 'shopify_segment_membres']) {
      expect(Number((await pool.query<{ n: string }>(`select count(*) as n from ${table} where tenant_id = $1`, [ici])).rows[0]!.n), table).toBe(0);
    }
    expect(await membres(ailleurs, '11')).toEqual([X]);
    await expect(contacts.count(ici, F(['11']))).rejects.toThrow(/le segment 11 n’est pas connu/);
  });
});
