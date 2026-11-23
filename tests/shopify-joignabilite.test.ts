import { describe, it, expect } from 'vitest';
import type { PoolClient } from 'pg';
import { effacerJoignabiliteDuBranchement } from '../src/shopify/joignabilite.pg';

/**
 * LA JOIGNABILITÉ PART AVEC LE BRANCHEMENT, derrière un point de reprise (segments Shopify enrichis, lot 2b). Sur une base
 * sans ses tables (la migration 0310 n'est pas bloquante), l'échec n'annule que ces deux instructions : sans le point de
 * reprise, Postgres refuserait tout le reste de la transaction (`25P02`), donc `shop/redact` et la désinstallation
 * entiers. La sémantique réelle se prouve sur Postgres : `tests/integration/joignabilite-shopify.integration.test.ts`.
 */
class FauxClient {
  requetes: string[] = [];
  constructor(private readonly echoue: RegExp | null = null) {}
  async query(sql: string): Promise<{ rows: never[]; rowCount: number }> {
    this.requetes.push(sql.split(' where ')[0]!);
    if (this.echoue?.test(sql)) throw new Error('relation "shopify_envois" does not exist');
    return { rows: [], rowCount: 0 };
  }
}

describe('l’effacement de la joignabilité avec le branchement', () => {
  it('efface les deux tables de l’espace derrière son point de reprise, puis le relâche', async () => {
    const c = new FauxClient();
    await effacerJoignabiliteDuBranchement(c as unknown as PoolClient, 't');
    expect(c.requetes).toEqual([
      'savepoint joignabilite', 'delete from shopify_envois', 'delete from shopify_joignabilite', 'release savepoint joignabilite',
    ]);
  });

  it('🔴 une table absente revient au point de reprise SANS lever : l’effacement du reste du branchement continue', async () => {
    const c = new FauxClient(/shopify_envois/);
    await expect(effacerJoignabiliteDuBranchement(c as unknown as PoolClient, 't')).resolves.toBeUndefined();
    expect(c.requetes).toEqual(['savepoint joignabilite', 'delete from shopify_envois', 'rollback to savepoint joignabilite']);
  });
});
