import { arreterAbonnementNumeroSeul, couponSurFacture, creerAbonnementNumeroSeul, poserRemiseUneFois, StripeError, type TransportStripe } from '../stripe/client';
import type { AbonnementNumero, IssueEnregistrement } from '../stripe/abonnements.pg';
import type { RaisonFinOffre } from './abonnements-offre.pg';
import { lienTableauStripe } from '../stripe/liens';
import { journaliser } from '../lib/journal';

/**
 * LE NUMÉRO FOURNI INCLUS DANS LE PRO (lot 6, livraison B2b, tâche 12 du plan
 * `docs/superpowers/plans/2026-10-07-offres-et-limites.md`). Deux moments, appelés par le webhook du Pro
 * (`src/http/credit-stripe.ts`) :
 *  - le PASSAGE EN PRO : l'abonnement du numéro seul s'arrête tout de suite chez Stripe avec un avoir au prorata (le
 *    solde du client, que la facture suivante du Pro consomme) ; les avis de suspension déjà partis sont oubliés (J5 de la
 *    relecture de B1 : sinon la fin d'un Pro suspendrait sans prévenir) et les pauses `numero_suspendu` levées sans
 *    attendre le balayage (J6) ;
 *  - la FIN DU PRO : par résiliation, sans « rendre le numéro », l'abonnement du numéro seul est recréé sur la carte du
 *    Pro (3,50 € HT par mois) ; sinon (impayé, numéro rendu, création impossible), le numéro suit le chemin du lot 4 :
 *    envois coupés, 7 jours, puis libération (décisions de Julien du 2026-10-07 et du 2026-10-08).
 *
 * Pas de planning d'abonnement chez Stripe (ruling de la tâche 9 de B1) : il entrerait en conflit avec la résiliation en
 * fin de période du portail.
 *
 * Les deux sont REJOUABLES : le webhook les rejoue à chaque événement (Stripe rejoue tout événement non acquitté), et
 * chaque écriture chez Stripe porte une clé d'idempotence par abonnement. Un refus de Stripe ne lève jamais (Julien est
 * prévenu) ; une panne de base lève, donc 5xx, et Stripe rejoue.
 */
export interface DepsNumeroInclus {
  /** Stripe sur l'instance : la clé, son mode et le transport ; `null` = pas configuré. */
  stripe: { cle: string; livemode: boolean; transport: TransportStripe } | null;
  /** Le prix du numéro seul (`STRIPE_PRIX_NUMERO`) ; vide = pas en vente. */
  prixNumero: string;
  /**
   * La remise de 3,50 € « une fois », réservée au Pro, que Julien a créée chez Stripe (`STRIPE_COUPON_NUMERO_ESSAI`, lot 2
   * du 2026-11-17) : posée sur le Pro en essai quand son espace paie un numéro, elle le déduit de la première facture.
   * Vide = pas configurée : Julien est prévenu de la poser à la main.
   */
  couponNumeroEssai: string;
  numero: {
    /** L'abonnement du numéro de l'espace : le vivant s'il y en a un (`PgAbonnementsNumeroStore.deLEspace`). */
    deLEspace(tenantId: string): Promise<AbonnementNumero | null>;
    /** L'espace a-t-il un numéro fourni attribué ? */
    numeroAttribue(tenantId: string): Promise<boolean>;
    /** L'espace envoie-t-il par un AUTRE numéro que son numéro fourni, le sien (`PgAbonnementsNumeroStore.numeroApporte`) ? */
    numeroApporte(tenantId: string): Promise<boolean>;
    /** Enregistre l'abonnement recréé, comme le webhook le ferait (`PgAbonnementsNumeroStore.enregistrer`). */
    enregistrer(a: { tenantId: string; abonnementId: string; livemode: boolean; periodeFin: Date | null }): Promise<IssueEnregistrement>;
    /** J5 : les avis de suspension et le rappel de libération de l'espace, effacés. */
    oublierAvisDeSuspension(tenantId: string): Promise<void>;
    /**
     * Un espace qui n'a JAMAIS eu d'abonnement du numéro (numéro attribué pendant le Pro) reçoit une ligne finie à la fin
     * du Pro, au nom du Pro : sans elle, le lot 4 n'aurait rien à suspendre ni à libérer. `false` : l'espace en avait
     * déjà une (la couverture du Pro y reporte déjà la fin).
     */
    porterLaFinParLePro(a: { tenantId: string; abonnementPro: string; livemode: boolean; finiLe: Date }): Promise<boolean>;
    /**
     * La même ligne finie pour la sortie d'une offre posée dans /ops, identifiée `ops_…` (spec Business,
     * `PgAbonnementsNumeroStore.porterLaFinParLOps`). `false` : l'espace a déjà une ligne non libérée.
     */
    porterLaFinParLOps(a: { tenantId: string; livemode: boolean; finiLe: Date }): Promise<boolean>;
    /**
     * L'abonnement du numéro est-il né pendant l'essai d'un Pro de l'espace (`PgAbonnementsNumeroStore.payePendantLEssai`,
     * lot 2) ? La même règle que la pose de la remise : il est alors remboursé par elle, et s'arrête sans avoir.
     */
    payePendantLEssai(tenantId: string, abonnementId: string): Promise<boolean>;
  };
  /** J6 : les campagnes en pause `numero_suspendu` repartent. */
  reprendreCampagnes(tenantId: string): Promise<void>;
  /** L'espace a-t-il un Pro vivant (`PgAbonnementsOffreStore.vivant`) ? */
  proVivant(tenantId: string): Promise<boolean>;
  /** Le Pro vivant de l'espace s'il est en essai (`PgAbonnementsOffreStore.enEssai`, lot 2), `null` sinon. */
  proEnEssai(tenantId: string): Promise<{ abonnementId: string; livemode: boolean } | null>;
  /**
   * L'espace est-il dans une offre posée à la main qui inclut le numéro (le Business, l'Entreprise : spec du 2026-10-27) ?
   * Elle couvre le numéro comme un Pro vivant : la fin d'un Pro n'y recrée rien chez Stripe.
   */
  offreManuelleCouvre(tenantId: string): Promise<boolean>;
  /** Prévient Julien (Telegram). */
  alerter(texte: string): Promise<void>;
}

const vivant = (a: AbonnementNumero | null): a is AbonnementNumero => a !== null && a.statut !== 'resilie';

/**
 * L'OFFRE INCLUT-ELLE LE NUMÉRO FOURNI ? La grille le dit (`limites.numeroInclus` : le Pro, le Business, l'Entreprise),
 * 🔴 SAUF UN PRO EN ESSAI (lot 2 du 2026-11-17, décision de Julien) : pendant les 14 jours, le numéro se paie 3,50 € comme
 * en Free, et ces 3,50 € se déduisent de la première facture du Pro (`surNumeroPayePendantLEssai`). Un numéro donné sans
 * rien payer a été pris, puis perdu, par un essai la nuit du 17. Un Business ou une Entreprise posés dans /ops le couvrent
 * toujours, même avec un Pro en essai à côté. `proEnEssai` n'est lu que pour un Pro.
 */
export async function inclutLeNumero(
  o: { offre: string; droits: { limites: { numeroInclus: boolean } } },
  proEnEssai: () => Promise<boolean>,
): Promise<boolean> {
  if (!o.droits.limites.numeroInclus) return false;
  return o.offre !== 'pro' || !(await proEnEssai());
}

/**
 * J2 de la relecture : la MÊME écriture, sous la même clé d'idempotence, est déjà en cours chez Stripe (deux événements du
 * même abonnement traités ensemble). L'autre appel fait le travail : ce n'est pas un refus.
 */
const dejaEnCours = (err: StripeError): boolean => err.code === 'idempotency_key_in_use';

/**
 * Le passage en Pro de l'espace (un Pro enregistré, rejoué compris). Ne lève que sur une panne de base.
 * 🔴 `arreterLeNumeroSeul` faux pendant l'essai de 14 jours (spec offres v2) : le Pro couvre le numéro (avis et pauses
 * levés), mais l'abonnement payé à part ne s'arrête qu'à la première facture payée non nulle. Un essai abandonné ne l'a
 * donc jamais touché, et la fin du Pro le trouve vivant (`deja_abonne`) : rien n'est recréé en double.
 */
export async function surPassageEnPro(d: DepsNumeroInclus, tenantId: string, o: { arreterLeNumeroSeul: boolean; factureId?: string }): Promise<void> {
  await d.numero.oublierAvisDeSuspension(tenantId);
  await d.reprendreCampagnes(tenantId);
  if (!o.arreterLeNumeroSeul) return;
  const a = await d.numero.deLEspace(tenantId);
  if (!vivant(a)) return;
  const lien = lienTableauStripe('subscriptions', a.abonnementId, a.livemode);
  // 🔴 Lot 2 du 2026-11-17 : un numéro payé PENDANT l'essai est remboursé par la remise de 3,50 € posée sur la première
  // facture du Pro (`surNumeroPayePendantLEssai`) ; l'avoir au prorata le rembourserait une seconde fois. Un numéro payé
  // avant l'essai (un Free devenu Pro) garde son avoir, comme avant. 🔴 Lot 3 (jaune 1 de la relecture du lot 2) : la
  // remise doit figurer sur la FACTURE payée qui fait passer en Pro (`remiseSurLaFacture`) ; refusée, jamais posée ou
  // consommée ailleurs, l'avoir au prorata reste.
  const rembourseParLaRemise = d.couponNumeroEssai !== ''
    && await d.numero.payePendantLEssai(tenantId, a.abonnementId)
    && await remiseSurLaFacture(d, tenantId, o.factureId);
  if (d.stripe === null || d.stripe.livemode !== a.livemode) {
    await d.alerter(`Espace ${tenantId} passé en Pro : son abonnement du numéro seul ${a.abonnementId} court encore, à arrêter à la main ${rembourseParLaRemise ? 'sans avoir (la remise de l’essai l’a remboursé)' : 'avec un avoir au prorata'}. ${lien}`);
    return;
  }
  try {
    // J7 de la relecture : une période impayée n'a rien à rendre, l'avoir créditerait un temps jamais payé.
    await arreterAbonnementNumeroSeul(d.stripe.transport, {
      cle: d.stripe.cle, abonnementId: a.abonnementId, avoir: a.statut !== 'en_retard' && !rembourseParLaRemise,
    });
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    if (dejaEnCours(err)) {
      journaliser('info', 'numero_inclus_arret_en_cours', { tenantId, abonnement: a.abonnementId });
      return;
    }
    journaliser('error', 'numero_inclus_arret_impossible', { tenantId, abonnement: a.abonnementId, status: err.status, code: err.code, err: err.message });
    await d.alerter(`Espace ${tenantId} passé en Pro : Stripe refuse d'arrêter son abonnement du numéro seul ${a.abonnementId} (${err.status ?? 'réseau'}${err.code ? `, ${err.code}` : ''}). À arrêter à la main avec un avoir au prorata. ${lien}`);
  }
}

/**
 * La remise de l'essai figure-t-elle sur la facture payée du passage en Pro (lot 3, jaune 1 de la relecture du lot 2) ?
 * Sans facture, sans Stripe dans ce mode, ou une lecture qui échoue : NON, et l'avoir au prorata reste. Dans le doute, le
 * client garde son remboursement : un remboursement en double coûte au plus 3,50 €, un remboursement perdu est un
 * montant faux à sa charge.
 */
async function remiseSurLaFacture(d: DepsNumeroInclus, tenantId: string, factureId: string | undefined): Promise<boolean> {
  if (factureId === undefined || d.stripe === null) return false;
  try {
    return await couponSurFacture(d.stripe.transport, { cle: d.stripe.cle, facture: factureId, coupon: d.couponNumeroEssai });
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    journaliser('error', 'numero_essai_facture_illisible', { tenantId, facture: factureId, status: err.status, code: err.code, err: err.message });
    return false;
  }
}

/** `hors_essai` : l'espace n'a pas de Pro en essai, rien à déduire. `a_poser_a_la_main` : Julien est prévenu. */
export type IssueNumeroEssai = 'hors_essai' | 'posee' | 'deja' | 'en_cours' | 'a_poser_a_la_main';

/**
 * LE NUMÉRO PAYÉ PENDANT L'ESSAI DU PRO (2026-11-17, lot 2 du plan
 * `docs/superpowers/plans/2026-11-17-numero-fourni-application-et-essai.md`). Pendant l'essai de 14 jours, le numéro
 * fourni n'est plus inclus : il se paie 3,50 € comme en Free, et ces 3,50 € sont déduits de la PREMIÈRE facture du Pro
 * (décision de Julien : « faire payer 3,5 € pour un numéro, et si le client continue, lui facturer 49 − 3,5 »). Appelé à
 * l'enregistrement de l'abonnement du numéro (le webhook, rejoué compris) : si l'espace a un Pro en essai, la remise
 * `STRIPE_COUPON_NUMERO_ESSAI` est posée sur lui, une seule fois (`poserRemiseUneFois`). Un essai abandonné emporte la
 * remise avec son abonnement : le numéro continue alors à 3,50 € par mois, comme un Free. Au passage en Pro payant, ce
 * numéro s'arrête sans avoir (`surPassageEnPro`).
 * Ne lève que sur une panne de base : un refus de Stripe, ou une remise pas configurée, prévient Julien de la poser à la
 * main avant la fin de l'essai.
 */
export async function surNumeroPayePendantLEssai(d: DepsNumeroInclus, tenantId: string, abonnementNumero: string): Promise<IssueNumeroEssai> {
  const pro = await d.proEnEssai(tenantId);
  if (pro === null) return 'hors_essai';
  // 🔴 Lot 3 (jaune 2 de la relecture du lot 2) : la MÊME règle qu'au passage en Pro. Un rejeu tardif de l'événement d'un
  // numéro payé AVANT l'essai, arrivé pendant l'essai, ne pose aucune remise : ce numéro garde son avoir au prorata.
  if (!(await d.numero.payePendantLEssai(tenantId, abonnementNumero))) return 'hors_essai';
  const aLaMain = async (pourquoi: string): Promise<'a_poser_a_la_main'> => {
    await d.alerter(`Numéro payé pendant l'essai du Pro : espace ${tenantId} (${abonnementNumero}). ${pourquoi} Pose à la main une remise de 3,50 € « une fois » sur son Pro avant la fin de l'essai, sinon sa première facture sera entière. ${lienTableauStripe('subscriptions', pro.abonnementId, pro.livemode)}`);
    return 'a_poser_a_la_main';
  };
  if (d.couponNumeroEssai === '') return aLaMain('La remise n’est pas configurée (STRIPE_COUPON_NUMERO_ESSAI).');
  if (d.stripe === null || d.stripe.livemode !== pro.livemode) return aLaMain('Stripe n’est pas configuré dans le mode de ce Pro.');
  try {
    const r = await poserRemiseUneFois(d.stripe.transport, {
      cle: d.stripe.cle, abonnementId: pro.abonnementId, coupon: d.couponNumeroEssai, idempotence: `remise-numero-essai-${abonnementNumero}`,
    });
    journaliser('info', 'numero_essai_remise', { tenantId, pro: pro.abonnementId, numero: abonnementNumero, issue: r });
    return r;
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    if (dejaEnCours(err)) return 'en_cours';
    journaliser('error', 'numero_essai_remise_impossible', { tenantId, pro: pro.abonnementId, numero: abonnementNumero, status: err.status, code: err.code, err: err.message });
    return aLaMain(`Stripe refuse de poser la remise (${err.status ?? 'réseau'}${err.code ? `, ${err.code}` : ''}).`);
  }
}

/** Ce que la fin du Pro transmet : lu sur l'événement de Stripe et sur la ligne du Pro. */
export interface FinDuPro {
  tenantId: string;
  abonnementPro: string;
  livemode: boolean;
  raison: RaisonFinOffre;
  finiLe: Date;
  /** Le client a choisi de rendre son numéro à la fin de ce Pro (`abonnements_offre.rendre_numero`). */
  rendreNumero: boolean;
  /**
   * La fin PRÉVUE du Pro, celle que la console, Claude et l'e-mail ont annoncée (`abonnements_offre.fin_prevue_le`) ;
   * `null` si le Pro a été arrêté sans fin programmée.
   */
  finPrevueLe: Date | null;
  /** Le client Stripe de l'abonnement Pro, et la carte qu'il porte (`default_payment_method`) ; `null` s'ils manquent. */
  customerId: string | null;
  carte: string | null;
}

/**
 * `pro_vivant` : un AUTRE Pro de l'espace vit (un rejeu tardif de la fin), il couvre le numéro. `couvert_par_offre` : un
 * Business ou une Entreprise posés le couvrent (spec Business). `en_cours` : la même création est déjà en cours chez
 * Stripe. `a_verifier` : le numéro seul recréé n'a pas été enregistré, Julien vérifie.
 */
export type IssueFinDuPro =
  | 'sans_numero' | 'pro_vivant' | 'couvert_par_offre' | 'deja_abonne' | 'recree' | 'a_verifier' | 'en_cours' | 'porte' | 'rendu';

/**
 * Le numéro seul encore vivant à la fin du Pro (un essai ne l'arrête pas), que le client a choisi de rendre : arrêté chez
 * Stripe avec un avoir (sans avoir s'il est en retard, J7). Un refus de Stripe ne lève jamais : Julien est prévenu.
 */
async function rendreLeNumeroSeul(d: DepsNumeroInclus, tenantId: string, a: AbonnementNumero): Promise<IssueFinDuPro> {
  const lien = lienTableauStripe('subscriptions', a.abonnementId, a.livemode);
  if (d.stripe === null || d.stripe.livemode !== a.livemode) {
    await d.alerter(`Fin du Pro de l'espace ${tenantId} : son numéro, à rendre, court encore en abonnement seul ${a.abonnementId}. À arrêter à la main avec un avoir au prorata. ${lien}`);
    return 'a_verifier';
  }
  try {
    await arreterAbonnementNumeroSeul(d.stripe.transport, { cle: d.stripe.cle, abonnementId: a.abonnementId, avoir: a.statut !== 'en_retard' });
    return 'rendu';
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    if (dejaEnCours(err)) return 'en_cours';
    journaliser('error', 'numero_rendu_arret_impossible', { tenantId, abonnement: a.abonnementId, status: err.status, code: err.code, err: err.message });
    await d.alerter(`Fin du Pro de l'espace ${tenantId} : son numéro est à rendre, mais Stripe refuse d'arrêter son abonnement seul ${a.abonnementId} (${err.status ?? 'réseau'}${err.code ? `, ${err.code}` : ''}). À arrêter à la main avec un avoir au prorata. ${lien}`);
    return 'a_verifier';
  }
}

/**
 * L'écart toléré entre la fin effective du Pro et sa fin prévue pour la tenir pour « à sa fin prévue » : Stripe finit
 * l'abonnement à l'échéance, à quelques minutes près. Au-delà, le Pro a été arrêté tout de suite (R1 de la relecture).
 */
export const MARGE_FIN_PREVUE_MS = 24 * 3_600_000;

/** La fin effective du Pro de l'espace (rejouée comprise). Ne lève que sur une panne de base. */
export async function surFinDuPro(d: DepsNumeroInclus, f: FinDuPro): Promise<IssueFinDuPro> {
  // J5 de la relecture : la fin d'un Pro relivrée après la souscription d'un autre. Le Pro vivant couvre le numéro.
  if (await d.proVivant(f.tenantId)) return 'pro_vivant';
  // 🔴 Relecture à froid de la spec Business : un Pro payé que le client résilie après que Julien a posé le Business. Le
  // Business couvre le numéro : le recréer à 3,50 € sur la carte du Pro ferait payer un numéro déjà inclus.
  if (await d.offreManuelleCouvre(f.tenantId)) return 'couvert_par_offre';
  if (!(await d.numero.numeroAttribue(f.tenantId))) return 'sans_numero';
  const seul = await d.numero.deLEspace(f.tenantId);
  if (vivant(seul)) {
    // 🔴 Rouge 2 de la relecture de la livraison 6 : un essai n'arrête pas le numéro payé à part ; si le client a choisi
    // de le RENDRE à la fin du Pro, il s'arrête ici, avec un avoir. Sa fin suit le chemin du lot 4 (envois coupés, 7 jours,
    // libération), par le webhook de l'abonnement du numéro. Sans ce choix, il continue, comme avant.
    return f.rendreNumero ? rendreLeNumeroSeul(d, f.tenantId, seul) : 'deja_abonne';
  }

  const porter = async (pourquoi: string | null): Promise<'porte'> => {
    await d.numero.porterLaFinParLePro({ tenantId: f.tenantId, abonnementPro: f.abonnementPro, livemode: f.livemode, finiLe: f.finiLe });
    if (pourquoi !== null) {
      await d.alerter(`Fin du Pro de l'espace ${f.tenantId} (${f.abonnementPro}) : ${pourquoi} Son numéro fourni suit le chemin d'un impayé (envois coupés, 7 jours pour s'abonner au numéro, puis libération).`);
    }
    return 'porte';
  };

  // Impayé, ou numéro rendu : le chemin du lot 4, sans rien demander à Stripe ; rien d'anormal à signaler. Un client qui
  // envoie par SON numéro (J8) n'utilise pas le numéro fourni : il n'est pas recréé, le lot 4 le libère 7 jours après.
  if (f.raison !== 'resiliation' || f.rendreNumero || (await d.numero.numeroApporte(f.tenantId))) return porter(null);
  // 🔴 R1 de la relecture : un Pro arrêté TOUT DE SUITE (Julien à la main, avant une suppression d'espace ou à la demande
  // d'un client) n'a rien annoncé. Prélever le numéro seul sur la carte d'un client qui part serait de l'argent pris à
  // tort : seule une fin à la fin PRÉVUE, donc annoncée, recrée le numéro seul.
  if (f.finPrevueLe === null || f.finiLe.getTime() < f.finPrevueLe.getTime() - MARGE_FIN_PREVUE_MS) {
    return porter('fin immédiate du Pro, sans fin annoncée : le numéro seul n’est pas recréé.');
  }
  const s = d.stripe;
  if (s === null || d.prixNumero === '' || s.livemode !== f.livemode) return porter('Stripe n’est pas configuré pour recréer le numéro seul.');
  if (f.customerId === null || f.carte === null) return porter('le Pro ne porte aucune carte pour le numéro seul.');
  try {
    const neuf = await creerAbonnementNumeroSeul(s.transport, {
      cle: s.cle, tenantId: f.tenantId, customerId: f.customerId, prix: d.prixNumero, carte: f.carte,
      idempotence: `numero-apres-pro-${f.abonnementPro}`,
    });
    const e = await d.numero.enregistrer({ tenantId: f.tenantId, abonnementId: neuf.id, livemode: f.livemode, periodeFin: neuf.periodeFin });
    // J5 de la relecture : un abonnement que l'enregistrement ne prend pas (déjà résilié chez nous, ou un autre numéro
    // seul vivant) ne « reprend » pas : Julien vérifie chez Stripe.
    if (e.etat !== 'enregistre') {
      await d.alerter(`Fin du Pro de l'espace ${f.tenantId} : le numéro seul recréé ${neuf.id} n'a pas été enregistré (${e.etat}). À vérifier chez Stripe. ${lienTableauStripe('subscriptions', neuf.id, f.livemode)}`);
      return 'a_verifier';
    }
    await d.alerter(`Fin du Pro de l'espace ${f.tenantId} : son numéro seul reprend sur la carte du Pro, 3,50 € HT par mois (${neuf.id}).`);
    return 'recree';
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    if (dejaEnCours(err)) {
      journaliser('info', 'numero_inclus_creation_en_cours', { tenantId: f.tenantId, pro: f.abonnementPro });
      return 'en_cours';
    }
    journaliser('error', 'numero_inclus_creation_impossible', { tenantId: f.tenantId, pro: f.abonnementPro, status: err.status, code: err.code, err: err.message });
    return porter(`Stripe refuse de recréer le numéro seul (${err.status ?? 'réseau'}${err.code ? `, ${err.code}` : ''}).`);
  }
}

/**
 * LA SORTIE D'UNE OFFRE POSÉE DANS /OPS (le Business, l'Entreprise : spec du 2026-10-27), appelée par la route de `/ops`
 * qui la retire. Sans carte ni abonnement Stripe à reprendre, le numéro fourni que plus rien ne couvre suit le chemin d'un
 * impayé, comme la fin d'un Pro sans carte : une ligne finie portée par /ops, puis le lot 4 (envois coupés, 7 jours pour
 * s'abonner au numéro, libération). Rien ne part chez Stripe. Rejouable : une seconde fois ne porte rien de plus.
 */
export async function surFinDeLOffreManuelle(d: DepsNumeroInclus, f: { tenantId: string; finiLe: Date }): Promise<IssueFinDuPro> {
  if (await d.proVivant(f.tenantId)) return 'pro_vivant';
  if (await d.offreManuelleCouvre(f.tenantId)) return 'couvert_par_offre';
  if (!(await d.numero.numeroAttribue(f.tenantId))) return 'sans_numero';
  if (vivant(await d.numero.deLEspace(f.tenantId))) return 'deja_abonne';
  // La ligne ne vise aucun abonnement Stripe : son mode est celui de l'instance, pour rester avec les lignes qu'elle lit.
  await d.numero.porterLaFinParLOps({ tenantId: f.tenantId, livemode: d.stripe?.livemode ?? false, finiLe: f.finiLe });
  return 'porte';
}
