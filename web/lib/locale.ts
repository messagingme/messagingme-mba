/**
 * Type de langue UI, dans un fichier .ts PUR (sans JSX) : importable par les libs (day.ts, format.ts) ET par
 * le tsc RACINE (qui type-check tests/ sans --jsx : importer un type depuis i18n.tsx y échoue en TS6142).
 * i18n.tsx le ré-exporte pour que les composants continuent d'importer { Locale } depuis '@/lib/i18n'.
 */
export type Locale = 'fr' | 'en';

/**
 * Clé de persistance de la langue. Ici et pas dans `i18n.tsx` parce que `http.ts` en a besoin AUSSI : il
 * jette des messages destinés à l'écran depuis des fonctions ordinaires, où le contexte React est hors
 * d'atteinte. Deux copies du littéral finiraient par diverger, et la traduction s'arrêterait sans bruit.
 */
export const LOCALE_STORAGE_KEY = 'mba_locale';

/**
 * La langue portée par l'adresse (`?lang=en`), ou `null` (lot 18) : la page anglaise de la vitrine envoie vers
 * l'inscription et la doc avec ce paramètre, sinon le visiteur arriverait sur une console en français. L'adresse
 * l'emporte sur le choix mémorisé (le lien dit ce que le visiteur vient de choisir). Une valeur inconnue ne dit rien.
 */
export function langueDeLAdresse(recherche: string): Locale | null {
  const l = new URLSearchParams(recherche).get('lang')?.toLowerCase();
  return l === 'fr' || l === 'en' ? l : null;
}

/**
 * LA LANGUE DU NAVIGATEUR (aide à la connexion, lot 2, décision de Julien du 2026-11-08) : le français si sa langue
 * préférée est le français, l'anglais pour toute autre. Une personne qui autorisait Claude depuis un poste anglais voyait
 * l'écran d'autorisation en français. Rien de dit : le français, la langue par défaut de la console.
 * `navigator.language` est la PREMIÈRE langue de `navigator.languages`, celle que la personne a mise en tête.
 */
export function langueDuNavigateur(langue: string | null | undefined): Locale {
  const l = langue?.trim().toLowerCase() ?? '';
  if (!l) return 'fr';
  return l === 'fr' || l.startsWith('fr-') ? 'fr' : 'en';
}

/**
 * LA LANGUE À L'OUVERTURE, une seule règle pour les deux lecteurs (`LocaleProvider` et `langue()` de `http.ts`, qui jette
 * les messages d'erreur depuis des fonctions ordinaires) : l'adresse (`?lang=`, qui devient le choix mémorisé), puis le
 * choix mémorisé, puis la langue du navigateur. Celle-ci n'est JAMAIS mémorisée : changer la langue du navigateur suffit,
 * et seul un choix explicite (le menu du compte, un lien `?lang=`) s'impose ensuite.
 */
export function langueInitiale(o: { recherche: string; memorisee: string | null; navigateur: string | null | undefined }): { locale: Locale; memoriser: boolean } {
  const parLAdresse = langueDeLAdresse(o.recherche);
  if (parLAdresse) return { locale: parLAdresse, memoriser: true };
  if (o.memorisee === 'fr' || o.memorisee === 'en') return { locale: o.memorisee, memoriser: false };
  return { locale: langueDuNavigateur(o.navigateur), memoriser: false };
}

/**
 * L'adresse sans son paramètre `lang` (chemin, autres paramètres et fragment gardés), ou `null` s'il n'y en a pas. Une
 * fois la langue de l'adresse appliquée et mémorisée, `LocaleProvider` le retire (jaune A2 de la relecture du lot 2) :
 * resté là, il contredirait une bascule ultérieure, au rechargement comme dans les messages d'erreur de `http.ts`, qui
 * lisent l'adresse avant le choix mémorisé.
 */
export function adresseSansLangue(href: string): string | null {
  const u = new URL(href);
  if (!u.searchParams.has('lang')) return null;
  u.searchParams.delete('lang');
  return `${u.pathname}${u.search}${u.hash}`;
}
