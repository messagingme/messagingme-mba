import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0267 : la marque d'origine d'un scénario (plan `docs/superpowers/plans/2026-11-02-scenarios-api.md`, tâche 1). L'API
 * ne remplace et ne supprime que les scénarios qu'elle a créés. Elle AJOUTE une colonne à défaut constant : l'ancien code
 * y survit (il ne la nomme pas), donc elle passe AVANT le code qui l'écrit.
 */
const lire = (chemin: string): string => readFileSync(new URL(chemin, import.meta.url), 'utf8');
const SQL = lire('../db/migrations/0267_scenario_origine.sql');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');

describe('migration 0267', () => {
  it('🔴 le plafond d’attente du verrou vient en tête, dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('🔴 la colonne : non nulle, défaut constant `console`, CHECK sous son nom, rien d’autre', () => {
    // Un défaut constant n'oblige pas à réécrire la table ; un scénario existant devient `console`, donc intouchable
    // par l'API. Le CHECK porte son nom : un `drop constraint` futur ne le devinera pas.
    expect(instructions.slice(1)).toEqual([
      "alter table workflows add column if not exists origine text not null default 'console' "
        + "constraint workflows_origine_chk check (origine in ('console', 'api'))",
    ]);
  });
});
