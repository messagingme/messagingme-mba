import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgAutomationStore } from '../../src/automation/store.pg';
import { PgWorkflowStore } from '../../src/workflow/store.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LE RAYON DES AUTOMATIONS EN BASE (menu « Scénario », lot 1, migration 0293) : l'écran Automation ne voit que le
 * Builder, et la base refuse un rayon inconnu. Lot 6 : le moteur (et le balayage des dates du worker) ne sert plus que le
 * rayon général, et l'écran ne relit, ne modifie ni ne supprime une automation d'un autre rayon, même par son identifiant.
 *
 * Jamais joué en local (le DATABASE_URL local pointe l'ancienne production), joué par le job `integration`.
 */
describe.skipIf(!url)('rayon des automations (Postgres)', () => {
  let pool: Pool;
  let store: PgAutomationStore;
  let workflows: PgWorkflowStore;
  let tenantId: string;
  let general: string;
  let shopify: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    store = new PgAutomationStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-automations-rayon') returning id`)).rows[0]!.id;
    workflows = new PgWorkflowStore(pool);
    const wfG = (await workflows.insert(tenantId, 'g', { nodes: [], edges: [] }, 'general')).id;
    const wfS = (await workflows.insert(tenantId, 's', { nodes: [], edges: [] }, 'shopify')).id;
    const base = {
      triggerKind: 'keyword' as const, triggerConfig: { keywords: ['rdv'] }, conditionGroup: null, startNodeId: null,
      cooldownSeconds: null, enabled: true,
    };
    general = (await store.create(tenantId, { ...base, name: 'g', workflowId: wfG, rayon: 'general' })).id;
    shopify = (await store.create(tenantId, { ...base, name: 's', workflowId: wfS, rayon: 'shopify' })).id;
  });

  afterAll(async () => {
    if (tenantId) await pool.query('delete from tenants where id = $1', [tenantId]);
    await pool.end();
  });

  it('l’écran Automation (rayon général) n’a pas l’automation Shopify', async () => {
    const ids = (await store.list(tenantId, 'general')).map((a) => a.id);
    expect(ids).toContain(general);
    expect(ids).not.toContain(shopify);
    expect((await store.list(tenantId, 'shopify')).map((a) => a.id)).toEqual([shopify]);
  });

  // ⚠️ Ce cas disait « le moteur sert les deux » jusqu'au lot 6 : une ligne d'automation d'un autre rayon a son circuit.
  it('🔴 lot 6 : le moteur ne sert que le rayon général', async () => {
    const lues = (await store.listEnabled(tenantId, ['keyword'])).map((a) => a.id);
    expect(lues).toContain(general);
    expect(lues).not.toContain(shopify);
  });

  it('🔴 lot 6 : le balayage des dates du worker ne voit que l’espace qui a une date du rayon général', async () => {
    const autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-automations-rayon-date') returning id`)).rows[0]!.id;
    try {
      const wf = (await workflows.insert(autre, 'rdv', { nodes: [], edges: [] }, 'general')).id;
      const date = {
        triggerKind: 'avant_date' as const, triggerConfig: { fieldKey: 'rdv', delai: 1, unite: 'heures' }, conditionGroup: null,
        startNodeId: null, cooldownSeconds: null, enabled: true, workflowId: wf,
      };
      await store.create(autre, { ...date, name: 'rdv hubspot', rayon: 'hubspot' });
      expect(await store.tenantsAvecDeclencheurDate()).not.toContain(autre);
      await store.create(autre, { ...date, name: 'rdv general', rayon: 'general' });
      expect(await store.tenantsAvecDeclencheurDate()).toContain(autre);
    } finally {
      await pool.query('delete from tenants where id = $1', [autre]);
    }
  });

  it('🔴 lot 6 : l’écran ne relit, ne modifie ni ne supprime une automation d’un autre rayon, même par son identifiant', async () => {
    expect(await store.getById(shopify, tenantId, 'general')).toBeNull();
    expect(await store.update(shopify, tenantId, 'general', { name: 'volée' })).toBe(false);
    expect(await store.remove(shopify, tenantId, 'general')).toBe(false);
    expect(await store.getById(shopify, tenantId, 'shopify')).toMatchObject({ name: 's', rayon: 'shopify' });
  });

  it('le CHECK refuse un rayon inconnu', async () => {
    await expect(pool.query(`update automations set rayon = 'brevo' where id = $1`, [general])).rejects.toThrow(/automations_rayon_chk/);
  });
});
