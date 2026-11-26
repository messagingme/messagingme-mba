import type { Pool } from 'pg';

/**
 * LES PACKS DE CONTACTS DU BUSINESS (lot B du plan `2026-11-26-contacts-packs-business-et-alertes-entreprise.md`, migration
 * 0329) : l'abonnement Stripe à part, 20 € HT par mois et par pack de 1 000 contacts, dont la quantité est le nombre de
 * packs. Le Business, posé dans `/ops` et facturé hors Stripe, n'a pas d'abonnement à lui : ses packs en ont un, sur le
 * modèle de l'option Ligne de crédit (`src/credit-whatsapp/options.pg.ts`).
 *
 * 🔴 Les packs sont ceux que Stripe a RELUS payés, jamais ceux qu'on lui a demandés : un ajout dont la facture échoue ne
 * compte pas. Un abonnement en retard (Stripe relance) garde ses packs ; il ne finit qu'à l'annonce de Stripe, au retrait
 * du dernier pack, ou à la fin du Business (sa fin de droit). Lus par `PgOffresStore.offreDe` et par la porte de l'espace
 * plein (`PgContactStore.inconnusRefuses`), qui les ajoutent à la limite du Business (`droitsDe`).
 */
export type StatutPacks = 'actif' | 'en_retard' | 'resilie';
export type RaisonFinPacks = 'resiliation' | 'impaye' | 'fin_de_droit';

export interface PacksBusiness {
  abonnementId: string;
  tenantId: string;
  livemode: boolean;
  statut: StatutPacks;
  packs: number;
  periodeFin: Date | null;
  finiLe: Date | null;
  finRaison: RaisonFinPacks | null;
}

/** `fini` : l'abonnement est déjà fini chez nous (un rejeu tardif) ; `doublon` : un AUTRE abonnement vivant tient l'espace. */
export type IssueEnregistrementPacks =
  | { etat: 'enregistre'; tenantId: string; nouveau: boolean }
  | { etat: 'fini' }
  | { etat: 'doublon' };

interface Ligne {
  stripe_subscription_id: string;
  tenant_id: string;
  livemode: boolean;
  statut: StatutPacks;
  packs: number;
  periode_fin: Date | null;
  fini_le: Date | null;
  fin_raison: RaisonFinPacks | null;
}
const COLONNES = 'stripe_subscription_id, tenant_id, livemode, statut, packs, periode_fin, fini_le, fin_raison';
const versPacks = (l: Ligne): PacksBusiness => ({
  abonnementId: l.stripe_subscription_id, tenantId: l.tenant_id, livemode: l.livemode, statut: l.statut, packs: l.packs,
  periodeFin: l.periode_fin, finiLe: l.fini_le, finRaison: l.fin_raison,
});

/** Le prédicat des packs qui comptent : l'abonnement vivant de l'espace, en retard compris. La lecture de l'offre le reprend. */
export const PACKS_BUSINESS_VIVANTS_SQL = (espace: string): string =>
  `(select p.packs from packs_contacts_business p where p.tenant_id = ${espace} and p.fini_le is null)`;

export class PgPacksBusinessStore {
  constructor(private readonly pool: Pool) {}

  /**
   * L'abonnement payé (la session Checkout confirmée, ou une facture payée arrivée avant) : enregistré avec les packs
   * relus chez Stripe. Rejoué : la fin de période ne recule jamais, et un abonnement fini le reste. `nouveau` dit si la
   * ligne vient d'être créée (l'alerte ne part qu'une fois).
   */
  async enregistrer(a: { tenantId: string; abonnementId: string; livemode: boolean; packs: number; periodeFin: Date | null }): Promise<IssueEnregistrementPacks> {
    for (let essai = 0; ; essai += 1) {
      try {
        return await this.enregistrerUneFois(a);
      } catch (err) {
        const e = err as { code?: unknown; constraint?: unknown };
        if (e.code !== '23505' || e.constraint !== 'packs_contacts_business_un_vivant_par_espace') throw err;
        // La session et la première facture du MÊME abonnement arrivent ensemble : l'index d'espace peut refuser la seconde
        // avant que la clé primaire ne la voie. Si CET abonnement est déjà là, un seul nouvel essai, par la mise à jour ;
        // sinon, un AUTRE abonnement vivant tient l'espace.
        if (essai > 0 || !(await this.existe(a.abonnementId))) return { etat: 'doublon' };
      }
    }
  }

  private async existe(abonnementId: string): Promise<boolean> {
    const res = await this.pool.query('select 1 from packs_contacts_business where stripe_subscription_id = $1', [abonnementId]);
    return (res.rowCount ?? 0) > 0;
  }

  private async enregistrerUneFois(a: {
    tenantId: string; abonnementId: string; livemode: boolean; packs: number; periodeFin: Date | null;
  }): Promise<IssueEnregistrementPacks> {
    const res = await this.pool.query<{ tenant_id: string; fini_le: Date | null; nouveau: boolean }>(
      `insert into packs_contacts_business (stripe_subscription_id, tenant_id, livemode, statut, packs, periode_fin)
       values ($1, $2, $3, 'actif', $4, $5)
       on conflict (stripe_subscription_id) do update
         set packs = case when packs_contacts_business.fini_le is null then excluded.packs else packs_contacts_business.packs end,
             periode_fin = greatest(packs_contacts_business.periode_fin, excluded.periode_fin),
             maj_le = now()
       returning tenant_id, fini_le, (xmax = 0) as nouveau`,
      [a.abonnementId, a.tenantId, a.livemode, a.packs, a.periodeFin],
    );
    const l = res.rows[0]!;
    if (l.fini_le !== null) return { etat: 'fini' };
    // L'espace de la ligne, jamais celui de l'événement rejoué : un abonnement appartient à son premier espace.
    return { etat: 'enregistre', tenantId: l.tenant_id, nouveau: l.nouveau };
  }

  /**
   * Un renouvellement payé ou un échec : le statut et la fin de période (qui ne recule jamais). Un abonnement fini ne change
   * plus. 🔴 `finFactureEchouee` : un échec dont la période est DÉJÀ payée est un rejeu arrivé après le paiement (Stripe ne
   * garantit pas l'ordre) : rien n'est écrit, `null` comme pour un abonnement inconnu.
   */
  async majStatut(
    abonnementId: string, statut: 'actif' | 'en_retard', periodeFin: Date | null, finFactureEchouee: Date | null = null,
  ): Promise<PacksBusiness | null> {
    const res = await this.pool.query<Ligne>(
      `update packs_contacts_business
          set statut = $2, periode_fin = greatest(periode_fin, $3), maj_le = now()
        where stripe_subscription_id = $1 and fini_le is null
          and not ($2 = 'en_retard' and $4::timestamptz is not null and periode_fin is not null and periode_fin >= $4::timestamptz)
        returning ${COLONNES}`,
      [abonnementId, statut, periodeFin, finFactureEchouee],
    );
    return res.rows[0] ? versPacks(res.rows[0]) : null;
  }

  /** Les packs RELUS chez Stripe (la route après un ajout ou un retrait, `customer.subscription.updated`, une facture payée). */
  async noterPacks(abonnementId: string, packs: number): Promise<PacksBusiness | null> {
    const res = await this.pool.query<Ligne>(
      `update packs_contacts_business set packs = $2, maj_le = now()
        where stripe_subscription_id = $1 and fini_le is null
        returning ${COLONNES}`,
      [abonnementId, packs],
    );
    return res.rows[0] ? versPacks(res.rows[0]) : null;
  }

  /**
   * La fin effective (`customer.subscription.deleted`, le retrait du dernier pack, ou la fin de droit qui le résilie) :
   * datée et raisonnée UNE fois, un rejeu ne déplace ni la date ni la raison. `premiereFin` dit si CET appel l'a finie, lu
   * sur l'écriture elle-même (`fini_le is null` dans le WHERE), comme `PgOptionsCreditStore.finir`.
   */
  async finir(abonnementId: string, raison: RaisonFinPacks, finiLe: Date): Promise<(PacksBusiness & { premiereFin: boolean }) | null> {
    const premiere = await this.pool.query<Ligne>(
      `update packs_contacts_business set statut = 'resilie', fini_le = $3, fin_raison = $2, maj_le = now()
        where stripe_subscription_id = $1 and fini_le is null
        returning ${COLONNES}`,
      [abonnementId, raison, finiLe],
    );
    if (premiere.rows[0]) return { ...versPacks(premiere.rows[0]), premiereFin: true };
    const deja = await this.pool.query<Ligne>(`select ${COLONNES} from packs_contacts_business where stripe_subscription_id = $1`, [abonnementId]);
    return deja.rows[0] ? { ...versPacks(deja.rows[0]), premiereFin: false } : null;
  }

  /** L'abonnement vivant des packs de l'espace (en cours ou en retard), `null` sans packs. */
  async vivant(tenantId: string): Promise<PacksBusiness | null> {
    const res = await this.pool.query<Ligne>(
      `select ${COLONNES} from packs_contacts_business where tenant_id = $1 and fini_le is null`,
      [tenantId],
    );
    return res.rows[0] ? versPacks(res.rows[0]) : null;
  }
}
