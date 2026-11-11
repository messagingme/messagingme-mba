import { z } from 'zod';
import { journaliser } from '../lib/journal';
import type { FinDuPro } from '../offres/numero-inclus';
import type { PgAbonnementsOffreStore, PeriodiciteOffre, RaisonFinOffre } from '../offres/abonnements-offre.pg';
import type { PgAbonnementsNumeroStore } from './abonnements.pg';
import type { PgOptionsCreditStore, RaisonFinOption } from '../credit-whatsapp/options.pg';
import { arretDesLignes } from '../credit-whatsapp/etat-ligne';
import type { CasFinDeDroit, IssueFinDeDroitOption } from './option-credit-whatsapp';
import { finPrevueDe } from './client';
import { lienTableauStripe } from './liens';

/**
 * L'e-mail de l'arrêt de l'option se dit dans les jours qui suivent sa fin, pas au-delà (relecture du lot C5, jaune 4) :
 * Stripe rejoue un webhook en échec pendant trois jours, un rejeu doit encore le dire ; un événement plus tardif (une
 * métadonnée retouchée sur l'abonnement résilié, un événement renvoyé à la main) ne le dit plus.
 */
export const FENETRE_ARRET_JOURS = 3;
const JOUR_MS = 24 * 3600 * 1000;

/**
 * Le traitement des événements Stripe qui décrivent le cycle de vie du Pro ou du numéro fourni. La route garde le
 * protocole HTTP (signature, enveloppe et mode) ; ce module reconnaît les abonnements, interprète leurs objets et
 * applique leurs transitions. Les pannes inattendues remontent : Stripe doit alors rejouer l'événement.
 */

export interface DepsTraitementAbonnements {
  /**
   * L'abonnement du numéro fourni : l'enregistrement atomique de l'abonnement et du numéro, ses changements de statut,
   * l'alerte d'exploitation et la reprise des campagnes suspendues quand le paiement rend le numéro.
   */
  numero: Pick<PgAbonnementsNumeroStore, 'enregistrer' | 'majStatut' | 'noterFinPrevue'> & {
    alerter(texte: string): Promise<void>;
    reprendreCampagnes(tenantId: string): Promise<void>;
    /**
     * L'offre de l'espace inclut-elle le numéro (Pro, Business, Entreprise ; `droits.limites.numeroInclus`) ? L'alerte de
     * fin de l'abonnement du numéro seul le dit (jaune 10 de la relecture de A) : un Business le couvre sans Pro vivant.
     */
    inclusDansLOffre(tenantId: string): Promise<boolean>;
  };
  /**
   * Le Pro : son abonnement, l'invalidation immédiate du cache de l'offre, les alertes et les effets rejouables du
   * numéro inclus. `surPassageEnPro` et `surFinDuPro` sont appelés à chaque événement concerné, rejeux compris.
   */
  pro: Pick<PgAbonnementsOffreStore, 'enregistrer' | 'majStatut' | 'modifier' | 'finir' | 'vivant'> & {
    invalider(tenantId: string): void;
    alerter(texte: string): Promise<void>;
    /**
     * `arreterLeNumeroSeul` faux pendant l'essai de 14 jours (spec offres v2) : l'abonnement du numéro payé à part ne
     * s'arrête qu'à la première facture payée non nulle, sinon un essai abandonné ferait perdre son numéro au client.
     */
    surPassageEnPro(tenantId: string, o: { arreterLeNumeroSeul: boolean }): Promise<void>;
    surFinDuPro(f: FinDuPro): Promise<unknown>;
    /**
     * 🔴 Les sièges payés du Pro, RELUS CHEZ STRIPE (spec offres v2, livraison 7) : la charge d'un événement peut arriver
     * après un plus récent, et un nombre de sièges trop bas gèlerait un membre payé. `null` : les sièges ne sont pas en
     * vente (rien à relire), ceux déjà notés restent. Une panne de Stripe lève : le webhook échoue, Stripe rejouera.
     */
    siegesChezStripe(abonnementId: string): Promise<number | null>;
    /**
     * 🔴 La fin prévue du Pro, RELUE CHEZ STRIPE (`finPrevueChezStripe`, 2026-10-26) : un événement en retard ne remet pas
     * une fin que la console vient de retirer. `undefined` : rien de relu, la charge de l'événement sert. Une panne de
     * Stripe lève : le webhook échoue, Stripe rejouera.
     */
    finPrevueChezStripe(abonnementId: string): Promise<Date | null | undefined>;
  };
  /**
   * L'option du Crédit WhatsApp (lot 4a, `src/stripe/option-credit-whatsapp.ts`) : son abonnement, ses places RELUES chez
   * Stripe à chaque événement (la charge peut arriver après un plus récent), l'arrêt de ses lignes à sa fin, et sa fin de
   * droit jouée après la fin du Pro. 🔴 Aiguillée AVANT le numéro, qui acquitte en silence ce qu'il ne reconnaît pas.
   */
  option: Pick<PgOptionsCreditStore, 'enregistrer' | 'majStatut' | 'noterPlaces' | 'finir' | 'vivante' | 'finieLe'> & {
    /** `optionChezStripe` : `null` quand rien n'est à relire (l'option pas en vente, ou un refus durable, Julien prévenu). */
    chezStripe(abonnementId: string): Promise<{ statut: string; places: number; finPrevueLe: Date | null } | null>;
    /** `PgLignesCreditStore.arreterLesLignesDeLOption` : rend le nombre de lignes arrêtées. */
    arreterLesLignes(tenantId: string): Promise<number>;
    /** L'espace est-il une Entreprise (illimitée), l'offre relue SANS cache ? Ses lignes ne dépendent alors d'aucune option. */
    illimite(tenantId: string): Promise<boolean>;
    /**
     * `PgLignesCreditStore.relancerLesLignesDeLOption` : une option reprise relance les lignes que la fin de la précédente
     * avait arrêtées (relecture du lot 4a, jaune 4). Rend le nombre de lignes relancées.
     */
    relancerLesLignes(tenantId: string): Promise<number>;
    /** `PgNumeroDelieStore.leverPausesLigneCredit` : les campagnes en pause faute de ligne active repartent (jaune 6). */
    reprendreCampagnes(tenantId: string): Promise<number>;
    /**
     * `resilierOptionChezStripe` : un impayé que Stripe abandonne en `unpaid` laisse l'abonnement vivant chez lui, qui le
     * prélèverait encore (jaune 3). `false` quand Stripe ne l'a pas résilié, relu (Julien prévenu) ; ne lève jamais sur une
     * erreur de Stripe, la fin s'écrit quand même (relecture du lot C5, jaune 3).
     */
    resilier(abonnementId: string): Promise<boolean>;
    /**
     * `finDeDroitOption` : l'option sans offre qui y donne droit se résilie, ses lignes arrêtées. Jouée après la fin d'un
     * Pro (`fin_de_droit`), et à l'enregistrement d'une option (`payee_sans_droit` : une option payée sans droit ne relance
     * rien ; ses admins le savent par e-mail une fois résiliée, sinon Julien les prévient). Rejouable, une à la fois par
     * espace et par cas ; rend l'issue, `garde_son_droit` quand une offre y donne encore droit, `en_cours` quand une autre
     * la joue. 🔴 `cas` est transmis tel quel au câblage : une flèche qui ne le recevrait pas l'avalerait en silence.
     */
    finDeDroit(tenantId: string, cas: CasFinDeDroit): Promise<IssueFinDeDroitOption>;
    alerter(texte: string): Promise<void>;
    /**
     * `PgLignesCreditStore.lignesDeLEspace` : les lignes en cours de l'espace, relues après l'arrêt. Leur ÉTAT décide
     * l'e-mail de l'arrêt (`arretDesLignes`, la règle de l'onglet), pas ce qu'un appel a arrêté (lot C, jaunes 2 et 4).
     */
    lignes(tenantId: string): Promise<ReadonlyArray<{ origine: 'ops' | 'option'; arreteeLe: Date | string | null }>>;
    /**
     * La prise de l'option serait-elle acceptée maintenant (`repriseOuverte`, l'offre relue SANS cache) ? « Reprenez
     * l'option » ne se dit qu'alors (lot C, jaune 5) : jamais à un Pro en retard, ni à un Pro dont la fin programmée est
     * passée (son avis pas encore traité).
     */
    repriseOuverte(tenantId: string): Promise<boolean>;
    /**
     * L'option est-elle en vente (`optionEnVente`) ? Hors vente (son prix retiré), l'e-mail de l'arrêt ne part pas : il
     * dirait « reprenez l'option » ; l'alerte à Julien le dit (relecture du lot C5, jaune 5).
     */
    enVente(): boolean;
    /** L'e-mail de l'arrêt aux admins (lot C, moment 3, `creerOptionArretee`), une fois par abonnement. Ne lève jamais. */
    prevenirArret(tenantId: string, abonnementId: string): Promise<void>;
  };
  /**
   * L'e-mail aux admins d'un renouvellement refusé (lot 7, livraison B), une fois par facture : Stripe réessaie la même
   * facture, et chaque essai raté redonne un `invoice.payment_failed`. Ne lève jamais (`creerPaiementRefuse`).
   */
  paiementRefuse(p: { tenantId: string; offre: 'pro' | 'numero' | 'option_credit_whatsapp'; factureId: string }): Promise<void>;
  /**
   * La conversion de nos publicités (pixel, lot 2, `src/pub/`) : le premier paiement RÉEL de l'offre d'un espace. Appelé à
   * chaque facture payée non nulle, rejeux compris : la réservation en garde une par espace. Ne lève jamais.
   */
  signalerPro(p: { tenantId: string; montantCentimes: number; devise: string }): Promise<void>;
  /**
   * La conversion dite au client (lot C du Crédit WhatsApp, moment 2, `signalerConversionDuPro`) : appelée à chaque facture
   * de période payée de la formule Pro et à chaque mise à jour d'un Pro actif ; elle se borne à son moment (la fenêtre qui
   * suit la formule devenue payée), relit l'état et ne laisse partir qu'un e-mail par occasion. Ne lève jamais.
   */
  signalerConversion(tenantId: string): Promise<void>;
  now?: () => number;
}

export interface EvenementStripeVerifie {
  id: string;
  type: string;
  livemode: boolean;
  objet: unknown;
}

export type IssueTraitementAbonnement =
  | { issue: 'non_abonnement' }
  | { issue: 'acquitte' }
  | { issue: 'illisible'; domaine: 'pro' | 'numero' | 'option' };

const NON_ABONNEMENT = { issue: 'non_abonnement' } as const;
const ACQUITTE = { issue: 'acquitte' } as const;

/** Les événements toujours confiés au traitement des abonnements. Une session Checkout doit d'abord être reconnue. */
const TYPES_ABONNEMENT = new Set([
  'invoice.paid', 'invoice.payment_failed', 'customer.subscription.deleted', 'customer.subscription.updated',
]);

/** Une session d'abonnement du numéro fourni. */
const sessionNumeroSchema = z.object({
  id: z.string().min(1),
  mode: z.literal('subscription'),
  payment_status: z.string(),
  subscription: z.union([z.string().startsWith('sub_'), z.object({ id: z.string().startsWith('sub_') })]),
  metadata: z.object({ tenant_id: z.uuid(), produit: z.literal('numero') }),
});

/**
 * Une facture Stripe `2025-11-17.clover` : l'abonnement et ses métadonnées sont sous
 * `parent.subscription_details`, la fin de la période payée sur ses lignes.
 */
const factureSchema = z.object({
  id: z.string().startsWith('in_'),
  parent: z.object({
    subscription_details: z.object({
      subscription: z.union([z.string(), z.object({ id: z.string() })]),
      metadata: z.record(z.string(), z.string()).nullable().optional(),
    }).nullable().optional(),
  }).nullable().optional(),
  lines: z.object({
    data: z.array(z.object({
      period: z.object({ end: z.number().int() }).optional(),
      /** Ce qui a produit la ligne (version « basil » et après) : un prorata le dit sur son parent, une période non. */
      parent: z.object({
        subscription_item_details: z.object({ proration: z.boolean().optional() }).nullable().optional(),
      }).nullable().optional(),
    })),
  }).optional(),
  /** Le montant réellement payé, en centimes : 0 pour la facture qui ouvre un essai (spec offres v2). */
  amount_paid: z.number().int().optional(),
  /** La devise de la facture, en minuscules chez Stripe (`eur`). */
  currency: z.string().optional(),
  /** `subscription_create` (l'essai qui s'ouvre), `subscription_cycle` (une période payée, après l'essai), etc. */
  billing_reason: z.string().nullable().optional(),
  /** Le moment du paiement (secondes) : une facture réglée APRÈS la fin d'une option est à rembourser, pas avant. */
  status_transitions: z.object({ paid_at: z.number().int().nullable().optional() }).nullable().optional(),
});

/** Une facture payée qui mène à l'enregistrement d'une option : son montant (centimes) et son moment de paiement. */
interface FacturePayee {
  centimes: number;
  payeLe: Date | null;
}

const abonnementNumeroSchema = z.object({ id: z.string().startsWith('sub_') });

/** La fin programmée vit à la racine ou sur les lignes de l'abonnement selon le geste effectué dans Stripe. */
const abonnementNumeroModifieSchema = z.object({
  id: z.string().startsWith('sub_'),
  cancel_at: z.number().int().nullable().optional(),
  cancel_at_period_end: z.boolean().optional(),
  items: z.object({ data: z.array(z.object({ current_period_end: z.number().int().optional() })) }).optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
});

const metaNumeroSchema = z.object({ tenant_id: z.uuid(), produit: z.literal('numero') });
/** La périodicité est posée à la création puis peut être relue sur le prix après un changement dans le portail. */
/**
 * `essai` : posé par `ouvrirPro` sur la session ET l'abonnement d'un essai de 14 jours (spec offres v2) ; chaque événement
 * le porte donc, quel que soit l'ordre où Stripe les livre.
 */
const metaProSchema = z.object({
  tenant_id: z.uuid(), produit: z.literal('pro'), periodicite: z.enum(['mois', 'an']).optional(), essai: z.string().optional(),
});
const estEssai = (m: { essai?: string }): boolean => m.essai !== undefined && m.essai !== '';
/** Les jours d'essai que porte la marque (`essai: '14'`), un entier positif ; sinon `null`. */
const joursEssai = (m: { essai?: string }): number | null => {
  const n = Number(m.essai);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * La marque du Pro suffit à aiguiller vers ce chemin : un objet marqué mais mal formé doit être refusé en 422, jamais
 * tomber silencieusement dans le traitement du numéro ou de la recharge.
 */
const marqueProSchema = z.object({ metadata: z.object({ produit: z.literal('pro') }) });
const factureMarqueeProSchema = z.object({ parent: z.object({ subscription_details: marqueProSchema }) });

const sessionProSchema = z.object({
  id: z.string().min(1),
  mode: z.literal('subscription'),
  payment_status: z.string(),
  subscription: z.union([z.string().startsWith('sub_'), z.object({ id: z.string().startsWith('sub_') })]),
  metadata: metaProSchema,
});

const abonnementProSchema = z.object({
  id: z.string().startsWith('sub_'),
  metadata: metaProSchema,
  /** `trialing` pendant l'essai ; `incomplete` à la création d'un abonnement pas encore payé (rien n'est enregistré). */
  status: z.string().optional(),
  trial_end: z.number().int().nullable().optional(),
  cancel_at: z.number().int().nullable().optional(),
  cancel_at_period_end: z.boolean().optional(),
  ended_at: z.number().int().nullable().optional(),
  cancellation_details: z.object({ reason: z.string().nullable().optional() }).nullable().optional(),
  items: z.object({
    data: z.array(z.object({
      current_period_end: z.number().int().optional(),
      price: z.object({ recurring: z.object({ interval: z.string() }).nullable().optional() }).optional(),
    })),
  }).optional(),
  // Le client et la carte sont repris pour recréer le numéro seul à la fin du Pro.
  customer: z.union([z.string(), z.object({ id: z.string() })]).nullable().optional(),
  default_payment_method: z.union([z.string(), z.object({ id: z.string() })]).nullable().optional(),
});

const PERIODICITE_DE_STRIPE: Readonly<Record<string, PeriodiciteOffre>> = { month: 'mois', year: 'an' };
const idDe = (v: string | { id: string }): string => (typeof v === 'string' ? v : v.id);
const raisonDeLaFin = (reason: string | null | undefined): RaisonFinOffre =>
  (reason === 'payment_failed' || reason === 'payment_disputed' ? 'impaye' : 'resiliation');

function espaceDisparu(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23503';
}

function objetDuPro(type: string, objet: unknown): boolean {
  return (type.startsWith('invoice.') ? factureMarqueeProSchema : marqueProSchema).safeParse(objet).success;
}

/**
 * L'option du Crédit WhatsApp (lot 4a) : sa marque suffit à l'aiguiller, comme le Pro. Un objet marqué mais mal formé est
 * refusé en 422, jamais confié au numéro, qui l'acquitterait en silence.
 */
const marqueOptionSchema = z.object({ metadata: z.object({ produit: z.literal('option_credit_whatsapp') }) });
const factureMarqueeOptionSchema = z.object({ parent: z.object({ subscription_details: marqueOptionSchema }) });
const metaOptionSchema = z.object({ tenant_id: z.uuid(), produit: z.literal('option_credit_whatsapp') });
const sessionOptionSchema = z.object({
  id: z.string().min(1),
  mode: z.literal('subscription'),
  payment_status: z.string(),
  subscription: z.union([z.string().startsWith('sub_'), z.object({ id: z.string().startsWith('sub_') })]),
  metadata: metaOptionSchema,
});
const abonnementOptionSchema = z.object({
  id: z.string().startsWith('sub_'),
  metadata: metaOptionSchema,
  cancellation_details: z.object({ reason: z.string().nullable().optional() }).nullable().optional(),
  ended_at: z.number().int().nullable().optional(),
});

function objetDeLOption(type: string, objet: unknown): boolean {
  return (type.startsWith('invoice.') ? factureMarqueeOptionSchema : marqueOptionSchema).safeParse(objet).success;
}

/** Les places d'une option, bornées comme en base (1 à 20). Une quantité posée à la main hors bornes est ramenée. */
const PLACES_MIN = 1;
const PLACES_MAX = 20;

export function creerTraitementAbonnements(deps: DepsTraitementAbonnements) {
  const maintenant = deps.now ?? (() => Date.now());

  function concerne(e: Pick<EvenementStripeVerifie, 'type' | 'objet'>): boolean {
    return TYPES_ABONNEMENT.has(e.type)
      // La création d'un abonnement du Pro (essai de 14 jours) ; celle du numéro ne nous apprend rien.
      || (e.type === 'customer.subscription.created' && objetDuPro(e.type, e.objet))
      || (e.type === 'checkout.session.completed'
        && (sessionNumeroSchema.safeParse(e.objet).success || objetDuPro(e.type, e.objet) || objetDeLOption(e.type, e.objet)));
  }

  function illisible(e: EvenementStripeVerifie, domaine: 'pro' | 'numero' | 'option'): IssueTraitementAbonnement {
    const cle = { pro: 'stripe_pro_illisible', numero: 'stripe_abonnement_illisible', option: 'stripe_option_wa_illisible' } as const;
    journaliser('error', cle[domaine], { evenement: e.id, type: e.type });
    return { issue: 'illisible', domaine };
  }

  async function enregistrerNumero(a: {
    tenantId: string;
    abonnementId: string;
    livemode: boolean;
    periodeFin: Date | null;
  }): Promise<void> {
    let issue: Awaited<ReturnType<typeof deps.numero.enregistrer>>;
    try {
      issue = await deps.numero.enregistrer(a);
    } catch (err) {
      // Un espace supprimé peut encore être facturé. La clé étrangère ne guérira pas au rejeu : acquitter et alerter.
      if (!espaceDisparu(err)) throw err;
      journaliser('error', 'stripe_abonnement_espace_disparu', {
        tenantId: a.tenantId, abonnement: a.abonnementId, livemode: a.livemode,
      });
      await deps.numero.alerter(`L'espace supprimé ${a.tenantId} paie encore son abonnement ${a.abonnementId} : à résilier chez Stripe. ${lienTableauStripe('subscriptions', a.abonnementId, a.livemode)}`);
      return;
    }
    // Un réabonnement payé rend le numéro : les campagnes en pause sur sa suspension repartent.
    if (issue.etat === 'enregistre') await deps.numero.reprendreCampagnes(a.tenantId);
    if (issue.etat === 'doublon') {
      await deps.numero.alerter(`Abonnement en double : ${a.abonnementId} pour l'espace ${a.tenantId}, qui en a déjà un. À annuler et rembourser chez Stripe. Tant qu'il ne l'est pas, chacune de ses factures redonne cette alerte.`);
    } else if (issue.etat === 'enregistre' && issue.numero === null) {
      await deps.numero.alerter(`URGENT : l'espace ${a.tenantId} a payé son numéro (${a.abonnementId}) mais la réserve est vide. Déclare un numéro dans /ops : il lui sera attribué.`);
    }
  }

  async function traiterPro(e: EvenementStripeVerifie): Promise<IssueTraitementAbonnement> {
    /**
     * `essai` : le Pro court sans facture payée (essai de 14 jours) ; il ouvre tout, mais n'arrête pas l'abonnement du
     * numéro payé à part, ce que fera la première facture payée non nulle.
     */
    const enregistrer = async (a: {
      tenantId: string;
      abonnementId: string;
      periodicite: PeriodiciteOffre;
      periodeFin: Date | null;
      essaiFinLe?: Date | null;
      /** Une fin d'essai approchée, qui ne remplit qu'un vide en base (`PgAbonnementsOffreStore.enregistrer`). */
      essaiFinProvisoire?: Date | null;
    }, essai = false): Promise<void> => {
      let issue: Awaited<ReturnType<typeof deps.pro.enregistrer>>;
      try {
        issue = await deps.pro.enregistrer({ ...a, livemode: e.livemode });
      } catch (err) {
        // Même politique que le numéro pour un espace supprimé : ce 23503 est définitif, donc alerte et acquittement.
        if (!espaceDisparu(err)) throw err;
        journaliser('error', 'stripe_pro_espace_disparu', {
          tenantId: a.tenantId, abonnement: a.abonnementId, livemode: e.livemode,
        });
        await deps.pro.alerter(`L'espace supprimé ${a.tenantId} paie encore son Pro ${a.abonnementId} : à résilier chez Stripe. ${lienTableauStripe('subscriptions', a.abonnementId, e.livemode)}`);
        return;
      }
      if (issue.etat === 'enregistre') {
        deps.pro.invalider(issue.tenantId);
        if (issue.nouveau) {
          const formule = a.periodicite === 'an' ? 'annuel' : 'mensuel';
          await deps.pro.alerter(essai
            ? `Nouveau Pro en essai : espace ${issue.tenantId} (${a.abonnementId}, ${formule}${a.essaiFinLe ? `, fin de l'essai le ${a.essaiFinLe.toISOString().slice(0, 10)}` : ''}).`
            : `Nouveau Pro : espace ${issue.tenantId} (${a.abonnementId}, ${formule}).`);
        }
        // Rejouable : une panne du premier passage ne doit jamais perdre l'effet sur le numéro inclus.
        await deps.pro.surPassageEnPro(issue.tenantId, { arreterLeNumeroSeul: !essai });
      } else if (issue.etat === 'doublon') {
        await deps.pro.alerter(`Pro en double : ${a.abonnementId} pour l'espace ${a.tenantId}, qui a déjà un Pro vivant. À annuler et rembourser chez Stripe.`);
      }
    };

    if (e.type === 'checkout.session.completed') {
      const lu = sessionProSchema.safeParse(e.objet);
      if (!lu.success) return illisible(e, 'pro');
      if (lu.data.payment_status !== 'paid' && lu.data.payment_status !== 'no_payment_required') return ACQUITTE;
      // 🟡 La session d'un essai ne dit pas sa fin : arrivée avant la création de l'abonnement, elle laissait l'essai sans
      // fin, lu « payé dès le départ » (jaune 3 de la relecture du lot A). Une fin provisoire, maintenant plus les jours de
      // la marque, remplit ce vide ; la création de l'abonnement écrit la fin exacte.
      const jours = joursEssai(lu.data.metadata);
      await enregistrer({
        tenantId: lu.data.metadata.tenant_id,
        abonnementId: idDe(lu.data.subscription),
        periodicite: lu.data.metadata.periodicite ?? 'mois',
        periodeFin: null,
        ...(jours === null ? {} : { essaiFinProvisoire: new Date(maintenant() + jours * 86_400_000) }),
      }, estEssai(lu.data.metadata));
      return ACQUITTE;
    }

    // La création de l'abonnement (spec offres v2) : celle d'un ESSAI porte sa fin, et peut arriver avant la session : elle
    // suffit alors à faire le Pro. Tout autre statut attend sa facture payée, comme avant : un abonnement `active` peut
    // l'être avant l'encaissement (un prélèvement SEPA en cours), et `incomplete` ne l'est pas encore.
    if (e.type === 'customer.subscription.created') {
      const lu = abonnementProSchema.safeParse(e.objet);
      if (!lu.success) return illisible(e, 'pro');
      if (lu.data.status !== 'trialing') return ACQUITTE;
      const lignes = lu.data.items?.data ?? [];
      const fins = lignes.map((l) => l.current_period_end).filter((v): v is number => typeof v === 'number');
      const intervalle = lignes.map((l) => l.price?.recurring?.interval).find((v): v is string => typeof v === 'string');
      await enregistrer({
        tenantId: lu.data.metadata.tenant_id,
        abonnementId: lu.data.id,
        periodicite: lu.data.metadata.periodicite ?? (intervalle ? PERIODICITE_DE_STRIPE[intervalle] : undefined) ?? 'mois',
        periodeFin: fins.length > 0 ? new Date(Math.max(...fins) * 1000) : null,
        essaiFinLe: lu.data.trial_end ? new Date(lu.data.trial_end * 1000) : null,
        // Un abonnement en essai l'est même sans notre marque : le numéro payé à part n'est jamais arrêté pendant un essai.
      }, true);
      return ACQUITTE;
    }

    if (e.type === 'customer.subscription.updated' || e.type === 'customer.subscription.deleted') {
      const lu = abonnementProSchema.safeParse(e.objet);
      if (!lu.success) return illisible(e, 'pro');
      const lignes = lu.data.items?.data ?? [];
      if (e.type === 'customer.subscription.deleted') {
        const fin = lu.data.ended_at ? new Date(lu.data.ended_at * 1000) : new Date(maintenant());
        const raison = raisonDeLaFin(lu.data.cancellation_details?.reason);
        const a = await deps.pro.finir(lu.data.id, raison, fin);
        if (a) {
          deps.pro.invalider(a.tenantId);
          if (a.premiereFin) {
            await deps.pro.alerter(`Pro terminé (${raison === 'impaye' ? 'impayé' : 'résiliation'}) : espace ${a.tenantId} (${a.abonnementId}). L'espace revient en Free.`);
          }
          // La première raison et la première date, gardées en base, prévalent lors des rejeux.
          await deps.pro.surFinDuPro({
            tenantId: a.tenantId,
            abonnementPro: a.abonnementId,
            livemode: e.livemode,
            raison: a.finRaison ?? raison,
            finiLe: a.finiLe ?? fin,
            rendreNumero: a.rendreNumero,
            finPrevueLe: a.finPrevueLe,
            customerId: lu.data.customer ? idDe(lu.data.customer) : null,
            carte: lu.data.default_payment_method ? idDe(lu.data.default_payment_method) : null,
          });
          // L'option du Crédit WhatsApp que plus aucune offre ne permet (ni Business ni Entreprise) se résilie (lot 4a).
          await deps.option.finDeDroit(a.tenantId, 'fin_de_droit');
        }
        return ACQUITTE;
      }
      const intervalle = lignes.map((l) => l.price?.recurring?.interval).find((v): v is string => typeof v === 'string');
      const sieges = await deps.pro.siegesChezStripe(lu.data.id);
      // La fin RELUE chez Stripe, l'état de maintenant : un événement en retard ne remet pas une fin retirée depuis. Lue en
      // DERNIER, au plus près de l'écriture. Sans relecture, la charge, par le même calcul que la résiliation de la console.
      const relue = await deps.pro.finPrevueChezStripe(lu.data.id);
      const finPrevue = relue === undefined ? finPrevueDe(lu.data) : relue;
      const a = await deps.pro.modifier(lu.data.id, {
        finPrevueLe: finPrevue,
        periodicite: intervalle ? (PERIODICITE_DE_STRIPE[intervalle] ?? null) : null,
        ...(sieges !== null ? { sieges } : {}),
        // La fin de l'essai, quel que soit le statut : un essai écourté (par la console ou au tableau de bord) rend un
        // abonnement actif dont la fin d'essai a avancé (révision du 2026-11-04, décision 6). Une fin déjà passée en base
        // ne recule plus : un avis en retard, encore « en essai », ne rouvre pas l'essai (`PgAbonnementsOffreStore.modifier`).
        ...(lu.data.trial_end ? { essaiFinLe: new Date(lu.data.trial_end * 1000) } : {}),
      });
      if (a) deps.pro.invalider(a.tenantId);
      // La conversion rattrapée (jaune 6 de la relecture du lot C) : un essai écourté au tableau de bord de Stripe, ou une fin
      // d'essai que le démarrage n'a pas pu écrire, ne se voient que par cette mise à jour. La fenêtre la borne.
      if (a && lu.data.status === 'active') await deps.signalerConversion(a.tenantId);
      return ACQUITTE;
    }

    const lu = factureSchema.safeParse(e.objet);
    const details = lu.success ? lu.data.parent?.subscription_details : null;
    const meta = metaProSchema.safeParse(details?.metadata ?? {});
    if (!lu.success || !details || !meta.success) return illisible(e, 'pro');
    const abonnementId = idDe(details.subscription);
    const fins = (lu.data.lines?.data ?? []).map((l) => l.period?.end).filter((v): v is number => typeof v === 'number');
    const finFacture = fins.length > 0 ? new Date(Math.max(...fins) * 1000) : null;
    if (e.type === 'invoice.payment_failed') {
      // 🔴 Le prorata d'un siège refusé (livraison 7) : le changement attendait ce paiement et n'est pas appliqué. Le Pro
      // reste payé à jour ; le mettre en retard enverrait aux admins l'e-mail d'un renouvellement qui n'a pas eu lieu.
      if (lu.data.billing_reason === 'subscription_update') return ACQUITTE;
      const a = await deps.pro.majStatut(abonnementId, 'en_retard', null, finFacture);
      if (a) {
        deps.pro.invalider(a.tenantId);
        // Vraie pour toute offre effective : une Entreprise ou un Business qui garde un Pro n'y revient pas en Free, et
        // leurs admins n'ont pas d'e-mail (`paiementRefuse` se tait hors Pro) ; reste un Pro superflu (relecture du lot
        // V12, jaune 4).
        await deps.pro.alerter(`Renouvellement du Pro échoué : espace ${a.tenantId} (${a.abonnementId}). Stripe réessaie ; sans paiement, le Pro s'arrêtera et l'espace reviendra en Free, sauf s'il est en Entreprise ou en Business (un Pro superflu, à résilier chez Stripe : ses admins n'ont pas d'e-mail).`);
        // Seulement un Pro EN RETARD : un échec livré après la fin (Stripe ne garantit pas l'ordre) ne prévient pas.
        if (a.statut === 'en_retard') await deps.paiementRefuse({ tenantId: a.tenantId, offre: 'pro', factureId: lu.data.id });
      }
      return ACQUITTE;
    }
    // 🔴 L'essai (spec offres v2) : la facture à 0 € qui l'ouvre n'arrête rien ; la PREMIÈRE facture payée non nulle
    // arrête l'abonnement du numéro payé à part (rejouable, comme tout passage en Pro). Une facture de CYCLE payée l'arrête
    // aussi, même à 0 € (rouge 1 de la relecture) : un code promo à 100 % ferait sinon prélever le numéro seul en silence.
    // Un essai abandonné ne produit jamais de facture de cycle payée.
    // Le prorata d'un siège (`subscription_update`, livraison 7) n'est jamais le premier paiement du Pro : pendant l'essai il
    // vaut 0 €, mais on ne le confie pas à Stripe (Y12 de la relecture).
    // 🔴 Sauf l'essai ÉCOURTÉ (`trial_end=now`, révision du 2026-11-04) : Stripe facture sa première période en
    // `subscription_update` aussi, mais au plein prix et sans aucune ligne de prorata. Une `subscription_update` ne compte
    // donc comme période payée que si TOUTES ses lignes disent n'être pas un prorata ; une ligne de prorata (siège), une
    // ligne d'un autre parent ou aucune ligne lue la laissent exclue, comme avant. Le 0 € reste réservé au cycle : une mise
    // à jour à 0 € pendant l'essai n'arrête rien.
    const lignes = lu.data.lines?.data ?? [];
    const periodeSansProrata = lignes.length > 0 && lignes.every((l) => l.parent?.subscription_item_details?.proration === false);
    const paiementDePeriode = lu.data.billing_reason !== 'subscription_update' || periodeSansProrata;
    const payeeNonNulle = paiementDePeriode
      && ((lu.data.amount_paid ?? 0) > 0 || lu.data.billing_reason === 'subscription_cycle');
    // Une facture peut arriver avant la session Checkout : elle suffit alors à enregistrer le Pro.
    const paye = await deps.pro.majStatut(abonnementId, 'actif', finFacture);
    if (paye) {
      deps.pro.invalider(paye.tenantId);
      if (estEssai(meta.data) && payeeNonNulle) await deps.pro.surPassageEnPro(paye.tenantId, { arreterLeNumeroSeul: true });
    } else {
      // 🟡 La facture à 0 € qui ouvre un essai couvre l'essai : sa fin, provisoire comme celle de la session (jaune 3).
      const ouvreUnEssai = estEssai(meta.data) && !payeeNonNulle;
      await enregistrer({
        tenantId: meta.data.tenant_id,
        abonnementId,
        periodicite: meta.data.periodicite ?? 'mois',
        periodeFin: finFacture,
        ...(ouvreUnEssai && finFacture !== null ? { essaiFinProvisoire: finFacture } : {}),
      }, ouvreUnEssai);
    }
    // La conversion dite au client (lot C du Crédit WhatsApp) : une facture de période payée, jamais la facture à 0 € qui
    // ouvre un essai ni le prorata d'un siège. Après l'enregistrement : la conversion relit l'état des cartes (la règle de
    // la prise) et la fin de l'essai sur ce qu'il a écrit.
    if (payeeNonNulle) await deps.signalerConversion(paye?.tenantId ?? meta.data.tenant_id);
    // La conversion de nos publicités : un paiement RÉEL, jamais la facture à 0 € d'un essai ou d'un code promo à 100 %, ni
    // le prorata d'un siège ; l'essai écourté, lui, en est un. Après l'enregistrement : le fait suit le paiement qu'il raconte.
    const montant = lu.data.amount_paid ?? 0;
    if (montant > 0 && paiementDePeriode) {
      await deps.signalerPro({ tenantId: paye?.tenantId ?? meta.data.tenant_id, montantCentimes: montant, devise: (lu.data.currency ?? 'eur').toUpperCase() });
    }
    return ACQUITTE;
  }

  async function traiterNumero(e: EvenementStripeVerifie): Promise<IssueTraitementAbonnement> {
    if (e.type === 'checkout.session.completed') {
      const lu = sessionNumeroSchema.safeParse(e.objet);
      if (!lu.success) return illisible(e, 'numero');
      // Un code promo à 100 % rend `no_payment_required` : le numéro est dû comme après un paiement (comme le Pro).
      if (lu.data.payment_status !== 'paid' && lu.data.payment_status !== 'no_payment_required') return ACQUITTE;
      await enregistrerNumero({
        tenantId: lu.data.metadata.tenant_id,
        abonnementId: idDe(lu.data.subscription),
        livemode: e.livemode,
        periodeFin: null,
      });
      return ACQUITTE;
    }

    if (e.type === 'customer.subscription.deleted') {
      const lu = abonnementNumeroSchema.safeParse(e.objet);
      if (!lu.success) return illisible(e, 'numero');
      const a = await deps.numero.majStatut(lu.data.id, 'resilie', null);
      if (a) {
        await deps.numero.alerter(await deps.numero.inclusDansLOffre(a.tenantId)
          ? `Abonnement du numéro seul arrêté : espace ${a.tenantId} (${a.abonnementId}). Le numéro est inclus dans son offre.`
          : `Abonnement du numéro terminé : espace ${a.tenantId} (${a.abonnementId}). Ses envois sont coupés ; le numéro est gardé 7 jours pour un réabonnement, puis libéré.`);
      }
      return ACQUITTE;
    }

    if (e.type === 'customer.subscription.updated') {
      const lu = abonnementNumeroModifieSchema.safeParse(e.objet);
      if (!lu.success) return illisible(e, 'numero');
      if (!metaNumeroSchema.safeParse(lu.data.metadata ?? {}).success) return ACQUITTE;
      await deps.numero.noterFinPrevue(lu.data.id, finPrevueDe(lu.data));
      return ACQUITTE;
    }

    const lu = factureSchema.safeParse(e.objet);
    if (!lu.success) return illisible(e, 'numero');
    const details = lu.data.parent?.subscription_details;
    if (!details) return ACQUITTE;
    const abonnementId = idDe(details.subscription);
    const fins = (lu.data.lines?.data ?? []).map((l) => l.period?.end).filter((v): v is number => typeof v === 'number');
    const finFacture = fins.length > 0 ? new Date(Math.max(...fins) * 1000) : null;
    if (e.type === 'invoice.payment_failed') {
      // Un échec rejoué après le paiement ne doit pas régresser un abonnement déjà payé.
      const a = await deps.numero.majStatut(abonnementId, 'en_retard', null, finFacture);
      if (a) {
        await deps.numero.alerter(`Renouvellement du numéro échoué : espace ${a.tenantId} (${a.abonnementId}). Stripe réessaie ; sans paiement, ses envois seront coupés 7 jours après le premier échec.`);
        // Seulement un abonnement EN RETARD : un échec livré après la résiliation (Stripe ne garantit pas l'ordre) ne
        // prévient pas d'une coupure, le numéro l'est déjà.
        if (a.statut === 'en_retard') await deps.paiementRefuse({ tenantId: a.tenantId, offre: 'numero', factureId: lu.data.id });
      }
      return ACQUITTE;
    }
    const paye = await deps.numero.majStatut(abonnementId, 'actif', finFacture);
    if (paye) {
      // Une facture tardive sur un abonnement terminal ne rend rien : seul un abonnement actif reprend les campagnes.
      if (paye.statut === 'actif') await deps.numero.reprendreCampagnes(paye.tenantId);
      return ACQUITTE;
    }
    const meta = metaNumeroSchema.safeParse(details.metadata ?? {});
    if (meta.success) {
      await enregistrerNumero({ tenantId: meta.data.tenant_id, abonnementId, livemode: e.livemode, periodeFin: finFacture });
    }
    return ACQUITTE;
  }

  /**
   * L'OPTION DU CRÉDIT WHATSAPP (lot 4a). Enregistrée à la session payée, ou à la première facture payée arrivée avant ; ses
   * places et sa fin programmée RELUES chez Stripe à chaque événement (une place n'existe que payée) ; en retard sur un
   * échec de renouvellement, ses places restant tant que Stripe relance ; finie quand Stripe l'annonce (résiliée, ou un
   * impayé qu'il abandonne), ses lignes alors arrêtées.
   */
  async function traiterOption(e: EvenementStripeVerifie): Promise<IssueTraitementAbonnement> {
    /** Les places relues, ramenées aux bornes de la base ; `null` hors bornes basses (rien n'est inventé, Julien prévenu). */
    const borner = async (places: number, abonnementId: string): Promise<number | null> => {
      if (places >= PLACES_MIN && places <= PLACES_MAX) return places;
      await deps.option.alerter(`Option Crédit WhatsApp ${abonnementId} : ${places} place(s) chez Stripe, hors des bornes (${PLACES_MIN} à ${PLACES_MAX}). À régler.`);
      return places > PLACES_MAX ? PLACES_MAX : null;
    };
    /**
     * La fin : ses lignes arrêtées si aucune AUTRE option ne vit (un rejeu tardif ne coupe pas une option reprise depuis),
     * et jamais celles d'une Entreprise.
     */
    const finir = async (abonnementId: string, raison: RaisonFinOption, fin: Date): Promise<void> => {
      const a = await deps.option.finir(abonnementId, raison, fin);
      if (a === null) return;
      // 🔴 Une Entreprise est illimitée, sans option (relecture du lot 4a) : la garde lit l'arrêt d'une ligne AVANT
      // l'illimité, arrêter ses lignes couperait tous ses envois, réponses comprises.
      const illimite = await deps.option.illimite(a.tenantId);
      // Rejouable : arrêter des lignes déjà arrêtées n'écrit rien ; seule la première fin prévient Julien. 🔴 Une AUTRE
      // option vivante (reprise depuis) garde ses lignes : un rejeu tardif de la fin de l'ancienne ne les coupe pas.
      const seule = !illimite && (await deps.option.vivante(a.tenantId)) === null;
      const n = seule ? await deps.option.arreterLesLignes(a.tenantId) : 0;
      if (a.premiereFin) {
        // 🔴 Avant toute autre lecture (relecture du lot C5, jaune 10) : une panne après `finir` fait rejouer l'événement,
        // qui n'a plus `premiereFin`, et l'alerte se perdait.
        const suite = illimite ? 'Entreprise : ses lignes restent actives, sous l’illimité' : `${n} ligne${n > 1 ? 's' : ''} arrêtée${n > 1 ? 's' : ''}`;
        await deps.option.alerter(`Option Crédit WhatsApp terminée (${raison === 'impaye' ? 'impayé' : 'résiliation'}) : espace ${a.tenantId} (${a.abonnementId}), ${suite}.`);
      }
      /** Ce que Julien doit savoir quand l'e-mail ne part pas alors que l'option s'est arrêtée : une fois, à la première fin. */
      const sansEmail = async (pourquoi: string): Promise<void> => {
        if (a.premiereFin) await deps.option.alerter(`Option Crédit WhatsApp ${a.abonnementId} de l'espace ${a.tenantId} : ${pourquoi}, à prévenir à la main si besoin.`);
      };
      // L'ÉTAT des lignes après l'arrêt (lot C, jaunes 2 et 4) : il décide l'e-mail, pas ce que CET appel a arrêté. Un rejeu
      // après une panne (la fin déjà écrite) et deux traitements de la même fin (l'`updated` impayé et le `deleted` qu'il
      // déclenche) le perdaient ; la réservation par abonnement le garde unique.
      const lignes = seule ? await deps.option.lignes(a.tenantId) : [];
      const arret = arretDesLignes(lignes);
      if (!arret.parLOption) {
        // Une ligne posée à la main encore active (un essai forcé) : l'e-mail dirait tout arrêté, il ne part pas, et Julien
        // prévient le client (décision du 2026-11-09).
        if (!arret.toutes && lignes.some((l) => l.origine === 'option' && l.arreteeLe !== null)) {
          await sansEmail('une ligne posée à la main reste active : aucun e-mail au client');
        }
        return;
      }
      // L'arrêt dit au client (lot C, moment 3) : toutes ses lignes arrêtées, l'une de l'option, aucune autre option
      // vivante. Jamais une fin de droit (la raison en base, même quand la formule y redonne droit depuis) ni une option
      // payée sans droit, que l'avis `deleted` de notre propre résiliation peut amener ici d'abord. Et seulement à son
      // MOMENT (relecture du lot C5, jaune 4) : décidé à chaque passage, un `updated` tardif sur l'abonnement résilié (une
      // métadonnée retouchée, un événement renvoyé) l'envoyait des semaines après, à un admin arrivé depuis compris.
      if (a.finRaison === 'fin_de_droit' || maintenant() - (a.finiLe ?? fin).getTime() > FENETRE_ARRET_JOURS * JOUR_MS) return;
      // La prise de l'option ouverte (jaune 5 du lot C) : jamais « reprenez l'option » à un Pro en retard ou dont la fin
      // programmée est passée, ni à une Entreprise.
      if (!(await deps.option.repriseOuverte(a.tenantId))) return;
      // Hors vente, « reprenez l'option » serait faux (relecture du lot C5, jaune 5 ; décision de Julien du 2026-11-09).
      if (!deps.option.enVente()) {
        await sansEmail('l’option n’est plus en vente : aucun e-mail au client (il dirait « reprenez l’option »)');
        return;
      }
      await deps.option.prevenirArret(a.tenantId, a.abonnementId);
    };
    /**
     * Une facture payée d'une option finie est-elle à rembourser ? Seulement réglée APRÈS la fin chez nous (une facture restée
     * ouverte après la résiliation d'un impayé, payée à la main) ; réglée avant, elle paie un mois entamé, sans remboursement
     * (une fin de droit), ou c'est la première facture d'une option payée sans droit, dont la fin de droit a déjà dit le
     * remboursement à décider (relecture des derniers jaunes d'avant la vente, jaune 1). Une fin ou un paiement inconnus :
     * à rembourser, Julien vérifie.
     */
    const aRembourser = async (abonnementId: string, facture: FacturePayee | null): Promise<boolean> => {
      if (facture === null || facture.centimes <= 0) return false;
      const finiLe = await deps.option.finieLe(abonnementId);
      return finiLe === null || facture.payeLe === null || facture.payeLe.getTime() > finiLe.getTime();
    };
    /**
     * Enregistre l'option relue chez Stripe. `facture` : la facture payée qui a mené ici (le chemin d'une facture), `null`
     * sinon.
     */
    const enregistrer = async (tenantId: string, abonnementId: string, periodeFin: Date | null, facture: FacturePayee | null = null): Promise<void> => {
      const lien = lienTableauStripe('subscriptions', abonnementId, e.livemode);
      const lu = await deps.option.chezStripe(abonnementId);
      // Rien de relu (l'option pas en vente dans cette copie, ou un refus durable) : rien n'est inventé, mais un paiement
      // reçu sans option enregistrée se dit (relecture du lot 4a, jaune 3 : il était acquitté sans trace).
      if (lu === null) {
        await deps.option.alerter(`Option Crédit WhatsApp ${abonnementId} payée par l'espace ${tenantId}, mais rien n'a pu être relu chez Stripe (le prix de l'option absent de cette copie, ou un refus durable) : elle n'est PAS enregistrée, à vérifier. ${lien}`);
        return;
      }
      if (lu.statut !== 'active' && lu.statut !== 'past_due') {
        // Une facture réglée sur un abonnement que Stripe dit fini (une facture restée ouverte après notre résiliation d'un
        // impayé, payée à la main) : de l'argent reçu pour rien, qui passait sans trace (relecture des jaunes d'avant la
        // vente, jaune 3). Pas encore payée (`incomplete`), sans facture : aucune place n'existe, rien à dire.
        if (facture !== null && (await aRembourser(abonnementId, facture))) {
          await deps.option.alerter(`Facture de ${(facture.centimes / 100).toFixed(2).replace('.', ',')} € payée pour l'option Crédit WhatsApp ${abonnementId} de l'espace ${tenantId}, que Stripe dit ${lu.statut} : à rembourser. ${lien}`);
        }
        return;
      }
      const places = await borner(lu.places, abonnementId);
      if (places === null) return;
      let issue: Awaited<ReturnType<typeof deps.option.enregistrer>>;
      try {
        issue = await deps.option.enregistrer({ tenantId, abonnementId, livemode: e.livemode, places, periodeFin, finPrevueLe: lu.finPrevueLe });
      } catch (err) {
        // Un espace supprimé peut encore être facturé : la clé étrangère ne guérira pas au rejeu, alerte et acquittement.
        if (!espaceDisparu(err)) throw err;
        journaliser('error', 'stripe_option_wa_espace_disparu', { tenantId, abonnement: abonnementId, livemode: e.livemode });
        await deps.option.alerter(`L'espace supprimé ${tenantId} paie encore son option Crédit WhatsApp ${abonnementId} : à résilier chez Stripe. ${lienTableauStripe('subscriptions', abonnementId, e.livemode)}`);
        return;
      }
      if (issue.etat === 'enregistre') {
        // 🔴 Une option payée sans offre qui y donne droit (un Checkout ouvert pendant l'essai du Pro et réglé après sa fin :
        // la session vit 24 h) se résilie au lieu de relancer ses lignes (relecture des jaunes d'avant la vente, jaune 1).
        // La fin de droit dit tout, une fois par espace (son verrou) : résiliée et relue, l'e-mail aux admins, sans promesse,
        // et l'alerte à Julien, « remboursement à décider » ; sinon, à vérifier, la consigne à Julien de les prévenir
        // (relecture des derniers jaunes d'avant la vente, jaunes 1 et 6 ; du correctif de l'e-mail sans droit, 1 à 3).
        const droit = await deps.option.finDeDroit(issue.tenantId, 'payee_sans_droit');
        if (droit !== 'garde_son_droit') return;
        // Une option reprise (jaunes 4 et 6 de la relecture du lot 4a) : les lignes que la fin de la précédente avait
        // arrêtées envoient de nouveau, et les campagnes en pause faute de ligne active repartent. 🔴 Sur TOUT
        // enregistrement, rejeu compris (jaune 2 des jaunes d'avant la vente) : une relance interrompue après l'insertion
        // se refait au rejeu de Stripe, alors que l'option n'est plus neuve. Sans danger : une option vivante n'a aucune
        // ligne arrêtée par une fin d'option.
        const relancees = await deps.option.relancerLesLignes(issue.tenantId);
        await deps.option.reprendreCampagnes(issue.tenantId);
        if (issue.nouveau) {
          // Sans ligne à relancer, c'est une ligne à POSER, dans le délai que les cartes promettent au client (lot B).
          const suite = relancees > 0
            ? `, ${relancees} ligne${relancees > 1 ? 's' : ''} relancée${relancees > 1 ? 's' : ''}`
            : ' : ligne à poser sous 24 h ouvrées';
          await deps.option.alerter(`Nouvelle option Crédit WhatsApp : espace ${issue.tenantId} (${abonnementId}), ${places} numéro${places > 1 ? 's' : ''}${suite}.`);
        }
      } else if (issue.etat === 'doublon') {
        await deps.option.alerter(`Option Crédit WhatsApp en double : ${abonnementId} pour l'espace ${tenantId}, qui en a déjà une vivante. À annuler et rembourser chez Stripe.`);
      } else if (issue.etat === 'fini') {
        // Finie chez nous, vivante chez Stripe (une résiliation à la main restée à faire) : le client paie pour rien, ses
        // lignes restant arrêtées (jaune 3 : elle passait sans trace). « Facturée » seulement venue d'une facture, et « à
        // rembourser » seulement réglée après la fin chez nous (`aRembourser`).
        const facturee = facture !== null ? ` et l'a facturée` : '';
        const rembourser = (await aRembourser(abonnementId, facture)) ? ', et la facture à rembourser' : '';
        await deps.option.alerter(`Option Crédit WhatsApp ${abonnementId} de l'espace ${tenantId} : finie chez nous, mais Stripe la dit ${lu.statut}${facturee}. À résilier chez Stripe${rembourser}. ${lien}`);
      }
    };

    if (e.type === 'checkout.session.completed') {
      const lu = sessionOptionSchema.safeParse(e.objet);
      if (!lu.success) return illisible(e, 'option');
      if (lu.data.payment_status !== 'paid' && lu.data.payment_status !== 'no_payment_required') return ACQUITTE;
      await enregistrer(lu.data.metadata.tenant_id, idDe(lu.data.subscription), null);
      return ACQUITTE;
    }

    if (e.type === 'customer.subscription.deleted') {
      const lu = abonnementOptionSchema.safeParse(e.objet);
      if (!lu.success) return illisible(e, 'option');
      await finir(lu.data.id, raisonDeLaFin(lu.data.cancellation_details?.reason), lu.data.ended_at ? new Date(lu.data.ended_at * 1000) : new Date(maintenant()));
      return ACQUITTE;
    }

    if (e.type === 'customer.subscription.updated') {
      const lu = abonnementOptionSchema.safeParse(e.objet);
      if (!lu.success) return illisible(e, 'option');
      const relu = await deps.option.chezStripe(lu.data.id);
      if (relu === null) return ACQUITTE;
      // Stripe abandonne ses relances en marquant l'abonnement impayé (selon le réglage du compte) : c'est la fin. Un
      // `unpaid` reste vivant chez Stripe, qui le prélèverait au règlement d'une facture en retard alors que ses lignes sont
      // arrêtées : il est résilié d'abord (jaune 3), une panne passagère faisant rejouer l'événement.
      if (relu.statut === 'unpaid' || relu.statut === 'canceled' || relu.statut === 'incomplete_expired') {
        if (relu.statut === 'unpaid') await deps.option.resilier(lu.data.id);
        await finir(lu.data.id, relu.statut === 'unpaid' ? 'impaye' : 'resiliation', new Date(maintenant()));
        return ACQUITTE;
      }
      if (relu.statut !== 'active' && relu.statut !== 'past_due') return ACQUITTE;
      const places = await borner(relu.places, lu.data.id);
      if (places === null) return ACQUITTE;
      // Une option encore inconnue (sa session pas encore traitée) : la modification l'enregistre.
      const notee = await deps.option.noterPlaces(lu.data.id, places, relu.finPrevueLe);
      if (notee === null) {
        await enregistrer(lu.data.metadata.tenant_id, lu.data.id, null);
      } else {
        // Des places en plus (une place payée au portail ou après un prorata réglé) : une campagne d'un numéro qui y tient
        // désormais repart (jaune 6) ; celle d'un numéro encore dehors retourne en pause au premier envoi.
        await deps.option.reprendreCampagnes(notee.tenantId);
      }
      return ACQUITTE;
    }

    const lu = factureSchema.safeParse(e.objet);
    const details = lu.success ? lu.data.parent?.subscription_details : null;
    const meta = metaOptionSchema.safeParse(details?.metadata ?? {});
    if (!lu.success || !details || !meta.success) return illisible(e, 'option');
    const abonnementId = idDe(details.subscription);
    const fins = (lu.data.lines?.data ?? []).map((l) => l.period?.end).filter((v): v is number => typeof v === 'number');
    const finFacture = fins.length > 0 ? new Date(Math.max(...fins) * 1000) : null;
    if (e.type === 'invoice.payment_failed') {
      // Le prorata d'une place refusé : l'ajout attendait ce paiement et n'est pas appliqué, l'option reste à jour.
      if (lu.data.billing_reason === 'subscription_update') return ACQUITTE;
      const a = await deps.option.majStatut(abonnementId, 'en_retard', null, finFacture);
      if (a) {
        await deps.option.alerter(`Renouvellement de l'option Crédit WhatsApp échoué : espace ${a.tenantId} (${a.abonnementId}). Stripe réessaie ; ses numéros envoient jusqu'à ce qu'il abandonne.`);
        if (a.statut === 'en_retard') await deps.paiementRefuse({ tenantId: a.tenantId, offre: 'option_credit_whatsapp', factureId: lu.data.id });
      }
      return ACQUITTE;
    }
    // Une facture payée : le renouvellement, ou le prorata d'une place (le changement en attente s'applique alors). Les
    // places se relisent ; une facture arrivée avant la session suffit à enregistrer l'option.
    const paye = await deps.option.majStatut(abonnementId, 'actif', finFacture);
    if (paye === null) {
      // Inconnue (la facture avant la session) ou finie chez nous : le montant voyage, une facture réglée pour une option
      // que Stripe dit finie se dit.
      const payeLe = lu.data.status_transitions?.paid_at;
      await enregistrer(meta.data.tenant_id, abonnementId, finFacture, { centimes: lu.data.amount_paid ?? 0, payeLe: typeof payeLe === 'number' ? new Date(payeLe * 1000) : null });
      return ACQUITTE;
    }
    const relu = await deps.option.chezStripe(abonnementId);
    const places = relu === null ? null : await borner(relu.places, abonnementId);
    if (relu !== null && places !== null && (await deps.option.noterPlaces(abonnementId, places, relu.finPrevueLe)) !== null) {
      // Le prorata d'une place réglé applique l'ajout en attente : les campagnes en pause faute de place repartent (jaune 6).
      await deps.option.reprendreCampagnes(paye.tenantId);
    }
    return ACQUITTE;
  }

  async function traiter(e: EvenementStripeVerifie): Promise<IssueTraitementAbonnement> {
    if (!concerne(e)) return NON_ABONNEMENT;
    // Le Pro est aiguillé en premier, puis l'option ; un objet marqué ne tombe jamais dans le chemin du numéro, qui
    // acquitte en silence ce qu'il ne reconnaît pas.
    if (objetDuPro(e.type, e.objet)) return traiterPro(e);
    if (objetDeLOption(e.type, e.objet)) return traiterOption(e);
    return traiterNumero(e);
  }

  return { concerne, traiter };
}
