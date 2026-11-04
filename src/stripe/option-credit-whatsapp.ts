import { randomUUID } from 'node:crypto';
import { arreterAbonnementNumeroSeul, changerLigneAbonnement, creerSessionAbonnement, lireAbonnementStripe, lirePrixStripe, StripeError, type TransportStripe } from './client';
import { clientDeLEspace, page, refusDeStripe, type DepsPortail } from './abonnement';
import type { StripeConfigure } from './paiement';
import { lienTableauStripe } from './liens';
import type { Offre } from '../offres/offres';
import type { PgOptionsCreditStore } from '../credit-whatsapp/options.pg';
import { journaliser } from '../lib/journal';
import { refus, type Issue } from '../lib/issue';

/** Une panne passagère de Stripe (réseau, 5xx, 429) : l'appelant la laisse remonter, pour qu'elle se rejoue. */
const passagere = (err: StripeError): boolean => err.status === null || err.status === 429 || err.status >= 500;

/**
 * L'OPTION CRÉDIT WHATSAPP (lot 4a du plan `2026-11-03-credit-whatsapp-lot-4.md`, spec du 2026-10-30 § « L'option ») : un
 * abonnement Stripe mensuel à part, 30 € HT par numéro, dont la quantité est le nombre de PLACES (une place = un numéro
 * couvert par une ligne `'option'`, décision de Julien du 2026-11-03). Le Pro et le Business y ont droit, jamais la Free ;
 * une Entreprise n'en a pas besoin (illimitée, sans Stripe).
 *
 * Comme les sièges du Pro (`./sieges`) : 🔴 STRIPE D'ABORD, LES PLACES ENSUITE. Sans essai (la ligne nous expose dès la
 * connexion), codes promo fermés (une place offerte ferait envoyer des messages payés au partenaire). Un ajout facture le
 * prorata sur le coup et ne s'applique que si cette facture est payée ; un retrait s'applique tout de suite, sans prorata
 * ni remboursement, et jamais sous le nombre de numéros déjà couverts. Les places suivent ce que Stripe REND.
 */

/** 30 € HT par numéro et par mois (spec du 2026-10-30), taxe en sus. */
export const PRIX_OPTION_WA_HT_CENTIMES = 3000;
/** Les places d'une option, bornées comme en base (CHECK de la 0276) : au-delà, un contact. */
export const PLACES_OPTION_MAX = 20;
/** La marque de l'option sur la session et l'abonnement : le webhook l'aiguille sur elle. */
export const PRODUIT_OPTION_WA = 'option_credit_whatsapp';

export interface DepsOptionCredit extends DepsPortail {
  /** L'identifiant Stripe du prix mensuel de l'option (`STRIPE_PRIX_OPTION_WA`). Vide = pas en vente, rien ne se montre. */
  prixOption: string;
  options: Pick<PgOptionsCreditStore, 'vivante' | 'noterPlaces'>;
  offre(tenantId: string): Promise<Offre>;
  /** Les numéros que les lignes `'option'` couvrent déjà : un retrait de places ne passe pas sous leur nombre. */
  numerosCouverts(tenantId: string): Promise<number>;
  /** `PgNumeroDelieStore.leverPausesLigneCredit` : une place en plus fait repartir les campagnes en pause faute de place. */
  reprendreCampagnes(tenantId: string): Promise<number>;
  alerter(texte: string): Promise<void>;
}

export const OPTION_INDISPONIBLE = refus(503, 'L’option Crédit WhatsApp n’est pas encore en vente : contactez-nous.', { code: 'option_indisponible' });

const placesValides = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= PLACES_OPTION_MAX;
const PLACES_INVALIDES = refus(400, `De 1 à ${PLACES_OPTION_MAX} numéros : au-delà, contactez-nous.`, { code: 'places_invalides' });

/** Le prix relu chez Stripe vaut-il 30 € HT par mois, en euros ? Sinon rien n'est créé, et le journal le dit. */
async function prixJuste(s: StripeConfigure, prixOption: string, tenantId: string): Promise<boolean> {
  const prix = await lirePrixStripe(s.transport, { cle: s.cle, prix: prixOption });
  const mensuel = prix.recurrence?.intervalle === 'month' && prix.recurrence.nombre === 1;
  if (prix.montantCentimes === PRIX_OPTION_WA_HT_CENTIMES && prix.devise === 'eur' && mensuel) return true;
  journaliser('error', 'stripe_prix_option_wa_incoherent', {
    tenantId, prix: prixOption, attenduCentimes: PRIX_OPTION_WA_HT_CENTIMES, luCentimes: prix.montantCentimes, devise: prix.devise,
    recurrence: prix.recurrence,
  });
  return false;
}
const PRIX_INCOHERENT = refus(422,
  'L’option Crédit WhatsApp est momentanément indisponible : son tarif est en cours de correction. Réessayez plus tard, ou contactez-nous.',
  { code: 'prix_incoherent' });

/**
 * Ouvre la session Checkout de l'option pour `places` numéros. `payeur` est l'utilisateur de la session, jamais une valeur
 * du corps. Une option déjà vivante se change (`changerPlaces`), elle ne se reprend pas.
 */
export async function ouvrirOption(d: DepsOptionCredit, tenantId: string, places: number, payeur: string): Promise<Issue<{ url: string }>> {
  const s = d.stripe;
  if (s === null || d.prixOption === '') return OPTION_INDISPONIBLE;
  if (!(await d.payeurAutorise(payeur))) return OPTION_INDISPONIBLE;
  if (!placesValides(places)) return PLACES_INVALIDES;
  const offre = await d.offre(tenantId);
  if (offre === 'entreprise') {
    return refus(409, 'Votre offre Entreprise comprend déjà le Crédit WhatsApp, sans option à prendre.', { code: 'option_inutile' });
  }
  if (offre !== 'pro' && offre !== 'business') {
    return refus(409, 'L’option Crédit WhatsApp se prend avec la formule Pro ou Business.', { code: 'option_avec_le_pro' });
  }
  if ((await d.options.vivante(tenantId)) !== null) {
    return refus(409, 'Votre espace a déjà l’option Crédit WhatsApp : changez son nombre de numéros.', { code: 'option_deja_prise' });
  }
  try {
    if (!(await prixJuste(s, d.prixOption, tenantId))) return PRIX_INCOHERENT;
    const retour = `${page(d, 'offre')}?tab=whatsapp`;
    const session = await creerSessionAbonnement(s.transport, {
      cle: s.cle,
      tenantId,
      prix: d.prixOption,
      customerId: await clientDeLEspace(d, s, tenantId),
      urlSucces: `${retour}&option=recue`,
      urlAbandon: `${retour}&option=abandon`,
      idempotence: `option-wa-${tenantId}-${randomUUID()}`,
      produit: PRODUIT_OPTION_WA,
      quantite: places,
      codesPromo: false,
    });
    return { ok: true, valeur: { url: session.url } };
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    return refusDeStripe(err, tenantId, 'option_credit_whatsapp');
  }
}

/** Les places de l'abonnement, relues chez Stripe : toutes les lignes au prix de l'option. */
async function relire(s: StripeConfigure | { cle: string; transport: TransportStripe }, abonnementId: string, prixOption: string): Promise<{
  statut: string; places: number; finPrevueLe: Date | null;
}> {
  const a = await lireAbonnementStripe(s.transport, { cle: s.cle, abonnementId });
  const places = a.lignes.filter((l) => l.prix === prixOption).reduce((n, l) => n + l.quantite, 0);
  return { statut: a.statut, places, finPrevueLe: a.finPrevueLe };
}

/**
 * Le changement demandé : d'où l'écran part (`depuis`, les places qu'il a lues) et où il va (`cible`). L'état de départ
 * fait refuser une vue périmée : une cible absolue lue dans un cache changerait un ajout en retrait (comme les sièges).
 */
export interface DemandePlaces {
  depuis: number;
  cible: number;
}

/** Porte les places de l'option de l'espace de `depuis` à `cible`. Rend les places que Stripe a appliquées, relues. */
export async function changerPlaces(d: DepsOptionCredit, tenantId: string, demande: DemandePlaces, payeur: string): Promise<Issue<{ places: number }>> {
  const { depuis, cible } = demande;
  const s = d.stripe;
  if (s === null || d.prixOption === '') return OPTION_INDISPONIBLE;
  if (!(await d.payeurAutorise(payeur))) return OPTION_INDISPONIBLE;
  if (!placesValides(cible)) return PLACES_INVALIDES;
  const o = await d.options.vivante(tenantId);
  if (o === null) return refus(409, 'Votre espace n’a pas l’option Crédit WhatsApp.', { code: 'sans_option' });
  try {
    const a = await lireAbonnementStripe(s.transport, { cle: s.cle, abonnementId: o.abonnementId });
    if (a.statut !== 'active') {
      return refus(409, 'Le paiement de votre option Crédit WhatsApp est en attente : réglez-le, puis changez le nombre de numéros.', { code: 'option_en_retard' });
    }
    const lignes = a.lignes.filter((l) => l.prix === d.prixOption);
    // Une ligne posée à la main chez Stripe, à un autre prix ou en double : on ne devine pas laquelle changer.
    if (lignes.length !== 1) {
      journaliser('error', 'stripe_option_wa_a_regler', { tenantId, abonnement: o.abonnementId, lignes: a.lignes.map((l) => l.prix) });
      return refus(409, 'Votre option Crédit WhatsApp demande un réglage de notre part : contactez-nous.', { code: 'option_a_regler' });
    }
    const ligne = lignes[0]!;
    const actuel = ligne.quantite;
    // Déjà fait (un second clic, l'autre onglet) : rien à écrire, la base se recale.
    if (cible === actuel) return noter(d, tenantId, o.abonnementId, await relire(s, o.abonnementId, d.prixOption), null);
    if (actuel !== depuis) {
      return refus(409, 'Le nombre de numéros de votre option a changé entre-temps : rechargez la page, puis recommencez.', { code: 'places_changees' });
    }
    // La clé dit l'état de départ (la quantité ET la dernière facture) : un double clic rejoue la même réponse.
    const idempotence = `option-wa-${o.abonnementId}-${actuel}-${cible}-${a.derniereFacture ?? 'aucune'}`;
    if (cible < actuel) {
      const couverts = await d.numerosCouverts(tenantId);
      if (couverts > cible) {
        return refus(409, `${couverts} numéros sont sur la ligne : retirez-en d’abord, pour tenir dans ${cible}.`, { code: 'numeros_en_trop' });
      }
      await changerLigneAbonnement(s.transport, {
        cle: s.cle, abonnementId: o.abonnementId, ligne: { id: ligne.id }, quantite: cible, facturerMaintenant: false, idempotence,
      });
      return noter(d, tenantId, o.abonnementId, await relire(s, o.abonnementId, d.prixOption), `retirée (${actuel} vers ${cible})`);
    }
    if (!(await prixJuste(s, d.prixOption, tenantId))) return PRIX_INCOHERENT;
    const r = await changerLigneAbonnement(s.transport, {
      cle: s.cle, abonnementId: o.abonnementId, ligne: { id: ligne.id }, quantite: cible, facturerMaintenant: true, idempotence,
    });
    if (r.enAttente) {
      // Régler cette facture applique l'ajout en attente : « recommencez » faisait ajouter, et payer, une seconde place
      // (relecture du lot 4a-2, jaune 1).
      return refus(402, 'Le paiement du numéro en plus n’a pas abouti : réglez la facture sur sa page, et le numéro s’ajoutera dès qu’elle sera payée. Ne recommencez pas l’ajout : il serait facturé une seconde fois.',
        { code: 'paiement_place_incomplet', url: r.urlFacture });
    }
    // Relu, pas lu dans la réponse : un rejeu idempotent rend la réponse d'un appel plus ancien.
    return noter(d, tenantId, o.abonnementId, await relire(s, o.abonnementId, d.prixOption), `ajoutée (${actuel} vers ${cible})`);
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    if (err.code === 'idempotency_key_in_use') {
      return refus(409, 'Un changement de votre option est déjà en cours : réessayez dans quelques secondes.', { code: 'places_en_cours' });
    }
    return refusDeStripe(err, tenantId, 'places_option_credit_whatsapp');
  }
}

/** La base suit ce que Stripe a rendu, et Julien est prévenu d'un changement. */
async function noter(
  d: DepsOptionCredit, tenantId: string, abonnementId: string, lu: { places: number; finPrevueLe: Date | null }, geste: string | null,
): Promise<Issue<{ places: number }>> {
  await d.options.noterPlaces(abonnementId, lu.places, lu.finPrevueLe);
  if (geste !== null) {
    await d.alerter(`Place de l'option Crédit WhatsApp ${geste} : espace ${tenantId} (${abonnementId}), ${lu.places} numéro${lu.places > 1 ? 's' : ''}.`);
    // Une place en plus libère peut-être un numéro du compte resté dehors : ses campagnes en pause repartent (jaune 6).
    await d.reprendreCampagnes(tenantId);
  }
  return { ok: true, valeur: { places: lu.places } };
}

/**
 * Résilie chez Stripe une option que nous finissons sur un impayé abandonné (`unpaid`, relecture du lot 4a, jaune 3) :
 * Stripe la garde vivante, et prélèverait encore au règlement d'une facture en retard alors que ses lignes sont arrêtées.
 * Sans remboursement. `false` quand Stripe refuse durablement (Julien prévenu) ; une panne passagère (réseau, 5xx, 429)
 * lève, pour que le webhook échoue et que Stripe rejoue.
 */
export async function resilierOptionChezStripe(d: Pick<DepsOptionCredit, 'stripe' | 'alerter'>, abonnementId: string): Promise<boolean> {
  const s = d.stripe;
  if (s === null) {
    await d.alerter(`Option Crédit WhatsApp ${abonnementId} impayée : Stripe n'est pas configuré dans cette copie, elle est à résilier à la main, sans remboursement.`);
    return false;
  }
  try {
    await arreterAbonnementNumeroSeul(s.transport, { cle: s.cle, abonnementId, avoir: false });
    return true;
  } catch (err) {
    if (!(err instanceof StripeError) || passagere(err)) throw err;
    journaliser('error', 'option_wa_resiliation_impaye_impossible', { abonnement: abonnementId, status: err.status, code: err.code, err: err.message });
    await d.alerter(`Option Crédit WhatsApp ${abonnementId} impayée : Stripe refuse de la résilier (${err.status}${err.code ? `, ${err.code}` : ''}). À résilier à la main, sans remboursement. ${lienTableauStripe('subscriptions', abonnementId, s.livemode)}`);
    return false;
  }
}

/**
 * L'option RELUE chez Stripe, pour le webhook : son statut, ses places et sa fin programmée. 🔴 La charge d'un événement
 * peut arriver après un plus récent : seul l'abonnement relu dit l'état de maintenant. `null` quand l'option n'est pas en
 * vente (rien à relire) ou qu'un refus DURABLE de Stripe empêche de la lire (Julien est prévenu). Une panne passagère
 * (réseau, 5xx, 429) lève : le webhook échoue, Stripe rejouera.
 */
export async function optionChezStripe(
  d: Pick<DepsOptionCredit, 'stripe' | 'prixOption' | 'alerter'>, abonnementId: string,
): Promise<{ statut: string; places: number; finPrevueLe: Date | null } | null> {
  const s = d.stripe;
  if (s === null || d.prixOption === '') return null;
  try {
    return await relire(s, abonnementId, d.prixOption);
  } catch (err) {
    if (!(err instanceof StripeError) || passagere(err)) throw err;
    journaliser('error', 'stripe_option_wa_illisible', { abonnement: abonnementId, status: err.status, code: err.code, err: err.message });
    await d.alerter(`Option Crédit WhatsApp ${abonnementId} illisible chez Stripe (${err.status}) : ses places ne sont pas relues, à vérifier.`);
    return null;
  }
}

/** Ce que la fin de droit lit et écrit. */
export interface DepsFinDeDroitOption {
  stripe: { cle: string; livemode: boolean; transport: TransportStripe } | null;
  options: Pick<PgOptionsCreditStore, 'vivante' | 'finir'>;
  /** Une offre de l'espace donne-t-elle encore droit à l'option ? Un Pro vivant, un Business ou une Entreprise posés. */
  aDroit(tenantId: string): Promise<boolean>;
  /** `PgLignesCreditStore.arreterLesLignesDeLOption` : rend le nombre de lignes arrêtées. */
  arreterLesLignes(tenantId: string): Promise<number>;
  /**
   * L'e-mail aux admins d'une option payée sans droit (`creerOptionSansDroit`) : une fois par abonnement, sans promesse de
   * remboursement. Ne lève jamais.
   */
  prevenirSansDroit(tenantId: string, abonnementId: string): Promise<void>;
  alerter(texte: string): Promise<void>;
  now?: () => Date;
}

export type IssueFinDeDroitOption = 'sans_option' | 'garde_son_droit' | 'resiliee' | 'a_verifier';

/**
 * Pourquoi la fin de droit tourne. `fin_de_droit` : une offre qui y donnait droit s'est terminée, le mois entamé n'est pas
 * remboursé. `payee_sans_droit` : l'option vient d'être payée alors qu'aucune offre n'y donne droit (un Checkout ouvert
 * pendant l'essai de la formule Pro et réglé après sa fin) ; les admins le savent par e-mail, et le remboursement se décide
 * au cas par cas (décision de Julien du 2026-11-04). Requis à chaque appel : un défaut dirait « sans remboursement » au
 * mauvais cas, en silence.
 */
export type CasFinDeDroit = 'fin_de_droit' | 'payee_sans_droit';

/**
 * LA FIN DE DROIT (spec § « L'option », « Fin ») : quand plus aucune offre de l'espace n'y donne droit (fin du Pro, Business
 * ou Entreprise retirés dans `/ops`), l'option se résilie tout de suite chez Stripe, sans remboursement du mois entamé (on
 * ne facture pas une option inutilisable), et les envois de ses numéros s'arrêtent le jour même ; ses lignes restent en
 * cours (arrêtées), pour qu'un client qui revient reprenne sans reconnexion. Rejouable : appelée à chaque fin d'offre,
 * rejeux compris. Un refus de Stripe ne lève jamais : les envois s'arrêtent quand même et Julien résilie à la main.
 */
export async function finDeDroitOption(d: DepsFinDeDroitOption, tenantId: string, cas: CasFinDeDroit): Promise<IssueFinDeDroitOption> {
  const o = await d.options.vivante(tenantId);
  if (o === null) return 'sans_option';
  if (await d.aDroit(tenantId)) return 'garde_son_droit';
  const lien = lienTableauStripe('subscriptions', o.abonnementId, o.livemode);
  const payee = cas === 'payee_sans_droit';
  // Une seule consigne de remboursement, la même dans chaque alerte d'un cas (relecture des derniers jaunes d'avant la
  // vente, jaune 1) : jamais « sans remboursement » pour une option payée sans droit. Résiliée à la main, elle n'a pas eu
  // d'e-mail (il la dirait résiliée) : Julien prévient ses admins (relecture du correctif, jaune 1).
  const remboursement = payee
    ? 'payée sans droit, son remboursement est à décider, puis prévenir ses admins : aucun e-mail ne part tant qu’elle court'
    : 'sans remboursement';
  let issue: IssueFinDeDroitOption = 'resiliee';
  if (d.stripe === null || d.stripe.livemode !== o.livemode) {
    issue = 'a_verifier';
    await d.alerter(`Fin de droit de l'option Crédit WhatsApp de l'espace ${tenantId} : son abonnement ${o.abonnementId} court encore, à résilier à la main (${remboursement}). ${lien}`);
  } else {
    try {
      await arreterAbonnementNumeroSeul(d.stripe.transport, { cle: d.stripe.cle, abonnementId: o.abonnementId, avoir: false });
    } catch (err) {
      if (!(err instanceof StripeError)) throw err;
      // 🔴 Payée sans droit, une panne passagère (réseau, 5xx, 429) LÈVE : ce cas ne vient que du webhook, Stripe rejoue
      // l'événement et la résiliation se refait, l'e-mail ne partant qu'après elle (relecture du correctif, jaune 1). Une
      // fin de droit ordinaire garde la résiliation à la main : `/ops` l'appelle aussi, et rien ne l'y rejouerait.
      if (payee && passagere(err)) throw err;
      // La même résiliation déjà en cours chez Stripe (deux fins traitées ensemble) : l'autre appel la fait.
      if (err.code !== 'idempotency_key_in_use') {
        issue = 'a_verifier';
        journaliser('error', 'option_wa_resiliation_impossible', { tenantId, abonnement: o.abonnementId, status: err.status, code: err.code, err: err.message });
        await d.alerter(`Fin de droit de l'option Crédit WhatsApp de l'espace ${tenantId} : Stripe refuse de résilier ${o.abonnementId} (${err.status ?? 'réseau'}${err.code ? `, ${err.code}` : ''}). À résilier à la main (${remboursement}) ; ses envois sont arrêtés. ${lien}`);
      }
    }
  }
  // Payée sans droit et résiliée chez Stripe : l'e-mail aux admins (vrai, elle l'est) et la consigne à Julien, AVANT
  // d'écrire la fin. L'avis `deleted` que notre résiliation déclenche peut écrire la fin avant nous (il ne dit que
  // « terminée »), et une panne de la fin fait rejouer un événement que Stripe dit fini, qui ne repasse plus ici : après la
  // fin, l'un et l'autre se perdraient (relecture du correctif, jaune 2). L'e-mail ne part qu'une fois par abonnement.
  if (payee && issue === 'resiliee') {
    await d.prevenirSansDroit(tenantId, o.abonnementId);
    await d.alerter(`Option Crédit WhatsApp payée sans offre qui y donne droit : espace ${tenantId} (${o.abonnementId}), résiliée chez Stripe, un e-mail part à ses admins. Remboursement à décider au cas par cas. ${lien}`);
  }
  const fin = await d.options.finir(o.abonnementId, 'fin_de_droit', (d.now ?? (() => new Date()))());
  if (fin?.premiereFin) {
    const n = await d.arreterLesLignes(tenantId);
    const lignes = `${n} ligne${n > 1 ? 's' : ''} arrêtée${n > 1 ? 's' : ''}`;
    await d.alerter(payee
      ? `Option Crédit WhatsApp payée sans droit, finie chez nous : espace ${tenantId} (${o.abonnementId}), ${lignes}.`
      : `Option Crédit WhatsApp finie, plus aucune offre n'y donne droit : espace ${tenantId} (${o.abonnementId}), ${lignes}.`);
  }
  return issue;
}

/**
 * La fin de droit branchée sur ses dépendances, pour le câblage du webhook : le cas voyage tel quel. 🔴 Une flèche écrite à
 * la main dans le câblage pourrait ne prendre que l'espace et passer un cas constant, ce que le compilateur accepte en
 * silence (une flèche à un paramètre est assignable à un contrat qui en déclare deux).
 */
export function brancherFinDeDroit(d: DepsFinDeDroitOption): (tenantId: string, cas: CasFinDeDroit) => Promise<IssueFinDeDroitOption> {
  return (tenantId, cas) => finDeDroitOption(d, tenantId, cas);
}
