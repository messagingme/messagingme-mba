import type { WorkflowGraph } from './graph';
import type { WorkflowRow } from './store.pg';
import type { Rayon } from './rayon';
import { refusDePublication } from './aller-a';
import { refusFichierSansSuite } from './question-piece';
import { refusSuiteQuiAttend } from './engine';
import { blocVerrouille, refusSelonLeVerrou, viseUnPremierBloc } from '../shopify/premier-bloc';

/** Ce qui empêche un graphe d'être mis en ligne, et le code que la console reconnaît. */
export interface RefusDeControle {
  code: 'fichier_sans_suite' | 'suite_qui_attend' | 'aller_a_invalide' | 'premier_bloc_verrouille';
  message: string;
}

/**
 * Les contrôles d'un graphe AVANT sa mise en ligne, dans l'ordre de la route de publication : la publication à la main
 * (`POST .../publish`) et la mise en ligne d'une version programmée (lot 3) passent par eux, sinon l'une laisserait
 * passer ce que l'autre refuse.
 * - Une Question qui attend un fichier relie « Fichier reçu » (décision de Julien du 2026-11-02).
 * - « Puis, sans attendre » ne mène qu'à des blocs qui n'attendent rien (décision du 2026-11-10).
 * - Le premier bloc d'une automation (rayons d'automation : Shopify au lot 5, HubSpot au lot 6) reste celui de la version
 *   en ligne, un template où rien ne mène (`refusDuVerrou`).
 * - Un « Aller à » vise un scénario existant du même rayon (RC5), jamais le premier bloc d'une autre automation. La liste
 *   du rayon ne se lit que s'il y a un saut ou un verrou, et une seule fois.
 */
export async function controlesDePublication(
  graphe: WorkflowGraph, id: string, scenariosDuRayon: () => Promise<WorkflowRow[]>, rayon: Rayon,
): Promise<RefusDeControle | null> {
  const sansSuite = refusFichierSansSuite(graphe);
  if (sansSuite !== null) return { code: 'fichier_sans_suite', message: sansSuite };
  const suiteQuiAttend = refusSuiteQuiAttend(graphe);
  if (suiteQuiAttend !== null) return { code: 'suite_qui_attend', message: suiteQuiAttend };
  let lue: WorkflowRow[] | null = null;
  const liste = async (): Promise<WorkflowRow[]> => (lue ??= await scenariosDuRayon());
  if (rayon !== 'general') {
    // La référence : la version en ligne ; un scénario jamais publié (une copie, graphe en ligne vide) n'a que son brouillon,
    // écrit par le serveur et gardé par l'enregistrement. Jamais le brouillon qu'on publie quand une version est en ligne :
    // un brouillon forgé se porterait garant de lui-même. Lot 6b (décision 41) : le verrou ne vaut que si la référence porte
    // un bloc marqué ; sinon le graphe publié ne doit pas en poser (`refusSelonLeVerrou`).
    const enPlace = (await liste()).find((w) => w.id === id) ?? null;
    const reference = enPlace === null ? null : enPlace.graph.nodes.length > 0 ? enPlace.graph : (enPlace.draftGraph ?? null);
    const refus = refusSelonLeVerrou(graphe, [reference], reference === null ? null : (blocVerrouille(reference)?.id ?? null));
    if (refus !== null) return { code: 'premier_bloc_verrouille', message: refus };
  }
  if (graphe.nodes.some((n) => n.type === 'aller_a')) {
    const autres = await liste();
    const refus = refusDePublication(graphe, id, autres);
    if (refus !== null) return { code: 'aller_a_invalide', message: refus };
    const leurs = autres.filter((w) => w.id !== id).flatMap((w) => (w.draftGraph ? [w.graph, w.draftGraph] : [w.graph]));
    if (viseUnPremierBloc(graphe, leurs)) {
      return { code: 'aller_a_invalide', message: 'un « Aller à » ne vise jamais le premier bloc d’une automation' };
    }
  }
  return null;
}
