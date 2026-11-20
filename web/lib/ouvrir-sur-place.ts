import type { MouseEvent } from 'react';

/**
 * OUVRIR UN SCÉNARIO D'AUTOMATION SUR PLACE (Julien, 2026-11-20) : le lien « Ouvrir le scénario » garde son adresse
 * (`/workflows?open=<id>`), qu'un Ctrl, Cmd, Maj ou clic du milieu ouvrent toujours dans un autre onglet ; un clic simple
 * déplie le scénario sous la liste, au lieu de quitter la page. Rend `true` quand le clic est pris sur place.
 */
export function clicSurPlace(e: MouseEvent<HTMLElement>): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  e.preventDefault();
  return true;
}
