import type { FastifyInstance } from 'fastify';
import { gardeEtendue, type Guard, type PreHandler } from '../auth/middleware';
import { espaceVerifie } from './scope';
import { corpsDuRefus } from '../lib/issue';
import { ouvrirAchatCreditWhatsapp, type AchatPermis, type DepsAchatWhatsapp } from '../stripe/achat-whatsapp';
import { htCentimesWhatsapp, OFFRES_WHATSAPP, type OffreWhatsapp } from '../stripe/offres-whatsapp';
import { prixMessage, type CategorieMeta, type GrilleMeta } from '../credit-whatsapp/grille';
import { FRANCHISE_SERVICE_PAR_NUMERO, type ConditionsCredit } from '../credit-whatsapp/garde';
import type { LigneHistoriqueWa } from '../credit-whatsapp/credit';
import type { LigneCredit } from '../credit-whatsapp/lignes.pg';

/**
 * LE CRÉDIT WHATSAPP D'UN ESPACE (plan du Crédit WhatsApp, tâches 10 et 11) : l'achat par Stripe et ce que montre l'onglet
 * de la page Offre. Un module d'espace, donc fermé à la formule Free sans rien écrire (`MODULES_OUVERTS_AU_FREE`) : la
 * Free n'a jamais de Crédit WhatsApp.
 *
 * 🔴 LE RETOUR DE LA PAGE DE PAIEMENT NE CRÉDITE RIEN : seul le webhook signé par Stripe crédite (`traitement-recharge.ts`).
 */

/** Les catégories dont l'onglet donne le prix en France, dans l'ordre de l'écran. */
const CATEGORIES_AFFICHEES: readonly CategorieMeta[] = ['marketing', 'utility', 'authentication', 'service'];

export interface CreditWhatsappRouteDeps {
  /** L'ouverture d'un achat : les MÊMES objets que l'outil MCP `buy_credit` reçoit. */
  achat: DepsAchatWhatsapp;
  /** Ce que lit l'onglet : le solde, l'historique, la grille en vigueur, les conditions et les lignes de l'espace. */
  vue: {
    solde(tenantId: string): Promise<number>;
    historique(tenantId: string): Promise<LigneHistoriqueWa[]>;
    grille(): Promise<GrilleMeta | null>;
    conditions(tenantId: string): Promise<ConditionsCredit>;
    lignes(tenantId: string): Promise<readonly LigneCredit[]>;
  };
}

/** Ce que l'onglet lit. Montants en micro-euros ; un prix se montre commission comprise, JAMAIS son taux. */
export interface VueCreditWhatsapp {
  soldeMicroEur: number;
  /** Le prix d'un message en France par catégorie, commission comprise ; `null` sans grille de Meta en vigueur. */
  prixFrance: Array<{ categorie: CategorieMeta; prixMicroEur: number }> | null;
  /** Les messages de service offerts par Meta, par numéro et par mois. */
  franchiseServiceParNumero: number;
  achat: { disponible: boolean; permis: AchatPermis; offres: Array<{ offre: OffreWhatsapp; htCentimes: number }> };
  /** Toutes les lignes de l'espace sont arrêtées : plus rien ne part, recharger n'y changerait rien. */
  ligneArretee: boolean;
  historique: LigneHistoriqueWa[];
}

export function registerCreditWhatsapp(
  app: FastifyInstance, deps: CreditWhatsappRouteDeps, gardeLecture: Guard, garde: Guard, limiteCouteuse: PreHandler,
): void {
  // Admin (la garde) et plafond coûteux : chaque clic crée des objets chez Stripe.
  const couteux = gardeEtendue(garde, limiteCouteuse);

  /** L'onglet : tout membre le lit (un agent y voit le solde et qui peut recharger), seul un administrateur achète. */
  app.get('/tenants/:tenantId/credit-whatsapp', { preHandler: gardeLecture }, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const [soldeMicroEur, historique, grille, conditions, lignes, permis] = await Promise.all([
      deps.vue.solde(tenant), deps.vue.historique(tenant), deps.vue.grille(), deps.vue.conditions(tenant), deps.vue.lignes(tenant),
      deps.achat.achatPermis(tenant),
    ]);
    const prixFrance = grille === null ? null : CATEGORIES_AFFICHEES.flatMap((categorie) => {
      const prix = prixMessage(grille, 'FR', categorie, conditions.commissionPct);
      return prix === null ? [] : [{ categorie, prixMicroEur: prix }];
    });
    const s = deps.achat.stripe;
    const vue: VueCreditWhatsapp = {
      soldeMicroEur,
      prixFrance,
      franchiseServiceParNumero: FRANCHISE_SERVICE_PAR_NUMERO,
      achat: {
        disponible: s !== null && OFFRES_WHATSAPP.every((o) => s.prix[o] !== ''),
        permis,
        offres: OFFRES_WHATSAPP.map((offre) => ({ offre, htCentimes: htCentimesWhatsapp(offre) })),
      },
      ligneArretee: lignes.length > 0 && lignes.every((l) => l.arreteeLe !== null),
      historique,
    };
    return reply.code(200).send(vue);
  });

  /** Ouvre une session Checkout pour une offre (`wa_50` à `wa_500`) et rend son adresse ; la console y redirige. */
  app.post('/tenants/:tenantId/credit-whatsapp/achat', couteux, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const r = await ouvrirAchatCreditWhatsapp(deps.achat, tenant, req.body, req.auth?.userId ?? '', 'console');
    if (!r.ok) return reply.code(r.statut).send(corpsDuRefus(r));
    return reply.code(200).send({ url: r.valeur.url });
  });
}
