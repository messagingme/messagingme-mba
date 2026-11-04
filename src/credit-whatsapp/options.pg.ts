import type { Pool } from 'pg';

/**
 * L'OPTION DU CRÉDIT WHATSAPP D'UN ESPACE (lot 4a du plan `2026-11-03-credit-whatsapp-lot-4.md`, migration 0276) :
 * l'abonnement Stripe à 30 € HT par numéro et par mois, dont la quantité est le nombre de PLACES. Une place est un numéro
 * couvert par une ligne `'option'` de l'espace (décision de Julien du 2026-11-03) ; au-delà, la garde refuse les envois.
 *
 * Écrit par le seul webhook signé, sur le modèle d'`abonnements_offre` (`src/offres/abonnements-offre.pg.ts`). 🔴 Les places
 * sont celles que Stripe a RELUES payées, jamais celles qu'on lui a demandées : un ajout dont la facture échoue ne compte
 * pas. Une option en retard (Stripe relance) garde ses places ; elle ne finit qu'à l'annonce de Stripe.
 */
export type StatutOption = 'actif' | 'en_retard' | 'resilie';
export type RaisonFinOption = 'resiliation' | 'impaye' | 'fin_de_droit';

export interface OptionCredit {
  abonnementId: string;
  tenantId: string;
  livemode: boolean;
  statut: StatutOption;
  places: number;
  periodeFin: Date | null;
  /** La fin programmée dans le portail de Stripe, dite au client ; `null` : aucune. */
  finPrevueLe: Date | null;
  finiLe: Date | null;
  finRaison: RaisonFinOption | null;
}

/** `fini` : l'abonnement est déjà fini chez nous (un rejeu tardif) ; `doublon` : une AUTRE option vivante tient l'espace. */
export type IssueEnregistrementOption =
  | { etat: 'enregistre'; tenantId: string; nouveau: boolean }
  | { etat: 'fini' }
  | { etat: 'doublon' };

interface Ligne {
  stripe_subscription_id: string;
  tenant_id: string;
  livemode: boolean;
  statut: StatutOption;
  places: number;
  periode_fin: Date | null;
  fin_prevue_le: Date | null;
  fini_le: Date | null;
  fin_raison: RaisonFinOption | null;
}
const COLONNES = 'stripe_subscription_id, tenant_id, livemode, statut, places, periode_fin, fin_prevue_le, fini_le, fin_raison';
const versOption = (l: Ligne): OptionCredit => ({
  abonnementId: l.stripe_subscription_id, tenantId: l.tenant_id, livemode: l.livemode, statut: l.statut, places: l.places,
  periodeFin: l.periode_fin, finPrevueLe: l.fin_prevue_le, finiLe: l.fini_le, finRaison: l.fin_raison,
});

export class PgOptionsCreditStore {
  constructor(private readonly pool: Pool) {}

  /**
   * L'option payée (la session Checkout confirmée, ou une facture payée arrivée avant) : enregistrée avec les places
   * relues chez Stripe. Rejoué : la fin de période ne recule jamais, et une option finie le reste. `nouveau` dit si la
   * ligne vient d'être créée (l'alerte ne part qu'une fois).
   */
  async enregistrer(a: {
    tenantId: string; abonnementId: string; livemode: boolean; places: number; periodeFin: Date | null; finPrevueLe?: Date | null;
  }): Promise<IssueEnregistrementOption> {
    for (let essai = 0; ; essai += 1) {
      try {
        return await this.enregistrerUneFois(a);
      } catch (err) {
        const e = err as { code?: unknown; constraint?: unknown };
        if (e.code !== '23505' || e.constraint !== 'options_credit_whatsapp_une_vivante_par_espace') throw err;
        // La session et la première facture du MÊME abonnement arrivent ensemble : l'index d'espace peut refuser la
        // seconde avant que la clé primaire ne la voie (le même cas que le Pro). Si CET abonnement est déjà là, un seul
        // nouvel essai, par la mise à jour ; sinon, une AUTRE option vivante tient l'espace.
        if (essai > 0 || !(await this.existe(a.abonnementId))) return { etat: 'doublon' };
      }
    }
  }

  private async existe(abonnementId: string): Promise<boolean> {
    const res = await this.pool.query('select 1 from options_credit_whatsapp where stripe_subscription_id = $1', [abonnementId]);
    return (res.rowCount ?? 0) > 0;
  }

  private async enregistrerUneFois(a: {
    tenantId: string; abonnementId: string; livemode: boolean; places: number; periodeFin: Date | null; finPrevueLe?: Date | null;
  }): Promise<IssueEnregistrementOption> {
    const res = await this.pool.query<{ tenant_id: string; fini_le: Date | null; nouveau: boolean }>(
      `insert into options_credit_whatsapp (stripe_subscription_id, tenant_id, livemode, statut, places, periode_fin, fin_prevue_le)
       values ($1, $2, $3, 'actif', $4, $5, $6)
       on conflict (stripe_subscription_id) do update
         set places = case when options_credit_whatsapp.fini_le is null then excluded.places else options_credit_whatsapp.places end,
             periode_fin = greatest(options_credit_whatsapp.periode_fin, excluded.periode_fin),
             fin_prevue_le = case when options_credit_whatsapp.fini_le is null then excluded.fin_prevue_le else options_credit_whatsapp.fin_prevue_le end,
             maj_le = now()
       returning tenant_id, fini_le, (xmax = 0) as nouveau`,
      [a.abonnementId, a.tenantId, a.livemode, a.places, a.periodeFin, a.finPrevueLe ?? null],
    );
    const l = res.rows[0]!;
    if (l.fini_le !== null) return { etat: 'fini' };
    // L'espace de la ligne, jamais celui de l'événement rejoué : un abonnement appartient à son premier espace.
    return { etat: 'enregistre', tenantId: l.tenant_id, nouveau: l.nouveau };
  }

  /**
   * Un renouvellement payé ou un échec : le statut et la fin de période (qui ne recule jamais). Une option finie ne change
   * plus. 🔴 `finFactureEchouee` : un échec dont la période est DÉJÀ payée est un rejeu arrivé après le paiement (Stripe ne
   * garantit pas l'ordre) : rien n'est écrit, `null` comme pour une option inconnue.
   */
  async majStatut(
    abonnementId: string, statut: 'actif' | 'en_retard', periodeFin: Date | null, finFactureEchouee: Date | null = null,
  ): Promise<OptionCredit | null> {
    const res = await this.pool.query<Ligne>(
      `update options_credit_whatsapp
          set statut = $2, periode_fin = greatest(periode_fin, $3), maj_le = now()
        where stripe_subscription_id = $1 and fini_le is null
          and not ($2 = 'en_retard' and $4::timestamptz is not null and periode_fin is not null and periode_fin >= $4::timestamptz)
        returning ${COLONNES}`,
      [abonnementId, statut, periodeFin, finFactureEchouee],
    );
    return res.rows[0] ? versOption(res.rows[0]) : null;
  }

  /** Les places et la fin programmée RELUES chez Stripe (`customer.subscription.updated`, un changement de places). */
  async noterPlaces(abonnementId: string, places: number, finPrevueLe: Date | null): Promise<OptionCredit | null> {
    const res = await this.pool.query<Ligne>(
      `update options_credit_whatsapp set places = $2, fin_prevue_le = $3, maj_le = now()
        where stripe_subscription_id = $1 and fini_le is null
        returning ${COLONNES}`,
      [abonnementId, places, finPrevueLe],
    );
    return res.rows[0] ? versOption(res.rows[0]) : null;
  }

  /**
   * La fin effective (`customer.subscription.deleted`, ou la fin de droit qui la résilie) : datée et raisonnée UNE fois, un
   * rejeu ne déplace ni la date ni la raison. `premiereFin` dit si CET appel l'a finie : un rejeu n'arrête pas deux fois
   * les lignes et ne réalerte pas.
   *
   * 🔴 La première fin se lit sur l'écriture elle-même (`fini_le is null` dans le WHERE), pas sur un état « d'avant » :
   * une CTE `for update` lue dans le `returning` n'est évaluée qu'après l'`update` du même ordre, et ne rend plus aucune
   * ligne (la ligne vient d'être changée par cet ordre) ; `premiereFin` valait alors toujours vrai (la CI d'intégration
   * du 2026-11-04). Deux fins concurrentes : la seconde attend le verrou de ligne, puis réévalue son WHERE sur la ligne
   * finie et n'écrit rien ; elle relit la ligne, `premiereFin` faux.
   */
  async finir(abonnementId: string, raison: RaisonFinOption, finiLe: Date): Promise<(OptionCredit & { premiereFin: boolean }) | null> {
    const premiere = await this.pool.query<Ligne>(
      `update options_credit_whatsapp set statut = 'resilie', fini_le = $3, fin_raison = $2, maj_le = now()
        where stripe_subscription_id = $1 and fini_le is null
        returning ${COLONNES}`,
      [abonnementId, raison, finiLe],
    );
    if (premiere.rows[0]) return { ...versOption(premiere.rows[0]), premiereFin: true };
    const deja = await this.pool.query<Ligne>(`select ${COLONNES} from options_credit_whatsapp where stripe_subscription_id = $1`, [abonnementId]);
    return deja.rows[0] ? { ...versOption(deja.rows[0]), premiereFin: false } : null;
  }

  /**
   * Le moment où l'option a fini chez nous, `null` si elle vit encore ou n'est pas connue : une facture réglée APRÈS ce
   * moment est à rembourser, réglée avant elle payait un mois entamé (`aRembourser` du webhook).
   */
  async finieLe(abonnementId: string): Promise<Date | null> {
    const res = await this.pool.query<{ fini_le: Date | null }>(
      'select fini_le from options_credit_whatsapp where stripe_subscription_id = $1',
      [abonnementId],
    );
    return res.rows[0]?.fini_le ?? null;
  }

  /** L'option vivante de l'espace (en cours ou en retard), `null` sans option. */
  async vivante(tenantId: string): Promise<OptionCredit | null> {
    const res = await this.pool.query<Ligne>(
      `select ${COLONNES} from options_credit_whatsapp where tenant_id = $1 and fini_le is null`,
      [tenantId],
    );
    return res.rows[0] ? versOption(res.rows[0]) : null;
  }

  /** Les places payées de l'espace : celles de son option vivante, en retard comprise (Stripe relance encore) ; 0 sinon. */
  async placesPayees(tenantId: string): Promise<number> {
    return (await this.vivante(tenantId))?.places ?? 0;
  }
}
