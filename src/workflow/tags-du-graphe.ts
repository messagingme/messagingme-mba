import type { WorkflowGraph } from './graph';
import { normaliserEtiquette } from '../crm/poser-etiquette';
import { sousActions } from '../../web/lib/partage/actions-bloc';

/**
 * Tags saisis dans les blocs `tag` du graphe (dédupliqués, normalisés comme à la pose : `normaliserEtiquette`). Pur :
 * les routes des scénarios et la duplication entre espaces (`src/ops/duplication/graphe.ts`) déclarent les mêmes.
 */
export function tagsInGraph(graph: WorkflowGraph): string[] {
  const out = new Set<string>();
  for (const n of graph.nodes) {
    // Bloc `tag` legacy OU action « ajouter un tag » d'un bloc `action` (chacune, `sousActions`) : on déclare le tag
    // posé dans le référentiel. Un retrait de tag (remove_tag) ne « dé-déclare » rien -> ignoré ici.
    const poses = n.type === 'tag' ? [n.data] : n.type === 'action' ? sousActions(n.data).filter((sa) => sa.actionKind === 'add_tag') : [];
    for (const sa of poses) {
      const t = normaliserEtiquette(String(sa.tag ?? ''));
      if (t !== '') out.add(t);
    }
  }
  return [...out];
}
