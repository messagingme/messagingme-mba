'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { TitrePage, IntroPage } from '@/components/TitrePage';
import { ParcoursNumero, BoutonPortail } from '@/components/ParcoursNumero';
import { QuiRegleMeta } from '@/components/QuiRegleMeta';
import { ChoixOffre } from '@/components/ChoixOffre';
import { MbaNotice } from '@/components/MbaNotice';
import { Bouton, classesBouton } from '@/components/Bouton';
import type { Session } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { getAccountStatus, type AccountStatusResponse } from '@/lib/api';
import { apiDeLaSession } from '@/lib/api/connexion-numero';
import { CLE_FORMULE, CLE_SUITE, enSuiteDeDemarrage, SUITE_DEMARRER } from '@/lib/demarrer';
import { useOffre } from '@/lib/use-offre';

/**
 * « CONNECTER WHATSAPP » dans la console (lot 3b, spec `docs/superpowers/specs/2026-10-05-numero-fourni-design.md`).
 * Le parcours lui-même vit dans `ParcoursNumero`, partagé avec `/brancher`, la page qu'ouvre le lien de Claude Code
 * (lot 3c) ; celle-ci y ajoute la coquille, la session et l'état du compte.
 *
 * « Qui paie vos messages à Meta ? » (`QuiRegleMeta`, révision du Crédit WhatsApp, lot B) ouvre le guide : la voie de la
 * carte chez Meta y mène, active par défaut. Un numéro connecté garde les deux cartes, qui disent l'état de son Crédit
 * WhatsApp ; une fois l'option arrêtée, la carte chez Meta y rouvre le guide.
 */
export default function ConnecterWhatsappPage() {
  return <AppShell active="accueil">{(session) => <ConnecterWhatsapp session={session} />}</AppShell>;
}

function ConnecterWhatsapp({ session }: { session: Session }) {
  const t = useT();
  const tenantId = session.tenantId;
  const isAdmin = session.role === 'admin';
  const [compte, setCompte] = useState<AccountStatusResponse | null>(null);
  const [avertissements, setAvertissements] = useState<string[]>([]);
  const api = useMemo(() => apiDeLaSession(tenantId), [tenantId]);

  const chargerCompte = useCallback(() => {
    getAccountStatus(tenantId).then(setCompte).catch(() => { /* l'écran reste utilisable sans le statut */ });
  }, [tenantId]);
  useEffect(() => { chargerCompte(); }, [chargerCompte]);

  // Une étape du tunnel de la Base (lot 19) : « Plus tard » tant que rien n'est connecté, « Continuer » ensuite, et les
  // deux mènent à la page finale. La mémoire de l'onglet garde la suite à travers le paiement d'un numéro fourni ; la
  // page finale l'efface.
  const [tunnel, setTunnel] = useState(false);
  useEffect(() => {
    let memoire: string | null = null;
    try { memoire = window.sessionStorage.getItem(CLE_SUITE); } catch { /* mémoire indisponible : l'adresse suffit */ }
    const oui = enSuiteDeDemarrage(window.location.search, memoire);
    if (oui) { try { window.sessionStorage.setItem(CLE_SUITE, SUITE_DEMARRER); } catch { /* idem */ } }
    setTunnel(oui);
  }, []);

  const connecte = compte?.hasNumber === true;

  // LA FORMULE D'ABORD (lot 3b, Julien, 2026-11-09) : un espace en Free, dans le tunnel, choisit sa formule avant son
  // numéro (`ChoixOffre`). Le retour de Stripe d'un Pro (`pro=recu`, `suiteApresPro`) dit l'essai commencé et ne repose
  // pas la question, même si le webhook n'a pas encore fait passer l'offre en Pro ; un paiement abandonné la repose. La
  // Free choisie est gardée dans l'onglet.
  const vue = useOffre(tenantId);
  const [proRetour, setProRetour] = useState<'recu' | 'abandon' | null>(null);
  const [freeChoisie, setFreeChoisie] = useState(false);
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('pro');
    setProRetour(r === 'recu' || r === 'abandon' ? r : null);
    try { setFreeChoisie(window.sessionStorage.getItem(CLE_FORMULE) === 'free'); } catch { /* mémoire indisponible : la question revient */ }
  }, []);
  const choisirFree = () => {
    try { window.sessionStorage.setItem(CLE_FORMULE, 'free'); } catch { /* idem */ }
    setFreeChoisie(true);
  };
  const formuleAChoisir = tunnel && isAdmin && compte !== null && !connecte && vue !== undefined && vue !== null
    && vue.offre === 'free' && proRetour !== 'recu' && !freeChoisie;
  // Le temps de lire le compte et l'offre, rien : ni la question, ni « Qui paie vos messages à Meta ? » qu'elle précède.
  const formuleEnLecture = tunnel && isAdmin && !connecte && (compte === null || vue === undefined);
  /** Après une connexion, par la carte chez Meta comme par la ligne du partenaire : ses avertissements, puis le compte relu. */
  const apresConnexion = (av: string[]) => { setAvertissements(av); chargerCompte(); };
  const parcours = (
    <ParcoursNumero
      tenantId={tenantId}
      api={api}
      choixInitial={null}
      retour="console"
      connecte={false}
      surConnexion={apresConnexion}
    />
  );
  // Connecté avec un numéro fourni payé : l'abonnement se gère encore d'ici (jaune 1 de la relecture de la livraison B).
  // Résilié (lot 4) : un nouveau paiement rend le MÊME numéro, sans refaire la fenêtre de Meta.
  const [statut, setStatut] = useState<string | null>(null);
  const abonne = statut !== null;
  /** Le numéro connecté est-il le numéro fourni ? Seul ce numéro se réabonne (jaune 2 de la relecture du lot 4, A). */
  const [numeroFourniConnecte, setNumeroFourniConnecte] = useState(false);
  const [reabonnement, setReabonnement] = useState<{ enCours: boolean; erreur: string | null }>({ enCours: false, erreur: null });
  const seReabonner = async () => {
    setReabonnement({ enCours: true, erreur: null });
    try { window.location.assign((await api.payer('console')).url); } catch (err) {
      setReabonnement({ enCours: false, erreur: err instanceof Error ? err.message : t('Une erreur est survenue', 'Something went wrong') });
    }
  };
  useEffect(() => {
    if (!connecte || !isAdmin) return;
    api.etat().then((r) => {
      setStatut(r.etat.abonnement?.statut ?? null);
      const fourni = r.etat.fourni?.replace(/\D/g, '') ?? null;
      const chiffres = r.etat.connecte?.chiffres ?? null;
      setNumeroFourniConnecte(fourni !== null && chiffres !== null && (chiffres === '' || chiffres === fourni));
    }).catch(() => {});
  }, [connecte, isAdmin, api]);
  return (
    <div className="mx-auto max-w-formulaire">
      <TitrePage>{t('Connecter WhatsApp', 'Connect WhatsApp')}</TitrePage>
      <IntroPage>{t('Un numéro WhatsApp pour votre espace : le vôtre, ou un numéro que nous vous fournissons.', 'A WhatsApp number for your workspace: yours, or one we provide.')}</IntroPage>
      {proRetour === 'recu' && !connecte && (
        <div className="mt-4"><MbaNotice kind="success" testid="essai-pro-commence">
          {t('Votre essai de la formule Pro commence : rien n’est prélevé avant sa fin. Il reste à connecter votre numéro.', 'Your Pro plan trial starts: nothing is charged before it ends. All that is left is to connect your number.')}
        </MbaNotice></div>
      )}
      {proRetour === 'abandon' && formuleAChoisir && (
        <div className="mt-4"><MbaNotice kind="warning" testid="essai-pro-abandonne">
          {t('Paiement abandonné : rien n’a été prélevé. Choisissez votre formule.', 'Payment cancelled: nothing was charged. Choose your plan.')}
        </MbaNotice></div>
      )}

      {connecte ? (
        <div data-testid="numero-connecte" className="mt-6 rounded-carte border border-ink-200 bg-white p-5">
          <div className="text-lg font-semibold text-ink-900">{t('Votre numéro WhatsApp est connecté', 'Your WhatsApp number is connected')}</div>
          <p className="mt-1 text-sm text-ink-500">{compte?.number ?? ''}</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {tunnel ? (
              <Link href="/demarrer" className={classesBouton('principal', 'petite')} data-testid="numero-continuer">{t('Continuer', 'Continue')}</Link>
            ) : (
              <Link href="/accueil" className="inline-block text-sm font-semibold text-ink-900 underline">{t('Retour à l’accueil', 'Back to home')}</Link>
            )}
            {statut === 'resilie' && numeroFourniConnecte ? (
              <Bouton type="button" taille="petite" enCours={reabonnement.enCours} disabled={reabonnement.enCours} onClick={() => { void seReabonner(); }} data-testid="se-reabonner">
                {t('Se réabonner (3,50 € HT par mois)', 'Renew (€3.50 excl. VAT per month)')}
              </Bouton>
            ) : abonne && <BoutonPortail api={api} />}
            {reabonnement.erreur && <span className="text-xs text-danger-700">{reabonnement.erreur}</span>}
          </div>
        </div>
      ) : !isAdmin ? (
        <p className="mt-6 text-sm text-ink-500">{t('Réservé aux admins de l’espace.', 'Workspace admins only.')}</p>
      ) : formuleEnLecture ? null : formuleAChoisir && vue ? (
        <ChoixOffre tenantId={tenantId} vue={vue} surFree={choisirFree} />
      ) : (
        <QuiRegleMeta tenantId={tenantId} admin lieu="connecter" api={api} surConnexion={apresConnexion}>{parcours}</QuiRegleMeta>
      )}
      {connecte && <QuiRegleMeta tenantId={tenantId} admin={isAdmin} lieu="connecter" connecte>{isAdmin && parcours}</QuiRegleMeta>}

      {tunnel && !connecte && (
        <Link href="/demarrer" className="mt-6 inline-block text-sm font-semibold text-ink-900 underline" data-testid="numero-plus-tard">
          {t('Plus tard', 'Later')}
        </Link>
      )}

      {avertissements.length > 0 && (
        <p data-testid="avertissements-connexion" className="mt-4 rounded-controle bg-alerte-50 px-3 py-2 text-xs text-alerte-700">
          {t('À savoir', 'Note')} : {avertissements.join(' · ')}
        </p>
      )}
    </div>
  );
}
