import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { PgOffresStore } from '../src/offres/offre.pg';
import { ficheActive } from '../src/crm/contact-store.pg';

/**
 * L'USAGE DE LA VUE DE L'OFFRE COMPTE LES CONTACTS COMME LA LIMITE LES COMPTE (décisions de Julien du 2026-10-25 et du
 * 2026-11-25) : ce que voient la console et `get_plan`, et ce que lisent les courriels de franchissement. Toutes les
 * fiches actives, quelle que soit leur origine, dans toutes les offres. Ce que la vraie base compte est dans
 * `tests/integration/offres.integration.test.ts`, en CI.
 */
function pool() {
  const appels: string[] = [];
  const p = {
    query: async (sql: string) => {
      appels.push(sql);
      return { rows: [{ contacts: 100, automations: 2, membres: 1 }], rowCount: 1 };
    },
  };
  return { p: p as unknown as Pool, appels };
}

describe('🔴 l’usage des contacts : toutes les fiches actives, comme la limite', () => {
  it('une seule requête, le prédicat des gardes du magasin des contacts, sans distinguer l’origine (2026-11-25)', async () => {
    const { p, appels } = pool();
    expect(await new PgOffresStore(p).usage('t1')).toEqual({ contacts: 100, automations: 2, membres: 1 });
    expect(appels).toHaveLength(1);
    expect(appels[0]).toContain(ficheActive('c'));
    expect(appels[0]).not.toContain('ne_entrant');
  });

  it('🔴 lot 6 : les automations comptées sont celles de la limite, du rayon général (une ligne HubSpot a son plafond)', async () => {
    const { p, appels } = pool();
    await new PgOffresStore(p).usage('t1');
    expect(appels[0]).toMatch(/a\.enabled and a\.possede_par is null and a\.rayon = 'general'/);
  });
});
