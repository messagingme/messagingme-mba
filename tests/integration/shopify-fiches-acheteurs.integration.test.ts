import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgContactStore } from '../../src/crm/contact-store.pg';
import { PgShopifyStore } from '../../src/shopify/store.pg';
import { PgReprisesStore } from '../../src/shopify/reprises.pg';
import { PgCampaignRepo, PgRecipientStore } from '../../src/campaign/store.pg';
import { cablerReprise, rattacher, sourceDuConsentement, type DepsReprise } from '../../src/shopify/reprise';
import { traiterSansWhatsapp } from '../../src/shopify/sans-whatsapp';
import { empreinteRefus, RETENTION_NUMEROS_EFFACES_JOURS } from '../../src/crm/refus-effaces';
import { LimiteOffreError } from '../../src/offres/refus';
import { commandeLue } from '../reprise-faux';

const url = process.env.DATABASE_URL ?? '';

/**
 * LES FICHES D'ACHETEURS DU RATTRAPAGE (segments Shopify enrichis, lot 5b ; décisions de Julien du 2026-11-24) contre un
 * VRAI Postgres. Le rattachement d'une page tourne sur ses vraies lectures et sa vraie transaction (rien chez Shopify :
 * les commandes sont données). Ce qu'aucun faux ne prouve : la fiche de l'ACHETEUR créée par le chemin de l'import des
 * abonnés (consentante, la trace de l'attestation, « Shopify », née Shopify), sa commande et ses lignes dans LA MÊME
 * transaction (une panne n'en laisse rien, une ligne refusée ne coûte que les lignes), l'unicité par numéro, l'isolation
 * entre espaces, la liste de refus qui garde un STOP effacé, la limite de l'offre, et 🔴 un contact SUPPRIMÉ (par la
 * purge, seul chemin qui supprime) qui ne revient jamais par le rattrapage : la trace des numéros effacés (migration 0317).
 *
 * ⚠️ Jamais joué en local contre `DATABASE_URL` (l'ancienne production) : joué par le job `integration`.
 */
describe.skipIf(!url)('les fiches d’acheteurs du rattrapage (Postgres)', () => {
  let pool: Pool;
  let contacts: PgContactStore;
  let shopify: PgShopifyStore;
  let repo: PgCampaignRepo;
  let destinataires: PgRecipientStore;
  let deps: DepsReprise;
  let ici = '';
  let ailleurs = '';
  /** La limite de contacts de l'offre d'ici (`null` : sans limite), lue par le magasin comme celle de l'offre. */
  let limite: number | null = null;
  let numero = 0;
  let commande = 0;
  const DOMAINE = `itest-acheteurs-${randomBytes(4).toString('hex')}.myshopify.com`;
  const BOUTIQUE = { pays: 'FR', devise: 'EUR' };
  const SOURCE = sourceDuConsentement(DOMAINE, { coche: true, texte: 't', email: null, le: '2026-11-20T09:00:00.000Z', domaine: DOMAINE });
  const zero = { lues: 0, rattachees: 0, deja: 0, sansFiche: 0, sansNumero: 0, fichesCreees: 0, horsPlafond: 0 };
  /** Une commande payée la veille : AVANT toute purge faite par un test, quelle que soit l'horloge de la machine. */
  const hier = () => new Date(Date.now() - 86_400_000).toISOString();

  const telephone = () => `+336005${String(++numero).padStart(5, '0')}`;
  const idCommande = () => 9_100_000 + (++commande);
  const fiches = async (t: string, tel: string) => (await pool.query<{
    id: string; opt_in_status: string; opt_in_source: string | null; tags: string[]; nee_de: string | null; profile_name: string | null;
    deleted_at: Date | null;
  }>(
    'select id, opt_in_status, opt_in_source, tags, nee_de, profile_name, deleted_at from contacts where tenant_id = $1 and phone_e164 = $2',
    [t, tel],
  )).rows;
  const commandesDe = async (t: string, ids: number[]) => (await pool.query<{ commande_id: string; contact_id: string }>(
    'select commande_id, contact_id from shopify_commandes where tenant_id = $1 and commande_id = any($2::text[]) order by commande_id',
    [t, ids.map(String)],
  )).rows;
  const lignesDe = async (t: string, id: number) => Number((await pool.query<{ n: string }>(
    'select count(*) as n from shopify_commande_lignes where tenant_id = $1 and commande_id = $2', [t, String(id)],
  )).rows[0]!.n);
  const traces = async (t: string) => Number((await pool.query<{ n: string }>(
    'select count(*) as n from numeros_effaces where tenant_id = $1', [t],
  )).rows[0]!.n);
  /** La règle du premier 131026 (lot 2a), telle que le worker la joue sur l'échec d'un message. */
  const echecSansWhatsapp = async (ficheId: string, tel: string, campagne: { nom: string; categorie: 'utility' | 'marketing' }, commandeId?: number) => {
    const cid = await repo.insertCampaign({
      tenantId: ici, phoneNumberId: 'pn-itest-acheteurs', name: campagne.nom, category: campagne.categorie,
      templateName: 't', templateLanguage: 'fr', paramMapping: [],
    });
    await repo.insertRecipients(cid, [{ contactId: ficheId, toE164: tel, resolvedParams: [] }]);
    if (commandeId !== undefined) {
      await pool.query(`insert into shopify_envois (campaign_id, tenant_id, commande_id) values ($1, $2, $3)`, [cid, ici, String(commandeId)]);
    }
    const wamid = `wamid.itest-acheteurs-${randomUUID()}`;
    await pool.query(`update campaign_recipients set status = 'sent', message_id = $2 where campaign_id = $1`, [cid, wamid]);
    await destinataires.updateDeliveryByMessageId(wamid, 'failed', '131026 erreur', 131026, null);
    expect(await destinataires.ficheNeeDeShopifySansWhatsapp(wamid)).toEqual({ tenantId: ici, contactId: ficheId });
    await traiterSansWhatsapp({
      ficheASupprimer: (m) => destinataires.ficheNeeDeShopifySansWhatsapp(m), contacts, listeDeLAgent: { oublierChezMeta: async () => undefined },
    }, { messageId: wamid });
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    ici = await espace('itest-acheteurs');
    ailleurs = await espace('itest-acheteurs-autre');
    contacts = new PgContactStore(pool, undefined, async (t) => (t === ici && limite !== null ? { max: limite, offre: 'base' } : null));
    shopify = new PgShopifyStore(pool, randomBytes(32).toString('hex'));
    repo = new PgCampaignRepo(pool);
    destinataires = new PgRecipientStore(pool);
    await shopify.connecter(ici, {
      domaine: DOMAINE, clientId: 'cid', secretClair: 'shpss_itest', nom: null, pays: 'FR', devise: 'EUR', par: null, origine: 'claude_code',
    });
    deps = cablerReprise({ pool, reprises: new PgReprisesStore(pool), boutiques: shopify, contacts, enfiler: async () => undefined, offre: async () => 'pro' });
  });

  afterAll(async () => {
    for (const t of [ici, ailleurs]) {
      if (!t) continue;
      await pool.query('delete from shopify_envois where tenant_id = $1', [t]);
      await pool.query('delete from campaign_recipients where campaign_id in (select id from campaigns where tenant_id = $1)', [t]);
      await pool.query('delete from campaigns where tenant_id = $1', [t]);
      await pool.query('delete from shopify_commandes where tenant_id = $1', [t]);
      await pool.query('delete from shopify_attestations where tenant_id = $1', [t]);
      await pool.query('delete from shopify_boutiques where tenant_id = $1', [t]);
      await pool.query('delete from refus_effaces where tenant_id = $1', [t]);
      await pool.query('delete from numeros_effaces where tenant_id = $1', [t]);
      await pool.query('delete from contacts where tenant_id = $1', [t]);
      await pool.query('delete from tenants where id = $1', [t]);
    }
    await pool.end();
  });

  it('🔴 la création réelle : la fiche de l’ACHETEUR par le chemin de l’import (consentante, la trace de l’attestation, « Shopify », née Shopify, à son nom), puis ses commandes et leurs lignes ; le destinataire d’un cadeau n’entre pas', async () => {
    const [tel, destinataire] = [telephone(), telephone()];
    const [a, b] = [idCommande(), idCommande()];
    const c = await rattacher(deps, ici, [
      // Un cadeau : l'acheteur par sa facturation, le destinataire par la livraison (le premier numéro du webhook).
      commandeLue(a, { telephone: null, facturation: { telephone: tel, prenom: 'Jean', nom: 'Moulin' }, livraison: { telephone: destinataire, prenom: 'Léa', nom: 'Dupont' }, lignes: 2 }),
      commandeLue(b, { telephone: tel }),
    ], BOUTIQUE, { source: SOURCE });
    expect(c).toEqual({ ...zero, lues: 2, rattachees: 2, fichesCreees: 1 });
    const [fiche] = await fiches(ici, tel);
    expect(fiche).toMatchObject({ opt_in_status: 'opted_in', opt_in_source: SOURCE, tags: ['Shopify'], nee_de: 'shopify', profile_name: 'Jean Moulin', deleted_at: null });
    expect(await fiches(ici, destinataire)).toEqual([]);
    expect(await commandesDe(ici, [a, b])).toEqual([{ commande_id: String(a), contact_id: fiche!.id }, { commande_id: String(b), contact_id: fiche!.id }]);
    expect(await lignesDe(ici, a)).toBe(2);
    // 🔴 Relancé, il ne crée rien de plus : les commandes sont connues, la fiche reste UNE.
    expect(await rattacher(deps, ici, [commandeLue(a, { telephone: tel }), commandeLue(b, { telephone: tel })], BOUTIQUE, { source: SOURCE }))
      .toEqual({ ...zero, lues: 2, deja: 2 });
    expect(await fiches(ici, tel)).toHaveLength(1);
  });

  it('🔴 l’unicité par numéro : deux commandes du même numéro dans une page, une fiche ; le même numéro deux fois dans une écriture, une fiche', async () => {
    const tel = telephone();
    const ids = [idCommande(), idCommande()];
    expect(await rattacher(deps, ici, ids.map((id) => commandeLue(id, { telephone: tel })), BOUTIQUE, { source: SOURCE }))
      .toMatchObject({ rattachees: 2, fichesCreees: 1 });
    expect(await fiches(ici, tel)).toHaveLength(1);
    // Au plus bas : la même fiche demandée deux fois par la même transaction, puis une seconde fois.
    const autre = telephone();
    const deux = await deps.ecrirePage(ici, { fiches: [{ numero: autre, nom: null }, { numero: autre, nom: 'Léa' }], source: SOURCE, liaisons: [] });
    expect(deux).toEqual({ creees: 1 });
    expect(await deps.ecrirePage(ici, { fiches: [{ numero: autre, nom: null }], source: SOURCE, liaisons: [] })).toEqual({ creees: 0 });
    expect(await fiches(ici, autre)).toHaveLength(1);
  });

  it('🔴 l’isolation entre espaces : la fiche du même numéro ailleurs n’est ni vue, ni touchée ; sa liste de refus et ses envois non plus', async () => {
    const tel = telephone();
    const etrangere = (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164, opt_in_status, tags) values ($1, $2, 'unknown', '{VIP}') returning id`, [ailleurs, tel],
    )).rows[0]!.id;
    await pool.query(`insert into refus_effaces (tenant_id, empreinte, whatsapp_le) values ($1, $2, now())`, [ailleurs, empreinteRefus(ailleurs, { tel })]);
    expect(await contacts.fichesParNumeros(ici, [tel])).toEqual(new Map());
    expect(await contacts.numerosEnRefus(ici, [tel])).toEqual(new Set());
    const id = idCommande();
    expect(await rattacher(deps, ici, [commandeLue(id, { telephone: tel })], BOUTIQUE, { source: SOURCE })).toMatchObject({ fichesCreees: 1 });
    const [ici1] = await fiches(ici, tel);
    expect(ici1!.id).not.toBe(etrangere);
    expect(await fiches(ailleurs, tel)).toEqual([expect.objectContaining({ id: etrangere, opt_in_status: 'unknown', tags: ['VIP'], nee_de: null })]);
    expect(await commandesDe(ailleurs, [id])).toEqual([]);
    expect(await contacts.numerosEnRefus(ailleurs, [tel])).toEqual(new Set([tel]));
  });

  it('🔴 STOP : un numéro de la liste de refus n’est pas recréé ; forcé, il renaîtrait en STOP ; une fiche en STOP reçoit sa commande, son refus intact', async () => {
    const efface = telephone();
    await pool.query(`insert into refus_effaces (tenant_id, empreinte, whatsapp_le) values ($1, $2, now() - interval '10 days')`, [ici, empreinteRefus(ici, { tel: efface })]);
    const enStop = telephone();
    const fiche = (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164, opt_in_status, opt_in_source, opt_out_at) values ($1, $2, 'opted_out', 'stop_whatsapp', now()) returning id`,
      [ici, enStop],
    )).rows[0]!.id;
    const [x, y] = [idCommande(), idCommande()];
    expect(await rattacher(deps, ici, [commandeLue(x, { telephone: efface }), commandeLue(y, { telephone: enStop })], BOUTIQUE, { source: SOURCE }))
      .toEqual({ ...zero, lues: 2, rattachees: 1, sansFiche: 1 });
    expect(await fiches(ici, efface)).toEqual([]);
    expect(await fiches(ici, enStop)).toEqual([expect.objectContaining({ id: fiche, opt_in_status: 'opted_out', opt_in_source: 'stop_whatsapp', tags: [] })]);
    expect(await commandesDe(ici, [x, y])).toEqual([{ commande_id: String(y), contact_id: fiche }]);
    // Le filet du chemin de l'import : même forcée, la création d'un STOP effacé le garde (autorité `import`).
    await deps.ecrirePage(ici, { fiches: [{ numero: efface, nom: null }, { numero: enStop, nom: null }], source: SOURCE, liaisons: [] });
    expect(await fiches(ici, efface)).toEqual([expect.objectContaining({ opt_in_status: 'opted_out', opt_in_source: 'liste_de_refus' })]);
    expect(await fiches(ici, enStop)).toEqual([expect.objectContaining({ opt_in_status: 'opted_out', opt_in_source: 'stop_whatsapp' })]);
  });

  it('🔴 scénario A de la relecture : un contact créé par le rattrapage puis SUPPRIMÉ par le marchand (la purge) ne revient jamais ; une commande payée après la suppression, si', async () => {
    const tel = telephone();
    const id = idCommande();
    const payee = hier();
    expect(await rattacher(deps, ici, [commandeLue(id, { telephone: tel, payeeLe: payee })], BOUTIQUE, { source: SOURCE })).toMatchObject({ fichesCreees: 1 });
    const [fiche] = await fiches(ici, tel);
    // La suppression de la console : la purge anonymise le numéro, efface les commandes de la fiche, et en garde la trace.
    await contacts.purgeMany(ici, [fiche!.id]);
    expect(await fiches(ici, tel)).toEqual([]);
    expect(await commandesDe(ici, [id])).toEqual([]);
    const effaceLe = (await contacts.effacementsDesNumeros(ici, [tel])).get(tel);
    expect(effaceLe).toBeInstanceOf(Date);
    // Relancé : la commande, redevenue inconnue, ne refait pas la fiche.
    expect(await rattacher(deps, ici, [commandeLue(id, { telephone: tel, payeeLe: payee })], BOUTIQUE, { source: SOURCE })).toEqual({ ...zero, lues: 1, sansFiche: 1 });
    expect(await fiches(ici, tel)).toEqual([]);
    expect(await commandesDe(ici, [id])).toEqual([]);
    // Une commande payée APRÈS la suppression est une nouvelle commande : sa fiche naît, comme le webhook l'aurait fait.
    const nouvelle = idCommande();
    const apres = new Date(effaceLe!.getTime() + 60_000).toISOString();
    expect(await rattacher(deps, ici, [commandeLue(nouvelle, { telephone: tel, payeeLe: apres })], BOUTIQUE, { source: SOURCE }))
      .toEqual({ ...zero, lues: 1, rattachees: 1, fichesCreees: 1 });
    expect(await fiches(ici, tel)).toHaveLength(1);
  });

  it('🔴 lot 7a : un espace qui a purgé un contact AVANT la trace (2026-11-24) ne refait aucune fiche d’une commande payée avant elle ; payée après, si ; les autres espaces n’en sont pas touchés', async () => {
    const ancien = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-acheteurs-ancien') returning id`)).rows[0]!.id;
    try {
      const purgee = (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [ancien, telephone()])).rows[0]!.id;
      expect(await deps.purgesAvantTrace(ancien)).toBe(false);
      await contacts.purgeMany(ancien, [purgee]);
      // Une purge d'aujourd'hui laisse sa trace : elle ne compte pas. Seule une écriture la vieillit, pour figurer une purge
      // faite avant que la trace n'existe.
      expect(await deps.purgesAvantTrace(ancien)).toBe(false);
      await pool.query(`update contacts set anonymized_at = '2026-11-10T12:00:00Z', deleted_at = '2026-11-10T12:00:00Z' where id = $1`, [purgee]);
      expect(await deps.purgesAvantTrace(ancien)).toBe(true);
      expect(await deps.purgesAvantTrace(ailleurs)).toBe(false);
      const [avant, apres] = [telephone(), telephone()];
      expect(await rattacher(deps, ancien, [commandeLue(idCommande(), { telephone: avant, payeeLe: '2026-11-20T10:00:00Z' })], BOUTIQUE, { source: SOURCE }))
        .toEqual({ ...zero, lues: 1, sansFiche: 1 });
      expect(await fiches(ancien, avant)).toEqual([]);
      expect(await rattacher(deps, ancien, [commandeLue(idCommande(), { telephone: apres, payeeLe: hier() })], BOUTIQUE, { source: SOURCE }))
        .toEqual({ ...zero, lues: 1, rattachees: 1, fichesCreees: 1 });
      expect(await fiches(ancien, apres)).toHaveLength(1);
    } finally {
      await pool.query('delete from shopify_commandes where tenant_id = $1', [ancien]);
      await pool.query('delete from numeros_effaces where tenant_id = $1', [ancien]);
      await pool.query('delete from refus_effaces where tenant_id = $1', [ancien]);
      await pool.query('delete from contacts where tenant_id = $1', [ancien]);
      await pool.query('delete from tenants where id = $1', [ancien]);
    }
  });

  it('🔴 scénario B de la relecture : supprimée au 131026 d’une CAMPAGNE (aucun message de sa commande n’a échoué), la fiche ne renaît pas', async () => {
    const tel = telephone();
    const id = idCommande();
    await rattacher(deps, ici, [commandeLue(id, { telephone: tel, payeeLe: hier() })], BOUTIQUE, { source: SOURCE });
    const [fiche] = await fiches(ici, tel);
    await echecSansWhatsapp(fiche!.id, tel, { nom: 'Promo de Noël', categorie: 'marketing' });
    expect(await fiches(ici, tel)).toEqual([]);
    // Ni la liste des commandes refusées par WhatsApp (ce n'était pas un message de la commande) : seule la trace la garde.
    expect(await deps.commandesSansWhatsapp(ici, [String(id)])).toEqual(new Set());
    expect(await rattacher(deps, ici, [commandeLue(id, { telephone: tel, payeeLe: hier() })], BOUTIQUE, { source: SOURCE })).toEqual({ ...zero, lues: 1, sansFiche: 1 });
    expect(await fiches(ici, tel)).toEqual([]);
  });

  it('🔴 la trace des numéros effacés : TOUTE purge d’une fiche qui a un numéro la laisse, STOP ou non, son empreinte et jamais le numéro, dans son seul espace ; la rétention l’efface après 90 jours, la dernière purge comptant', async () => {
    const [tel, stop] = [telephone(), telephone()];
    const ids = (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164, bsuid, opt_in_status, opt_out_at)
       values ($1, $2, null, 'opted_in', null), ($1, $3, null, 'opted_out', now()), ($1, null, $4, 'unknown', null) returning id`,
      [ici, tel, stop, `bsuid-itest-${randomUUID()}`],
    )).rows.map((r) => r.id);
    const avant = await traces(ici);
    await contacts.purgeMany(ici, ids);
    // Deux numéros, deux traces ; la fiche sans numéro (un BSUID seul) n'en laisse aucune.
    expect(await traces(ici)).toBe(avant + 2);
    expect([...(await contacts.effacementsDesNumeros(ici, [tel, stop, telephone()])).keys()].sort()).toEqual([tel, stop].sort());
    expect((await pool.query('select 1 from numeros_effaces where empreinte = any($1::text[])', [[tel, stop]])).rowCount).toBe(0);
    expect(await contacts.effacementsDesNumeros(ailleurs, [tel, stop])).toEqual(new Map());
    // Les deux vieillies au-delà de la rétention, puis l'une purgée à nouveau : seule la plus vieille part.
    await pool.query(
      `update numeros_effaces set efface_le = now() - make_interval(days => $3::int + 1) where tenant_id = $1 and empreinte = any($2::text[])`,
      [ici, [empreinteRefus(ici, { tel }), empreinteRefus(ici, { tel: stop })], RETENTION_NUMEROS_EFFACES_JOURS],
    );
    const revenue = (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [ici, stop])).rows[0]!.id;
    await contacts.purgeMany(ici, [revenue]);
    expect(await contacts.purgerNumerosEffaces(RETENTION_NUMEROS_EFFACES_JOURS)).toBeGreaterThanOrEqual(1);
    expect([...(await contacts.effacementsDesNumeros(ici, [tel, stop])).keys()]).toEqual([stop]);
  });

  it('🔴 la limite de contacts de l’offre : jamais dépassée ; au-delà, la commande est comptée hors plafond ; le filet de l’import refuse une page qui la dépasserait, sans rien en laisser', async () => {
    const comptees = Number((await pool.query<{ n: string }>(
      'select count(*) as n from contacts where tenant_id = $1 and deleted_at is null and anonymized_at is null', [ici],
    )).rows[0]!.n);
    limite = comptees + 1;
    try {
      const [b, c] = [telephone(), telephone()];
      const [x, y] = [idCommande(), idCommande()];
      expect(await deps.places(ici)).toEqual({ limite, comptees });
      expect(await rattacher(deps, ici, [commandeLue(x, { telephone: b }), commandeLue(y, { telephone: c })], BOUTIQUE, { source: SOURCE }))
        .toEqual({ ...zero, lues: 2, rattachees: 1, fichesCreees: 1, horsPlafond: 1 });
      expect(await fiches(ici, c)).toEqual([]);
      expect(await commandesDe(ici, [y])).toEqual([]);
      // Une page qui dépasserait (une place prise entre la lecture des places et l'écriture) : refusée en entier.
      const d = telephone();
      await expect(deps.ecrirePage(ici, {
        fiches: [{ numero: d, nom: null }], source: SOURCE,
        liaisons: [{ commandeId: String(idCommande()), clientId: null, numero: d, details: { payeeLe: new Date(), montant: '1', devise: 'EUR', test: false } }],
      })).rejects.toBeInstanceOf(LimiteOffreError);
      expect(await fiches(ici, d)).toEqual([]);
    } finally {
      limite = null;
    }
  });

  it('🔴 la création, la commande et ses lignes dans UNE transaction : une commande qui échoue n’en laisse rien, ni fiche ni commande', async () => {
    const tel = telephone();
    const id = idCommande();
    await expect(deps.ecrirePage(ici, {
      fiches: [{ numero: tel, nom: 'Léa' }], source: SOURCE,
      liaisons: [{ commandeId: String(id), clientId: null, numero: tel, details: { payeeLe: new Date(), montant: 'pas-un-nombre', devise: 'EUR', test: false } }],
    })).rejects.toThrow();
    expect(await fiches(ici, tel)).toEqual([]);
    expect(await commandesDe(ici, [id])).toEqual([]);
  });

  it('🔴 les lignes restent au mieux, derrière un point de reprise : une ligne que la base refuse garde la fiche et la commande, sans lignes, à compléter au rattrapage suivant', async () => {
    const tel = telephone();
    const id = idCommande();
    // Un titre de 201 caractères : la contrainte de la table le refuse (200 au plus).
    const ligne = { ligneId: '1', produitId: '7', varianteId: null, sku: null, titre: 'x'.repeat(201), varianteTitre: null, quantite: 1, carteCadeau: false };
    expect(await deps.ecrirePage(ici, {
      fiches: [{ numero: tel, nom: null }], source: SOURCE,
      liaisons: [{ commandeId: String(id), clientId: null, numero: tel, details: { payeeLe: new Date(), montant: '10', devise: 'EUR', test: false, lignes: { lignes: [ligne], tronquees: false } } }],
    })).toEqual({ creees: 1 });
    const [fiche] = await fiches(ici, tel);
    expect(fiche).toMatchObject({ opt_in_status: 'opted_in', nee_de: 'shopify' });
    expect(await commandesDe(ici, [id])).toEqual([{ commande_id: String(id), contact_id: fiche!.id }]);
    expect(await lignesDe(ici, id)).toBe(0);
    expect(await shopify.commandesConnues(ici, [String(id)])).toEqual(new Map([[String(id), { contactId: fiche!.id, aCompleter: true }]]));
  });

  it('🔴 la fiche créée entre dans la règle du premier 131026 ; supprimée, la commande dont WhatsApp a refusé le numéro ne la refait pas', async () => {
    const tel = telephone();
    const id = idCommande();
    expect(await rattacher(deps, ici, [commandeLue(id, { telephone: tel, payeeLe: hier() })], BOUTIQUE, { source: SOURCE })).toMatchObject({ fichesCreees: 1 });
    const [fiche] = await fiches(ici, tel);
    // Sa confirmation part, et Meta la refuse : 131026.
    await echecSansWhatsapp(fiche!.id, tel, { nom: `Shopify · commande payée · #${id}`, categorie: 'utility' }, id);
    expect(await fiches(ici, tel)).toEqual([]);
    // Relancé, le rattrapage relit la commande, inconnue depuis la purge : la trace de la purge et le refus de WhatsApp
    // la gardent l'une et l'autre, rien ne renaît.
    expect(await deps.commandesSansWhatsapp(ici, [String(id)])).toEqual(new Set([String(id)]));
    expect(await deps.commandesSansWhatsapp(ailleurs, [String(id)])).toEqual(new Set());
    expect(await rattacher(deps, ici, [commandeLue(id, { telephone: tel, payeeLe: hier() })], BOUTIQUE, { source: SOURCE })).toEqual({ ...zero, lues: 1, sansFiche: 1 });
    expect(await fiches(ici, tel)).toEqual([]);
  });
});
