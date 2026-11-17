'use client';

import { ValidationConnexion, VALIDATION_BOUTON } from '@/components/ValidationConnexion';
import { AideErreurMeta } from '@/components/AideErreurMeta';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Bouton, classesBouton } from '@/components/Bouton';
import { Icone } from '@/components/Icone';
import { RechargeLigne } from '@/components/RechargeLigne';
import { EtapeTunnel, FilLigne, FlecheEtape } from '@/components/FilLigne';
import { eurosDepuisMicro } from '@/lib/agent-solde';
import type { VueCreditWhatsapp } from '@/lib/api-credit-whatsapp';
import { MbaNotice } from '@/components/MbaNotice';
import { EncadreChezMeta, ParcoursNumero } from '@/components/ParcoursNumero';
import { estPageDePaiement } from '@/lib/api-credit';
import { lireEtatLigne, ouvrirOptionWhatsapp, type VueEtatLigne } from '@/lib/api-credit-whatsapp';
import type { ApiConnexionNumero } from '@/lib/api/connexion-numero';
import { useConnexionNumero } from '@/lib/connexion-numero';
import { FENETRE_BLOQUEE } from '@/lib/fenetre-meta';
import { erreurDeChargement } from '@/lib/http';
import { useLocale, useT } from '@/lib/i18n';
import { raisonAttenteOption } from '@/lib/offre';
import {
  AVERTISSEMENT_APPLICATION, ISSUE_API, NUMERO_LIGNE_MIEN, PREREQUIS_LIGNE, QUESTION_LIGNE_NUMERO, QUESTION_PAIEMENT,
} from '@/lib/questions-numero';
import { useOffre } from '@/lib/use-offre';

/** Après un retour de Stripe : combien de fois, et tous les combien, on relit l'état. */
const RELECTURES = 15;
const INTERVALLE_MS = 2_000;

/**
 * La fenêtre du partenaire (lot E du Crédit WhatsApp) : le bouton et ce que la carte dit, textes validés par Julien le
 * 2026-11-09. Une formule Pro ou un Business l'ont, l'option payée ; une Entreprise, selon son contrat.
 */
export const PAR_LA_LIGNE = {
  // Il redit ce que la personne vient de choisir (Julien, 2026-11-13), « sans carte » est déjà dans la carte.
  bouton: { fr: 'Connecter mon numéro', en: 'Connect my number' },
  optionPayee: {
    fr: 'Votre option est payée : connectez votre numéro, Meta ne vous facturera pas. Votre ligne s’ouvre ensuite sous 24 h ouvrées.',
    en: 'Your option is paid: connect your number, Meta will not bill you. Your line then opens within 24 business hours.',
  },
  entreprise: {
    fr: 'Connectez votre numéro, Meta ne vous facturera pas. Votre ligne s’ouvre ensuite sous 24 h ouvrées.',
    en: 'Connect your number, Meta will not bill you. Your line then opens within 24 business hours.',
  },
} as const;

/**
 * L'option payée, ou une Entreprise sans numéro (essai 263, Julien, 2026-11-16) : le fil des étapes (`FilLigne`), et la
 * question du numéro dans l'étape 2 ; la voie de la carte chez Meta n’est plus proposée (« on vient de la choisir »).
 */
export const ETAPE_NUMERO = {
  fr: 'Quel numéro voulez-vous connecter ?',
  en: 'Which number do you want to connect?',
} as const;

/**
 * Un numéro connecté avec sa carte chez Meta ne passe jamais sur la ligne : Meta refuse qu'un compte que nous servons déjà
 * en direct repasse par la fenêtre du partenaire (#2494156, essai 257). L'option ne s'y vend plus (décision de Julien du
 * 2026-11-13, textes validés par lui, version A) : la carte et l'onglet le disent à la place de l'achat, le refus du
 * serveur (`numero_avec_carte`) aussi. La phrase s'achève sur le lien du Support.
 */
export const NUMERO_AVEC_CARTE = {
  fr: 'Votre numéro est connecté avec votre carte chez Meta : la ligne de crédit ne peut pas le prendre en charge. Pour changer, écrivez au ',
  en: 'Your number is connected with your card at Meta: the credit line can’t take it over. To change this, write to ',
} as const;

/**
 * La carte chez Meta choisie : elle peut se poser APRÈS la connexion (Julien, 2026-11-17), sur le compte Meta Business ;
 * Meta l'exige pour ses modèles (fiche « Ce qu'il faut chez Meta », étape 4).
 */
export const CARTE_PLUS_TARD = {
  fr: 'Pas encore de carte ? Pas besoin pour connecter votre numéro : vous l’ajouterez ensuite sur votre compte Meta Business, avant vos premiers modèles.',
  en: 'No card yet? You don’t need one to connect your number: you’ll add it afterwards to your Meta Business account, before your first templates.',
} as const;

/** Avant qu'un espace qui a droit à la ligne ne connecte son numéro avec sa carte : il ne pourra plus y passer. */
export const AVERTISSEMENT_CARTE = {
  fr: 'Connecté avec votre carte chez Meta, ce numéro ne pourra plus passer sur la ligne de crédit.',
  en: 'Connected with your card at Meta, this number will no longer be able to move onto the credit line.',
} as const;

/**
 * « QUI PAIE VOS MESSAGES À META ? » (révision du Crédit WhatsApp du 2026-11-04, lot B) : deux cartes, chaque bouton sous
 * la sienne. Sur Connecter WhatsApp, c'est la première question du guide du numéro, et la voie de la carte chez Meta y
 * ouvre la suite (`children`) ; sur l'Accueil, tant qu'aucun numéro n'est connecté, elle y mène.
 *
 * La carte du moyen de paiement chez Meta (« Je mets un moyen de paiement (Visa / Mastercard) sur mon compte Meta
 * Business », Julien, 2026-11-09, lot 3a, avec ses deux liens) : le numéro se connecte par notre application, et Meta le
 * facture. Aucune voie n'est choisie d'avance (Julien, 2026-11-17) : la suite n'apparaît qu'une fois la carte choisie. Elle cède la place quand une ligne est payée ou posée (`en_attente`,
 * `active`), et se reprend d'un clic.
 *
 * « Crédit WhatsApp » dit ce que l'état de la ligne permet (`GET /credit-whatsapp/etat`, `etatLigneCredit` du serveur) :
 * grisée en Free et, tant que l'option n'est pas en vente en ligne, essai compris (« sur demande ») ; une fois en vente,
 * « Prendre l'option » dès que le serveur la dit à prendre (`a_prendre`, un Pro dès le début de son essai, lot 3v V1), la
 * raison de l'attente pour un Business en essai ou un Pro en retard (`essai`), puis la ligne qui s'ouvre, active, ou
 * arrêtée avec ses deux chemins. L'option payée, la fenêtre du partenaire demande « Votre numéro, ou le nôtre ? » (lot
 * 3v) : le sien par « Connecter mon numéro », le nôtre par le parcours du numéro fourni, ouvert par la même
 * fenêtre (`parLaLigne`). Les mots de la question sont ceux de la vitrine (`QUESTION_PAIEMENT`, tenus égaux par
 * `tests/questions-numero-vitrine.test.ts`) ; ceux de chaque état, validés par Julien le 2026-11-06.
 *
 * 🔴 LE RETOUR DE STRIPE NE PREND RIEN : il relit l'état jusqu'à voir l'option que le webhook écrit, et la prise reste
 * fermée en attendant (sinon le client la paierait deux fois, comme dans l'onglet).
 *
 * Un numéro connecté avec sa carte chez Meta (`numeroAvecCarte`) lit `NUMERO_AVEC_CARTE`, en formule Pro comme en
 * Entreprise : Meta refuse qu'il se reconnecte par la fenêtre du partenaire, plus rien ne le propose (2026-11-13).
 */
export function QuiRegleMeta({ tenantId, admin, lieu, connecte = false, children, api, surConnexion, occupe = false, formule = null }: {
  tenantId: string;
  /**
   * La formule de l'espace, dite par la page (« Formule Pro souscrite ») : la première étape, faite, du tunnel de
   * Connecter WhatsApp. `null` : pas d'étape de formule (pas encore lue).
   */
  formule?: string | null;
  admin: boolean;
  /**
   * La fenêtre de Meta du parcours de la carte (`children`, monté par la page) est ouverte : changer de voie le
   * démonterait, et avec lui la connexion en cours (jaune de la relecture du lot 3v-1).
   */
  occupe?: boolean;
  /** `connecter` : la question du guide, et le retour de Stripe y arrive (`?option=`) ; `accueil` : elle mène au guide. */
  lieu: 'connecter' | 'accueil';
  /** Un numéro est connecté : la carte chez Meta ne rouvre le guide qu'une fois l'option arrêtée. */
  connecte?: boolean;
  /** La suite du guide, sous les cartes, quand la voie de la carte chez Meta est prise (Connecter WhatsApp). */
  children?: ReactNode;
  /**
   * La connexion de Connecter WhatsApp (lot E du Crédit WhatsApp) : l'autorité de ses appels et ce qui suit une connexion.
   * Sans elles (l'Accueil), le bouton de la fenêtre du partenaire mène à Connecter WhatsApp. Le parcours du numéro fourni
   * (« J’ai besoin d’un numéro », lot 3v) en lit toutes les routes.
   */
  api?: ApiConnexionNumero;
  surConnexion?: (avertissements: string[]) => void;
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
  /** La réponse à « Votre numéro, ou le nôtre ? » (lot 3v), la fenêtre du partenaire ouverte. */
  const [numeroLigne, setNumeroLigne] = useState<'mien' | 'notre' | null>(null);
  /**
   * Une fenêtre de Meta ouverte par une voie de la ligne (« J’utilise un numéro existant », « J’ai besoin d’un numéro »), ou par celle de la carte (`occupe`) :
   * tant qu'elle l'est, aucun geste ne change de voie, ce qui démonterait la connexion en cours (jaune du lot 3v-1).
   */
  const [fenetreLigne, setFenetreLigne] = useState(false);
  /** La vue de la ligne, lue par la recharge une fois le numéro connecté : le fil des étapes en tire le solde. */
  const [vueCredit, setVueCredit] = useState<VueCreditWhatsapp | null | undefined>(undefined);
  const { locale } = useLocale();
  const fenetreOuverte = occupe || fenetreLigne;

  /**
   * Un numéro fourni déjà en route (payé, au retour de Stripe, ou attribué, au retour sur la page) : la voie de la carte
   * chez Meta est déjà prise, son parcours reprend où il en était sans reposer la question du paiement.
   */
  const [repriseCarte, setRepriseCarte] = useState(false);
  useEffect(() => {
    if (lieu !== 'connecter') return undefined;
    const p = new URLSearchParams(window.location.search);
    const o = p.get('option');
    setRetour(o === 'recue' || o === 'abandon' ? o : null);
    // Le retour de Stripe d'un numéro fourni payé : le parcours de « J’ai besoin d’un numéro » reprend où il en était.
    if (p.get('abonnement') === 'recu') { setNumeroLigne('notre'); setRepriseCarte(true); }
    if (connecte || !api) return undefined;
    let vivant = true;
    api.lire().then((r) => { if (vivant && r.numero) setRepriseCarte(true); }).catch(() => {});
    return () => { vivant = false; };
    // `api` change d'identité à chaque rendu de la page : l'espace suffit à dire qu'il faut relire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lieu, connecte, tenantId]);

  // Une Free n'a pas la route (402) : son état se dit sans elle. Une offre illisible tente la lecture quand même.
  const offre = vueOffre?.offre;
  useEffect(() => {
    if (vueOffre === undefined) return undefined;
    if (offre === 'free') { setVue({ etat: 'free', enVente: false, avecApplication: false, fenetrePartenaire: false, numeroAvecCarte: false }); return undefined; }
    let vivant = true;
    // Une relecture qui échoue garde la dernière vue lue : le parcours en cours ne disparaît pas (jaune 2 du lot 3v).
    lireEtatLigne(tenantId).then((v) => { if (vivant) setVue(v); }).catch(() => { if (vivant) setVue((avant) => avant ?? null); });
    return () => { vivant = false; };
  }, [tenantId, vueOffre, offre, relectures]);

  const etat = vue?.etat;
  const lignePayee = etat === 'en_attente' || etat === 'active';
  // Payée, pas encore arrivée : l'écran attend le webhook, la prise reste fermée. Tout état hors d'une ligne payée, une
  // option reprise (`arretee`) comprise, que le webhook relance (jaune 1 de la relecture du lot B).
  const optionPayee = retour === 'recue' && etat !== undefined && !lignePayee;
  useEffect(() => {
    if (!optionPayee || relectures >= RELECTURES) return undefined;
    const minuterie = setTimeout(() => setRelectures((n) => n + 1), INTERVALLE_MS);
    return () => clearTimeout(minuterie);
  }, [optionPayee, relectures]);

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

  // La fenêtre du partenaire ouverte (lot E) : le Crédit WhatsApp devient la voie active, la carte chez Meta se reprend
  // d'un clic, et une réponse à « Votre numéro, ou le nôtre ? » la referme (lot 3v). Chaque voie porte sa connexion :
  // seule celle dont le bouton a ouvert la fenêtre en envoie la fin au serveur.
  const fenetrePartenaire = vue?.fenetrePartenaire === true && !connecte;
  // 🔴 AUCUNE VOIE CHOISIE D'AVANCE (Julien, 2026-11-17) : la carte chez Meta l'était, son bouton ne faisait donc rien
  // au clic, et la suite (« Avez-vous un compte Meta Business ? ») s'affichait avant la réponse. Elle suit le clic, sauf
  // un numéro fourni déjà en route (`repriseCarte`), hors fenêtre du partenaire qui a son propre parcours.
  const carteActive = carte ?? (repriseCarte && !fenetrePartenaire);
  /**
   * Le clic sur la carte chez Meta amène l'étape suivante à l'écran, sa première question comprise (Julien, 2026-11-17,
   * lot 4 : « on est obligé de scroller à la main ») ; les questions suivantes défilent dans `ParcoursNumero`. Jamais au
   * chargement : seulement après ce clic.
   */
  const [defiler, setDefiler] = useState(false);
  useEffect(() => {
    if (!defiler || !carteActive) return;
    setDefiler(false);
    const etape = document.querySelector('[data-testid="tunnel-numero-meta"]');
    if (!(etape instanceof HTMLElement)) return;
    const sansAnimation = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    etape.scrollIntoView({ behavior: sansAnimation ? 'auto' : 'smooth', block: 'nearest' });
  }, [defiler, carteActive]);
  const choisirCarte = () => { setCarte(true); setDefiler(true); };
  /** Sur Connecter WhatsApp, avec la connexion de la page : la question, puis la suite de la réponse sous les cartes. */
  const ligneIci = fenetrePartenaire && admin && lieu === 'connecter' && api !== undefined && surConnexion !== undefined;
  const repondreLigne = (r: 'mien' | 'notre') => { setCarte(false); setNumeroLigne(r); };
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
    if (fenetrePartenaire) {
      // La fenêtre du partenaire (lot E) : le serveur l'ouvre à un espace qui a droit à la ligne et n'a encore aucun
      // numéro. Sur Connecter WhatsApp, le bouton ouvre la fenêtre de Meta par la solution ; sur l'Accueil, il y mène.
      ligne = offre === 'entreprise' ? t(PAR_LA_LIGNE.entreprise.fr, PAR_LA_LIGNE.entreprise.en) : t(PAR_LA_LIGNE.optionPayee.fr, PAR_LA_LIGNE.optionPayee.en);
      if (ligneIci) {
        // « Votre numéro, ou le nôtre ? » (lot 3v) : la réponse referme la voie de la carte chez Meta, sa suite vient sous
        // les cartes. Une réponse n'est en avant que tant que la carte chez Meta n'a pas été reprise.
        const choisie = carteActive ? null : numeroLigne;
        action = (
          <div className="space-y-3" data-testid="ligne-numero">
            {/* L'étape suivante, en titre (essai 263, Julien, 2026-11-16 : « on attaque l'étape suivante »). */}
            <p className="text-base font-semibold text-ink-900">{t(ETAPE_NUMERO.fr, ETAPE_NUMERO.en)}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['mien', 'notre'] as const).map((r) => (
                <Bouton key={r} type="button" variante={choisie === r ? 'principal' : 'secondaire'} aria-pressed={choisie === r} disabled={fenetreOuverte} onClick={() => repondreLigne(r)} data-testid={`ligne-numero-${r}`}>
                  {t(QUESTION_LIGNE_NUMERO[r].fr, QUESTION_LIGNE_NUMERO[r].en)}
                </Bouton>
              ))}
            </div>
          </div>
        );
      } else if (admin && lieu === 'accueil') {
        action = (
          <Link href="/connecter-whatsapp" data-testid="carte-credit-wa-connecter-ligne" className={classesBouton('principal')}>
            {t(PAR_LA_LIGNE.bouton.fr, PAR_LA_LIGNE.bouton.en)}
          </Link>
        );
      }
    } else if (connecte && vue.numeroAvecCarte && etat !== 'active' && etat !== 'arretee') {
      // Un numéro connecté avec sa carte chez Meta (décision de Julien du 2026-11-13) : Meta refuse qu'il se reconnecte par
      // la fenêtre du partenaire (#2494156), il ne passera jamais sur la ligne. La carte le dit, à la place de l'achat, de
      // « sur demande » d'une Entreprise, ou de « sous 24 h ouvrées » d'une option prise avec lui : aucun geste à proposer.
      ligne = (
        <span data-testid="carte-credit-wa-numero-carte">
          {t(NUMERO_AVEC_CARTE.fr, NUMERO_AVEC_CARTE.en)}
          <Link href="/support" className="underline">{t('Support', 'Support')}</Link>.
        </span>
      );
    } else if (optionPayee || etat === 'en_attente') {
      ligne = ligneOuverte;
    } else if (etat === 'free') {
      grisee = true;
      ligne = t('Avec la formule Pro.', 'With the Pro plan.');
    } else if ((etat === 'essai' || etat === 'a_prendre') && !vue.enVente) {
      // 🔴 HORS VENTE, LA CARTE RESTE GRISÉE, ESSAI COMPRIS (décision de Julien du 2026-11-06) : jamais « Prendre
      // l'option » ni « il s'ouvre… » pour une option qui ne se prend pas en ligne.
      grisee = true;
      ligne = surDemande;
    } else if (etat === 'essai') {
      // Un Business en essai, un Pro en retard de paiement (lot 3v V1) : la raison, dans les mots du refus du serveur.
      // Plus de « Démarrer la formule Pro maintenant » : un Pro en essai prend l'option, le serveur le dit `a_prendre`.
      ligne = raisonAttenteOption(offre, vueOffre?.abonnement?.statut, t);
    } else if (etat === 'a_prendre') {
      if (!admin) {
        action = nonAdmin(t('Demandez à un administrateur de votre espace de prendre l’option.', 'Ask an administrator of your workspace to take the option.'));
      } else {
        action = (
          <Bouton data-testid="carte-credit-wa-prendre" variante={carteActive ? 'secondaire' : 'principal'} onClick={() => { void prendre(); }} disabled={geste} enCours={geste}>
            {t('Prendre l’option', 'Take the option')}
          </Bouton>
        );
      }
    } else if (etat === 'active') {
      ligne = t('Vos messages sont payés par votre ligne de crédit.', 'Your messages are paid by your credit line.');
    } else if (etat === 'arretee') {
      ligne = t('Vos envois par la ligne de crédit sont arrêtés, votre solde est conservé.', 'Your sends through the credit line are stopped, your balance is kept.');
      action = !vue.enVente ? <p className="text-sm text-ink-700">{surDemande}</p> : admin ? (
        <Bouton data-testid="carte-credit-wa-reprendre" variante={carteActive ? 'secondaire' : 'principal'} onClick={() => { void prendre(); }} disabled={geste} enCours={geste}>
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
    // Les deux réponses à égalité tant que rien n'est choisi ; la ligne de crédit passe en gris une fois la carte prise.
    <Bouton type="button" variante={carteActive || carte === null ? 'principal' : 'secondaire'} aria-pressed={carteActive} disabled={fenetreOuverte} onClick={choisirCarte} data-testid="carte-meta-choisir">
      {t(QUESTION_PAIEMENT.carte.titre.fr, QUESTION_PAIEMENT.carte.titre.en)}
    </Bouton>
  ) : etat === 'arretee' && admin ? (
    <Bouton type="button" variante={carteActive ? 'principal' : 'secondaire'} aria-pressed={carteActive} disabled={fenetreOuverte} onClick={choisirCarte} data-testid="carte-meta-choisir">
      {t('Connecter avec ma carte chez Meta', 'Connect with my card at Meta')}
    </Bouton>
  ) : null;
  // Un numéro connecté que la ligne ne paie pas est payé par sa carte : elle est mise en avant (jaune 4 du lot B).
  const metaEnAvant = lieu === 'accueil' || connecte ? !lignePayee : carteActive;

  // Chaque voie sur UNE rangée, sa carte à gauche et son geste à droite (essai 263, Julien, 2026-11-16 : les boutons sous
  // deux colonnes ne disaient pas à quelle carte ils allaient).
  const rangee = (carteEl: ReactNode, geste: ReactNode, testid: string) => (
    <div data-testid={testid} className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] sm:items-center">
      {carteEl}
      {geste ? <div className="space-y-2">{geste}</div> : <div className="hidden sm:block" />}
    </div>
  );
  const carteMeta = (
    <div data-testid="carte-meta" className={`rounded-carte border p-4 ${metaEnAvant ? 'border-ink-900' : 'border-ink-200'}`}>
      <div className="text-sm font-semibold text-ink-900">{t(QUESTION_PAIEMENT.carte.titre.fr, QUESTION_PAIEMENT.carte.titre.en)}</div>
      <p className="mt-1 text-sm text-ink-700">
        {t('Vous connectez votre numéro, et Meta vous facture vos modèles sur ce moyen de paiement.', 'You connect your number, and Meta bills your templates to this payment method.')}
      </p>
      {/* Un espace qui a droit à la ligne, sans numéro : avant de prendre cette voie, il apprend qu'elle est sans
          retour (Meta refuse la reconnexion d'un numéro connecté avec sa carte, décision de Julien du 2026-11-13). */}
      {fenetrePartenaire && (
        <p className="mt-2 text-sm text-alerte-700" data-testid="carte-meta-avertissement-ligne">{t(AVERTISSEMENT_CARTE.fr, AVERTISSEMENT_CARTE.en)}</p>
      )}
      {/* Choisie : la carte peut attendre la connexion (Julien, 2026-11-17). */}
      {carteActive && !connecte && (
        <p className="mt-2 text-sm font-semibold text-ink-900" data-testid="carte-meta-plus-tard">{t(CARTE_PLUS_TARD.fr, CARTE_PLUS_TARD.en)}</p>
      )}
      {/* Ses deux liens (lot 3a) : pourquoi un moyen de paiement, et ce qu'est un compte Meta Business. */}
      <p data-testid="carte-meta-liens" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {QUESTION_PAIEMENT.carte.liens.map((l) => (
          <a key={l.href.fr} href={t(l.href.fr, l.href.en)} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink-900 underline">
            {t(l.libelle.fr, l.libelle.en)}
          </a>
        ))}
      </p>
    </div>
  );
  const carteLigne = (
    <div data-testid="carte-credit-wa" data-etat={etat ?? ''} aria-disabled={grisee || undefined} className={`rounded-carte border p-4 ${lignePayee ? 'border-ink-900' : 'border-ink-200'} ${carteActive && !connecte ? 'opacity-60' : ''}`}>
      <div className={`text-sm font-semibold text-ink-900 ${grisee ? 'opacity-60' : ''}`}>{t(QUESTION_PAIEMENT.credit.titre.fr, QUESTION_PAIEMENT.credit.titre.en)}</div>
      <p className={`mt-1 text-sm text-ink-700 ${grisee ? 'opacity-60' : ''}`}>
        {/* Une Entreprise : son contrat, jamais le prix de l'option (jaune 9 du lot B, texte validé par Julien le 2026-11-06). */}
        {offre === 'entreprise'
          ? t('Vous payez vos messages chez Messaging Me, sans carte chez Meta, selon votre contrat Entreprise.', 'You pay for your messages at Messaging Me, with no card at Meta, under your Enterprise contract.')
          : t(QUESTION_PAIEMENT.credit.texte.fr, QUESTION_PAIEMENT.credit.texte.en)}
      </p>
      {ligne && <p className="mt-2 text-sm font-semibold text-ink-900" data-testid="carte-credit-wa-ligne">{ligne}</p>}
    </div>
  );
  const gesteLigne = (grisee || action || avertissement) ? (
    <>
      {avertissement}
      {grisee ? (
        <Bouton type="button" variante="secondaire" disabled data-testid="carte-credit-wa-grisee">
          {t(QUESTION_PAIEMENT.credit.titre.fr, QUESTION_PAIEMENT.credit.titre.en)}
        </Bouton>
      ) : action}
    </>
  ) : null;
  /**
   * L'option payée (ou une Entreprise sans numéro), sur Connecter WhatsApp, la voie de la carte pas reprise : la
   * confirmation en tête, la question du numéro en titre, sans la voie de la carte chez Meta (essai 263).
   */
  const confirmee = ligneIci && !carteActive;
  /**
   * Le numéro connecté sur la ligne (posée, ou qui s'ouvre), sur Connecter WhatsApp : plus de choix du paiement ni de
   * l'option, mais la suite, recharger (essai 263, Julien, 2026-11-16).
   */
  const surLaLigne = lieu === 'connecter' && connecte && lignePayee;

  /** Le contenu de la question : les retours de Stripe, puis les deux voies (ou le fil de la ligne), et l'erreur. */
  const contenu = (
    <>
      {/* Confirmée, la carte verte dit déjà que l'option est prise : pas de second bandeau. */}
      {retour === 'recue' && !confirmee && !surLaLigne && (
        <div className="mt-3"><MbaNotice kind="success" testid="carte-credit-wa-recue">{t('Paiement de l’option reçu.', 'Option payment received.')}</MbaNotice></div>
      )}
      {retour === 'abandon' && etat !== 'en_attente' && etat !== 'active' && (
        <div className="mt-3">
          <MbaNotice kind="warning" testid="carte-credit-wa-abandon">
            {t('Paiement de l’option abandonné : rien n’a été débité pour l’option.', 'Option payment cancelled: nothing was charged for the option.')}
          </MbaNotice>
        </div>
      )}
      {surLaLigne || confirmee ? (
        // Le tunnel de la ligne (essai 263) : les trois étapes l'une sous l'autre, le geste de l'étape en cours dedans ;
        // plus de bandeau de confirmation à côté, qui redisait l'étape 1 (Julien, 2026-11-16).
        <div data-testid="carte-credit-wa" data-etat={etat ?? ''}>
          <FilLigne
            etat={{
              entreprise: offre === 'entreprise',
              numeroConnecte: surLaLigne,
              solde: vueCredit === undefined || vueCredit === null ? null : vueCredit.illimite ? 'illimite' : eurosDepuisMicro(vueCredit.soldeMicroEur),
              soldeTexte: vueCredit ? new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency: 'EUR' }).format(eurosDepuisMicro(vueCredit.soldeMicroEur)) : '',
            }}
            detailNumero={(
              <span data-testid="carte-credit-wa-ligne">
                {surLaLigne ? ligne : t(PAR_LA_LIGNE.entreprise.fr, PAR_LA_LIGNE.entreprise.en)}
              </span>
            )}
            contenuNumero={confirmee ? action : null}
            contenuCredit={surLaLigne ? <RechargeLigne tenantId={tenantId} admin={admin} surVue={setVueCredit} /> : null}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {rangee(carteMeta, boutonCarte, 'rangee-meta')}
          {rangee(carteLigne, gesteLigne, 'rangee-ligne')}
        </div>
      )}
      {erreur && <p className="mt-3 text-sm text-danger" data-testid="carte-credit-wa-erreur">{erreur}</p>}
    </>
  );
  /**
   * LE TUNNEL DE LA CARTE CHEZ META (Julien, 2026-11-17 : « il faut que l'on voie les étapes une par une ») : la formule,
   * faite ; la question du paiement ; puis, une fois la carte choisie, la connexion du numéro, qui n'apparaît qu'alors.
   * Le fil de la ligne de crédit (`FilLigne`) garde le sien.
   */
  if (lieu === 'connecter' && !connecte && !confirmee) {
    const decalage = formule ? 1 : 0;
    return (
      <ol className="mt-6" data-testid="tunnel-numero">
        {formule && (
          <>
            <EtapeTunnel testid="tunnel-formule" numero={1} statut="fait" titre={formule} />
            <FlecheEtape />
          </>
        )}
        <EtapeTunnel
          testid="qui-regle-meta" numero={1 + decalage} statut={carteActive ? 'fait' : 'en_cours'}
          titre={t(QUESTION_PAIEMENT.texte.fr, QUESTION_PAIEMENT.texte.en)} detail={t(QUESTION_PAIEMENT.precision.fr, QUESTION_PAIEMENT.precision.en)}
        >
          {contenu}
        </EtapeTunnel>
        {carteActive && (
          <>
            <FlecheEtape />
            <EtapeTunnel testid="tunnel-numero-meta" numero={2 + decalage} statut="en_cours" titre={t('Connecter votre numéro chez Meta', 'Connect your number at Meta')}>
              {children}
            </EtapeTunnel>
          </>
        )}
      </ol>
    );
  }

  return (
    <div className={lieu === 'accueil' ? 'mb-4' : 'mt-6'}>
      <div data-testid="qui-regle-meta" className="rounded-carte border border-ink-200 bg-white p-5">
        <div className="text-base font-semibold text-ink-900">{t(QUESTION_PAIEMENT.texte.fr, QUESTION_PAIEMENT.texte.en)}</div>
        <p className="mt-1 text-xs text-ink-500">{t(QUESTION_PAIEMENT.precision.fr, QUESTION_PAIEMENT.precision.en)}</p>
        {contenu}
      </div>
      {lieu === 'connecter' && carteActive && children}
      {/* La suite de « Votre numéro, ou le nôtre ? » (lot 3v), sous les cartes. Le sien : la phrase validée de Julien pour
          un numéro qui sert dans l'application, AVANT la fenêtre. Le nôtre : le numéro fourni, relié par la même fenêtre
          du partenaire, jamais en `fourni_application` (la ligne ne paie que l'API). */}
      {ligneIci && !carteActive && numeroLigne === 'mien' && api && surConnexion && (
        <>
          {/* Ce qu'il faut chez Meta, comme sur les autres voies : sans la carte, et son numéro à lui (jaune du lot 4a-3). */}
          <EncadreChezMeta prerequis={[...PREREQUIS_LIGNE, NUMERO_LIGNE_MIEN]} />
          <div data-testid="ligne-numero-mien-suite" className="mt-4 rounded-carte border border-ink-200 bg-white p-5">
            <p className="text-sm text-ink-700" data-testid="ligne-numero-application">
              <span className="font-semibold text-ink-900">{t(ISSUE_API.garder.fr, ISSUE_API.garder.en)}</span>{' '}
              {t(QUESTION_LIGNE_NUMERO.application.fr, QUESTION_LIGNE_NUMERO.application.en)}
            </p>
            <div className="mt-3"><BoutonParLaLigne tenantId={tenantId} api={api} surConnexion={surConnexion} surOccupe={setFenetreLigne} /></div>
          </div>
        </>
      )}
      {ligneIci && !carteActive && numeroLigne === 'notre' && api && surConnexion && (
        <ParcoursNumero tenantId={tenantId} api={api} choixInitial="fourni" parLaLigne retour="console" connecte={connecte} surConnexion={surConnexion} surOccupe={setFenetreLigne} />
      )}
    </div>
  );
}

/**
 * « Connecter mon numéro » (lot E du Crédit WhatsApp) : la fenêtre de Meta ouverte avec la solution du
 * partenaire, dont la configuration ne rend l'identifiant qu'à un espace qui a droit à la ligne. Il porte sa propre
 * connexion, et n'est monté qu'une fois la voie de la carte chez Meta refermée (« J’utilise un numéro existant », lot 3v) :
 * sa fenêtre s'ouvre dans le geste du clic (Safari, `ouvrirFenetreMeta`).
 */
function BoutonParLaLigne({ tenantId, api, surConnexion, surOccupe }: {
  tenantId: string;
  api: Pick<ApiConnexionNumero, 'config' | 'completer'>;
  surConnexion: (avertissements: string[]) => void;
  /** Sa fenêtre s'ouvre ou se ferme : la carte ferme les gestes qui le démonteraient (jaune du lot 3v-1). */
  surOccupe: (occupe: boolean) => void;
}) {
  const t = useT();
  const connexion = useConnexionNumero(tenantId, api, surConnexion);
  useEffect(() => { surOccupe(connexion.busy); }, [connexion.busy, surOccupe]);
  useEffect(() => () => { surOccupe(false); }, [surOccupe]);
  const pret = connexion.cfg?.enabled === true && (connexion.cfg.solutionId ?? null) !== null;
  return (
    <div className="space-y-2">
      <Bouton
        type="button" data-testid="carte-credit-wa-connecter-ligne"
        enCours={connexion.busy} disabled={!pret || connexion.busy}
        onClick={() => { void connexion.connect({ parLaLigne: true }); }}
      >
        {connexion.validation ? t(VALIDATION_BOUTON.fr, VALIDATION_BOUTON.en) : t(PAR_LA_LIGNE.bouton.fr, PAR_LA_LIGNE.bouton.en)}
      </Bouton>
      <ValidationConnexion visible={connexion.validation} />
      {connexion.peutEtreBloquee && <p className="text-xs text-ink-500">{t(FENETRE_BLOQUEE.fr, FENETRE_BLOQUEE.en)}</p>}
      {connexion.error && <p className="text-sm text-danger" data-testid="carte-credit-wa-connecter-ligne-erreur">{connexion.error}</p>}
      <AideErreurMeta code={connexion.erreurMeta} />
    </div>
  );
}
