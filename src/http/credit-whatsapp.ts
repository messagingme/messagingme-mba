import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { gardeEtendue, type Guard, type PreHandler } from '../auth/middleware';
import { espaceVerifie } from './scope';
import { corpsDuRefus } from '../lib/issue';
import { ouvrirAchatCreditWhatsapp, type AchatPermis, type DepsAchatWhatsapp } from '../stripe/achat-whatsapp';
import { htCentimesWhatsapp, OFFRES_WHATSAPP, type OffreWhatsapp } from '../stripe/offres-whatsapp';
import { prixMessage, type CategorieMeta, type GrilleMeta } from '../credit-whatsapp/grille';
import { FRANCHISE_SERVICE_PAR_NUMERO, type ConditionsCredit } from '../credit-whatsapp/garde';
import type { LigneHistoriqueWa } from '../credit-whatsapp/credit';
import type { PointDeCredit } from '../lib/serie-credit';
import type { LigneCredit } from '../credit-whatsapp/lignes.pg';
import type { StatutOption } from '../credit-whatsapp/options.pg';
import { changerPlaces, ouvrirOption, PRIX_OPTION_WA_HT_CENTIMES, PLACES_OPTION_MAX, type DepsOptionCredit } from '../stripe/option-credit-whatsapp';
import { etatLigneCredit } from '../credit-whatsapp/etat-ligne';

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
  /**
   * Ce que lit l'onglet : le solde, la consommation du mois, l'historique, la grille en vigueur, les conditions et les
   * lignes de l'espace.
   */
  vue: {
    solde(tenantId: string): Promise<number>;
    consommationDuMois(tenantId: string): Promise<number>;
    historique(tenantId: string): Promise<LigneHistoriqueWa[]>;
    /** La courbe de 90 jours : le solde de fin de jour et la consommation du jour (`PgCreditWhatsappStore.serie`). */
    serie(tenantId: string): Promise<PointDeCredit[]>;
    grille(): Promise<GrilleMeta | null>;
    conditions(tenantId: string): Promise<ConditionsCredit>;
    lignes(tenantId: string): Promise<readonly LigneCredit[]>;
  };
  /** L'option du Crédit WhatsApp (lot 4a) : la prendre, changer ses places, et ce que l'onglet en montre. */
  option: DepsOptionCredit;
}

/** Ce que l'onglet lit. Montants en micro-euros ; un prix se montre commission comprise, JAMAIS son taux. */
export interface VueCreditWhatsapp {
  /**
   * Toute Entreprise (décision du 2026-11-02) : son Crédit WhatsApp est illimité, facturé au contrat. L'onglet montre
   * « Illimité » et la consommation du mois à la place du solde, qui ne bouge pas, et rien à acheter.
   */
  illimite: boolean;
  soldeMicroEur: number;
  /** Ce qu'ont consommé les messages ILLIMITÉS du mois de Paris : ce qui se facture à une Entreprise ; 0 pour un prépayé. */
  consommationDuMoisMicroEur: number;
  /** Le prix d'un message en France par catégorie, commission comprise ; `null` sans grille de Meta en vigueur. */
  prixFrance: Array<{ categorie: CategorieMeta; prixMicroEur: number }> | null;
  /** Les messages de service offerts par Meta, par numéro et par mois. */
  franchiseServiceParNumero: number;
  achat: { disponible: boolean; permis: AchatPermis; offres: Array<{ offre: OffreWhatsapp; htCentimes: number }> };
  /** Toutes les lignes de l'espace sont arrêtées : plus rien ne part, recharger n'y changerait rien. */
  ligneArretee: boolean;
  historique: LigneHistoriqueWa[];
  /**
   * La courbe des 90 derniers jours (lot C) : la console trace le solde de fin de jour d'un prépayé, la consommation du
   * jour d'une Entreprise (dont le solde ne bouge pas).
   */
  serie: PointDeCredit[];
  /**
   * L'option (lot 4a, 30 € HT par numéro et par mois) : en vente ou non pour cet espace (un Pro ou un Business, le prix
   * posé), ses places payées et les numéros que ses lignes couvrent, son statut et sa fin programmée.
   */
  option: {
    disponible: boolean;
    prixHtCentimes: number;
    placesMax: number;
    places: number;
    couverts: number;
    statut: StatutOption | null;
    finPrevueLe: string | null;
    /**
     * La formule de l'espace est payée, par la MÊME règle que la prise de l'option (`formulePayee`, révision du
     * 2026-11-04) : faux pendant un essai, Pro comme Business, et hors d'eux. L'onglet explique alors l'essai au lieu de
     * vendre une option que la prise refuserait.
     */
    formulePayee: boolean;
  };
}

/** `origine` (lot B) : depuis les cartes « Qui règle Meta ? », le retour de Stripe ramène sur Connecter WhatsApp. */
const CORPS_OPTION = z.object({ places: z.number().int(), origine: z.enum(['offre', 'connecter']).optional() }).strict();
const CORPS_PLACES = z.object({ depuis: z.number().int(), cible: z.number().int() }).strict();

export function registerCreditWhatsapp(
  app: FastifyInstance, deps: CreditWhatsappRouteDeps, gardeLecture: Guard, garde: Guard, limiteCouteuse: PreHandler,
): void {
  // Admin (la garde) et plafond coûteux : chaque clic crée des objets chez Stripe.
  const couteux = gardeEtendue(garde, limiteCouteuse);

  /**
   * L'état pour les cartes « Qui règle Meta ? » de Connecter WhatsApp et de l'Accueil (révision du 2026-11-04, lot B) :
   * une lecture légère, sans l'historique ni la courbe de l'onglet. Tout membre la lit ; seul un administrateur agit.
   * `enVente` : l'option se prend en ligne (son prix posé, un Pro ou un Business) ; sinon la carte est grisée.
   */
  app.get('/tenants/:tenantId/credit-whatsapp/etat', { preHandler: gardeLecture }, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const o = deps.option;
    const [etat, offre] = await Promise.all([
      etatLigneCredit({
        offre: (t) => o.offre(t), formulePayee: (t) => o.formulePayee(t), lignes: (t) => deps.vue.lignes(t),
        option: (t) => o.options.vivante(t),
      }, tenant),
      o.offre(tenant),
    ]);
    const enVente = o.stripe !== null && o.prixOption !== '' && (offre === 'pro' || offre === 'business');
    return reply.code(200).send({ etat, enVente });
  });

  /** L'onglet : tout membre le lit (un agent y voit le solde et qui peut recharger), seul un administrateur achète. */
  app.get('/tenants/:tenantId/credit-whatsapp', { preHandler: gardeLecture }, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const [soldeMicroEur, consommationDuMoisMicroEur, historique, grille, conditions, lignes, permis, serie, offre, option, couverts] = await Promise.all([
      deps.vue.solde(tenant), deps.vue.consommationDuMois(tenant), deps.vue.historique(tenant), deps.vue.grille(),
      deps.vue.conditions(tenant), deps.vue.lignes(tenant), deps.achat.achatPermis(tenant), deps.vue.serie(tenant),
      deps.option.offre(tenant), deps.option.options.vivante(tenant), deps.option.numerosCouverts(tenant),
    ]);
    const prixFrance = grille === null ? null : CATEGORIES_AFFICHEES.flatMap((categorie) => {
      const prix = prixMessage(grille, 'FR', categorie, conditions.commissionPct);
      return prix === null ? [] : [{ categorie, prixMicroEur: prix }];
    });
    const formulePayee = (offre === 'pro' || offre === 'business') && await deps.option.formulePayee(tenant);
    const s = deps.achat.stripe;
    const vue: VueCreditWhatsapp = {
      illimite: conditions.openBar,
      soldeMicroEur,
      consommationDuMoisMicroEur,
      prixFrance,
      franchiseServiceParNumero: FRANCHISE_SERVICE_PAR_NUMERO,
      achat: {
        disponible: s !== null && OFFRES_WHATSAPP.every((o) => s.prix[o] !== ''),
        permis,
        offres: OFFRES_WHATSAPP.map((offre) => ({ offre, htCentimes: htCentimesWhatsapp(offre) })),
      },
      ligneArretee: lignes.length > 0 && lignes.every((l) => l.arreteeLe !== null),
      historique,
      serie,
      option: {
        disponible: deps.option.stripe !== null && deps.option.prixOption !== '' && (offre === 'pro' || offre === 'business'),
        prixHtCentimes: PRIX_OPTION_WA_HT_CENTIMES,
        placesMax: PLACES_OPTION_MAX,
        places: option?.places ?? 0,
        couverts,
        statut: option?.statut ?? null,
        finPrevueLe: option?.finPrevueLe?.toISOString() ?? null,
        formulePayee,
      },
    };
    return reply.code(200).send(vue);
  });

  /** Prendre l'option pour `places` numéros : une session Checkout d'abonnement, dont la console suit l'adresse. */
  app.post('/tenants/:tenantId/credit-whatsapp/option', couteux, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const c = CORPS_OPTION.safeParse(req.body);
    if (!c.success) return reply.code(400).send({ error: 'corps invalide : places (un entier) est attendu', code: 'corps_invalide' });
    const r = await ouvrirOption(deps.option, tenant, c.data.places, req.auth?.userId ?? '', c.data.origine ?? 'offre');
    if (!r.ok) return reply.code(r.statut).send(corpsDuRefus(r));
    return reply.code(200).send({ url: r.valeur.url });
  });

  /**
   * Changer les places de l'option : de `depuis` (ce que l'écran a lu) à `cible`. Un ajout se paie avant de compter, un
   * retrait ne passe pas sous les numéros couverts.
   */
  app.patch('/tenants/:tenantId/credit-whatsapp/option', couteux, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const c = CORPS_PLACES.safeParse(req.body);
    if (!c.success) return reply.code(400).send({ error: 'corps invalide : depuis et cible (des entiers) sont attendus', code: 'corps_invalide' });
    const r = await changerPlaces(deps.option, tenant, c.data, req.auth?.userId ?? '');
    if (!r.ok) return reply.code(r.statut).send(corpsDuRefus(r));
    return reply.code(200).send({ places: r.valeur.places });
  });

  /** Ouvre une session Checkout pour une offre (`wa_50` à `wa_500`) et rend son adresse ; la console y redirige. */
  app.post('/tenants/:tenantId/credit-whatsapp/achat', couteux, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const r = await ouvrirAchatCreditWhatsapp(deps.achat, tenant, req.body, req.auth?.userId ?? '', 'console');
    if (!r.ok) return reply.code(r.statut).send(corpsDuRefus(r));
    return reply.code(200).send({ url: r.valeur.url });
  });
}
