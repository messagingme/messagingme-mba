import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { PgDuplicationStore } from '../src/ops/duplication/store.pg';
import { planifierDuplication, type EtatDuplication } from '../src/ops/duplication/plan';

/**
 * L'ÉCRITURE D'UNE DUPLICATION TIENT EN UNE TRANSACTION (lots 1 et 2, plans
 * `docs/superpowers/plans/2026-11-16-duplication-scenario-lot-1.md` et `…-lot-2.md`).
 *
 * Ce que ce test tient, sans base : `ecrire` ouvre UNE transaction, toutes ses requêtes passent par le client qui la tient
 * (jamais par le pool, qui gèlerait sous le verrou de nom), dans l'ordre qui rompt la dépendance croisée entre l'agent et
 * le scénario (dépendances, puis scénario, puis déclencheurs), et se termine par `commit`, ou par `rollback` sur une
 * erreur ; le client est toujours rendu. Le SQL lui-même est prouvé sur Postgres
 * (`tests/integration/ops-duplication.integration.test.ts`).
 *
 * Le faux client est une CLASSE dont la méthode lit `this` : un store qui détacherait `query` de son objet échouerait ici.
 */

class FauxClient {
  journal: string[] = [];
  rendu = 0;
  constructor(private readonly echecSur: RegExp | null) {}
  async query(sql: string): Promise<{ rows: unknown[]; rowCount: number }> {
    const s = sql.trim().replace(/\s+/g, ' ');
    this.journal.push(s.split(' ').slice(0, 3).join(' '));
    if (this.echecSur?.test(s)) throw new Error('panne provoquée');
    if (s.startsWith('select public_code')) return { rows: [{ public_code: 'dst02' }], rowCount: 1 };
    if (s.startsWith('insert into') && s.includes('returning id')) return { rows: [{ id: `copie-${this.journal.length}` }], rowCount: 1 };
    if (s.startsWith('insert into user_fields')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
  release(): void { this.rendu += 1; }
}

function monter(echecSur: RegExp | null) {
  const client = new FauxClient(echecSur);
  const parLePool: string[] = [];
  const pool = {
    connect: async () => client,
    query: async (sql: string) => { parLePool.push(sql); return { rows: [], rowCount: 0 }; },
  } as unknown as Pool;
  return { store: new PgDuplicationStore(pool), client, parLePool };
}

const etat: EtatDuplication = {
  source: { id: 'src', nom: 'Source' },
  destination: { id: 'dst', nom: 'Destination', codeClient: 'dst02' },
  scenario: {
    id: 'wf', nom: 'Accueil',
    graphe: {
      nodes: [
        { id: 'q1', type: 'question', position: { x: 0, y: 0 }, data: { body: 'Ville ?', champReponse: 'ville' } },
        { id: 'g2', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: 'ag-1' } },
      ],
      edges: [],
    },
  },
  automationsDuScenario: [{ rayon: 'general',
    id: 'a', tenantId: 'src', name: 'Accueil', enabled: true, triggerKind: 'tag_added', triggerConfig: { tag: 'vip' }, conditionGroup: null,
    workflowId: 'wf', startNodeId: null, possedePar: null, cooldownSeconds: null, maxFiresPerHour: null, accordMarketing: null,
  }],
  automationsDeLaDestination: [],
  champsSource: [{ key: 'ville', label: 'Ville', type: 'text' }],
  champsDestination: [],
  nomsPrisDestination: [],
  templatesDestination: [],
  modelesSource: [],
  flowsSource: [],
  indicesSource: [],
  offreOuvreScenarios: true,
  creditIaOuvert: true,
  dependances: {
    agents: [{
      id: 'ag-1', label: 'Conseiller', fiches: 2,
      outils: [{ id: 'o-http', nom: 'creer_lead', origine: 'http', proprietaire: false, binding: {}, requeteId: 'rq-1', gestes: [] }],
    }],
    requetes: [{ id: 'rq-1', label: 'Créer le lead', sourceId: 'src-1', variables: [] }],
    sources: [{ id: 'src-1', label: 'CRM', secret: true }],
    modelesEmail: [],
  },
  nomsPris: { agents: [], requetes: [], sources: [], modelesEmail: [], outils: [], flows: [] },
};
const scenario = { id: 'wf', nom: 'Accueil' };

describe('PgDuplicationStore.ecrire', () => {
  it('une transaction sur le client, sans dépendance cochée : verrou de nom, champ, scénario, déclencheur, commit ; rien par le pool', async () => {
    const { store, client, parLePool } = monter(null);
    const r = await store.ecrire('dst', 'src', scenario, planifierDuplication(etat));
    expect(r).toMatchObject({ nom: 'Accueil (copie)', champsCrees: ['ville'], declencheursCopies: 1 });
    expect(r.dependancesCopiees).toEqual({ agents: [], requetes: [], modelesEmail: [], sourcesAvecSecret: [] });
    expect(client.journal[0]).toBe('begin');
    expect(client.journal.at(-1)).toBe('commit');
    expect(client.journal.some((q) => q.startsWith('select pg_advisory_xact_lock'))).toBe(true);
    expect(client.journal.filter((q) => q.startsWith('insert into'))).toEqual(['insert into user_fields', 'insert into workflows', 'insert into automations']);
    expect(parLePool).toEqual([]);
    expect(client.rendu).toBe(1);
  });

  it('un agent coché : sa source, sa requête, l’agent et ses fiches, l’outil et sa liaison, PUIS le scénario et ses déclencheurs', async () => {
    const { store, client, parLePool } = monter(null);
    const r = await store.ecrire('dst', 'src', scenario, planifierDuplication(etat, { agents: ['ag-1'], requetes: [], modelesEmail: [] }));
    expect(client.journal.filter((q) => q.startsWith('insert into'))).toEqual([
      'insert into user_fields', 'insert into agent_tool_sources', 'insert into connector_requests', 'insert into agents',
      'insert into agent_knowledge', 'insert into agent_tools', 'insert into agent_tool_consommateurs', 'insert into workflows',
      'insert into automations',
    ]);
    expect(r.dependancesCopiees).toEqual({ agents: ['Conseiller'], requetes: ['Créer le lead'], modelesEmail: [], sourcesAvecSecret: ['CRM'] });
    expect(parLePool).toEqual([]);
  });

  it('🔴 un outil de l’espace partagé par deux agents cochés : UNE copie, liée à chacun', async () => {
    const { store, client } = monter(null);
    const deux: EtatDuplication = {
      ...etat,
      scenario: { ...etat.scenario, graphe: { ...etat.scenario.graphe, nodes: [
        ...etat.scenario.graphe.nodes, { id: 'g3', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: 'ag-2' } },
      ] } },
      dependances: { ...etat.dependances, agents: [...etat.dependances.agents, {
        id: 'ag-2', label: 'Vendeur', fiches: 0,
        outils: [{ id: 'o-http', nom: 'creer_lead', origine: 'http', proprietaire: false, binding: {}, requeteId: 'rq-1', gestes: [] }],
      }] },
    };
    await store.ecrire('dst', 'src', scenario, planifierDuplication(deux, { agents: ['ag-1', 'ag-2'], requetes: [], modelesEmail: [] }));
    const inserts = client.journal.filter((q) => q.startsWith('insert into'));
    expect(inserts.filter((q) => q === 'insert into agents')).toHaveLength(2);
    expect(inserts.filter((q) => q === 'insert into agent_tools')).toHaveLength(1);
    expect(inserts.filter((q) => q === 'insert into agent_tool_consommateurs')).toHaveLength(2);
  });

  it('une panne à la copie de l’agent : rollback, aucun commit, client rendu, erreur propagée', async () => {
    const { store, client } = monter(/^insert into agents/);
    await expect(store.ecrire('dst', 'src', scenario, planifierDuplication(etat, { agents: ['ag-1'], requetes: [], modelesEmail: [] })))
      .rejects.toThrow('panne provoquée');
    expect(client.journal).toContain('rollback');
    expect(client.journal).not.toContain('commit');
    expect(client.journal.some((q) => q.startsWith('insert into workflows'))).toBe(false);
    expect(client.rendu).toBe(1);
  });
});
