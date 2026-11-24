import type { Pool } from 'pg';
import type { WorkflowGraph } from './graph';

/**
 * LES VERSIONS PUBLIÉES D'UN SCÉNARIO (lot 1 du CSM virtuel, B3, plan
 * `docs/superpowers/plans/2026-11-24-csm-lot1-c-clic-et-versions.md`).
 *
 * Elles s'écrivent en base, par le déclencheur `workflows_version` (migration 0315) : toute écriture qui change
 * `workflows.graph` en crée une, quel que soit le chemin. Ce module ne fait que les LIRE, toujours scopé à l'espace.
 * Restaurer une version, c'est republier son graphe : une mise en ligne comme une autre (B2), jamais une écriture d'ici.
 */

/** Combien de versions une liste rend au plus : les plus récentes d'abord. */
export const VERSIONS_LISTEES = 50;

export interface VersionScenario {
  numero: number;
  /** ISO 8601. */
  publieeLe: string;
  /** Le nombre de blocs de cette version : de quoi reconnaître une version sans lire son graphe. */
  blocs: number;
}

export interface VersionScenarioLue extends VersionScenario {
  graph: WorkflowGraph;
}

interface Ligne {
  numero: number;
  publiee_le: Date;
  blocs: number;
}

const vue = (l: Ligne): VersionScenario => ({ numero: l.numero, publieeLe: l.publiee_le.toISOString(), blocs: Number(l.blocs) });

export class PgVersionsScenario {
  constructor(private readonly pool: Pool) {}

  /** Les versions d'un scénario de l'espace, les plus récentes d'abord ; une liste vide pour un scénario d'un autre espace. */
  async lister(tenantId: string, workflowId: string): Promise<VersionScenario[]> {
    const r = await this.pool.query<Ligne>(
      `select numero, publiee_le, jsonb_array_length(coalesce(graph -> 'nodes', '[]'::jsonb)) as blocs
         from workflow_versions
        where tenant_id = $1 and workflow_id = $2
        order by numero desc
        limit $3`,
      [tenantId, workflowId, VERSIONS_LISTEES],
    );
    return r.rows.map(vue);
  }

  /** Une version d'un scénario de l'espace, avec son graphe, ou `null`. */
  async lire(tenantId: string, workflowId: string, numero: number): Promise<VersionScenarioLue | null> {
    const r = await this.pool.query<Ligne & { graph: WorkflowGraph }>(
      `select numero, publiee_le, jsonb_array_length(coalesce(graph -> 'nodes', '[]'::jsonb)) as blocs, graph
         from workflow_versions
        where tenant_id = $1 and workflow_id = $2 and numero = $3`,
      [tenantId, workflowId, numero],
    );
    const l = r.rows[0];
    return l ? { ...vue(l), graph: l.graph } : null;
  }
}
