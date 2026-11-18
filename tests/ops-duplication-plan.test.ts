import { describe, it, expect } from 'vitest';
import type { TemplateSummary } from '../src/meta/templates';
import { planifierDuplication, nomDeLaCopie, type EtatDuplication } from '../src/ops/duplication/plan';
import { PLAFOND_META } from '../src/ops/duplication/meta';

/**
 * LE PLAN D'UNE DUPLICATION ET SON EMPREINTE (lot 1, tâche 3 du plan `docs/superpowers/plans/2026-11-16-duplication-scenario-lot-1.md` ;
 * lot 3 : les templates absents ont leur case).
 *
 * Les champs manquants se créent avec la définition de la SOURCE ; un conflit de type se signale sans rien toucher ; une
 * destination sans WABA ou la même source et destination bloquent, un template absent plus (lot 3) ; l'empreinte ne
 * dépend que de l'état lu, jamais des codes tirés au hasard par la copie.
 */

const modele = (over: Partial<TemplateSummary> = {}): TemplateSummary => ({
  id: 'm', name: 'bienvenue', status: 'APPROVED', category: 'MARKETING', language: 'fr', body: 'Bonjour', headerFormat: null,
  isCarousel: false, editable: true, ...over,
});

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
  modelesSource: [modele()],
  flowsSource: [],
  indicesSource: [],
  offreOuvreScenarios: true,
  creditIaOuvert: true,
  dependances: { agents: [], requetes: [], sources: [], modelesEmail: [] },
  nomsPris: { agents: [], requetes: [], sources: [], modelesEmail: [], outils: [], flows: [] },
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

  it('template absent de la destination : plus bloqué (lot 3) ; il a sa case, et décoché son bloc arrive débranché', () => {
    const p = planifierDuplication(etat({ templatesDestination: [{ nom: 'bienvenue', langue: 'en_US', statut: 'APPROVED', boutons: [] }] }));
    expect(p.templatesAbsents).toEqual([{ nom: 'bienvenue', langue: 'fr' }]);
    expect(p.blocages).toEqual([]);
    expect(p.meta.templates.map((t) => [t.nom, t.langue, t.etat])).toEqual([['bienvenue', 'fr', 'a_recreer']]);
    expect(p.templatesADebrancher).toEqual(['t2']);
    const coche = planifierDuplication(etat({ templatesDestination: [] }), { agents: [], requetes: [], modelesEmail: [], templates: [{ nom: 'bienvenue', langue: 'fr' }] });
    expect(coche.copiesMeta.templates).toEqual([{ nom: 'bienvenue', langue: 'fr', flows: [] }]);
    expect(coche.templatesADebrancher).toEqual([]);
  });

  it(`au-delà de ${PLAFOND_META} templates et Flows cochés à recréer : bloqué, avec la raison`, () => {
    const g = etat().scenario;
    const noms = Array.from({ length: PLAFOND_META + 1 }, (_, i) => `modele_${i}`);
    const p = planifierDuplication(etat({
      scenario: { ...g, graphe: { nodes: noms.map((n, i) => ({ id: `t${i}`, type: 'template' as const, position: { x: 0, y: 0 }, data: { templateName: n, language: 'fr' } })), edges: [] } },
      templatesDestination: [],
      modelesSource: noms.map((n) => modele({ name: n })),
    }), { agents: [], requetes: [], modelesEmail: [], templates: noms.map((n) => ({ nom: n, langue: 'fr' })) });
    expect(p.blocages.join(' ')).toContain(`plus de ${PLAFOND_META} templates et Flows`);
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
      { automationsDeLaDestination: [{ rayon: 'general', id: 'a', tenantId: 'dst', name: 'x', enabled: true, triggerKind: 'new_contact', triggerConfig: {}, conditionGroup: null, workflowId: 'w', startNodeId: null, possedePar: null, cooldownSeconds: null, maxFiresPerHour: null, accordMarketing: null }] },
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
    const fr = { nom: 'bienvenue', langue: 'fr', statut: 'APPROVED', boutons: [] };
    const en = { nom: 'bienvenue', langue: 'en_US', statut: 'APPROVED', boutons: [] };
    const g = etat().scenario;
    const deux = { ...g, graphe: { nodes: [...g.graphe.nodes, { id: 't9', type: 'template' as const, position: { x: 0, y: 0 }, data: { templateName: 'bienvenue', language: 'en_US' } }], edges: [] } };
    const s = [modele(), modele({ language: 'en_US' })];
    expect(planifierDuplication(etat({ scenario: deux, templatesDestination: [fr, en], modelesSource: s })).empreinte)
      .toBe(planifierDuplication(etat({ scenario: deux, templatesDestination: [en, fr], modelesSource: [...s].reverse() })).empreinte);
  });

  it('un template que le scénario n’envoie pas, créé dans l’une des deux WABA, ne change pas l’empreinte (relecture du lot 2)', () => {
    const base = planifierDuplication(etat()).empreinte;
    const ailleurs = { nom: 'promo_ete', langue: 'fr', statut: 'APPROVED', boutons: [] };
    expect(planifierDuplication(etat({ templatesDestination: [...etat().templatesDestination!, ailleurs] })).empreinte).toBe(base);
    expect(planifierDuplication(etat({ modelesSource: [modele(), modele({ name: 'promo_ete' })] })).empreinte).toBe(base);
  });

  it('l’adresse signée d’un média de la source, qui change à chaque lecture, ne change pas l’empreinte', () => {
    const a = planifierDuplication(etat({ modelesSource: [modele({ headerFormat: 'IMAGE', headerMediaUrl: 'https://cdn/h.jpg?oe=1' })] })).empreinte;
    const b = planifierDuplication(etat({ modelesSource: [modele({ headerFormat: 'IMAGE', headerMediaUrl: 'https://cdn/h.jpg?oe=2' })] })).empreinte;
    expect(a).toBe(b);
  });

  it('un template réutilisé dont les boutons diffèrent de la source : signalé, sans blocage', () => {
    const p = planifierDuplication(etat({
      templatesDestination: [{ nom: 'bienvenue', langue: 'fr', statut: 'APPROVED', boutons: [{ type: 'QUICK_REPLY', texte: 'Non' }] }],
      modelesSource: [modele({ buttons: [{ type: 'QUICK_REPLY', text: 'Oui' }] })],
    }));
    expect(p.blocages).toEqual([]);
    expect(p.signaux.some((s) => s.includes('pas les mêmes boutons'))).toBe(true);
  });

  it('les templates de la source illisibles : « boutons non comparés »', () => {
    expect(planifierDuplication(etat({ modelesSource: null })).signaux.some((s) => s.includes('pas été comparés'))).toBe(true);
  });

  it('une image /m/ de la source est signalée', () => {
    const g = etat().scenario;
    const p = planifierDuplication(etat({
      scenario: { ...g, graphe: { nodes: [...g.graphe.nodes, { id: 'q9', type: 'quick_message', position: { x: 0, y: 0 }, data: { imageUrl: 'https://api.messagingme.app/m/01j7zq8h3m4n5p6q7r8s9t0v1w.jpg' } }], edges: [] } },
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

describe('relecture du lot 2 (jaunes partis avec le lot 3)', () => {
  const SCN = '0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';
  const avecAgent = (over: Partial<EtatDuplication> = {}): EtatDuplication => {
    const g = etat().scenario;
    return etat({
      scenario: { ...g, graphe: { nodes: [...g.graphe.nodes, { id: 'a9', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: 'ag-1' } }], edges: [] } },
      dependances: { agents: [{ id: 'ag-1', label: 'Conseiller', fiches: 0, outils: [] }], requetes: [], sources: [], modelesEmail: [] },
      ...over,
    });
  };
  const signaleLeCredit = (p: ReturnType<typeof planifierDuplication>) => p.signaux.some((s) => s.includes('crédit IA'));

  it('une destination sans crédit IA est signalée quand un agent est proposé, sans blocage', () => {
    const p = planifierDuplication(avecAgent({ creditIaOuvert: false }));
    expect(signaleLeCredit(p)).toBe(true);
    expect(p.blocages).toEqual([]);
    expect(signaleLeCredit(planifierDuplication(avecAgent()))).toBe(false);
    expect(signaleLeCredit(planifierDuplication(etat({ creditIaOuvert: false })))).toBe(false);
  });

  it('les champs de chaque dépendance au récapitulatif : ceux que sa copie créerait, sans ceux que la destination a', () => {
    const g = etat().scenario;
    const p = planifierDuplication(etat({
      scenario: { ...g, graphe: { nodes: [...g.graphe.nodes, { id: 'm9', type: 'email', position: { x: 0, y: 0 }, data: { templateId: 'me-1' } }], edges: [] } },
      champsSource: [...etat().champsSource, { key: 'code_promo', label: 'Code promo', type: 'text' }, { key: 'civilite', label: 'Civilité', type: 'text' }],
      champsDestination: [{ key: 'civilite', label: 'Civilité', type: 'text' }],
      dependances: { agents: [], requetes: [], sources: [], modelesEmail: [{ id: 'me-1', nom: 'Bienvenue', sujet: '{{civilite}} {{prenom}}', corps: '{{code_promo}}' }] },
    }));
    expect(p.dependances.modelesEmail[0]!.champs).toEqual(['code_promo']);
  });

  it('🔴 un outil de l’agent qui vise un bloc absent du graphe copié ne suit pas ; un bloc présent, si', () => {
    const present = 'nod_src01_01J00000000000000000000001';
    const absent = 'nod_src01_01J00000000000000000000002';
    const g = etat().scenario;
    const outil = (id: string, nom: string, code: string) => ({
      id, nom, origine: 'mba' as const, proprietaire: true, requeteId: null, gestes: [], binding: { handler: 'envoyer_bloc', workflowId: SCN, code },
    });
    const p = planifierDuplication(etat({
      scenario: {
        id: SCN, nom: 'Accueil',
        graphe: {
          nodes: [
            ...g.graphe.nodes,
            { id: 'r7', type: 'quick_message', position: { x: 0, y: 0 }, data: { body: 'Relance', code: present } },
            { id: 'a9', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: 'ag-1' } },
          ],
          edges: [],
        },
      },
      dependances: {
        agents: [{ id: 'ag-1', label: 'Conseiller', fiches: 0, outils: [outil('o1', 'relancer', present), outil('o2', 'relancer_vieux', absent)] }],
        requetes: [], sources: [], modelesEmail: [],
      },
    }));
    expect(p.dependances.agents[0]!.outilsCopies.map((o) => o.nom)).toEqual(['relancer']);
    expect(p.dependances.agents[0]!.outilsNonCopies).toEqual([{ nom: 'relancer_vieux', raison: 'cible_illisible' }]);
  });
});
