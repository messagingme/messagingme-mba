import { describe, it, expect } from 'vitest';
import { filtrerEspaces } from './ops-filtre';

/** Le filtre de la liste des espaces de `/ops` (code d'espace visible, 2026-11-19) : sur le nom ou le code, sans casse. */
describe('filtrerEspaces', () => {
  const lignes = [
    { name: 'ACME Corp', code: 'k7m2p3' },
    { name: 'Boulangerie', code: 'b4x9qa' },
    { name: 'Ancien' },
  ];

  it('vide ou blanc : toute la liste', () => {
    expect(filtrerEspaces(lignes, '')).toEqual(lignes);
    expect(filtrerEspaces(lignes, '   ')).toEqual(lignes);
  });

  it('sur le nom, sans casse', () => {
    expect(filtrerEspaces(lignes, 'acme')).toEqual([lignes[0]]);
  });

  it('sur le code tapé en majuscules (copié d’un e-mail client), espaces autour ignorés', () => {
    expect(filtrerEspaces(lignes, ' K7M2P3 ')).toEqual([lignes[0]]);
  });

  it('une ligne sans code (API d’avant le champ) reste trouvable par son nom', () => {
    expect(filtrerEspaces(lignes, 'anc')).toEqual([lignes[2]]);
  });
});
