import { describe, it, expect } from 'vitest';
import { lirePlageSaisie, saisieDePlage, suiviSegmentsDe } from './segments';

/**
 * Les segments côté console (spec du 2026-10-31). 🔴 Deux gardes : une réponse illisible de la route rend `null` (le
 * panneau ne propose alors aucun critère), et une saisie invalide n'est JAMAIS envoyée (le serveur la refuserait en 400,
 * et la liste disparaîtrait).
 */
describe('suiviSegmentsDe', () => {
  it('lit une boutique, ou son absence', () => {
    expect(suiviSegmentsDe({ boutique: { devise: 'EUR', commandesDepuis: '2026-11-03T10:00:00.000Z', coupeeLe: null }, activiteCompleteDepuis: '2026-11-03' }))
      .toEqual({ boutique: { devise: 'EUR', commandesDepuis: '2026-11-03T10:00:00.000Z', coupeeLe: null }, activiteCompleteDepuis: '2026-11-03' });
    expect(suiviSegmentsDe({ boutique: null, activiteCompleteDepuis: '2026-11-03' })).toEqual({ boutique: null, activiteCompleteDepuis: '2026-11-03' });
  });

  it('🔴 illisible : null, donc aucun critère proposé', () => {
    for (const v of [null, 'x', [], {}, { boutique: null }, { boutique: {}, activiteCompleteDepuis: '2026-11-03' }, { boutique: 3, activiteCompleteDepuis: 'x' }]) {
      expect(suiviSegmentsDe(v), JSON.stringify(v)).toBeNull();
    }
  });
});

describe('lirePlageSaisie', () => {
  const COMMANDES = { max: 1000, entier: true, avecJours: true, restreint: true };
  const s = (min = '', max = '', jours = '') => ({ min, max, jours });

  it('rien de tapé, ou des jours seuls : pas de critère, sans erreur', () => {
    expect(lirePlageSaisie(s(), COMMANDES)).toEqual({ plage: undefined });
    expect(lirePlageSaisie(s('', '', '90'), COMMANDES)).toEqual({ plage: undefined });
  });

  it('une plage valide, virgule décimale comprise pour la dépense', () => {
    expect(lirePlageSaisie(s('2', '', '90'), COMMANDES)).toEqual({ plage: { min: 2, jours: 90 } });
    expect(lirePlageSaisie(s('', '0'), COMMANDES)).toEqual({ plage: { max: 0 } });
    expect(lirePlageSaisie(s('49,9'), { ...COMMANDES, entier: false, max: 10_000_000 })).toEqual({ plage: { min: 49.9 } });
  });

  it('🔴 une saisie invalide n’envoie rien et dit pourquoi', () => {
    expect(lirePlageSaisie(s('3', '2'), COMMANDES)).toEqual({ erreur: 'ordre' });
    expect(lirePlageSaisie(s('0'), COMMANDES)).toEqual({ erreur: 'zero' });
    expect(lirePlageSaisie(s('1.5'), COMMANDES)).toEqual({ erreur: 'nombre' });
    expect(lirePlageSaisie(s('1001'), COMMANDES)).toEqual({ erreur: 'nombre' });
    expect(lirePlageSaisie(s('1', '', '0'), COMMANDES)).toEqual({ erreur: 'nombre' });
    expect(lirePlageSaisie(s('-1'), COMMANDES)).toEqual({ erreur: 'nombre' });
  });

  it('« au moins 0 jour » de la dernière commande est un vrai critère (au moins une commande)', () => {
    expect(lirePlageSaisie(s('0'), { max: 3650, entier: true, avecJours: false, restreint: false })).toEqual({ plage: { min: 0 } });
  });

  it('une plage posée se relit en saisie', () => {
    expect(saisieDePlage({ min: 2, jours: 90 })).toEqual({ min: '2', max: '', jours: '90' });
    expect(saisieDePlage(undefined)).toEqual({ min: '', max: '', jours: '' });
  });
});
