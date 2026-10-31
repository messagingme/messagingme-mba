'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  achatArriveDepuis, estPageDePaiement, lireDepartPaiement, oublierDepartPaiement, ouvrirFacture, retenirDepartPaiement,
  seuilDuRetour,
} from '@/lib/api-credit';
import {
  aUneFactureWhatsapp, getCreditWhatsapp, ouvrirAchatWhatsapp, type LigneCreditWhatsapp, type OffreWhatsapp,
  type VueCreditWhatsapp,
} from '@/lib/api-credit-whatsapp';
import { SEUIL_CREDIT_WHATSAPP_BAS_MICRO_EUR } from '@/lib/partage/credit-whatsapp';
import { eurosDepuisMicro } from '@/lib/agent-solde';
import { erreurDeChargement } from '@/lib/http';
import { fmtCost, fmtNum } from '@/lib/format';
import { formatDate } from '@/lib/day';
import type { Locale } from '@/lib/locale';
import type { Session } from '@/lib/session';
import { useT, useLocale } from '@/lib/i18n';
import { IntroPage } from '@/components/TitrePage';
import { Squelette } from '@/components/Squelette';
import { Bouton } from '@/components/Bouton';
import { MbaNotice } from '@/components/MbaNotice';

/**
 * LE CRÉDIT WHATSAPP DE L'ESPACE (plan du Crédit WhatsApp, tâche 11) : troisième onglet de Paramètres > Offre, ouvert à
 * un espace dont un numéro est sur la ligne de crédit (`ongletCreditWhatsapp` de la vue de l'offre, jamais en Free ni en
 * Entreprise open bar). Le solde, le prix d'un message vers la France, les quatre achats et l'historique.
 *
 * 🔴 TOUT S'ARRÊTE À ZÉRO : un message ne part que si le solde couvre son prix, réponses de l'Inbox et des agents IA
 * comprises. L'écran le dit en clair, sans jamais parler de la ligne ni de qui la porte.
 *
 * 🔴 UN PRIX SE MONTRE TOUT COMPRIS, JAMAIS UN TAUX : le serveur rend le prix d'un message, la console ignore la commission.
 *
 * 🔴 LE RETOUR DE STRIPE NE CRÉDITE RIEN, comme au Crédit IA (`OngletCreditIA`) : il relit jusqu'à voir la ligne `achat`
 * de CE paiement (`achatArriveDepuis`), le temps que le webhook signé de Stripe passe.
 *
 * ⚠️ `useSearchParams` : la page qui monte cet onglet le place sous une frontière Suspense (règle de Next 15).
 */

/** Après un retour de paiement : combien de fois, et tous les combien, on relit en attendant le webhook. */
const RELECTURES_APRES_PAIEMENT = 10;
const INTERVALLE_RELECTURE_MS = 3_000;

export function OngletCreditWhatsapp({ session }: { session: Session }) {
  const t = useT();
  const { locale } = useLocale();
  const retour = useSearchParams().get('paiement');
  const [vue, setVue] = useState<VueCreditWhatsapp | null>(null);
  const [erreurLecture, setErreurLecture] = useState(false);
  const [enCours, setEnCours] = useState<OffreWhatsapp | null>(null);
  const [indisponible, setIndisponible] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Le crédit est-il arrivé depuis le retour de paiement ? Tant que non, l'écran le dit et relit.
  const [arrive, setArrive] = useState(false);
  const [erreurFacture, setErreurFacture] = useState<string | null>(null);

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

  return (
    <div className="max-w-formulaire space-y-4">
      <IntroPage>
        {t(
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
        <div className="text-xs font-medium text-ink-500">{t('Crédit WhatsApp restant', 'WhatsApp credit left')}</div>
        {vue === null && !erreurLecture && <Squelette forme="carte" className="mt-1" />}
        {vue !== null && (
          <>
            <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-ink-900">{euros(vue.soldeMicroEur, locale)}</div>
            {vue.soldeMicroEur <= 0 && !vue.ligneArretee && (
              <p className="mt-2 text-sm text-danger" data-testid="credit-wa-epuise">
                {t(
                  'Épuisé : plus aucun message WhatsApp ne part, réponses de l’Inbox et des agents IA comprises. Une campagne arrêtée faute de crédit reprend seule après la recharge.',
                  'Used up: no WhatsApp message goes out any more, Inbox and AI agent replies included. A campaign stopped for lack of credit resumes on its own after the top-up.',
                )}
              </p>
            )}
            {vue.soldeMicroEur > 0 && vue.soldeMicroEur < SEUIL_CREDIT_WHATSAPP_BAS_MICRO_EUR && !vue.ligneArretee && (
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
            {t('La recharge n’est pas ouverte pour cet espace. Contactez-nous depuis le Support.', 'Top-up is not open for this workspace. Contact us from Support.')}
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
                <span className={`tabular-nums ${m.deltaMicroEur >= 0 ? 'text-ink-900' : 'text-ink-500'}`}>
                  {m.deltaMicroEur >= 0 ? '+' : ''}{fmtCost(m.deltaMicroEur / 1_000_000, locale, 'EUR')}
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
