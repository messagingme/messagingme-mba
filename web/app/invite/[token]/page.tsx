'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  acceptInvitation, accepterInvitationGoogle, codeDuRefus, estEtapeSecondFacteur, isLoginChoice, lireApercuInvitation,
  type EtapeSecondFacteur, type LectureApercuInvitation, type SuiteConnexion,
} from '@/lib/api';
import { saveSession, pageDArrivee } from '@/lib/session';
import { EtapesSecondFacteur, EtapeInterrompue } from '@/components/SecondFacteur';
import { CadreSansCompte } from '@/components/CadreSansCompte';
import { GoogleButton } from '@/components/GoogleButton';
import { useT } from '@/lib/i18n';
import { inputCls } from '@/lib/ui';
import { aideMotDePasse } from '@/lib/mot-de-passe';
import { MIN_MOT_DE_PASSE } from '@/lib/partage/mot-de-passe';
import { libelleInvitant } from '@/lib/partage/invitation';
import { Bouton } from '@/components/Bouton';

/**
 * LA PAGE D'UNE INVITATION (lot identité C) : la seule porte d'un compte créé par une invitation. Elle lit d'abord
 * l'aperçu (l'espace, qui invite, si l'adresse a déjà un mot de passe), sans rien consommer ; puis on y entre par Google à
 * l'adresse invitée, par le mot de passe ACTUEL d'une adresse qui en a un, ou par un mot de passe choisi.
 *
 * 🔴 Sans aperçu lisible (ancienne API, panne, réponse inattendue), l'ancien formulaire SANS Google : l'ancien bouton
 * appelait `/auth/google`, qui crée un espace neuf au lieu d'accepter l'invitation.
 */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const t = useT();
  /** null : l'aperçu se lit encore. */
  const [lecture, setLecture] = useState<LectureApercuInvitation | null>(null);
  /** L'adresse a reçu un mot de passe entre l'aperçu et l'envoi (409) : la page demande désormais l'actuel. */
  const [actuelExige, setActuelExige] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Invitation d'administrateur, ou adresse qui a déjà un second facteur : l'étape passe avant la session. */
  const [etape, setEtape] = useState<EtapeSecondFacteur | null>(null);
  /** L'étape n'a pas abouti. L'invitation est CONSOMMÉE : le formulaire ne la rejouerait pas, la connexion si. */
  const [interrompu, setInterrompu] = useState<string | null>(null);

  useEffect(() => {
    let fini = false;
    void lireApercuInvitation(token).then((l) => { if (!fini) setLecture(l); });
    return () => { fini = true; };
  }, [token]);

  const apercu = lecture?.statut === 'ok' ? lecture.apercu : null;
  /** Le champ demande le mot de passe ACTUEL : sans minimum de longueur, un ancien mot de passe plus court reste bon. */
  const actuel = actuelExige || apercu?.aUnMotDePasse === true;

  function entrer(res: SuiteConnexion): void {
    // Impossible par construction (l'invitation ouvre un seul espace) : la connexion saura demander.
    if (isLoginChoice(res)) {
      router.replace('/login');
      return;
    }
    saveSession({ token: res.token, email: res.user.email, role: res.user.role, tenantId: res.user.tenantId });
    router.replace(pageDArrivee(res.user.role));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await acceptInvitation(token, password);
      if (estEtapeSecondFacteur(res)) {
        setPassword('');
        setEtape(res);
        return;
      }
      entrer(res);
    } catch (err) {
      const code = codeDuRefus(err);
      if (code === 'mot_de_passe_existe') {
        setActuelExige(true);
        setPassword('');
        setError(t('Cette adresse a désormais un mot de passe : saisissez-le.', 'This address now has a password: enter it.'));
      } else if (code === 'mot_de_passe_incorrect') {
        // Sans aperçu (ancien formulaire, « choisissez »), c'est aussi ce que répond l'API à une adresse qui a déjà un mot
        // de passe : la page demande alors l'actuel, sans minimum de longueur, avec « Mot de passe oublié ? ».
        setActuelExige(true);
        setError(t('Mot de passe incorrect.', 'Incorrect password.'));
      } else {
        setError(err instanceof Error ? err.message : t('Invitation invalide ou expirée', 'Invalid or expired invitation'));
      }
    } finally {
      setLoading(false);
    }
  }

  async function parGoogle(idToken: string): Promise<void> {
    setError(null);
    try {
      entrer(await accepterInvitationGoogle(token, idToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Connexion Google impossible', 'Google sign-in failed'));
    }
  }

  const sousTitre = lecture === null
    ? t('Lecture de l’invitation…', 'Reading the invitation…')
    : lecture.statut === 'invalide'
      ? t('Cette invitation n’est plus valable : elle a expiré, ou elle a déjà servi.', 'This invitation is no longer valid: it has expired or was already used.')
      : lecture.statut === 'indisponible'
        ? t('Choisissez votre mot de passe pour activer votre compte.', 'Choose a password to activate your account.')
        : actuel
          ? t('Saisissez votre mot de passe actuel, ou continuez avec Google.', 'Enter your current password, or continue with Google.')
          : t('Choisissez votre mot de passe, ou continuez avec Google.', 'Choose a password, or continue with Google.');

  return (
    <CadreSansCompte titre={t("Rejoindre l’espace", 'Join the workspace')} sousTitre={sousTitre}>
      {etape ? (
        <EtapesSecondFacteur etape={etape} onSuite={entrer} onRetour={(message) => { setEtape(null); setInterrompu(message); }} />
      ) : interrompu ? (
        <EtapeInterrompue message={interrompu} />
      ) : lecture === null ? null : lecture.statut === 'invalide' ? (
        <p className="text-center text-sm text-ink-700">
          <Link href="/login" className="font-medium text-brand-600 hover:underline">{t('Se connecter', 'Sign in')}</Link>
        </p>
      ) : (
      <form onSubmit={onSubmit} className="space-y-4 rounded-carte border border-ink-200 bg-white p-6">
        {apercu && (
          <div className="space-y-1 text-sm text-ink-700" data-testid="apercu-invitation">
            <p>
              {apercu.invitant
                ? <><strong className="text-ink-900">{libelleInvitant(apercu.invitant.nom, apercu.invitant.adresse)}</strong>{t(' vous invite dans ', ' invites you to ')}</>
                : t('Vous êtes invité dans ', 'You are invited to ')}
              <strong className="text-ink-900">{apercu.espace}</strong>.
            </p>
            <p className="text-xs text-ink-500">{t('Adresse invitée : ', 'Invited address: ')}{apercu.adresse}</p>
          </div>
        )}
        {actuel ? (
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls}
            autoComplete="current-password" placeholder={t('Votre mot de passe actuel', 'Your current password')} />
        ) : (
          <input type="password" required minLength={MIN_MOT_DE_PASSE} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls}
            autoComplete="new-password" placeholder={t(aideMotDePasse().fr, aideMotDePasse().en)} />
        )}
        {error && <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
        <Bouton enCours={loading} type="submit" disabled={loading} className="w-full">
          {loading ? t('Un instant…', 'One moment…') : apercu ? t('Rejoindre l’espace', 'Join the workspace') : t('Activer mon compte', 'Activate my account')}
        </Bouton>
        <p className="text-center text-xs text-ink-500">
          {actuel
            ? <Link href="/forgot" className="font-medium text-brand-600 hover:underline">{t('Mot de passe oublié ?', 'Forgot password?')}</Link>
            : <Link href="/login" className="font-medium text-brand-600 hover:underline">{t('Déjà activé ? Se connecter', 'Already activated? Sign in')}</Link>}
        </p>

        {/* Google seulement avec un aperçu lisible : il accepte CETTE invitation, à l'adresse invitée. */}
        {apercu && <GoogleButton onError={setError} surJeton={(idToken) => { void parGoogle(idToken); }} />}
      </form>
      )}
    </CadreSansCompte>
  );
}
