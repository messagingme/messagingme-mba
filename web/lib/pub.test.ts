import { describe, it, expect } from 'vitest';
import { champPub } from './pub';

/**
 * L'ACCORD PUBLICITAIRE DE LA CRÉATION D'UN COMPTE (pixel Meta, lot 3). Le rendu de la case, et ce que le clic envoie,
 * sont dans `e2e/partage-meta.spec.ts`.
 */
describe('champPub', () => {
  it('🔴 sans la case cochée, rien : le corps ne porte pas d’accord', () => {
    expect(champPub(false, '?fbc=fb.1.1793300000000.essai&fbp=fb.1.1793300000000.42')).toBeUndefined();
  });

  it('case cochée : l’accord, avec les identifiants de Meta venus de la vitrine', () => {
    expect(champPub(true, '?fbc=fb.1.1793300000000.essai&fbp=fb.1.1793300000000.42&offre=pro'))
      .toEqual({ accord: true, fbc: 'fb.1.1793300000000.essai', fbp: 'fb.1.1793300000000.42' });
  });

  it('case cochée sans identifiants (arrivée directe), ou des identifiants mal formés : l’accord seul', () => {
    expect(champPub(true, '')).toEqual({ accord: true });
    expect(champPub(true, '?fbc=%3Cscript%3E&fbp=' + 'fb.1.1.' + 'a'.repeat(600))).toEqual({ accord: true });
  });
});
