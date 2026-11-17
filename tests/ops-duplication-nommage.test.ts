import { describe, it, expect } from 'vitest';
import { nomLibre, nomOutilLibre } from '../src/ops/duplication/nommage';

/**
 * LES NOMS DES COPIES (duplication entre espaces, lot 2, plan `docs/superpowers/plans/2026-11-17-duplication-scenario-lot-2.md`).
 * Le même nom s'il est libre dans la destination, sinon « (copie) », puis « (copie 2) » ; la comparaison suit l'unicité
 * de la table. Un outil, dont le nom suit `^[a-z0-9_]{1,64}$`, prend `_copie`, puis `_copie_2`, sous 64 caractères.
 */
describe('nomLibre', () => {
  it('libre : le même nom ; pris : « (copie) », puis « (copie 2) »', () => {
    expect(nomLibre('Agent', [], 'insensible')).toBe('Agent');
    expect(nomLibre('Agent', ['Agent'], 'insensible')).toBe('Agent (copie)');
    expect(nomLibre('Agent', ['Agent', 'Agent (copie)'], 'insensible')).toBe('Agent (copie 2)');
  });

  it('la casse compte selon l’unicité de la table', () => {
    expect(nomLibre('agent', ['Agent'], 'insensible')).toBe('agent (copie)');
    expect(nomLibre('agent', ['Agent'], 'sensible')).toBe('agent');
  });

  it('les espaces aux bords ne font pas un nom différent', () => {
    expect(nomLibre('Agent', ['  agent '], 'insensible')).toBe('Agent (copie)');
  });
});

describe('nomOutilLibre', () => {
  it('libre : le même nom ; pris : _copie, puis _copie_2', () => {
    expect(nomOutilLibre('relance_crm', [])).toBe('relance_crm');
    expect(nomOutilLibre('relance_crm', ['relance_crm'])).toBe('relance_crm_copie');
    expect(nomOutilLibre('relance_crm', ['relance_crm', 'relance_crm_copie'])).toBe('relance_crm_copie_2');
  });

  it('un nom de 64 caractères reste sous 64 avec son suffixe, et suit le motif', () => {
    const long = 'a'.repeat(64);
    const r = nomOutilLibre(long, [long]);
    expect(r.length).toBeLessThanOrEqual(64);
    expect(r).toMatch(/^[a-z0-9_]{1,64}$/);
    expect(r.endsWith('_copie')).toBe(true);
  });
});
