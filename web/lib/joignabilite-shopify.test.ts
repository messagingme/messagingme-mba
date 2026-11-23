import { describe, it, expect } from 'vitest';
import { lireJoignabilite, partDesExpediees, tauxJoignabilite } from './joignabilite-shopify';

/** L'exemple de la spec : 128 = 74 livrées + 12 supprimées + 20 sans numéro + 8 invalides + 14 en attente. */
const SPEC = { expediees: 128, messagesLivres: 96, livrees: 74, supprimees: 12, sansNumero: 20, invalides: 8, enAttente: 14, testExpediees: 0 };

describe('la carte « Joignabilité WhatsApp » : la lecture', () => {
  it('une réponse juste se lit telle quelle', () => {
    expect(lireJoignabilite(SPEC)).toEqual(SPEC);
  });

  it('🔴 une réponse illisible rend null (la carte disparaît plutôt qu’un zéro faux)', () => {
    for (const brut of [null, [], 'x', {}, { ...SPEC, livrees: -1 }, { ...SPEC, enAttente: 1.5 }, { ...SPEC, invalides: '8' }]) {
      expect(lireJoignabilite(brut), JSON.stringify(brut)).toBeNull();
    }
    const { testExpediees: _absente, ...sansTest } = SPEC;
    expect(lireJoignabilite(sansTest)).toBeNull();
  });

  it('🔴 des parts qui ne font pas le total sont illisibles', () => {
    expect(lireJoignabilite({ ...SPEC, enAttente: 15 })).toBeNull();
  });

  it('🔴 la sixième part (lot 3) entre dans le total ; absente (API plus ancienne), la réponse à cinq parts se lit encore', () => {
    const six = { ...SPEC, enAttente: 10, pasLivrable: 4 };
    expect(lireJoignabilite(six)).toEqual(six);
    expect(lireJoignabilite({ ...SPEC, pasLivrable: 4 })).toBeNull();
    expect(lireJoignabilite({ ...six, pasLivrable: -1 })).toBeNull();
    expect(lireJoignabilite({ ...six, pasLivrable: '4' })).toBeNull();
    expect(lireJoignabilite(SPEC)).toEqual(SPEC);
    expect(lireJoignabilite(SPEC)).not.toHaveProperty('pasLivrable');
  });
});

describe('la carte « Joignabilité WhatsApp » : le taux et les parts', () => {
  it('le taux compte des COMMANDES livrées, pas des messages', () => {
    expect(tauxJoignabilite(SPEC)).toBe('58');
    expect(partDesExpediees(20, SPEC)).toBe('16');
  });

  it('🔴 l’arrondi ne fabrique jamais un « 0 % » ni un « 100 % » faux ; les vrais restent', () => {
    const mille = { ...SPEC, expediees: 1000, livrees: 3, supprimees: 0, sansNumero: 0, invalides: 0, enAttente: 997 };
    expect(tauxJoignabilite(mille)).toBe('< 1');
    expect(partDesExpediees(997, mille)).toBe('> 99');
    expect(tauxJoignabilite({ ...mille, livrees: 0, enAttente: 1000 })).toBe('0');
    expect(tauxJoignabilite({ ...mille, livrees: 1000, enAttente: 0 })).toBe('100');
  });

  it('🔴 sans expédition, aucun pourcentage (jamais « 0 % »)', () => {
    const vide = { ...SPEC, expediees: 0, messagesLivres: 0, livrees: 0, supprimees: 0, sansNumero: 0, invalides: 0, enAttente: 0 };
    expect(tauxJoignabilite(vide)).toBeNull();
    expect(partDesExpediees(0, vide)).toBeNull();
  });
});
