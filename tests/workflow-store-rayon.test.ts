import { describe, it, expect } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { PgWorkflowStore, etatDuScenario, nomPrisSousVerrou } from '../src/workflow/store.pg';

/**
 * 🔴 LE RAYON D'UN SCÉNARIO SE FILTRE DANS LE MAGASIN, PAS CHEZ LES APPELANTS (menu « Scénario », lot 1, migration 0293).
 *
 * Les listes prennent le rayon en paramètre REQUIS : le compilateur énumère chaque appelant, qui doit le nommer. Les
 * méthodes de l'API publique (`...ParApi`) ne servent que le Builder et filtrent `general` d'elles-mêmes. Les lectures
 * par identifiant (relecture du graphe d'un parcours, éditeur, lien de test) ignorent le rayon : un parcours en cours
 * relit son graphe quel que soit son rayon, et l'éditeur ouvre le scénario qu'on lui désigne dans l'espace.
 *
 * ⚠️ L'INVENTAIRE SUIT LA CLASSE, comme `tests/workflow-store-systeme.test.ts` : une méthode publique ajoutée doit être
 * rangée ici. Ce que la base en fait vraiment : `tests/integration/workflow-rayon.integration.test.ts`.
 */

interface Requete { sql: string; params: unknown[] }

function banc() {
  const requetes: Requete[] = [];
  const ligne = {
    id: 'w1', tenant_id: 't1', name: 'n', code: null, graph: { nodes: [], edges: [] }, draft_graph: null,
    published_at: null, created_at: new Date(), updated_at: new Date(), node_count: 0, has_draft: false,
    brouillon: false, test_token: 'jeton', systeme: null, origine: 'api', rayon: 'general',
    // Les colonnes de la publication programmée (lot 3), sous leurs alias de lecture.
    graphe: { nodes: [], edges: [] }, le: new Date(), par: null,
  };
  const query = async (sql: string, params: unknown[] = []) => {
    requetes.push({ sql: sql.replace(/\s+/g, ' '), params });
    // Le verrou de nom ne doit rien trouver : on veut voir l'écriture qui suit.
    if (/lower\(btrim\(name\)\)/.test(sql)) return { rows: [], rowCount: 0 };
    return { rows: [ligne], rowCount: 1 };
  };
  const pool = { query, connect: async () => ({ query, release: () => {} }) } as unknown as Pool;
  return { requetes, store: new PgWorkflowStore(pool), query };
}

const lectures = (r: Requete[]): Requete[] => r.filter((q) => /\b(from|update) workflows\b/.test(q.sql));

/** Les listes : rayon passé en paramètre, et filtré. */
const LISTES: Record<string, (s: PgWorkflowStore) => Promise<unknown>> = {
  listResume: (s) => s.listResume('t1', 'shopify'),
  listNoms: (s) => s.listNoms('t1', 'shopify'),
  listPublies: (s) => s.listPublies('t1', 'shopify'),
  list: (s) => s.list('t1', 'shopify'),
};

/** Les méthodes de l'API publique : le Builder seul, sans paramètre à oublier. */
const API: Record<string, (s: PgWorkflowStore) => Promise<unknown>> = {
  creerPublieParApi: (s) => s.creerPublieParApi('t1', 'nom', { nodes: [], edges: [] }),
  lireParApi: (s) => s.lireParApi('t1', 'w1'),
  remplacerPublieParApi: (s) => s.remplacerPublieParApi('w1', 't1', 'nom', { nodes: [], edges: [] }, () => null),
  supprimerParApi: (s) => s.supprimerParApi('w1', 't1'),
};

/**
 * Délibérément sans filtre de rayon, et pourquoi : `getById` relit le graphe d'un parcours (tous rayons) et sert
 * l'éditeur et les gardes qui comparent `row.rayon` elles-mêmes ; `update`, `publish`, `remove` sont l'éditeur, par
 * identifiant dans l'espace ; le lien de test teste un scénario de n'importe quel rayon depuis son builder ;
 * `utilisationsDuScenario` dit tout ce qui utilise un scénario ; `insert` reçoit le rayon de la ligne qu'il crée ;
 * `assurerScenarioSysteme` et `designation` ne servent que la ligne système.
 */
const SANS_FILTRE = [
  'getById', 'update', 'publish', 'remove', 'ensureTestToken', 'findByTestToken', 'utilisationsDuScenario', 'insert',
  'assurerScenarioSysteme', 'designation',
  // Lot 2 : les lanceurs d'un scénario désigné par son identifiant (ne lit pas `workflows`), et les graphes publiés des
  // scénarios d'une liste d'automations, par identifiant (le rayon de l'automation est déjà celui de son scénario).
  'lanceursDuScenario', 'graphesPublies',
  // Lot 3 : la publication programmée, par identifiant dans l’espace comme `publish` ; et ses lectures pour la mise en
  // ligne et le filet, qui servent toutes les versions programmées, quel que soit leur rayon.
  'programmer', 'publicationProgrammee', 'programmeesDeLEspace', 'programmeesAnciennes', 'mettreEnLigneLaVersionProgrammee',
  'annulerProgrammation',
  // Lot 5 : le ménage des templates de bloc relit si un graphe de l'espace, TOUS rayons, nomme encore un template.
  'nommeLeModele',
];

describe('🔴 le magasin de scénarios ne liste que le rayon demandé', () => {
  it('l’inventaire est complet : chaque méthode publique est rangée', () => {
    const methodes = Object.getOwnPropertyNames(PgWorkflowStore.prototype).filter((m) => m !== 'constructor').sort();
    expect(methodes).toEqual([...Object.keys(LISTES), ...Object.keys(API), ...SANS_FILTRE].sort());
  });

  for (const [nom, appeler] of Object.entries(LISTES)) {
    it(`${nom} : filtre \`rayon\` sur le paramètre, et le rayon demandé voyage dans les paramètres`, async () => {
      const { requetes, store } = banc();
      await appeler(store);
      const l = lectures(requetes);
      expect(l.length, nom).toBeGreaterThan(0);
      for (const q of l) {
        expect(q.sql, nom).toMatch(/\brayon = \$\d+/);
        expect(q.params, nom).toContain('shopify');
      }
    });
  }

  for (const [nom, appeler] of Object.entries(API)) {
    it(`${nom} : ne lit ou n’écrit qu’un scénario du Builder (rayon \`general\`)`, async () => {
      const { requetes, store } = banc();
      await appeler(store);
      // Les usages d'un scénario (`UTILISATIONS`, une union) disent TOUT ce qui le désigne, quel que soit le rayon.
      const l = lectures(requetes).filter((q) => !q.sql.includes('union all'));
      expect(l.length, nom).toBeGreaterThan(0);
      for (const q of l) {
        const enDur = q.sql.includes("rayon = 'general'");
        const parametre = /\brayon = \$\d+/.test(q.sql) && q.params.includes('general');
        expect(enDur || parametre, `${nom} : ${q.sql}`).toBe(true);
      }
    });
  }

  it('getById ne filtre pas le rayon (un parcours Shopify en cours relit son graphe), et rend celui de la ligne', async () => {
    const { requetes, store } = banc();
    const row = await store.getById('w1', 't1');
    for (const q of lectures(requetes)) expect(q.sql).not.toMatch(/\brayon =/);
    expect(row?.rayon).toBe('general');
  });

  it('insert écrit le rayon qu’on lui donne', async () => {
    const { requetes, store } = banc();
    await store.insert('t1', 'nom', { nodes: [], edges: [] }, 'hubspot');
    const insertion = requetes.find((q) => q.sql.startsWith('insert into workflows'));
    expect(insertion?.sql).toMatch(/\brayon\b/);
    expect(insertion?.params).toContain('hubspot');
  });

  it('le nom est unique PAR rayon : la recherche de doublon filtre le rayon donné', async () => {
    const { requetes, query } = banc();
    await nomPrisSousVerrou({ query } as unknown as PoolClient, 't1', 'Panier', null, 'shopify');
    const doublon = requetes.find((q) => /lower\(btrim\(name\)\)/.test(q.sql));
    expect(doublon?.sql).toMatch(/\brayon = \$\d+/);
    expect(doublon?.params).toContain('shopify');
  });
});

describe('🔴 etatDuScenario (le bouton d’un lien de chaîne, la bulle d’un widget) ne démarre que le Builder', () => {
  const publie = { nodes: [{ id: 'n', type: 'tag' as const, position: { x: 0, y: 0 }, data: {} }], edges: [] };
  it('un scénario publié d’un autre rayon se lit « inconnu »', () => {
    expect(etatDuScenario({ graph: publie, rayon: 'general' })).toBe('ok');
    expect(etatDuScenario({ graph: publie, rayon: 'shopify' })).toBe('inconnu');
    expect(etatDuScenario({ graph: publie, rayon: 'hubspot' })).toBe('inconnu');
  });
});
