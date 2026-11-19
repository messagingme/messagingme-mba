import type { Pool } from 'pg';
import {
  DECLENCHEUR_DE_LA_FAMILLE, DECLENCHEURS_HUBSPOT, configDeLaBase, configEnBase, familleDuDeclencheur,
  type ConfigLigneHubspot, type FamilleLigneHubspot, type LigneHubspot,
} from './lignes';

/**
 * LE MAGASIN DES LIGNES HUBSPOT (menu « Scénario », lot 6b) : des lignes d'`automations` du rayon `hubspot`, lues et
 * écrites ICI, jamais par `PgAutomationStore`, dont le chemin chaud ne sert que le rayon général (lot 6a) et qui ignore le
 * déclencheur `hubspot_workflow`. 🔴 Chaque requête sur un espace porte `tenant_id = $1` ET `rayon = 'hubspot'` : une ligne
 * n'atteint jamais une automation des Autres. Seule la liste des espaces à balayer (`tenantsAvecRendezVous`) les voit tous,
 * comme `tenantsAvecDeclencheurDate`.
 */

interface Brute {
  id: string; name: string; enabled: boolean; trigger_kind: string; trigger_config: unknown; workflow_id: string;
}

const COLONNES = 'id, name, enabled, trigger_kind, trigger_config, workflow_id';

/** Une ligne relue : un déclencheur qui n'est pas une famille, ou une configuration illisible, la rend inerte (`null`). */
function versLigne(r: Brute): LigneHubspot | null {
  const famille = familleDuDeclencheur(r.trigger_kind);
  if (famille === null) return null;
  const brut = r.trigger_config && typeof r.trigger_config === 'object' && !Array.isArray(r.trigger_config)
    ? (r.trigger_config as Record<string, unknown>) : {};
  const config = configDeLaBase(famille, brut);
  if (config === null) return null;
  return { id: r.id, famille, config, actif: r.enabled, workflowId: r.workflow_id, nom: r.name };
}

const lignes = (rows: Brute[]): LigneHubspot[] => rows.map(versLigne).filter((l): l is LigneHubspot => l !== null);

export class PgLignesHubspot {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  /** Les lignes de l'espace, dans l'ordre de leur création. */
  async lister(tenantId: string): Promise<LigneHubspot[]> {
    const r = await this.pool.query<Brute>(
      `select ${COLONNES} from automations
        where tenant_id = $1 and rayon = 'hubspot' and trigger_kind = any($2::text[]) order by created_at, id`,
      [tenantId, DECLENCHEURS_HUBSPOT],
    );
    return lignes(r.rows);
  }

  async lire(tenantId: string, id: string): Promise<LigneHubspot | null> {
    const r = await this.pool.query<Brute>(
      `select ${COLONNES} from automations
        where tenant_id = $1 and id = $2 and rayon = 'hubspot' and trigger_kind = any($3::text[])`,
      [tenantId, id, DECLENCHEURS_HUBSPOT],
    );
    const brute = r.rows[0];
    return brute ? versLigne(brute) : null;
  }

  /** Une ligne neuve, ÉTEINTE (une automation ne part jamais sans un oui explicite), sur le scénario qu'on lui donne. */
  async creer(tenantId: string, l: { famille: FamilleLigneHubspot; config: ConfigLigneHubspot; workflowId: string; nom: string }): Promise<{ id: string }> {
    const r = await this.pool.query<{ id: string }>(
      `insert into automations (tenant_id, name, enabled, trigger_kind, trigger_config, workflow_id, rayon)
       values ($1, $2, false, $3, $4::jsonb, $5, 'hubspot') returning id`,
      [tenantId, l.nom, DECLENCHEUR_DE_LA_FAMILLE[l.famille], JSON.stringify(configEnBase(l.famille, l.config)), l.workflowId],
    );
    return { id: r.rows[0]!.id };
  }

  /** La paire pipeline et étape a-t-elle déjà sa ligne dans l'espace ? Le doublon se juge sur la paire. */
  async etapeReglee(tenantId: string, pipelineId: string, stageId: string): Promise<boolean> {
    const r = await this.pool.query(
      `select 1 from automations
        where tenant_id = $1 and rayon = 'hubspot' and trigger_kind = 'hubspot_deal_stage'
          and trigger_config->>'pipelineId' = $2 and trigger_config->>'stageId' = $3 limit 1`,
      [tenantId, pipelineId, stageId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** L'interrupteur. `false` : aucune ligne de l'espace sous cet identifiant. */
  async allumer(tenantId: string, id: string, actif: boolean): Promise<boolean> {
    const r = await this.pool.query(
      `update automations set enabled = $3, updated_at = now()
        where tenant_id = $1 and id = $2 and rayon = 'hubspot' and trigger_kind = any($4::text[])`,
      [tenantId, id, actif, DECLENCHEURS_HUBSPOT],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** La ligne disparaît ; son scénario reste, hors de toute liste. `false` : aucune ligne sous cet identifiant. */
  async supprimer(tenantId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(
      `delete from automations where tenant_id = $1 and id = $2 and rayon = 'hubspot' and trigger_kind = any($3::text[])`,
      [tenantId, id, DECLENCHEURS_HUBSPOT],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Les lignes d'étape ALLUMÉES qu'un changement d'étape fait tirer : l'étape à l'identique ; le pipeline ne restreint que
   * si les deux côtés le portent (la règle de `matchesTrigger`, le connecteur pouvant ne pas relire le pipeline).
   */
  async etapesAllumees(tenantId: string, pipelineId: string, stageId: string): Promise<LigneHubspot[]> {
    const r = await this.pool.query<Brute>(
      `select ${COLONNES} from automations
        where tenant_id = $1 and rayon = 'hubspot' and trigger_kind = 'hubspot_deal_stage' and enabled
          and trigger_config->>'stageId' = $2::text
          and ($3::text = '' or coalesce(trigger_config->>'pipelineId', '') in ('', $3::text))
        order by created_at, id`,
      [tenantId, stageId, pipelineId],
    );
    return lignes(r.rows);
  }

  /** Les lignes de rendez-vous ALLUMÉES de l'espace. */
  async rendezVousAllumes(tenantId: string): Promise<LigneHubspot[]> {
    const r = await this.pool.query<Brute>(
      `select ${COLONNES} from automations
        where tenant_id = $1 and rayon = 'hubspot' and trigger_kind = 'avant_date' and enabled order by created_at, id`,
      [tenantId],
    );
    return lignes(r.rows);
  }

  /** Les espaces qui ont au moins une ligne de rendez-vous allumée : le balayage ne parcourt qu'eux. */
  async tenantsAvecRendezVous(): Promise<string[]> {
    const r = await this.pool.query<{ tenant_id: string }>(
      `select distinct tenant_id from automations where rayon = 'hubspot' and trigger_kind = 'avant_date' and enabled`,
    );
    return r.rows.map((x) => x.tenant_id);
  }

  /**
   * Les codes des scénarios qu'une action de workflow peut lancer : ceux des lignes `workflow` ALLUMÉES, du rayon `hubspot`
   * (décision 41). L'action les croise avec les scénarios publiés du rayon.
   */
  async codesLancesParWorkflow(tenantId: string): Promise<Set<string>> {
    const r = await this.pool.query<{ code: string | null }>(
      `select w.code from automations a
         join workflows w on w.id = a.workflow_id and w.tenant_id = a.tenant_id and w.rayon = 'hubspot'
        where a.tenant_id = $1 and a.rayon = 'hubspot' and a.trigger_kind = 'hubspot_workflow' and a.enabled`,
      [tenantId],
    );
    return new Set(r.rows.flatMap((x) => (x.code === null ? [] : [x.code])));
  }
}
