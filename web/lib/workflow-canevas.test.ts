import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from './api/scenarios';
import { toRF } from './workflow-canevas';

/**
 * LE PREMIER BLOC VERROUILLÉ D'UN SCÉNARIO D'AUTOMATION SUR LA TOILE (menu « Scénario », relecture de 5c). La touche
 * Retour arrière le laissait en place mais détachait sa suite : React Flow 12 supprime les flèches d'un bloc sélectionné
 * avant que le filtre de `onNodesChange` ne retire sa suppression. `deletable: false` l'exclut de la suppression au
 * clavier, flèches comprises ; un bloc de la suite reste supprimable.
 */
describe('toRF : le premier bloc verrouillé', () => {
  const graphe: WorkflowGraph = {
    nodes: [
      { id: 'n1', type: 'template', position: { x: 0, y: 0 }, data: { verrouille: true, templateName: 'commande', language: 'fr' } },
      { id: 'n2', type: 'quick_message', position: { x: 0, y: 200 }, data: { body: 'Merci !' } },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
  };

  it('🔴 ne se supprime pas au clavier : deletable false sur lui, et sur lui seul', () => {
    const { nodes } = toRF(graphe);
    expect(nodes.find((n) => n.id === 'n1')?.deletable).toBe(false);
    expect(nodes.find((n) => n.id === 'n2')?.deletable).toBeUndefined();
  });

  it('un bloc sans la marque reste supprimable, même un template', () => {
    const { nodes } = toRF({ ...graphe, nodes: [{ ...graphe.nodes[0]!, data: { templateName: 'commande', language: 'fr' } }] });
    expect(nodes[0]?.deletable).toBeUndefined();
  });
});
