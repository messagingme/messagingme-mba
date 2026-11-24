import type { Journal } from '../audit/journal';
import type { WorkflowGraph } from './graph';
import { jugerPublication, programmerMenage, type DepsPublication } from './modeles-de-bloc';
import { controlesDePublication } from './publication';
import type { Rayon } from './rayon';
import type { WorkflowRow } from './store.pg';

/**
 * PUBLIER UN SCÉNARIO, pour ses deux portes : « Publier » de la console (`POST .../publish`) et la mise en ligne qu'un
 * admin accepte d'un clic (lot 1 du CSM virtuel, B2 : publier un brouillon tel qu'il a été montré, restaurer une
 * version). Les mêmes règles des deux côtés, sinon l'une laisserait passer ce que l'autre refuse : les contrôles du
 * graphe (`controlesDePublication`), le jugement des templates de bloc chez Meta (qui PROGRAMME la mise en ligne tant
 * qu'un template est en validation), le ménage des templates que la version remplace, et le journal, qui porte QUI a
 * publié (la table ne garde que la date).
 */
export interface ScenariosAPublier {
  list(tenantId: string, rayon: Rayon): Promise<WorkflowRow[]>;
  publish(id: string, tenantId: string, graphe?: WorkflowGraph): Promise<WorkflowRow | null>;
  programmer(id: string, tenantId: string, par: string | null, graphe: WorkflowGraph): Promise<{ le: string } | null>;
}

export interface DepsPublierScenario {
  scenarios: ScenariosAPublier;
  publication: DepsPublication;
  journal: Journal;
}

export type IssuePublication =
  | { type: 'publie'; row: WorkflowRow }
  | { type: 'programme'; le: string; attend: Array<{ modele: string; langue: string }> }
  | { type: 'refus'; statut: 404 | 422; message: string; code?: string };

/** L'acteur tel que le journal le lit : la requête de la console, ou l'admin qui a accepté une mise en ligne. */
export type AuteurPublication = Parameters<Journal>[1];

/**
 * Publie `graphe` sur le scénario `avant` (relu dans l'espace par l'appelant). `graphe` absent : rien n'est jugé et la
 * publication ne change rien (un scénario sans brouillon), comme « Publier » sans modification. Sinon le graphe JUGÉ
 * est celui qui part : un enregistrement tombé pendant le jugement reste un brouillon (`publish`, relecture de 3a).
 */
export async function publierScenario(
  deps: DepsPublierScenario, tenant: string, avant: WorkflowRow, graphe: WorkflowGraph | undefined, auteur: AuteurPublication,
): Promise<IssuePublication> {
  const id = avant.id;
  if (graphe !== undefined) {
    const refus = await controlesDePublication(graphe, id, () => deps.scenarios.list(tenant, avant.rayon), avant.rayon);
    if (refus !== null) return { type: 'refus', statut: 422, message: `Publication refusée : ${refus.message}.`, code: refus.code };
    // 🔴 Un template écrit depuis un bloc et encore en validation chez Meta (lot 3, décision 18) : la mise en ligne se
    // PROGRAMME, sous réserve qu'aucune campagne active n'utilise le scénario. Un scénario sans template de bloc passe ici
    // sans aucune lecture de plus.
    const jugement = await jugerPublication(deps.publication, tenant, id, graphe);
    if (jugement.type === 'refus') return { type: 'refus', statut: 422, message: `Publication refusée : ${jugement.erreur}`, code: jugement.code };
    if (jugement.type === 'programmer') {
      const programmee = await deps.scenarios.programmer(id, tenant, auteur.auth?.userId ?? null, graphe);
      if (!programmee) return { type: 'refus', statut: 404, message: 'workflow inconnu' };
      await deps.journal(tenant, auteur, 'workflow.publication_programmee', { kind: 'workflow', id }, { modeles: jugement.attend.length });
      return { type: 'programme', le: programmee.le, attend: jugement.attend };
    }
  }
  const row = await deps.scenarios.publish(id, tenant, graphe);
  if (!row) return { type: 'refus', statut: 404, message: 'workflow inconnu' };
  // Le ménage des templates que cette version remplace (rayons d'automation, spec § 5.1) : best-effort, il ne bloque rien.
  await programmerMenage(deps.publication.menage, tenant, avant.rayon, avant.graph, row.graph);
  // Détail non identifiant (un nombre de blocs), comme partout dans ce journal.
  await deps.journal(tenant, auteur, 'workflow.published', { kind: 'workflow', id }, { blocs: row.graph.nodes.length });
  return { type: 'publie', row };
}
