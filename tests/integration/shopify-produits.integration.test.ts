import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgContactStore, buildContactWhere, type ContactFilters } from '../../src/crm/contact-store.pg';
import { PgShopifyStore, type DetailsCommande } from '../../src/shopify/store.pg';
import { PgVentesStore } from '../../src/shopify/ventes.pg';
import type { LigneDeCommande } from '../../src/shopify/donnees';
import { CLES_SEGMENT as S, filtreSegment as seg } from '../../web/lib/partage/segments';
import { ligneVisee } from '../../src/crm/segments';

const url = process.env.DATABASE_URL ?? '';

/**
 * LES PRODUITS ACHETÉS contre un VRAI Postgres (segments Shopify enrichis, lot 3, migration 0311). Ce qu'aucun faux ne
 * prouve : les lignes écrites avec leur commande et réécrites au rejeu, les critères « tous », « aucun » et « réassort »
 * sur de vraies lignes, la carte cadeau jamais visée, 🔴 aucune ligne d'un autre espace (même numéro de commande), la
 * recherche des produits vus, l'onglet de la fiche, la cascade de la purge et de l'effacement du branchement, et 🔴 les
 * deux index partiels SERVIS par la requête qu'ils visent (un prédicat qui s'en écarte ne produit qu'un balayage).
 *
 * ⚠️ Jamais joué en local contre `DATABASE_URL` (l'ancienne production) : joué par le job `integration`.
 */
describe.skipIf(!url)('les produits achetés (Postgres)', () => {
  let pool: Pool;
  let contacts: PgContactStore;
  let shopify: PgShopifyStore;
  let ventes: PgVentesStore;
  let ici = '';
  let ailleurs = '';
  let A = '';
  let B = '';
  let C = '';
  let X = '';

  const ligne = (ligneId: string, o: Partial<LigneDeCommande> = {}): LigneDeCommande => ({
    ligneId, produitId: '8801', varianteId: '4601', sku: 'SER-30', titre: 'Sérum vitamine C', varianteTitre: '30 ml', quantite: 1,
    carteCadeau: false, ...o,
  });
  const CREME = { produitId: '8802', varianteId: '4701', sku: 'CRE-50', titre: 'Crème de nuit', varianteTitre: '50 ml' };
  const CADEAU = { produitId: '9900', varianteId: '9901', sku: 'GIFT-50', titre: 'Carte cadeau', varianteTitre: '50 €', carteCadeau: true };
  const details = (ilYA: number, lignes: LigneDeCommande[], tronquees = false): DetailsCommande => ({
    payeeLe: new Date(Date.now() - ilYA * 86_400_000), montant: '30', devise: 'EUR', test: false, lignes: { lignes, tronquees },
  });

  const F = (...f: ReturnType<typeof seg>[]): ContactFilters => ({ fieldFilters: f });
  /** Les fiches que la liste rend, et le compte qui doit leur correspondre. */
  const qui = async (f: ContactFilters, t = ici): Promise<string[]> => {
    const lignes = await contacts.query(t, f, 500, 0);
    expect(await contacts.count(t, f)).toBe(lignes.length);
    return lignes.map((c) => c.id).sort();
  };
  const tries = (...ids: string[]): string[] => [...ids].sort();

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    contacts = new PgContactStore(pool);
    shopify = new PgShopifyStore(pool, randomBytes(32).toString('hex'));
    ventes = new PgVentesStore(pool);
    const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    ici = await espace('itest-produits');
    ailleurs = await espace('itest-produits-autre');
    const fiche = async (t: string, tel: string) => (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [t, tel])).rows[0]!.id;
    A = await fiche(ici, '+33600400001');
    B = await fiche(ici, '+33600400002');
    C = await fiche(ici, '+33600400003');
    X = await fiche(ailleurs, '+33600400001');
    for (const t of [ici, ailleurs]) {
      await pool.query(
        `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre, devise) values ($1, $2, 'cid', 'x', 'EUR')`,
        [t, `itest-${randomUUID().slice(0, 8)}.myshopify.com`],
      );
    }
    // A : sérum (SER-30) et une carte cadeau il y a 10 jours ; crème il y a 100 jours.
    await shopify.lierCommande(ici, '5001', null, A, details(10, [ligne('11'), ligne('12', CADEAU)]));
    await shopify.lierCommande(ici, '5002', null, A, details(100, [ligne('21', CREME)]));
    // A avait déjà acheté ce sérum il y a 300 jours : le réassort lit son DERNIER achat (10 jours), jamais le premier.
    await shopify.lierCommande(ici, '5006', null, A, details(300, [ligne('61')]));
    // B : crème il y a 5 jours ; le même sérum, une autre variante (SER-60), il y a 200 jours.
    await shopify.lierCommande(ici, '5003', null, B, details(5, [ligne('31', CREME)]));
    await shopify.lierCommande(ici, '5004', null, B, details(200, [ligne('41', { varianteId: '4602', sku: 'SER-60', varianteTitre: '60 ml' })]));
    // C : seulement une carte cadeau, il y a 3 jours.
    await shopify.lierCommande(ici, '5005', null, C, details(3, [ligne('51', CADEAU)]));
    // Un autre espace : le MÊME numéro de commande, le même sérum, il y a 2 jours.
    await shopify.lierCommande(ailleurs, '5001', null, X, details(2, [ligne('11')]));
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[ici, ailleurs]]);
    await pool.end();
  });

  it('🔴 « a acheté » : par produit (toutes ses variantes) ou par SKU ; TOUS les produits ; la fenêtre en jours', async () => {
    expect(await qui(F(seg(S.achete, { produits: [{ produit: '8801' }] })))).toEqual(tries(A, B));
    expect(await qui(F(seg(S.achete, { produits: [{ sku: 'SER-30' }] })))).toEqual([A]);
    expect(await qui(F(seg(S.achete, { produits: [{ produit: '8801' }, { produit: '8802' }] })))).toEqual(tries(A, B));
    // Sur 30 jours, personne n'a acheté les deux : A a pris la crème il y a 100 jours, B le sérum il y a 200.
    expect(await qui(F(seg(S.achete, { produits: [{ produit: '8801' }, { produit: '8802' }], jours: 30 })))).toEqual([]);
    expect(await qui(F(seg(S.achete, { produits: [{ produit: '8801' }], jours: 30 })))).toEqual([A]);
  });

  it('🔴 « n’a pas acheté » : AUCUN des produits, avec « a acheté »', async () => {
    expect(await qui(F(seg(S.achete, { produits: [{ produit: '8802' }] }), seg(S.pasAchete, { produits: [{ sku: 'SER-60' }] })))).toEqual([A]);
    expect(await qui(F(seg(S.achete, { produits: [{ produit: '8802' }] }), seg(S.pasAchete, { produits: [{ sku: 'SER-60' }, { sku: 'SER-30' }] })))).toEqual([]);
  });

  it('🔴 une carte cadeau n’est jamais visée, même par son identifiant ou son SKU ; sa commande compte toujours', async () => {
    expect(await qui(F(seg(S.achete, { produits: [{ produit: '9900' }] })))).toEqual([]);
    expect(await qui(F(seg(S.achete, { produits: [{ sku: 'GIFT-50' }] })))).toEqual([]);
    expect(await qui(F(seg(S.commandes, { min: 1, jours: 7 })))).toEqual(tries(B, C));
  });

  it('le réassort : le DERNIER achat de ce produit dans la plage, un achat connu exigé', async () => {
    // B a acheté le produit 8801 sous sa variante SER-60 il y a 200 jours ; A, sous SER-30, il y a 10 jours ET 300 jours :
    // son premier achat a beau être ancien, son dernier est récent, il n'est pas « à réassortir ».
    expect(await qui(F(seg(S.reassort, { produit: '8801', min: 30 })))).toEqual([B]);
    expect(await qui(F(seg(S.reassort, { sku: 'SER-60', min: 30 })))).toEqual([B]);
    expect(await qui(F(seg(S.reassort, { sku: 'SER-30', max: 30 })))).toEqual([A]);
    // La crème : A il y a 100 jours (dans la plage), B il y a 5 jours (hors plage) ; C n'en a jamais acheté.
    expect(await qui(F(seg(S.reassort, { produit: '8802', min: 50, max: 150 })))).toEqual([A]);
    expect(await qui(F(seg(S.reassort, { produit: '8802', max: 7 })))).toEqual([B]);
  });

  it('🔴 aucune ligne d’un autre espace ne compte, même au même numéro de commande', async () => {
    expect(await qui(F(seg(S.achete, { produits: [{ sku: 'SER-30' }], jours: 7 })))).toEqual([]);
    expect(await qui(F(seg(S.achete, { produits: [{ sku: 'SER-30' }] })), ailleurs)).toEqual([X]);
  });

  it('les produits vus : par produit et SKU, les plus achetés d’abord, hors cartes cadeaux, cherchables, dans l’espace', async () => {
    expect(await contacts.produitsVus(ici, undefined, 20)).toEqual([
      { produitId: '8802', sku: 'CRE-50', titre: 'Crème de nuit', varianteTitre: '50 ml', commandes: 2 },
      { produitId: '8801', sku: 'SER-30', titre: 'Sérum vitamine C', varianteTitre: '30 ml', commandes: 2 },
      { produitId: '8801', sku: 'SER-60', titre: 'Sérum vitamine C', varianteTitre: '60 ml', commandes: 1 },
    ]);
    expect((await contacts.produitsVus(ici, 'sérum', 20)).map((p) => p.sku)).toEqual(['SER-30', 'SER-60']);
    expect((await contacts.produitsVus(ici, 'cre-', 20)).map((p) => p.sku)).toEqual(['CRE-50']);
    // `%` et `_` se cherchent à la lettre : aucun titre n'en porte.
    expect(await contacts.produitsVus(ici, '%', 20)).toEqual([]);
    expect((await contacts.produitsVus(ailleurs, undefined, 20)).map((p) => [p.sku, p.commandes])).toEqual([['SER-30', 1]]);
  });

  it('l’onglet de la fiche : les lignes de chaque commande, dans l’ordre, la carte cadeau marquée, jamais celles d’un autre espace', async () => {
    const a = await ventes.achatsDuContact(ici, A);
    expect(a?.commandes.find((c) => c.commandeId === '5001')).toMatchObject({
      lignesTronquees: false,
      lignes: [
        { titre: 'Sérum vitamine C', varianteTitre: '30 ml', sku: 'SER-30', quantite: 1, carteCadeau: false },
        { titre: 'Carte cadeau', varianteTitre: '50 €', sku: 'GIFT-50', quantite: 1, carteCadeau: true },
      ],
    });
    const x = await ventes.achatsDuContact(ailleurs, X);
    expect(x?.commandes.find((c) => c.commandeId === '5001')?.lignes).toHaveLength(1);
  });

  it('un rejeu réécrit les lignes sans doublon ; un corps tronqué lève le drapeau de sa commande', async () => {
    await shopify.lierCommande(ici, '5001', null, A, details(10, [ligne('11', { quantite: 3 }), ligne('12', CADEAU)], true));
    const lignes = await pool.query<{ ligne_id: string; quantite: number }>(
      `select ligne_id, quantite from shopify_commande_lignes where tenant_id = $1 and commande_id = '5001' order by ligne_id`, [ici],
    );
    expect(lignes.rows).toEqual([{ ligne_id: '11', quantite: 3 }, { ligne_id: '12', quantite: 1 }]);
    expect((await ventes.achatsDuContact(ici, A))?.commandes.find((c) => c.commandeId === '5001')?.lignesTronquees).toBe(true);
  });

  it('🔴 les deux index partiels SERVENT le fragment exact que les requêtes de segment posent (`ligneVisee`)', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      // Sur des tables minuscules, le planificateur préfère un balayage : on le lui retire, pour voir ce qu'il PEUT servir.
      await client.query('set local enable_seqscan = off');
      for (const [produit, valeur, index] of [
        [{ produit: '8801' }, '8801', 'shopify_commande_lignes_produit'],
        [{ sku: 'SER-30' }, 'SER-30', 'shopify_commande_lignes_sku'],
      ] as const) {
        const fragment = ligneVisee(produit, () => '$2');
        const plan = (await client.query<{ 'QUERY PLAN': string }>(
          `explain select l.ligne_id from shopify_commande_lignes l where l.tenant_id = $1 and ${fragment}`, [ici, valeur],
        )).rows.map((r) => r['QUERY PLAN']).join('\n');
        expect(plan, index).toContain(index);
      }
      // Et la requête entière s'exécute telle que `buildContactWhere` la pose.
      const { where, params } = buildContactWhere(ici, { fieldFilters: [seg(S.achete, { produits: [{ produit: '8801' }] })] });
      expect((await client.query(`select id from contacts where ${where}`, params)).rowCount).toBe(2);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('🔴 les lignes partent avec leur commande (la purge d’une fiche) et avec le branchement, jamais celles d’un autre espace', async () => {
    const restantes = async (t: string) => Number((await pool.query<{ n: string }>(`select count(*) as n from shopify_commande_lignes where tenant_id = $1`, [t])).rows[0]!.n);
    await pool.query(`delete from shopify_commandes where tenant_id = $1 and commande_id = '5003'`, [ici]);
    expect((await pool.query(`select 1 from shopify_commande_lignes where tenant_id = $1 and commande_id = '5003'`, [ici])).rowCount).toBe(0);
    await shopify.effacerBoutique(ici);
    expect(await restantes(ici)).toBe(0);
    expect(await restantes(ailleurs)).toBe(1);
  });
});
