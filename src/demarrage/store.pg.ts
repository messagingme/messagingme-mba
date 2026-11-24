import type { Pool } from 'pg';

/**
 * OÙ EN EST L'ESPACE DANS « BIEN DÉMARRER » (plan 2026-11-24-guide-demarrage, lot 1) : cinq oui/non, que la checklist de
 * la console coche d'elle-même. Rien n'y est compté ni montré d'autre : c'est une progression, pas un tableau de bord.
 */
export interface EtatDemarrage {
  /** Un numéro WhatsApp rattaché à l'espace, délié compris : la même règle que `hasNumber` de l'Accueil. */
  numero: boolean;
  /** Une boutique Shopify connectée, ou HubSpot activé sur un numéro de l'espace. */
  outil: boolean;
  /**
   * Un scénario publié (hors scénarios système), ou une campagne lancée : programmée, en cours, en pause ou terminée.
   * HubSpot en pause n'est pas compté plus haut : la pause remet `hubspot_connected` à faux (`hubspot_paused_at`).
   */
  scenarioOuCampagne: boolean;
  /** Un agent IA actif. */
  agent: boolean;
  /** Une bulle WhatsApp active. */
  bulle: boolean;
}

/**
 * 🔴 CHAQUE `exists` PORTE `tenant_id = $1` : le rôle de l'application possède les tables, la RLS est contournée, ce
 * filtre est le seul contrôle (une fuite cocherait la checklist d'un espace avec les objets d'un autre). Une seule
 * requête, cinq sous-requêtes servies par les index `tenant_id` de chaque table.
 */
export class PgDemarrageStore {
  constructor(private readonly pool: Pool) {}

  async etat(tenantId: string): Promise<EtatDemarrage> {
    const res = await this.pool.query<{ numero: boolean; outil: boolean; scenario_ou_campagne: boolean; agent: boolean; bulle: boolean }>(
      `select
         exists(select 1 from phone_numbers where tenant_id = $1) as numero,
         (exists(select 1 from shopify_boutiques where tenant_id = $1 and etat = 'connectee')
           or exists(select 1 from phone_numbers where tenant_id = $1 and hubspot_connected)) as outil,
         (exists(select 1 from workflows where tenant_id = $1 and systeme is null and published_at is not null)
           or exists(select 1 from campaigns where tenant_id = $1 and status in ('scheduled', 'running', 'paused', 'completed'))) as scenario_ou_campagne,
         exists(select 1 from agents where tenant_id = $1 and status = 'active') as agent,
         exists(select 1 from widgets where tenant_id = $1 and actif) as bulle`,
      [tenantId],
    );
    const r = res.rows[0];
    return {
      numero: r?.numero === true,
      outil: r?.outil === true,
      scenarioOuCampagne: r?.scenario_ou_campagne === true,
      agent: r?.agent === true,
      bulle: r?.bulle === true,
    };
  }
}
