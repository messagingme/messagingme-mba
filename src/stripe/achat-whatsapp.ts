import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { creerClientStripe, creerSessionCheckout, lirePrixStripe, StripeError, type TransportStripe } from './client';
import { htCentimesWhatsapp, OFFRES_WHATSAPP, PRODUIT_CREDIT_WHATSAPP, type OffreWhatsapp } from './offres-whatsapp';
import type { DepsPaiement, RetourPaiement } from './paiement';
import { journaliser } from '../lib/journal';
import { refus, type Issue } from '../lib/issue';

/**
 * OUVRIR L'ACHAT DU CRÉDIT WHATSAPP (plan du Crédit WhatsApp, tâche 10), sur le modèle de `ouvrirPaiement` (crédit IA) :
 * une offre fermée, le prix relu chez Stripe avant tout, une ADRESSE rendue, et seul le webhook signé crédite.
 *
 * Trois différences, toutes voulues :
 *  - 🔴 les codes promo sont FERMÉS : un code à 100 % offrirait de vrais messages, payés au partenaire de la ligne ;
 *  - l'achat n'est permis qu'à un espace qui a au moins un numéro ACTIF sur la ligne, hors formule Free et hors open bar
 *    de l'Entreprise (qui paie après coup) : sans ligne, le crédit ne servirait à rien ;
 *  - la session porte `metadata[produit] = credit_whatsapp`, que le webhook lit AVANT la recharge du crédit IA.
 */

/** Stripe configuré pour cet achat. `null`, ou une offre sans prix : achat pas encore disponible (503). */
export interface StripeWhatsapp {
  cle: string;
  livemode: boolean;
  /** L'identifiant Stripe du prix de chaque offre (`STRIPE_PRIX_WA_*`, tous ou aucun). */
  prix: Readonly<Record<OffreWhatsapp, string>>;
  transport: TransportStripe;
  /** La page Offre de la console : Stripe y renvoie un achat ouvert depuis l'onglet Crédit WhatsApp. */
  pageOffre: string;
  /** La page publique « paiement reçu », où revient un achat ouvert depuis Claude (`buy_credit`). */
  pageClaude: string;
}

/** Ce que l'espace peut faire de cet achat. */
export type AchatPermis = 'ok' | 'free' | 'open_bar' | 'sans_ligne';

export interface DepsAchatWhatsapp extends Pick<DepsPaiement, 'clients' | 'payeurAutorise'> {
  stripe: StripeWhatsapp | null;
  /** Free, open bar, aucun numéro actif sur la ligne, ou permis. Lu à chaque ouverture. */
  achatPermis(tenantId: string): Promise<AchatPermis>;
}

/** Le corps ne porte qu'une offre, jamais un montant. Exporté : l'outil MCP annonce les offres d'ici. */
export const saisieAchatWhatsapp = z.object({ offre: z.enum(OFFRES_WHATSAPP) });

export const ACHAT_WHATSAPP_INDISPONIBLE = refus(503, 'achat du Crédit WhatsApp pas encore disponible', { code: 'credit_whatsapp_indisponible' });

const REFUS_PERMIS: Readonly<Record<Exclude<AchatPermis, 'ok'>, ReturnType<typeof refus>>> = {
  free: refus(403, 'Le Crédit WhatsApp n’est pas proposé en formule Free.', { code: 'credit_whatsapp_hors_offre' }),
  open_bar: refus(409, 'Vos messages WhatsApp sont facturés après coup (open bar) : il n’y a rien à acheter.', { code: 'credit_whatsapp_open_bar' }),
  sans_ligne: refus(409, 'Aucun de vos numéros n’est sur la ligne de crédit : le Crédit WhatsApp ne vous servirait pas.', { code: 'credit_whatsapp_sans_ligne' }),
};

export interface AchatOuvert {
  url: string;
  htCentimes: number;
}

/**
 * Ouvre une session Checkout pour une offre du Crédit WhatsApp. `payeur` est l'utilisateur de la session (console) ou la
 * personne du jeton (MCP), jamais une valeur du corps. Toute erreur de Stripe devient un refus 422 : son message part au
 * journal, pas à l'appelant.
 */
export async function ouvrirAchatCreditWhatsapp(
  deps: DepsAchatWhatsapp, tenantId: string, corps: unknown, payeur: string, retour: RetourPaiement,
): Promise<Issue<AchatOuvert>> {
  const lu = saisieAchatWhatsapp.safeParse(corps ?? {});
  if (!lu.success) return refus(400, `offre inconnue (${OFFRES_WHATSAPP.join(', ')})`);
  const offre = lu.data.offre;
  const s = deps.stripe;
  if (s === null || s.prix[offre] === '') return ACHAT_WHATSAPP_INDISPONIBLE;
  if (!(await deps.payeurAutorise(payeur))) return ACHAT_WHATSAPP_INDISPONIBLE;
  const permis = await deps.achatPermis(tenantId);
  if (permis !== 'ok') return REFUS_PERMIS[permis];

  try {
    // 🔴 Le prix configuré est relu chez Stripe AVANT tout, comme pour le crédit IA : euros, hors taxe, au montant de
    // l'offre, sinon le webhook refuserait de créditer un paiement encaissé.
    const attendu = htCentimesWhatsapp(offre);
    const prix = await lirePrixStripe(s.transport, { cle: s.cle, prix: s.prix[offre] });
    if (prix.montantCentimes !== attendu || prix.devise !== 'eur' || prix.taxe !== 'exclusive') {
      journaliser('error', 'stripe_prix_incoherent', {
        tenantId, offre, prix: s.prix[offre], attenduCentimes: attendu, luCentimes: prix.montantCentimes, devise: prix.devise, taxe: prix.taxe,
      });
      return refus(422,
        'L’achat du Crédit WhatsApp est momentanément indisponible : son tarif est en cours de correction. Réessayez plus tard, ou contactez-nous.',
        { code: 'prix_incoherent' });
    }

    let client = await deps.clients.clientDe(tenantId, s.livemode);
    if (client === null) {
      const cree = await creerClientStripe(s.transport, { cle: s.cle, tenantId });
      client = await deps.clients.retenirClient(tenantId, s.livemode, cree);
    }
    const session = await creerSessionCheckout(s.transport, {
      cle: s.cle,
      tenantId,
      offre,
      prix: s.prix[offre],
      customerId: client,
      produit: PRODUIT_CREDIT_WHATSAPP,
      codesPromo: false,
      urlSucces: retour === 'claude' ? `${s.pageClaude}?produit=${PRODUIT_CREDIT_WHATSAPP}` : `${s.pageOffre}?tab=whatsapp&paiement=recu`,
      urlAbandon: retour === 'claude' ? `${s.pageClaude}?produit=${PRODUIT_CREDIT_WHATSAPP}&abonnement=abandon` : `${s.pageOffre}?tab=whatsapp&paiement=abandon`,
      idempotence: `session-wa-${tenantId}-${randomUUID()}`,
    });
    return { ok: true, valeur: { url: session.url, htCentimes: attendu } };
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    journaliser('error', 'stripe_paiement_impossible', {
      tenantId, offre, operation: err.operation, status: err.status, type: err.type, code: err.code, err: err.message,
    });
    return refus(422, 'Le paiement n’a pas pu être préparé. Réessayez dans un instant ; si cela persiste, contactez-nous.',
      { code: 'paiement_impossible' });
  }
}
