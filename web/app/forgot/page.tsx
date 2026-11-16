'use client';

import { useState } from 'react';
import Link from 'next/link';
import { forgotPassword } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { hourMin } from '@/lib/day';
import { CadreSansCompte } from '@/components/CadreSansCompte';
import { useLocale, useT } from '@/lib/i18n';
import { inputCls } from '@/lib/ui';
import { Bouton } from '@/components/Bouton';

export default function ForgotPage() {
  const t = useT();
  const { locale } = useLocale();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      /**
       * Un refus de débit (429) se dit : les plafonds se comptent avant toute lecture et valent aussi pour une adresse
       * inconnue, donc ce refus ne révèle aucun compte (lot E de l'audit). Sur cette route, seul le plafond du jour (cinq
       * liens par adresse) fait attendre plus d'une minute : le réseau compte à la minute, une base muette quelques
       * secondes. Les deux messages sont ceux de la console, traduits ; toute autre erreur garde le message générique
       * (anti-énumération).
       */
      if (err instanceof ApiError && err.status === 429) {
        if (err.attenteMs !== undefined && err.attenteMs > 60_000) {
          const heure = hourMin(new Date(Date.now() + err.attenteMs).toISOString(), locale);
          setError(t(
            `Plusieurs liens de réinitialisation sont déjà partis vers cette adresse aujourd’hui. Chacun vaut une heure : ouvrez le plus récent. Nouvelle demande possible à partir de ${heure}.`,
            `Several reset links have already been sent to this address today. Each one is valid for an hour: open the most recent. A new request is possible from ${heure}.`,
          ));
        } else {
          setError(t('Trop de demandes en ce moment : réessayez dans une minute.', 'Too many requests right now: try again in a minute.'));
        }
      } else {
        setSent(true);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <CadreSansCompte titre={t('Mot de passe oublié', 'Forgot password')}>
      {sent ? (
        <div className="rounded-carte border border-ink-200 bg-white p-6 text-center">
          <p className="text-sm text-ink-900">{t('Si un compte existe pour cet email, un lien de réinitialisation vient d’être envoyé. Pensez à vérifier vos spams.', 'If an account exists for this email, a reset link has just been sent. Remember to check your spam folder.')}</p>
          <Link href="/login" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">{t('Retour à la connexion', 'Back to login')}</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4 rounded-carte border border-ink-200 bg-white p-6">
          <p className="text-sm text-ink-500">{t('Saisissez votre email : nous vous envoyons un lien pour choisir un nouveau mot de passe.', 'Enter your email: we will send you a link to choose a new password.')}</p>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder={t('vous@entreprise.fr', 'you@company.com')} />
          {error && <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700" data-testid="forgot-erreur">{error}</p>}
          <Bouton enCours={loading} type="submit" disabled={loading} className="w-full">
            {loading ? t('Envoi…', 'Sending…') : t('Envoyer le lien', 'Send the link')}
          </Bouton>
          <p className="text-center text-xs text-ink-500"><Link href="/login" className="font-medium text-brand-600 hover:underline">{t('Retour', 'Back')}</Link></p>
        </form>
      )}
    </CadreSansCompte>
  );
}
