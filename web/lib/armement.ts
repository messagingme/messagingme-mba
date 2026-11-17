'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * UN BOUTON QUI ACCORDE UN ACCÈS NE PART PAS SUR UN CLIC PIÉGÉ (passage 2 de l'audit, 2026-11-17).
 *
 * Le double-clic piégé : une page tierce ouvre une petite fenêtre sous le pointeur, se mène elle-même vers la page de
 * consentement, et ferme la petite fenêtre au premier appui ; le second appui du double-clic tombe sur le bouton
 * révélé. `frame-ancestors 'none'` n'y peut rien, aucun cadre n'est en jeu. La parade : le bouton ne s'arme qu'après
 * une demi-seconde de page VISIBLE et ACTIVE, et se désarme dès qu'elle perd le focus ou se cache. Le second appui
 * arrive quelques dizaines de millisecondes après le retour du focus : il trouve le bouton désarmé.
 */

/** Ce qu'il faut voir de la fenêtre et du document : des cibles d'événements, la visibilité et le focus. */
export interface EnvironnementArmement {
  fenetre: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  document: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { visibilityState: string; hasFocus(): boolean };
}

/** Une demi-seconde : bien plus que l'écart des deux appuis d'un double-clic, imperceptible pour un clic voulu. */
export const DELAI_ARMEMENT_MS = 500;

/**
 * Suit l'armement et le signale à `surChangement` (désarmé au départ). Rend la fonction qui arrête le suivi. Noyau sans
 * React, pour qu'un test le joue avec de faux événements et une fausse horloge.
 */
export function suivreArmement(env: EnvironnementArmement, surChangement: (arme: boolean) => void, delaiMs = DELAI_ARMEMENT_MS): () => void {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const desarmer = (): void => {
    if (minuteur !== undefined) clearTimeout(minuteur);
    minuteur = undefined;
    surChangement(false);
  };
  // Le compte repart de zéro à chaque retour : visible ET active pendant tout le délai, sinon rien.
  const armerBientot = (): void => {
    desarmer();
    if (env.document.visibilityState !== 'visible' || !env.document.hasFocus()) return;
    minuteur = setTimeout(() => { minuteur = undefined; surChangement(true); }, delaiMs);
  };
  const visibilite = (): void => { if (env.document.visibilityState === 'visible') armerBientot(); else desarmer(); };
  env.fenetre.addEventListener('focus', armerBientot);
  env.fenetre.addEventListener('blur', desarmer);
  env.document.addEventListener('visibilitychange', visibilite);
  armerBientot();
  return () => {
    if (minuteur !== undefined) clearTimeout(minuteur);
    env.fenetre.removeEventListener('focus', armerBientot);
    env.fenetre.removeEventListener('blur', desarmer);
    env.document.removeEventListener('visibilitychange', visibilite);
  };
}

/**
 * Le bouton peut-il partir ? Faux au rendu serveur et pendant la demi-seconde qui suit chaque retour sur la page.
 * `arme` désactive le bouton à l'écran ; `estArme()` se relit dans le geste lui-même, sans attendre le rendu suivant de
 * React : un appui tombé entre le retour du focus et ce rendu trouve déjà le bouton désarmé.
 */
export function useArme(): { arme: boolean; estArme: () => boolean } {
  const [arme, setArme] = useState(false);
  const courant = useRef(false);
  useEffect(() => suivreArmement({ fenetre: window, document }, (a) => { courant.current = a; setArme(a); }), []);
  return { arme, estArme: () => courant.current };
}
