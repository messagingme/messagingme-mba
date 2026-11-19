import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgCampaignRepo, PgRecipientStore } from '../../src/campaign/store.pg';
import type { ParcoursEvenementDeCampagne } from '../../src/campaign/parcours-evenement';

/**
 * LE PONT DU PARCOURS D'ÉVÉNEMENT contre une VRAIE base (menu « Scénario », lot 4, migration 0297,
 * `campaigns.parcours_evenement`). Seul un aller-retour prouve que l'insertion ÉCRIT la colonne et que `getCampaign`, la
 * lecture du job de run, la RELIT : sans elle, le moteur enverrait le template sans payloads et aucun parcours ne naîtrait.
 */
const url = process.env.DATABASE_URL ?? '';

describe.skipIf(!url)('campaigns.parcours_evenement : écrite à la création, relue par getCampaign', () => {
  let pool: Pool;
  let repo: PgCampaignRepo;
  let tenantId: string;
  let workflowId: string;
  const PONT: ParcoursEvenementDeCampagne = {
    workflowId: '', noeudId: 'tpl', type: 'evenement_shopify', origine: 'shopify:b:checkouts/create:7',
    boutons: [{ type: 'QUICK_REPLY', text: 'Reprendre' }],
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    repo = new PgCampaignRepo(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-campagne-parcours') returning id`)).rows[0]!.id;
    workflowId = (await pool.query<{ id: string }>(
      `insert into workflows (tenant_id, name, graph, rayon) values ($1, 'itest', '{"nodes":[],"edges":[]}'::jsonb, 'shopify') returning id`, [tenantId],
    )).rows[0]!.id;
    PONT.workflowId = workflowId;
  });

  afterAll(async () => {
    await pool.query(`delete from tenants where id = $1`, [tenantId]);
    await pool.end();
  });

  const base = () => ({
    tenantId, phoneNumberId: 'pn-itest', name: 'itest pont', category: 'utility' as const,
    templateName: 'panier_relance', templateLanguage: 'fr', paramMapping: [],
  });

  it('🔴 une campagne template porteuse du pont : écrite, puis relue telle quelle', async () => {
    const id = await repo.insertCampaign({ ...base(), parcoursEvenement: PONT });
    expect((await repo.getCampaign(id))?.parcoursEvenement).toEqual(PONT);
  });

  it('une campagne template ordinaire : null, elle envoie comme avant', async () => {
    const id = await repo.insertCampaign(base());
    expect((await repo.getCampaign(id))?.parcoursEvenement).toBeNull();
  });

  it('🔴 lot 5 : une campagne RCS n’écrit jamais la colonne, même si on la lui passe (le moteur ne la lit jamais pour le RCS)', async () => {
    const id = await repo.insertCampaign({
      ...base(), channel: 'rcs', rcsAgentId: 'agent-itest', rcsMessage: { text: 'Bonjour' }, parcoursEvenement: PONT,
    });
    const brut = await pool.query<{ parcours_evenement: unknown }>(`select parcours_evenement from campaigns where id = $1`, [id]);
    expect(brut.rows[0]?.parcours_evenement).toBeNull();
  });

  it('🔴 une campagne à scénario n’écrit jamais la colonne, même si on la lui passe', async () => {
    const id = await repo.insertCampaign({ ...base(), workflowId, parcoursEvenement: PONT });
    const brut = await pool.query<{ parcours_evenement: unknown }>(`select parcours_evenement from campaigns where id = $1`, [id]);
    expect(brut.rows[0]?.parcours_evenement).toBeNull();
  });

  it('🔴 lot 5 (relecture de 5a) : la raison du parcours non né n’efface pas le code d’un accusé failed reçu pendant la naissance', async () => {
    // Le moteur écrit le destinataire `sent`, puis demande le parcours ; un 131026 traité entre les deux doit rester dans la
    // relance automatique, la raison écrite après coup comprise.
    const store = new PgRecipientStore(pool);
    await pool.query(
      `insert into tenant_settings (tenant_id, auto_retry_enabled) values ($1, true)
       on conflict (tenant_id) do update set auto_retry_enabled = true`, [tenantId],
    );
    const contactId = (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164, opt_in_status) values ($1, '+33600005055', 'opted_in') returning id`, [tenantId],
    )).rows[0]!.id;
    const cid = await repo.insertCampaign({ ...base(), parcoursEvenement: PONT });
    await repo.insertRecipients(cid, [{ contactId, toE164: '+33600005055', resolvedParams: [] }]);
    const rid = (await pool.query<{ id: string }>(`select id from campaign_recipients where campaign_id = $1`, [cid])).rows[0]!.id;
    await store.markResult(rid, { status: 'sent', messageId: 'wamid.pont', sentAt: Date.now() });
    await store.updateDeliveryByMessageId('wamid.pont', 'failed', 'Message undeliverable', 131026, null);
    expect((await repo.listRetry131026()).map((r) => r.id)).toContain(rid);
    await store.noterRaison(rid, 'Parcours non né : place prise');
    expect((await repo.listRetry131026()).map((r) => r.id)).toContain(rid);
    const ligne = (await pool.query<{ status: string; error_code: number | null; error: string | null }>(
      `select status, error_code, error from campaign_recipients where id = $1`, [rid],
    )).rows[0]!;
    expect(ligne).toEqual({ status: 'sent', error_code: 131026, error: 'Parcours non né : place prise' });
  });
});
