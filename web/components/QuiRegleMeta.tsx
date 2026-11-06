'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Bouton, classesBouton } from '@/components/Bouton';
import { DemarrerPro } from '@/components/DemarrerPro';
import { MbaNotice } from '@/components/MbaNotice';
import { estPageDePaiement } from '@/lib/api-credit';
import { lireEtatLigne, ouvrirOptionWhatsapp, type VueEtatLigne } from '@/lib/api-credit-whatsapp';
import { erreurDeChargement } from '@/lib/http';
import { useT } from '@/lib/i18n';
import { raisonAttenteOption } from '@/lib/offre';
import { AVERTISSEMENT_APPLICATION, QUESTION_PAIEMENT } from '@/lib/questions-numero';
import { relireOffre, useFormuleProADemarrer, useOffre } from '@/lib/use-offre';

/** Après un retour de Stripe ou un démarrage de la formule Pro : combien de fois, et tous les combien, on relit l'état. */
const RELECTURES = 15;
const INTERVALLE_MS = 2_000;

/**
 * « QUI PAIE VOS MESSAGES À META ? » (révision du Crédit WhatsApp du 2026-11-04, lot B) : deux cartes, chaque bouton sous
 * la sienne. Sur Connecter WhatsApp, c'est la première question du guide du numéro, et la voie de la carte chez Meta y
 * ouvre la suite (`children`) ; sur l'Accueil, tant qu'aucun numéro n'est connecté, elle y mène.
 *
 * « Ma carte chez Meta » est la voie active (spec, moment 1) : le numéro se connecte par notre application, et Meta le
 * facture. Elle cède la place quand une ligne est payée ou posée (`en_attente`, `active`), et se reprend d'un clic.
 *
 * « Crédit WhatsApp » dit ce que l'état de la ligne permet (`GET /credit-whatsapp/etat`, `etatLigneCredit` du serveur) :
 * grisée en Free et, tant que l'option n'est pas en vente en ligne, pendant l'essai comme après (« sur demande ») ; une
 * fois en vente, « Démarrer la formule Pro maintenant » pendant l'essai, « Prendre l'option » une fois la formule payée,
 * puis la ligne qui s'ouvre, active, ou arrêtée avec ses deux chemins. Les mots de la question sont ceux de la vitrine (`QUESTION_PAIEMENT`, tenus égaux par
 * `tests/questions-numero-vitrine.test.ts`) ; ceux de chaque état, validés par Julien le 2026-11-06.
 *
 * 🔴 LE RETOUR DE STRIPE NE PREND RIEN : il relit l'état jusqu'à voir l'option que le webhook écrit, et la prise reste
 * fermée en attendant (sinon le client la paierait deux fois, comme dans l'onglet).
 */
export function QuiRegleMeta({ tenantId, admin, lieu, connecte = false, children }: {
  tenantId: string;
  admin: boolean;
  /** `connecter` : la question du guide, et le retour de Stripe y arrive (`?option=`) ; `accueil` : elle mène au guide. */
  lieu: 'connecter' | 'accueil';
  /** Un numéro est connecté : la carte chez Meta ne rouvre le guide qu'une fois l'option arrêtée. */
  connecte?: boolean;
  /** La suite du guide, sous les cartes, quand la voie de la carte chez Meta est prise (Connecter WhatsApp). */
  children?: ReactNode;
}) {
  const t = useT();
  const vueOffre = useOffre(tenantId);
  const [vue, setVue] = useState<VueEtatLigne | null | undefined>(undefined);
  const [relectures, setRelectures] = useState(0);
  const [retour, setRetour] = useState<'recue' | 'abandon' | null>(null);
  /** La voie choisie d'un clic ; `null` : celle que l'état désigne. */
  const [carte, setCarte] = useState<boolean | null>(null);
  const [geste, setGeste] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  /** Une formule Pro démarrée d'ici : payée, l'état se relit le temps que le webhook l'écrive ; sinon, en cours chez la banque. */
  const [demarrage, setDemarrage] = useState<'paye' | 'en_attente' | null>(null);

  useEffect(() => {
    if (lieu !== 'connecter') return;
    const o = new URLSearchParams(window.location.search).get('option');
    setRetour(o === 'recue' || o === 'abandon' ? o : null);
  }, [lieu]);

  // Une Free n'a pas la route (402) : son état se dit sans elle. Une offre illisible tente la lecture quand même.
  const offre = vueOffre?.offre;
  useEffect(() => {
    if (vueOffre === undefined) return undefined;
    if (offre === 'free') { setVue({ etat: 'free', enVente: false, avecApplication: false }); return undefined; }
    let vivant = true;
    lireEtatLigne(tenantId).then((v) => { if (vivant) setVue(v); }).catch(() => { if (vivant) setVue(null); });
    return () => { vivant = false; };
  }, [tenantId, vueOffre, offre, relectures]);

  const etat = vue?.etat;
  // Payée, pas encore arrivée : l'écran attend le webhook, la prise reste fermée.
  const optionPayee = retour === 'recue' && (etat === 'a_prendre' || etat === 'essai');
  const formuleDemarre = demarrage === 'paye' && etat === 'essai';
  useEffect(() => {
    if (!(optionPayee || formuleDemarre) || relectures >= RELECTURES) return undefined;
    const minuterie = setTimeout(() => setRelectures((n) => n + 1), INTERVALLE_MS);
    return () => clearTimeout(minuterie);
  }, [optionPayee, formuleDemarre, relectures]);

  const essaiPro = etat === 'essai' && offre === 'pro' && vueOffre?.abonnement?.statut === 'essai';
  const formulePro = useFormuleProADemarrer(tenantId, vueOffre, essaiPro && admin);

  async function prendre(): Promise<void> {
    setGeste(true);
    setErreur(null);
    try {
      const r = await ouvrirOptionWhatsapp(tenantId, 1, 'connecter');
      if ('indisponible' in r) {
        setVue((v) => (v ? { ...v, enVente: false } : v));
        setGeste(false);
        return;
      }
      if (!estPageDePaiement(r.url)) throw new Error(t('Adresse de paiement invalide.', 'Invalid payment address.'));
      window.location.assign(r.url);
    } catch (err) {
      setErreur(erreurDeChargement(err, t));
      setGeste(false);
    }
  }

  /** Après le démarrage de la formule Pro : payée et l'option en vente, le paiement de l'option enchaîne. */
  async function apresDemarrage(paye: boolean): Promise<void> {
    setDemarrage(paye ? 'paye' : 'en_attente');
    if (paye && vue?.enVente) await prendre();
    await relireOffre(tenantId).catch(() => undefined);
    setRelectures((n) => n + 1);
  }

  const lignePayee = etat === 'en_attente' || etat === 'active';
  const carteActive = carte ?? (!connecte && !lignePayee && !optionPayee && retour !== 'recue');
  const surDemande = (
    <>
      {t('Sur demande : écrivez-nous depuis le ', 'On request: write to us from ')}
      <Link href="/support" className="font-semibold text-ink-900 underline">{t('Support', 'Support')}</Link>
      .
    </>
  );
  const ligneOuverte = t('Votre ligne s’ouvre sous 24 h ouvrées.', 'Your line opens within 24 business hours.');
  const nonAdmin = (p: string) => <p className="text-sm text-ink-500" data-testid="carte-credit-wa-non-admin">{p}</p>;

  // Le Crédit WhatsApp selon l'état : grisé ou non, ce qu'il dit, et son geste.
  let grisee = false;
  let ligne: ReactNode = null;
  let action: ReactNode = null;
  if (vue === null) {
    // Illisible (une API d'avant la route) : grisée, sur demande, jamais un paiement inventé.
    grisee = true;
    ligne = surDemande;
  } else if (vue !== undefined) {
    if (optionPayee || etat === 'en_attente') {
      ligne = ligneOuverte;
    } else if (etat === 'free') {
      grisee = true;
      ligne = t('Avec la formule Pro.', 'With the Pro plan.');
    } else if ((etat === 'essai' || etat === 'a_prendre') && !vue.enVente) {
      // 🔴 HORS VENTE, LA CARTE RESTE GRISÉE, ESSAI COMPRIS (décision de Julien du 2026-11-06) : jamais « Démarrer la
      // formule Pro maintenant » ni « il s'ouvre… » pour une option qui ne se prend pas. Un démarrage prélèverait la
      // formule Pro sur une promesse que rien ne tient (rouge de la relecture du lot B).
      grisee = true;
      ligne = surDemande;
    } else if (etat === 'essai' && formuleDemarre) {
      ligne = t('Votre formule Pro démarre : le Crédit WhatsApp s’ouvre dans quelques secondes.', 'Your Pro plan is starting: WhatsApp credit opens in a few seconds.');
    } else if (etat === 'essai' && essaiPro) {
      ligne = t('Il vient avec la formule Pro payante : à la fin de l’essai, ou tout de suite.', 'It comes with the paid Pro plan: at the end of the trial, or right away.');
      action = admin ? (
        <DemarrerPro
          tenantId={tenantId}
          formule={formulePro}
          {...(vue.enVente ? { suite: t('Ensuite, vous réglez l’option Crédit WhatsApp pour un numéro sur la page de paiement de Stripe.', 'Then you pay for the WhatsApp credit option for one number on Stripe’s payment page.') } : {})}
          onDemarre={apresDemarrage}
          testid="carte-credit-wa-demarrer"
        />
      ) : nonAdmin(t('Un administrateur de votre espace peut démarrer la formule Pro maintenant.', 'An administrator of your workspace can start the Pro plan now.'));
    } else if (etat === 'essai') {
      ligne = raisonAttenteOption(offre, vueOffre?.abonnement?.statut, t);
    } else if (etat === 'a_prendre') {
      if (!admin) {
        action = nonAdmin(t('Demandez à un administrateur de votre espace de prendre l’option.', 'Ask an administrator of your workspace to take the option.'));
      } else {
        action = (
          <Bouton data-testid="carte-credit-wa-prendre" onClick={() => { void prendre(); }} disabled={geste} enCours={geste}>
            {t('Prendre l’option', 'Take the option')}
          </Bouton>
        );
      }
    } else if (etat === 'active') {
      ligne = t('Vos messages sont payés par votre Crédit WhatsApp.', 'Your messages are paid by your WhatsApp credit.');
    } else if (etat === 'arretee') {
      ligne = t('Vos envois par le Crédit WhatsApp sont arrêtés, votre crédit restant est conservé.', 'Your sends through WhatsApp credit are stopped, your remaining credit is kept.');
      action = !vue.enVente ? <p className="text-sm text-ink-700">{surDemande}</p> : admin ? (
        <Bouton data-testid="carte-credit-wa-reprendre" onClick={() => { void prendre(); }} disabled={geste} enCours={geste}>
          {t('Reprendre l’option', 'Take the option again')}
        </Bouton>
      ) : nonAdmin(t('Un administrateur de votre espace peut reprendre l’option.', 'An administrator of your workspace can take the option again.'));
    }
  }
  // Au moment de payer : des numéros qui gardent tous l'application ne passeront pas sur le Crédit WhatsApp (décision 8).
  const avertissement = vue?.avecApplication === true && (etat === 'a_prendre' || etat === 'arretee') && vue.enVente && admin && (
    <p className="text-sm text-alerte-700" data-testid="carte-credit-wa-avertissement">
      {t(AVERTISSEMENT_APPLICATION.fr, AVERTISSEMENT_APPLICATION.en)}
    </p>
  );

  // La carte chez Meta : sur Connecter WhatsApp elle ouvre le guide, sauf un numéro connecté dont l'option n'est pas arrêtée.
  const boutonCarte = lieu === 'accueil' ? (
    <Link href="/connecter-whatsapp" data-testid="carte-meta-choisir" className={classesBouton('secondaire')}>{t(QUESTION_PAIEMENT.carte.titre.fr, QUESTION_PAIEMENT.carte.titre.en)}</Link>
  ) : !connecte ? (
    <Bouton type="button" variante={carteActive ? 'principal' : 'secondaire'} aria-pressed={carteActive} onClick={() => setCarte(true)} data-testid="carte-meta-choisir">
      {t(QUESTION_PAIEMENT.carte.titre.fr, QUESTION_PAIEMENT.carte.titre.en)}
    </Bouton>
  ) : etat === 'arretee' && admin ? (
    <Bouton type="button" variante={carteActive ? 'principal' : 'secondaire'} aria-pressed={carteActive} onClick={() => setCarte(true)} data-testid="carte-meta-choisir">
      {t('Connecter avec ma carte chez Meta', 'Connect with my card at Meta')}
    </Bouton>
  ) : null;
  const metaEnAvant = lieu === 'accueil' ? !lignePayee : carteActive;

  return (
    <div className={lieu === 'accueil' ? 'mb-4' : 'mt-6'}>
      <div data-testid="qui-regle-meta" className="rounded-carte border border-ink-200 bg-white p-5">
        <div className="text-base font-semibold text-ink-900">{t(QUESTION_PAIEMENT.texte.fr, QUESTION_PAIEMENT.texte.en)}</div>
        <p className="mt-1 text-xs text-ink-500">{t(QUESTION_PAIEMENT.precision.fr, QUESTION_PAIEMENT.precision.en)}</p>
        {retour === 'recue' && (
          <div className="mt-3"><MbaNotice kind="success" testid="carte-credit-wa-recue">{t('Paiement de l’option reçu.', 'Option payment received.')}</MbaNotice></div>
        )}
        {retour === 'abandon' && etat !== 'en_attente' && etat !== 'active' && (
          <div className="mt-3">
            <MbaNotice kind="warning" testid="carte-credit-wa-abandon">
              {t('Paiement de l’option abandonné : rien n’a été débité pour l’option.', 'Option payment cancelled: nothing was charged for the option.')}
            </MbaNotice>
          </div>
        )}
        {demarrage === 'en_attente' && (
          <div className="mt-3">
            <MbaNotice kind="warning" testid="carte-credit-wa-demarrage-attente">
              {t('Votre essai est arrêté et le premier paiement de votre formule Pro est en cours chez votre banque, qui le confirme sous quelques jours.',
                'Your trial is over and the first payment of your Pro plan is being processed by your bank, which confirms it within a few days.')}
            </MbaNotice>
          </div>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="grid grid-rows-[1fr_auto] gap-3">
            <div data-testid="carte-meta" className={`rounded-carte border p-4 ${metaEnAvant ? 'border-ink-900' : 'border-ink-200'}`}>
              <div className="text-sm font-semibold text-ink-900">{t(QUESTION_PAIEMENT.carte.titre.fr, QUESTION_PAIEMENT.carte.titre.en)}</div>
              <p className="mt-1 text-sm text-ink-700">
                {t('Vous connectez votre numéro avec votre carte chez Meta, qui vous facture vos modèles.', 'You connect your number with your card at Meta, which bills your templates.')}
              </p>
            </div>
            {boutonCarte && <div>{boutonCarte}</div>}
          </div>
          <div className="grid grid-rows-[1fr_auto] gap-3">
            <div data-testid="carte-credit-wa" data-etat={etat ?? ''} aria-disabled={grisee || undefined} className={`rounded-carte border p-4 ${lignePayee ? 'border-ink-900' : 'border-ink-200'}`}>
              <div className={`text-sm font-semibold text-ink-900 ${grisee ? 'opacity-60' : ''}`}>{t(QUESTION_PAIEMENT.credit.titre.fr, QUESTION_PAIEMENT.credit.titre.en)}</div>
              <p className={`mt-1 text-sm text-ink-700 ${grisee ? 'opacity-60' : ''}`}>{t(QUESTION_PAIEMENT.credit.texte.fr, QUESTION_PAIEMENT.credit.texte.en)}</p>
              {ligne && <p className="mt-2 text-sm font-semibold text-ink-900" data-testid="carte-credit-wa-ligne">{ligne}</p>}
            </div>
            {(grisee || action || avertissement) && (
              <div className="space-y-2">
                {avertissement}
                {grisee ? (
                  <Bouton type="button" variante="secondaire" disabled data-testid="carte-credit-wa-grisee">
                    {t(QUESTION_PAIEMENT.credit.titre.fr, QUESTION_PAIEMENT.credit.titre.en)}
                  </Bouton>
                ) : action}
              </div>
            )}
          </div>
        </div>
        {erreur && <p className="mt-3 text-sm text-danger" data-testid="carte-credit-wa-erreur">{erreur}</p>}
      </div>
      {lieu === 'connecter' && carteActive && children}
    </div>
  );
}
