import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgContactStore, type ContactFilters } from '../../src/crm/contact-store.pg';
import { FiltreContactInvalide } from '../../src/crm/contact-filters';
import { PgShopifyStore } from '../../src/shopify/store.pg';
import { PgEtiquettesStore } from '../../src/shopify/etiquettes.pg';
import { traiterEtiquettes, type DepsEtiquettes } from '../../src/shopify/etiquettes';
import { REFUS_SANS_SYNCHRO, REFUS_SYNCHRO_EN_COURS, synchroVivante } from '../../src/shopify/etiquettes-garde';
import { PgVentesStore } from '../../src/shopify/ventes.pg';
import { ficheAvecEtiquetteShopify } from '../../src/crm/segments';
import { CLES_SEGMENT as S, filtreSegment } from '../../web/lib/partage/segments';

const url = process.env.DATABASE_URL ?? '';

/**
 * LES ÉTIQUETTES DES CLIENTS SHOPIFY contre un VRAI Postgres (segments Shopify enrichis, lot 6b, migration 0319 ; lot 6b
 * bis, migration 0326). Ce qu'aucun faux ne prouve : la migration relue en base (contraintes sous leur nom, cascades, index
 * d'expression), la demande et le BAIL (un porteur périmé n'écrit plus rien), le lien par ce que Shopify rend pour le client
 * (jamais par une commande notée), la recherche par téléphone, le remplacement en bloc, le client disparu, 🔴 la fiche supprimée jamais touchée, 🔴 le critère « étiquette
 * Shopify » refusé sans synchronisation aboutie et appliqué sans la casse ensuite, sur deux espaces (aucune fuite, même aux
 * mêmes identifiants), 🔴 jamais les étiquettes Messaging Me, la purge d'une fiche, `customers/redact` par le lien, et
 * l'effacement du branchement.
 *
 * ⚠️ Jamais joué en local contre `DATABASE_URL` (l'ancienne production) : joué par le job `integration`, ou sur le banc
 * PGlite (une requête à la fois : la concurrence réelle de `skip locked` ne s'y voit pas, seules ses règles).
 */
describe.skipIf(!url)('les étiquettes des clients Shopify (Postgres)', () => {
  let pool: Pool;
  let contacts: PgContactStore;
  let shopify: PgShopifyStore;
  let magasin: PgEtiquettesStore;
  let ici = '';
  let ailleurs = '';
  let A = '';
  let B = '';
  let C = '';
  let D = '';
  let X = '';

  const F = (etiquettes: string[], mode: 'toutes' | 'une' = 'toutes'): ContactFilters => ({ fieldFilters: [filtreSegment(S.etiquetteShopify, { etiquettes, mode })] });
  const qui = async (f: ContactFilters, t = ici): Promise<string[]> => {
    const lignes = await contacts.query(t, f, 500, 0);
    expect(await contacts.count(t, f)).toBe(lignes.length);
    return lignes.map((c) => c.id).sort();
  };
  const tries = (...ids: string[]): string[] => [...ids].sort();
  const lignes = async (table: string, t: string): Promise<number> =>
    Number((await pool.query<{ n: string }>(`select count(*) as n from ${table} where tenant_id = $1`, [t])).rows[0]!.n);
  const etiquettesDe = async (t: string, fiche: string): Promise<string[]> =>
    (await pool.query<{ etiquette: string }>(`select etiquette from shopify_etiquettes where tenant_id = $1 and contact_id = $2 order by etiquette`, [t, fiche])).rows.map((r) => r.etiquette);
  const tagsMessagingMe = async (fiche: string): Promise<string[]> =>
    (await pool.query<{ tags: string[] }>(`select tags from contacts where id = $1`, [fiche])).rows[0]!.tags ?? [];
  /** Une synchronisation commencée et son bail : le jeton qui tient. */
  const tenir = async (t: string): Promise<string> => {
    await magasin.regler(t, true);
    await pool.query(`update shopify_etiquettes_synchro set en_cours_depuis = null, bail_jusqua = null, jeton = null, demandee_le = null where tenant_id = $1`, [t]);
    expect(await magasin.demander(t, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
    const prise = await magasin.prendre(t);
    expect(prise).not.toBeNull();
    return prise!.jeton;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    contacts = new PgContactStore(pool);
    shopify = new PgShopifyStore(pool, randomBytes(32).toString('hex'));
    magasin = new PgEtiquettesStore(pool);
    const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    ici = await espace('itest-etiquettes');
    ailleurs = await espace('itest-etiquettes-autre');
    const fiche = async (t: string, tel: string, tags: string[] = []) =>
      (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164, tags) values ($1, $2, $3) returning id`, [t, tel, tags])).rows[0]!.id;
    A = await fiche(ici, '+33600619001', ['VIP']);
    B = await fiche(ici, '+33600619002');
    C = await fiche(ici, '+33600619003');
    D = await fiche(ici, '+33600619004');
    X = await fiche(ailleurs, '+33600619001');
    for (const t of [ici, ailleurs]) {
      await pool.query(
        `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre, devise) values ($1, $2, 'cid', 'x', 'EUR')`,
        [t, `itest-${randomUUID().slice(0, 8)}.myshopify.com`],
      );
    }
    // Le même client et la même commande dans les deux espaces ; 🔴 une commande ne relie jamais rien (lot 6b, relecture).
    await shopify.lierCommande(ici, '7001', '5001', A);
    await shopify.lierCommande(ailleurs, '7001', '5001', X);
    // D : une commande, puis la fiche supprimée ; jamais reliée ni étiquetée.
    await shopify.lierCommande(ici, '7004', '5004', D);
    await pool.query(`update contacts set deleted_at = now() where id = $1`, [D]);
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[ici, ailleurs]]);
    await pool.end();
  });

  it('🔴 la migration relue en base : contraintes sous leur nom, cascades vers la fiche, index d’expression', async () => {
    const contraintes = await pool.query<{ conname: string; def: string; confdeltype: string }>(
      `select conname, pg_get_constraintdef(oid) as def, confdeltype from pg_constraint
        where conrelid in ('shopify_clients'::regclass, 'shopify_etiquettes'::regclass, 'shopify_fiches_cherchees'::regclass,
                           'shopify_etiquettes_synchro'::regclass)
        order by conname`,
    );
    const par = new Map(contraintes.rows.map((r) => [r.conname, r]));
    for (const table of ['shopify_clients', 'shopify_etiquettes', 'shopify_fiches_cherchees']) {
      expect(par.get(`${table}_contact_id_fkey`), table).toMatchObject({ confdeltype: 'c' });
      expect(par.get(`${table}_contact_id_fkey`)!.def).toContain('REFERENCES contacts(id) ON DELETE CASCADE');
    }
    // 0326 : plus de « une fiche, un client » ; le lien est le couple, et ses étiquettes partent avec lui.
    expect(par.has('shopify_clients_contact_key')).toBe(false);
    expect(par.get('shopify_clients_pkey')!.def).toBe('PRIMARY KEY (tenant_id, client_id, contact_id)');
    expect(par.get('shopify_etiquettes_pkey')!.def).toBe('PRIMARY KEY (tenant_id, contact_id, client_id, etiquette)');
    expect(par.get('shopify_etiquettes_lien_fkey')).toMatchObject({
      confdeltype: 'c',
      def: 'FOREIGN KEY (tenant_id, client_id, contact_id) REFERENCES shopify_clients(tenant_id, client_id, contact_id) ON DELETE CASCADE',
    });
    expect(par.has('shopify_etiquettes_client_id_check')).toBe(true);
    expect(par.get('shopify_etiquettes_etiquette_check')!.def).toMatch(/char_length\(etiquette\) >= 1\) AND \(char_length\(etiquette\) <= 255/);
    for (const nom of ['shopify_clients_client_id_check', 'shopify_etiquettes_synchro_issue_check', 'shopify_etiquettes_synchro_message_check',
      'shopify_etiquettes_synchro_curseur_check', 'shopify_etiquettes_synchro_clients_lus_check']) {
      expect(par.has(nom), nom).toBe(true);
    }
    const index = await pool.query<{ indexdef: string }>(`select indexdef from pg_indexes where indexname = 'shopify_etiquettes_etiquette'`);
    expect(index.rows[0]!.indexdef).toContain('(tenant_id, lower(etiquette))');
    // 0320 : un index sur contact_id seul par table de la fiche, celui qu'emprunte la cascade d'une fiche supprimée.
    const cascade = await pool.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where indexname in ('shopify_clients_contact', 'shopify_etiquettes_contact', 'shopify_fiches_cherchees_contact') order by indexname`,
    );
    expect(cascade.rows.map((r) => [r.indexname, r.indexdef.replace(/^.* USING btree /, '')])).toEqual([
      ['shopify_clients_contact', '(contact_id)'], ['shopify_etiquettes_contact', '(contact_id)'], ['shopify_fiches_cherchees_contact', '(contact_id)'],
    ]);
    // Une étiquette de 256 caractères est refusée par la table elle-même.
    await expect(pool.query(`insert into shopify_etiquettes (tenant_id, contact_id, client_id, etiquette) values ($1, $2, '5001', $3)`, [ici, A, 'e'.repeat(256)]))
      .rejects.toMatchObject({ code: '23514' });
    // Une étiquette sans le lien de son couple : refusée (la clé étrangère de la 0326).
    await expect(pool.query(`insert into shopify_etiquettes (tenant_id, contact_id, client_id, etiquette) values ($1, $2, '5999', 'X')`, [ici, A]))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('🔴 sans synchronisation aboutie, le critère est REFUSÉ par chaque lecture, jamais « personne » ; en cours, la phrase le dit', async () => {
    await expect(contacts.count(ici, F(['VIP']))).rejects.toThrow(REFUS_SANS_SYNCHRO);
    await expect(contacts.query(ici, F(['VIP']))).rejects.toThrow(FiltreContactInvalide);
    await expect(contacts.contactIdsForTarget(ici, { filters: F(['VIP']) })).rejects.toThrow(FiltreContactInvalide);
    await expect(contacts.applyEditsMany(ici, { filters: F(['VIP']) }, { addTags: ['copie'] })).rejects.toThrow(FiltreContactInvalide);
    await magasin.regler(ici, true);
    expect(await magasin.demander(ici, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
    await expect(contacts.count(ici, F(['VIP']))).rejects.toThrow(REFUS_SYNCHRO_EN_COURS);
    expect((await pool.query(`select count(*)::int as n from contacts where tenant_id = $1 and 'copie' = any(tags)`, [ici])).rows[0]!.n).toBe(0);
  });

  it('🔴 la demande : une à la fois ; la Free attend 24 h ; le bail : pris une fois, repris mort, un jeton périmé n’écrit plus rien', async () => {
    // Une synchronisation vit (la demande du test précédent) : aucune autre.
    expect(await magasin.demander(ici, { auPlusUneFoisParJour: false })).toBeNull();
    const premier = await magasin.prendre(ici);
    expect(premier).toMatchObject({ curseur: null });
    expect(await magasin.prendre(ici)).toBeNull();
    // Le porteur meurt : son bail expire, un autre reprend.
    await pool.query(`update shopify_etiquettes_synchro set bail_jusqua = now() - interval '1 second' where tenant_id = $1`, [ici]);
    const repris = await magasin.prendre(ici);
    expect(repris!.jeton).not.toBe(premier!.jeton);
    expect(await magasin.ecrireClients(ici, premier!.jeton, { lus: [{ clientId: '5001', etiquettes: ['périmé'] }], curseur: '5001' })).toBe(false);
    expect(await magasin.ecrireRecherche(ici, premier!.jeton, { cherchees: [B], trouves: [], complete: true })).toBeNull();
    expect(await magasin.finir(ici, premier!.jeton, 'lue', null)).toBe(false);
    expect(await lignes('shopify_clients', ici)).toBe(0);
    // La synchronisation tenue se clôt ; la Free ne redemande pas avant 24 h, le Pro si.
    expect(await magasin.finir(ici, repris!.jeton, 'erreur', 'essai')).toBe(true);
    expect(await magasin.demander(ici, { auPlusUneFoisParJour: true })).toBeNull();
    expect(await magasin.demander(ici, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
    await pool.query(`update shopify_etiquettes_synchro set en_cours_depuis = null where tenant_id = $1`, [ici]);
  });

  it('🔴 les commandes notées ne relient rien ; trouvé chez Shopify par un numéro, un client se relie à la fiche de ce numéro', async () => {
    const jeton = await tenir(ici);
    // Les commandes de 5001 (fiche A) et de 5004 (fiche D, supprimée) sont notées depuis le début : aucun lien n'en vient.
    expect(await lignes('shopify_clients', ici)).toBe(0);
    expect(await magasin.ecrireRecherche(ici, jeton, { cherchees: [A], trouves: [{ contactId: A, clientId: '5001', etiquettes: [] }], complete: true })).toEqual({ relies: 1 });
    const liens = (await pool.query<{ client_id: string; contact_id: string }>(`select client_id, contact_id from shopify_clients where tenant_id = $1`, [ici])).rows;
    expect(liens).toEqual([{ client_id: '5001', contact_id: A }]);
    expect(await lignes('shopify_clients', ailleurs)).toBe(0);
  });

  it('🔴 la recherche par téléphone : les fiches actives sans marque ; écrite, elle relie, marque, et n’écrit jamais les étiquettes Messaging Me', async () => {
    const jeton = (await pool.query<{ jeton: string }>(`select jeton from shopify_etiquettes_synchro where tenant_id = $1`, [ici])).rows[0]!.jeton;
    const aChercher = await magasin.aChercher(ici, 25, null);
    expect(aChercher).toEqual([{ contactId: B, telephone: '+33600619002' }, { contactId: C, telephone: '+33600619003' }]);
    expect(await magasin.ecrireRecherche(ici, jeton, {
      cherchees: [B, C, D],
      trouves: [{ contactId: B, clientId: '5002', etiquettes: ['VIP', 'Grossiste'] }, { contactId: D, clientId: '5004', etiquettes: ['Perdu'] }],
      complete: true,
    })).toEqual({ relies: 1 });
    expect(await etiquettesDe(ici, B)).toEqual(['Grossiste', 'VIP']);
    expect(await etiquettesDe(ici, D)).toEqual([]);
    const marques = (await pool.query<{ contact_id: string }>(`select contact_id from shopify_fiches_cherchees where tenant_id = $1 order by contact_id`, [ici])).rows.map((r) => r.contact_id);
    expect(marques).toEqual(tries(A, B, C));
    expect(await magasin.aChercher(ici, 25, null)).toEqual([]);
    // 🔴 Trois listes qui ne se mélangent pas : les étiquettes Messaging Me de la fiche n'ont pas bougé.
    expect(await tagsMessagingMe(B)).toEqual([]);
    expect(await tagsMessagingMe(A)).toEqual(['VIP']);
    const etat = (await pool.query(`select clients_lus, trouves_par_telephone, sans_fiche from shopify_etiquettes_synchro where tenant_id = $1`, [ici])).rows[0];
    // Deux clients reliés par leur téléphone (A, puis B), un trouvé sans fiche (D) ; aucun encore lu par son identifiant.
    expect(etat).toEqual({ clients_lus: 0, trouves_par_telephone: 2, sans_fiche: 1 });
  });

  it('🔴 la lecture par identifiant : étiquettes REMPLACÉES en bloc ; un client disparu perd son lien, ses étiquettes et sa marque', async () => {
    const jeton = (await pool.query<{ jeton: string }>(`select jeton from shopify_etiquettes_synchro where tenant_id = $1`, [ici])).rows[0]!.jeton;
    expect(await magasin.clientsALire(ici, null, 250)).toEqual(['5001', '5002']);
    expect(await magasin.clientsALire(ici, '5001', 250)).toEqual(['5002']);
    expect(await magasin.ecrireClients(ici, jeton, { lus: [{ clientId: '5001', etiquettes: ['vip'] }, { clientId: '5002', etiquettes: null }], curseur: '5002' })).toBe(true);
    expect(await etiquettesDe(ici, A)).toEqual(['vip']);
    expect(await etiquettesDe(ici, B)).toEqual([]);
    expect((await pool.query(`select 1 from shopify_clients where tenant_id = $1 and client_id = '5002'`, [ici])).rowCount).toBe(0);
    expect((await pool.query(`select 1 from shopify_fiches_cherchees where tenant_id = $1 and contact_id = $2`, [ici, B])).rowCount).toBe(0);
    expect((await pool.query<{ curseur: string }>(`select curseur from shopify_etiquettes_synchro where tenant_id = $1`, [ici])).rows[0]!.curseur).toBe('5002');
    // B redevient cherchable une fois : on la relie de nouveau, avec ses étiquettes.
    expect(await magasin.ecrireRecherche(ici, jeton, { cherchees: [B], trouves: [{ contactId: B, clientId: '5012', etiquettes: ['VIP', 'Grossiste'] }], complete: true })).toEqual({ relies: 1 });
    expect(await magasin.finir(ici, jeton, 'lue', null)).toBe(true);
    const fin = (await pool.query(`select synchro_le is not null as lue, fiches_etiquetees, en_cours_depuis, jeton, curseur from shopify_etiquettes_synchro where tenant_id = $1`, [ici])).rows[0];
    expect(fin).toEqual({ lue: true, fiches_etiquetees: 2, en_cours_depuis: null, jeton: null, curseur: null });
    expect((await contacts.suiviSegments(ici)).boutique?.etiquettesSynchroLe).toBeInstanceOf(Date);
  });

  it('🔴 « étiquette Shopify » : sans la casse, toutes ou l’une, appliqué même à zéro fiche, jamais un autre espace ni les étiquettes Messaging Me', async () => {
    expect(await qui(F(['VIP']))).toEqual(tries(A, B));
    expect(await qui(F(['VIP', 'Grossiste']))).toEqual([B]);
    expect(await qui(F(['Grossiste', 'Absente'], 'une'))).toEqual([B]);
    expect(await qui(F(['Absente']))).toEqual([]);
    // Le même mot côté Messaging Me (A porte l'étiquette « VIP ») ne fait pas un critère d'étiquette Shopify, ni l'inverse.
    expect(await qui({ tags: ['Grossiste'] })).toEqual([]);
    // L'autre espace : aucune synchronisation, refusé ; synchronisé, seulement ses fiches.
    await expect(qui(F(['VIP']), ailleurs)).rejects.toThrow(REFUS_SANS_SYNCHRO);
    await pool.query(`insert into shopify_clients (tenant_id, client_id, contact_id) values ($1, '5001', $2)`, [ailleurs, X]);
    await pool.query(`insert into shopify_etiquettes (tenant_id, contact_id, client_id, etiquette) values ($1, $2, '5001', 'VIP')`, [ailleurs, X]);
    await pool.query(`insert into shopify_etiquettes_synchro (tenant_id, allumee, synchro_le) values ($1, true, now())`, [ailleurs]);
    expect(await qui(F(['vip']), ailleurs)).toEqual([X]);
    expect(await qui(F(['VIP']))).toEqual(tries(A, B));
  });

  it('la copie explicite : l’action en masse sur la cible du critère pose une étiquette Messaging Me, sans suivi ensuite', async () => {
    expect((await contacts.applyEditsMany(ici, { filters: F(['Grossiste']) }, { addTags: ['Grossiste'] })).affected).toBe(1);
    expect(await tagsMessagingMe(B)).toEqual(['Grossiste']);
    expect(await tagsMessagingMe(A)).toEqual(['VIP']);
  });

  it('🔴 l’index (tenant_id, lower(etiquette)) SERT la sous-requête du critère, et la requête entière s’exécute', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local enable_seqscan = off');
      const sous = ficheAvecEtiquetteShopify(['VIP'], () => '$2').replace(/^id in \((.*)\)$/s, '$1');
      const plan = (await client.query<{ 'QUERY PLAN': string }>(`explain ${sous}`, [ici, 'VIP'])).rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(plan).toContain('shopify_etiquettes_etiquette');
      expect((await client.query(sous, [ici, 'VIP'])).rowCount).toBe(2);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('l’onglet Shopify de la fiche montre ses étiquettes Shopify et leur date ; jamais celles d’un autre espace', async () => {
    const vue = await new PgVentesStore(pool).achatsDuContact(ici, B);
    expect(vue?.etiquettesShopify).toMatchObject({ etiquettes: ['Grossiste', 'VIP'], synchroLe: expect.any(String) });
    const autre = await new PgVentesStore(pool).achatsDuContact(ailleurs, X);
    expect(autre?.etiquettesShopify?.etiquettes).toEqual(['VIP']);
  });

  it('🔴 customers/redact ne purge jamais par un lien de la synchronisation ; la purge efface les liens, marques et étiquettes de la fiche', async () => {
    // Le lien (5012, B) n'est pas une commande : l'effacement du client ne retrouve pas B par lui (lot 6b bis).
    expect(await shopify.contactsLies(ici, [], '5012')).toEqual([]);
    expect(await shopify.contactsLies(ailleurs, [], '5012')).toEqual([]);
    await contacts.purgeMany(ici, [B]);
    for (const table of ['shopify_clients', 'shopify_fiches_cherchees', 'shopify_etiquettes']) {
      expect((await pool.query(`select 1 from ${table} where tenant_id = $1 and contact_id = $2`, [ici, B])).rowCount, table).toBe(0);
    }
    expect(await etiquettesDe(ici, A)).toEqual(['vip']);
    // Purgée, la fiche n'est plus jamais écrite : ni reliée, ni marquée, ni étiquetée.
    const jeton = await tenir(ici);
    expect(await magasin.ecrireRecherche(ici, jeton, { cherchees: [B], trouves: [{ contactId: B, clientId: '5022', etiquettes: ['VIP'] }], complete: true })).toEqual({ relies: 0 });
    expect(await magasin.ecrireClients(ici, jeton, { lus: [{ clientId: '5001', etiquettes: ['VIP', 'Fidèle'] }], curseur: '5001' })).toBe(true);
    expect(await etiquettesDe(ici, B)).toEqual([]);
    expect(await etiquettesDe(ici, A)).toEqual(['Fidèle', 'VIP']);
  });

  it('🔴 l’effacement du branchement emporte les quatre tables de l’espace, jamais celles d’un autre ; le critère redevient refusé', async () => {
    await shopify.effacerBoutique(ici);
    for (const table of ['shopify_clients', 'shopify_fiches_cherchees', 'shopify_etiquettes', 'shopify_etiquettes_synchro']) {
      expect(await lignes(table, ici), table).toBe(0);
    }
    expect(await lignes('shopify_etiquettes', ailleurs)).toBe(1);
    expect(await lignes('shopify_etiquettes_synchro', ailleurs)).toBe(1);
    await expect(contacts.count(ici, F(['VIP']))).rejects.toThrow(REFUS_SANS_SYNCHRO);
    // Un job qui finit après l'effacement ne ressuscite rien.
    expect(await magasin.finir(ici, randomUUID(), 'lue', null)).toBe(false);
    expect(await lignes('shopify_etiquettes_synchro', ici)).toBe(0);
  });

  it('🔴 la relecture quotidienne : jamais la Free ; un Pro allumé, branché, dû, une fois', async () => {
    // L'autre espace est en Free (aucun Pro) : jamais relancé, même allumé et dû.
    await pool.query(`update shopify_etiquettes_synchro set demandee_le = now() - interval '25 hours' where tenant_id = $1`, [ailleurs]);
    expect((await magasin.dues(200)).map((d) => d.tenantId)).not.toContain(ailleurs);
    await pool.query(`update tenants set offre_business = true where id = $1`, [ailleurs]);
    try {
      expect((await magasin.dues(200)).map((d) => d.tenantId)).toContain(ailleurs);
      expect((await magasin.dues(200)).map((d) => d.tenantId)).not.toContain(ailleurs);
      // Éteinte : plus de relecture.
      await pool.query(`update shopify_etiquettes_synchro set demandee_le = now() - interval '25 hours', en_cours_depuis = null, allumee = false where tenant_id = $1`, [ailleurs]);
      expect((await magasin.dues(200)).map((d) => d.tenantId)).not.toContain(ailleurs);
    } finally {
      await pool.query(`update tenants set offre_business = false where id = $1`, [ailleurs]);
    }
  });
});

/**
 * 🔴 L'ESPACE SUR CHAQUE REQUÊTE DE LA SYNCHRONISATION, AUX MÊMES IDENTIFIANTS SHOPIFY (lot 6b). Deux boutiques rendent
 * le même identifiant de client, et un jeton, une date ou une fiche peuvent être présentés au mauvais espace : chaque
 * lecture et chaque écriture du magasin ne voit que l'espace qu'on lui nomme. Les mutations du lot retirent un à un ces
 * `tenant_id` : chacun rend ce bloc rouge, sauf les prédicats que le même énoncé double déjà (une fiche ou un jeton déjà
 * lus dans l'espace), prouvés par paire.
 */
describe.skipIf(!url)('les étiquettes Shopify : l’espace sur chaque requête de la synchronisation (Postgres)', () => {
  let pool: Pool;
  let contacts: PgContactStore;
  let shopify: PgShopifyStore;
  let magasin: PgEtiquettesStore;
  let P = '';
  let Q = '';
  let R = '';
  let P1 = '';
  let P2 = '';
  let P3 = '';
  let Q1 = '';
  let Q2 = '';
  let Q3 = '';
  let R1 = '';
  let jetonP = '';
  let jetonQ = '';

  const F = (etiquettes: string[]): ContactFilters => ({ fieldFilters: [filtreSegment(S.etiquetteShopify, { etiquettes, mode: 'toutes' })] });
  const liens = async (t: string) => (await pool.query<{ client_id: string; contact_id: string }>(
    `select client_id, contact_id from shopify_clients where tenant_id = $1 order by client_id`, [t])).rows;
  const etiquettesDe = async (t: string, fiche: string): Promise<string[]> =>
    (await pool.query<{ etiquette: string }>(`select etiquette from shopify_etiquettes where tenant_id = $1 and contact_id = $2 order by etiquette`, [t, fiche])).rows.map((r) => r.etiquette);
  const marquee = async (t: string, fiche: string): Promise<boolean> =>
    ((await pool.query(`select 1 from shopify_fiches_cherchees where tenant_id = $1 and contact_id = $2`, [t, fiche])).rowCount ?? 0) > 0;
  const etat = async (t: string) => (await pool.query(
    `select clients_lus, sans_fiche, jeton, bail_jusqua, en_cours_depuis, demandee_le, issue from shopify_etiquettes_synchro where tenant_id = $1`, [t])).rows[0];
  const vuLe = async (t: string, client: string) =>
    (await pool.query<{ vu_le: Date | null }>(`select vu_le from shopify_clients where tenant_id = $1 and client_id = $2`, [t, client])).rows[0]?.vu_le;
  /** Ce que l'espace écrit au nom d'une fiche d'un AUTRE espace, dans les trois tables : rien, jamais. */
  const croises = async (t: string, fiches: string[]): Promise<number> => Number((await pool.query<{ n: string }>(
    `select (select count(*) from shopify_clients where tenant_id = $1 and contact_id = any($2::uuid[]))
          + (select count(*) from shopify_fiches_cherchees where tenant_id = $1 and contact_id = any($2::uuid[]))
          + (select count(*) from shopify_etiquettes where tenant_id = $1 and contact_id = any($2::uuid[])) as n`, [t, fiches])).rows[0]!.n);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    contacts = new PgContactStore(pool);
    shopify = new PgShopifyStore(pool, randomBytes(32).toString('hex'));
    magasin = new PgEtiquettesStore(pool);
    const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    P = await espace('itest-etiquettes-p');
    Q = await espace('itest-etiquettes-q');
    R = await espace('itest-etiquettes-r');
    const fiche = async (t: string, tel: string) =>
      (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [t, tel])).rows[0]!.id;
    P1 = await fiche(P, '+33600639001');
    P2 = await fiche(P, '+33600639002');
    P3 = await fiche(P, '+33600639003');
    Q1 = await fiche(Q, '+33600639001');
    Q2 = await fiche(Q, '+33600639002');
    Q3 = await fiche(Q, '+33600639003');
    R1 = await fiche(R, '+33600639001');
    for (const t of [P, Q, R]) {
      await pool.query(
        `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre, devise) values ($1, $2, 'cid', 'x', 'EUR')`,
        [t, `itest-${randomUUID().slice(0, 8)}.myshopify.com`],
      );
    }
    // Le MÊME client 8001 chez P et chez Q, la commande de Q la plus récente ; le client 8002, chez Q seulement.
    const commande = (payeeLe: string) => ({ payeeLe: new Date(payeeLe), montant: '10', devise: 'EUR', test: false });
    await shopify.lierCommande(P, '9001', '8001', P1, commande('2026-11-01T10:00:00.000Z'));
    await shopify.lierCommande(Q, '9001', '8001', Q1, commande('2026-11-20T10:00:00.000Z'));
    await shopify.lierCommande(Q, '9002', '8002', Q2, commande('2026-11-21T10:00:00.000Z'));
    const commencer = async (t: string): Promise<string> => {
      await magasin.regler(t, true);
      expect(await magasin.demander(t, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
      return (await magasin.prendre(t))!.jeton;
    };
    jetonQ = await commencer(Q);
    jetonP = await commencer(P);
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[P, Q, R]]);
    await pool.end();
  });

  it('🔴 le même client se relie dans chaque espace, à la fiche de son numéro ; les commandes des deux espaces ne relient rien', async () => {
    expect(await liens(P)).toEqual([]);
    expect(await liens(Q)).toEqual([]);
    expect(await magasin.ecrireRecherche(Q, jetonQ, {
      cherchees: [Q1, Q2], trouves: [{ contactId: Q1, clientId: '8001', etiquettes: [] }, { contactId: Q2, clientId: '8002', etiquettes: [] }],
      complete: true,
    })).toEqual({ relies: 2 });
    // Le client 8001 est déjà relié chez Q : chez P, il se relie quand même, à la fiche de P.
    expect(await magasin.ecrireRecherche(P, jetonP, { cherchees: [P1], trouves: [{ contactId: P1, clientId: '8001', etiquettes: [] }], complete: true })).toEqual({ relies: 1 });
    expect(await liens(P)).toEqual([{ client_id: '8001', contact_id: P1 }]);
    expect(await liens(Q)).toEqual([{ client_id: '8001', contact_id: Q1 }, { client_id: '8002', contact_id: Q2 }]);
  });

  it('🔴 la recherche par téléphone ne propose, ne marque, ne relie et n’étiquette que les fiches de l’espace', async () => {
    expect((await magasin.aChercher(P, 25, null)).map((f) => f.contactId)).toEqual([P2, P3]);
    // Une fiche d'un AUTRE espace présentée à P, cherchée et trouvée : ni marquée, ni reliée, ni étiquetée chez P.
    expect(await magasin.ecrireRecherche(P, jetonP, {
      cherchees: [P3, Q3],
      trouves: [{ contactId: Q3, clientId: '8009', etiquettes: ['Pirate'] }, { contactId: P3, clientId: '8003', etiquettes: ['Commun'] }],
      complete: true,
    })).toEqual({ relies: 1 });
    expect(await croises(P, [Q1, Q2, Q3, R1])).toBe(0);
    expect(await marquee(P, P3)).toBe(true);
    // Q relie ENSUITE le même client 8003 à sa propre fiche : chacun le sien.
    expect(await magasin.ecrireRecherche(Q, jetonQ, { cherchees: [Q3], trouves: [{ contactId: Q3, clientId: '8003', etiquettes: ['Commun', 'Q'] }], complete: true }))
      .toEqual({ relies: 1 });
    expect(await liens(P)).toEqual([{ client_id: '8001', contact_id: P1 }, { client_id: '8003', contact_id: P3 }]);
    expect(await croises(Q, [P1, P2, P3, R1])).toBe(0);
  });

  it('🔴 la lecture par identifiant n’écrit, n’oublie et ne date que les liens de l’espace, au même identifiant de client', async () => {
    const vuQ = await vuLe(Q, '8001');
    expect(await magasin.clientsALire(P, null, 250)).toEqual(['8001', '8003']);
    // Chez P : 8001 lu, P1 étiquetée ; 8003 disparu, son lien, ses étiquettes et sa marque partent. Chez Q, rien ne bouge.
    expect(await magasin.ecrireClients(P, jetonP, {
      lus: [{ clientId: '8001', etiquettes: ['Commun'] }, { clientId: '8003', etiquettes: null }], curseur: '8003',
    })).toBe(true);
    expect(await liens(P)).toEqual([{ client_id: '8001', contact_id: P1 }]);
    expect(await etiquettesDe(P, P1)).toEqual(['Commun']);
    expect(await etiquettesDe(P, P3)).toEqual([]);
    expect(await marquee(P, P3)).toBe(false);
    expect(await liens(Q)).toEqual([{ client_id: '8001', contact_id: Q1 }, { client_id: '8002', contact_id: Q2 }, { client_id: '8003', contact_id: Q3 }]);
    expect(await etiquettesDe(Q, Q3)).toEqual(['Commun', 'Q']);
    expect(await vuLe(Q, '8001')).toEqual(vuQ);
  });

  it('🔴 le jeton d’un espace présenté à un autre ne tient rien : aucune écriture, ni chez l’un ni chez l’autre', async () => {
    const avantQ = await etat(Q);
    expect(await magasin.ecrireClients(P, jetonQ, { lus: [{ clientId: '8001', etiquettes: ['Pirate'] }], curseur: '8001' })).toBe(false);
    expect(await magasin.ecrireRecherche(P, jetonQ, { cherchees: [P2], trouves: [], complete: true })).toBeNull();
    await magasin.relacher(P, jetonQ);
    expect(await magasin.finir(P, jetonQ, 'erreur', 'pirate')).toBe(false);
    expect(await etat(Q)).toEqual(avantQ);
    expect(await etiquettesDe(P, P1)).toEqual(['Commun']);
    expect(await marquee(P, P2)).toBe(false);
  });

  it('🔴 une demande annulée ou un bail pris ne touchent que l’espace nommé', async () => {
    // La demande de Q, libre de tout bail, à une date que P présente : elle reste.
    const le = new Date('2026-11-24T08:00:00.123Z');
    await pool.query(`update shopify_etiquettes_synchro set demandee_le = $2, jeton = null, bail_jusqua = null where tenant_id = $1`, [Q, le]);
    await magasin.annulerDemande(P, le);
    expect(await etat(Q)).toMatchObject({ demandee_le: le, en_cours_depuis: expect.any(Date) });
    // R n'a aucune synchronisation : il ne prend pas celle de Q, libre.
    expect(await magasin.prendre(R)).toBeNull();
    expect(await etat(Q)).toMatchObject({ jeton: null, bail_jusqua: null });
    expect(await etat(R)).toBeUndefined();
  });

  it('🔴 l’état, la garde du critère, la date du suivi, la liste des étiquettes et le lien de customers/redact ne lisent que l’espace', async () => {
    expect(await magasin.finir(P, jetonP, 'lue', null)).toBe(true);
    expect((await pool.query(`select fiches_etiquetees from shopify_etiquettes_synchro where tenant_id = $1`, [P])).rows[0]).toEqual({ fiches_etiquetees: 1 });
    const q = await magasin.prendre(Q);
    expect(await magasin.finir(Q, q!.jeton, 'lue', null)).toBe(true);
    expect(await magasin.etat(R)).toBeNull();
    await expect(contacts.count(R, F(['Commun']))).rejects.toThrow(REFUS_SANS_SYNCHRO);
    expect((await contacts.suiviSegments(R)).boutique?.etiquettesSynchroLe).toBeUndefined();
    expect(await magasin.etiquettes(P, undefined, 50)).toEqual([{ etiquette: 'Commun', fiches: 1 }]);
    expect(await contacts.count(P, F(['Commun']))).toBe(1);
    expect(await shopify.contactsLies(P, [], '8002')).toEqual([]);
    expect(await shopify.contactsLies(P, [], '8001')).toEqual([P1]);
  });

  it('🔴 la relecture quotidienne joint chaque état à SA boutique : un Pro dont la boutique est coupée n’est jamais relancé', async () => {
    await pool.query(`update tenants set offre_business = true where id = any($1::uuid[])`, [[P, Q]]);
    try {
      await pool.query(`update shopify_boutiques set etat = 'coupee' where tenant_id = $1`, [Q]);
      await pool.query(`update shopify_etiquettes_synchro set demandee_le = now() - interval '25 hours' where tenant_id = any($1::uuid[])`, [[P, Q]]);
      const dues = (await magasin.dues(200)).map((d) => d.tenantId);
      expect(dues).toContain(P);
      expect(dues).not.toContain(Q);
    } finally {
      await pool.query(`update tenants set offre_business = false where id = any($1::uuid[])`, [[P, Q]]);
    }
  });

  it('🔴 un client relié dont la fiche est supprimée est oublié à sa lecture : son lien et ses étiquettes partent, il est compté', async () => {
    // P1 porte « Commun » par le client 8001 ; supprimée (suppression douce), sa prochaine lecture l'oublie.
    await pool.query(`update contacts set deleted_at = now() where id = $1`, [P1]);
    const prise = await magasin.prendre(P);
    expect(await magasin.ecrireClients(P, prise!.jeton, { lus: [{ clientId: '8001', etiquettes: ['Commun'] }], curseur: '8001' })).toBe(true);
    expect(await liens(P)).toEqual([]);
    expect(await etiquettesDe(P, P1)).toEqual([]);
    expect(await etat(P)).toMatchObject({ clients_lus: 0, sans_fiche: 1 });
    // Chez Q, le même client garde sa fiche et ses étiquettes.
    expect(await liens(Q)).toContainEqual({ client_id: '8001', contact_id: Q1 });
  });
});

/**
 * LES DEUX ROUGES DE LA RELECTURE DU LOT 6b (2026-11-24), prouvés contre la base :
 * 🔴 une synchronisation PÉRIMÉE au bail NUL (toute panne rend le bail) se relance. Sans `coalesce`, sa vivacité valait
 *    NULL, `not NULL` aussi : ni « maintenant », ni la Free, ni la relecture quotidienne ne la relançaient plus jamais ;
 * 🔴 une commande notée ne relie JAMAIS rien (sa fiche est celle du téléphone de livraison) : seul ce que Shopify rend pour
 *    le client lui-même relie. Depuis le lot 6b bis (décision de Julien du 2026-11-25, « le max de numéros »), ce sont TOUS
 *    ses numéros : une adresse de livraison enregistrée chez le client relie aussi la fiche de ce numéro.
 */
describe.skipIf(!url)('les étiquettes Shopify : la synchronisation périmée et la commande-cadeau (Postgres)', () => {
  let pool: Pool;
  let contacts: PgContactStore;
  let shopify: PgShopifyStore;
  let magasin: PgEtiquettesStore;
  let t = '';
  const DOMAINE = `itest-${randomUUID().slice(0, 8)}.myshopify.com`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    contacts = new PgContactStore(pool);
    shopify = new PgShopifyStore(pool, randomBytes(32).toString('hex'));
    magasin = new PgEtiquettesStore(pool);
    t = (await pool.query<{ id: string }>(`insert into tenants (name, offre_business) values ('itest-etiquettes-relecture', true) returning id`)).rows[0]!.id;
    await pool.query(
      `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre, devise) values ($1, $2, 'cid', 'x', 'EUR')`,
      [t, DOMAINE],
    );
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  /** Une synchronisation commencée il y a une heure, sans progrès depuis, demandée il y a 25 h, avec ce bail. */
  const perimee = async (bail: string): Promise<void> => {
    await pool.query(`delete from shopify_etiquettes_synchro where tenant_id = $1`, [t]);
    await pool.query(
      `insert into shopify_etiquettes_synchro (tenant_id, allumee, demandee_le, en_cours_depuis, maj_le, bail_jusqua)
       values ($1, true, now() - interval '25 hours', now() - interval '1 hour', now() - interval '1 hour', ${bail})`,
      [t],
    );
  };

  it('🔴 périmée au bail NUL : ni vivante ni NULL ; « maintenant », la Free et la relecture quotidienne la relancent', async () => {
    await perimee('null');
    const v = await pool.query<{ vivante: boolean | null }>(
      `select ${synchroVivante('e')} as vivante from shopify_etiquettes_synchro e where e.tenant_id = $1`, [t],
    );
    expect(v.rows[0]!.vivante).toBe(false);
    expect(await magasin.demander(t, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
    // La Free, dont la dernière demande date de 25 h : relancée, jamais un 429 sans fin.
    await perimee('null');
    expect(await magasin.demander(t, { auPlusUneFoisParJour: true })).toBeInstanceOf(Date);
    await perimee('null');
    expect((await magasin.dues(200)).map((d) => d.tenantId)).toContain(t);
    // Témoins : un bail passé se relance aussi ; un bail qui court tient la synchronisation, rien ne repart.
    await perimee(`now() - interval '1 minute'`);
    expect(await magasin.demander(t, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
    await perimee(`now() + interval '1 minute'`);
    expect(await magasin.demander(t, { auPlusUneFoisParJour: false })).toBeNull();
    await pool.query(`delete from shopify_etiquettes_synchro where tenant_id = $1`, [t]);
  });

  /** Lot 6c : une boutique sans aucun segment ; rien d'autre ne doit être lu. */
  const sansSegments = {
    listerSegments: async () => ({ ok: true as const, segments: [], complete: true, cout: { demande: 13, reel: 3 } }),
    lireMembres: async () => { throw new Error('aucun segment suivi'); },
    creerRequete: async () => { throw new Error('aucun segment suivi'); },
    suivreRequete: async () => { throw new Error('aucun segment suivi'); },
  } satisfies Pick<DepsEtiquettes, 'listerSegments' | 'lireMembres' | 'creerRequete' | 'suivreRequete'>;

  it('🔴 commande-cadeau : la commande notée ne relie rien ; seuls les numéros que Shopify rend pour la cliente la relient', async () => {
    const fiche = async (tel: string) =>
      (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [t, tel])).rows[0]!.id;
    const cliente = await fiche('+33611116001');
    const destinataire = await fiche('+33622226001');
    // orders/paid : la commande de la cliente 6001, rattachée à la fiche du téléphone de LIVRAISON (`telephoneDeCommande`).
    await shopify.lierCommande(t, '96001', '6001', destinataire, { payeeLe: new Date(), montant: '50', devise: 'EUR', test: false });
    const recherches: string[][] = [];
    const deps: DepsEtiquettes = {
      magasin,
      boutique: async () => ({ domaine: DOMAINE, clientId: 'cid', secret: 'x', pays: 'FR', etat: 'connectee' }),
      etatBoutique: async () => 'connectee',
      jeton: async () => ({ ok: true, jeton: 'jeton-boutique' }),
      droits: async () => ({ ok: true, droits: ['read_customers'] }),
      // Chez Shopify, la cliente 6001 porte « VIP », et ses numéros sont les SIENS : celui de la livraison n'y est pas.
      chercher: async (_a, p) => {
        recherches.push([...p.telephones]);
        return {
          ok: true, complete: true, cout: { demande: 1, reel: 1 },
          trouves: p.telephones.includes('+33611116001') ? [{ telephone: '+33611116001', clientId: '6001', etiquettes: ['VIP'] }] : [],
        };
      },
      lireClients: async (_a, p) => ({
        ok: true, illisibles: 0, cout: { demande: 1, reel: 1 },
        clients: p.ids.map((id) => ({ clientId: id, etiquettes: id === '6001' ? ['VIP'] : null })),
      }),
      ...sansSegments,
      offre: async () => 'business',
      enfiler: async () => undefined,
    };
    await magasin.regler(t, true);
    expect(await magasin.demander(t, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
    await traiterEtiquettes(deps, { tenantId: t });
    expect(recherches.flat().sort()).toEqual(['+33611116001', '+33622226001']);
    expect((await pool.query(`select client_id, contact_id from shopify_clients where tenant_id = $1`, [t])).rows)
      .toEqual([{ client_id: '6001', contact_id: cliente }]);
    const vip = await contacts.query(t, { fieldFilters: [filtreSegment(S.etiquetteShopify, { etiquettes: ['VIP'], mode: 'toutes' })] }, 50, 0);
    expect(vip.map((c) => c.id)).toEqual([cliente]);
  });

  it('🔴 le max de numéros : la cliente qui garde l’adresse du destinataire chez Shopify relie aussi sa fiche, au geste suivant', async () => {
    const destinataire = (await pool.query<{ id: string }>(`select id from contacts where tenant_id = $1 and phone_e164 = '+33622226001'`, [t])).rows[0]!.id;
    const cliente = (await pool.query<{ id: string }>(`select id from contacts where tenant_id = $1 and phone_e164 = '+33611116001'`, [t])).rows[0]!.id;
    const deps: DepsEtiquettes = {
      magasin,
      boutique: async () => ({ domaine: DOMAINE, clientId: 'cid', secret: 'x', pays: 'FR', etat: 'connectee' }),
      etatBoutique: async () => 'connectee',
      jeton: async () => ({ ok: true, jeton: 'jeton-boutique' }),
      droits: async () => ({ ok: true, droits: ['read_customers'] }),
      // Chez Shopify, la cliente 6001 a maintenant l'adresse du destinataire dans son carnet : ses deux numéros la trouvent.
      chercher: async (_a, p) => ({
        ok: true, complete: true, cout: { demande: 1, reel: 1 },
        trouves: p.telephones.filter((x) => x === '+33611116001' || x === '+33622226001').map((telephone) => ({ telephone, clientId: '6001', etiquettes: ['VIP'] })),
      }),
      lireClients: async (_a, p) => ({ ok: true, illisibles: 0, cout: { demande: 1, reel: 1 }, clients: p.ids.map((id) => ({ clientId: id, etiquettes: ['VIP'] })) }),
      ...sansSegments,
      offre: async () => 'business',
      enfiler: async () => undefined,
    };
    // Le geste du marchand : les deux fiches, déjà cherchées, le sont de nouveau.
    await pool.query(`update shopify_etiquettes_synchro set en_cours_depuis = null, bail_jusqua = null, jeton = null where tenant_id = $1`, [t]);
    expect(await magasin.demander(t, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
    expect(await magasin.aChercher(t, 25, null)).toHaveLength(2);
    await traiterEtiquettes(deps, { tenantId: t });
    expect((await pool.query(`select contact_id from shopify_clients where tenant_id = $1 and client_id = '6001' order by contact_id`, [t])).rows.map((r) => r.contact_id))
      .toEqual([cliente, destinataire].sort());
    const vip = await contacts.query(t, { fieldFilters: [filtreSegment(S.etiquetteShopify, { etiquettes: ['VIP'], mode: 'toutes' })] }, 50, 0);
    expect(vip.map((c) => c.id).sort()).toEqual([cliente, destinataire].sort());
  });
});

/**
 * 🔴 LE LOT 6b bis CONTRE LA BASE (décision de Julien du 2026-11-25, « le max de numéros ») : des liens plusieurs à plusieurs,
 * les étiquettes par couple fiche-client (la lecture d'un client ne touche pas celles d'un autre client de la même fiche), un
 * lien défait qui emporte ses étiquettes (la cascade de la 0326), une recherche COMPLÈTE qui remplace les liens d'une fiche
 * et une incomplète qui n'en défait aucun, le geste du marchand qui efface les marques (et lui seul : ni une demande
 * refusée, ni la relecture quotidienne), l'onglet de la fiche sans doublon, `customers/redact` qui retrouve toutes les
 * fiches du client.
 */
describe.skipIf(!url)('les étiquettes Shopify : plusieurs clients par fiche, plusieurs fiches par client (Postgres)', () => {
  let pool: Pool;
  let magasin: PgEtiquettesStore;
  let shopify: PgShopifyStore;
  let t = '';
  let A = '';
  let B = '';
  let C = '';

  const etiquettesDe = async (fiche: string): Promise<string[]> =>
    (await pool.query<{ etiquette: string }>(`select etiquette from shopify_etiquettes where tenant_id = $1 and contact_id = $2 order by etiquette, client_id`, [t, fiche])).rows.map((r) => r.etiquette);
  const liens = async (): Promise<string[]> => (await pool.query<{ l: string }>(
    `select client_id || ' ' || contact_id as l from shopify_clients where tenant_id = $1 order by 1`, [t])).rows.map((r) => r.l);
  const lien = (client: string, fiche: string): string => `${client} ${fiche}`;
  const marques = async (): Promise<number> => Number((await pool.query<{ n: string }>(`select count(*) as n from shopify_fiches_cherchees where tenant_id = $1`, [t])).rows[0]!.n);
  const tenir = async (): Promise<string> => {
    await pool.query(`update shopify_etiquettes_synchro set en_cours_depuis = null, bail_jusqua = null, jeton = null where tenant_id = $1`, [t]);
    expect(await magasin.demander(t, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
    return (await magasin.prendre(t))!.jeton;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    magasin = new PgEtiquettesStore(pool);
    shopify = new PgShopifyStore(pool, randomBytes(32).toString('hex'));
    t = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-etiquettes-numeros') returning id`)).rows[0]!.id;
    await pool.query(
      `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre, devise) values ($1, $2, 'cid', 'x', 'EUR')`,
      [t, `itest-${randomUUID().slice(0, 8)}.myshopify.com`],
    );
    const fiche = async (tel: string) => (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [t, tel])).rows[0]!.id;
    A = await fiche('+33600659001');
    B = await fiche('+33600659002');
    C = await fiche('+33600659003');
    await magasin.regler(t, true);
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  it('🔴 deux clients d’un numéro relient la fiche, un client de deux numéros relie les deux fiches ; chaque couple porte ses étiquettes', async () => {
    const jeton = await tenir();
    expect(await magasin.ecrireRecherche(t, jeton, {
      cherchees: [A, B],
      trouves: [
        { contactId: A, clientId: '7101', etiquettes: ['VIP'] },
        { contactId: A, clientId: '7102', etiquettes: ['VIP MM', 'VIP'] },
        { contactId: B, clientId: '7102', etiquettes: ['VIP MM', 'VIP'] },
      ],
      complete: true,
    })).toEqual({ relies: 2 });
    expect(await liens()).toEqual([lien('7101', A), lien('7102', A), lien('7102', B)].sort());
    expect(await etiquettesDe(A)).toEqual(['VIP', 'VIP', 'VIP MM']);
    expect(await etiquettesDe(B)).toEqual(['VIP', 'VIP MM']);
    expect(await magasin.clientsALire(t, null, 250)).toEqual(['7101', '7102']);
    expect(await magasin.etiquettes(t, undefined, 50)).toEqual([{ etiquette: 'VIP', fiches: 2 }, { etiquette: 'VIP MM', fiches: 2 }]);
    // Lu par son identifiant, 7101 remplace SES étiquettes sur A ; celles de 7102 restent (« VIP » donnée par les deux).
    expect(await magasin.ecrireClients(t, jeton, { lus: [{ clientId: '7101', etiquettes: ['Grossiste', 'VIP'] }], curseur: '7101' })).toBe(true);
    expect(await etiquettesDe(A)).toEqual(['Grossiste', 'VIP', 'VIP', 'VIP MM']);
    expect(await magasin.finir(t, jeton, 'lue', null)).toBe(true);
    expect((await pool.query(`select fiches_etiquetees from shopify_etiquettes_synchro where tenant_id = $1`, [t])).rows[0]).toEqual({ fiches_etiquetees: 2 });
    // L'onglet de la fiche : chaque étiquette une fois, quel que soit le nombre de clients qui la donnent.
    expect((await new PgVentesStore(pool).achatsDuContact(t, A))?.etiquettesShopify?.etiquettes).toEqual(['Grossiste', 'VIP', 'VIP MM']);
    // 🔴 customers/redact de 7102 : jamais une purge par ses liens ; ses liens partent, partout, et ses étiquettes avec eux.
    expect(await shopify.contactsLies(t, [], '7102')).toEqual([]);
    // Le même identifiant de client dans un autre espace : son lien reste.
    const autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-etiquettes-oubli-autre') returning id`)).rows[0]!.id;
    const Y = (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, '+33600659008') returning id`, [autre])).rows[0]!.id;
    await pool.query(`insert into shopify_clients (tenant_id, client_id, contact_id) values ($1, '7102', $2)`, [autre, Y]);
    expect(await shopify.oublierClientShopify(t, '7102')).toBe(2);
    expect((await pool.query(`select 1 from shopify_clients where tenant_id = $1 and client_id = '7102'`, [autre])).rowCount).toBe(1);
    await pool.query('delete from tenants where id = $1', [autre]);
    expect(await liens()).toEqual([lien('7101', A)]);
    expect(await etiquettesDe(A)).toEqual(['Grossiste', 'VIP']);
    expect(await etiquettesDe(B)).toEqual([]);
    expect((await pool.query(`select count(*)::int as n from contacts where id = any($1::uuid[]) and deleted_at is null`, [[A, B]])).rows[0]).toEqual({ n: 2 });
    // Remis pour la suite du bloc.
    const jeton2 = await tenir();
    await magasin.ecrireRecherche(t, jeton2, {
      cherchees: [A, B], trouves: [{ contactId: A, clientId: '7102', etiquettes: ['VIP MM', 'VIP'] }, { contactId: B, clientId: '7102', etiquettes: ['VIP MM', 'VIP'] },
        { contactId: A, clientId: '7101', etiquettes: ['Grossiste', 'VIP'] }],
      complete: true,
    });
    await magasin.finir(t, jeton2, 'lue', null);
  });

  it('🔴 un lien défait emporte ses étiquettes ; un client disparu défait TOUS ses liens et rend ses fiches à chercher', async () => {
    const jeton = await tenir();
    await pool.query(`delete from shopify_clients where tenant_id = $1 and client_id = '7101' and contact_id = $2`, [t, A]);
    expect(await etiquettesDe(A)).toEqual(['VIP', 'VIP MM']);
    await pool.query(`insert into shopify_fiches_cherchees (tenant_id, contact_id) values ($1, $2), ($1, $3) on conflict do nothing`, [t, A, B]);
    expect(await magasin.ecrireClients(t, jeton, { lus: [{ clientId: '7102', etiquettes: null }], curseur: '7102' })).toBe(true);
    expect(await liens()).toEqual([]);
    expect(await etiquettesDe(A)).toEqual([]);
    expect(await etiquettesDe(B)).toEqual([]);
    expect(await marques()).toBe(0);
    await magasin.finir(t, jeton, 'lue', null);
  });

  it('🔴 une recherche COMPLÈTE remplace les liens de la fiche cherchée (celles des autres fiches restent) ; incomplète, elle n’en défait aucun', async () => {
    let jeton = await tenir();
    await magasin.ecrireRecherche(t, jeton, {
      cherchees: [A, C],
      trouves: [{ contactId: A, clientId: '7201', etiquettes: ['Ancien'] }, { contactId: C, clientId: '7202', etiquettes: ['Autre'] }],
      complete: true,
    });
    await magasin.finir(t, jeton, 'lue', null);
    // Le geste suivant : chez Shopify, 7201 n'a plus le numéro de A, 7203 l'a.
    jeton = await tenir();
    expect(await magasin.ecrireRecherche(t, jeton, {
      cherchees: [A], trouves: [{ contactId: A, clientId: '7203', etiquettes: ['Nouveau'] }], complete: true,
    })).toEqual({ relies: 1 });
    expect(await liens()).toEqual([lien('7202', C), lien('7203', A)].sort());
    expect(await etiquettesDe(A)).toEqual(['Nouveau']);
    expect(await etiquettesDe(C)).toEqual(['Autre']);
    // Une page incomplète : 7203 n'est pas rendu, il reste relié.
    expect(await magasin.ecrireRecherche(t, jeton, { cherchees: [A], trouves: [], complete: false })).toEqual({ relies: 0 });
    expect(await liens()).toEqual([lien('7202', C), lien('7203', A)].sort());
    await magasin.finir(t, jeton, 'lue', null);
  });

  it('🔴 le geste du marchand efface les marques, et lui seul : ni une demande refusée, ni la relecture quotidienne', async () => {
    await pool.query(`insert into shopify_fiches_cherchees (tenant_id, contact_id) values ($1, $2), ($1, $3), ($1, $4) on conflict do nothing`, [t, A, B, C]);
    expect(await magasin.aChercher(t, 25, null)).toEqual([]);
    // Une synchronisation vit : la demande est refusée, les marques restent.
    await pool.query(`update shopify_etiquettes_synchro set en_cours_depuis = now(), maj_le = now() where tenant_id = $1`, [t]);
    expect(await magasin.demander(t, { auPlusUneFoisParJour: false })).toBeNull();
    expect(await marques()).toBe(3);
    // La relecture quotidienne recommence sans effacer les marques.
    await pool.query(`update tenants set offre_business = true where id = $1`, [t]);
    try {
      await pool.query(`update shopify_etiquettes_synchro set en_cours_depuis = null, maj_le = null, demandee_le = now() - interval '25 hours' where tenant_id = $1`, [t]);
      expect((await magasin.dues(200)).map((d) => d.tenantId)).toContain(t);
      expect(await marques()).toBe(3);
    } finally {
      await pool.query(`update tenants set offre_business = false where id = $1`, [t]);
    }
    // Le geste accepté : toutes les fiches qui ont un numéro sont à chercher, reliées ou non. 🔴 Celles de l'espace
    // seulement : la marque d'une fiche d'un autre espace reste.
    const autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-etiquettes-numeros-autre') returning id`)).rows[0]!.id;
    try {
      const Z = (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, '+33600659009') returning id`, [autre])).rows[0]!.id;
      await pool.query(`insert into shopify_fiches_cherchees (tenant_id, contact_id) values ($1, $2)`, [autre, Z]);
      await pool.query(`update shopify_etiquettes_synchro set en_cours_depuis = null, maj_le = null, bail_jusqua = null, jeton = null where tenant_id = $1`, [t]);
      expect(await magasin.demander(t, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
      expect(await marques()).toBe(0);
      expect((await magasin.aChercher(t, 25, null)).map((x) => x.contactId).sort()).toEqual([A, B, C].sort());
      expect((await pool.query(`select 1 from shopify_fiches_cherchees where tenant_id = $1 and contact_id = $2`, [autre, Z])).rowCount).toBe(1);
    } finally {
      await pool.query('delete from tenants where id = $1', [autre]);
    }
  });

  it('🔴 la cascade : une fiche supprimée pour de bon emporte ses liens et leurs étiquettes, jamais ceux d’une autre fiche', async () => {
    const jeton = (await magasin.prendre(t))!.jeton;
    await magasin.ecrireRecherche(t, jeton, {
      cherchees: [B, C],
      trouves: [{ contactId: B, clientId: '7301', etiquettes: ['Cascade'] }, { contactId: C, clientId: '7301', etiquettes: ['Cascade'] }],
      complete: true,
    });
    await pool.query(`delete from contacts where id = $1`, [B]);
    expect(await liens()).toEqual([lien('7203', A), lien('7301', C)].sort());
    expect(await etiquettesDe(C)).toEqual(['Cascade']);
    expect((await pool.query(`select 1 from shopify_etiquettes where tenant_id = $1 and contact_id = $2`, [t, B])).rowCount).toBe(0);
  });
});
