import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgCampaignRepo, PgRecipientStore } from '../../src/campaign/store.pg';
import { PgJoignabiliteStore, effacerJoignabiliteDuBranchement } from '../../src/shopify/joignabilite.pg';
import { PgShopifyStore } from '../../src/shopify/store.pg';
import { addDays, todayParis } from '../../src/stats/range';

const url = process.env.DATABASE_URL ?? '';

/**
 * LA JOIGNABILITÉ WHATSAPP DES COMMANDES SHOPIFY (migration 0310, segments Shopify enrichis, lot 2b). Ce qu'aucun faux ne
 * prouve : la répartition en cinq parts SANS RECOUVREMENT lue sur les vrais accusés (`campaign_recipients`), la première
 * expédition gardée, la période en jours de Paris, le test à part, l'isolation entre espaces, et les effacements.
 * ⚠️ À ne pas confondre avec `joignabilite.integration.test.ts` (la mémoire de joignabilité d'UN contact).
 *
 * ⚠️ Jamais joué en local contre `DATABASE_URL` (l'ancienne production) : joué par le job `integration`.
 */
describe.skipIf(!url)('la joignabilité WhatsApp des commandes Shopify (Postgres)', () => {
  let pool: Pool;
  let repo: PgCampaignRepo;
  let destinataires: PgRecipientStore;
  let store: PgJoignabiliteStore;
  let ici = '';
  let ailleurs = '';
  let numero = 0;
  const periode = () => ({ from: addDays(todayParis(), -1), to: addDays(todayParis(), 1) });

  type Accuse = 'sent' | 'delivered' | 'read' | { echec: number };

  /** Une campagne d'un destinataire et son accusé (`sent`, `delivered`, `read`, ou `failed` avec un code). */
  async function campagne(tenant: string, accuse: Accuse): Promise<string> {
    const tel = `+336005${String(++numero).padStart(5, '0')}`;
    const contact = (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [tenant, tel])).rows[0]!.id;
    const cid = await repo.insertCampaign({
      tenantId: tenant, phoneNumberId: 'pn-itest-jo', name: `Shopify · commande payée · #${numero}`, category: 'utility',
      templateName: 't', templateLanguage: 'fr', paramMapping: [],
    });
    await repo.insertRecipients(cid, [{ contactId: contact, toE164: tel, resolvedParams: [] }]);
    const wamid = `wamid.itest-jo-${randomUUID()}`;
    await pool.query(`update campaign_recipients set status = 'sent', message_id = $2 where campaign_id = $1`, [cid, wamid]);
    if (typeof accuse === 'string') await destinataires.updateDeliveryByMessageId(wamid, accuse, null, null, null);
    else await destinataires.updateDeliveryByMessageId(wamid, 'failed', `${accuse.echec} erreur`, accuse.echec, null);
    return cid;
  }

  /** Un message Shopify de cette commande : sa campagne, reliée comme l'envoi Shopify la relie. */
  async function message(tenant: string, commande: string, accuse: Accuse): Promise<void> {
    await store.noterEnvoi(tenant, await campagne(tenant, accuse), commande);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    repo = new PgCampaignRepo(pool);
    destinataires = new PgRecipientStore(pool);
    store = new PgJoignabiliteStore(pool);
    ici = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-joignabilite-shopify') returning id`)).rows[0]!.id;
    ailleurs = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-joignabilite-shopify-autre') returning id`)).rows[0]!.id;
  });

  afterAll(async () => {
    for (const t of [ici, ailleurs]) {
      if (!t) continue;
      await pool.query('delete from shopify_envois where tenant_id = $1', [t]);
      await pool.query('delete from shopify_joignabilite where tenant_id = $1', [t]);
      await pool.query('delete from campaign_recipients where campaign_id in (select id from campaigns where tenant_id = $1)', [t]);
      await pool.query('delete from campaigns where tenant_id = $1', [t]);
      await pool.query('delete from contacts where tenant_id = $1', [t]);
      await pool.query('delete from tenants where id = $1', [t]);
    }
    await pool.end();
  });

  it('🔴 cinq parts sans recouvrement, la première qui s’applique gagne ; le test à part ; seules les expéditions de la période', async () => {
    // A : utilisable, confirmation livrée ET avis d'expédition lu : une commande livrée, deux messages.
    await store.noterCommande(ici, 'A', 'utilisable', false);
    await message(ici, 'A', 'delivered');
    await message(ici, 'A', 'read');
    // B : son message a échoué en 131026 et la fiche a été purgée (la ligne de campagne anonymisée).
    await store.noterCommande(ici, 'B', 'utilisable', false);
    await message(ici, 'B', { echec: 131026 });
    await pool.query(
      `update campaign_recipients set to_e164 = 'anonyme'
        where campaign_id in (select campaign_id from shopify_envois where tenant_id = $1 and commande_id = 'B')`, [ici],
    );
    // B2 : un 131026 dont la fiche est encore là (gardée par les gardes du 2a) : ni supprimée ni en attente, un échec
    // définitif, donc « pas de message livrable » (la sixième part, lot 3).
    await store.noterCommande(ici, 'B2', 'utilisable', false);
    await message(ici, 'B2', { echec: 131026 });
    // C, D : sans numéro, numéro invalide.
    await store.noterCommande(ici, 'C', 'sans_numero', false);
    await store.noterCommande(ici, 'D', 'invalide', false);
    // E : seulement `sent` : en attente.
    await store.noterCommande(ici, 'E', 'utilisable', false);
    await message(ici, 'E', 'sent');
    // N : un numéro utilisable mais aucun message (automation éteinte) : « pas de message livrable ».
    await store.noterCommande(ici, 'N', 'utilisable', false);
    // F : un invalide dont l'avis d'expédition (au numéro de livraison) a été livré : LIVRÉE gagne.
    await store.noterCommande(ici, 'F', 'invalide', false);
    await message(ici, 'F', 'delivered');
    // G : confirmation livrée, avis d'expédition (un autre numéro) en 131026 et fiche purgée : LIVRÉE gagne.
    await store.noterCommande(ici, 'G', 'utilisable', false);
    await message(ici, 'G', 'delivered');
    await message(ici, 'G', { echec: 131026 });
    await pool.query(
      `update campaign_recipients set to_e164 = 'anonyme' where delivery_status = 'failed'
          and campaign_id in (select campaign_id from shopify_envois where tenant_id = $1 and commande_id = 'G')`, [ici],
    );
    // H : un invalide (fixe de livraison) dont l'avis d'expédition est parti à un autre numéro, en 131026, fiche purgée :
    // SUPPRIMÉE gagne sur invalide.
    await store.noterCommande(ici, 'H', 'invalide', false);
    await message(ici, 'H', { echec: 131026 });
    await pool.query(
      `update campaign_recipients set to_e164 = 'anonyme'
        where campaign_id in (select campaign_id from shopify_envois where tenant_id = $1 and commande_id = 'H')`, [ici],
    );
    // S : payée avant la mise en service (paiement jamais vu), expédiée, avis livré : hors de la carte, message compris.
    await message(ici, 'S', 'delivered');
    // Un autre espace a, lui aussi, une commande « C », et son message est livré : rien ne doit en déborder ici.
    await message(ailleurs, 'C', 'delivered');
    // Deux liens FORGÉS (un futur écrivain fautif), chacun arrêté par son propre filtre : une campagne livrée de l'autre
    // espace rangée sous la commande « C » d'ici (la campagne doit être de l'espace), et une campagne livrée d'ici rangée
    // par l'autre espace sous une commande « D » (le lien doit être de l'espace).
    const etrangere = await campagne(ailleurs, 'delivered');
    await pool.query(`insert into shopify_envois (campaign_id, tenant_id, commande_id) values ($1, $2, 'C')`, [etrangere, ici]);
    const prise = await campagne(ici, 'delivered');
    await pool.query(`insert into shopify_envois (campaign_id, tenant_id, commande_id) values ($1, $2, 'D')`, [prise, ailleurs]);
    // T : une commande de test, livrée : à part.
    await store.noterCommande(ici, 'T', 'utilisable', true);
    await message(ici, 'T', 'delivered');
    // P : payée, jamais expédiée ; V : expédiée il y a 40 jours ; X : un autre espace.
    await store.noterCommande(ici, 'P', 'utilisable', false);
    await store.noterCommande(ici, 'V', 'sans_numero', false);
    await store.noterCommande(ailleurs, 'X', 'sans_numero', false);
    for (const c of ['A', 'B', 'B2', 'C', 'D', 'E', 'F', 'G', 'H', 'N', 'S', 'T', 'V']) await store.noterExpedition(ici, c);
    await store.noterExpedition(ailleurs, 'X');
    await pool.query(`update shopify_joignabilite set expediee_le = now() - interval '40 days' where tenant_id = $1 and commande_id = 'V'`, [ici]);

    expect(await store.lire(ici, periode())).toEqual({
      // A, B, B2, C, D, E, F, G, H, N : 10 = 3 livrées (A, F, G) + 2 supprimées (B, H) + 1 sans numéro (C) + 1 invalide
      // (D) + 1 en attente (E) + 2 sans message livrable (B2, N) ; 4 messages livrés (deux pour A, un pour F, un pour G) ;
      // T à part ; S jamais vue payée, P jamais expédiée, V hors période, X et le « C » livré de l'autre espace ailleurs.
      expediees: 10, messagesLivres: 4, livrees: 3, supprimees: 2, sansNumero: 1, invalides: 1, enAttente: 1, pasLivrable: 2,
      testExpediees: 1,
    });
  });

  it('🔴 un second colis ne déplace pas la première expédition ; une commande jamais vue payée entre dans la carte à son paiement', async () => {
    await store.noterCommande(ici, 'K', 'utilisable', false);
    await store.noterExpedition(ici, 'K');
    await pool.query(`update shopify_joignabilite set expediee_le = now() - interval '40 days' where tenant_id = $1 and commande_id = 'K'`, [ici]);
    await store.noterExpedition(ici, 'K');
    const k = (await pool.query<{ classement: string; vieux: boolean }>(
      `select classement, expediee_le < now() - interval '30 days' as vieux from shopify_joignabilite where tenant_id = $1 and commande_id = 'K'`, [ici],
    )).rows[0]!;
    expect(k).toEqual({ classement: 'utilisable', vieux: true });
    const avant = await store.lire(ici, periode());
    // Expédiée avant que son paiement soit vu : sa ligne naît sans classement, et la carte ne bouge pas.
    await store.noterExpedition(ici, 'AVANT');
    expect((await pool.query(`select classement from shopify_joignabilite where tenant_id = $1 and commande_id = 'AVANT'`, [ici])).rows)
      .toEqual([{ classement: null }]);
    expect(await store.lire(ici, periode())).toEqual(avant);
    // Payée à la livraison : son paiement arrive après l'expédition, elle entre, expédition gardée ; aucun message relié.
    await store.noterCommande(ici, 'AVANT', 'utilisable', false);
    const apres = await store.lire(ici, periode());
    expect([apres.expediees - avant.expediees, (apres.pasLivrable ?? 0) - (avant.pasLivrable ?? 0)]).toEqual([1, 1]);
  });

  it('🔴 customers/redact efface les commandes citées, l’effacement du branchement tout l’espace, jamais un autre espace', async () => {
    const restantes = async (t: string) => (await pool.query<{ commande_id: string }>(
      'select commande_id from shopify_joignabilite where tenant_id = $1 order by commande_id', [t],
    )).rows.map((r) => r.commande_id);
    await store.effacerCommandes(ici, ['A', 'C']);
    expect(await restantes(ici)).not.toContain('A');
    expect(await restantes(ici)).not.toContain('C');
    expect(await restantes(ici)).toContain('B');
    expect((await pool.query(`select 1 from shopify_envois where tenant_id = $1 and commande_id = 'A'`, [ici])).rowCount).toBe(0);
    expect((await pool.query(`select 1 from shopify_envois where tenant_id = $1 and commande_id = 'B'`, [ici])).rowCount).toBe(1);
    // Par le VRAI chemin : `shop/redact` et la désinstallation passent par l'effacement du branchement du store Shopify.
    await new PgShopifyStore(pool, randomBytes(32).toString('hex')).effacerBoutique(ici);
    expect(await restantes(ici)).toEqual([]);
    expect((await pool.query('select 1 from shopify_envois where tenant_id = $1', [ici])).rowCount).toBe(0);
    expect(await restantes(ailleurs)).toEqual(['X']);
  });

  it('🔴 sans la table (migration 0310 pas encore passée), le point de reprise garde la transaction du branchement vivante', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      // La table absente, le temps de cette transaction annulée : ce que verrait une base où 0310 n'est pas passée.
      await client.query('alter table shopify_envois rename to shopify_envois_absente');
      await effacerJoignabiliteDuBranchement(client, ici);
      // Sans point de reprise, cette instruction-ci échouerait en 25P02 (transaction abandonnée).
      expect((await client.query('select 1 as vivante')).rows).toEqual([{ vivante: 1 }]);
    } finally {
      await client.query('rollback');
      client.release();
    }
    expect((await pool.query(`select to_regclass('shopify_envois') is not null as presente`)).rows[0]).toEqual({ presente: true });
  });

  it('le ménage : jamais expédiée ou jamais vue payée à 60 jours, toute ligne 400 jours après son expédition, les campagnes avec leur commande', async () => {
    const vieillir = (colonne: string, jours: number, commande: string) => pool.query(
      `update shopify_joignabilite set ${colonne} = now() - make_interval(days => $3) where tenant_id = $1 and commande_id = $2`,
      [ici, commande, jours],
    );
    await store.noterCommande(ici, 'VIEILLE-PAYEE', 'utilisable', false);
    await vieillir('cree_le', 61, 'VIEILLE-PAYEE');
    await store.noterCommande(ici, 'RECENTE-PAYEE', 'utilisable', false);
    await store.noterExpedition(ici, 'JAMAIS-PAYEE');
    await vieillir('cree_le', 61, 'JAMAIS-PAYEE');
    await store.noterExpedition(ici, 'JAMAIS-PAYEE-RECENTE');
    // Expédiée il y a 401 jours : partie, et la campagne qui la reliait avec elle.
    await store.noterCommande(ici, 'TRES-VIEILLE', 'utilisable', false);
    await message(ici, 'TRES-VIEILLE', 'delivered');
    await store.noterExpedition(ici, 'TRES-VIEILLE');
    await vieillir('cree_le', 402, 'TRES-VIEILLE');
    await vieillir('expediee_le', 401, 'TRES-VIEILLE');
    // Une précommande payée il y a 401 jours, expédiée il y a 10 : encore lisible, gardée avec sa campagne.
    await store.noterCommande(ici, 'PRECOMMANDE', 'utilisable', false);
    await message(ici, 'PRECOMMANDE', 'delivered');
    await store.noterExpedition(ici, 'PRECOMMANDE');
    await vieillir('cree_le', 401, 'PRECOMMANDE');
    await vieillir('expediee_le', 10, 'PRECOMMANDE');
    await pool.query(
      `update shopify_envois set cree_le = now() - interval '401 days' where tenant_id = $1 and commande_id in ('TRES-VIEILLE', 'PRECOMMANDE')`, [ici],
    );
    await store.purger();
    const restantes = (await pool.query<{ commande_id: string }>(
      'select commande_id from shopify_joignabilite where tenant_id = $1 order by commande_id', [ici],
    )).rows.map((r) => r.commande_id);
    expect(restantes).toEqual(['JAMAIS-PAYEE-RECENTE', 'PRECOMMANDE', 'RECENTE-PAYEE']);
    const envois = (await pool.query<{ commande_id: string }>(
      'select commande_id from shopify_envois where tenant_id = $1 order by commande_id', [ici],
    )).rows.map((r) => r.commande_id);
    expect(envois).toEqual(['PRECOMMANDE']);
  });
});
