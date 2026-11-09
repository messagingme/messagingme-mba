import { describe, it, expect } from 'vitest';
import { lire, pagesHtml, texte } from './vitrine-lecture';

/**
 * LA VOIE E-MAIL À CHAQUE PORTE (Julien, 2026-10-27 : « la moitié des gens sur terre n'ont pas de compte gmail !! il
 * faut donc pas les perdre »). La page d'autorisation (`web/app/autoriser/page.tsx`) offre Google, la création de
 * l'espace par l'adresse e-mail et le mot de passe d'un compte existant : une phrase de la vitrine qui dit comment on
 * autorise l'accès, ou comment l'espace se crée, en ne nommant que Google renverrait tous les autres. Chaque bloc de
 * texte (paragraphe, élément de liste, titre, description, texte des données structurées, ligne de `llms.txt`) qui
 * nomme Google dans ce contexte nomme aussi l'adresse e-mail.
 */
const AUTORISATION = /autoris|authori[sz]|continuer avec google|continue with google|espace (se crée|naît)|workspace is created/i;
/** Les Google qui ne sont pas une façon d'entrer : les magasins, la mesure d'audience, les polices des téléphones. */
const GOOGLE_HORS_SUJET = /Google (Play|Analytics|Fonts|Sans|Messages|Authenticator)/g;

/** Les blocs de texte d'une page, tels que le visiteur et les robots les lisent. */
function blocs(html: string): string[] {
  const elements = [...html.matchAll(/<(p|li|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2]!);
  const descriptions = [...html.matchAll(/<meta (?:name|property)="(?:description|og:description)" content="([^"]*)"/g)].map((m) => m[1]!);
  const structurees = [...html.matchAll(/"(?:description|text)": "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
  return [...elements, ...descriptions, ...structurees].map(texte);
}

const googleSeul = (bloc: string): boolean => {
  const propre = bloc.replace(GOOGLE_HORS_SUJET, '');
  return /Google/.test(propre) && AUTORISATION.test(propre) && !/e-mail|email/i.test(propre);
};

describe('la vitrine offre la voie e-mail partout où elle dit comment entrer', () => {
  it('🔴 aucune page ne dit autoriser l’accès, ou créer son espace, avec Google seul', () => {
    const fautifs = pagesHtml().flatMap((p) => blocs(lire(p)).filter(googleSeul).map((b) => `${p} : ${b.trim().slice(0, 140)}`));
    expect(fautifs).toEqual([]);
  });

  it('🔴 llms.txt non plus', () => {
    expect(lire('llms.txt').split('\n').filter(googleSeul)).toEqual([]);
  });
});
