import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0295 : un parcours né d'un chemin de masse (menu « Scénario », lot 2, spec décision 24). Le drapeau se fige à la
 * naissance du parcours, comme `accord_marketing_exige` (0272) : réveillé par la sortie « Pas de réponse » d'un template
 * sans que le contact ait répondu, un tel parcours n'émet aucune étiquette et saute en `aller_a_masse`. Elle AJOUTE une
 * colonne que le code neuf écrira et lira : AVANT, poussée SEULE (une colonne nommée par le chemin chaud). L'ancien code
 * ne la nomme pas et le défaut remplit ses insertions.
 */
const SQL = readFileSync(new URL('../db/migrations/0295_run_ne_en_masse.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');

describe('migration 0295', () => {
  it('🔴 le plafond d’attente du verrou vient en tête (workflow_runs est chaude), dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('une seule colonne, non nulle, au défaut constant FAUX : les parcours en cours gardent le comportement d’avant', () => {
    expect(instructions.slice(1)).toEqual([
      'alter table workflow_runs add column if not exists ne_en_masse boolean not null default false',
    ]);
  });
});
