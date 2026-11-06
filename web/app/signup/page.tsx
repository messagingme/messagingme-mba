'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  signup, codeDuRefus, isLoginChoice, estEtapeSecondFacteur, estLienEnvoye,
  type EtapeSecondFacteur, type SuiteConnexion,
} from '@/lib/api';
import { arriveeDUnNouvelEspace, saveSession, veutLePro } from '@/lib/session';
import { avecDemande, demandeDeLAdresse } from '@/lib/oauth';
import { CadreSansCompte } from '@/components/CadreSansCompte';
import { GoogleButton, RetourGoogle } from '@/components/GoogleButton';
import { LienEnvoye } from '@/components/LienEnvoye';
import { CLE_SITE_TURNSTILE, DefiTurnstile } from '@/components/DefiTurnstile';
import { useLocale, useT } from '@/lib/i18n';
import { inputCls } from '@/lib/ui';
import { aideMotDePasse } from '@/lib/mot-de-passe';
import { MIN_MOT_DE_PASSE } from '@/lib/partage/mot-de-passe';
import { REFUS_INSCRIPTION } from '@/lib/partage/inscription';
import { Bouton } from '@/components/Bouton';
import { EtapesSecondFacteur, EtapeInterrompue } from '@/components/SecondFacteur';
import { CasePartageMeta } from '@/components/CasePartageMeta';
import { champPub, identifiantsPub } from '@/lib/pub';

/**
 * L'INSCRIPTION, ADRESSE D'ABORD (lot identité B, décision de Julien du 2026-11-05). L'étape de l'adresse n'envoie que
 * l'adresse : une adresse inconnue reçoit un lien, et c'est sur la page du lien que se choisissent le nom de l'espace et
 * le mot de passe, par qui a reçu l'e-mail. Une adresse déjà connue (409 `adresse_connue`) passe à l'étape du mot de
 * passe, qui ajoute un espace tout de suite, comme avant. Google reste une entrée d'un geste.
 */
export default function SignupPage() {
  const router = useRouter();
  const t = useT();
  const { locale } = useLocale();
  const [etapeFormulaire, setEtapeFormulaire] = useState<'adresse' | 'connue'>('adresse');
  const [workspaceName, setWorkspaceName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Le jeton du défi Turnstile, et sa génération : un jeton ne sert qu'une fois, chaque envoi en redemande un. */
  const [jetonDefi, setJetonDefi] = useState<string | null>(null);
  const [generationDefi, setGenerationDefi] = useState(0);
  /** L'adresse à qui un lien vient de partir : rien n'est créé ici, l'espace naît au clic. */
  const [lienPour, setLienPour] = useState<string | null>(null);
  /**
   * Une adresse connue qui ajoute un espace : d'ordinaire la session (un espace neuf n'exige pas le second facteur) ; une
   * étape seulement si l'adresse en a déjà un (son code) ou est admin d'un autre espace qui l'exige (l'enrôlement).
   */
  const [etape, setEtape] = useState<EtapeSecondFacteur | null>(null);
  /**
   * L'étape n'a pas abouti (expirée). L'espace EXISTE : renvoyer au formulaire en créerait un second, on
   * renvoie donc à la connexion, qui reprendra l'enrôlement.
   */
  const [interrompu, setInterrompu] = useState<string | null>(null);
  /** Venue de la page d'autorisation d'une application (Claude Code), sans compte Google : on y retourne ensuite. */
  const [demande, setDemande] = useState<string | null>(null);
  /** Venue du choix du Pro (`?offre=pro`, la fin Pro du guide du numéro de la vitrine) : l'espace créé va le souscrire. */
  const [pro, setPro] = useState(false);
  /**
   * L'accord publicitaire (pixel Meta) : NON coché par défaut. Il vaut pour Google et pour l'ajout d'un espace à une
   * adresse connue ; une adresse neuve le donne sur la page du lien, par qui a reçu l'e-mail.
   */
  const [partage, setPartage] = useState(false);

  // Lus ici et pas au rendu : l'adresse n'existe pas côté serveur.
  useEffect(() => {
    setDemande(demandeDeLAdresse(window.location.search));
    setPro(veutLePro(window.location.search));
  }, []);

  function entrer(res: SuiteConnexion): void {
    // Impossible par construction (l'inscription porte un seul espace) : la connexion saura demander.
    if (isLoginChoice(res)) {
      router.replace(avecDemande('/login', demande));
      return;
    }
    saveSession({ token: res.token, email: res.user.email, role: res.user.role, tenantId: res.user.tenantId });
    // Le tunnel de la Base (lot 19) : le numéro (sautable), puis la page finale, sans passer par l'accueil ; venu du
    // choix du Pro, sa souscription à la place. Venu d'une application, le consentement d'abord : c'est elle qui fait
    // la suite (`/messagingme:demarrer`).
    router.replace(demande !== null ? avecDemande('/autoriser', demande) : arriveeDUnNouvelEspace(pro));
  }

  /** L'étape de l'adresse : un lien pour une adresse inconnue, l'étape du mot de passe pour une adresse connue. */
  async function demanderLeLien(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await signup({
        email: email.trim(), langue: locale, ...(pro ? { offre: 'pro' as const } : {}),
        ...(demande !== null ? { application: true } : {}), ...identifiantsPub(window.location.search),
        ...(jetonDefi ? { turnstile: jetonDefi } : {}),
      });
      if (estLienEnvoye(res)) setLienPour(email.trim());
      else if (estEtapeSecondFacteur(res)) setEtape(res);
      else entrer(res);
    } catch (err) {
      if (codeDuRefus(err) === REFUS_INSCRIPTION.adresseConnue) setEtapeFormulaire('connue');
      else setError(err instanceof Error ? err.message : t('Inscription impossible', 'Sign-up failed'));
    } finally {
      setLoading(false);
      // Le jeton a servi (ou n'a pas pu servir) : un neuf pour l'envoi suivant.
      setJetonDefi(null);
      setGenerationDefi((g) => g + 1);
    }
  }

  /** Une adresse connue ajoute un espace avec son mot de passe, comme avant le lot. */
  async function ajouterUnEspace(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await signup({
        workspaceName: workspaceName.trim(), email: email.trim(), password, name: name.trim() || undefined,
        pub: champPub(partage, window.location.search),
      });
      setPassword('');
      if (estLienEnvoye(res)) setLienPour(email.trim());
      else if (estEtapeSecondFacteur(res)) setEtape(res);
      else entrer(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Inscription impossible', 'Sign-up failed'));
    } finally {
      setLoading(false);
    }
  }

  function autreAdresse(): void {
    setLienPour(null);
    setEtapeFormulaire('adresse');
    setPassword('');
    setError(null);
  }

  const connexion = avecDemande('/login', demande);

  return (
    <CadreSansCompte titre={t('Créer votre espace', 'Create your workspace')} sousTitre={t('Votre espace WhatsApp Business en quelques secondes.', 'Your WhatsApp Business workspace in seconds.')}>

      {lienPour !== null ? (
        <LienEnvoye
          email={lienPour}
          onAutreAdresse={autreAdresse}
          {...(demande !== null ? { onContinuer: () => router.push(avecDemande('/autoriser', demande)) } : {})}
        />
      ) : etape ? (
        <EtapesSecondFacteur etape={etape} onSuite={entrer} onRetour={(message) => { setEtape(null); setInterrompu(message); }} />
      ) : interrompu ? (
        <EtapeInterrompue message={interrompu} connexion={connexion} />
      ) : etapeFormulaire === 'connue' ? (
      <form onSubmit={ajouterUnEspace} className="space-y-4 rounded-carte border border-ink-200 bg-white p-6">
        <p className="text-sm text-ink-700" role="status">
          {t('Cette adresse a déjà un compte.', 'This address already has an account.')}{' '}
          <Link href={connexion} className="font-medium text-brand-600 hover:underline">{t('Connectez-vous', 'Sign in')}</Link>
          {t(', ou ajoutez un espace avec votre mot de passe.', ', or add a workspace with your password.')}
        </p>
        <p className="text-sm font-medium text-ink-900">{email.trim()}</p>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-900">{t("Nom du nouvel espace / entreprise", 'New workspace / company name')}</label>
          <input required maxLength={80} value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} className={inputCls} placeholder={t('Mon entreprise', 'My company')} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-900">{t('Votre nom', 'Your name')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder={t('Prénom Nom', 'First Last')} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-900">{t('Mot de passe', 'Password')}</label>
          <input type="password" required minLength={MIN_MOT_DE_PASSE} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder={t(aideMotDePasse().fr, aideMotDePasse().en)} />
        </div>

        <CasePartageMeta coche={partage} onChange={setPartage} />

        {error && <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}

        <Bouton enCours={loading} type="submit" disabled={loading} className="w-full">
          {loading ? t('Création…', 'Creating…') : t('Ajouter l’espace', 'Add the workspace')}
        </Bouton>
        <Bouton type="button" variante="secondaire" onClick={autreAdresse} className="w-full">{t('Utiliser une autre adresse', 'Use another address')}</Bouton>
      </form>
      ) : (
      <form onSubmit={demanderLeLien} className="space-y-4 rounded-carte border border-ink-200 bg-white p-6">
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-900">{t('Email', 'Email')}</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder={t('vous@entreprise.fr', 'you@company.com')} />
        </div>
        <p className="text-xs text-ink-500">{t('Un lien vous arrive par e-mail : vous y nommerez votre espace et choisirez votre mot de passe.', 'A link will be sent to you by e-mail: you will name your workspace and choose your password there.')}</p>

        <DefiTurnstile onJeton={setJetonDefi} generation={generationDefi} />

        {error && <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}

        {/* Avec le défi, l'envoi attend son jeton : sans lui, l'API refuserait. */}
        <Bouton enCours={loading} type="submit" disabled={loading || (CLE_SITE_TURNSTILE !== '' && jetonDefi === null)} className="w-full">
          {loading ? t('Envoi…', 'Sending…') : t('Continuer', 'Continue')}
        </Bouton>
        <p className="text-center text-xs text-ink-500">{t('Déjà un compte ?', 'Already have an account?')} <Link href={connexion} className="font-medium text-brand-600 hover:underline">{t('Se connecter', 'Log in')}</Link></p>

        {/* Venu d'une application, Google est sur la page d'autorisation : ici il ouvrirait la console et perdrait la
            demande. On y renvoie, pour une adresse qui est en fait un compte Google. */}
        {demande === null ? (
          <>
            <CasePartageMeta coche={partage} onChange={setPartage} />
            <GoogleButton onError={setError} pro={pro} pub={() => champPub(partage, window.location.search)} />
          </>
        ) : <RetourGoogle demande={demande} />}
      </form>
      )}
    </CadreSansCompte>
  );
}
