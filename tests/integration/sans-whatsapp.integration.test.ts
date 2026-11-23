import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgContactStore, type CreationFiche } from '../../src/crm/contact-store.pg';
import { PgCampaignRepo, PgRecipientStore } from '../../src/campaign/store.pg';
import { traiterSansWhatsapp } from '../../src/shopify/sans-whatsapp';

const url = process.env.DATABASE_URL ?? '';

/**
 * LA FICHE NÉE D'UN ENVOI SHOPIFY, SUPPRIMÉE AU PREMIER 131026 (migration 0309, segments Shopify enrichis, lot 2a ; décision
 * de Julien du 2026-11-23). Ce qu'aucun faux ne prouve : la marque posée par la vraie insertion (et seulement par elle),
 * et chaque garde de la requête, vue tenir sur une fiche qui doit rester. Chaque cas construit SA fiche et SA ligne de
 * campagne, et ne diffère du cas supprimé que par la garde qu'il exerce.
 *
 * ⚠️ Jamais joué en local contre `DATABASE_URL` (l'ancienne production) : joué par le job `integration`.
 */
describe.skipIf(!url)('la fiche née d’un envoi Shopify et le premier 131026 (Postgres)', () => {
  let pool: Pool;
  let contacts: PgContactStore;
  let repo: PgCampaignRepo;
  let destinataires: PgRecipientStore;
  let ici = '';
  let ailleurs = '';
  let numero = 0;

  const telephone = () => `+336004${String(++numero).padStart(5, '0')}`;
  const neeDe = async (id: string): Promise<string | null> =>
    (await pool.query<{ nee_de: string | null }>('select nee_de from contacts where id = $1', [id])).rows[0]!.nee_de;

  /**
   * Une fiche, sa campagne et son destinataire, le message en échec : par défaut le cas QUI SE SUPPRIME (née d'un envoi
   * Shopify par la vraie insertion, 131026, aucune relance, sans repli, jamais écrit). Chaque option retire une condition.
   */
  async function cas(o: {
    marquee?: boolean; code?: number; statut?: 'failed' | 'delivered'; relances?: number; repli?: boolean;
    activite?: boolean; entrant?: boolean; supprimee?: boolean;
    /** Un message déjà LIVRÉ à cette fiche avant l'échec : sur une autre ligne de campagne, ou dans la conversation. */
    livreAvant?: 'campagne' | 'conversation';
  } = {}): Promise<{ wamid: string; contactId: string }> {
    const tel = telephone();
    const creation = await contacts.creerFicheApi(ici, { phoneE164: tel }, o.marquee === false ? {} : { neeDe: 'shopify' });
    if (creation === 'conflit') throw new Error('conflit inattendu');
    const contactId = creation.id;
    const cid = await repo.insertCampaign({
      tenantId: ici, phoneNumberId: 'pn-itest-sw', name: 'Shopify · commande payée · #1', category: 'utility',
      templateName: 't', templateLanguage: 'fr', paramMapping: [],
    });
    await repo.insertRecipients(cid, [{ contactId, toE164: tel, resolvedParams: [] }]);
    if (o.repli) await pool.query(`insert into campaign_etages (campaign_id, rang, canal) values ($1, 2, 'rcs') on conflict (campaign_id, rang) do nothing`, [cid]);
    const wamid = `wamid.itest-sw-${randomUUID()}`;
    await pool.query(
      `update campaign_recipients set status = 'sent', message_id = $2, retry_count = $3 where campaign_id = $1`,
      [cid, wamid, o.relances ?? 0],
    );
    const code = o.code ?? 131026;
    await destinataires.updateDeliveryByMessageId(wamid, o.statut ?? 'failed', o.statut === 'delivered' ? null : `${code} erreur`, o.statut === 'delivered' ? null : code, null);
    if (o.activite) await pool.query('update contacts set derniere_activite_le = now() where id = $1', [contactId]);
    if (o.entrant) {
      const conv = (await pool.query<{ id: string }>(
        `insert into conversations (tenant_id, wa_id, contact_id) values ($1, $2, $3) returning id`, [ici, tel.slice(1), contactId],
      )).rows[0]!.id;
      await pool.query(`insert into conversation_messages (conversation_id, direction, type, body) values ($1, 'in', 'text', 'bonjour')`, [conv]);
    }
    if (o.livreAvant === 'campagne') {
      const avant = await repo.insertCampaign({
        tenantId: ici, phoneNumberId: 'pn-itest-sw', name: 'Shopify · commande payée · #0', category: 'utility',
        templateName: 't', templateLanguage: 'fr', paramMapping: [],
      });
      await repo.insertRecipients(avant, [{ contactId, toE164: tel, resolvedParams: [] }]);
      const livre = `wamid.itest-sw-livre-${randomUUID()}`;
      await pool.query(`update campaign_recipients set status = 'sent', message_id = $2 where campaign_id = $1`, [avant, livre]);
      await destinataires.updateDeliveryByMessageId(livre, 'delivered', null, null, null);
    }
    if (o.livreAvant === 'conversation') {
      const conv = (await pool.query<{ id: string }>(
        `insert into conversations (tenant_id, wa_id, contact_id) values ($1, $2, $3) returning id`, [ici, tel.slice(1), contactId],
      )).rows[0]!.id;
      await pool.query(
        `insert into conversation_messages (conversation_id, direction, type, body, statut) values ($1, 'out', 'text', 'votre commande', 'read')`, [conv],
      );
    }
    if (o.supprimee) await pool.query('update contacts set deleted_at = now() where id = $1', [contactId]);
    return { wamid, contactId };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    contacts = new PgContactStore(pool);
    repo = new PgCampaignRepo(pool);
    destinataires = new PgRecipientStore(pool);
    ici = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-sans-whatsapp') returning id`)).rows[0]!.id;
    ailleurs = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-sans-whatsapp-autre') returning id`)).rows[0]!.id;
  });

  afterAll(async () => {
    for (const t of [ici, ailleurs]) {
      if (!t) continue;
      await pool.query('delete from campaign_recipients where campaign_id in (select id from campaigns where tenant_id = $1)', [t]);
      await pool.query('delete from campaign_etages where campaign_id in (select id from campaigns where tenant_id = $1)', [t]);
      await pool.query('delete from campaigns where tenant_id = $1', [t]);
      await pool.query('delete from conversations where tenant_id = $1', [t]);
      await pool.query('delete from contacts where tenant_id = $1', [t]);
      await pool.query('delete from tenants where id = $1', [t]);
    }
    await pool.end();
  });

  it('🔴 la marque : posée par une INSERTION qui la demande, jamais sur une fiche retrouvée, jamais sans la demande', async () => {
    const id = (c: CreationFiche): string => { if (c === 'conflit') throw new Error('conflit inattendu'); return c.id; };
    const neuve = await contacts.creerFicheApi(ici, { phoneE164: telephone() }, { neeDe: 'shopify' });
    expect(neuve).toMatchObject({ created: true });
    expect(await neeDe(id(neuve))).toBe('shopify');
    // Une création sans la demande (l'API publique, Claude) : aucune marque.
    const tel = telephone();
    const sansMarque = await contacts.creerFicheApi(ici, { phoneE164: tel });
    expect(await neeDe(id(sansMarque))).toBeNull();
    // La même fiche retrouvée par un envoi Shopify : ni créée, ni marquée après coup.
    expect(await contacts.creerFicheApi(ici, { phoneE164: tel }, { neeDe: 'shopify' })).toMatchObject({ id: id(sansMarque), created: false });
    expect(await neeDe(id(sansMarque))).toBeNull();
  });

  it('🔴 la fiche née d’un envoi Shopify, en échec 131026, sans relance ni repli, jamais écrite : rendue, DANS son espace', async () => {
    const c = await cas();
    expect(await destinataires.ficheNeeDeShopifySansWhatsapp(c.wamid)).toEqual({ tenantId: ici, contactId: c.contactId });
  });

  it('🔴 chaque garde garde la fiche', async () => {
    const gardees = {
      'non marquée (importée, saisie, née d’un entrant)': await cas({ marquee: false }),
      'un autre code d’échec (131049)': await cas({ code: 131049 }),
      'livrée': await cas({ statut: 'delivered' }),
      'sortie « En cas d’échec » prise, ou injoignable déjà traité (relances = 2)': await cas({ relances: 2 }),
      'un étage de repli': await cas({ repli: true }),
      'une activité (message reçu ou clic)': await cas({ activite: true }),
      'un message entrant encore conservé': await cas({ entrant: true }),
      'un message déjà livré sur une autre ligne de campagne': await cas({ livreAvant: 'campagne' }),
      'un message sortant déjà lu dans la conversation': await cas({ livreAvant: 'conversation' }),
      'déjà supprimée': await cas({ supprimee: true }),
      'un message inconnu': { wamid: 'wamid.itest-sw-inconnu', contactId: '' },
    };
    for (const [garde, c] of Object.entries(gardees)) {
      expect(await destinataires.ficheNeeDeShopifySansWhatsapp(c.wamid), garde).toBeNull();
    }
    // Une relance déjà faite (1) n'est pas une garde : le second échec supprime aussi.
    const relancee = await cas({ relances: 1 });
    expect(await destinataires.ficheNeeDeShopifySansWhatsapp(relancee.wamid)).toEqual({ tenantId: ici, contactId: relancee.contactId });
  });

  it('🔴 le job de bout en bout : la fiche est purgée (anonymisée), un rejeu ne trouve plus rien', async () => {
    const c = await cas();
    const retraits: string[] = [];
    const deps = {
      ficheASupprimer: (m: string) => destinataires.ficheNeeDeShopifySansWhatsapp(m),
      contacts,
      listeDeLAgent: { oublierChezMeta: async (t: string) => { retraits.push(t); } },
    };
    await traiterSansWhatsapp(deps, { messageId: c.wamid });
    const apres = (await pool.query<{ anonymized_at: Date | null; deleted_at: Date | null; phone_e164: string | null }>(
      'select anonymized_at, deleted_at, phone_e164 from contacts where id = $1', [c.contactId],
    )).rows[0]!;
    expect(apres.anonymized_at).not.toBeNull();
    expect(apres.deleted_at).not.toBeNull();
    expect(apres.phone_e164?.startsWith('+')).not.toBe(true);
    expect(retraits).toEqual([ici]);
    // Le rejeu (pg-boss) relit la garde : la ligne de campagne est anonymisée, la fiche effacée, rien de plus n'est fait.
    expect(await destinataires.ficheNeeDeShopifySansWhatsapp(c.wamid)).toBeNull();
    await traiterSansWhatsapp(deps, { messageId: c.wamid });
    expect(retraits).toEqual([ici]);
  });
});
