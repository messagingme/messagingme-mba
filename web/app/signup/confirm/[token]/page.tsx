'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  confirmerInscription, codeDuRefus, isLoginChoice, estEtapeSecondFacteur,
  type EtapeSecondFacteur, type SuiteConnexion, type SuiteInscription,
} from '@/lib/api';
import { arriveeDUnNouvelEspace, clearSession, saveSession } from '@/lib/session';
import { CadreSansCompte } from '@/components/CadreSansCompte';
import { useT } from '@/lib/i18n';
import { inputCls } from '@/lib/ui';
import { aideMotDePasse } from '@/lib/mot-de-passe';
import { MIN_MOT_DE_PASSE } from '@/lib/partage/mot-de-passe';
import { REFUS_INSCRIPTION } from '@/lib/partage/inscription';
import { Bouton } from '@/components/Bouton';
import { EtapesSecondFacteur, EtapeInterrompue } from '@/components/SecondFacteur';
import { CasePartageMeta } from '@/components/CasePartageMeta';
import { champPub } from '@/lib/pub';

/**
 * LA PAGE DU LIEN D'INSCRIPTION (lot identité B). Le lien vient de l'e-mail ; la personne qui l'ouvre choisit ICI le
 * nom de l'espace, son mot de passe et l'accord publicitaire, jamais celle qui a rempli le formulaire.
 * 🔴 AUCUN APPEL AVANT L'ENVOI DU FORMULAIRE : une messagerie qui ouvre le lien pour l'examiner ne doit rien consommer.
 * Un refus (lien mort, adresse déjà connue) ne vide jamais une autre session du navigateur : l'appel est en mode `etape`.
 */
export default function ConfirmerInscriptionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useT();
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  /** L'accord publicitaire (pixel Meta) : NON coché par défaut, donné ici par qui a reçu le lien. */
  const [partage, setPartage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  /** L'espace est créé ; la demande venait d'une application (Claude Code) : la suite est dans l'onglet de connexion. */
  const [retourOnglet, setRetourOnglet] = useState(false);
  /** Rare pour une identité neuve : un second facteur exigé. */
  const [etape, setEtape] = useState<EtapeSecondFacteur | null>(null);
  const [suite, setSuite] = useState<SuiteInscription | undefined>(undefined);
  const [interrompu, setInterrompu] = useState<string | null>(null);

  function entrer(res: SuiteConnexion, inscription: SuiteInscription | undefined): void {
    if (isLoginChoice(res)) {
      router.replace('/login');
      return;
    }
    // Une autre session ouverte dans ce navigateur (un autre compte) ne reste pas sous la nouvelle.
    clearSession();
    saveSession({ token: res.token, email: res.user.email, role: res.user.role, tenantId: res.user.tenantId });
    if (inscription?.application) {
      setRetourOnglet(true);
      return;
    }
    router.replace(arriveeDUnNouvelEspace(inscription?.offre === 'pro'));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await confirmerInscription({
        jeton: token, workspaceName: workspaceName.trim(), name: name.trim() || undefined, password,
        pub: champPub(partage, window.location.search),
      });
      setPassword('');
      if (estEtapeSecondFacteur(res)) {
        setSuite(res.inscription);
        setEtape(res);
      } else entrer(res, res.inscription);
    } catch (err) {
      const code = codeDuRefus(err);
      if (code === REFUS_INSCRIPTION.lienInvalide || code === REFUS_INSCRIPTION.adresseConnue) setRefus(code);
      else setError(err instanceof Error ? err.message : t('Création impossible', 'Creation failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <CadreSansCompte titre={t('Créer votre espace', 'Create your workspace')} sousTitre={t('Votre adresse est confirmée : il reste à nommer votre espace et à choisir votre mot de passe.', 'Your address is confirmed: name your workspace and choose your password.')}>
      {retourOnglet ? (
        <div className="space-y-3 rounded-carte border border-ink-200 bg-white p-6" role="status">
          <h2 className="text-base font-semibold text-ink-900">{t('Votre espace est créé', 'Your workspace is created')}</h2>
          <p className="text-sm text-ink-700">{t('Revenez à l’onglet de connexion de votre application et cliquez « Continuer » pour l’autoriser.', 'Go back to your application’s sign-in tab and click “Continue” to authorize it.')}</p>
        </div>
      ) : refus === REFUS_INSCRIPTION.adresseConnue ? (
        <div className="space-y-3 rounded-carte border border-ink-200 bg-white p-6" role="alert">
          <p className="text-sm text-ink-700">{t('Cette adresse a déjà un compte : connectez-vous.', 'This address already has an account: sign in.')}</p>
          <Link href="/login" className="font-medium text-brand-600 hover:underline">{t('Se connecter', 'Sign in')}</Link>
        </div>
      ) : refus === REFUS_INSCRIPTION.lienInvalide ? (
        <div className="space-y-3 rounded-carte border border-ink-200 bg-white p-6" role="alert">
          <p className="text-sm text-ink-700">{t('Ce lien ne vaut plus : il a expiré, ou il a déjà servi.', 'This link is no longer valid: it has expired or was already used.')}</p>
          <Link href="/signup" className="font-medium text-brand-600 hover:underline">{t('Refaire une demande', 'Request a new link')}</Link>
        </div>
      ) : etape ? (
        <EtapesSecondFacteur etape={etape} onSuite={(res: SuiteConnexion) => entrer(res, suite)} onRetour={(message) => { setEtape(null); setInterrompu(message); }} />
      ) : interrompu ? (
        <EtapeInterrompue message={interrompu} />
      ) : (
        <form onSubmit={onSubmit} className="space-y-4 rounded-carte border border-ink-200 bg-white p-6">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-900">{t("Nom de l’espace / entreprise", 'Workspace / company name')}</label>
            <input required maxLength={80} value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} className={inputCls} placeholder={t('Mon entreprise', 'My company')} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-900">{t('Votre nom', 'Your name')}</label>
            <input maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder={t('Prénom Nom', 'First Last')} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-900">{t('Votre mot de passe', 'Your password')}</label>
            <input type="password" required minLength={MIN_MOT_DE_PASSE} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder={t(aideMotDePasse().fr, aideMotDePasse().en)} />
          </div>

          <CasePartageMeta coche={partage} onChange={setPartage} />

          {error && <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}

          <Bouton enCours={loading} type="submit" disabled={loading} className="w-full">
            {loading ? t('Création…', 'Creating…') : t('Créer mon espace', 'Create my workspace')}
          </Bouton>
        </form>
      )}
    </CadreSansCompte>
  );
}
