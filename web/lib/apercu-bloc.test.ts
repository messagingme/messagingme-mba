import { describe, it, expect } from 'vitest';
import { morceauxDuMessage } from './apercu-bloc';

describe('morceauxDuMessage', () => {
  it('le texte et chaque {{n}} à part, dans l’ordre, espaces tolérés dans les accolades', () => {
    expect(morceauxDuMessage('Bonjour {{1}}, voici {{ 2 }}.')).toEqual([
      { texte: 'Bonjour ' }, { position: 1 }, { texte: ', voici ' }, { position: 2 }, { texte: '.' },
    ]);
  });

  it('un texte sans variable reste entier ; une variable au bord ne laisse pas de morceau vide', () => {
    expect(morceauxDuMessage('Merci !')).toEqual([{ texte: 'Merci !' }]);
    expect(morceauxDuMessage('{{1}}')).toEqual([{ position: 1 }]);
    expect(morceauxDuMessage('')).toEqual([]);
  });

  it('une variable nommée ({{shopify.x}}, {{prenom}}) n’est pas une variable numérotée : elle reste du texte', () => {
    expect(morceauxDuMessage('Commande {{shopify.order_number}}')).toEqual([{ texte: 'Commande {{shopify.order_number}}' }]);
  });
});
