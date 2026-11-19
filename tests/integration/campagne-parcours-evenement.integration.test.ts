import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgCampaignRepo } from '../../src/campaign/store.pg';
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
});
