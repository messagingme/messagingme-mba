import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgShopifyStore } from '../../src/shopify/store.pg';

/**
 * Intégration de la RELANCE DE PANIER AVEC AGENT IA (migration 0306, plan 2026-11-20, lot 2) : ce qu'aucun faux ne prouve.
 * L'exclusivité des deux relances du panier EN BASE (deux allumages croisés et simultanés laissent une seule ligne
 * allumée), la réclamation des paniers qui rend le scénario de la ligne ALLUMÉE, et la règle « encore voulu » qui lit
 * l'une ou l'autre relance. Espaces jetables, créés et détruits ici.
 */
const url = process.env.DATABASE_URL ?? '';
const CLE = randomBytes(32).toString('hex');

describe.skipIf(!url)('la relance de panier avec agent IA, en base', () => {
  let pool: Pool;
  let store: PgShopifyStore;
  let T = '';
  let wfNormal = '';
  let wfAgent = '';
  const domaine = `itest-agent-${randomUUID().slice(0, 8)}.myshopify.com`;

  const scenario = async (nom: string): Promise<string> => (await pool.query<{ id: string }>(
    `insert into workflows (tenant_id, name, graph, rayon) values ($1, $2, '{"nodes":[],"edges":[]}'::jsonb, 'shopify') returning id`, [T, nom],
  )).rows[0]!.id;
  const actives = async (): Promise<string[]> => (await store.lignes(T)).filter((l) => l.actif).map((l) => l.evenement).sort();
  const echu = async (jeton: string): Promise<void> => {
    await pool.query(`update shopify_paniers set maj_le = now() - interval '2 days' where tenant_id = $1 and jeton = $2`, [T, jeton]);
    await pool.query(`update shopify_boutiques set paniers_depuis = now() - interval '3 days' where tenant_id = $1`, [T]);
  };
  const miens = async () => (await store.reclamerPaniersDus(50)).filter((p) => p.tenantId === T);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgShopifyStore(pool, CLE);
    T = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-shopify-ligne-agent') returning id`)).rows[0]!.id;
    await store.connecter(T, { domaine, clientId: 'cid', secretClair: 'shpss_itest', nom: null, pays: 'FR', devise: 'EUR', par: null, origine: 'claude_code' });
    wfNormal = await scenario('Panier abandonné');
    wfAgent = await scenario('Panier abandonné avec agent IA');
    await store.poserLigne(T, { evenement: 'checkout_abandoned', workflowId: wfNormal, par: null });
    await store.poserLigne(T, { evenement: 'checkout_abandoned_agent', workflowId: wfAgent, par: null });
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = $1', [T]);
    await pool.end();
  });

  it('🔴 allumer l’une des relances du panier éteint l’autre, dans les deux sens', async () => {
    expect(await store.allumerLigne(T, 'checkout_abandoned', null)).toBe(true);
    expect(await actives()).toEqual(['checkout_abandoned']);
    expect(await store.allumerLigne(T, 'checkout_abandoned_agent', null)).toBe(true);
    expect(await actives()).toEqual(['checkout_abandoned_agent']);
    expect(await store.allumerLigne(T, 'checkout_abandoned', null)).toBe(true);
    expect(await actives()).toEqual(['checkout_abandoned']);
  });

  it('🔴 deux allumages croisés et simultanés laissent UNE seule relance allumée (point de relecture 2)', async () => {
    for (let i = 0; i < 5; i += 1) {
      await store.eteindreLigne(T, 'checkout_abandoned', null);
      await store.eteindreLigne(T, 'checkout_abandoned_agent', null);
      await Promise.all([store.allumerLigne(T, 'checkout_abandoned', null), store.allumerLigne(T, 'checkout_abandoned_agent', null)]);
      expect(await actives(), `essai ${i}`).toHaveLength(1);
    }
  });

  it('🔴 un panier dû se réclame avec le scénario de la relance ALLUMÉE, l’une comme l’autre ; aucune allumée, rien', async () => {
    await store.allumerLigne(T, 'checkout_abandoned_agent', null);
    await store.noterPanier(T, { jeton: 'a1', telephone: '+33600000991', nom: 'Ana', lien: 'https://l' });
    await echu('a1');
    expect((await miens()).map((p) => [p.jeton, p.workflowId])).toEqual([['a1', wfAgent]]);

    await store.allumerLigne(T, 'checkout_abandoned', null);
    await store.noterPanier(T, { jeton: 'n1', telephone: '+33600000992', nom: 'Noé', lien: 'https://l' });
    await echu('n1');
    expect((await miens()).map((p) => [p.jeton, p.workflowId])).toEqual([['n1', wfNormal]]);

    await store.eteindreLigne(T, 'checkout_abandoned', null);
    await store.noterPanier(T, { jeton: 'x1', telephone: '+33600000993', nom: null, lien: 'https://l' });
    await echu('x1');
    expect(await miens()).toEqual([]);
  });

  it('🔴 « encore voulu » : le parcours du panier l’est quand l’UNE des relances est allumée', async () => {
    await store.allumerLigne(T, 'checkout_abandoned_agent', null);
    expect(await store.etatPourParcours(T, domaine, 'checkout_abandoned')).toEqual({ boutique: 'active', ligneActive: true });
    await store.eteindreLigne(T, 'checkout_abandoned_agent', null);
    expect(await store.etatPourParcours(T, domaine, 'checkout_abandoned')).toEqual({ boutique: 'active', ligneActive: false });
    expect(await store.etatPourParcours(T, domaine, 'order_paid')).toEqual({ boutique: 'active', ligneActive: false });
  });
});
