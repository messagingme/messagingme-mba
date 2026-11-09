import { describe, it, expect } from 'vitest';
import { langueDeLAdresse, langueDuNavigateur, langueInitiale } from './locale';

// La langue du navigateur (aide à la connexion, lot 2, décision de Julien du 2026-11-08) : en français si le navigateur
// est en français, en anglais pour toute autre langue. Une personne qui autorise Claude depuis un poste anglais voyait
// l'écran d'autorisation en français.
describe('langueDuNavigateur', () => {
  it('le français pour toute variante du français, quelle que soit la casse', () => {
    for (const l of ['fr', 'fr-FR', 'fr-CA', 'fr-BE', 'FR-fr', ' fr-CH ']) expect(langueDuNavigateur(l), l).toBe('fr');
  });

  it('l’anglais pour toute autre langue', () => {
    for (const l of ['en', 'en-US', 'en-GB', 'de-DE', 'es', 'it-IT', 'nl', 'pt-BR', 'zh-CN']) expect(langueDuNavigateur(l), l).toBe('en');
  });

  it('le français quand le navigateur ne dit rien', () => {
    for (const l of [undefined, null, '', '  ']) expect(langueDuNavigateur(l), String(l)).toBe('fr');
  });
});

describe('langueInitiale : l’adresse, puis le choix mémorisé, puis le navigateur', () => {
  it('l’adresse l’emporte, et devient le choix mémorisé', () => {
    expect(langueInitiale({ recherche: '?lang=fr', memorisee: 'en', navigateur: 'en-US' })).toEqual({ locale: 'fr', memoriser: true });
    expect(langueInitiale({ recherche: '?lang=en', memorisee: 'fr', navigateur: 'fr-FR' })).toEqual({ locale: 'en', memoriser: true });
  });

  it('sans adresse, le choix mémorisé l’emporte sur le navigateur', () => {
    expect(langueInitiale({ recherche: '', memorisee: 'fr', navigateur: 'en-US' })).toEqual({ locale: 'fr', memoriser: false });
    expect(langueInitiale({ recherche: '', memorisee: 'en', navigateur: 'fr-FR' })).toEqual({ locale: 'en', memoriser: false });
  });

  it('🔴 sans adresse ni choix, la langue du navigateur, JAMAIS mémorisée (changer le navigateur suffit)', () => {
    expect(langueInitiale({ recherche: '', memorisee: null, navigateur: 'en-US' })).toEqual({ locale: 'en', memoriser: false });
    expect(langueInitiale({ recherche: '', memorisee: null, navigateur: 'de-DE' })).toEqual({ locale: 'en', memoriser: false });
    expect(langueInitiale({ recherche: '', memorisee: null, navigateur: 'fr-FR' })).toEqual({ locale: 'fr', memoriser: false });
  });

  it('un choix mémorisé inconnu ou un paramètre inconnu ne dit rien : on passe au suivant', () => {
    expect(langueInitiale({ recherche: '?lang=de', memorisee: 'xx', navigateur: 'en-GB' })).toEqual({ locale: 'en', memoriser: false });
    expect(langueInitiale({ recherche: '', memorisee: null, navigateur: undefined })).toEqual({ locale: 'fr', memoriser: false });
  });
});

// La langue portée par l'adresse (lot 18) : la page anglaise de la vitrine envoie vers la console avec `?lang=en`,
// et la console doit s'ouvrir en anglais au lieu du français par défaut.
describe('langueDeLAdresse', () => {
  it('lit les deux langues de la console', () => {
    expect(langueDeLAdresse('?lang=en')).toBe('en');
    expect(langueDeLAdresse('?lang=fr')).toBe('fr');
  });

  it('la trouve parmi d’autres paramètres, et sans tenir compte de la casse', () => {
    expect(langueDeLAdresse('?suite=demarrer&lang=en')).toBe('en');
    expect(langueDeLAdresse('?lang=EN')).toBe('en');
  });

  it('ne dit rien quand l’adresse ne porte pas de langue connue', () => {
    expect(langueDeLAdresse('')).toBeNull();
    expect(langueDeLAdresse('?suite=demarrer')).toBeNull();
    expect(langueDeLAdresse('?lang=de')).toBeNull();
    expect(langueDeLAdresse('?lang=')).toBeNull();
  });
});
