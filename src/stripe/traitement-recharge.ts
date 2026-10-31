import { z } from 'zod';
import { journaliser } from '../lib/journal';
import { lienTableauStripe } from './liens';
import { creditDeLOffre, definitionOffre, OFFRES_RECHARGE } from './offres';
import { creditDeLOffreWhatsapp, htCentimesWhatsapp, OFFRES_WHATSAPP, PRODUIT_CREDIT_WHATSAPP } from './offres-whatsapp';
import type { IssuePaiement, PaiementStripe } from './store.pg';
import type { EvenementStripeVerifie } from './traitement-abonnements';

/**
 * Le traitement des événements Stripe qui créditent une recharge du crédit IA (audit de structure du 2026-10-25, lot C
 * du plan `docs/superpowers/plans/2026-10-26-audits-simplicite-structure.md`), sur le modèle de
 * `traitement-abonnements.ts`. La route garde le protocole HTTP (signature, enveloppe, mode et aiguillage) ; ce module
 * lit la session Checkout, vérifie qu'elle est une de nos recharges, payée, au bon montant, et crédite. Les pannes
 * inattendues remontent : Stripe doit alors rejouer l'événement.
 */

export interface DepsTraitementRecharge {
  paiements: {
    crediterPaiement(p: PaiementStripe): Promise<IssuePaiement>;
    /** L'achat du Crédit WhatsApp : même ligne de paiement, crédit au Crédit WhatsApp (`PgStripeStore`). */
    crediterPaiementWhatsapp(p: PaiementStripe): Promise<IssuePaiement>;
  };
  /**
   * Après un crédit du Crédit WhatsApp : reprendre les campagnes en pause faute de crédit (`leverPausesCreditWhatsapp`).
   * JAMAIS `apresCredit` : le plafond de la clé de modèle ne regarde que le crédit IA. Pas attendu, un échec se journalise
   * (le balayage horaire de secours rattrape).
   */
  apresCreditWhatsapp(tenantId: string): Promise<void>;
  /**
   * Après un crédit : remonter le plafond de la clé de modèle de l'espace (`remonterPlafondApresRecharge`, qui
   * recalcule la cible depuis le solde : le montant de CE crédit ne lui sert pas). Le traitement ne l'attend pas (le
   * câblage le fait suivre par l'arrêt propre du processus) ; un échec est journalisé et ne change pas l'issue : le
   * crédit est écrit.
   */
  apresCredit(tenantId: string): Promise<void>;
  /** L'alerte d'exploitation : de l'argent encaissé sans crédit, à traiter à la main. */
  alerter(texte: string): Promise<void>;
}

/**
 * `illisible` : une session créditante qu'on ne sait pas lire, de l'argent encaissé sans crédit, donc un rejeu à
 * demander. `acquitte` : tout le reste, crédité ou non ; `credite` absent quand l'événement n'était pas une de nos
 * recharges réglées (la réponse ne le dit alors pas).
 */
export type IssueTraitementRecharge =
  | { issue: 'non_recharge' }
  | { issue: 'illisible' }
  | { issue: 'acquitte'; credite?: boolean };

/** Les deux événements qui créditent. */
const EVENEMENTS_CREDITANTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

/** Ce qu'on lit d'une session Checkout, et rien de plus (`safeParse`, les autres champs sont ignorés). */
const sessionSchema = z.object({
  id: z.string().min(1),
  mode: z.string(),
  payment_status: z.string(),
  amount_subtotal: z.number().int().nullable(),
  amount_total: z.number().int().nullable(),
  currency: z.string().nullable(),
  client_reference_id: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
  // Un identifiant, ou l'objet facture si l'événement l'a déplié.
  invoice: z.union([z.string(), z.object({ id: z.string() })]).nullable().optional(),
});

/** NOS métadonnées. Une session qui ne les porte pas n'est pas une recharge : le compte vend peut-être autre chose. */
const metadonneesSchema = z.object({
  tenant_id: z.uuid(),
  offre: z.enum(OFFRES_RECHARGE),
});

/** Nos métadonnées avec une offre quelconque : ce qui distingue une recharge d'une offre inconnue d'une vente étrangère. */
const notreRechargeSchema = z.object({
  tenant_id: z.uuid(),
  offre: z.string().min(1),
});

/** Les métadonnées d'un achat du Crédit WhatsApp (`ouvrirAchatCreditWhatsapp`). */
const metadonneesWhatsappSchema = z.object({
  tenant_id: z.uuid(),
  offre: z.enum(OFFRES_WHATSAPP),
  produit: z.literal(PRODUIT_CREDIT_WHATSAPP),
});

const ACQUITTE = { issue: 'acquitte' } as const;
const NON_CREDITE = { issue: 'acquitte', credite: false } as const;

export function creerTraitementRecharge(deps: DepsTraitementRecharge) {
  function concerne(e: Pick<EvenementStripeVerifie, 'type'>): boolean {
    return EVENEMENTS_CREDITANTS.has(e.type);
  }

  async function traiter(e: EvenementStripeVerifie): Promise<IssueTraitementRecharge> {
    if (!concerne(e)) return { issue: 'non_recharge' };

    const lue = sessionSchema.safeParse(e.objet);
    if (!lue.success) {
      journaliser('error', 'stripe_session_illisible', { evenement: e.id, type: e.type });
      return { issue: 'illisible' };
    }
    const session = lue.data;
    const meta = metadonneesSchema.safeParse(session.metadata ?? {});
    // Paiement différé pas encore arrivé : `async_payment_succeeded` viendra. `no_payment_required` est une session
    // réglée à zéro par un code promo à 100 % : elle crédite, comme un paiement.
    const reglee = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    const facture = session.invoice === undefined || session.invoice === null
      ? null
      : typeof session.invoice === 'string' ? session.invoice : session.invoice.id;
    const lienFacture = facture === null ? '' : ` ${lienTableauStripe('invoices', facture, e.livemode)}`;
    // Pas une de nos recharges : acquittée sans effet, sinon Stripe rejouerait un événement qui ne nous concerne pas.
    if (session.mode !== 'payment') return ACQUITTE;
    // 🔴 Le PRODUIT d'abord (plan du Crédit WhatsApp, tâche 10) : un achat du Crédit WhatsApp ne crédite JAMAIS le crédit
    // IA, et un produit que cette version ne connaît pas alerte au lieu d'être pris pour une recharge.
    const produit = session.metadata?.produit;
    if (produit !== undefined) {
      if (produit === PRODUIT_CREDIT_WHATSAPP) return traiterCreditWhatsapp(e, session, facture, lienFacture);
      const notre = notreRechargeSchema.safeParse(session.metadata ?? {});
      if (notre.success && reglee) {
        journaliser('error', 'stripe_produit_inconnu', { evenement: e.id, session: session.id, tenantId: notre.data.tenant_id, produit: produit.slice(0, 40) });
        await deps.alerter(`Paiement réglé pour un produit que cette version ne connaît pas (${produit.slice(0, 40)}) : espace ${notre.data.tenant_id}, session ${session.id}, rien n'a été crédité. Revenir à une version qui le connaît, puis renvoyer l'événement depuis Stripe ; sinon rembourser.${lienFacture}`);
        return NON_CREDITE;
      }
      return ACQUITTE;
    }
    if (!meta.success) {
      // 🔴 NOS métadonnées avec une offre que cette version ne connaît pas (une image revenue en arrière sous une session
      // ouverte par une plus récente) : de l'argent encaissé sans crédit, qui partait en 200 sans trace (relecture du
      // 2026-10-22). Toujours acquittée : un rejeu qui créditerait après un crédit fait à la main paierait deux fois.
      const notre = notreRechargeSchema.safeParse(session.metadata ?? {});
      if (notre.success && reglee) {
        const { tenant_id: espace, offre: inconnue } = notre.data;
        journaliser('error', 'stripe_offre_inconnue', { evenement: e.id, session: session.id, tenantId: espace, offre: inconnue.slice(0, 40) });
        // La voie sûre est nommée : un crédit fait à la main n'écrit aucune ligne de paiement, et un événement renvoyé
        // ensuite par une version qui connaît l'offre créditerait la session une seconde fois.
        const encaisse = session.payment_status === 'paid' ? 'payée' : 'réglée à zéro par un code promo, rien encaissé';
        await deps.alerter(`Recharge ${encaisse}, pour une offre que cette version ne connaît pas (${inconnue.slice(0, 40)}) : espace ${espace}, session ${session.id}, rien n'a été crédité. Pour créditer : revenir à une version qui connaît l'offre, puis renvoyer l'événement depuis Stripe (un seul crédit par session). Sinon rembourser ; ne jamais créditer à la main puis renvoyer.${lienFacture}`);
        return NON_CREDITE;
      }
      return ACQUITTE;
    }
    if (!reglee) return ACQUITTE;

    // 🔴 L'offre des métadonnées doit correspondre au prix HT de la ligne, en euros, pour cet espace.
    // `amount_subtotal` est le prix avant remise : un code promo ne change pas le crédit, qui reste plein.
    const { tenant_id: tenantId, offre } = meta.data;
    const attendu = definitionOffre(offre).htCentimes;
    const reference = session.client_reference_id ?? null;
    if (session.currency !== 'eur' || session.amount_subtotal !== attendu || (reference !== null && reference !== tenantId)) {
      journaliser('error', 'stripe_paiement_incoherent', {
        evenement: e.id, session: session.id, tenantId, offre, attenduCentimes: attendu,
        payeCentimes: session.amount_subtotal, devise: session.currency,
        referenceConcorde: reference === null || reference === tenantId,
      });
      return NON_CREDITE;
    }

    // Une transaction : la ligne de paiement (idempotence), le crédit, le mouvement `achat`. Une panne de base lève, et
    // Stripe rejoue.
    const issue = await deps.paiements.crediterPaiement({
      sessionId: session.id,
      tenantId,
      offre,
      creditMicroEur: creditDeLOffre(offre),
      htCentimes: attendu,
      ttcCentimes: session.amount_total,
      factureId: facture,
      livemode: e.livemode,
    });
    if (issue === 'espace_inconnu') {
      journaliser('error', 'stripe_paiement_espace_inconnu', { evenement: e.id, session: session.id, tenantId });
      // Un espace supprimé depuis l'ouverture du paiement : de l'argent encaissé sans crédit, à rembourser.
      await deps.alerter(`Recharge payée pour un espace inexistant (supprimé ?) ${tenantId} : session ${session.id}, à rembourser chez Stripe.${lienFacture}`);
      return NON_CREDITE;
    }
    if (issue === 'credite') {
      // Après la transaction et sans faire attendre Stripe. Un échec se journalise : le crédit est écrit et le plafond
      // rattrapera au mouvement suivant.
      deps.apresCredit(tenantId).catch((err: unknown) => {
        journaliser('error', 'stripe_plafond_non_remonte', { tenantId, err });
      });
    }
    return { issue: 'acquitte', credite: issue === 'credite' };
  }

  /**
   * L'achat du Crédit WhatsApp. Plus strict que la recharge sur un point : il faut un paiement ENCAISSÉ (`paid`), au moins
   * du montant hors taxe de l'offre. Les codes promo y sont fermés, donc une session réglée à zéro ou remisée n'est pas
   * la nôtre : elle alerte et ne crédite rien (de vrais messages, payés au partenaire).
   */
  async function traiterCreditWhatsapp(
    e: EvenementStripeVerifie, session: z.infer<typeof sessionSchema>, facture: string | null, lienFacture: string,
  ): Promise<IssueTraitementRecharge> {
    const meta = metadonneesWhatsappSchema.safeParse(session.metadata ?? {});
    const payee = session.payment_status === 'paid';
    if (!meta.success) {
      // Notre produit, une offre que cette version ne connaît pas : une alerte, aucun crédit, comme pour la recharge.
      const notre = notreRechargeSchema.safeParse(session.metadata ?? {});
      if (notre.success && (payee || session.payment_status === 'no_payment_required')) {
        journaliser('error', 'stripe_offre_inconnue', { evenement: e.id, session: session.id, tenantId: notre.data.tenant_id, offre: notre.data.offre.slice(0, 40), produit: PRODUIT_CREDIT_WHATSAPP });
        await deps.alerter(`Achat du Crédit WhatsApp réglé pour une offre que cette version ne connaît pas (${notre.data.offre.slice(0, 40)}) : espace ${notre.data.tenant_id}, session ${session.id}, rien n'a été crédité. Revenir à une version qui la connaît, puis renvoyer l'événement depuis Stripe ; sinon rembourser.${lienFacture}`);
        return NON_CREDITE;
      }
      return ACQUITTE;
    }
    const { tenant_id: tenantId, offre } = meta.data;
    // Paiement différé pas encore arrivé : `async_payment_succeeded` viendra.
    if (session.payment_status === 'unpaid') return ACQUITTE;
    const attendu = htCentimesWhatsapp(offre);
    const reference = session.client_reference_id ?? null;
    if (!payee || session.currency !== 'eur' || session.amount_subtotal !== attendu
      || session.amount_total === null || session.amount_total < attendu || (reference !== null && reference !== tenantId)) {
      journaliser('error', 'stripe_paiement_incoherent', {
        evenement: e.id, session: session.id, tenantId, offre, produit: PRODUIT_CREDIT_WHATSAPP, statut: session.payment_status,
        attenduCentimes: attendu, payeCentimes: session.amount_subtotal, totalCentimes: session.amount_total, devise: session.currency,
        referenceConcorde: reference === null || reference === tenantId,
      });
      await deps.alerter(`Achat du Crédit WhatsApp NON crédité, paiement incohérent avec l'offre ${offre} (statut ${session.payment_status}, ${session.amount_subtotal ?? '?'} centimes HT, total ${session.amount_total ?? '?'}, devise ${session.currency ?? '?'}) : espace ${tenantId}, session ${session.id}. Vérifier chez Stripe, puis créditer ou rembourser.${lienFacture}`);
      return NON_CREDITE;
    }

    const issue = await deps.paiements.crediterPaiementWhatsapp({
      sessionId: session.id,
      tenantId,
      offre,
      creditMicroEur: creditDeLOffreWhatsapp(offre),
      htCentimes: attendu,
      ttcCentimes: session.amount_total,
      factureId: facture,
      livemode: e.livemode,
    });
    if (issue === 'espace_inconnu') {
      journaliser('error', 'stripe_paiement_espace_inconnu', { evenement: e.id, session: session.id, tenantId, produit: PRODUIT_CREDIT_WHATSAPP });
      await deps.alerter(`Achat du Crédit WhatsApp payé pour un espace inexistant (supprimé ?) ${tenantId} : session ${session.id}, à rembourser chez Stripe.${lienFacture}`);
      return NON_CREDITE;
    }
    if (issue === 'credite') {
      deps.apresCreditWhatsapp(tenantId).catch((err: unknown) => {
        journaliser('error', 'credit_whatsapp_reprise_apres_achat', { tenantId, err });
      });
    }
    return { issue: 'acquitte', credite: issue === 'credite' };
  }

  return { concerne, traiter };
}
