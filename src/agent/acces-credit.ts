import type { Pool } from 'pg';

/**
 * L'ACCÈS AU CRÉDIT IA D'UN ESPACE (plan de l'Entreprise illimitée, lot B ; décision de Julien du 2026-11-02) : le point
 * de passage UNIQUE de la question « cet espace peut-il consommer de l'IA ? ». Prépayé (Free, formule Pro, Business) :
 * un solde positif. Entreprise : illimitée, facturée au contrat, sous un plafond de sécurité par mois (100 € par défaut,
 * réglable par espace dans `/ops`), qui arrête un agent qui boucle avant qu'il ne nous coûte sans limite.
 *
 * 🔴 LA RÈGLE VIT EN SQL, `acces_credit_ia` (migration 0268) : la vectorisation la lit dans sa requête, le code ici. Une
 * seconde définition en TypeScript finirait par diverger de celle de la requête (même raison que `offre_de_l_espace`).
 * `tests/credit-ia-acces-inventaire.test.ts` refuse une lecture du solde qui décide ailleurs.
 */

/** `ok` ; `epuise` : prépayé, solde nul ou négatif ; `plafond` : Entreprise, plafond de sécurité du mois atteint. */
export type AccesCreditIa = 'ok' | 'epuise' | 'plafond';

/** Ce que montrent l'onglet Crédit IA, la page des agents et Claude. Montants en micro-euros, au prix client. */
export interface EtatCreditIa {
  acces: AccesCreditIa;
  /** Une Entreprise : illimitée, son solde ne bouge pas et ne dit rien. */
  illimite: boolean;
  soldeMicroEur: number;
  /** Ce que l'IA a consommé ce mois de Paris (débits illimités) ; 0 hors Entreprise. */
  consommationDuMoisMicroEur: number;
  /** Le plafond de sécurité du mois, celui de l'espace ou le défaut ; `null` hors Entreprise. */
  plafondMicroEur: number | null;
}

/**
 * Un accès lu est gardé dix secondes, et seulement pour une Entreprise : sa consommation du mois se recalcule sur ses
 * débits, et un plafond de sécurité peut mordre dix secondes plus tard sans dommage. Un prépayé se relit à chaque fois :
 * son solde est la limite de ce qu'il a payé, au centime près.
 */
const CACHE_ENTREPRISE_MS = 10_000;

export class PgAccesCreditIaStore {
  private readonly cache = new Map<string, { lu: number; acces: AccesCreditIa }>();

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    /** Le plafond par défaut d'une Entreprise, en micro-euros (`ENTREPRISE_PLAFOND_IA_EUROS_MOIS`). */
    private readonly plafondParDefautMicroEur: number,
    private readonly maintenant: () => number = () => Date.now(),
  ) {}

  /** Cet espace peut-il consommer de l'IA ? Lu avant chaque appel à un modèle qui se paie sur son crédit. */
  async acces(tenantId: string): Promise<AccesCreditIa> {
    const t = this.maintenant();
    const c = this.cache.get(tenantId);
    if (c !== undefined && t - c.lu < CACHE_ENTREPRISE_MS) return c.acces;
    const { rows } = await this.pool.query<{ acces: AccesCreditIa; illimite: boolean }>(
      `select acces_credit_ia($1::uuid, $2::bigint) as acces, offre_de_l_espace($1::uuid) = 'entreprise' as illimite`,
      [tenantId, this.plafondParDefautMicroEur],
    );
    const l = rows[0];
    // Un espace inconnu n'a rien à dépenser : un accès implicite ferait payer une consommation que personne n'a autorisée.
    const acces: AccesCreditIa = l?.acces ?? 'epuise';
    if (l?.illimite === true) this.cache.set(tenantId, { lu: t, acces });
    else this.cache.delete(tenantId);
    return acces;
  }

  /** L'espace est-il illimité (une Entreprise) ? Lu sans cache : un écran, un achat, une alerte. */
  async illimite(tenantId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ illimite: boolean }>(
      `select offre_de_l_espace($1::uuid) = 'entreprise' as illimite`,
      [tenantId],
    );
    return rows[0]?.illimite === true;
  }

  /** Tout ce qu'un écran montre, en une lecture, sans cache. */
  async etat(tenantId: string): Promise<EtatCreditIa> {
    const { rows } = await this.pool.query<{
      acces: AccesCreditIa; illimite: boolean; solde: string; conso: string; plafond: string | null;
    }>(
      `select acces_credit_ia($1::uuid, $2::bigint) as acces,
              offre_de_l_espace($1::uuid) = 'entreprise' as illimite,
              coalesce((select c.solde_micro_eur from agent_credits c where c.tenant_id = $1::uuid), 0) as solde,
              case when offre_de_l_espace($1::uuid) = 'entreprise' then consommation_ia_du_mois($1::uuid) else 0 end as conso,
              case when offre_de_l_espace($1::uuid) = 'entreprise'
                   then coalesce((select t.entreprise_plafond_ia_micro_eur from tenants t where t.id = $1::uuid), $2::bigint)
              end as plafond`,
      [tenantId, this.plafondParDefautMicroEur],
    );
    const l = rows[0];
    return {
      acces: l?.acces ?? 'epuise',
      illimite: l?.illimite === true,
      soldeMicroEur: Number(l?.solde ?? 0),
      consommationDuMoisMicroEur: Number(l?.conso ?? 0),
      plafondMicroEur: l?.plafond == null ? null : Number(l.plafond),
    };
  }

  /**
   * La marge que la clé Vercel d'un espace garde au-dessus de ce qu'il a consommé : le plafond du mois pour une
   * Entreprise (sa clé ne doit jamais couper avant notre plafond), zéro pour un prépayé (sa clé suit ce qu'il a payé).
   */
  async margeDeCle(tenantId: string): Promise<number> {
    const e = await this.etat(tenantId);
    return e.illimite ? (e.plafondMicroEur ?? this.plafondParDefautMicroEur) : 0;
  }

  /** Les Entreprises, leur consommation du mois et leur plafond : le balayage horaire des alertes et des clés. */
  async entreprises(): Promise<Array<{ tenantId: string; nom: string; consommationDuMoisMicroEur: number; plafondMicroEur: number }>> {
    const { rows } = await this.pool.query<{ id: string; name: string; conso: string; plafond: string }>(
      `select t.id, t.name, consommation_ia_du_mois(t.id) as conso,
              coalesce(t.entreprise_plafond_ia_micro_eur, $1::bigint) as plafond
         from tenants t
        where offre_de_l_espace(t.id) = 'entreprise'
        order by t.id`,
      [this.plafondParDefautMicroEur],
    );
    return rows.map((r) => ({
      tenantId: r.id, nom: r.name, consommationDuMoisMicroEur: Number(r.conso), plafondMicroEur: Number(r.plafond),
    }));
  }

  /**
   * Marque l'alerte d'un seuil pour le mois de Paris en cours : `true` la première fois seulement (une alerte par espace,
   * par mois et par seuil). La clé primaire tranche entre deux copies du balayage.
   */
  async marquerAlerte(tenantId: string, seuil: 80 | 100): Promise<boolean> {
    const r = await this.pool.query(
      `insert into alertes_plafond_ia (tenant_id, mois, seuil)
       values ($1, date_trunc('month', now() at time zone 'Europe/Paris')::date, $2)
       on conflict do nothing`,
      [tenantId, seuil],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Retire la marque d'une alerte que Telegram n'a pas prise : le balayage suivant la retente. */
  async oublierAlerte(tenantId: string, seuil: 80 | 100): Promise<void> {
    await this.pool.query(
      `delete from alertes_plafond_ia
        where tenant_id = $1 and mois = date_trunc('month', now() at time zone 'Europe/Paris')::date and seuil = $2`,
      [tenantId, seuil],
    );
  }
}
