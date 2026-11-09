import { describe, it, expect } from 'vitest';
import { lire, pagesHtml, texte } from './vitrine-lecture';

/**
 * LA VOIE E-MAIL À CHAQUE PORTE (Julien, 2026-10-27 : « la moitié des gens sur terre n'ont pas de compte gmail !! il
 * faut donc pas les perdre »). La page d'autorisation (`web/app/autoriser/page.tsx`) offre Google, la création de
 * l'espace par l'adresse e-mail et le mot de passe d'un compte existant : une phrase de la vitrine qui dit comment on
 * entre (autoriser, continuer, créer son espace ou son compte, s'inscrire, se connecter) en ne nommant que Google
 * renverrait tous les autres. Chaque bloc de texte de chaque page (paragraphe, élément de liste, titre, lien, bouton,
 * résumé, étiquette, description, chaîne des données structurées) et chaque ligne de `llms.txt` qui nomme Google dans
 * ce contexte nomme aussi l'autre porte : l'adresse e-mail, ou le mot de passe.
 */
const ENTREE = /autoris|authori[sz]|continu\w* (avec|with) google|cré\w* (votre|mon|son) (espace|compte)|create (your|my|a) (workspace|account)|espace (se crée|naît)|workspace is created|inscri|sign(ing)?[ -]?(up|in)|connect(ez|er)-vous|log[ -]?in|compte google|google account/i;
const AUTRE_PORTE = /adresse e-mail|e-mail address|email address|mot de passe|password/i;
/** Les Google qui ne sont pas une façon d'entrer : les magasins, la mesure d'audience, les polices, les applications. */
const GOOGLE_HORS_SUJET = /Google (Play|Analytics|Fonts|Sans|Messages|Authenticator|Chrome|Agenda|Calendar|Ads|Tag Manager)/g;

const googleSeul = (bloc: string): boolean => {
  const propre = bloc.replace(GOOGLE_HORS_SUJET, '');
  return /Google/.test(propre) && ENTREE.test(propre) && !AUTRE_PORTE.test(propre);
};

/** Toutes les chaînes d'une valeur JSON, à toute profondeur. */
const chaines = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(chaines) : v && typeof v === 'object' ? Object.values(v).flatMap(chaines) : [];

/** Les blocs de texte d'une page, tels que le visiteur, les robots et les lecteurs d'écran les lisent. */
function blocs(html: string): string[] {
  const elements = [...html.matchAll(/<(p|li|h[1-6]|summary|a|button|label|figcaption|dt|dd|th|td|blockquote|title)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2]!);
  const metas = [...html.matchAll(/<meta (?:name|property)="(?:description|og:title|og:description|twitter:title|twitter:description)" content="([^"]*)"/g)].map((m) => m[1]!);
  const etiquettes = [...html.matchAll(/\s(?:aria-label|title|alt)="([^"]*)"/g)].map((m) => m[1]!);
  const structurees = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => chaines(JSON.parse(m[1]!)));
  return [...elements, ...metas, ...etiquettes, ...structurees].map(texte);
}

describe('la vitrine offre la voie e-mail partout où elle dit comment entrer', () => {
  it('le détecteur attrape les tournures « Google seul » et laisse passer les autres', () => {
    for (const phrase of [
      'Autorisez avec Google.', 'Une page s’ouvre : continuez avec Google.', 'Créez votre espace avec votre compte Google.',
      'Create your workspace with Google.', 'Inscrivez-vous avec Google.', 'Sign up with Google.', 'Un compte Google suffit.',
      'Continuez avec Google. Un e-mail vous confirme la création.',
    ]) expect(googleSeul(phrase), phrase).toBe(true);
    for (const phrase of [
      'Continuez avec Google ou votre adresse e-mail.', 'Connectez-vous avec Google ou votre mot de passe.',
      'Gratuitement, avec votre compte Google ou une adresse e-mail.', 'Téléchargez-la sur Google Play.',
      'Google Analytics compte les visites.', 'Dans Google Chrome, autorisez les notifications.',
    ]) expect(googleSeul(phrase), phrase).toBe(false);
  });

  it('🔴 aucune page ne dit comment entrer avec Google seul', () => {
    const fautifs = pagesHtml().flatMap((p) => blocs(lire(p)).filter(googleSeul).map((b) => `${p} : ${b.trim().slice(0, 140)}`));
    expect(fautifs).toEqual([]);
  });

  it('🔴 llms.txt non plus', () => {
    expect(lire('llms.txt').split('\n').filter(googleSeul)).toEqual([]);
  });
});
