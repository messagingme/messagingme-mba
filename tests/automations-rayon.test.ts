import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { PgAutomationStore } from '../src/automation/store.pg';

/**
 * 🔴 LE RAYON DES AUTOMATIONS (menu « Scénario », lot 1, migration 0293). L'écran Automation (« Autres ») ne liste que
 * le rayon qu'on lui demande ; le MOTEUR (`listEnabled`, chaque message entrant) sert toutes les automations allumées,
 * tous rayons ; le rayon s'écrit à la création et jamais après.
 */

interface Requete { sql: string; params: unknown[] }

function banc(rayon: string = 'general') {
  const requetes: Requete[] = [];
  const ligne = {
    id: 'a1', tenant_id: 't1', name: 'A', enabled: true, trigger_kind: 'keyword', trigger_config: { keywords: ['x'] },
    condition_group: null, workflow_id: 'w1', start_node_id: null, cooldown_seconds: null, max_fires_per_hour: null,
    possede_par: null, accord_marketing_par: null, accord_marketing_email: null, accord_marketing_le: null, rayon,
  };
  const query = async (sql: string, params: unknown[] = []) => {
    requetes.push({ sql: sql.replace(/\s+/g, ' '), params });
    return { rows: [ligne], rowCount: 1 };
  };
  return { requetes, store: new PgAutomationStore({ query } as unknown as Pool) };
}

const ENTREE = {
  name: 'A', triggerKind: 'keyword' as const, triggerConfig: { keywords: ['x'] }, conditionGroup: null, workflowId: 'w1',
  startNodeId: null, cooldownSeconds: null, enabled: false,
};

describe('🔴 le rayon des automations', () => {
  it('list : filtre le rayon demandé, passé en paramètre', async () => {
    const { requetes, store } = banc();
    await store.list('t1', 'hubspot');
    expect(requetes[0]?.sql).toMatch(/\brayon = \$2\b/);
    expect(requetes[0]?.params).toEqual(['t1', 'hubspot']);
  });

  it('listEnabled (le moteur) ne filtre AUCUN rayon : une automation Shopify allumée doit partir', async () => {
    const { requetes, store } = banc('shopify');
    const lues = await store.listEnabled('t1', ['keyword']);
    expect(requetes[0]?.sql).not.toMatch(/\brayon =/);
    expect(lues.map((a) => a.rayon)).toEqual(['shopify']);
  });

  it('create écrit le rayon de l’entrée', async () => {
    const { requetes, store } = banc();
    await store.create('t1', { ...ENTREE, rayon: 'shopify' });
    const insertion = requetes.find((q) => q.sql.startsWith('insert into automations'));
    expect(insertion?.sql).toMatch(/\brayon\b/);
    expect(insertion?.params).toContain('shopify');
  });

  it('update n’écrit jamais le rayon, même glissé dans le patch', async () => {
    const { requetes, store } = banc();
    await store.update('a1', 't1', { name: 'B', ...({ rayon: 'shopify' } as object) });
    const maj = requetes.find((q) => q.sql.startsWith('update automations'));
    expect(maj?.sql).not.toMatch(/\brayon\b/);
    expect(maj?.params).not.toContain('shopify');
  });

  it('une ligne au rayon illisible est inerte (ignorée), jamais rangée dans un rayon deviné', async () => {
    const { store } = banc('brevo');
    expect(await store.listEnabled('t1', ['keyword'])).toEqual([]);
  });
});
