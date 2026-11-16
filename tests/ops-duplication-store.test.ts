import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { PgDuplicationStore } from '../src/ops/duplication/store.pg';
import { planifierDuplication, type EtatDuplication } from '../src/ops/duplication/plan';

/**
 * L'ÉCRITURE D'UNE DUPLICATION TIENT EN UNE TRANSACTION (lot 1, tâche 4 du plan
 * `docs/superpowers/plans/2026-11-16-duplication-scenario-lot-1.md`).
 *
 * Ce que ce test tient, sans base : `ecrire` ouvre UNE transaction, toutes ses requêtes passent par le client qui la tient
 * (jamais par le pool, qui gèlerait sous le verrou de nom), elle se termine par `commit`, ou par `rollback` sur une erreur,
 * et le client est toujours rendu. Le SQL lui-même est prouvé sur Postgres (`tests/integration/ops-duplication.integration.test.ts`).
 *
 * Le faux client est une CLASSE dont la méthode lit `this` : un store qui détacherait `query` de son objet échouerait ici.
 */

class FauxClient {
  journal: string[] = [];
  rendu = 0;
  constructor(private readonly echecSur: RegExp | null) {}
  async query(sql: string): Promise<{ rows: unknown[]; rowCount: number }> {
    this.journal.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
    if (this.echecSur?.test(sql)) throw new Error('panne provoquée');
    if (/^select public_code/.test(sql)) return { rows: [{ public_code: 'dst02' }], rowCount: 1 };
    if (/^insert into workflows/.test(sql)) return { rows: [{ id: 'wf-copie' }], rowCount: 1 };
    if (/^\s*insert into automations/.test(sql)) return { rows: [{ id: 'auto-copie' }], rowCount: 1 };
    if (/^insert into user_fields/.test(sql)) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
  release(): void { this.rendu += 1; }
}

function monter(echecSur: RegExp | null) {
  const client = new FauxClient(echecSur);
  const parLePool: string[] = [];
  const pool = {
    connect: async () => client,
    query: async (sql: string) => { parLePool.push(sql); return { rows: [], rowCount: 0 }; },
  } as unknown as Pool;
  return { store: new PgDuplicationStore(pool), client, parLePool };
}

const etat: EtatDuplication = {
  source: { id: 'src', nom: 'Source' },
  destination: { id: 'dst', nom: 'Destination', codeClient: 'dst02' },
  scenario: { id: 'wf', nom: 'Accueil', graphe: { nodes: [{ id: 'q1', type: 'question', position: { x: 0, y: 0 }, data: { body: 'Ville ?', champReponse: 'ville' } }], edges: [] } },
  automationsDuScenario: [{
    id: 'a', tenantId: 'src', name: 'Accueil', enabled: true, triggerKind: 'tag_added', triggerConfig: { tag: 'vip' }, conditionGroup: null,
    workflowId: 'wf', startNodeId: null, possedePar: null, cooldownSeconds: null, maxFiresPerHour: null, accordMarketing: null,
  }],
  automationsDeLaDestination: [],
  champsSource: [{ key: 'ville', label: 'Ville', type: 'text' }],
  champsDestination: [],
  nomsPrisDestination: [],
  templatesDestination: [],
  offreOuvreScenarios: true,
};

describe('PgDuplicationStore.ecrire', () => {
  it('une transaction sur le client : verrou de nom, champ, scénario, déclencheur, commit ; rien par le pool', async () => {
    const { store, client, parLePool } = monter(null);
    const r = await store.ecrire('dst', 'Accueil', planifierDuplication(etat));
    expect(r).toEqual({ scenarioId: 'wf-copie', nom: 'Accueil (copie)', champsCrees: ['ville'], declencheursCopies: 1 });
    expect(client.journal[0]).toBe('begin');
    expect(client.journal.at(-1)).toBe('commit');
    expect(client.journal.some((q) => q.startsWith('select pg_advisory_xact_lock'))).toBe(true);
    expect(client.journal.filter((q) => q.startsWith('insert into'))).toEqual(['insert into user_fields', 'insert into workflows', 'insert into automations']);
    expect(parLePool).toEqual([]);
    expect(client.rendu).toBe(1);
  });

  it('une panne en route : rollback, aucun commit, client rendu, erreur propagée', async () => {
    const { store, client } = monter(/insert into automations/);
    await expect(store.ecrire('dst', 'Accueil', planifierDuplication(etat))).rejects.toThrow('panne provoquée');
    expect(client.journal).toContain('rollback');
    expect(client.journal).not.toContain('commit');
    expect(client.rendu).toBe(1);
  });
});
