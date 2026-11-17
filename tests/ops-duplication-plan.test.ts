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
  templatesDestination: [{ nom: 'bienvenue', langue: 'fr', statut: 'APPROVED', boutons: [] }],
  templatesSource: [{ nom: 'bienvenue', langue: 'fr', statut: 'APPROVED', boutons: [] }],
  offreOuvreScenarios: true,
  dependances: { agents: [], requetes: [], sources: [], modelesEmail: [] },
  nomsPris: { agents: [], requetes: [], sources: [], modelesEmail: [], outils: [] },
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
    const p = planifierDuplication(etat({ templatesDestination: [{ nom: 'bienvenue', langue: 'en_US', statut: 'APPROVED', boutons: [] }] }));
    expect(p.templatesAbsents).toEqual([{ nom: 'bienvenue', langue: 'fr' }]);
    expect(p.blocages.join(' ')).toContain('bienvenue (fr)');
  });

  it('source et destination identiques : bloqué', () => {
    expect(planifierDuplication(etat({ destination: { id: 'src', nom: 'Source', codeClient: 'src01' } })).blocages).toHaveLength(1);
  });

  it('template présent mais pas approuvé, offre sans scénarios : signalés sans blocage', () => {
    const p = planifierDuplication(etat({ templatesDestination: [{ nom: 'bienvenue', langue: 'fr', statut: 'PENDING', boutons: [] }], offreOuvreScenarios: false }));
    expect(p.blocages).toEqual([]);
    expect(p.templatesNonApprouves).toEqual([{ nom: 'bienvenue', langue: 'fr', statut: 'PENDING', boutons: [] }]);
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
      { templatesDestination: [{ nom: 'bienvenue', langue: 'fr', statut: 'PENDING', boutons: [] }] },
    ];
    for (const v of variantes) expect(planifierDuplication(etat(v)).empreinte).not.toBe(base);
  });

  it('ne dépend pas de l’ordre des clés des objets lus', () => {
    const a = etat();
    const b = etat({ champsSource: [{ type: 'text', label: 'Ville', key: 'ville' }, { type: 'number', key: 'score', label: 'Score' }] });
    expect(planifierDuplication(a).empreinte).toBe(planifierDuplication(b).empreinte);
  });
});

describe('lot 2 : les jaunes du lot 1 et les dépendances dans le plan', () => {
  it('l’empreinte ne dépend pas de l’ordre des templates rendu par Meta', () => {
    const t1 = { nom: 'a', langue: 'fr', statut: 'APPROVED', boutons: [] };
    const t2 = { nom: 'b', langue: 'fr', statut: 'APPROVED', boutons: [] };
    expect(planifierDuplication(etat({ templatesDestination: [t1, t2], templatesSource: [t2, t1] })).empreinte)
      .toBe(planifierDuplication(etat({ templatesDestination: [t2, t1], templatesSource: [t1, t2] })).empreinte);
  });

  it('un template réutilisé dont les boutons diffèrent de la source : signalé, sans blocage', () => {
    const p = planifierDuplication(etat({
      templatesDestination: [{ nom: 'bienvenue', langue: 'fr', statut: 'APPROVED', boutons: [{ type: 'QUICK_REPLY', texte: 'Non' }] }],
      templatesSource: [{ nom: 'bienvenue', langue: 'fr', statut: 'APPROVED', boutons: [{ type: 'QUICK_REPLY', texte: 'Oui' }] }],
    }));
    expect(p.blocages).toEqual([]);
    expect(p.signaux.some((s) => s.includes('pas les mêmes boutons'))).toBe(true);
  });

  it('les templates de la source illisibles : « boutons non comparés »', () => {
    expect(planifierDuplication(etat({ templatesSource: null })).signaux.some((s) => s.includes('pas été comparés'))).toBe(true);
  });

  it('une image /m/ de la source est signalée', () => {
    const g = etat().scenario;
    const p = planifierDuplication(etat({
      scenario: { ...g, graphe: { nodes: [...g.graphe.nodes, { id: 'q9', type: 'quick_message', position: { x: 0, y: 0 }, data: { imageUrl: 'https://api.messagingme.app/m/x.jpg' } }], edges: [] } },
    }));
    expect(p.signaux.some((s) => s.includes('hébergées par l’espace source'))).toBe(true);
  });

  it('les champs d’une dépendance cochée entrent dans champsACreer ; une clé système jamais', () => {
    const g = etat().scenario;
    const p = planifierDuplication(etat({
      scenario: { ...g, graphe: { nodes: [...g.graphe.nodes, { id: 'm9', type: 'email', position: { x: 0, y: 0 }, data: { templateId: 'me-1' } }], edges: [] } },
      champsSource: [{ key: 'ville', label: 'Ville', type: 'text' }, { key: 'score', label: 'Score', type: 'number' }, { key: 'code_promo', label: 'Code promo', type: 'text' }],
      dependances: { agents: [], requetes: [], sources: [], modelesEmail: [{ id: 'me-1', nom: 'Bienvenue', sujet: 'Bonjour {{prenom}}', corps: '{{code_promo}}' }] },
    }), { agents: [], requetes: [], modelesEmail: ['me-1'] });
    expect(p.champsACreer.map((c) => c.key)).toContain('code_promo');
    expect(p.champsACreer.map((c) => c.key)).not.toContain('prenom');
    expect(p.copies.modelesEmail).toEqual([{ id: 'me-1', nom: 'Bienvenue' }]);
  });

  it('les cases cochées n’entrent pas dans l’empreinte', () => {
    expect(planifierDuplication(etat(), { agents: [], requetes: [], modelesEmail: [] }).empreinte).toBe(planifierDuplication(etat()).empreinte);
  });
});
