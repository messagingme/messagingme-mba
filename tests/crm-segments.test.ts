import { describe, it, expect } from 'vitest';
import { paysConnu, paysDuNumero, paysPrincipalDe, prefixesDesPays } from '../src/crm/segments';

/** Le pays par l'indicatif (spec du 2026-10-31) : un code ISO devient un préfixe E.164, un numéro dit son pays. */
describe('les pays des segments', () => {
  it('un indicatif partagé ne donne qu’un préfixe', () => {
    expect(prefixesDesPays(['US', 'CA'])).toEqual(['+1']);
    expect(prefixesDesPays(['FR', 'BE', 'FR'])).toEqual(['+33', '+32']);
  });

  it('un code inconnu n’a pas de préfixe', () => {
    expect(paysConnu('XX')).toBe(false);
    expect(paysConnu('UK')).toBe(false);
    expect(paysConnu('fr')).toBe(false);
    expect(paysConnu('GB')).toBe(true);
    expect(prefixesDesPays(['XX'])).toEqual([]);
  });

  it('le pays principal d’un indicatif partagé', () => {
    expect(['US', 'CA', 'PR', 'DO'].map(paysPrincipalDe)).toEqual(['US', 'US', 'US', 'US']);
    expect(['GB', 'JE', 'RU', 'KZ', 'FR', 'BE'].map(paysPrincipalDe)).toEqual(['GB', 'GB', 'RU', 'RU', 'FR', 'BE']);
    expect(paysPrincipalDe('XX')).toBeNull();
  });

  it('un numéro dit son pays, un +1 canadien rend CA', () => {
    expect(paysDuNumero('+32470123456')).toBe('BE');
    expect(paysDuNumero('+14165551234')).toBe('CA');
    expect(paysDuNumero(null)).toBeNull();
    expect(paysDuNumero('pas un numéro')).toBeNull();
  });
});
