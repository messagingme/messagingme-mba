import type { WorkflowGraph } from './graph';
import type { WorkflowRow } from './store.pg';
import { refusDePublication } from './aller-a';
import { refusFichierSansSuite } from './question-piece';
import { refusSuiteQuiAttend } from './engine';

/** Ce qui empêche un graphe d'être mis en ligne, et le code que la console reconnaît. */
export interface RefusDeControle {
  code: 'fichier_sans_suite' | 'suite_qui_attend' | 'aller_a_invalide';
  message: string;
}

/**
 * Les contrôles d'un graphe AVANT sa mise en ligne, dans l'ordre de la route de publication : la publication à la main
 * (`POST .../publish`) et la mise en ligne d'une version programmée (lot 3) passent par eux, sinon l'une laisserait
 * passer ce que l'autre refuse.
 * - Une Question qui attend un fichier relie « Fichier reçu » (décision de Julien du 2026-11-02).
 * - « Puis, sans attendre » ne mène qu'à des blocs qui n'attendent rien (décision du 2026-11-10).
 * - Un « Aller à » vise un scénario existant du même rayon (RC5) : la liste ne se lit que s'il y en a un.
 */
export async function controlesDePublication(
  graphe: WorkflowGraph, id: string, scenariosDuRayon: () => Promise<WorkflowRow[]>,
): Promise<RefusDeControle | null> {
  const sansSuite = refusFichierSansSuite(graphe);
  if (sansSuite !== null) return { code: 'fichier_sans_suite', message: sansSuite };
  const suiteQuiAttend = refusSuiteQuiAttend(graphe);
  if (suiteQuiAttend !== null) return { code: 'suite_qui_attend', message: suiteQuiAttend };
  if (graphe.nodes.some((n) => n.type === 'aller_a')) {
    const refus = refusDePublication(graphe, id, await scenariosDuRayon());
    if (refus !== null) return { code: 'aller_a_invalide', message: refus };
  }
  return null;
}
