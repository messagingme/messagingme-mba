import { randomUUID } from 'node:crypto';
import {
  arreterAbonnementNumeroSeul, changerLigneAbonnement, creerSessionAbonnement, expirerSessionsOuvertes, lireAbonnementStripe,
  lirePrixStripe, StripeError, type TransportStripe,
} from './client';
import { clientDeLEspace, page, refusDeStripe, type DepsPortail } from './abonnement';
import type { StripeConfigure } from './paiement';
import { lienTableauStripe } from './liens';
import { changerPacksContacts, PACKS_CONTACTS_INDISPONIBLES, type DemandePacks, type DepsPacksContacts } from './packs-contacts';
import type { CasFinDeDroit } from './option-credit-whatsapp';
import { CONTACTS_PAR_PACK, PRIX_PACK_CONTACTS_HT_CENTIMES } from '../offres/offres';
import type { PgPacksBusinessStore } from '../offres/packs-business.pg';
import { journaliser } from '../lib/journal';
import { refus, type Issue } from '../lib/issue';
import type { VerrousCourts } from '../db/verrous-courts';

/**
 * LES PACKS DE CONTACTS DU BUSINESS (lot B du plan `2026-11-26-contacts-packs-business-et-alertes-entreprise.md`, décisions
 * de Julien du 2026-11-26). Le Business compte les contacts posés dans `/ops` (ou les 5 000 de la grille) ; un pack en
 * ajoute 1 000, 20 € HT par mois seulement (le prix mensuel du pack du Pro, `STRIPE_PRIX_PACK_CONTACTS_MOIS`). Le Business
 * est facturé hors Stripe et n'y a pas d'abonnement : ses packs prennent un ABONNEMENT À PART, dont la quantité est le
 * nombre de packs, sur le modèle de l'option Ligne de crédit (`./option-credit-whatsapp`).
 *
 * 🔴 STRIPE D'ABORD, LA LIMITE ENSUITE. Le premier pack passe par une page de paiement de Stripe (Checkout), et seul le
 * webhook signé l'enregistre. Un ajout suivant facture le prorata sur le coup et ne s'applique que si cette facture est
 * payée ; un retrait se fait sans remboursement ni prorata, et seulement si les contacts comptés tiennent dans ce qui reste :
 * rien n'est jamais effacé. Le retrait du dernier pack résilie l'abonnement. Les packs suivent ce que Stripe REND.
 *
 * 🔴 LA FIN DE DROIT : un abonnement des packs ne vit qu'avec le Business. Retiré dans `/ops`, l'abonnement est résilié chez
 * Stripe sans remboursement (`finDeDroitPacks`) ; payé alors que l'espace n'est plus en Business, il est résilié et
 * l'équipe prévenue.
 */

/** La marque des packs du Business sur la session et l'abonnement : le webhook l'aiguille sur elle. */
export const PRODUIT_PACKS_BUSINESS = 'packs_contacts_business';
/** Les packs d'un abonnement, bornés comme en base (CHECK de la 0329) ; la route n'en accepte pas plus. */
export const PACKS_BUSINESS_MAX = 1000;

export interface DepsPacksBusiness extends DepsPortail {
  /** L'identifiant Stripe du prix MENSUEL du pack (`STRIPE_PRIX_PACK_CONTACTS_MOIS`). Vide = pas en vente. */
  prixPackMois: string;
  packs: Pick<PgPacksBusinessStore, 'vivant' | 'noterPacks' | 'finir'>;
  /** Les contacts que l'espace compte (`PgOffresStore.usage`, sur `ficheActive`) : ceux qu'un retrait doit laisser tenir. */
  contacts(tenantId: string): Promise<number>;
  /** L'offre en cache de l'espace : la limite neuve vaut tout de suite, pour la création qui suit. */
  invalider(tenantId: string): void;
  alerter(texte: string): Promise<void>;
  /** Un premier achat à la fois par espace, le temps de la liste, de l'expiration et de la création de la session. */
  verrous: Pick<VerrousCourts, 'prendre' | 'relacher'>;
  now?: () => Date;
}

/** Ce que la route lit de l'espace pour choisir le chemin : `null` hors Business (l'offre relue SANS cache). */
export interface BusinessDeLEspace {
  /** La limite de contacts de `/ops`, ou les 5 000 de la grille : ce qui reste quand tous les packs sont retirés. */
  contactsInclus: number;
}

/** Les packs du Business se prennent-ils en ligne ? Stripe câblé et le prix mensuel du pack posé. */
export const packsBusinessEnVente = (d: Pick<DepsPacksBusiness, 'stripe' | 'prixPackMois'>): boolean =>
  d.stripe !== null && d.prixPackMois !== '';

/** Le verrou d'un premier achat : quelques appels à Stripe, largement. Relâché dès la session créée ou l'échec rendu. */
const DUREE_VERROU_ACHAT_MS = 60_000;

/** 1 000 contacts écrits à la française, dans les phrases de ce module. */
const nb = (n: number): string => n.toLocaleString('fr-FR');

const PRIX_INCOHERENT = refus(422,
  'Les contacts en plus sont momentanément indisponibles : leur tarif est en cours de correction. Réessayez plus tard, ou contactez-nous.',
  { code: 'prix_incoherent' });
const PACKS_CHANGES = refus(409, 'Le nombre de contacts de votre offre Business a changé entre-temps : rechargez la page, puis recommencez.',
  { code: 'packs_contacts_changes' });

/** 🔴 Le prix relu chez Stripe AVANT d'écrire : 20 € HT par mois, en euros, sinon rien n'est créé, et le journal le dit. */
async function prixJuste(s: StripeConfigure, prixPack: string, tenantId: string): Promise<boolean> {
  const prix = await lirePrixStripe(s.transport, { cle: s.cle, prix: prixPack });
  const mensuel = prix.recurrence?.intervalle === 'month' && prix.recurrence.nombre === 1;
  if (prix.montantCentimes === PRIX_PACK_CONTACTS_HT_CENTIMES.mois && prix.devise === 'eur' && mensuel) return true;
  journaliser('error', 'stripe_prix_pack_business_incoherent', {
    tenantId, prix: prixPack, attenduCentimes: PRIX_PACK_CONTACTS_HT_CENTIMES.mois, luCentimes: prix.montantCentimes,
    devise: prix.devise, recurrence: prix.recurrence,
  });
  return false;
}

/** L'abonnement relu chez Stripe : son statut et ses packs, toutes les lignes au prix du pack. */
async function relire(s: { cle: string; transport: TransportStripe }, abonnementId: string, prixPack: string): Promise<{ statut: string; packs: number }> {
  const a = await lireAbonnementStripe(s.transport, { cle: s.cle, abonnementId });
  return { statut: a.statut, packs: a.lignes.filter((l) => l.prix === prixPack).reduce((n, l) => n + l.quantite, 0) };
}

/**
 * LA ROUTE DES PACKS (`POST /tenants/:tenantId/offre/packs-contacts`) : le Business prend son chemin, toute autre offre
 * celui du Pro (qui refuse hors Pro). Rend les packs que Stripe a appliqués, ou, pour le premier pack d'un Business,
 * l'adresse de la page de paiement de Stripe.
 */
export async function changerPacksContactsDeLOffre(
  d: { pro: DepsPacksContacts; business: DepsPacksBusiness; businessDe(tenantId: string): Promise<BusinessDeLEspace | null> },
  tenantId: string, demande: DemandePacks, payeur: string,
): Promise<Issue<{ packs: number } | { url: string }>> {
  const b = await d.businessDe(tenantId);
  return b === null ? changerPacksContacts(d.pro, tenantId, demande, payeur) : changerPacksBusiness(d.business, tenantId, b, demande, payeur);
}

/**
 * Porte les packs du Business de `depuis` à `cible`, un pack à la fois (contrôlé par la route). `payeur` est l'utilisateur
 * de la session, jamais une valeur du corps. Sans abonnement vivant, le premier pack rend l'adresse du paiement ; avec,
 * la quantité change chez Stripe d'abord, et la base suit ce que Stripe rend, relu.
 */
export async function changerPacksBusiness(
  d: DepsPacksBusiness, tenantId: string, b: BusinessDeLEspace, demande: DemandePacks, payeur: string,
): Promise<Issue<{ packs: number } | { url: string }>> {
  const { depuis, cible } = demande;
  const s = d.stripe;
  if (s === null || d.prixPackMois === '') return PACKS_CONTACTS_INDISPONIBLES;
  if (!(await d.payeurAutorise(payeur))) return PACKS_CONTACTS_INDISPONIBLES;
  const v = await d.packs.vivant(tenantId);
  try {
    if (v === null) {
      // Aucun pack : seul un premier ajout a un sens. Une vue qui croyait des packs (finis depuis) est périmée.
      if (depuis !== 0) return PACKS_CHANGES;
      if (cible === 0) return { ok: true, valeur: { packs: 0 } };
      return await ouvrirPremierPack(d, s, tenantId);
    }
    const a = await lireAbonnementStripe(s.transport, { cle: s.cle, abonnementId: v.abonnementId });
    if (a.statut !== 'active') {
      return refus(409, 'Le paiement de vos contacts en plus est en attente : réglez la facture que Stripe vous a envoyée, ou contactez-nous.',
        { code: 'packs_contacts_en_retard' });
    }
    const lignes = a.lignes.filter((l) => l.prix === d.prixPackMois);
    // Une ligne posée à la main chez Stripe, à un autre prix ou en double : on ne devine pas laquelle changer.
    if (lignes.length !== 1) {
      journaliser('error', 'stripe_packs_business_a_regler', { tenantId, abonnement: v.abonnementId, lignes: a.lignes.map((l) => l.prix) });
      return refus(409, 'Les contacts en plus de votre offre Business demandent un réglage de notre part : contactez-nous.', { code: 'packs_contacts_a_regler' });
    }
    const ligne = lignes[0]!;
    const actuel = ligne.quantite;
    // Déjà fait (un second clic, l'autre onglet) : rien à écrire chez Stripe, la base se recale.
    if (cible === actuel) return noter(d, tenantId, v.abonnementId, actuel, null);
    if (actuel !== depuis) return PACKS_CHANGES;
    // La clé dit l'état de départ (la quantité ET la dernière facture) : un double clic rejoue la même réponse, alors qu'un
    // nouvel achat après un retrait, même vers la même quantité, en a une autre.
    const idempotence = `pack-business-${v.abonnementId}-${actuel}-${cible}-${a.derniereFacture ?? 'aucune'}`;

    if (cible < actuel) {
      const restante = b.contactsInclus + CONTACTS_PAR_PACK * cible;
      const comptes = await d.contacts(tenantId);
      if (comptes > restante) {
        return refus(409, `Votre espace compte ${nb(comptes)} contacts : supprimez-en d’abord ${nb(comptes - restante)}, pour tenir dans ${nb(restante)} contacts.`,
          { code: 'contacts_en_trop' });
      }
      if (cible === 0) {
        // Le dernier pack : l'abonnement à part n'a plus de raison d'être, il est résilié tout de suite, sans remboursement
        // (une ligne ne se supprime pas seule d'un abonnement chez Stripe). Stripe d'abord : un refus ne change rien ici.
        await arreterAbonnementNumeroSeul(s.transport, { cle: s.cle, abonnementId: v.abonnementId, avoir: false });
        const fin = await d.packs.finir(v.abonnementId, 'resiliation', (d.now ?? (() => new Date()))());
        d.invalider(tenantId);
        if (fin?.premiereFin) {
          await d.alerter(`Dernier pack de contacts du Business retiré : espace ${tenantId} (${v.abonnementId}), abonnement résilié chez Stripe, sans remboursement.`);
        }
        return { ok: true, valeur: { packs: 0 } };
      }
      await changerLigneAbonnement(s.transport, {
        cle: s.cle, abonnementId: v.abonnementId, ligne: { id: ligne.id }, quantite: cible, facturerMaintenant: false, idempotence,
      });
      return noter(d, tenantId, v.abonnementId, (await relire(s, v.abonnementId, d.prixPackMois)).packs, `retiré (${actuel} vers ${cible})`);
    }

    if (!(await prixJuste(s, d.prixPackMois, tenantId))) return PRIX_INCOHERENT;
    const r = await changerLigneAbonnement(s.transport, {
      cle: s.cle, abonnementId: v.abonnementId, ligne: { id: ligne.id }, quantite: cible, facturerMaintenant: true, idempotence,
    });
    if (r.enAttente) {
      // Régler cette facture applique l'ajout en attente : « recommencez » ferait ajouter, et payer, un second pack.
      return refus(402, 'Le paiement des contacts en plus n’a pas abouti : réglez la facture sur sa page, et la limite suivra dès qu’elle sera payée. Ne recommencez pas l’ajout : il serait facturé une seconde fois.',
        { code: 'paiement_pack_contacts_incomplet', url: r.urlFacture });
    }
    // Relu, pas lu dans la réponse : un rejeu idempotent rend la réponse d'un appel plus ancien.
    return noter(d, tenantId, v.abonnementId, (await relire(s, v.abonnementId, d.prixPackMois)).packs, `ajouté (${actuel} vers ${cible})`);
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    // La même modification encore en vol chez Stripe (un double clic très rapproché) : à réessayer, pas un refus.
    if (err.code === 'idempotency_key_in_use') {
      return refus(409, 'Un changement des contacts de votre offre Business est déjà en cours : réessayez dans quelques secondes.', { code: 'packs_contacts_en_cours' });
    }
    return refusDeStripe(err, tenantId, 'packs_contacts_business');
  }
}

/**
 * Le premier pack : la session Checkout d'un abonnement mensuel à part, quantité 1, codes promo fermés (un pack offert par
 * un code ne se rattraperait pas). Une prise à la fois par espace, et les sessions encore ouvertes des packs du client
 * expirées d'abord : le dernier clic gagne, un seul paiement possible.
 */
async function ouvrirPremierPack(d: DepsPacksBusiness, s: StripeConfigure, tenantId: string): Promise<Issue<{ url: string }>> {
  if (!(await prixJuste(s, d.prixPackMois, tenantId))) return PRIX_INCOHERENT;
  const prise = await d.verrous.prendre([[`packs-business.prendre:${tenantId}`, DUREE_VERROU_ACHAT_MS]]);
  if (prise === null) {
    return refus(409, 'Un achat de contacts est déjà en cours pour cet espace : rechargez la page dans quelques secondes.', { code: 'packs_contacts_en_cours' });
  }
  try {
    const customerId = await clientDeLEspace(d, s, tenantId);
    await expirerSessionsOuvertes(s.transport, { cle: s.cle, customerId, produit: PRODUIT_PACKS_BUSINESS });
    const session = await creerSessionAbonnement(s.transport, {
      cle: s.cle,
      tenantId,
      prix: d.prixPackMois,
      customerId,
      urlSucces: `${page(d, 'offre')}?packs=recus`,
      urlAbandon: `${page(d, 'offre')}?packs=abandon`,
      idempotence: `packs-business-${tenantId}-${randomUUID()}`,
      produit: PRODUIT_PACKS_BUSINESS,
      quantite: 1,
      codesPromo: false,
    });
    return { ok: true, valeur: { url: session.url } };
  } finally {
    await d.verrous.relacher(prise);
  }
}

/** La base suit ce que Stripe a rendu ; l'offre en cache est invalidée, et l'équipe est prévenue d'un changement. */
async function noter(d: DepsPacksBusiness, tenantId: string, abonnementId: string, packs: number, geste: string | null): Promise<Issue<{ packs: number }>> {
  await d.packs.noterPacks(abonnementId, packs);
  d.invalider(tenantId);
  if (geste !== null) {
    await d.alerter(`Pack de contacts du Business ${geste} : espace ${tenantId} (${abonnementId}), ${packs} pack${packs > 1 ? 's' : ''} payé${packs > 1 ? 's' : ''}.`);
  }
  return { ok: true, valeur: { packs } };
}

/** Le statut de l'abonnement relu chez Stripe ; `null` quand il ne se lit pas : le doute ne compte pas comme résilié. */
async function statutRelu(s: { cle: string; transport: TransportStripe }, abonnementId: string): Promise<string | null> {
  try {
    return (await lireAbonnementStripe(s.transport, { cle: s.cle, abonnementId })).statut;
  } catch (err) {
    if (err instanceof StripeError) return null;
    throw err;
  }
}

/**
 * L'abonnement des packs RELU chez Stripe, pour le webhook : son statut et ses packs. 🔴 La charge d'un événement peut
 * arriver après un plus récent : seul l'abonnement relu dit l'état de maintenant. `null` quand les packs ne sont pas en
 * vente (rien à relire) ou qu'un refus DURABLE de Stripe empêche de le lire (l'équipe est prévenue). Une panne passagère
 * (réseau, 5xx, 429) lève : le webhook échoue, Stripe rejouera.
 */
export async function packsBusinessChezStripe(
  d: Pick<DepsPacksBusiness, 'stripe' | 'prixPackMois' | 'alerter'>, abonnementId: string,
): Promise<{ statut: string; packs: number } | null> {
  const s = d.stripe;
  if (s === null || d.prixPackMois === '') return null;
  try {
    return await relire(s, abonnementId, d.prixPackMois);
  } catch (err) {
    if (!(err instanceof StripeError) || err.status === null || err.status === 429 || err.status >= 500) throw err;
    journaliser('error', 'stripe_packs_business_illisibles', { abonnement: abonnementId, status: err.status, code: err.code, err: err.message });
    await d.alerter(`Packs de contacts du Business ${abonnementId} illisibles chez Stripe (${err.status}) : ses packs ne sont pas relus, à vérifier.`);
    return null;
  }
}

/**
 * Résilie chez Stripe un abonnement des packs que nous finissons sur un impayé abandonné (`unpaid`) : Stripe le garde
 * vivant, et prélèverait encore au règlement d'une facture en retard. Sans remboursement. Rend `true` quand il est résilié,
 * RELU au besoin ; `false` sinon, l'équipe prévenue. Ne lève jamais sur une erreur de Stripe : la fin s'écrit quand même.
 */
export async function resilierPacksChezStripe(d: Pick<DepsPacksBusiness, 'stripe' | 'alerter'>, abonnementId: string): Promise<boolean> {
  const s = d.stripe;
  if (s === null) {
    await d.alerter(`Packs de contacts du Business ${abonnementId} impayés : Stripe n'est pas configuré dans cette copie, l'abonnement est à résilier à la main, sans remboursement.`);
    return false;
  }
  try {
    await arreterAbonnementNumeroSeul(s.transport, { cle: s.cle, abonnementId, avoir: false });
    return true;
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    const relu = await statutRelu(s, abonnementId);
    if (relu === 'canceled') return true;
    journaliser('error', 'packs_business_resiliation_impaye_impossible', { abonnement: abonnementId, status: err.status, code: err.code, relu, err: err.message });
    await d.alerter(`Packs de contacts du Business ${abonnementId} impayés : Stripe n'a pas résilié l'abonnement (${err.status ?? 'réseau'}${err.code ? `, ${err.code}` : ''} ; relu : ${relu ?? 'illisible'}). À résilier à la main, sans remboursement. ${lienTableauStripe('subscriptions', abonnementId, s.livemode)}`);
    return false;
  }
}

/** Ce que la fin de droit lit et écrit. */
export interface DepsFinDeDroitPacks {
  stripe: { cle: string; livemode: boolean; transport: TransportStripe } | null;
  packs: Pick<PgPacksBusinessStore, 'vivant' | 'finir'>;
  /** L'espace est-il en Business, l'offre relue SANS cache ? Seul le Business donne droit à ses packs. */
  enBusiness(tenantId: string): Promise<boolean>;
  invalider(tenantId: string): void;
  alerter(texte: string): Promise<void>;
  now?: () => Date;
}

export type IssueFinDeDroitPacks = 'sans_packs' | 'garde_son_droit' | 'resilie' | 'a_verifier';

/**
 * 🔴 LA FIN DE DROIT DES PACKS : quand l'espace n'est plus en Business (retiré dans `/ops`, l'Entreprise posée à sa place),
 * son abonnement des packs est résilié tout de suite chez Stripe, sans remboursement du mois entamé, et noté fini : sinon le
 * client paierait des packs que rien ne compte plus. `cas` : `fin_de_droit` (le retrait du Business, sans remboursement) ou
 * `payee_sans_droit` (un premier pack payé alors que l'espace n'est plus en Business : son remboursement est à décider).
 * Rien de Stripe ne lève : une résiliation que Stripe ne confirme pas, relue, se dit à l'équipe, qui la fait à la main ;
 * l'abonnement est noté fini quand même, et un paiement suivant le redira (le webhook). Rejouable.
 */
export async function finDeDroitPacks(d: DepsFinDeDroitPacks, tenantId: string, cas: CasFinDeDroit): Promise<IssueFinDeDroitPacks> {
  try {
    return await finDeDroitPacksSansFilet(d, tenantId, cas);
  } catch (err) {
    // 🔴 Une panne hors Stripe (la base) ne laisse aucune trace ailleurs : ni le retrait du Business, déjà écrit, ni un
    // renouvellement ne la rejouent, et le client serait prélevé chaque mois pour des packs que plus rien ne compte
    // (relecture du lot B, jaune 1). Julien est prévenu, puis l'erreur remonte au geste, qui la journalise.
    await d.alerter(`Fin de droit des packs de contacts de l'espace ${tenantId} en échec (${err instanceof Error ? err.message : String(err)}) : `
      + 'vérifier chez Stripe que son abonnement des packs est résilié, sinon le résilier à la main.').catch(() => {});
    throw err;
  }
}

async function finDeDroitPacksSansFilet(d: DepsFinDeDroitPacks, tenantId: string, cas: CasFinDeDroit): Promise<IssueFinDeDroitPacks> {
  const v = await d.packs.vivant(tenantId);
  if (v === null) return 'sans_packs';
  if (await d.enBusiness(tenantId)) return 'garde_son_droit';
  const lien = lienTableauStripe('subscriptions', v.abonnementId, v.livemode);
  const remboursement = cas === 'payee_sans_droit' ? 'payés sans Business : remboursement à décider' : 'sans remboursement';
  let issue: IssueFinDeDroitPacks = 'resilie';
  if (d.stripe === null || d.stripe.livemode !== v.livemode) {
    issue = 'a_verifier';
    await d.alerter(`Fin de droit des packs de contacts de l'espace ${tenantId}, qui n'est plus en Business : l'abonnement ${v.abonnementId} court encore, à résilier à la main (${remboursement}). ${lien}`);
  } else {
    try {
      await arreterAbonnementNumeroSeul(d.stripe.transport, { cle: d.stripe.cle, abonnementId: v.abonnementId, avoir: false });
    } catch (err) {
      if (!(err instanceof StripeError)) throw err;
      // 🔴 Une résiliation ne se compte que RELUE : une réponse perdue, un 500 rendu après la résiliation, un arrêt déjà fait.
      const relu = await statutRelu(d.stripe, v.abonnementId);
      if (relu !== 'canceled') {
        issue = 'a_verifier';
        journaliser('error', 'packs_business_resiliation_impossible', { tenantId, abonnement: v.abonnementId, status: err.status, code: err.code, relu, err: err.message });
        await d.alerter(`Fin de droit des packs de contacts de l'espace ${tenantId} : Stripe n'a pas résilié ${v.abonnementId} (${err.status ?? 'réseau'}${err.code ? `, ${err.code}` : ''} ; relu : ${relu ?? 'illisible'}). À résilier à la main (${remboursement}). ${lien}`);
      }
    }
  }
  // Avant d'écrire la fin : l'avis `deleted` que notre résiliation déclenche peut l'écrire avant nous, et la consigne se
  // perdrait si elle attendait la première fin.
  if (issue === 'resilie') {
    await d.alerter(`Packs de contacts du Business résiliés chez Stripe, l'espace ${tenantId} n'étant plus en Business : ${v.abonnementId}, ${v.packs} pack${v.packs > 1 ? 's' : ''} (${remboursement}). ${lien}`);
  }
  await d.packs.finir(v.abonnementId, 'fin_de_droit', (d.now ?? (() => new Date()))());
  d.invalider(tenantId);
  return issue;
}
