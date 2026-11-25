import type { Pool } from 'pg';
import type { RunStatus } from './run-store.pg';

/**
 * LE DÉROULÉ D'UN CONTACT DANS UN SCÉNARIO (lot 1 du CSM virtuel, B6b, plan
 * `docs/superpowers/plans/2026-11-25-csm-lot1-f-simulation-deroule.md`) : ses derniers parcours et les blocs qu'il a
 * passés, pour que Claude suive une vraie conversation et dise où elle en est. Lecture seule ; chaque requête filtre
 * l'espace (`tenant_id = $1`), seul contrôle d'isolation (le rôle de l'application possède les tables).
 *
 * Les passages se lisent dans la fenêtre de ces parcours (depuis le plus ancien, moins cinq minutes : un envoi peut
 * précéder de peu l'écriture de son parcours), et jamais au-delà de 90 jours : un parcours qui attend n'expire pas, la
 * fenêtre remonterait sinon sans fin (relecture du lot F). L'index `(tenant_id, workflow_id, at)` les sert, le numéro
 * n'y est qu'un filtre : à fort volume, la lecture parcourt le scénario entier dans la fenêtre (`todo.md`, l'index).
 */
export const PARCOURS_MAX = 5;
export const PASSAGES_MAX = 100;

export interface ParcoursDuContact {
  id: string;
  statut: RunStatus;
  /** Le bloc où le parcours attend ou dort, `null` une fois clos. */
  bloc: string | null;
  /** L'échéance d'une attente (pas de réponse, Attente), en ISO. */
  reprise: string | null;
  debut: string;
  maj: string;
}

export interface PassageDeBloc {
  bloc: string;
  /** `sent`, `delivered`, `read`, `failed`, `reply_button`, `reply_text` (`workflow_node_events.kind`). */
  quoi: string;
  /** La sortie d'un clic (`btn:<i>`, `row:<i>`), sinon `null`. */
  sortie: string | null;
  le: string;
}

export interface Deroule {
  parcours: ParcoursDuContact[];
  /** Du plus ancien au plus récent. */
  passages: PassageDeBloc[];
}

export interface LecteurDeroule {
  lire(tenantId: string, workflowId: string, waId: string): Promise<Deroule>;
}

export class PgDeroule implements LecteurDeroule {
  constructor(private readonly pool: Pool) {}

  async lire(tenantId: string, workflowId: string, waId: string): Promise<Deroule> {
    const p = await this.pool.query<{
      id: string; status: RunStatus; current_node: string | null; resume_at: Date | null; created_at: Date; updated_at: Date;
    }>(
      `select id, status, current_node, resume_at, created_at, updated_at
         from workflow_runs
        where tenant_id = $1 and workflow_id = $2 and wa_id = $3
        order by created_at desc
        limit ${PARCOURS_MAX}`,
      [tenantId, workflowId, waId],
    );
    const plusAncien = p.rows.at(-1)?.created_at ?? null;
    const e = await this.pool.query<{ node_id: string; kind: string; handle: string | null; at: Date }>(
      `select node_id, kind, handle, at
         from workflow_node_events
        where tenant_id = $1 and workflow_id = $2 and wa_id = $3
          and at >= greatest($4::timestamptz - interval '5 minutes', now() - interval '90 days')
        order by at desc
        limit ${PASSAGES_MAX}`,
      [tenantId, workflowId, waId, plusAncien],
    );
    return {
      parcours: p.rows.map((r) => ({
        id: r.id, statut: r.status, bloc: r.current_node, reprise: r.resume_at ? r.resume_at.toISOString() : null,
        debut: r.created_at.toISOString(), maj: r.updated_at.toISOString(),
      })),
      passages: e.rows.reverse().map((r) => ({ bloc: r.node_id, quoi: r.kind, sortie: r.handle, le: r.at.toISOString() })),
    };
  }
}
