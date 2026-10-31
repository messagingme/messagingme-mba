'use client';

import { useT } from '@/lib/i18n';

/** La politique de confidentialité de messagingme.fr (français, anglais) : la case et la page d'autorisation la citent. */
export const POLITIQUE_DE_CONFIDENTIALITE: readonly [string, string] = [
  'https://www.messagingme.fr/politique-de-confidentialite-messaging-me/',
  'https://www.messagingme.fr/en/politique-de-confidentialite-messaging-me/',
];

/**
 * LA CASE DE L'ACCORD PUBLICITAIRE (pixel Meta, lot 3), sur `/signup` et `/autoriser`. 🔴 NON COCHÉE PAR DÉFAUT, et
 * sans elle rien ne part chez Meta (`champPub`). Le texte couvre les trois usages que le produit en fait : mesurer nos
 * publicités, les montrer à la personne, les montrer à des personnes au profil proche. L'accord se retire dans
 * « Mon compte ».
 */
export function CasePartageMeta({ coche, onChange }: { coche: boolean; onChange: (coche: boolean) => void }) {
  const t = useT();
  return (
    <label className="flex items-start gap-2 text-xs text-ink-700" data-testid="case-partage-meta">
      <input type="checkbox" className="mt-0.5" checked={coche} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {t(
          'J’accepte que Messaging Me transmette à Meta (Facebook) mon inscription, la connexion de mon premier numéro WhatsApp et mon premier paiement, avec mon adresse e-mail sous une forme non lisible, pour mesurer ses publicités, me les montrer et les montrer à des personnes au profil proche. Je peux le retirer à tout moment dans « Mon compte ».',
          'I agree that Messaging Me shares my sign-up, the connection of my first WhatsApp number and my first payment, with my e-mail address in an unreadable form, with Meta (Facebook) to measure its ads, show them to me and to people with a similar profile. I can withdraw this at any time in “My account”.',
        )}{' '}
        <a href={t(...POLITIQUE_DE_CONFIDENTIALITE)} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">
          {t('Politique de confidentialité', 'Privacy policy')}
        </a>
      </span>
    </label>
  );
}
