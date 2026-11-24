import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgReprisesStore, ERREUR_ABANDON } from '../../src/shopify/reprises.pg';
import { PgShopifyStore } from '../../src/shopify/store.pg';
import { PgContactStore } from '../../src/crm/contact-store.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LES REPRISES DE L'HISTORIQUE SHOPIFY (migration 0313, segments Shopify enrichis, lot 5) contre un VRAI Postgres. Ce
 * qu'aucun faux ne prouve : l'index unique partiel qui refuse une seconde reprise vivante, la reprise abandonnée close
 * au lancement suivant, le bail et le jeton (un porteur périmé n'écrit plus rien), la fin qui ajoute les comptes de sa
 * dernière page, l'annulation d'une reprise jamais prise, et 🔴 jamais une reprise d'un autre espace. Le suivi des
 * segments dit le dernier rattrapage TERMINÉ après le début du suivi courant. Et les deux lectures groupées du
 * rattachement : les commandes déjà notées (à compléter ou non), les fiches actives des numéros.
 *
 * ⚠️ Jamais joué en local contre `DATABASE_URL` (l'ancienne production) : joué par le job `integration`.
 */
describe.skipIf(!url)('les reprises de l’historique Shopify (Postgres)', () => {
  let pool: Pool;
  let store: PgReprisesStore;
  let contacts: PgContactStore;
  let shopify: PgShopifyStore;
  let ici = '';
  let ailleurs = '';
  const DOMAINE = `itest-reprises-${randomBytes(4).toString('hex')}.myshopify.com`;
  const FENETRE = new Date('2026-09-24T00:00:00Z');
  const zero = { lues: 0, rattachees: 0, deja: 0, sansFiche: 0, sansNumero: 0, fichesCreees: 0, horsPlafond: 0 };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    store = new PgReprisesStore(pool);
    contacts = new PgContactStore(pool);
    shopify = new PgShopifyStore(pool, randomBytes(32).toString('hex'));
    const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    ici = await espace('itest-reprises');
    ailleurs = await espace('itest-reprises-autre');
    // Une boutique branchée ici : le suivi des segments n'existe qu'avec elle.
    await shopify.connecter(ici, {
      domaine: DOMAINE, clientId: 'cid', secretClair: 'shpss_itest', nom: null, pays: 'FR', devise: 'EUR', par: null, origine: 'claude_code',
    });
  });

  afterAll(async () => {
    for (const t of [ici, ailleurs]) {
      if (!t) continue;
      await pool.query('delete from shopify_commandes where tenant_id = $1', [t]);
      await pool.query('delete from shopify_boutiques where tenant_id = $1', [t]);
      await pool.query('delete from contacts where tenant_id = $1', [t]);
      await pool.query('delete from tenants where id = $1', [t]);
    }
    await pool.end();
  });

  const vieillir = async (id: string, minutes: number) =>
    pool.query(`update shopify_reprises set maj_le = now() - make_interval(mins => $2), bail_jusqua = null where id = $1`, [id, minutes]);

  it('🔴 une seule reprise vivante par espace : la seconde est refusée et rend la vivante ; l’autre espace n’y est pour rien', async () => {
    const a = await store.lancer(ici, FENETRE, DOMAINE, 'u1');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.reprise).toMatchObject({ statut: 'en_attente', domaine: DOMAINE, fenetreDebut: FENETRE, curseur: null, comptes: zero, par: 'u1', tenue: false, finiLe: null });
    const b = await store.lancer(ici, FENETRE, DOMAINE, 'u2');
    expect(b).toMatchObject({ ok: false, vivante: { id: a.reprise.id } });
    const c = await store.lancer(ailleurs, FENETRE, 'autre.myshopify.com', null);
    expect(c.ok).toBe(true);
    // Les lectures nomment l'espace : celle d'ici n'existe pas ailleurs.
    expect(await store.lire(a.reprise.id, ailleurs)).toBeNull();
    expect(await store.prendre(a.reprise.id, ailleurs)).toBeNull();
    expect((await store.derniere(ailleurs))?.id).not.toBe(a.reprise.id);
  });

  it('🔴 bail et jeton : prendre une fois, avancer, un porteur au jeton périmé n’écrit plus rien, finir avec la dernière page', async () => {
    const r = (await store.derniere(ici))!;
    const p = await store.prendre(r.id, ici);
    expect(p).not.toBeNull();
    expect(p!.reprise).toMatchObject({ statut: 'en_cours', tenue: true });
    // Tenue : un second passage ne la prend pas.
    expect(await store.prendre(r.id, ici)).toBeNull();
    expect(await store.avancer(r.id, ici, p!.jeton, 'c1', { ...zero, lues: 3, rattachees: 1, deja: 1, sansFiche: 1, fichesCreees: 1 })).toBe(true);
    expect(await store.avancer(r.id, ici, p!.jeton, 'c2', { ...zero, lues: 2, rattachees: 2, horsPlafond: 3 })).toBe(true);
    expect(await store.lire(r.id, ici)).toMatchObject({
      curseur: 'c2', comptes: { lues: 5, rattachees: 3, deja: 1, sansFiche: 1, sansNumero: 0, fichesCreees: 1, horsPlafond: 3 },
    });
    // Le bail libéré, un autre passage la reprend : l'ancien jeton ne vaut plus rien.
    await store.relacher(r.id, ici, p!.jeton);
    expect((await store.lire(r.id, ici))!.tenue).toBe(false);
    const q = (await store.prendre(r.id, ici))!;
    expect(q.reprise.curseur).toBe('c2');
    expect(await store.avancer(r.id, ici, p!.jeton, 'perime', zero)).toBe(false);
    expect(await store.finir(r.id, ici, p!.jeton, 'termine', null)).toBe(false);
    expect(await store.avancer(r.id, ailleurs, q.jeton, 'autre-espace', zero)).toBe(false);
    // La fin ajoute les comptes de la dernière page dans la même écriture.
    expect(await store.finir(r.id, ici, q.jeton, 'termine', null, { ...zero, lues: 1, rattachees: 1, fichesCreees: 1, horsPlafond: 1 })).toBe(true);
    const fin = (await store.lire(r.id, ici))!;
    expect(fin).toMatchObject({ statut: 'termine', curseur: 'c2', tenue: false, erreur: null, comptes: { lues: 6, rattachees: 4, fichesCreees: 2, horsPlafond: 4 } });
    expect(fin.finiLe).not.toBeNull();
    // Finie, elle ne se reprend plus.
    expect(await store.prendre(r.id, ici)).toBeNull();
    // 🔴 Le suivi des segments la dit : la fenêtre relue et sa fin ; l'autre espace, sans boutique, rien.
    expect((await contacts.suiviSegments(ici)).boutique?.rattrapage).toEqual({ depuis: FENETRE, le: fin.finiLe });
    expect(await contacts.suiviSegments(ailleurs)).toEqual({ boutique: null });
  });

  it('🔴 une reprise vivante ABANDONNÉE (15 minutes, bail mort) est close en erreur au lancement suivant ; une tenue ou récente, jamais', async () => {
    const a = await store.lancer(ici, FENETRE, DOMAINE, null);
    if (!a.ok) throw new Error('lancement refusé');
    // Récente : refusée.
    expect((await store.lancer(ici, FENETRE, DOMAINE, null)).ok).toBe(false);
    // Vieille mais tenue : refusée.
    await vieillir(a.reprise.id, 20);
    await pool.query(`update shopify_reprises set bail_jusqua = now() + interval '1 minute' where id = $1`, [a.reprise.id]);
    expect((await store.lancer(ici, FENETRE, DOMAINE, null)).ok).toBe(false);
    // Vieille et sans bail : close, et la suivante part.
    await vieillir(a.reprise.id, 20);
    const b = await store.lancer(ici, FENETRE, DOMAINE, null);
    expect(b.ok).toBe(true);
    expect(await store.lire(a.reprise.id, ici)).toMatchObject({ statut: 'erreur', erreur: ERREUR_ABANDON });
    expect((await store.derniere(ici))?.id).toBe(b.ok ? b.reprise.id : '');
    // Le suivi dit toujours la dernière TERMINÉE, jamais celle close en erreur.
    const termine = (await pool.query<{ fini_le: Date }>(`select fini_le from shopify_reprises where tenant_id = $1 and statut = 'termine'`, [ici])).rows[0]!;
    expect((await contacts.suiviSegments(ici)).boutique?.rattrapage).toEqual({ depuis: FENETRE, le: termine.fini_le });
  });

  it('🔴 une reprise jamais prise s’annule (son job n’a pas pu partir) ; une reprise prise, jamais', async () => {
    const vivante = (await store.derniere(ici))!;
    expect(vivante.statut).toBe('en_attente');
    await store.annuler(vivante.id, ici, 'le rattrapage n’a pas pu démarrer : relancez-le');
    expect(await store.lire(vivante.id, ici)).toMatchObject({ statut: 'erreur', erreur: 'le rattrapage n’a pas pu démarrer : relancez-le' });
    expect((await store.lancer(ici, FENETRE, DOMAINE, null)).ok).toBe(true);
    const prise = (await store.derniere(ici))!;
    const p = (await store.prendre(prise.id, ici))!;
    await store.annuler(prise.id, ici, 'jamais');
    expect((await store.lire(prise.id, ici))!.statut).toBe('en_cours');
    await store.annuler(prise.id, ailleurs, 'jamais');
    expect(await store.finir(prise.id, ici, p.jeton, 'refuse', 'x'.repeat(800))).toBe(true);
    // Une erreur trop longue est coupée à 500 caractères ; la contrainte de statut refuse l'inconnu.
    expect((await store.lire(prise.id, ici))!.erreur).toHaveLength(500);
    await expect(pool.query(`insert into shopify_reprises (tenant_id, genre, domaine, fenetre_debut, statut) values ($1, 'commandes', 'x', now(), 'perdue')`, [ici]))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('🔴 un rattrapage fini AVANT le début du suivi courant (coupure, effacement, autre boutique) ne se dit plus', async () => {
    expect((await contacts.suiviSegments(ici)).boutique?.rattrapage).toBeDefined();
    // Le suivi reprend maintenant (un rebranchement) : le rattrapage d'avant laisse un trou, il n'est plus dit.
    await pool.query(`update shopify_boutiques set commandes_depuis = now() + interval '1 second' where tenant_id = $1`, [ici]);
    expect((await contacts.suiviSegments(ici)).boutique).not.toHaveProperty('rattrapage');
    await pool.query(`update shopify_boutiques set commandes_depuis = now() - interval '1 day' where tenant_id = $1`, [ici]);
  });

  it('🔴 les deux lectures du rattachement : les commandes notées (à compléter ou non), les fiches ACTIVES des numéros, jamais d’un autre espace', async () => {
    const fiche = async (t: string, tel: string) => (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [t, tel],
    )).rows[0]!.id;
    const active = await fiche(ici, '+33600313001');
    const supprimee = await fiche(ici, '+33600313002');
    // La suppression réelle : la purge, seul chemin qui supprime, anonymise le numéro (sa trace garde la recréation).
    await contacts.purgeMany(ici, [supprimee]);
    await fiche(ailleurs, '+33600313003');
    expect(await contacts.fichesParNumeros(ici, ['+33600313001', '+33600313002', '+33600313003', '+33600313999']))
      .toEqual(new Map([['+33600313001', active]]));
    expect(await contacts.fichesParNumeros(ici, [])).toEqual(new Map());

    const sansLignes = { payeeLe: new Date(), montant: '10', devise: 'EUR', test: false };
    const ligne = { ligneId: '1', produitId: '7', varianteId: null, sku: null, titre: 'Bougie', varianteTitre: null, quantite: 1, carteCadeau: false };
    await shopify.lierCommande(ici, '313001', null, active, sansLignes);
    await shopify.lierCommande(ici, '313002', null, active, { ...sansLignes, lignes: { lignes: [ligne], tronquees: false } });
    // Une course : le rattrapage a lu la fiche active, une purge passe avant l'écriture de sa commande.
    await shopify.lierCommande(ici, '313003', null, supprimee, sansLignes);
    const etrangere = await fiche(ailleurs, '+33600313004');
    await shopify.lierCommande(ailleurs, '313004', null, etrangere, sansLignes);
    expect(await shopify.commandesConnues(ici, ['313001', '313002', '313003', '313004', '313999'])).toEqual(new Map([
      // Sans lignes, fiche active : à compléter.
      ['313001', { contactId: active, aCompleter: true }],
      // Déjà ses lignes : jamais réécrite.
      ['313002', { contactId: active, aCompleter: false }],
      // Sa fiche supprimée : connue, jamais réécrite.
      ['313003', { contactId: supprimee, aCompleter: false }],
    ]));
  });
});
