'use client';

import { useT } from '@/lib/i18n';

/** Le libellé du bouton pendant la validation, partagé par les écrans qui ouvrent la fenêtre de Meta. */
export const VALIDATION_BOUTON = { fr: 'Validation de la connexion…', en: 'Validating the connection…' } as const;

/**
 * La fenêtre de Meta fermée sur un succès, le serveur finit la connexion : jusqu'à une demi-minute sans rien à l'écran
 * jusque-là (essai 263, Julien, 2026-11-16). Un encadré le dit, avec un point qui pulse, tant que dure la validation.
 */
export function ValidationConnexion({ visible }: { visible: boolean }) {
  const t = useT();
  if (!visible) return null;
  return (
    <div data-testid="validation-connexion" role="status" className="mt-4 rounded-carte border-2 border-brand-500 bg-brand-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        <span aria-hidden className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-brand-500 motion-reduce:animate-none" />
        {t('Meta a accepté votre numéro : nous finalisons la connexion.', 'Meta accepted your number: we are finishing the connection.')}
      </p>
      <p className="mt-1 text-sm text-ink-700">
        {t('Cela peut prendre jusqu’à une minute. Gardez cette page ouverte.', 'This can take up to a minute. Keep this page open.')}
      </p>
    </div>
  );
}
