'use client';

import type { ReactNode } from 'react';

/**
 * UNE LIGNE DE LA CARTE SHOPIFY (Julien, 2026-11-26 : « je veux que visuellement ils soient alignés ») : le libellé et son
 * détail à gauche, le bouton à droite, dans une colonne de la même largeur pour toute la carte. Le bouton prend toute la
 * colonne (`w-full`) : les boutons de la carte s'alignent bord à bord, quelle que soit la longueur de leur texte.
 */
export function LigneShopify({ libelle, detail, bouton, grand = false, testid }: {
  libelle: ReactNode;
  /** Ce qui s'écrit sous le libellé : la date du dernier geste, un état, une erreur. */
  detail?: ReactNode;
  bouton?: ReactNode;
  /** L'en-tête de la carte : le nom de la boutique, en grand. */
  grand?: boolean;
  testid?: string;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4" data-testid={testid}>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className={grand ? 'text-base font-semibold text-ink-900' : 'text-ink-900'}>{libelle}</div>
        {detail}
      </div>
      {bouton && <div className="sm:w-56 sm:shrink-0">{bouton}</div>}
    </div>
  );
}
