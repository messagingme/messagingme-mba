import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';
import { RAYONS } from '../src/workflow/rayon';

/**
 * 0293 : le rayon d'un scénario et d'une automation (menu « Scénario », lot 1, spec
 * `docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md` § 5.3). Elle AJOUTE deux colonnes à défaut
 * constant que le code neuf lit dans chaque liste de scénarios : AVANT le `up`. L'ancien code ne les lit pas et
 * n'écrit jamais de rayon : la base pose `general`, il y survit.
 */
const lire = (chemin: string): string => readFileSync(new URL(chemin, import.meta.url), 'utf8');
const SQL = lire('../db/migrations/0293_rayons.sql');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');

describe('migration 0293', () => {
  it('🔴 le plafond d’attente du verrou vient en tête, et tout tient dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  for (const table of ['workflows', 'automations'] as const) {
    describe(table, () => {
      it('une colonne `rayon` non nulle, au défaut constant `general` (aucune réécriture de la table)', () => {
        expect(instructions).toContain(`alter table ${table} add column if not exists rayon text not null default 'general'`);
      });

      it('🔴 un CHECK sous son nom, retiré puis posé (rejouable), dont les valeurs sont exactement `RAYONS`', () => {
        const i = instructions.indexOf(`alter table ${table} drop constraint if exists ${table}_rayon_chk`);
        expect(i, 'le retrait sous le même nom précède la pose').toBeGreaterThan(-1);
        const pose = instructions[i + 1] ?? '';
        expect(pose.startsWith(`alter table ${table} add constraint ${table}_rayon_chk check (rayon in (`)).toBe(true);
        const valeurs = [...pose.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
        expect([...valeurs].sort()).toEqual([...RAYONS].sort());
      });
    });
  }
});
