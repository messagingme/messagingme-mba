import { describe, it, expect } from 'vitest';
import { ETAPES_VISITE, etapesVisibles } from './accueil-console';

describe('l’accueil d’un nouveau membre (plan 2026-11-19-accueil-pro)', () => {
  it('chaque étape de la visite vise un élément et a sa phrase dans les deux langues, sans tiret long', () => {
    for (const e of ETAPES_VISITE) {
      expect(e.cible).toMatch(/^\[data-(nav|testid)="[a-z-]+"\]$/);
      for (const texte of [e.fr, e.en]) {
        expect(texte.length).toBeGreaterThan(10);
        expect(texte).not.toMatch(/[–—]/);
      }
    }
  });

  it('🔴 une étape dont l’élément n’est pas à l’écran est sautée, jamais pointée dans le vide', () => {
    const absents = new Set(['[data-nav="ia"]', '[data-nav="tools"]']);
    const restes = etapesVisibles(ETAPES_VISITE, (c) => !absents.has(c));
    expect(restes).toHaveLength(ETAPES_VISITE.length - 2);
    expect(restes.some((e) => absents.has(e.cible))).toBe(false);
  });
});
