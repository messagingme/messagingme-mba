import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QUESTION_LIMITES, QUESTION_MAX_ROWS, WAIT_MAX_MS } from '../src/workflow/engine';
import { MAX_FAMILLES_CONDITION } from '../src/workflow/conditions';
import { LONGUEUR_MAX_ETIQUETTE } from '../src/crm/poser-etiquette';
import { DELAI_JS_MS, MAX_CODE_JS, MEMOIRE_JS_OCTETS } from '../src/workflow/fonction-js';
import { DELAI_APPEL_HTTP_MS } from '../src/workflow/appel-http';
import { RCS_TEXTE_MAX } from '../web/lib/partage/rcs';
import { MAX_BOUTONS_CARTE, MAX_BOUTONS_RCS, MAX_TEXTE_RCS_AVEC_IMAGE } from '../web/lib/rcs';
import { MAX_DESTINATAIRES_EMAIL } from '../web/lib/partage/blocs';
import { MAX_OCTETS_CHAMP_JSON } from '../web/lib/partage/champs';
import { LONGUEUR_CHEMIN_MAX } from '../web/lib/partage/chemin-json';
import { MAX_LIGNES_EXTRACTION } from '../web/lib/partage/extraire-json';

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

  // Lot 3.
  it('Fonction JS', () => {
    const mo = MEMOIRE_JS_OCTETS / (1024 * 1024);
    expect(lire('bloc-fonction-js.md')).toContain(`${milliers(MAX_CODE_JS, ' ')} caractères au plus. La fonction a ${DELAI_JS_MS} ms et ${mo} Mo pour tourner`);
    expect(lire('en/bloc-fonction-js.md')).toContain(`${milliers(MAX_CODE_JS, ',')} characters at most. The function has ${DELAI_JS_MS} ms and ${mo} MB to run`);
  });

  it('Message RCS', () => {
    const fr = lire('bloc-message-rcs.md');
    expect(fr).toContain(`${milliers(RCS_TEXTE_MAX, ' ')} caractères, ou ${milliers(MAX_TEXTE_RCS_AVEC_IMAGE, ' ')} avec une image.`);
    expect(fr).toContain(`${MAX_BOUTONS_RCS} boutons au plus, ou ${MAX_BOUTONS_CARTE} avec une image.`);
    const en = lire('en/bloc-message-rcs.md');
    expect(en).toContain(`${milliers(RCS_TEXTE_MAX, ',')} characters, or ${milliers(MAX_TEXTE_RCS_AVEC_IMAGE, ',')} with an image.`);
    expect(en).toContain(`${MAX_BOUTONS_RCS} buttons at most, or ${MAX_BOUTONS_CARTE} with an image.`);
  });

  it('Envoi de mail', () => {
    expect(lire('bloc-envoi-de-mail.md')).toContain(`${MAX_DESTINATAIRES_EMAIL} destinataires au plus`);
    expect(lire('en/bloc-envoi-de-mail.md')).toContain(`${MAX_DESTINATAIRES_EMAIL} recipients at most`);
  });

  it('Appel API', () => {
    const ko = MAX_OCTETS_CHAMP_JSON / 1024;
    const fr = lire('bloc-appel-api.md');
    expect(fr).toContain(`${DELAI_APPEL_HTTP_MS / 1000} secondes sans réponse`);
    expect(fr).toContain(`${ko} Ko au plus`);
    const en = lire('en/bloc-appel-api.md');
    expect(en).toContain(`${DELAI_APPEL_HTTP_MS / 1000} seconds without an answer`);
    expect(en).toContain(`${ko} KB at most`);
  });

  it('Extraire du JSON', () => {
    const fr = lire('bloc-extraire-du-json.md');
    expect(fr).toContain(`${LONGUEUR_CHEMIN_MAX} caractères au plus. Une clé`);
    expect(fr).toContain(`${MAX_LIGNES_EXTRACTION} lignes au plus`);
    const en = lire('en/bloc-extraire-du-json.md');
    expect(en).toContain(`${LONGUEUR_CHEMIN_MAX} characters at most. A key`);
    expect(en).toContain(`${MAX_LIGNES_EXTRACTION} lines at most`);
  });
});
