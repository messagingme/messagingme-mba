'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';

/**
 * LE DÉFI ANTI-ROBOT DE CLOUDFLARE (Turnstile) DE LA DEMANDE D'UN LIEN D'INSCRIPTION (lot identité B). Le plus souvent
 * invisible ; il rend un jeton, à usage unique et valable cinq minutes, que l'API vérifie avec sa clé secrète.
 *
 * Sans clé du site (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, figée au build), le composant ne rend rien : l'API n'exige alors
 * aucun défi tant que sa clé secrète n'est pas posée (`DEPLOY.md`, l'ordre des clés). Le script se charge à la demande,
 * en rendu explicite, depuis l'adresse que la CSP de la console autorise (`script-src` et `frame-src`).
 * `generation` : un nombre que le parent augmente après chaque envoi, pour un jeton neuf (un jeton ne sert qu'une fois).
 */
declare global {
  interface Window {
    turnstile?: {
      render(conteneur: HTMLElement, options: Record<string, unknown>): string;
      remove(id: string): void;
    };
  }
}

export const CLE_SITE_TURNSTILE = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const SCRIPT_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let chargement: Promise<void> | null = null;
function chargerTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  chargement ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_TURNSTILE;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      chargement = null;
      reject(new Error('Turnstile indisponible'));
    };
    document.head.appendChild(script);
  });
  return chargement;
}

export function DefiTurnstile({ onJeton, generation }: { onJeton: (jeton: string | null) => void; generation: number }) {
  const t = useT();
  const conteneur = useRef<HTMLDivElement>(null);
  // Le rappel du parent change à chaque rendu : lu par référence, il ne recrée pas le widget.
  const rappel = useRef(onJeton);
  rappel.current = onJeton;
  /**
   * Le défi ne se charge pas (un bloqueur de publicités, un réseau qui filtre Cloudflare) : sans message, le bouton
   * resterait grisé sans raison. On le dit, et l'on montre les deux sorties.
   */
  const [indisponible, setIndisponible] = useState(false);

  useEffect(() => {
    if (!CLE_SITE_TURNSTILE || !conteneur.current) return;
    let id: string | undefined;
    let fini = false;
    rappel.current(null);
    setIndisponible(false);
    const echec = (): void => {
      rappel.current(null);
      if (!fini) setIndisponible(true);
    };
    chargerTurnstile()
      .then(() => {
        if (fini || !conteneur.current || !window.turnstile) return;
        id = window.turnstile.render(conteneur.current, {
          sitekey: CLE_SITE_TURNSTILE,
          callback: (jeton: string) => { setIndisponible(false); rappel.current(jeton); },
          'error-callback': echec,
        });
      })
      .catch(echec);
    return () => {
      fini = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [generation]);

  if (!CLE_SITE_TURNSTILE) return null;
  return (
    <div>
      <div ref={conteneur} data-testid="defi-turnstile" />
      {indisponible && (
        <p className="mt-2 text-xs text-danger-700" role="alert">
          {t(
            'Le contrôle anti-robot ne se charge pas (un bloqueur de publicités ?) : autorisez challenges.cloudflare.com pour cette page, ou continuez avec Google.',
            'The anti-bot check does not load (an ad blocker?): allow challenges.cloudflare.com on this page, or continue with Google.',
          )}
        </p>
      )}
    </div>
  );
}
