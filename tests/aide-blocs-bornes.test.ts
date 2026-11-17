import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QUESTION_LIMITES, QUESTION_MAX_ROWS, WAIT_MAX_MS } from '../src/workflow/engine';
import { MAX_FAMILLES_CONDITION } from '../src/workflow/conditions';
import { LONGUEUR_MAX_ETIQUETTE } from '../src/crm/poser-etiquette';

/**
 * LES BORNES DES FICHES PAR BLOC SE DÉRIVENT DES CONSTANTES (spec `2026-11-17-fiches-par-bloc-design.md`, lot 2 ; le
 * Message rapide a son test, `aide-bloc-message-rapide.test.ts`). Une borne écrite à la main dans une fiche dérive dès
 * que la constante bouge. Le test cherche, dans chaque langue, la phrase qui porte chaque borne.
 */
const FICHES = resolve(__dirname, '..', 'docs', 'aide', 'fiches');
const lire = (chemin: string): string => readFileSync(join(FICHES, chemin), 'utf8').replace(/\s+/g, ' ');
const milliers = (n: number, separateur: string): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, separateur);
const JOURS_MAX = WAIT_MAX_MS / 86_400_000;
const Q = QUESTION_LIMITES;

describe('les fiches des blocs portent les bornes du code', () => {
  it('Question', () => {
    const fr = lire('bloc-question.md');
    expect(fr).toContain(`${milliers(Q.body, ' ')} caractères au plus.`);
    expect(fr).toContain(`${QUESTION_MAX_ROWS} réponses au plus. Titre : ${Q.titre} caractères ; précision, facultative : ${Q.description} ; bouton : ${Q.bouton},`);
    expect(fr).toContain(`${JOURS_MAX} jours au plus.`);
    const en = lire('en/bloc-question.md');
    expect(en).toContain(`${milliers(Q.body, ',')} characters at most.`);
    expect(en).toContain(`${QUESTION_MAX_ROWS} answers at most. Title: ${Q.titre} characters; detail, optional: ${Q.description}; button: ${Q.bouton},`);
    expect(en).toContain(`${JOURS_MAX} days at most.`);
  });

  it('Condition', () => {
    expect(lire('bloc-condition.md')).toContain(`${MAX_FAMILLES_CONDITION} familles au plus.`);
    expect(lire('en/bloc-condition.md')).toContain(`${MAX_FAMILLES_CONDITION} groups at most.`);
  });

  it('Action', () => {
    expect(lire('bloc-action.md')).toContain(`${LONGUEUR_MAX_ETIQUETTE} caractères au plus. Les espaces`);
    expect(lire('en/bloc-action.md')).toContain(`${LONGUEUR_MAX_ETIQUETTE} characters at most. Spaces`);
  });

  it('Attente', () => {
    expect(lire('bloc-attente.md')).toContain(`${JOURS_MAX} jours d'attente au plus`);
    expect(lire('en/bloc-attente.md')).toContain(`${JOURS_MAX} days of waiting at most`);
  });
});
