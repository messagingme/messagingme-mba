import { SORTIE_HUMAIN } from '../../web/lib/partage/sorties-agent';
import { grapheDuRun } from './executor';
import type { WorkflowGraph } from './graph';
import type { PgWorkflowRunStore } from './run-store.pg';
import type { PgWorkflowStore } from './store.pg';

/**
 * La sortie `humain` de ce bloc agent mène-t-elle à une fin MUETTE ? Alors aucune branche ne parle après l'escalade, et
 * la phrase de l'agent (« un conseiller prend le relais ») est la seule que le contact recevra : le cerveau doit la
 * garder (`ContexteTourAgent.repondeur`). C'est le montage du répondeur (`grapheDuRepondeur`) et celui d'une recette
 * de l'API (`compilerRecette`).
 *
 * Muette : une suite de blocs Action (étiquette, champ, consentement : rien ne part au contact), une arête au plus
 * chacun, qui finit sur rien. Tout autre bloc est tenu pour PARLANT, une condition ou une attente comprises : c'est le
 * comportement d'avant (phrase jetée), et se tromper dans l'autre sens ferait parler deux voix. « Passer à un humain »
 * et une sortie non câblée n'en sont pas non plus : l'un comme l'autre passent le fil à l'équipe PENDANT la sortie,
 * avant l'escalade de l'agent, qui rend alors `false`, et le tour jette la phrase comme une main perdue
 * (`src/repondeur/graphe.ts`, `run-turn`). Ce mécanisme-là, ce critère ne le change pas (`todo.md`).
 */
export function brancheHumainMuette(graph: WorkflowGraph, nodeId: string): boolean {
  const depart = graph.edges.filter((e) => e.source === nodeId && e.sourceHandle === `sortie:${SORTIE_HUMAIN}`);
  if (depart.length !== 1) return false;
  const vus = new Set<string>();
  let courant: string | undefined = depart[0]!.target;
  while (courant !== undefined) {
    if (vus.has(courant)) return false;
    vus.add(courant);
    const ici: string = courant;
    const bloc = graph.nodes.find((n) => n.id === ici);
    if (!bloc) return false;
    if (bloc.type !== 'action') return false;
    const apres = graph.edges.filter((e) => e.source === ici);
    if (apres.length > 1) return false;
    courant = apres[0]?.target;
  }
  return true;
}

/**
 * Le câblage de `RunTurnDeps.estRepondeur` : le répondeur de l'espace, ou un parcours dont l'escalade de ce bloc finit
 * muette, sur le graphe que le parcours JOUE (`grapheDuRun` : le figé s'il en porte un, le publié sinon). Parcours ou
 * scénario introuvable : `false`, la phrase est jetée comme avant.
 */
export function creerSeTaitApresEscalade(deps: {
  workflows: Pick<PgWorkflowStore, 'designation' | 'getById'>;
  runs: Pick<PgWorkflowRunStore, 'byId'>;
}): (tenantId: string, workflowId: string, runId: string, nodeId: string) => Promise<boolean> {
  return async (tenantId, workflowId, runId, nodeId) => {
    if ((await deps.workflows.designation(workflowId, tenantId))?.systeme === 'repondeur') return true;
    const run = await deps.runs.byId(tenantId, runId);
    if (!run) return false;
    const graphe = await grapheDuRun(run, async () => (await deps.workflows.getById(workflowId, tenantId))?.graph ?? null);
    return graphe !== null && brancheHumainMuette(graphe, nodeId);
  };
}
