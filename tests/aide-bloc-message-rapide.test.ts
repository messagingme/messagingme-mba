import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  MAX_REPONSES_RAPIDES, MAX_TEXTE_REPONSE_RAPIDE, TEXTE_MAX_AVEC_FICHIER_OU_BOUTON, TEXTE_MAX_SIMPLE,
} from '../web/lib/partage/message-rapide';

/**
 * LES LIMITES DE LA FICHE DU BLOC MESSAGE RAPIDE SE DÉRIVENT DES CONSTANTES (spec `2026-11-17-fiches-par-bloc-design.md`).
 * Une limite écrite à la main dans une fiche dérive dès que la constante bouge, et le client se fait refuser ce que
 * l'aide lui promettait. Le test cherche dans chaque langue la phrase qui porte chaque borne.
 */
const FICHES = resolve(__dirname, '..', 'docs', 'aide', 'fiches');
const lire = (chemin: string): string => readFileSync(join(FICHES, chemin), 'utf8').replace(/\s+/g, ' ');
const milliers = (n: number, separateur: string): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, separateur);
const NOMBRES = {
  fr: ['Zéro', 'Un', 'Deux', 'Trois', 'Quatre', 'Cinq'],
  en: ['Zero', 'One', 'Two', 'Three', 'Four', 'Five'],
} as const;

describe('la fiche du bloc Message rapide porte les bornes du code', () => {
  it('en français', () => {
    const f = lire('bloc-message-rapide.md');
    expect(f).toContain(`${milliers(TEXTE_MAX_SIMPLE, ' ')} caractères au plus, ou ${milliers(TEXTE_MAX_AVEC_FICHIER_OU_BOUTON, ' ')} dès que`);
    expect(f).toContain(`${NOMBRES.fr[MAX_REPONSES_RAPIDES]} boutons au plus, ${MAX_TEXTE_REPONSE_RAPIDE} caractères chacun`);
  });

  it('en anglais', () => {
    const f = lire('en/bloc-message-rapide.md');
    expect(f).toContain(`${milliers(TEXTE_MAX_SIMPLE, ',')} characters at most, or ${milliers(TEXTE_MAX_AVEC_FICHIER_OU_BOUTON, ',')} as soon as`);
    expect(f).toContain(`${NOMBRES.en[MAX_REPONSES_RAPIDES]} buttons at most, ${MAX_TEXTE_REPONSE_RAPIDE} characters each`);
  });
});
