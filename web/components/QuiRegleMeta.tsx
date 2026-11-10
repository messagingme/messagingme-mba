'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Bouton, classesBouton } from '@/components/Bouton';
import { MbaNotice } from '@/components/MbaNotice';
import { ParcoursNumero } from '@/components/ParcoursNumero';
import { estPageDePaiement } from '@/lib/api-credit';
import { lireEtatLigne, ouvrirOptionWhatsapp, type VueEtatLigne } from '@/lib/api-credit-whatsapp';
import type { ApiConnexionNumero } from '@/lib/api/connexion-numero';
import { useConnexionNumero } from '@/lib/connexion-numero';
import { FENETRE_BLOQUEE } from '@/lib/fenetre-meta';
import { erreurDeChargement } from '@/lib/http';
import { useT } from '@/lib/i18n';
import { raisonAttenteOption } from '@/lib/offre';
import { AVERTISSEMENT_APPLICATION, ISSUE_API, QUESTION_LIGNE_NUMERO, QUESTION_PAIEMENT } from '@/lib/questions-numero';
import { useOffre } from '@/lib/use-offre';

/** Après un retour de Stripe : combien de fois, et tous les combien, on relit l'état. */
const RELECTURES = 15;
const INTERVALLE_MS = 2_000;

/**
 * La fenêtre du partenaire (lot E du Crédit WhatsApp) : le bouton et ce que la carte dit, textes validés par Julien le
 * 2026-11-09. Une formule Pro ou un Business l'ont, l'option payée ; une Entreprise, selon son contrat.
 */
export const PAR_LA_LIGNE = {
  bouton: { fr: 'Connecter sans carte chez Meta', en: 'Connect without a card at Meta' },
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
 * « QUI PAIE VOS MESSAGES À META ? » (révision du Crédit WhatsApp du 2026-11-04, lot B) : deux cartes, chaque bouton sous
 * la sienne. Sur Connecter WhatsApp, c'est la première question du guide du numéro, et la voie de la carte chez Meta y
 * ouvre la suite (`children`) ; sur l'Accueil, tant qu'aucun numéro n'est connecté, elle y mène.
 *
 * La carte du moyen de paiement chez Meta (« Je mets un moyen de paiement (Visa / Mastercard) sur mon compte Meta
 * Business », Julien, 2026-11-09, lot 3a, avec ses deux liens) est la voie active (spec, moment 1) : le numéro se connecte
 * par notre application, et Meta le facture. Elle cède la place quand une ligne est payée ou posée (`en_attente`,
 * `active`), et se reprend d'un clic.
 *
 * « Crédit WhatsApp » dit ce que l'état de la ligne permet (`GET /credit-whatsapp/etat`, `etatLigneCredit` du serveur) :
 * grisée en Free et, tant que l'option n'est pas en vente en ligne, essai compris (« sur demande ») ; une fois en vente,
 * « Prendre l'option » dès que le serveur la dit à prendre (`a_prendre`, un Pro dès le début de son essai, lot 3v V1), la
 * raison de l'attente pour un Business en essai ou un Pro en retard (`essai`), puis la ligne qui s'ouvre, active, ou
 * arrêtée avec ses deux chemins. L'option payée, la fenêtre du partenaire demande « Votre numéro, ou le nôtre ? » (lot
 * 3v) : le sien par « Connecter sans carte chez Meta », le nôtre par le parcours du numéro fourni, ouvert par la même
 * fenêtre (`parLaLigne`). Les mots de la question sont ceux de la vitrine (`QUESTION_PAIEMENT`, tenus égaux par
 * `tests/questions-numero-vitrine.test.ts`) ; ceux de chaque état, validés par Julien le 2026-11-06.
 *
 * 🔴 LE RETOUR DE STRIPE NE PREND RIEN : il relit l'état jusqu'à voir l'option que le webhook écrit, et la prise reste
 * fermée en attendant (sinon le client la paierait deux fois, comme dans l'onglet).
 */
export function QuiRegleMeta({ tenantId, admin, lieu, connecte = false, children, api, surConnexion }: {
  tenantId: string;
  admin: boolean;
  /** `connecter` : la question du guide, et le retour de Stripe y arrive (`?option=`) ; `accueil` : elle mène au guide. */
  lieu: 'connecter' | 'accueil';
  /** Un numéro est connecté : la carte chez Meta ne rouvre le guide qu'une fois l'option arrêtée. */
  connecte?: boolean;
  /** La suite du guide, sous les cartes, quand la voie de la carte chez Meta est prise (Connecter WhatsApp). */
  children?: ReactNode;
  /**
   * La connexion de Connecter WhatsApp (lot E du Crédit WhatsApp) : l'autorité de ses appels et ce qui suit une connexion.
   * Sans elles (l'Accueil), le bouton de la fenêtre du partenaire mène à Connecter WhatsApp. Le parcours du numéro fourni
   * (« Le vôtre », lot 3v) en lit toutes les routes.
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

  useEffect(() => {
    if (lieu !== 'connecter') return;
    const p = new URLSearchParams(window.location.search);
    const o = p.get('option');
    setRetour(o === 'recue' || o === 'abandon' ? o : null);
    // Le retour de Stripe d'un numéro fourni payé : le parcours de « Le vôtre » reprend où il en était.
    if (p.get('abonnement') === 'recu') setNumeroLigne('notre');
  }, [lieu]);

  // Une Free n'a pas la route (402) : son état se dit sans elle. Une offre illisible tente la lecture quand même.
  const offre = vueOffre?.offre;
  useEffect(() => {
    if (vueOffre === undefined) return undefined;
    if (offre === 'free') { setVue({ etat: 'free', enVente: false, avecApplication: false, fenetrePartenaire: false }); return undefined; }
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
  const carteActive = carte ?? (!connecte && !lignePayee && !optionPayee && retour !== 'recue' && !fenetrePartenaire);
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
          <div className="space-y-2" data-testid="ligne-numero">
            <p className="text-sm font-semibold text-ink-900">{t(QUESTION_LIGNE_NUMERO.texte.fr, QUESTION_LIGNE_NUMERO.texte.en)}</p>
            <div className="flex flex-wrap gap-2">
              {(['mien', 'notre'] as const).map((r) => (
                <Bouton key={r} type="button" variante={choisie === r ? 'principal' : 'secondaire'} aria-pressed={choisie === r} onClick={() => repondreLigne(r)} data-testid={`ligne-numero-${r}`}>
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
  // Un numéro connecté que la ligne ne paie pas est payé par sa carte : elle est mise en avant (jaune 4 du lot B).
  const metaEnAvant = lieu === 'accueil' || connecte ? !lignePayee : carteActive;

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
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="grid grid-rows-[1fr_auto] gap-3">
            <div data-testid="carte-meta" className={`rounded-carte border p-4 ${metaEnAvant ? 'border-ink-900' : 'border-ink-200'}`}>
              <div className="text-sm font-semibold text-ink-900">{t(QUESTION_PAIEMENT.carte.titre.fr, QUESTION_PAIEMENT.carte.titre.en)}</div>
              <p className="mt-1 text-sm text-ink-700">
                {t('Vous connectez votre numéro, et Meta vous facture vos modèles sur ce moyen de paiement.', 'You connect your number, and Meta bills your templates to this payment method.')}
              </p>
              {/* Ses deux liens (lot 3a) : pourquoi un moyen de paiement, et ce qu'est un compte Meta Business. */}
              <p data-testid="carte-meta-liens" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {QUESTION_PAIEMENT.carte.liens.map((l) => (
                  <a key={l.href.fr} href={t(l.href.fr, l.href.en)} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink-900 underline">
                    {t(l.libelle.fr, l.libelle.en)}
                  </a>
                ))}
              </p>
            </div>
            {boutonCarte && <div>{boutonCarte}</div>}
          </div>
          <div className="grid grid-rows-[1fr_auto] gap-3">
            <div data-testid="carte-credit-wa" data-etat={etat ?? ''} aria-disabled={grisee || undefined} className={`rounded-carte border p-4 ${lignePayee ? 'border-ink-900' : 'border-ink-200'}`}>
              <div className={`text-sm font-semibold text-ink-900 ${grisee ? 'opacity-60' : ''}`}>{t(QUESTION_PAIEMENT.credit.titre.fr, QUESTION_PAIEMENT.credit.titre.en)}</div>
              <p className={`mt-1 text-sm text-ink-700 ${grisee ? 'opacity-60' : ''}`}>
                {/* Une Entreprise : son contrat, jamais le prix de l'option (jaune 9 du lot B, texte validé par Julien le 2026-11-06). */}
                {offre === 'entreprise'
                  ? t('Vous payez vos messages chez Messaging Me, sans carte chez Meta, selon votre contrat Entreprise.', 'You pay for your messages at Messaging Me, with no card at Meta, under your Enterprise contract.')
                  : t(QUESTION_PAIEMENT.credit.texte.fr, QUESTION_PAIEMENT.credit.texte.en)}
              </p>
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
      {/* La suite de « Votre numéro, ou le nôtre ? » (lot 3v), sous les cartes. Le sien : la phrase validée de Julien pour
          un numéro qui sert dans l'application, AVANT la fenêtre. Le nôtre : le numéro fourni, relié par la même fenêtre
          du partenaire, jamais en `fourni_application` (la ligne ne paie que l'API). */}
      {ligneIci && !carteActive && numeroLigne === 'mien' && api && surConnexion && (
        <div data-testid="ligne-numero-mien-suite" className="mt-4 rounded-carte border border-ink-200 bg-white p-5">
          <p className="text-sm text-ink-700" data-testid="ligne-numero-application">
            <span className="font-semibold text-ink-900">{t(ISSUE_API.garder.fr, ISSUE_API.garder.en)}</span>{' '}
            {t(QUESTION_LIGNE_NUMERO.application.fr, QUESTION_LIGNE_NUMERO.application.en)}
          </p>
          <div className="mt-3"><BoutonParLaLigne tenantId={tenantId} api={api} surConnexion={surConnexion} /></div>
        </div>
      )}
      {ligneIci && !carteActive && numeroLigne === 'notre' && api && surConnexion && (
        <ParcoursNumero tenantId={tenantId} api={api} choixInitial="fourni" parLaLigne retour="console" connecte={connecte} surConnexion={surConnexion} />
      )}
    </div>
  );
}

/**
 * « Connecter sans carte chez Meta » (lot E du Crédit WhatsApp) : la fenêtre de Meta ouverte avec la solution du
 * partenaire, dont la configuration ne rend l'identifiant qu'à un espace qui a droit à la ligne. Il porte sa propre
 * connexion, et n'est monté qu'une fois la voie de la carte chez Meta refermée (« Le mien », lot 3v) : sa fenêtre s'ouvre
 * dans le geste du clic (Safari, `ouvrirFenetreMeta`).
 */
function BoutonParLaLigne({ tenantId, api, surConnexion }: {
  tenantId: string;
  api: Pick<ApiConnexionNumero, 'config' | 'completer'>;
  surConnexion: (avertissements: string[]) => void;
}) {
  const t = useT();
  const connexion = useConnexionNumero(tenantId, api, surConnexion);
  const pret = connexion.cfg?.enabled === true && (connexion.cfg.solutionId ?? null) !== null;
  return (
    <div className="space-y-2">
      <Bouton
        type="button" data-testid="carte-credit-wa-connecter-ligne"
        enCours={connexion.busy} disabled={!pret || connexion.busy}
        onClick={() => { void connexion.connect({ parLaLigne: true }); }}
      >
        {t(PAR_LA_LIGNE.bouton.fr, PAR_LA_LIGNE.bouton.en)}
      </Bouton>
      {connexion.peutEtreBloquee && <p className="text-xs text-ink-500">{t(FENETRE_BLOQUEE.fr, FENETRE_BLOQUEE.en)}</p>}
      {connexion.error && <p className="text-sm text-danger" data-testid="carte-credit-wa-connecter-ligne-erreur">{connexion.error}</p>}
    </div>
  );
}
