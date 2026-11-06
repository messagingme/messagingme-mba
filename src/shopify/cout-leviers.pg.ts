import type { Pool } from 'pg';
import { BOUNDS_CTE, STATS_TZ, type DateRange } from '../stats/range';
import { horsEntreeGratuite } from '../stats/entree-gratuite';
import { ATTRIBUTION_CAMPAGNE_SCENARIO } from '../stats/store.pg';
import type { SourceVente } from './attribution';
import {
  VALEURS_CAMPAGNE_LEVIER, campagneLevier, origineLevier, sourceDeCampagne, sourceDeLOrigine, type MarqueursCampagne,
} from './perimetre-leviers';

/**
 * CE QUE LES LEVIERS DE VENTE ONT ENVOYÉ, JOUR PAR JOUR (plan docs/superpowers/plans/2026-11-06-roi-shopify.md,
 * tâche 3). Des VOLUMES, pas des prix : le prix se décide dans `calculerRoi` (`src/shopify/roi.ts`), pur.
 *
 * 🔴 LE PÉRIMÈTRE EST CELUI DE L'ATTRIBUTION (`perimetre-leviers.ts`) : les envois des campagnes leviers (relance de
 * panier comprise, sans les confirmations et expéditions Shopify, les envois `[API]` ni les lignes HubSpot) et les
 * messages sortants d'un scénario, de l'agent IA ou de l'agent de Meta.
 *
 * Trois branches, chaque message une fois :
 * 1. les MODÈLES WhatsApp des campagnes leviers, par leurs destinataires (la règle du coût par campagne existant :
 *    envoyé, non échoué, hors des 72 h gratuites), sauf ceux dont la tentative retenue est partie sur un autre canal ;
 * 2. les étages RCS et e-mail des campagnes leviers, par leurs tentatives (`campaign_envois`, une ligne par essai) ;
 * 3. les messages sortants WhatsApp et RCS d'origine levier qui ne sont pas déjà un envoi de campagne. Un message de
 *    scénario lancé par une campagne levier revient à cette campagne (la règle de rattachement des écrans de coût,
 *    `ATTRIBUTION_CAMPAGNE_SCENARIO`), comme la vente lui revient dans l'attribution (spec, choix 1 après relecture).
 *
 * Chaque groupe porte, à côté de son volume, ce que le Crédit WhatsApp a provisionné pour ses messages (le coût RÉEL,
 * en micro-euros, commission comprise) et combien de messages en ont une : le reste se chiffre à l'estimation.
 * Une provision rendue (message échoué) ne coûte rien et ne compte pas.
 */

export type NatureEnvoi = 'modele' | 'service' | 'rcs' | 'email';

export interface LigneLevier {
  jour: string;
  source: SourceVente;
  campaignId: string | null;
  /** Le nom actuel de la campagne ; `null` pour une source sans campagne, ou une campagne supprimée. */
  nom: string | null;
  nature: NatureEnvoi;
  /** La catégorie Meta d'un modèle (`marketing`, `utility`...), `null` ailleurs ou inconnue. */
  categorie: string | null;
  n: number;
  /** Ceux de ces messages qui ont une provision non rendue du Crédit WhatsApp. */
  nProvision: number;
  provisionMicroEur: number;
}

/** Les marqueurs des quatre valeurs de la condition des campagnes, après ceux de `BOUNDS_CTE` ($1 à $4). */
const P: MarqueursCampagne = { relance: '$5', shopify: '$6', api: '$7', hubspot: '$8' };

/** La requête, exportée pour que `tests/shopify-perimetre-leviers.test.ts` vérifie qu'elle interpole le périmètre. */
export const LEVIERS_ENVOIS = `
  with ${BOUNDS_CTE},
  envois as (
    select r.sent_at as le, ${sourceDeCampagne('k', P.relance)} as source,
           case when k.name = ${P.relance} then null else k.id end as campaign_id,
           'modele'::text as nature, k.category as categorie, r.message_id as wamid
      from campaign_recipients r join campaigns k on k.id = r.campaign_id, bounds b
     where k.tenant_id = $1 and k.channel = 'whatsapp' and nullif(k.template_name, '') is not null and r.status = 'sent'
       and r.sent_at >= b.start_ts and r.sent_at < b.end_ts
       and (r.delivery_status is null or r.delivery_status <> 'failed')
       and ${campagneLevier('k', P)}
       and not exists (select 1 from campaign_envois e0
                        where e0.recipient_id = r.id and e0.canal <> 'whatsapp' and e0.message_id = r.message_id)
       and ${horsEntreeGratuite('r.message_id', 'k.tenant_id')}
    union all
    select e.sent_at, ${sourceDeCampagne('k', P.relance)},
           case when k.name = ${P.relance} then null else k.id end,
           e.canal, null::text, e.message_id
      from campaign_envois e join campaigns k on k.id = e.campaign_id, bounds b
     where k.tenant_id = $1 and e.canal in ('rcs', 'email') and e.statut = 'sent'
       and e.sent_at >= b.start_ts and e.sent_at < b.end_ts
       and (e.delivery_status is null or e.delivery_status <> 'failed')
       and ${campagneLevier('k', P)}
    union all
    select m.created_at, coalesce(case when ks.id is not null then 'campagne' end, ${sourceDeLOrigine('m')}),
           ks.id,
           case when m.channel = 'rcs' then 'rcs' when m.type = 'template' then 'modele' else 'service' end,
           case when m.type = 'template' then m.template_category end, m.meta_message_id
      from conversation_messages m
      join conversations cv on cv.id = m.conversation_id
      cross join bounds b
      left join campaigns ks on ks.tenant_id = cv.tenant_id
            and ks.id = (case when m.origin = 'scenario' then ${ATTRIBUTION_CAMPAGNE_SCENARIO} end)
            and ${campagneLevier('ks', P)}
     where cv.tenant_id = $1 and not cv.is_test and m.direction = 'out' and ${origineLevier('m')}
       and m.channel in ('whatsapp', 'rcs')
       and m.created_at >= b.start_ts and m.created_at < b.end_ts
       and m.statut is distinct from 'failed'
       and not exists (select 1 from campaign_recipients r2 join campaigns c2 on c2.id = r2.campaign_id
                        where c2.tenant_id = cv.tenant_id and r2.message_id = m.meta_message_id)
       and ${horsEntreeGratuite('m.meta_message_id', 'cv.tenant_id')}
  )
  select to_char(x.le at time zone $4, 'YYYY-MM-DD') as jour, x.source, x.campaign_id, k.name as nom, x.nature, x.categorie,
         count(*)::int as n,
         count(p.id)::int as n_provision,
         coalesce(sum(p.montant_micro_eur), 0)::text as provision
    from envois x
    left join campaigns k on k.id = x.campaign_id and k.tenant_id = $1
    left join credit_whatsapp_provisions p
           -- `p.wamid is not null` répète le prédicat de l'index unique partiel (tenant_id, wamid) : sans lui, le
           -- planificateur ne peut pas s'en servir (relecture du lot).
           on p.tenant_id = $1 and x.wamid is not null and p.wamid is not null and p.wamid = x.wamid and p.etat <> 'rendu'
   group by 1, 2, 3, 4, 5, 6
   order by 1, 2, 3`;

/** Ce que l'agent IA a débité du crédit du client, par jour (les tours, `agent_sessions`, au prix client). */
const IA_PAR_JOUR = `
  with ${BOUNDS_CTE}
  select to_char(s.created_at at time zone $4, 'YYYY-MM-DD') as jour, coalesce(sum(s.cout_micro_eur), 0)::text as cout
    from agent_sessions s, bounds b
   where s.tenant_id = $1 and s.created_at >= b.start_ts and s.created_at < b.end_ts
   group by 1
  having coalesce(sum(s.cout_micro_eur), 0) > 0
   order by 1`;

export class PgCoutLeviersStore {
  constructor(private readonly pool: Pool) {}

  async lireVolumes(tenantId: string, range: DateRange): Promise<LigneLevier[]> {
    const v = VALEURS_CAMPAGNE_LEVIER;
    const res = await this.pool.query<{
      jour: string; source: SourceVente; campaign_id: string | null; nom: string | null; nature: NatureEnvoi;
      categorie: string | null; n: number; n_provision: number; provision: string;
    }>(LEVIERS_ENVOIS, [tenantId, range.from, range.to, STATS_TZ, v.relance, v.shopify, v.api, v.hubspot]);
    return res.rows.map((r) => ({
      jour: r.jour, source: r.source, campaignId: r.campaign_id, nom: r.nom, nature: r.nature, categorie: r.categorie,
      n: Number(r.n), nProvision: Number(r.n_provision), provisionMicroEur: Number(r.provision),
    }));
  }

  async lireIaParJour(tenantId: string, range: DateRange): Promise<Array<{ jour: string; coutMicroEur: number }>> {
    const res = await this.pool.query<{ jour: string; cout: string }>(IA_PAR_JOUR, [tenantId, range.from, range.to, STATS_TZ]);
    return res.rows.map((r) => ({ jour: r.jour, coutMicroEur: Number(r.cout) }));
  }
}
