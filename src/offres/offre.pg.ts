import type { Pool } from 'pg';
import { enTransaction } from '../db/transaction';
import { ficheComptee } from '../crm/contact-store.pg';
import { contactsToutesOrigines, droitsDe, type Droits, type Offre } from './offres';
import { SOLDE_REPRISE_CREDIT_MICRO_EUR } from '../../web/lib/partage/credit-whatsapp';

/**
 * L'OFFRE D'UN ESPACE (lot 6, spec `docs/superpowers/specs/2026-10-07-offres-et-limites-design.md`, § 3).
 *
 * 🔴 UNE SEULE DÉFINITION, EN SQL : `offre_de_l_espace` (migration 0218). Ce store la lit, les balayages qui dépendent
 * de l'offre (l'analyse, la purge des conversations) l'appellent dans leur requête. Une seconde définition en TypeScript
 * finirait par diverger de celle des balayages. La lecture passe par `OffresEnCache` (`src/offres/cache.ts`).
 */
export interface OffreEspace {
  offre: Offre;
  droits: Droits;
  /** La fin effective du dernier Pro d'un espace revenu en Base (le gel, le délai de la conservation) ; `null` sinon. */
  retourEnBaseLe: Date | null;
  /**
   * Le Pro vivant (livraison 7) : ses sièges payés, déjà comptés dans `droits`, et sa formule, qui fixe le prix du siège
   * suivant. `null` ou absent hors Pro.
   */
  pro?: { sieges: number; periodicite: 'mois' | 'an' } | null;
}

export interface SourceOffres {
  offreDe(tenantId: string): Promise<OffreEspace>;
}

const OFFRES: ReadonlySet<string> = new Set<Offre>(['base', 'pro', 'business', 'entreprise']);

export class PgOffresStore implements SourceOffres {
  constructor(private readonly pool: Pool) {}

  /** Un espace inconnu est en Base : la fonction SQL le dit aussi. */
  async offreDe(tenantId: string): Promise<OffreEspace> {
    const r = await this.pool.query<{
      offre: string; entreprise_utilisateurs: number | null; entreprise_contacts: number | null;
      entreprise_commission_pct: number | null; conservation: number | null; dernier_fini: Date | null;
      sieges: number | null; periodicite: 'mois' | 'an' | null; business_utilisateurs: number | null;
    }>(
      `select offre_de_l_espace($1::uuid) as offre,
              (select t.entreprise_utilisateurs from tenants t where t.id = $1::uuid) as entreprise_utilisateurs,
              (select t.business_utilisateurs from tenants t where t.id = $1::uuid) as business_utilisateurs,
              (select t.entreprise_contacts from tenants t where t.id = $1::uuid) as entreprise_contacts,
              (select t.entreprise_commission_pct from tenants t where t.id = $1::uuid) as entreprise_commission_pct,
              (select s.conversation_retention_days from tenant_settings s where s.tenant_id = $1::uuid) as conservation,
              (select max(a.fini_le) from abonnements_offre a where a.tenant_id = $1::uuid) as dernier_fini,
              (select a.sieges from abonnements_offre a where a.tenant_id = $1::uuid and a.fini_le is null) as sieges,
              (select a.periodicite from abonnements_offre a where a.tenant_id = $1::uuid and a.fini_le is null) as periodicite`,
      [tenantId],
    );
    const l = r.rows[0];
    const offre: Offre = l && OFFRES.has(l.offre) ? (l.offre as Offre) : 'base';
    // Les sièges ne comptent qu'en Pro : une Entreprise qui garde un Pro vivant a ses propres limites (/ops).
    const pro = offre === 'pro' && l?.periodicite ? { sieges: l.sieges ?? 0, periodicite: l.periodicite } : null;
    return {
      offre,
      droits: droitsDe(offre, offre === 'entreprise'
        ? {
          utilisateurs: l?.entreprise_utilisateurs ?? null, conservationJours: l?.conservation ?? null,
          contacts: l?.entreprise_contacts ?? null, commissionPct: l?.entreprise_commission_pct ?? null,
        }
        // Le Business ne prend de /ops que sa limite d'utilisateurs (`droitsDe`) : vide, les 5 de la grille.
        : offre === 'business' ? { utilisateurs: l?.business_utilisateurs ?? null, conservationJours: null } : null, pro?.sieges ?? 0),
      retourEnBaseLe: offre === 'base' ? (l?.dernier_fini ?? null) : null,
      pro,
    };
  }

  /**
   * Ce que l'espace a consommé de ses limites, en une requête : les fiches que la limite de contacts compte (toutes les
   * fiches actives en Free, les créées ailleurs : `contactsToutesOrigines`, sur l'offre lue par la seule définition), les
   * automations allumées du client (aucun propriétaire), les membres actifs (invitations en attente comprises). Les mêmes
   * comptes que les gardes (`PgContactStore.verifierPlaceContacts`, dont le prédicat est importé, `src/offres/automations.ts`,
   * `src/offres/membres.ts`) ; ce que voient la console et `get_plan`, et ce que lisent les courriels de franchissement.
   */
  async usage(tenantId: string): Promise<{ contacts: number; automations: number; membres: number }> {
    const r = await this.pool.query<{ offre: string; toutes_origines: number; creees: number; automations: number; membres: number }>(
      `select offre_de_l_espace($1::uuid) as offre,
              (select count(*) from contacts c where c.tenant_id = $1::uuid and ${ficheComptee('c', true)})::int as toutes_origines,
              (select count(*) from contacts c where c.tenant_id = $1::uuid and ${ficheComptee('c', false)})::int as creees,
              (select count(*) from automations a where a.tenant_id = $1::uuid and a.enabled and a.possede_par is null)::int as automations,
              (select count(*) from users u where u.tenant_id = $1::uuid and u.disabled_at is null)::int as membres`,
      [tenantId],
    );
    const l = r.rows[0];
    if (!l) return { contacts: 0, automations: 0, membres: 0 };
    // Une offre inconnue se lit comme la Base, comme dans `offreDe`.
    const offre: Offre = OFFRES.has(l.offre) ? (l.offre as Offre) : 'base';
    return { contacts: contactsToutesOrigines(offre) ? l.toutes_origines : l.creees, automations: l.automations, membres: l.membres };
  }

  /**
   * L'offre posée à la main d'un espace telle que l'exploitation l'a réglée (l'Entreprise, et depuis le 2026-10-27 le
   * Business), `null` pour un espace inconnu.
   */
  async lireEntreprise(tenantId: string): Promise<ReglageEntreprise | null> {
    const r = await this.pool.query<{
      offre_entreprise: boolean; entreprise_utilisateurs: number | null; conversation_retention_days: number | null;
      entreprise_contacts: number | null; entreprise_commission_pct: number | null;
      offre_business: boolean; business_utilisateurs: number | null; offre_business_essai_fin_le: Date | null;
      entreprise_commission_messages_pct: number | null; entreprise_plafond_ia_micro_eur: string | null;
    }>(
      `select t.offre_entreprise, t.entreprise_utilisateurs, s.conversation_retention_days,
              t.entreprise_contacts, t.entreprise_commission_pct, t.offre_business, t.business_utilisateurs,
              t.offre_business_essai_fin_le, t.entreprise_commission_messages_pct, t.entreprise_plafond_ia_micro_eur
         from tenants t left join tenant_settings s on s.tenant_id = t.id
        where t.id = $1`,
      [tenantId],
    );
    const l = r.rows[0];
    return l
      ? {
        entreprise: l.offre_entreprise, utilisateurs: l.entreprise_utilisateurs, conservationJours: l.conversation_retention_days,
        contacts: l.entreprise_contacts, commissionPct: l.entreprise_commission_pct,
        business: l.offre_business, utilisateursBusiness: l.business_utilisateurs, businessEssaiFinLe: l.offre_business_essai_fin_le,
        commissionMessagesPct: l.entreprise_commission_messages_pct,
        // En euros entiers à l'écran, en micro-euros en base (0268) : la colonne n'accepte que des euros ronds d'ici.
        plafondIaMoisEuros: l.entreprise_plafond_ia_micro_eur === null ? null : Math.round(Number(l.entreprise_plafond_ia_micro_eur) / 1_000_000),
      }
      : null;
  }

  /**
   * Ce que l'exploitant doit savoir avant de poser ou de retirer une offre à la main (spec Business) : un Pro payé encore
   * vivant chez Stripe (poser le Business sans le résilier ferait payer deux fois), un numéro payé à part (inclus en
   * Business, à arrêter quand le Business est confirmé), un numéro fourni que plus rien ne couvrirait au retrait. Et
   * depuis l'Entreprise illimitée (2026-11-02) : un numéro sur la ligne du Crédit WhatsApp sans de quoi payer un message.
   * Hors Entreprise, il ne pourrait plus rien envoyer, réponses comprises, avant un achat.
   */
  async alertes(tenantId: string): Promise<AlertesOffreManuelle> {
    const r = await this.pool.query<{ pro: boolean; numero_seul: boolean; fourni: boolean; ligne_sans_credit: boolean; option_wa: boolean }>(
      `select exists (select 1 from abonnements_offre where tenant_id = $1 and fini_le is null) as pro,
              exists (select 1 from abonnements_numero where tenant_id = $1 and statut <> 'resilie') as numero_seul,
              exists (select 1 from numeros_fournis where tenant_id = $1 and statut = 'attribue') as fourni,
              exists (select 1 from lignes_credit_whatsapp l where l.tenant_id = $1 and l.retiree_le is null and l.arretee_le is null)
                and coalesce((select w.solde_micro_eur from credits_whatsapp w where w.tenant_id = $1), 0) < $2 as ligne_sans_credit,
              exists (select 1 from options_credit_whatsapp where tenant_id = $1 and fini_le is null) as option_wa`,
      [tenantId, SOLDE_REPRISE_CREDIT_MICRO_EUR],
    );
    const l = r.rows[0] ?? { pro: false, numero_seul: false, fourni: false, ligne_sans_credit: false, option_wa: false };
    return {
      proPayeVivant: l.pro, numeroSeulVivant: l.numero_seul, numeroFourniSansCouverture: l.fourni && !l.pro && !l.numero_seul,
      ligneCreditWhatsappSansCredit: l.ligne_sans_credit,
      // Sans Pro, retirer le Business ou l'Entreprise résiliera l'option du Crédit WhatsApp (sa fin de droit, lot 4a).
      optionCreditWhatsappSansDroit: l.option_wa && !l.pro,
      // Poser l'Entreprise la rend inutile (illimitée), sans la résilier : elle resterait facturée (relecture du lot 4a).
      optionCreditWhatsappVivante: l.option_wa,
    };
  }

  /**
   * Pose ou retire l'Entreprise, sa limite d'utilisateurs et sa conservation (lot 6, `/ops`), en une transaction. La
   * conservation (`tenant_settings.conversation_retention_days`) s'écrit par un upsert ciblé, qui ne touche aucun autre
   * réglage, et SEULEMENT si elle est donnée : changer d'offre ne doit jamais déclencher une purge. `false` pour un espace
   * inconnu, sans rien écrire.
   */
  async ecrireEntreprise(tenantId: string, r: EcritureEntreprise): Promise<boolean> {
    return enTransaction(this.pool, async (client) => {
      // La sortie de l'Entreprise est datée (migration 0221, lot 6, C) : la conservation de la Base n'y mord qu'après
      // 30 jours de grâce. Seulement au passage de l'Entreprise à la Base ; y rester ne repousse pas la date.
      // Les contacts et la commission (spec offres v2) ne s'écrivent que DONNÉS : absents, ils restent tels quels.
      // Le Business (spec du 2026-10-27) : une seule offre posée à la main, l'Entreprise le fait tomber ; absent, il reste
      // tel quel. Sa sortie est datée comme celle de l'Entreprise (la grâce de la conservation, la couverture du numéro).
      // Les deux colonnes de date relisent l'état AVANT la mise à jour (Postgres évalue tout `set` sur l'ancienne ligne).
      // Le Crédit WhatsApp (plan du 2026-10-30, tâche 8) : la commission des messages ne s'écrit que DONNÉE. L'illimité ne
      // s'écrit nulle part : il se lit sur l'Entreprise seule (décision du 2026-11-02, `PgConditionsCreditStore`).
      const maj = await client.query(
        `update tenants
            set offre_entreprise = $2, entreprise_utilisateurs = $3,
                entreprise_quittee_le = case when offre_entreprise and not $2 then now() else entreprise_quittee_le end,
                entreprise_contacts = case when $4 then $5::int else entreprise_contacts end,
                entreprise_commission_pct = case when $6 then $7::int else entreprise_commission_pct end,
                offre_business = case when $2 then false when $8::boolean is null then offre_business else $8::boolean end,
                business_quitte_le = case
                  when offre_business and ($2 or $8::boolean = false) then now() else business_quitte_le end,
                business_utilisateurs = case when $9 then $10::int else business_utilisateurs end,
                offre_business_essai_fin_le = case
                  when $2 or $8::boolean = false then null when $15 then $16::timestamptz else offre_business_essai_fin_le end,
                entreprise_commission_messages_pct = case when $11 then $12::int else entreprise_commission_messages_pct end,
                entreprise_plafond_ia_micro_eur = case when $13 then $14::bigint else entreprise_plafond_ia_micro_eur end
          where id = $1`,
        [
          tenantId, r.entreprise, r.utilisateurs, r.contacts !== undefined, r.contacts ?? null, r.commissionPct !== undefined,
          r.commissionPct ?? null, r.business ?? null, r.utilisateursBusiness !== undefined, r.utilisateursBusiness ?? null,
          r.commissionMessagesPct !== undefined, r.commissionMessagesPct ?? null,
          r.plafondIaMoisEuros !== undefined, r.plafondIaMoisEuros == null ? null : r.plafondIaMoisEuros * 1_000_000,
          r.businessEssaiFinLe !== undefined, r.businessEssaiFinLe ?? null,
        ],
      );
      if ((maj.rowCount ?? 0) === 0) return false;
      if (r.conservationJours === undefined) return true;
      await client.query(
        `insert into tenant_settings (tenant_id, conversation_retention_days, updated_at) values ($1, $2, now())
         on conflict (tenant_id) do update set conversation_retention_days = excluded.conversation_retention_days, updated_at = now()`,
        [tenantId, r.conservationJours],
      );
      return true;
    });
  }
}

/**
 * Ce que l'exploitation ÉCRIT : la conservation ABSENTE est laissée telle quelle (relecture finale du lot 6). `null` = sans
 * limite pour les utilisateurs, le défaut de l'instance pour la conservation.
 */
export interface EcritureEntreprise {
  entreprise: boolean;
  utilisateurs: number | null;
  conservationJours?: number | null;
  /** Absent = inchangé, `null` = le défaut de l'Entreprise (sans limite). */
  contacts?: number | null;
  /** Absent = inchangée, `null` = le défaut (10 %). */
  commissionPct?: number | null;
  /** Le Business posé à la main (spec du 2026-10-27). Absent = inchangé ; l'Entreprise posée le fait tomber. */
  business?: boolean;
  /** La limite d'utilisateurs du Business : absente = inchangée, `null` = les 5 de la grille. */
  utilisateursBusiness?: number | null;
  /**
   * L'essai du Business (révision du Crédit WhatsApp, 2026-11-04) : une date = en essai jusqu'à elle, `null` = confirmé ;
   * absente = inchangée. L'Entreprise posée ou le Business retiré l'effacent.
   */
  businessEssaiFinLe?: Date | null;
  /** La commission des messages négociée : absente = inchangée, `null` = la globale de `/ops`. */
  commissionMessagesPct?: number | null;
  /** Le plafond de sécurité de l'IA du mois, en euros entiers : absent = inchangé, `null` = le défaut de l'instance. */
  plafondIaMoisEuros?: number | null;
}

/** Ce que l'exploitant doit voir avant de poser ou de retirer une offre à la main (`PgOffresStore.alertes`). */
export interface AlertesOffreManuelle {
  proPayeVivant: boolean;
  numeroSeulVivant: boolean;
  numeroFourniSansCouverture: boolean;
  /** Un numéro est sur la ligne du Crédit WhatsApp et le solde ne couvre plus un message : hors Entreprise, tout s'arrête. */
  ligneCreditWhatsappSansCredit: boolean;
  /** L'espace a l'option du Crédit WhatsApp sans Pro : retirer l'offre posée à la main la résilie, ses envois s'arrêtent. */
  optionCreditWhatsappSansDroit: boolean;
  /**
   * L'espace a l'option du Crédit WhatsApp : poser l'Entreprise la rend inutile (illimitée) sans la résilier, elle reste
   * facturée tant que Julien ne la résilie pas chez Stripe. Ses lignes, elles, restent actives à sa fin.
   */
  optionCreditWhatsappVivante: boolean;
}

/** Ce que l'exploitation règle sur un espace (`/ops/offre/:tenantId`). `null` = sans limite, ou le défaut de l'instance. */
export interface ReglageEntreprise {
  entreprise: boolean;
  utilisateurs: number | null;
  conservationJours: number | null;
  contacts: number | null;
  commissionPct: number | null;
  /** Le Business posé à la main, et sa limite d'utilisateurs (`null` = les 5 de la grille). */
  business: boolean;
  utilisateursBusiness: number | null;
  /**
   * La fin de l'essai du Business, tant que Julien ne l'a pas confirmé (`null` : confirmé, ou sans Business). Tant
   * qu'elle n'est pas effacée, même passée, l'option Crédit WhatsApp ne s'ouvre pas (`formulePayee`).
   */
  businessEssaiFinLe: Date | null;
  /** La commission des messages WhatsApp négociée par une Entreprise (`null` = la globale). Son illimité ne se règle pas. */
  commissionMessagesPct: number | null;
  /**
   * Le plafond de sécurité de l'IA d'une Entreprise, en euros par mois (Entreprise illimitée, lot B) : `null` = le défaut
   * de l'instance (`ENTREPRISE_PLAFOND_IA_EUROS_MOIS`). Sans effet hors Entreprise.
   */
  plafondIaMoisEuros: number | null;
}
