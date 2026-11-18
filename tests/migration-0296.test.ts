import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';
import { ETATS_MODELE_DE_BLOC } from '../src/workflow/modeles-de-bloc';

/**
 * 0296 : les templates écrits depuis un bloc du constructeur, et la publication programmée (menu « Scénario », lot 3,
 * spec décisions 18, 19 et 27). Elle AJOUTE une table et trois colonnes que le code neuf écrira : AVANT, poussée SEULE.
 * L'ancien code ne les nomme pas et y survit.
 */
const SQL = readFileSync(new URL('../db/migrations/0296_modeles_de_bloc.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');
const table = instructions.find((i) => i.startsWith('create table if not exists modeles_de_bloc (')) ?? '';

describe('migration 0296', () => {
  it('🔴 le plafond d’attente du verrou vient en tête (workflows est chaude), dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('la table des templates de bloc : un template de Meta (espace, nom, langue) par ligne, effacée avec son espace et son scénario', () => {
    expect(table).not.toBe('');
    expect(table).toContain('tenant_id uuid not null references tenants(id) on delete cascade');
    expect(table).toContain('workflow_id uuid not null references workflows(id) on delete cascade');
    expect(table).toContain('primary key (tenant_id, modele, langue)');
    expect(table).toContain("etat text not null default 'en_validation'");
  });

  it('🔴 l’état sous un CHECK nommé dont les valeurs sont exactement `ETATS_MODELE_DE_BLOC`', () => {
    const m = /constraint modeles_de_bloc_etat_chk check \(etat in \(([^)]*)\)\)/.exec(table);
    expect(m, 'CHECK nommé de l’état').not.toBeNull();
    const valeurs = [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect([...valeurs].sort()).toEqual([...ETATS_MODELE_DE_BLOC].sort());
  });

  it('la raison d’un refus est bornée à 300 caractères, comme celle des e-mails', () => {
    expect(table).toContain('constraint modeles_de_bloc_raison_chk check (raison is null or char_length(raison) <= 300)');
  });

  it('🔴 l’index du filet porte le prédicat EXACT de sa requête, et la lecture d’un scénario a le sien', () => {
    expect(instructions).toContain(
      "create index if not exists modeles_de_bloc_en_validation_idx on modeles_de_bloc (cree_le) where etat = 'en_validation'",
    );
    expect(instructions).toContain('create index if not exists modeles_de_bloc_scenario_idx on modeles_de_bloc (tenant_id, workflow_id)');
  });

  it('la publication programmée : trois colonnes nulles et sans défaut sur `workflows` (métadonnée seule, aucune réécriture)', () => {
    expect(instructions.slice(-3)).toEqual([
      'alter table workflows add column if not exists programmed_graph jsonb',
      'alter table workflows add column if not exists programmed_at timestamptz',
      'alter table workflows add column if not exists programmed_by uuid',
    ]);
  });
});
