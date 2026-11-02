import { describe, it, expect } from 'vitest';
import { serieDeCredit, type JourDeCredit } from '../src/lib/serie-credit';

/**
 * LA COURBE DE 90 JOURS D'UN CRÉDIT (Entreprise illimitée, lot C) : le solde de fin de jour se reconstruit À REBOURS
 * depuis le solde courant, jamais en cumulant depuis le premier jour de la fenêtre, qui ne voit pas ce qui la précède.
 */
const jour = (j: string, mouvementSoldeMicroEur: number, consommationMicroEur = 0): JourDeCredit => ({ jour: j, mouvementSoldeMicroEur, consommationMicroEur });

describe('serieDeCredit', () => {
  it('🔴 le solde de fin de jour, à rebours : achat, débits, retour', () => {
    // Un achat de 50 € le 1er, 2 € consommés le 2, 0,50 € rendus le 3 (un message que Meta n'a pas facturé), rien le 4.
    const points = serieDeCredit([
      jour('2026-11-01', 50_000_000),
      jour('2026-11-02', -2_000_000, 2_000_000),
      jour('2026-11-03', 500_000),
      jour('2026-11-04', 0),
    ], 48_500_000);
    expect(points.map((p) => [p.jour, p.soldeMicroEur])).toEqual([
      ['2026-11-01', 50_000_000], ['2026-11-02', 48_000_000], ['2026-11-03', 48_500_000], ['2026-11-04', 48_500_000],
    ]);
  });

  it('🔴 un jour sans mouvement garde le solde de la veille, et la fin d’aujourd’hui est le solde courant', () => {
    const points = serieDeCredit([jour('2026-11-01', -100), jour('2026-11-02', 0), jour('2026-11-03', 0)], 900);
    expect(points.map((p) => p.soldeMicroEur)).toEqual([900, 900, 900]);
    expect(points.at(-1)!.soldeMicroEur).toBe(900);
  });

  it('🔴 ce qui a précédé la fenêtre n’est pas perdu : le premier jour part du bon solde, pas de zéro', () => {
    // Un solde de 30 € acheté bien avant la fenêtre, puis 1 € consommé dans la fenêtre.
    const points = serieDeCredit([jour('2026-11-01', 0), jour('2026-11-02', -1_000_000, 1_000_000)], 29_000_000);
    expect(points.map((p) => p.soldeMicroEur)).toEqual([30_000_000, 29_000_000]);
  });

  it('🔴 une Entreprise : son solde ne bouge pas, sa courbe est sa consommation du jour', () => {
    // Ses débits illimités ne touchent pas le solde (mouvement nul) mais comptent dans la consommation.
    const points = serieDeCredit([jour('2026-11-01', 0, 120_000), jour('2026-11-02', 0, 0), jour('2026-11-03', 0, 340_000)], 4_820_000);
    expect(points.map((p) => p.soldeMicroEur)).toEqual([4_820_000, 4_820_000, 4_820_000]);
    expect(points.map((p) => p.consommationMicroEur)).toEqual([120_000, 0, 340_000]);
  });

  it('aucun jour, aucun point', () => {
    expect(serieDeCredit([], 5)).toEqual([]);
  });
});
