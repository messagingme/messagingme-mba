'use client';

import { useT } from '@/lib/i18n';

/**
 * UNE CAPTURE D'ÉCRAN AU SURVOL (2026-11-19) : « Voir l'écran » à côté d'une étape faite chez un tiers, et la capture
 * annotée s'ouvre au survol, ou au focus (clavier, et un appui sur téléphone). En CSS seul : aucun état, aucun voile.
 * Elle s'affiche CENTRÉE À L'ÉCRAN, bornée en hauteur : sous le lien, elle sortait de l'écran. Et elle ne prend pas la
 * souris (`pointer-events-none`) : sinon, ouverte, elle recouvrait le lien de l'étape suivante et restait ouverte.
 * Les captures vivent dans `web/public/aide/`.
 * 🔴 SON GROUPE EST NOMMÉ (`group/capture`) : un `group-hover` nu répond au survol de N'IMPORTE quel ancêtre `group`.
 * Posée dans un volet de Tools > Intégrations (lui-même un `group`), chaque capture de la carte Shopify s'ouvrait au
 * survol du volet, toutes à la fois (2026-11-20).
 */
export function CaptureAuSurvol({ src, alt, testid }: { src: string; alt: string; testid?: string }) {
  const t = useT();
  return (
    <span className="group/capture relative inline-block align-baseline" data-testid={testid}>
      <button type="button" className="text-brand-600 underline decoration-dotted underline-offset-2">
        {t('Voir l’écran', 'See the screen')}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible fixed left-1/2 top-1/2 z-50 w-max max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-carte border border-ink-200 bg-white p-1 opacity-0 shadow-mm-md transition-opacity group-focus-within/capture:visible group-focus-within/capture:opacity-100 group-hover/capture:visible group-hover/capture:opacity-100"
      >
        {/* Une capture servie telle quelle depuis `public/`, déjà réduite et en WebP : `next/image` n'y apporte rien. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" className="block max-h-[85vh] w-auto max-w-full rounded-controle" />
      </span>
    </span>
  );
}
