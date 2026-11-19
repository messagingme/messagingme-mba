import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0299 et 0300 : les lignes Shopify et la naissance idempotente (menu « Scénario », lot 5, spec décisions 8, 13, 15, 32
 * et 33). 0299 CRÉE `shopify_lignes`, AJOUTE deux colonnes nullables à `shopify_boutiques` que chaque webhook lira, et
 * élargit le CHECK de la source d'une vente (le nom lu en base de production le 2026-11-19) : AVANT, poussée SEULE ;
 * l'ancien code ne nomme rien de neuf. 0300 pose, hors transaction, l'index qui retrouve les parcours d'événement d'un
 * contact quel que soit leur statut ; son prédicat est un contrat avec la requête de la naissance idempotente (lot 5a).
 */
const lire = (nom: string): string => readFileSync(new URL(`../db/migrations/${nom}`, import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructionsDe = (sql: string): string[] =>
  decouperInstructions(sql)
    .map(sansCommentaires)
    .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
    .filter((i) => i !== '');

const SQL_0299 = lire('0299_shopify_lignes.sql');
const SQL_0300 = lire('0300_parcours_evenement_origine.sql');

describe('migration 0299', () => {
  it('🔴 le plafond d’attente du verrou vient en tête (tenants et workflows, verrouillés par les clés), dans une transaction', () => {
    expect(instructionsDe(SQL_0299)[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL_0299)).toBe(false);
  });

  it('🔴 une ligne par événement et par espace, son scénario, son interrupteur ÉTEINT par défaut', () => {
    const table = instructionsDe(SQL_0299).find((i) => i.startsWith('create table if not exists shopify_lignes'));
    expect(table).toBe(
      'create table if not exists shopify_lignes ( tenant_id uuid not null references tenants(id) on delete cascade, '
      + "evenement text not null check (evenement in ('order_paid', 'order_fulfilled', 'checkout_abandoned')), "
      + 'workflow_id uuid not null references workflows(id) on delete cascade, actif boolean not null default false, '
      + 'modifie_par uuid, modifie_le timestamptz not null default now(), primary key (tenant_id, evenement) )',
    );
    expect(instructionsDe(SQL_0299)).toContain('create index if not exists shopify_lignes_workflow_idx on shopify_lignes (workflow_id)');
  });

  it('🔴 la pause et la borne des paniers : deux colonnes nullables, SANS défaut (métadonnée seule)', () => {
    expect(instructionsDe(SQL_0299)).toEqual(expect.arrayContaining([
      'alter table shopify_boutiques add column if not exists pause_le timestamptz',
      'alter table shopify_boutiques add column if not exists paniers_depuis timestamptz',
    ]));
  });

  it('🔴 la source d’une vente : l’ancien CHECK retiré SANS if exists (un nom faux fait échouer), recréé en sur-ensemble', () => {
    const instructions = instructionsDe(SQL_0299);
    const retrait = instructions.indexOf('alter table ventes_attribuees drop constraint ventes_attribuees_source_check');
    const ajout = instructions.indexOf(
      'alter table ventes_attribuees add constraint ventes_attribuees_source_check check (source in '
      + "('campagne', 'relance_panier', 'scenario', 'agent', 'agent_meta', 'commande_payee', 'commande_expediee'))",
    );
    expect(retrait).toBeGreaterThan(0);
    expect(ajout).toBe(retrait + 1);
    expect(SQL_0299).not.toMatch(/drop constraint if exists/i);
    expect(SQL_0299).not.toMatch(/ventes_attribuees_relance_chk/);
  });

  it('rien d’autre : aucune table existante réécrite, aucune ligne touchée', () => {
    expect(instructionsDe(SQL_0299)).toHaveLength(7);
    expect(instructionsDe(SQL_0299).filter((i) => /^(update|delete|insert|truncate)\b/i.test(i))).toEqual([]);
  });
});

describe('migration 0300', () => {
  it('🔴 hors transaction : CREATE INDEX CONCURRENTLY ne pose aucun verrou d’écriture sur workflow_runs', () => {
    expect(veutHorsTransaction(SQL_0300)).toBe(true);
  });

  it('🔴 un seul index, partiel, sur les seuls parcours d’événement, TOUS statuts (la naissance idempotente)', () => {
    expect(instructionsDe(SQL_0300)).toEqual([
      'create index concurrently if not exists workflow_runs_evenement_idx on workflow_runs (tenant_id, wa_id) where evenement is not null',
    ]);
  });
});
