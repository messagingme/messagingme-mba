import { randomUUID } from 'node:crypto';
import { arreterAbonnementNumeroSeul, changerLigneAbonnement, creerSessionAbonnement, expirerSessionsOuvertes, lireAbonnementStripe, lirePrixStripe, StripeError, type TransportStripe } from './client';
import { clientDeLEspace, page, refusDeStripe, type DepsPortail } from './abonnement';
import type { StripeConfigure } from './paiement';
import { lienTableauStripe } from './liens';
import type { Offre } from '../offres/offres';
import type { PgOptionsCreditStore } from '../credit-whatsapp/options.pg';
import { journaliser } from '../lib/journal';
import { refus, type Issue } from '../lib/issue';
import type { VerrousCourts } from '../db/verrous-courts';

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
  /**
   * Ce que l'onglet dit de la formule, en UNE lecture (`formuleEtPrise`, relecture de V1, jaune 5) : payée
   * (`option.formulePayee`) et la prise possible (`option.prisePossible`), tirées du même instantané par les deux règles.
   */
  formuleEtPrise(tenantId: string): Promise<{ formulePayee: boolean; prisePossible: boolean }>;
  /**
   * L'option se prend-elle maintenant (`optionPrenable`, décisions de Julien du 2026-11-10, V1) ? Un Pro dès le début de
   * son essai, sa fin programmée ou non ; un Business confirmé ; jamais un Pro en retard. La prise, l'état des cartes,
   * l'onglet (`option.prisePossible`) et la reprise la lisent : une seule règle.
   */
  optionPrenable(tenantId: string): Promise<boolean>;
  /**
   * La formule Pro est-elle en retard de paiement (`formuleEnRetard`) ? Lue seulement quand l'option ne se prend pas, pour
   * que le refus dise la vraie raison (relecture du lot C5, jaune 7).
   */
  formuleEnRetard(tenantId: string): Promise<boolean>;
  /**
   * Le numéro de l'espace est-il connecté avec sa carte chez Meta (`numeroAvecCarte`, décision de Julien du 2026-11-13) ?
   * Meta refuse qu'il passe sur la ligne : l'option ne s'y vend plus, l'onglet et les cartes le disent.
   */
  numeroAvecCarte(tenantId: string): Promise<boolean>;
  /** Les numéros que les lignes `'option'` couvrent déjà : un retrait de places ne passe pas sous leur nombre. */
  numerosCouverts(tenantId: string): Promise<number>;
  /** `PgNumeroDelieStore.leverPausesLigneCredit` : une place en plus fait repartir les campagnes en pause faute de place. */
  reprendreCampagnes(tenantId: string): Promise<number>;
  alerter(texte: string): Promise<void>;
  /** Une prise à la fois par espace (jaune 7 de la relecture du lot C), le temps de la liste, de l'expiration et de la création. */
  verrous: Pick<VerrousCourts, 'prendre' | 'relacher'>;
}

/** Le verrou d'une prise : quelques appels à Stripe, largement. Relâché dès la session créée ou l'échec rendu. */
const DUREE_VERROU_PRISE_MS = 60_000;

/**
 * L'option se prend en ligne : son prix posé chez Stripe. La carte « Qui règle Meta ? » (`/credit-whatsapp/etat`) et
 * l'e-mail de la conversion (lot C) lisent cette règle-ci : jamais « prenez l'option » pour une option qui ne se prend pas.
 */
export const optionEnVente = (d: Pick<DepsOptionCredit, 'stripe' | 'prixOption'>): boolean => d.stripe !== null && d.prixOption !== '';

export const OPTION_INDISPONIBLE = refus(503, 'L’option Ligne de crédit n’est pas encore en vente : contactez-nous.', { code: 'option_indisponible' });

/**
 * Un Business en essai attend la confirmation de Julien (AskUserQuestion du 2026-11-10) : le seul refus « d'essai » qui
 * reste, un Pro prenant l'option dès le début de son essai (V1 du plan du 2026-11-10). Le code ne change pas, la console
 * le lit.
 */
export const OPTION_APRES_ESSAI = refus(409, 'L’option Ligne de crédit s’ouvre quand votre formule Business est confirmée.', { code: 'option_apres_essai' });

/**
 * Une formule Pro en retard de paiement n'est pas « payée » non plus, mais ce n'est pas un essai : le refus dit la vraie
 * raison (relecture du lot C5, jaune 7 ; décision de Julien du 2026-11-09). La prise est la seule porte de l'option :
 * l'onglet et les cartes le lisent tous deux ici.
 */
export const OPTION_FORMULE_EN_RETARD = refus(409, 'Le paiement de votre formule Pro est en retard : réglez-le, puis prenez l’option.', { code: 'formule_en_retard' });

/**
 * Un numéro connecté avec sa carte chez Meta ne passe jamais sur la ligne (Meta refuse sa reconnexion, #2494156) : l'option
 * ne s'y vend plus (décision de Julien du 2026-11-13). Le texte est celui que Julien a validé (version A), le même que la
 * console montre à la place de l'achat.
 */
export const OPTION_NUMERO_AVEC_CARTE = refus(409,
  'Votre numéro est connecté avec votre carte chez Meta : la ligne de crédit ne peut pas le prendre en charge. Pour changer, écrivez au Support.',
  { code: 'numero_avec_carte' });

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
  'L’option Ligne de crédit est momentanément indisponible : son tarif est en cours de correction. Réessayez plus tard, ou contactez-nous.',
  { code: 'prix_incoherent' });

/**
 * Ouvre la session Checkout de l'option pour `places` numéros. `payeur` est l'utilisateur de la session, jamais une valeur
 * du corps. Une option déjà vivante se change (`changerPlaces`), elle ne se reprend pas. `origine` : d'où part le paiement,
 * pour y revenir ; depuis les cartes « Qui règle Meta ? » (lot B), Connecter WhatsApp, où le numéro se branche ensuite.
 */
export async function ouvrirOption(
  d: DepsOptionCredit, tenantId: string, places: number, payeur: string, origine: 'offre' | 'connecter' = 'offre',
): Promise<Issue<{ url: string }>> {
  const s = d.stripe;
  if (s === null || d.prixOption === '') return OPTION_INDISPONIBLE;
  if (!(await d.payeurAutorise(payeur))) return OPTION_INDISPONIBLE;
  if (!placesValides(places)) return PLACES_INVALIDES;
  const offre = await d.offre(tenantId);
  if (offre === 'entreprise') {
    return refus(409, 'Votre offre Entreprise comprend déjà la ligne de crédit, sans option à prendre.', { code: 'option_inutile' });
  }
  if (offre !== 'pro' && offre !== 'business') {
    return refus(409, 'L’option Ligne de crédit se prend avec la formule Pro ou Business.', { code: 'option_avec_le_pro' });
  }
  // Le numéro avant la formule, comme la console : sa raison est définitive, celle de la formule passe (relecture du lot).
  if (await d.numeroAvecCarte(tenantId)) return OPTION_NUMERO_AVEC_CARTE;
  if (!(await d.optionPrenable(tenantId))) return (await d.formuleEnRetard(tenantId)) ? OPTION_FORMULE_EN_RETARD : OPTION_APRES_ESSAI;
  if ((await d.options.vivante(tenantId)) !== null) {
    return refus(409, 'Votre espace a déjà l’option Ligne de crédit : changez son nombre de numéros.', { code: 'option_deja_prise' });
  }
  try {
    if (!(await prixJuste(s, d.prixOption, tenantId))) return PRIX_INCOHERENT;
    // 🔴 Une prise à la fois par espace (jaune 7 de la relecture du lot C) : sans verrou, deux clics simultanés listent
    // chacun zéro session ouverte et en créent deux, toutes deux payables (et deux clients Stripe pour un espace neuf).
    const prise = await d.verrous.prendre([[`option.prendre:${tenantId}`, DUREE_VERROU_PRISE_MS]]);
    if (prise === null) {
      return refus(409, 'Une prise de l’option est déjà en cours pour cet espace : rechargez la page dans quelques secondes.', { code: 'option_en_cours' });
    }
    try {
      const retour = origine === 'connecter' ? `${page(d, 'console')}?` : `${page(d, 'offre')}?tab=whatsapp&`;
      const customerId = await clientDeLEspace(d, s, tenantId);
      // 🔴 Un seul paiement de l'option à la fois (jaune 11 de la relecture du lot B) : les sessions encore ouvertes du
      // client sont expirées d'abord, le dernier clic gagne.
      await expirerSessionsOuvertes(s.transport, { cle: s.cle, customerId, produit: PRODUIT_OPTION_WA });
      const session = await creerSessionAbonnement(s.transport, {
        cle: s.cle,
        tenantId,
        prix: d.prixOption,
        customerId,
        urlSucces: `${retour}option=recue`,
        urlAbandon: `${retour}option=abandon`,
        idempotence: `option-wa-${tenantId}-${randomUUID()}`,
        produit: PRODUIT_OPTION_WA,
        quantite: places,
        codesPromo: false,
      });
      return { ok: true, valeur: { url: session.url } };
    } finally {
      await d.verrous.relacher(prise);
    }
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
  if (o === null) return refus(409, 'Votre espace n’a pas l’option Ligne de crédit.', { code: 'sans_option' });
  try {
    const a = await lireAbonnementStripe(s.transport, { cle: s.cle, abonnementId: o.abonnementId });
    if (a.statut !== 'active') {
      return refus(409, 'Le paiement de votre option Ligne de crédit est en attente : réglez-le, puis changez le nombre de numéros.', { code: 'option_en_retard' });
    }
    const lignes = a.lignes.filter((l) => l.prix === d.prixOption);
    // Une ligne posée à la main chez Stripe, à un autre prix ou en double : on ne devine pas laquelle changer.
    if (lignes.length !== 1) {
      journaliser('error', 'stripe_option_wa_a_regler', { tenantId, abonnement: o.abonnementId, lignes: a.lignes.map((l) => l.prix) });
      return refus(409, 'Votre option Ligne de crédit demande un réglage de notre part : contactez-nous.', { code: 'option_a_regler' });
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
    await d.alerter(`Place de l'option Ligne de crédit ${geste} : espace ${tenantId} (${abonnementId}), ${lu.places} numéro${lu.places > 1 ? 's' : ''}.`);
    // Une place en plus libère peut-être un numéro du compte resté dehors : ses campagnes en pause repartent (jaune 6).
    await d.reprendreCampagnes(tenantId);
  }
  return { ok: true, valeur: { places: lu.places } };
}

/**
 * Résilie chez Stripe une option que nous finissons sur un impayé abandonné (`unpaid`, relecture du lot 4a, jaune 3) :
 * Stripe la garde vivante, et prélèverait encore au règlement d'une facture en retard alors que ses lignes sont arrêtées.
 * Sans remboursement. Rend `true` quand elle est résiliée, RELUE au besoin ; `false` sinon, Julien prévenu. Ne lève jamais
 * sur une erreur de Stripe : la fin s'écrit quand même, et ses envois s'arrêtent.
 */
export async function resilierOptionChezStripe(d: Pick<DepsOptionCredit, 'stripe' | 'alerter'>, abonnementId: string): Promise<boolean> {
  const s = d.stripe;
  if (s === null) {
    await d.alerter(`Option Ligne de crédit ${abonnementId} impayée : Stripe n'est pas configuré dans cette copie, elle est à résilier à la main, sans remboursement.`);
    return false;
  }
  try {
    await arreterAbonnementNumeroSeul(s.transport, { cle: s.cle, abonnementId, avoir: false });
    return true;
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    // 🔴 Comme la fin de droit (relecture du lot C5, jaune 3) : une résiliation ne se compte que RELUE. Une panne levait
    // pour que Stripe rejoue, et un vrai 500, que la clé d'idempotence `arret-<abonnement>` garde 24 h, laissait les
    // lignes d'une option impayée actives tout ce temps, sans alerte.
    const relu = await statutRelu(s, abonnementId);
    if (relu === 'canceled') return true;
    journaliser('error', 'option_wa_resiliation_impaye_impossible', { abonnement: abonnementId, status: err.status, code: err.code, relu, err: err.message });
    await d.alerter(`Option Ligne de crédit ${abonnementId} impayée : Stripe n'a pas résilié ${abonnementId} (${err.status ?? 'réseau'}${err.code ? `, ${err.code}` : ''} ; relue : ${relu ?? 'illisible'}). À vérifier chez Stripe, et à résilier à la main, sans remboursement ; ses envois sont arrêtés. ${lienTableauStripe('subscriptions', abonnementId, s.livemode)}`);
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
    await d.alerter(`Option Ligne de crédit ${abonnementId} illisible chez Stripe (${err.status}) : ses places ne sont pas relues, à vérifier.`);
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
  /** Une fin de droit à la fois par espace (relecture du correctif de l'e-mail sans droit, jaune 2). */
  verrous: Pick<VerrousCourts, 'prendre' | 'relacher'>;
  now?: () => Date;
}

/** `en_cours` : une autre fin de droit du même cas, pour l'espace, tient le verrou ; elle fait le travail. */
export type IssueFinDeDroitOption = 'sans_option' | 'garde_son_droit' | 'resiliee' | 'a_verifier' | 'en_cours';

/**
 * Le bail du verrou d'une fin de droit. 🔴 Plus long que le pire cas qu'il protège (relecture du lot C5, jaune 2) : la
 * résiliation et sa relecture, chacune jusqu'à `HTTP_TIMEOUT_DEFAUT_MS` (30 s), puis jusqu'à trois alertes Telegram de 5 s
 * et quelques écritures. Échu avant la fin, un second appel reprenait le verrou et rejouait tout : deux consignes.
 * `tests/stripe-option-credit-whatsapp.test.ts` tient l'ordre des deux constantes.
 */
const DUREE_VERROU_FIN_MS = 180_000;

/** Le statut de l'abonnement relu chez Stripe ; `null` quand il ne se lit pas (une panne, un refus) : le doute ne résilie rien. */
async function statutRelu(s: { cle: string; transport: TransportStripe }, abonnementId: string): Promise<string | null> {
  try {
    return (await lireAbonnementStripe(s.transport, { cle: s.cle, abonnementId })).statut;
  } catch (err) {
    if (err instanceof StripeError) return null;
    throw err;
  }
}

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
 * rejeux compris. Rien de Stripe ne lève : une résiliation que Stripe ne confirme pas arrête quand même les envois, et
 * Julien la résilie à la main. Une seule à la fois par espace ET par cas (`en_cours` pour la seconde).
 */
export async function finDeDroitOption(d: DepsFinDeDroitOption, tenantId: string, cas: CasFinDeDroit): Promise<IssueFinDeDroitOption> {
  if ((await d.options.vivante(tenantId)) === null) return 'sans_option';
  if (await d.aDroit(tenantId)) return 'garde_son_droit';
  // 🔴 Une seule fin de droit à la fois par espace et par CAS (relecture du correctif de l'e-mail sans droit, jaune 2) : la
  // session et la première facture d'une option payée sans droit arrivent ensemble, et chacune envoyait la consigne de
  // remboursement. La seconde laisse faire la première ; l'option se relit sous le verrou, finie entre-temps elle n'a plus
  // rien à faire. Le cas est dans la clé (relecture du lot C5, jaune 1) : une fin du Pro traitée au même instant ne fait
  // pas taire l'option payée sans droit, qui partait alors « sans remboursement », sans e-mail ni consigne. Deux cas
  // différents tournent ensemble ; la relecture absorbe le 409 de leur clé d'idempotence commune.
  const prise = await d.verrous.prendre([[`option.fin:${cas}:${tenantId}`, DUREE_VERROU_FIN_MS]]);
  if (prise === null) return 'en_cours';
  try {
    const o = await d.options.vivante(tenantId);
    if (o === null) return 'sans_option';
    return await finirSansDroit(d, tenantId, cas, o);
  } finally {
    await d.verrous.relacher(prise);
  }
}

/** La fin de droit d'une option vivante, sous le verrou de l'espace : la résiliation chez Stripe, les messages, la fin. */
async function finirSansDroit(
  d: DepsFinDeDroitOption, tenantId: string, cas: CasFinDeDroit, o: { abonnementId: string; livemode: boolean },
): Promise<IssueFinDeDroitOption> {
  const lien = lienTableauStripe('subscriptions', o.abonnementId, o.livemode);
  const payee = cas === 'payee_sans_droit';
  // Une seule consigne de remboursement, la même dans chaque alerte d'un cas (relecture des derniers jaunes d'avant la
  // vente, jaune 1) : jamais « sans remboursement » pour une option payée sans droit. Résiliée à la main, elle n'a pas eu
  // d'e-mail, et aucun ne partira (il la dirait résiliée, et rien ne le rejoue) : Julien prévient ses admins (relecture du
  // correctif de l'e-mail sans droit, jaune 5).
  const remboursement = payee
    ? 'payée sans droit : son remboursement est à décider, et ses admins à prévenir à la main, aucun e-mail ne partira'
    : 'sans remboursement';
  let issue: IssueFinDeDroitOption = 'resiliee';
  if (d.stripe === null || d.stripe.livemode !== o.livemode) {
    issue = 'a_verifier';
    await d.alerter(`Fin de droit de l'option Ligne de crédit de l'espace ${tenantId} : son abonnement ${o.abonnementId} court encore, à résilier à la main (${remboursement}). ${lien}`);
  } else {
    try {
      await arreterAbonnementNumeroSeul(d.stripe.transport, { cle: d.stripe.cle, abonnementId: o.abonnementId, avoir: false });
    } catch (err) {
      if (!(err instanceof StripeError)) throw err;
      // 🔴 Une résiliation ne se compte que RELUE (relecture du correctif de l'e-mail sans droit, jaunes 1 à 3). Une réponse
      // perdue, un 500 rendu après la résiliation, le 409 de la clé d'idempotence, un arrêt déjà fait : l'abonnement relu
      // dit s'il est résilié. Sinon, ou illisible, à vérifier tout de suite : rien ne lève plus, parce qu'un rejeu de Stripe
      // retombait sur un abonnement déjà résilié (la session relue n'y repasse plus, ni e-mail ni consigne) ou sur le même
      // 500, que la clé d'idempotence garde 24 h, sans alerte.
      const relu = await statutRelu(d.stripe, o.abonnementId);
      if (relu !== 'canceled') {
        issue = 'a_verifier';
        journaliser('error', 'option_wa_resiliation_impossible', { tenantId, abonnement: o.abonnementId, status: err.status, code: err.code, relu, err: err.message });
        await d.alerter(`Fin de droit de l'option Ligne de crédit de l'espace ${tenantId} : Stripe n'a pas résilié ${o.abonnementId} (${err.status ?? 'réseau'}${err.code ? `, ${err.code}` : ''} ; relue : ${relu ?? 'illisible'}). À vérifier chez Stripe, et à résilier à la main (${remboursement}) ; ses envois sont arrêtés. ${lien}`);
      }
    }
  }
  // Payée sans droit et résiliée chez Stripe : l'e-mail aux admins (vrai, elle l'est) et la consigne à Julien, AVANT
  // d'écrire la fin. L'avis `deleted` que notre résiliation déclenche peut écrire la fin avant nous (il ne dit que
  // « terminée »), et une panne de la fin fait rejouer un événement que Stripe dit fini, qui ne repasse plus ici : après la
  // fin, l'un et l'autre se perdraient (relecture du correctif, jaune 2). L'e-mail ne part qu'une fois par abonnement.
  if (payee && issue === 'resiliee') {
    await d.prevenirSansDroit(tenantId, o.abonnementId);
    await d.alerter(`Option Ligne de crédit payée sans offre qui y donne droit : espace ${tenantId} (${o.abonnementId}), résiliée chez Stripe, un e-mail part à ses admins. Remboursement à décider au cas par cas. ${lien}`);
  }
  const fin = await d.options.finir(o.abonnementId, 'fin_de_droit', (d.now ?? (() => new Date()))());
  if (fin?.premiereFin) {
    const n = await d.arreterLesLignes(tenantId);
    const lignes = `${n} ligne${n > 1 ? 's' : ''} arrêtée${n > 1 ? 's' : ''}`;
    await d.alerter(payee
      ? `Option Ligne de crédit payée sans droit, finie chez nous : espace ${tenantId} (${o.abonnementId}), ${lignes}.`
      : `Option Ligne de crédit finie, plus aucune offre n'y donne droit : espace ${tenantId} (${o.abonnementId}), ${lignes}.`);
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
