import { describe, it, expect } from 'vitest';
import { planifierDuplication, nomDeLaCopie, type EtatDuplication } from '../src/ops/duplication/plan';

/**
 * LE PLAN D'UNE DUPLICATION ET SON EMPREINTE (lot 1, tâche 3 du plan `docs/superpowers/plans/2026-11-16-duplication-scenario-lot-1.md`).
 *
 * Les champs manquants se créent avec la définition de la SOURCE ; un conflit de type se signale sans rien toucher ; un
 * template absent, une destination sans WABA ou la même source et destination bloquent ; l'empreinte ne dépend que de
 * l'état lu, jamais des codes tirés au hasard par la copie.
 */

const etat = (over: Partial<EtatDuplication> = {}): EtatDuplication => ({
  source: { id: 'src', nom: 'Source' },
  destination: { id: 'dst', nom: 'Destination', codeClient: 'dst02' },
  scenario: {
    id: 'wf', nom: 'Accueil',
    graphe: {
      nodes: [
        { id: 'q1', type: 'question', position: { x: 0, y: 0 }, data: { body: 'Ville ?', champReponse: 'ville' } },
        { id: 't2', type: 'template', position: { x: 0, y: 0 }, data: { templateName: 'bienvenue', language: 'fr' } },
        { id: 'f3', type: 'field', position: { x: 0, y: 0 }, data: { fieldKey: 'score' } },
      ],
      edges: [],
    },
  },
  automationsDuScenario: [],
  automationsDeLaDestination: [],
  champsSource: [{ key: 'ville', label: 'Ville', type: 'text' }, { key: 'score', label: 'Score', type: 'number' }],
  champsDestination: [],
  nomsPrisDestination: [],
  templatesDestination: [{ nom: 'bienvenue', langue: 'fr', statut: 'APPROVED' }],
  offreOuvreScenarios: true,
  ...over,
});

describe('planifierDuplication : les champs', () => {
  it('une clé absente de la destination se crée avec la définition de la source', () => {
    const p = planifierDuplication(etat());
    expect(p.champsACreer).toEqual([{ key: 'ville', label: 'Ville', type: 'text' }, { key: 'score', label: 'Score', type: 'number' }]);
    expect(p.blocages).toEqual([]);
  });

  it('même type des deux côtés : ni créé ni signalé ; autre type : conflit, sans blocage', () => {
    const p = planifierDuplication(etat({ champsDestination: [{ key: 'ville', label: 'Commune', type: 'text' }, { key: 'score', label: 'Score', type: 'text' }] }));
    expect(p.champsACreer).toEqual([]);
    expect(p.champsEnConflit).toEqual([{ cle: 'score', typeSource: 'number', typeDestination: 'text' }]);
    expect(p.blocages).toEqual([]);
  });

  it('une clé sans définition dans la source n’est pas créée, et elle est signalée', () => {
    const p = planifierDuplication(etat({ champsSource: [{ key: 'ville', label: 'Ville', type: 'text' }] }));
    expect(p.champsACreer.map((c) => c.key)).toEqual(['ville']);
    expect(p.champsInconnus).toEqual(['score']);
    expect(p.signaux.some((s) => s.includes('score'))).toBe(true);
  });
});

describe('planifierDuplication : blocages et signaux', () => {
  it('destination sans WABA : bloqué', () => {
    expect(planifierDuplication(etat({ templatesDestination: null })).blocages.join(' ')).toContain('WABA');
  });

  it('template absent de la destination : bloqué, en le nommant avec sa langue', () => {
    const p = planifierDuplication(etat({ templatesDestination: [{ nom: 'bienvenue', langue: 'en_US', statut: 'APPROVED' }] }));
    expect(p.templatesAbsents).toEqual([{ nom: 'bienvenue', langue: 'fr' }]);
    expect(p.blocages.join(' ')).toContain('bienvenue (fr)');
  });

  it('source et destination identiques : bloqué', () => {
    expect(planifierDuplication(etat({ destination: { id: 'src', nom: 'Source', codeClient: 'src01' } })).blocages).toHaveLength(1);
  });

  it('template présent mais pas approuvé, offre sans scénarios : signalés sans blocage', () => {
    const p = planifierDuplication(etat({ templatesDestination: [{ nom: 'bienvenue', langue: 'fr', statut: 'PENDING' }], offreOuvreScenarios: false }));
    expect(p.blocages).toEqual([]);
    expect(p.templatesNonApprouves).toEqual([{ nom: 'bienvenue', langue: 'fr', statut: 'PENDING' }]);
    expect(p.signaux).toHaveLength(2);
  });
});

describe('le nom de la copie', () => {
  it('« X (copie) », puis « X (copie 2) », comparé sans la casse ni les espaces aux bords', () => {
    expect(nomDeLaCopie('Accueil', [])).toBe('Accueil (copie)');
    expect(nomDeLaCopie('Accueil', ['  accueil (COPIE) '])).toBe('Accueil (copie 2)');
    expect(nomDeLaCopie('Accueil', ['Accueil (copie)', 'Accueil (copie 2)'])).toBe('Accueil (copie 3)');
    expect(planifierDuplication(etat({ nomsPrisDestination: ['Accueil (copie)'] })).nomCopie).toBe('Accueil (copie 2)');
  });
});

describe('l’empreinte', () => {
  it('identique pour deux états identiques, alors que les codes de blocs sont tirés au hasard', () => {
    const a = planifierDuplication(etat());
    const b = planifierDuplication(etat());
    expect(a.graphe.graphe.nodes[0]!.data.code).not.toBe(b.graphe.graphe.nodes[0]!.data.code);
    expect(a.empreinte).toBe(b.empreinte);
    expect(a.empreinte).toMatch(/^[0-9a-f]{64}$/);
  });

  it('différente dès que le graphe, un champ, un déclencheur, un nom pris ou un template change', () => {
    const base = planifierDuplication(etat()).empreinte;
    const g = etat().scenario;
    const variantes: Array<Partial<EtatDuplication>> = [
      { scenario: { ...g, graphe: { ...g.graphe, nodes: g.graphe.nodes.slice(1) } } },
      { champsDestination: [{ key: 'ville', label: 'Ville', type: 'text' }] },
      { automationsDeLaDestination: [{ id: 'a', tenantId: 'dst', name: 'x', enabled: true, triggerKind: 'new_contact', triggerConfig: {}, conditionGroup: null, workflowId: 'w', startNodeId: null, possedePar: null, cooldownSeconds: null, maxFiresPerHour: null, accordMarketing: null }] },
      { nomsPrisDestination: ['Accueil (copie)'] },
      { templatesDestination: [{ nom: 'bienvenue', langue: 'fr', statut: 'PENDING' }] },
    ];
    for (const v of variantes) expect(planifierDuplication(etat(v)).empreinte).not.toBe(base);
  });

  it('ne dépend pas de l’ordre des clés des objets lus', () => {
    const a = etat();
    const b = etat({ champsSource: [{ type: 'text', label: 'Ville', key: 'ville' }, { type: 'number', key: 'score', label: 'Score' }] });
    expect(planifierDuplication(a).empreinte).toBe(planifierDuplication(b).empreinte);
  });
});
