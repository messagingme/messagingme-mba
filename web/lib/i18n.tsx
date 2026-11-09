'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * i18n léger, sans dépendance : la langue vit dans un contexte (persisté en localStorage), et chaque chaîne
 * porte sa traduction AU POINT D'APPEL via `t('texte FR', 'EN text')`. Pas de dictionnaire central à maintenir
 * en parallèle : la traduction est co-localisée avec la chaîne (maintenable, pas de dérive). Anglais absent -> FR.
 *
 * Usage dans un composant :  const t = useT();  ...  {t('Bonjour', 'Hello')}
 * À l'ouverture (`langueInitiale`, la même règle que les messages d'erreur de `http.ts`) : un lien `?lang=` (lot 18),
 * sinon le choix mémorisé par navigateur (menu compte), sinon la langue du navigateur (aide à la connexion, lot 2) :
 * français s'il est en français, anglais pour toute autre langue.
 */
import { LOCALE_STORAGE_KEY, adresseSansLangue, langueInitiale, type Locale } from './locale';
export type { Locale } from './locale';
const STORAGE_KEY = LOCALE_STORAGE_KEY;

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
}
const Ctx = createContext<LocaleCtx>({ locale: 'fr', setLocale: () => {} });

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Défaut 'fr' au 1er rendu (identique serveur/client -> pas de mismatch d'hydratation). La langue retenue est
  // appliquée APRÈS le montage (effet client), au prix d'un bref flash du français pour une console en anglais.
  const [locale, setLocaleState] = useState<Locale>('fr');
  useEffect(() => {
    let memorisee: string | null = null;
    try { memorisee = window.localStorage.getItem(STORAGE_KEY); } catch { /* localStorage indisponible : le navigateur décide */ }
    // `window.navigator` et non le `navigator` global : la même lecture que `langue()` de `http.ts`.
    const { locale: l, memoriser } = langueInitiale({ recherche: window.location.search, memorisee, navigateur: window.navigator?.language });
    setLocaleState(l);
    // Un lien `?lang=` devient le choix mémorisé ; la langue du navigateur, jamais. Mémorisé, le paramètre a servi et
    // quitte l'adresse (jaune A2 de la relecture du lot 2) : resté, il contredirait une bascule ultérieure. S'il n'a pas
    // pu être mémorisé (stockage bloqué), il reste : c'est alors le seul porteur de la langue au rechargement.
    if (memoriser) {
      try {
        window.localStorage.setItem(STORAGE_KEY, l);
        const sans = adresseSansLangue(window.location.href);
        if (sans !== null) window.history.replaceState(null, '', sans);
      } catch { /* non bloquant */ }
    }
    // Resynchronise AUSSI <html lang> (le layout SSR pose lang="fr" par défaut) : sans ça, une console en anglais
    // aurait un document déclaré... français.
    try { document.documentElement.lang = l; } catch { /* edge */ }
  }, []);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { window.localStorage.setItem(STORAGE_KEY, l); } catch { /* non bloquant */ }
    try { document.documentElement.lang = l; } catch { /* SSR/edge */ }
  }, []);
  return <Ctx.Provider value={{ locale, setLocale }}>{children}</Ctx.Provider>;
}

/**
 * Une langue IMPOSÉE, sans mémoire ni effet : pour rendre une page hors du navigateur (la doc en Markdown, lot 17,
 * `lib/doc-md.test.ts`). L'écran ne s'en sert jamais : il passe par `LocaleProvider`.
 */
export function LocaleFixe({ locale, children }: { locale: Locale; children?: ReactNode }) {
  return <Ctx.Provider value={{ locale, setLocale: () => {} }}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleCtx {
  return useContext(Ctx);
}

/** Retourne `t(fr, en?)` -> la chaîne dans la langue courante (repli FR si l'anglais n'est pas fourni). */
export function useT(): (fr: string, en?: string) => string {
  const { locale } = useContext(Ctx);
  return useCallback((fr: string, en?: string) => (locale === 'en' && en !== undefined ? en : fr), [locale]);
}
