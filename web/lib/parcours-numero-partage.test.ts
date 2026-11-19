import { describe, expect, it } from 'vitest';
import {
  destinationDuNumeroFourni, estFiliereNumero, estModeNumero, FILIERES_NUMERO, MODES_NUMERO, prixDuNumero,
} from './partage/parcours-numero';

describe('la politique partagée du parcours numéro', () => {
  it('porte les quatre modes et les deux filières, sans accepter une valeur voisine', () => {
    expect(MODES_NUMERO).toEqual(['fourni', 'apporte', 'coexistence', 'fourni_application']);
    expect(FILIERES_NUMERO).toEqual(['api', 'application']);
    for (const mode of MODES_NUMERO) expect(estModeNumero(mode)).toBe(true);
    for (const filiere of FILIERES_NUMERO) expect(estFiliereNumero(filiere)).toBe(true);
    expect(estModeNumero('fourni-application')).toBe(false);
    expect(estFiliereNumero('meta')).toBe(false);
  });

  it('juge le prix une fois, avec l’inclusion prioritaire sur l’essai', () => {
    expect(prixDuNumero({})).toBe('payant');
    expect(prixDuNumero({ essaiPro: true })).toBe('essai');
    expect(prixDuNumero({ inclusDansLePro: true, essaiPro: true })).toBe('inclus');
  });

  it('ne retient une destination que pour un numéro fourni', () => {
    expect(destinationDuNumeroFourni('fourni')).toBe('api');
    expect(destinationDuNumeroFourni('fourni_application')).toBe('application');
    expect(destinationDuNumeroFourni('apporte')).toBeNull();
    expect(destinationDuNumeroFourni('coexistence')).toBeNull();
  });
});
