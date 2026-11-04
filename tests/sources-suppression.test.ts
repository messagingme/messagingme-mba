import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { PgSourceStore } from '../src/agent/sources.pg';
import { SourcePorteDesAppels } from '../src/agent/sources';

/**
 * Supprimer un connecteur qui porte encore des appels enregistrés. La contrainte `restrict` de 0105
 * (`connector_requests_source_id_fkey`, nom lu en base de production) le retient : le store la traduit en erreur
 * typée, la route en 409. Sans cette traduction, l'erreur de la base remontait en 500 (SANDBOX, 2026-11-03).
 * Le cas réel, contre Postgres, est dans `tests/integration/agent-sources.integration.test.ts`.
 */
const poolQuiRejette = (err: unknown): Pool => ({ query: async () => { throw err; } }) as unknown as Pool;
const refusDeLaBase = (constraint: string) => Object.assign(new Error('violation de clé étrangère'), { code: '23503', constraint });

describe('PgSourceStore.supprimer', () => {
  it('🔴 les appels qui retiennent la source : erreur typée, donc un 409', async () => {
    const store = new PgSourceStore(poolQuiRejette(refusDeLaBase('connector_requests_source_id_fkey')));
    await expect(store.supprimer('t1', 's1')).rejects.toBeInstanceOf(SourcePorteDesAppels);
  });

  it('une autre clé étrangère reste une panne : rien n’est maquillé en refus lisible', async () => {
    const autre = refusDeLaBase('une_autre_contrainte');
    const store = new PgSourceStore(poolQuiRejette(autre));
    await expect(store.supprimer('t1', 's1')).rejects.toBe(autre);
  });
});
