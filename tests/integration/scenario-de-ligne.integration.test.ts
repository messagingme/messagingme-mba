import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowStore } from '../../src/workflow/store.pg';
import { PgShopifyStore } from '../../src/shopify/store.pg';
import { grapheDUneLigne } from '../../src/shopify/lignes-gestion';

/**
 * LE SCÉNARIO D'UNE LIGNE SHOPIFY NE SE SUPPRIME PAS (menu « Scénario », lot 5, tâche 9), contre une VRAIE base : la clé
 * étrangère de `shopify_lignes` est en `on delete cascade` (0299), une suppression emporterait l'automation en silence.
 * Les utilisations du scénario nomment la ligne, et la route refuse avec elles. ISOLÉ par espaces jetables.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ANCIENNE base de production. La CI monte un
 * Postgres jetable pour ça (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';

describe.skipIf(!url)('le scénario d’une ligne Shopify en base', () => {
  let pool: Pool;
  let scenarios: PgWorkflowStore;
  let shopify: PgShopifyStore;
  let A = '';
  let B = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    scenarios = new PgWorkflowStore(pool);
    shopify = new PgShopifyStore(pool, randomBytes(32).toString('hex'));
    A = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-scenario-ligne-a') returning id`)).rows[0]!.id;
    B = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-scenario-ligne-b') returning id`)).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[A, B]]);
    await pool.end();
  });

  it('🔴 les utilisations du scénario nomment l’automation de sa ligne, dans son espace seulement', async () => {
    const { id } = await scenarios.insert(A, 'Panier abandonné', grapheDUneLigne(), 'shopify');
    expect(await scenarios.utilisationsDuScenario(A, id)).toEqual([]);
    await shopify.poserLigne(A, { evenement: 'checkout_abandoned', workflowId: id, par: null });
    expect(await scenarios.utilisationsDuScenario(A, id)).toEqual(['l’automation Shopify « Panier abandonné »']);
    expect(await scenarios.utilisationsDuScenario(B, id)).toEqual([]);
  });

  it('🔴 le ménage relit si un graphe de l’espace nomme encore un template : publié, brouillon ou programmé, tous rayons', async () => {
    const bloc = (m: string) => ({ nodes: [{ id: 'b', type: 'template' as const, position: { x: 0, y: 0 }, data: { templateName: m, language: 'fr' } }], edges: [] });
    expect(await scenarios.nommeLeModele(A, 'menage_publie')).toBe(false);
    const { id } = await scenarios.insert(A, 'Ménage', bloc('menage_publie'), 'general');
    await scenarios.publish(id, A);
    await scenarios.update(id, A, { graph: bloc('menage_brouillon') });
    const { id: autre } = await scenarios.insert(A, 'Ménage programmé', { nodes: [], edges: [] }, 'shopify');
    await scenarios.publish(autre, A);
    await scenarios.programmer(autre, A, null, bloc(' menage_programme '));
    for (const m of ['menage_publie', 'menage_brouillon', 'menage_programme']) expect(await scenarios.nommeLeModele(A, m), m).toBe(true);
    expect(await scenarios.nommeLeModele(A, 'menage_absent')).toBe(false);
    expect(await scenarios.nommeLeModele(B, 'menage_publie'), 'un autre espace ne voit rien').toBe(false);
  });
});
