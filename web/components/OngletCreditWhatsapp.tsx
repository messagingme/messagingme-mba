'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  achatArriveDepuis, estPageDePaiement, lireDepartPaiement, oublierDepartPaiement, ouvrirFacture, retenirDepartPaiement,
  seuilDuRetour,
} from '@/lib/api-credit';
import {
  aUneFactureWhatsapp, changerPlacesOption, factureDeLaPlace, getCreditWhatsapp, ouvrirAchatWhatsapp, ouvrirOptionWhatsapp,
  type LigneCreditWhatsapp, type OffreWhatsapp, type OptionCreditWhatsapp, type VueCreditWhatsapp,
} from '@/lib/api-credit-whatsapp';
import { portailPro } from '@/lib/api/offre';
import { raisonAttenteOption } from '@/lib/offre';
import { AVERTISSEMENT_APPLICATION } from '@/lib/questions-numero';
import { relireOffre, useFormuleProADemarrer, useOffre } from '@/lib/use-offre';
import { SEUIL_CREDIT_WHATSAPP_BAS_MICRO_EUR, SOLDE_REPRISE_CREDIT_MICRO_EUR } from '@/lib/partage/credit-whatsapp';
import { eurosDepuisMicro } from '@/lib/agent-solde';
import { erreurDeChargement } from '@/lib/http';
import { fmtCost, fmtNum } from '@/lib/format';
import { formatDate } from '@/lib/day';
import type { Locale } from '@/lib/locale';
import type { Session } from '@/lib/session';
import { useT, useLocale } from '@/lib/i18n';
import { inputClsAuto } from '@/lib/ui';
import { IntroPage } from '@/components/TitrePage';
import { Squelette } from '@/components/Squelette';
import { Bouton } from '@/components/Bouton';
import { MbaNotice } from '@/components/MbaNotice';
import { CourbeCredit } from '@/components/CourbeCredit';
import { DemarrerPro } from '@/components/DemarrerPro';

/**
 * LE CRÉDIT WHATSAPP DE L'ESPACE (plan du Crédit WhatsApp, tâche 11) : troisième onglet de Paramètres > Offre, ouvert à
 * un espace dont un numéro est sur la ligne de crédit (`ongletCreditWhatsapp` de la vue de l'offre, jamais en Free). Le
 * solde, le prix d'un message vers la France, les quatre achats et l'historique.
 *
 * 🔴 UNE ENTREPRISE EST ILLIMITÉE (décision du 2026-11-02, `vue.illimite`) : « Illimité » et la consommation du mois à la
 * place du solde, qui ne bouge pas, et aucune recharge. Ses messages sont facturés selon son contrat.
 *
 * 🔴 TOUT S'ARRÊTE À ZÉRO : un message ne part que si le solde couvre son prix, réponses de l'Inbox et des agents IA
 * comprises. L'écran le dit en clair, sans jamais parler de la ligne ni de qui la porte.
 *
 * 🔴 UN PRIX SE MONTRE TOUT COMPRIS, JAMAIS UN TAUX : le serveur rend le prix d'un message, la console ignore la commission.
 *
 * 🔴 LE RETOUR DE STRIPE NE CRÉDITE RIEN, comme au Crédit IA (`OngletCreditIA`) : il relit jusqu'à voir la ligne `achat`
 * de CE paiement (`achatArriveDepuis`), le temps que le webhook signé de Stripe passe.
 *
 * L'OPTION (lot 4a, 30 € HT par numéro et par mois, `OptionDuCredit`) : un Pro ou un Business la prend ici, pour 1 à 20
 * numéros, et en change le nombre ; l'onglet paraît pour elle dès qu'elle est en vente, sans numéro sur le Crédit WhatsApp.
 * Un tel espace n'envoie pas par le solde : l'écran ne le dit donc jamais épuisé. Comme au paiement, le retour de Stripe ne
 * prend rien : il relit jusqu'à voir les places que le webhook a écrites.
 *
 * ⚠️ `useSearchParams` : la page qui monte cet onglet le place sous une frontière Suspense (règle de Next 15).
 */

/** Après un retour de paiement : combien de fois, et tous les combien, on relit en attendant le webhook. */
const RELECTURES_APRES_PAIEMENT = 10;
const INTERVALLE_RELECTURE_MS = 3_000;

export function OngletCreditWhatsapp({ session }: { session: Session }) {
  const t = useT();
  const { locale } = useLocale();
  const params = useSearchParams();
  const retour = params.get('paiement');
  const retourOption = params.get('option');
  const [vue, setVue] = useState<VueCreditWhatsapp | null>(null);
  const [erreurLecture, setErreurLecture] = useState(false);
  const [enCours, setEnCours] = useState<OffreWhatsapp | null>(null);
  const [indisponible, setIndisponible] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Le crédit est-il arrivé depuis le retour de paiement ? Tant que non, l'écran le dit et relit.
  const [arrive, setArrive] = useState(false);
  const [erreurFacture, setErreurFacture] = useState<string | null>(null);
  // L'option payée n'est pas arrivée après toutes les relectures du retour : le webhook tarde.
  const [optionTarde, setOptionTarde] = useState(false);

  const relire = useCallback(async (): Promise<VueCreditWhatsapp> => {
    const v = await getCreditWhatsapp(session.tenantId);
    setVue(v);
    setErreurLecture(false);
    return v;
  }, [session.tenantId]);

  useEffect(() => {
    let vivant = true;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    // L'arrivée se lit sur la ligne `achat` de ce paiement, dès la première lecture : le webhook passe souvent avant elle.
    const seuil = seuilDuRetour(lireDepartPaiement(), Date.now());
    const constater = (): void => {
      setArrive(true);
      oublierDepartPaiement();
    };
    const demarrer = async (): Promise<void> => {
      let initial: number | null = null;
      try {
        const v = await relire();
        initial = v.soldeMicroEur;
        if (vivant && retour === 'recu' && achatArriveDepuis(v.historique, seuil)) {
          constater();
          return;
        }
      } catch {
        if (vivant) setErreurLecture(true);
      }
      if (retour !== 'recu') return;
      let restantes = RELECTURES_APRES_PAIEMENT;
      const suivante = (): void => {
        if (!vivant || restantes <= 0) return;
        restantes -= 1;
        minuteur = setTimeout(() => {
          relire()
            .then((v) => {
              if (!vivant) return;
              if (achatArriveDepuis(v.historique, seuil) || (initial !== null && v.soldeMicroEur > initial)) constater();
              else suivante();
            })
            .catch(() => suivante());
        }, INTERVALLE_RELECTURE_MS);
      };
      suivante();
    };
    void demarrer();
    return () => { vivant = false; if (minuteur) clearTimeout(minuteur); };
  }, [relire, retour]);

  // Le retour du paiement de l'option : relire jusqu'à voir les places que le webhook a écrites.
  useEffect(() => {
    if (retourOption !== 'recue') return;
    let vivant = true;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    let restantes = RELECTURES_APRES_PAIEMENT;
    const suivante = (): void => {
      if (!vivant) return;
      // Toutes les relectures faites sans l'option : le webhook tarde, l'écran le dit (la prise reste fermée).
      if (restantes <= 0) {
        setOptionTarde(true);
        return;
      }
      restantes -= 1;
      minuteur = setTimeout(() => {
        relire()
          .then((v) => { if (vivant && v.option.places === 0 && v.option.statut === null) suivante(); })
          .catch(() => suivante());
      }, INTERVALLE_RELECTURE_MS);
    };
    suivante();
    return () => { vivant = false; if (minuteur) clearTimeout(minuteur); };
  }, [relire, retourOption]);

  async function payer(offre: OffreWhatsapp): Promise<void> {
    setEnCours(offre);
    setErreur(null);
    try {
      const r = await ouvrirAchatWhatsapp(session.tenantId, offre);
      if ('indisponible' in r) {
        setIndisponible(true);
        setEnCours(null);
        return;
      }
      if (!estPageDePaiement(r.url)) throw new Error(t('Adresse de paiement invalide.', 'Invalid payment address.'));
      retenirDepartPaiement(Date.now());
      window.location.assign(r.url);
    } catch (err) {
      setErreur(erreurDeChargement(err, t));
      setEnCours(null);
    }
  }

  /** La facture d'un achat, dans un nouvel onglet ouvert dans le clic (même raison qu'au Crédit IA : `OngletCreditIA`). */
  async function voirFacture(sessionId: string): Promise<void> {
    setErreurFacture(null);
    const onglet = window.open('', '_blank');
    try {
      const url = await ouvrirFacture(session.tenantId, sessionId);
      if (onglet) {
        onglet.opener = null;
        onglet.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      onglet?.close();
      setErreurFacture(erreurDeChargement(err, t));
    }
  }

  const admin = session.role === 'admin';
  const ouvert = vue !== null && vue.achat.permis === 'ok';
  const illimite = vue?.illimite === true;
  // Aucun numéro sur le Crédit WhatsApp (l'onglet paraît pour l'option) : ses messages ne passent pas par le solde.
  const sansNumero = vue !== null && vue.achat.permis === 'sans_ligne' && !vue.ligneArretee;
  const option = vue?.option;
  const avecOption = !illimite && option !== undefined && (option.disponible || option.places > 0 || option.statut !== null);

  return (
    <div className="max-w-formulaire space-y-4">
      <IntroPage>
        {illimite
          ? t(
            'Votre offre Entreprise comprend un Crédit WhatsApp illimité : vos messages partent sans solde à recharger, et nous les facturons selon votre contrat.',
            'Your Enterprise plan includes unlimited WhatsApp credit: your messages go out with no balance to top up, and we bill them under your contract.',
          )
          : t(
            'Le crédit prépayé qui paie les messages WhatsApp de vos numéros. À zéro, plus aucun message ne part, réponses comprises.',
            'The prepaid credit that pays for your numbers’ WhatsApp messages. At zero, no message goes out any more, replies included.',
          )}
      </IntroPage>

      {retour === 'recu' && (
        <MbaNotice kind="success" testid="credit-wa-retour-recu">
          {arrive
            ? t('Paiement reçu, votre Crédit WhatsApp est à jour. La facture vous est envoyée par e-mail.', 'Payment received, your WhatsApp credit is up to date. The invoice is sent to you by email.')
            : t('Paiement reçu : le crédit arrive dans quelques secondes.', 'Payment received: the credit arrives in a few seconds.')}
        </MbaNotice>
      )}
      {retour === 'abandon' && (
        <MbaNotice kind="warning" testid="credit-wa-retour-abandon">
          {t('Paiement abandonné : rien n’a été débité.', 'Payment cancelled: nothing was charged.')}
        </MbaNotice>
      )}
      {erreurLecture && vue === null && (
        <MbaNotice kind="error" testid="credit-wa-erreur-lecture">
          {t('Le Crédit WhatsApp n’a pas pu être lu. Réessayez dans un instant.', 'The WhatsApp credit could not be read. Try again in a moment.')}
        </MbaNotice>
      )}
      {vue?.ligneArretee && (
        <MbaNotice kind="error" testid="credit-wa-ligne-arretee">
          {t(
            'Le Crédit WhatsApp est arrêté sur vos numéros : plus aucun message ne part, et une recharge n’y changerait rien. Contactez-nous depuis le Support.',
            'The WhatsApp credit is stopped on your numbers: no message goes out any more, and a top-up would not change that. Contact us from Support.',
          )}
        </MbaNotice>
      )}

      <section className="rounded-carte border border-ink-200 bg-white p-5" data-testid="credit-wa-solde">
        <div className="text-xs font-medium text-ink-500">{illimite ? t('Crédit WhatsApp', 'WhatsApp credit') : t('Crédit WhatsApp restant', 'WhatsApp credit left')}</div>
        {vue === null && !erreurLecture && <Squelette forme="carte" className="mt-1" />}
        {vue !== null && illimite && (
          <>
            <div className="mt-1 text-3xl font-semibold tracking-tight text-ink-900" data-testid="credit-wa-illimite">{t('Illimité', 'Unlimited')}</div>
            <p className="mt-2 text-sm text-ink-500" data-testid="credit-wa-conso-mois">
              {t(`Messages de ce mois-ci : ${euros(vue.consommationDuMoisMicroEur, locale)} HT, facturés selon votre contrat.`,
                `This month’s messages: ${euros(vue.consommationDuMoisMicroEur, locale)} excl. VAT, billed under your contract.`)}
            </p>
          </>
        )}
        {vue !== null && !illimite && (
          <>
            <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-ink-900">{euros(vue.soldeMicroEur, locale)}</div>
            {vue.soldeMicroEur <= 0 && !vue.ligneArretee && !sansNumero && (
              <p className="mt-2 text-sm text-danger" data-testid="credit-wa-epuise">
                {t(
                  'Épuisé : plus aucun message WhatsApp ne part, réponses de l’Inbox et des agents IA comprises. Une campagne arrêtée faute de crédit reprend seule après la recharge.',
                  'Used up: no WhatsApp message goes out any more, Inbox and AI agent replies included. A campaign stopped for lack of credit resumes on its own after the top-up.',
                )}
              </p>
            )}
            {/* Sous un euro, et pas seulement à zéro : la garde refuse un message dès que le solde ne couvre plus son prix, et
                une campagne arrêtée ne repart qu'au-dessus d'un euro (`SOLDE_REPRISE_CREDIT_MICRO_EUR`). */}
            {vue.soldeMicroEur > 0 && vue.soldeMicroEur < SOLDE_REPRISE_CREDIT_MICRO_EUR && !vue.ligneArretee && !sansNumero && (
              <p className="mt-2 text-sm text-danger" data-testid="credit-wa-presque-epuise">
                {t(
                  'Presque épuisé : sous un euro, ce reste ne couvre déjà plus certains messages, et une campagne arrêtée faute de crédit attend une recharge pour repartir.',
                  'Almost used up: below one euro, what is left already no longer covers some messages, and a campaign stopped for lack of credit waits for a top-up to resume.',
                )}
              </p>
            )}
            {vue.soldeMicroEur >= SOLDE_REPRISE_CREDIT_MICRO_EUR && vue.soldeMicroEur < SEUIL_CREDIT_WHATSAPP_BAS_MICRO_EUR && !vue.ligneArretee && !sansNumero && (
              <p className="mt-2 text-sm text-alerte" data-testid="credit-wa-bas">
                {t('C’est bas : au bout, plus aucun message ne partira, réponses comprises.', 'That is low: once it runs out, no message will go out, replies included.')}
              </p>
            )}
          </>
        )}
      </section>

      <section className="rounded-carte border border-ink-200 bg-white p-5" data-testid="credit-wa-prix">
        <h2 className="text-sm font-semibold text-ink-900">{t('Prix d’un message vers la France', 'Price of a message to France')}</h2>
        {vue === null && !erreurLecture && <Squelette forme="carte" className="mt-2" />}
        {vue !== null && vue.prixFrance === null && (
          <p className="mt-1 text-sm text-ink-500" data-testid="credit-wa-prix-absents">
            {t('Les prix ne sont pas encore disponibles.', 'Prices are not available yet.')}
          </p>
        )}
        {vue !== null && vue.prixFrance !== null && (
          <>
            <ul className="mt-2 divide-y divide-ink-100">
              {vue.prixFrance.map((p) => (
                <li key={p.categorie} className="flex items-baseline justify-between gap-3 py-2 text-sm" data-testid="credit-wa-prix-ligne" data-categorie={p.categorie}>
                  <span className="text-ink-900">{libelleCategorie(p.categorie, t)}</span>
                  <span className="tabular-nums text-ink-900">{fmtCost(p.prixMicroEur / 1_000_000, locale, 'EUR')}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-500">
              {t(
                `Prix hors taxe, tout compris, selon le tarif en vigueur de Meta. Un message vers un autre pays est débité au prix de ce pays, et un message que Meta ne facture pas ne vous coûte rien. Les ${fmtNum(vue.franchiseServiceParNumero, 'fr')} premières réponses de chaque numéro sont offertes chaque mois.`,
                `Prices excluding VAT, all included, based on Meta’s current rates. A message to another country is charged at that country’s price, and a message Meta does not bill costs you nothing. The first ${fmtNum(vue.franchiseServiceParNumero, 'en')} replies of each number are free every month.`,
              )}
            </p>
          </>
        )}
      </section>

      {avecOption && option !== undefined && (
        <OptionDuCredit tenantId={session.tenantId} option={option} admin={admin} retour={retourOption} tarde={optionTarde} relire={relire} />
      )}

      {!illimite && (
        <section className="rounded-carte border border-ink-200 bg-white p-5" data-testid="credit-wa-recharger">
          <h2 className="text-sm font-semibold text-ink-900">{t('Recharger', 'Top up')}</h2>
          {!admin && (
            <p className="mt-1 text-sm text-ink-500" data-testid="credit-wa-non-admin">
              {t('Demandez à un administrateur de votre espace de recharger le Crédit WhatsApp.', 'Ask an administrator of your workspace to top up the WhatsApp credit.')}
            </p>
          )}
          {admin && vue !== null && ouvert && (indisponible || !vue.achat.disponible) && (
            <p className="mt-1 text-sm text-ink-500" data-testid="credit-wa-indisponible">
              {t('La recharge en ligne n’est pas encore disponible. Contactez-nous depuis le Support.', 'Online top-up isn’t available yet. Contact us from Support.')}
            </p>
          )}
          {admin && vue !== null && !ouvert && !vue.ligneArretee && (
            <p className="mt-1 text-sm text-ink-500" data-testid="credit-wa-ferme">
              {sansNumero && avecOption
                ? t('La recharge s’ouvre dès qu’un de vos numéros est sur le Crédit WhatsApp, avec l’option ci-dessus.', 'Top-up opens as soon as one of your numbers is on WhatsApp credit, with the option above.')
                : t('La recharge n’est pas ouverte pour cet espace. Contactez-nous depuis le Support.', 'Top-up is not open for this workspace. Contact us from Support.')}
            </p>
          )}
          {admin && vue !== null && ouvert && !indisponible && vue.achat.disponible && (
            <>
              <p className="mt-1 text-sm text-ink-500">
                {t(
                  'Montants hors taxe, TVA en sus. Le paiement se fait sur la page sécurisée de Stripe, qui vous envoie la facture par e-mail.',
                  'Amounts exclude VAT, which is added at checkout. Payment happens on Stripe’s secure page, which emails you the invoice.',
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {vue.achat.offres.map(({ offre, htCentimes }) => (
                  <Bouton
                    key={offre}
                    data-testid={`credit-wa-offre-${offre}`}
                    onClick={() => { void payer(offre); }}
                    disabled={enCours !== null}
                    enCours={enCours === offre}
                  >
                    {t(`Recharger ${fmtNum(htCentimes / 100, 'fr')} € HT`, `Top up €${fmtNum(htCentimes / 100, 'en')} excl. VAT`)}
                  </Bouton>
                ))}
              </div>
            </>
          )}
          {erreur && <p className="mt-2 text-sm text-danger" data-testid="credit-wa-erreur">{erreur}</p>}
          <p className="mt-3 text-xs text-ink-500">
            {t(
              'Ce que le crédit paie : chaque message WhatsApp que vos numéros envoient (campagnes, scénarios, réponses de l’Inbox et de vos agents IA). Il ne paie pas l’IA, qui puise dans le Crédit IA.',
              'What the credit pays for: every WhatsApp message your numbers send (campaigns, scenarios, Inbox and AI agent replies). It does not pay for AI, which draws on the AI credit.',
            )}
          </p>
        </section>
      )}

      {vue !== null && <CourbeCredit serie={vue.serie} illimite={illimite} testid="credit-wa-courbe" />}

      <section className="rounded-carte border border-ink-200 bg-white p-5" data-testid="credit-wa-historique">
        <h2 className="text-sm font-semibold text-ink-900">{t('Historique', 'History')}</h2>
        {vue === null && !erreurLecture && <Squelette forme="carte" className="mt-2" />}
        {vue !== null && vue.historique.length === 0 && (
          <p className="mt-1 text-sm text-ink-500">{t('Aucun mouvement pour l’instant.', 'No movement yet.')}</p>
        )}
        {vue !== null && vue.historique.length > 0 && (
          <ul className="mt-2 divide-y divide-ink-100">
            {vue.historique.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-3 py-2 text-sm" data-testid="credit-wa-ligne" data-raison={m.raison}>
                <span className="text-ink-900">
                  {libelle(m, t, locale)}
                  <span className="ml-2 text-xs text-ink-500">{formatDate(m.at, locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                  {admin && aUneFactureWhatsapp(m) && (
                    <button
                      type="button"
                      onClick={() => { void voirFacture(m.reference); }}
                      data-testid="credit-wa-facture"
                      className="ml-2 text-xs font-medium text-brand-600 hover:underline"
                    >
                      {t('Facture', 'Invoice')}
                    </button>
                  )}
                </span>
                {/* Une Entreprise ne voit pas son solde baisser (illimité) : ses envois s'affichent sans « moins ». */}
                <span className={`tabular-nums ${m.deltaMicroEur >= 0 ? 'text-ink-900' : 'text-ink-500'}`} data-testid="credit-wa-montant">
                  {illimite && m.deltaMicroEur < 0
                    ? fmtCost(-m.deltaMicroEur / 1_000_000, locale, 'EUR')
                    : `${m.deltaMicroEur >= 0 ? '+' : ''}${fmtCost(m.deltaMicroEur / 1_000_000, locale, 'EUR')}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {erreurFacture && <p className="mt-2 text-sm text-danger" data-testid="credit-wa-facture-erreur">{erreurFacture}</p>}
      </section>
    </div>
  );
}

/**
 * L'option du Crédit WhatsApp (lot 4a) : la prendre pour 1 à `placesMax` numéros (Checkout de Stripe), ou en changer le
 * nombre un numéro à la fois, son prix dit avant que rien ne soit facturé (comme le siège du Pro, `admin/page.tsx`). Un
 * ajout se paie au prorata avant de compter : un paiement qui n'aboutit pas donne la page de sa facture. Un retrait ne passe
 * pas sous les numéros déjà sur le Crédit WhatsApp. Carte, factures et résiliation passent par le portail de Stripe.
 */
function OptionDuCredit({ tenantId, option, admin, retour, tarde, relire }: {
  tenantId: string;
  option: OptionCreditWhatsapp;
  admin: boolean;
  retour: string | null;
  /** Le retour de Stripe a été relu jusqu'au bout sans voir l'option : le webhook tarde. */
  tarde: boolean;
  relire: () => Promise<unknown>;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [voulues, setVoulues] = useState(1);
  const [geste, setGeste] = useState<'prendre' | 'ajouter' | 'retirer' | 'portail' | null>(null);
  const [confirmer, setConfirmer] = useState<'ajouter' | 'retirer' | null>(null);
  const [indisponible, setIndisponible] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [facture, setFacture] = useState<string | null>(null);

  const prise = option.places > 0 || option.statut !== null;
  // 🔴 Payée, pas encore arrivée (le webhook n'est pas passé) : la prise reste fermée, sinon le client la paierait deux fois
  // (relecture du lot 4a-2 ; le Pro fait de même, `offre/page.tsx`).
  const enAttenteDuRetour = retour === 'recue' && !prise;
  const prixMois = (n: number): string => fmtNum((option.prixHtCentimes * n) / 100, locale);
  const s = (n: number): string => (n > 1 ? 's' : '');

  // 🔴 L'OPTION ATTEND UNE FORMULE PAYÉE (révision du 2026-11-04) : la règle du serveur (`formulePayee`), lue telle quelle,
  // jamais recalculée ici. Pendant l'essai, l'onglet explique au lieu de vendre, et propose à un Pro de démarrer sa formule
  // maintenant, puis enchaîne sur le paiement de l'option. Le statut de l'abonnement ne sert qu'à choisir les mots.
  const attend = !prise && option.disponible && !option.formulePayee;
  const vueOffre = useOffre(tenantId);
  const abonnement = vueOffre?.abonnement ?? null;
  const essaiPro = attend && vueOffre?.offre === 'pro' && abonnement?.statut === 'essai';
  // Le tarif réel de l'abonné (un code promo le baisse) pour la confirmation, lu pour un administrateur seulement (jaune 14
  // de la relecture du lot A5) ; la grille sert tant qu'il n'est pas lu. La carte « Crédit WhatsApp » dit la même chose.
  const formulePro = useFormuleProADemarrer(tenantId, vueOffre, essaiPro && admin);
  const [demarrageEnAttente, setDemarrageEnAttente] = useState(false);
  /**
   * Démarrée et payée : la formule s'écrit chez nous en quelques secondes. « Démarrer » ne revient pas entre-temps, même
   * si la prise de l'option est refusée tant qu'elle n'est pas écrite (jaune 11 de la relecture du lot A5).
   */
  const [demarree, setDemarree] = useState(false);
  const raisonAttente = raisonAttenteOption(vueOffre?.offre, abonnement?.statut, t);

  /** Le nombre de numéros de l'option : avant de la prendre, ou avant de démarrer la formule Pro qui y mène. */
  const choixPlaces = (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-ink-500">{t('Nombre de numéros', 'How many numbers')}</span>
      <select
        className={`${inputClsAuto} bg-white`}
        value={voulues}
        onChange={(e) => setVoulues(Number(e.target.value))}
        data-testid="credit-wa-option-places"
      >
        {Array.from({ length: Math.max(1, option.placesMax) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );

  /** Après le démarrage de la formule Pro : un paiement fait enchaîne sur l'option ; sinon l'offre et l'onglet sont relus. */
  async function apresDemarrage(paye: boolean): Promise<void> {
    if (paye) {
      setDemarree(true);
      await prendre();
    } else setDemarrageEnAttente(true);
    // Encore ici (un paiement en cours, ou une prise refusée) : l'écran suit l'offre et l'onglet relus.
    await relireOffre(tenantId).catch(() => undefined);
    await relire().catch(() => undefined);
  }
  // Une ligne couvre tout le compte WhatsApp : au-delà des places, un numéro du compte n'envoie pas.
  const enService = Math.min(option.couverts, option.places);
  const enTrop = Math.max(0, option.couverts - option.places);
  const libres = Math.max(0, option.places - option.couverts);
  const modifiable = admin && option.disponible && option.statut === 'actif' && option.finPrevueLe === null;
  const retraitPossible = option.places - 1 >= Math.max(1, option.couverts);

  async function prendre(): Promise<void> {
    setGeste('prendre');
    setErreur(null);
    try {
      const r = await ouvrirOptionWhatsapp(tenantId, voulues);
      if ('indisponible' in r) {
        setIndisponible(true);
        setGeste(null);
        return;
      }
      if (!estPageDePaiement(r.url)) throw new Error(t('Adresse de paiement invalide.', 'Invalid payment address.'));
      window.location.assign(r.url);
    } catch (err) {
      setErreur(erreurDeChargement(err, t));
      setGeste(null);
    }
  }

  /** Un numéro de plus ou de moins, depuis les places que l'écran a lues : une vue périmée est refusée par le serveur. */
  async function changer(sens: 'ajouter' | 'retirer'): Promise<void> {
    setGeste(sens);
    setErreur(null);
    setFacture(null);
    try {
      await changerPlacesOption(tenantId, option.places, sens === 'ajouter' ? option.places + 1 : option.places - 1);
    } catch (err) {
      setFacture(factureDeLaPlace(err));
      setErreur(erreurDeChargement(err, t));
    } finally {
      setConfirmer(null);
      setGeste(null);
      // Les places relues dans tous les cas : un refus « changé entre-temps » se corrige à la relecture.
      await relire().catch(() => undefined);
    }
  }

  async function gerer(): Promise<void> {
    setGeste('portail');
    setErreur(null);
    try {
      window.location.assign((await portailPro(tenantId)).url);
    } catch (err) {
      setErreur(erreurDeChargement(err, t));
      setGeste(null);
    }
  }

  return (
    <section className="rounded-carte border border-ink-200 bg-white p-5" data-testid="credit-wa-option">
      <h2 className="text-sm font-semibold text-ink-900">{t('Vos numéros sur le Crédit WhatsApp', 'Your numbers on WhatsApp credit')}</h2>
      <p className="mt-1 text-sm text-ink-500">
        {t(
          `L’option Crédit WhatsApp : ${prixMois(1)} € HT par numéro et par mois, TVA en sus. Les messages de ces numéros sont payés par votre Crédit WhatsApp, sans carte à enregistrer chez Meta.`,
          `The WhatsApp credit option: €${prixMois(1)} excl. VAT per number per month, VAT added. The messages of these numbers are paid by your WhatsApp credit, with no card to register with Meta.`,
        )}
      </p>
      {retour === 'recue' && (
        <MbaNotice kind="success" testid="credit-wa-option-recue">
          {prise
            ? t('Paiement reçu, votre option est active.', 'Payment received, your option is active.')
            : tarde
              ? t(
                'Paiement reçu, mais votre option n’est pas encore arrivée : rechargez la page dans quelques minutes. Si rien n’arrive, contactez-nous depuis le Support, sans la reprendre : elle serait payée deux fois.',
                'Payment received, but your option has not arrived yet: reload the page in a few minutes. If nothing arrives, contact us from Support, without taking it again: it would be paid twice.',
              )
              : t('Paiement reçu : votre option arrive dans quelques secondes.', 'Payment received: your option arrives in a few seconds.')}
        </MbaNotice>
      )}
      {retour === 'abandon' && !prise && (
        <MbaNotice kind="warning" testid="credit-wa-option-abandon">
          {t('Paiement de l’option abandonné : rien n’a été débité pour l’option.', 'Option payment cancelled: nothing was charged for the option.')}
        </MbaNotice>
      )}

      {!prise && !admin && !attend && (
        <p className="mt-2 text-sm text-ink-500" data-testid="credit-wa-option-non-admin">
          {t('Demandez à un administrateur de votre espace de prendre l’option.', 'Ask an administrator of your workspace to take the option.')}
        </p>
      )}
      {!prise && admin && !enAttenteDuRetour && (indisponible || !option.disponible) && (
        <p className="mt-2 text-sm text-ink-500" data-testid="credit-wa-option-indisponible">
          {t('L’option n’est pas encore disponible en ligne. Contactez-nous depuis le Support.', 'The option isn’t available online yet. Contact us from Support.')}
        </p>
      )}
      {/* Pendant un essai (moment 1 de la révision du 2026-11-04) : qui facture quoi, et quand l'option s'ouvre. Jamais
          « Prendre l'option » : la prise la refuserait. */}
      {!prise && !enAttenteDuRetour && attend && (
        <div className="mt-3 space-y-3" data-testid="credit-wa-option-essai">
          <p className="text-sm text-ink-700">
            {t('Le Crédit WhatsApp, vos messages payés chez Messaging Me sans carte chez Meta, vient avec la formule payante.',
              'WhatsApp credit, your messages paid at Messaging Me with no card at Meta, comes with the paid plan.')}
            {/* Hors de l'essai (un paiement en retard), pas d'essai à évoquer (jaune 7 de la relecture du lot A5). */}
            {abonnement?.statut !== 'en_retard' && ` ${t('Pendant l’essai, vous connectez votre numéro avec votre carte chez Meta, qui vous facture vos modèles.',
              'During the trial, you connect your number with your card at Meta, which bills your templates.')}`}
          </p>
          {essaiPro && demarree ? (
            <p className="text-sm text-ink-700" data-testid="credit-wa-option-demarree">
              {t('Votre formule Pro démarre : l’option s’ouvre dans quelques secondes. Rechargez la page si elle tarde.',
                'Your Pro plan is starting: the option opens in a few seconds. Reload the page if it takes a while.')}
            </p>
          ) : essaiPro ? (
            <>
              <p className="text-sm text-ink-700">
                {t('Il s’ouvre à la fin de l’essai, ou tout de suite si vous démarrez votre formule Pro maintenant.',
                  'It opens at the end of the trial, or right away if you start your Pro plan now.')}
              </p>
              {admin ? (
                <div className="flex flex-wrap items-end gap-3">
                  {choixPlaces}
                  <DemarrerPro
                    tenantId={tenantId}
                    formule={formulePro}
                    suite={t(`Ensuite, vous réglez l’option Crédit WhatsApp pour ${voulues} numéro${s(voulues)}, ${prixMois(voulues)} € HT par mois, sur la page de paiement de Stripe.`,
                      `Then you pay for the WhatsApp credit option for ${voulues} number${s(voulues)}, €${prixMois(voulues)} excl. VAT per month, on Stripe’s payment page.`)}
                    onDemarre={apresDemarrage}
                    testid="credit-wa-option-demarrer"
                  />
                </div>
              ) : (
                <p className="text-sm text-ink-500" data-testid="credit-wa-option-non-admin">
                  {t('Un administrateur de votre espace peut démarrer la formule Pro maintenant.', 'An administrator of your workspace can start the Pro plan now.')}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-700" data-testid="credit-wa-option-attente">{raisonAttente}</p>
          )}
        </div>
      )}
      {/* Hors du bloc de l'essai : la relecture qui suit le démarrage le fait disparaître. */}
      {demarrageEnAttente && (
        <div className="mt-3">
          <MbaNotice kind="warning" testid="credit-wa-option-demarrage-attente">
            {t('Votre essai est arrêté et le premier paiement de votre formule Pro est en cours chez votre banque, qui le confirme sous quelques jours.',
              'Your trial is over and the first payment of your Pro plan is being processed by your bank, which confirms it within a few days.')}
          </MbaNotice>
        </div>
      )}
      {/* Tous les numéros gardent l'application : ils restent sur la carte chez Meta (décision 8), dit avant de payer. */}
      {!prise && admin && !enAttenteDuRetour && !indisponible && option.disponible && !attend && option.avecApplication && (
        <p className="mt-3 text-sm text-alerte-700" data-testid="credit-wa-option-avertissement">{t(AVERTISSEMENT_APPLICATION.fr, AVERTISSEMENT_APPLICATION.en)}</p>
      )}
      {!prise && admin && !enAttenteDuRetour && !indisponible && option.disponible && !attend && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {choixPlaces}
          <Bouton data-testid="credit-wa-option-prendre" onClick={() => { void prendre(); }} disabled={geste !== null} enCours={geste === 'prendre'}>
            {t(`Prendre l’option, ${prixMois(voulues)} € HT par mois`, `Take the option, €${prixMois(voulues)} excl. VAT per month`)}
          </Bouton>
        </div>
      )}

      {prise && (
        <>
          <ul className="mt-2 divide-y divide-ink-100">
            <li className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="text-ink-900">{t('Numéros payés', 'Paid numbers')}</span>
              <span className="tabular-nums text-ink-900" data-testid="credit-wa-option-payes">{fmtNum(option.places, locale)}</span>
            </li>
            <li className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="text-ink-900">{t('Numéros sur le Crédit WhatsApp', 'Numbers on WhatsApp credit')}</span>
              <span className="tabular-nums text-ink-900" data-testid="credit-wa-option-couverts">{fmtNum(enService, locale)}</span>
            </li>
            <li className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="text-ink-900">{t('Prix', 'Price')}</span>
              <span className="tabular-nums text-ink-900">{t(`${prixMois(option.places)} € HT par mois`, `€${prixMois(option.places)} excl. VAT per month`)}</span>
            </li>
          </ul>
          {enTrop > 0 && (
            <p className="mt-2 text-sm text-danger" data-testid="credit-wa-option-manque">
              {t(
                `${enTrop} numéro${s(enTrop)} de votre compte WhatsApp n’envoie${enTrop > 1 ? 'nt' : ''} pas : chaque numéro demande sa place. Ajoutez un numéro à l’option.`,
                `${enTrop} number${s(enTrop)} of your WhatsApp account ${enTrop > 1 ? 'do' : 'does'} not send: each number needs its own place. Add a number to the option.`,
              )}
            </p>
          )}
          {libres > 0 && option.statut === 'actif' && (
            <p className="mt-2 text-sm text-ink-500" data-testid="credit-wa-option-libre">
              {t(
                `${libres} numéro${s(libres)} payé${s(libres)} pas encore sur le Crédit WhatsApp : contactez-nous depuis le Support pour y mettre votre numéro.`,
                `${libres} paid number${s(libres)} not yet on WhatsApp credit: contact us from Support to put your number on it.`,
              )}
            </p>
          )}
          {option.statut === 'en_retard' && (
            <p className="mt-2 text-sm text-danger" data-testid="credit-wa-option-retard">
              {t(
                'Le dernier paiement de votre option n’a pas abouti : Stripe le retente. Mettez à jour votre carte avec « Gérer l’option ».',
                'The last payment of your option did not go through: Stripe is retrying it. Update your card with “Manage the option”.',
              )}
            </p>
          )}
          {option.finPrevueLe !== null && (
            <p className="mt-2 text-sm text-alerte" data-testid="credit-wa-option-fin">
              {t(
                `Votre option s’arrête le ${formatDate(option.finPrevueLe, locale, { day: '2-digit', month: '2-digit', year: 'numeric' })} : ses numéros n’enverront plus par le Crédit WhatsApp.`,
                `Your option ends on ${formatDate(option.finPrevueLe, locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}: its numbers will no longer send through WhatsApp credit.`,
              )}
            </p>
          )}

          {modifiable && confirmer === null && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Bouton variante="secondaire" taille="petite" data-testid="credit-wa-option-ajouter"
                disabled={geste !== null || option.places >= option.placesMax} onClick={() => setConfirmer('ajouter')}>
                {t('Ajouter un numéro', 'Add a number')}
              </Bouton>
              <Bouton variante="secondaire" taille="petite" data-testid="credit-wa-option-retirer"
                disabled={geste !== null || !retraitPossible} onClick={() => setConfirmer('retirer')}>
                {t('Retirer un numéro', 'Remove a number')}
              </Bouton>
            </div>
          )}
          {modifiable && confirmer !== null && (
            <div className="mt-3 space-y-3 rounded-controle border border-brand-200 bg-white px-4 py-3 text-sm text-ink-700" data-testid="credit-wa-option-confirmer">
              <p>
                {confirmer === 'ajouter'
                  ? t(
                    `Un numéro de plus coûte ${prixMois(1)} € HT par mois : le prorata jusqu’à la fin de votre période est facturé maintenant, sur la carte de l’option. Il ne compte qu’une fois ce paiement passé.`,
                    `One more number costs €${prixMois(1)} excl. VAT per month: the prorated amount until the end of your period is charged now, on the option’s card. It counts only once that payment has gone through.`,
                  )
                  : t(
                    'Le numéro retiré ne compte plus dès maintenant, sans remboursement du mois entamé : vous payez un numéro de moins à partir du mois suivant.',
                    'The removed number stops counting right away, with no refund of the month begun: you pay for one number less from the following month.',
                  )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Bouton type="button" data-testid="credit-wa-option-valider" enCours={geste === confirmer} disabled={geste !== null}
                  onClick={() => { void changer(confirmer); }}>
                  {confirmer === 'ajouter' ? t('Ajouter', 'Add') : t('Retirer', 'Remove')}
                </Bouton>
                <Bouton type="button" variante="secondaire" disabled={geste !== null} onClick={() => setConfirmer(null)}>{t('Annuler', 'Cancel')}</Bouton>
              </div>
            </div>
          )}
          {admin && (
            <div className="mt-3">
              <Bouton variante="secondaire" taille="petite" data-testid="credit-wa-option-portail" disabled={geste !== null}
                enCours={geste === 'portail'} onClick={() => { void gerer(); }}>
                {t('Gérer l’option : carte, factures, résiliation', 'Manage the option: card, invoices, cancellation')}
              </Bouton>
            </div>
          )}
        </>
      )}
      {erreur && <p className="mt-2 text-sm text-danger" data-testid="credit-wa-option-erreur">{erreur}</p>}
      {facture && (
        <a data-testid="credit-wa-option-facture" href={facture} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-medium text-brand-600 hover:underline">
          {t('Régler la facture du numéro en plus', 'Pay the invoice for the extra number')}
        </a>
      )}
    </section>
  );
}

/** Un solde en euros, au centime : c'est un total, pas un tarif. */
function euros(microEur: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency: 'EUR' }).format(eurosDepuisMicro(microEur));
}

/** « 29/10 », depuis `AAAA-MM-JJ` : le jour d'une ligne qui agrège une journée. */
function jourCourt(jour: string): string {
  const [, mois, j] = jour.split('-');
  return `${j}/${mois}`;
}

function libelleCategorie(categorie: string, t: (fr: string, en?: string) => string): string {
  switch (categorie) {
    case 'marketing': return t('Marketing', 'Marketing');
    case 'utility': return t('Utilitaire', 'Utility');
    case 'authentication': return t('Authentification', 'Authentication');
    case 'service': return t('Réponse dans les 24 h qui suivent un message du client', 'Reply within 24 hours of a customer message');
    default: return categorie;
  }
}

/** La raison EN CLAIR ; une raison inconnue (une version plus récente du serveur) s'affiche telle quelle. */
function libelle(m: LigneCreditWhatsapp, t: (fr: string, en?: string) => string, locale: Locale): string {
  switch (m.raison) {
    case 'envois': {
      const n = m.messages ?? 0;
      const s = n > 1 ? 's' : '';
      return m.jour
        ? t(`Envois du ${jourCourt(m.jour)} (${fmtNum(n, locale)} message${s})`, `Messages on ${jourCourt(m.jour)} (${fmtNum(n, locale)} message${s})`)
        : t('Envois', 'Messages');
    }
    case 'achat': return t('Achat de crédit', 'Credit purchase');
    case 'recharge_auto': return t('Recharge automatique', 'Automatic top-up');
    case 'regularisation': return m.jour ? t(`Régularisation du ${jourCourt(m.jour)}`, `Adjustment for ${jourCourt(m.jour)}`) : t('Régularisation', 'Adjustment');
    default: return m.raison;
  }
}
