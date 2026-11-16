'use client';

import { useT } from '@/lib/i18n';
import { aideErreurMeta } from '@/lib/partage/erreurs-meta';

/**
 * L'aide d'une erreur sur laquelle la fenêtre de Meta s'est fermée (essai 263) : sa cause et ses sorties, à la place du
 * seul « Connexion Meta annulée ». Rien pour une erreur que nous ne savons pas expliquer.
 */
export function AideErreurMeta({ code }: { code: string | null }) {
  const t = useT();
  const aide = aideErreurMeta(code);
  if (!aide) return null;
  return (
    <div data-testid="aide-erreur-meta" data-code={aide.code} className="mt-4 rounded-carte border border-alerte-200 bg-alerte-50 p-4 text-sm text-ink-900">
      <p className="font-semibold">{t(aide.titre.fr, aide.titre.en)}</p>
      <p className="mt-1 text-ink-700">{t(aide.cause.fr, aide.cause.en)}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-700">
        {aide.sorties.map((s) => <li key={s.fr}>{t(s.fr, s.en)}</li>)}
      </ul>
    </div>
  );
}
