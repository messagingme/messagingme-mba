import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  NATURES_IA, NOTE_ESSAI, NOTE_TRANSCRIPTION, natureDuMouvement, noteVectorisation, ventilationVide,
} from '../src/agent/natures-credit';

describe('la nature d’un débit du crédit IA', () => {
  it('un tour d’agent n’a pas de note, que sa session soit encore là ou purgée', () => {
    expect(natureDuMouvement('conso', null)).toBe('agent');
    expect(natureDuMouvement('conso', '')).toBe('agent');
  });

  it('chaque note connue a sa nature', () => {
    expect(natureDuMouvement('conso', NOTE_ESSAI.formulaire)).toBe('essai');
    expect(natureDuMouvement('conso', NOTE_ESSAI.mcp)).toBe('essai');
    expect(natureDuMouvement('conso', noteVectorisation(1))).toBe('connaissance');
    expect(natureDuMouvement('conso', noteVectorisation(37))).toBe('connaissance');
    expect(natureDuMouvement('conso', NOTE_TRANSCRIPTION)).toBe('transcription');
    expect(natureDuMouvement('traduction', null)).toBe('traduction');
  });

  it('une note inconnue tombe en « autre », jamais hors du total', () => {
    expect(natureDuMouvement('conso', 'une porte qui n’existe pas encore')).toBe('autre');
  });

  it('un mouvement qui n’est pas une consommation n’a pas de nature', () => {
    for (const raison of ['recharge', 'achat', 'offert']) expect(natureDuMouvement(raison, 'x')).toBeNull();
  });

  it('les notes gardent les textes déjà écrits au journal (sinon les anciens débits changeraient de nature)', () => {
    expect(NOTE_ESSAI).toEqual({ formulaire: 'essai depuis la console', mcp: 'essai depuis le serveur MCP' });
    expect(NOTE_TRANSCRIPTION).toBe('transcription d’un vocal');
    expect(noteVectorisation(1)).toBe('vectorisation de 1 fiche de connaissance');
    expect(noteVectorisation(3)).toBe('vectorisation de 3 fiches de connaissance');
  });

  it('la ventilation vide porte toutes les natures, à zéro', () => {
    const v = ventilationVide();
    expect(Object.keys(v).sort()).toEqual([...NATURES_IA].sort());
    expect(Object.values(v).every((n) => n === 0)).toBe(true);
  });
});

/**
 * 🔴 L'INVENTAIRE DES DÉBITS : une note écrite en dur chez un appelant de `debiter` tomberait en « autre » sans que rien
 * ne le dise. Toute note vient de `src/agent/natures-credit.ts`.
 */
describe('aucun appel de debiter ne passe une note écrite en dur', () => {
  function fichiers(dossier: string): string[] {
    return readdirSync(dossier).flatMap((n) => {
      const p = join(dossier, n);
      return statSync(p).isDirectory() ? fichiers(p) : p.endsWith('.ts') ? [p] : [];
    });
  }
  const SRC = resolve(__dirname, '..', 'src');
  const appels = fichiers(SRC).flatMap((f) => readFileSync(f, 'utf8').split('\n')
    .map((ligne, i) => ({ f, i: i + 1, ligne }))
    .filter((l) => /\.debiter\(/.test(l.ligne)));

  it('il y a bien des appels à inspecter, sinon ce test ne prouve rien', () => {
    expect(appels.length).toBeGreaterThan(3);
  });

  it('aucun ne contient de chaîne littérale', () => {
    const fautifs = appels.filter((a) => /\.debiter\([^)]*['"`]/.test(a.ligne)).map((a) => `${a.f}:${a.i}`);
    expect(fautifs).toEqual([]);
  });
});
