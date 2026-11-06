import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 0282 : ce qu'une application connectée crée (clé d'API, adresse de webhook) reste rattaché à son autorisation OAuth,
 * que sa révocation par un admin coupe (lot D de l'audit). Elle passe AVANT le code, seule : le code neuf nomme les
 * colonnes sur des chemins chauds (insertion des clés, relais compris, listes, `/v1/webhooks`). Ce qui se vérifie sans
 * base : sa forme. Son exécution réelle : `tests/integration/creations-oauth.integration.test.ts`.
 */
const sql = readFileSync(new URL('../db/migrations/0282_creations_oauth.sql', import.meta.url), 'utf8');
const code = sql.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim();

describe('migration 0282', () => {
  it('🔴 le délai d’attente d’un verrou en tête : api_keys est lue à chaque appel de /v1 et de /mcp', () => {
    expect(code.startsWith("set local lock_timeout = '5s';")).toBe(true);
  });

  it('🔴 deux colonnes nullables, sans défaut, dont la purge d’une autorisation remet le lien à vide (set null, pas cascade)', () => {
    // Une cascade effacerait la clé d'un client avec l'autorisation qui l'a créée : la décision du 2026-11-06 la garde
    // vivante à toute autre fin que la révocation par un admin.
    expect(code).toContain('alter table api_keys add column if not exists oauth_autorisation_id uuid references oauth_autorisations (id) on delete set null;');
    expect(code).toContain('alter table adresses_evenements add column if not exists oauth_autorisation_id uuid references oauth_autorisations (id) on delete set null;');
    const colonnes = code.split(';').filter((i) => i.includes('add column'));
    expect(colonnes).toHaveLength(2);
    for (const c of colonnes) expect(c).not.toMatch(/not null|default/);
  });

  it('les index partiels servent la révocation et l’action de la clé étrangère (« = $1 » implique « non nul »)', () => {
    expect(code).toContain('create index if not exists api_keys_oauth_autorisation_idx on api_keys (oauth_autorisation_id) where oauth_autorisation_id is not null;');
    expect(code).toContain('create index if not exists adresses_evenements_oauth_autorisation_idx on adresses_evenements (oauth_autorisation_id) where oauth_autorisation_id is not null;');
  });

  it('transactionnelle, sans CONCURRENTLY (deux petites tables), sans reprise de données, sans accent grave', () => {
    expect(sql).not.toMatch(/migrate: no-transaction/);
    expect(code).not.toMatch(/concurrently/i);
    expect(code).not.toMatch(/\bupdate \w+ set\b|\binsert into\b|\bdelete from\b/i);
    expect(sql).not.toContain('`');
  });
});
