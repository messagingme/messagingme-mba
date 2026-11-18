import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0297 et 0298 : le parcours d'événement (menu « Scénario », lot 4, spec décisions 21, 28 et 29). 0297 AJOUTE deux
 * colonnes nullables que le code neuf lira sur le chemin chaud : AVANT, poussée SEULE ; l'ancien code ne les nomme pas.
 * 0298 pose l'index unique qui garantit UNE place d'événement active par contact, hors transaction ; son prédicat est un
 * contrat avec `parcoursDEvenementActif` du magasin des parcours, qui le reprend mot pour mot.
 */
const lire = (nom: string): string => readFileSync(new URL(`../db/migrations/${nom}`, import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructionsDe = (sql: string): string[] =>
  decouperInstructions(sql)
    .map(sansCommentaires)
    .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
    .filter((i) => i !== '');

const SQL_0297 = lire('0297_parcours_evenement.sql');
const SQL_0298 = lire('0298_parcours_evenement_unique.sql');

describe('migration 0297', () => {
  it('🔴 le plafond d’attente du verrou vient en tête (deux tables chaudes), dans une transaction', () => {
    expect(instructionsDe(SQL_0297)[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL_0297)).toBe(false);
  });

  it('deux colonnes jsonb nullables, SANS défaut : métadonnée seule, toutes les lignes existantes restent ordinaires', () => {
    expect(instructionsDe(SQL_0297).slice(1)).toEqual([
      'alter table workflow_runs add column if not exists evenement jsonb',
      'alter table campaigns add column if not exists parcours_evenement jsonb',
    ]);
  });
});

describe('migration 0298', () => {
  it('🔴 hors transaction : CREATE INDEX CONCURRENTLY ne pose aucun verrou d’écriture sur workflow_runs', () => {
    expect(veutHorsTransaction(SQL_0298)).toBe(true);
  });

  it('🔴 un seul index UNIQUE, partiel, au prédicat exact d’une place d’événement active (décision 21)', () => {
    expect(instructionsDe(SQL_0298)).toEqual([
      "create unique index concurrently if not exists workflow_runs_evenement_actif_uniq on workflow_runs (tenant_id, wa_id) where evenement is not null and status in ('waiting', 'sleeping')",
    ]);
  });
});
