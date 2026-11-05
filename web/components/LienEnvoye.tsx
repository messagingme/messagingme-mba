'use client';

import { useT } from '@/lib/i18n';
import { HEURES_LIEN_INSCRIPTION } from '@/lib/partage/inscription';
import { Bouton } from '@/components/Bouton';

/**
 * L'ÉCRAN « LIEN ENVOYÉ » DE L'INSCRIPTION (lot identité B). Une adresse inconnue ne crée rien à la demande : un lien
 * vient de partir, et l'espace naîtra au clic. Aucune session ici. Venue d'une application (`/autoriser`, la connexion
 * de Claude Code sans Google), la suite de l'autorisation reste dans CET onglet : le lien s'ouvre ailleurs, puis on
 * revient cliquer « Continuer ».
 */
export function LienEnvoye({ email, onContinuer, onAutreAdresse }: {
  email: string;
  /** Présent quand l'inscription vient d'une demande d'autorisation : « Continuer » y retourne. */
  onContinuer?: () => void;
  onAutreAdresse: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-4 rounded-carte border border-ink-200 bg-white p-6" role="status">
      <h2 className="text-base font-semibold text-ink-900">{t('Vérifiez votre boîte de réception', 'Check your inbox')}</h2>
      <p className="text-sm text-ink-700">
        {t('Un lien pour créer votre espace vient de partir vers', 'A link to create your workspace was just sent to')}{' '}
        <strong className="font-medium text-ink-900">{email}</strong>.{' '}
        {t(
          `Il est valable ${HEURES_LIEN_INSCRIPTION} heures et ne sert qu’une fois. Vous y choisirez le nom de l’espace et votre mot de passe.`,
          `It is valid for ${HEURES_LIEN_INSCRIPTION} hours and works only once. You will choose the workspace name and your password there.`,
        )}
      </p>
      <p className="text-xs text-ink-500">{t('Rien reçu ? Regardez dans les indésirables, ou utilisez une autre adresse.', 'Nothing received? Check your spam folder, or use another address.')}</p>
      {onContinuer && (
        <>
          <p className="text-sm text-ink-700">
            {t(
              'Ouvrez le lien sur cet ordinateur, dans ce navigateur. Une fois votre espace créé, revenez ici et cliquez « Continuer » pour autoriser l’application.',
              'Open the link on this computer, in this browser. Once your workspace is created, come back here and click “Continue” to authorize the application.',
            )}
          </p>
          <Bouton type="button" onClick={onContinuer} className="w-full">{t('Continuer', 'Continue')}</Bouton>
        </>
      )}
      <Bouton type="button" variante="secondaire" onClick={onAutreAdresse} className="w-full">{t('Utiliser une autre adresse', 'Use another address')}</Bouton>
    </div>
  );
}
