import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowStore } from '../../src/workflow/store.pg';
import { PgWebhookStore } from '../../src/webhook-entrant/store.pg';
import type { WorkflowGraph } from '../../src/workflow/graph';

const url = process.env.DATABASE_URL ?? '';

/**
 * LE RAYON DES SCÉNARIOS EN BASE (menu « Scénario », lot 1, migration 0293). Ce qui doit être prouvé est dans le SQL :
 * un scénario Shopify n'existe pour aucune liste ni résolution du Builder, deux rayons peuvent porter le même nom, et
 * la relecture par identifiant les voit tous.
 *
 * Jamais joué en local (le DATABASE_URL local pointe l'ancienne production), joué par le job `integration`.
 */
describe.skipIf(!url)('rayon des scénarios (Postgres)', () => {
  let pool: Pool;
  let store: PgWorkflowStore;
  let tenantId: string;
  let general: { id: string; code: string };
  let shopify: { id: string; code: string };

  const graphe: WorkflowGraph = {
    nodes: [{ id: 'n1', type: 'tag', position: { x: 0, y: 0 }, data: { tag: 'x' } }],
    edges: [],
  };

  const code = async (id: string): Promise<string> =>
    (await pool.query<{ code: string }>('select code from workflows where id = $1', [id])).rows[0]!.code;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    store = new PgWorkflowStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-rayon') returning id`)).rows[0]!.id;
    const g = await store.insert(tenantId, 'Panier abandonné', graphe, 'general');
    const s = await store.insert(tenantId, 'Panier abandonné', graphe, 'shopify');
    await store.publish(g.id, tenantId);
    await store.publish(s.id, tenantId);
    general = { id: g.id, code: await code(g.id) };
    shopify = { id: s.id, code: await code(s.id) };
  });

  afterAll(async () => {
    if (tenantId) await pool.query('delete from tenants where id = $1', [tenantId]);
    await pool.end();
  });

  it('une ligne créée sans rayon (l’ancien code) est `general`', async () => {
    const r = await pool.query<{ rayon: string }>(
      `insert into workflows (tenant_id, name, draft_graph) values ($1, 'ancien', '{"nodes":[],"edges":[]}'::jsonb) returning rayon`,
      [tenantId],
    );
    expect(r.rows[0]!.rayon).toBe('general');
  });

  it('les listes du Builder n’ont pas le scénario Shopify, celles du rayon Shopify n’ont que lui', async () => {
    const ids = (l: Array<{ id: string }>) => l.map((w) => w.id);
    expect(ids(await store.listResume(tenantId, 'general'))).toContain(general.id);
    expect(ids(await store.listResume(tenantId, 'general'))).not.toContain(shopify.id);
    expect(ids(await store.list(tenantId, 'general'))).not.toContain(shopify.id);
    expect(ids(await store.listNoms(tenantId, 'general'))).not.toContain(shopify.id);
    expect(ids(await store.listResume(tenantId, 'shopify'))).toEqual([shopify.id]);
    expect((await store.listPublies(tenantId, 'general')).map((p) => p.code)).not.toContain(shopify.code);
  });

  it('🔴 l’API publique résout le scénario Shopify comme un inconnu, par code comme par identifiant', async () => {
    expect(await store.lireParApi(tenantId, shopify.code)).toBeNull();
    expect(await store.lireParApi(tenantId, shopify.id)).toBeNull();
    expect((await store.lireParApi(tenantId, general.code))?.id).toBe(general.id);
    expect(await store.supprimerParApi(shopify.id, tenantId)).toBe('inconnu');
  });

  it('deux rayons portent le même nom ; l’API en crée un troisième du même nom ? non : le Builder en a déjà un', async () => {
    expect(await store.creerPublieParApi(tenantId, 'panier abandonné ', graphe)).toEqual({ nomPris: general.id });
  });

  it('la relecture par identifiant voit les deux rayons, avec leur rayon', async () => {
    expect((await store.getById(shopify.id, tenantId))?.rayon).toBe('shopify');
    expect((await store.getById(general.id, tenantId))?.rayon).toBe('general');
  });

  it('🔴 un webhook entrant ne vise que le Builder : un scénario Shopify de l’espace y est un inconnu', async () => {
    const webhooks = new PgWebhookStore(pool);
    const base = { enabled: false, mapping: [], createContact: true, optIn: true, startNodeId: null, cooldownSeconds: null };
    expect((await webhooks.create(tenantId, { ...base, name: 'vers Shopify', workflowId: shopify.id })).kind).toBe('scenario_inconnu');
    expect((await webhooks.create(tenantId, { ...base, name: 'vers le Builder', workflowId: general.id })).kind).toBe('cree');
  });

  it('le CHECK refuse un rayon inconnu', async () => {
    await expect(pool.query(`update workflows set rayon = 'brevo' where id = $1`, [general.id])).rejects.toThrow(/workflows_rayon_chk/);
  });
});
