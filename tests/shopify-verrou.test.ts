import { describe, it, expect } from 'vitest';
import { refusDuVerrou, viseUnPremierBloc } from '../src/shopify/premier-bloc';
import { grapheDUneLigne } from '../src/shopify/lignes-gestion';
import type { WorkflowGraph } from '../src/workflow/graph';

/**
 * LE VERROU DU PREMIER BLOC (menu « Scénario », décisions 13 et 23, lot 5 tâche 9) : dans un scénario du rayon Shopify, le
 * bloc marqué par le serveur reste le MÊME, reste un template, et rien n'y mène (ni flèche, ni « Aller à »). Le marquer,
 * le démarquer ou en marquer un autre par un corps reçu est refusé : la marque n'est posée que par le serveur.
 */

const base = (): WorkflowGraph => ({
  nodes: [
    { id: 'depart', type: 'template', position: { x: 0, y: 0 }, data: { verrouille: true, templateName: 'commande_payee', code: 'nod_c_1' } },
    { id: 'merci', type: 'quick_message', position: { x: 0, y: 1 }, data: { body: 'Merci', code: 'nod_c_2' } },
  ],
  edges: [{ id: 'e1', source: 'depart', target: 'merci', sourceHandle: 'btn:0' }],
});

describe('le verrou du premier bloc', () => {
  it('le graphe d’une ligne neuve, puis avec sa suite, passent', () => {
    expect(refusDuVerrou(grapheDUneLigne(), 'depart')).toBeNull();
    expect(refusDuVerrou(base(), 'depart')).toBeNull();
  });

  it('🔴 le premier bloc supprimé, démarqué, déplacé sur un autre bloc, ou doublé : refusé', () => {
    const g = base();
    const sansLui: WorkflowGraph = { nodes: g.nodes.filter((n) => n.id !== 'depart'), edges: [] };
    const demarque: WorkflowGraph = { ...g, nodes: g.nodes.map((n) => (n.id === 'depart' ? { ...n, data: { templateName: 'commande_payee' } } : n)) };
    // Déplacé : la marque passe sur un autre template, où rien ne mène (sans flèche) : seule l'identité le trahit.
    const deplace: WorkflowGraph = {
      nodes: g.nodes.map((n) => (n.id === 'depart' ? { ...n, data: { templateName: 'commande_payee' } } : { ...n, type: 'template' as const, data: { verrouille: true } })),
      edges: [],
    };
    const double: WorkflowGraph = { ...g, nodes: g.nodes.map((n) => ({ ...n, type: 'template' as const, data: { ...n.data, verrouille: true } })) };
    for (const [nom, graphe] of [['supprimé', sansLui], ['démarqué', demarque], ['déplacé', deplace], ['doublé', double]] as const) {
      expect(refusDuVerrou(graphe, 'depart'), nom).toMatch(/ne se supprime pas et ne se déplace pas/);
    }
  });

  it('🔴 le premier bloc reste un template', () => {
    const g = base();
    const change: WorkflowGraph = { ...g, nodes: g.nodes.map((n) => (n.id === 'depart' ? { ...n, type: 'quick_message' as const } : n)) };
    expect(refusDuVerrou(change, 'depart')).toMatch(/template/);
  });

  it('🔴 rien ne mène au premier bloc : ni flèche, ni « Aller à » du scénario', () => {
    const g = base();
    expect(refusDuVerrou({ ...g, edges: [...g.edges, { id: 'e2', source: 'merci', target: 'depart' }] }, 'depart')).toMatch(/rien n’y mène/);
    const saut: WorkflowGraph = {
      nodes: [...g.nodes, { id: 'saut', type: 'aller_a', position: { x: 0, y: 2 }, data: { cible: 'nod_c_1' } }],
      edges: [...g.edges, { id: 'e3', source: 'merci', target: 'saut' }],
    };
    expect(refusDuVerrou(saut, 'depart')).toMatch(/Aller à/);
  });

  it('un scénario en place sans premier bloc (attendu null) : tout enregistrement est refusé', () => {
    expect(refusDuVerrou(base(), null)).toMatch(/premier bloc/);
  });

  it('🔴 un « Aller à » d’un autre scénario vers un premier bloc verrouillé est vu', () => {
    const saut: WorkflowGraph = {
      nodes: [
        { id: 'a', type: 'template', position: { x: 0, y: 0 }, data: { verrouille: true } },
        { id: 'saut', type: 'aller_a', position: { x: 0, y: 1 }, data: { cible: 'nod_c_1' } },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'saut' }],
    };
    expect(viseUnPremierBloc(saut, [base()])).toBe(true);
    expect(viseUnPremierBloc(saut, [{ ...base(), nodes: base().nodes.map((n) => ({ ...n, data: { ...n.data, verrouille: undefined } })) }])).toBe(false);
    // Vers un autre bloc du même scénario cible : permis.
    expect(viseUnPremierBloc({ ...saut, nodes: saut.nodes.map((n) => (n.id === 'saut' ? { ...n, data: { cible: 'nod_c_2' } } : n)) }, [base()])).toBe(false);
  });
});
