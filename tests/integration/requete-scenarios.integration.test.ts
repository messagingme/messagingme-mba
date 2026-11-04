import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgRequeteStore } from '../../src/agent/requetes.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LES SCÉNARIOS QUI DÉSIGNENT UNE REQUÊTE (2026-11-04). Un bloc « Appel API » désigne sa requête dans le graphe du
 * scénario, sans clé étrangère : la vue d'une requête les relit, et la route refuse de la supprimer tant qu'il y en a.
 *
 * 🔴 POURQUOI EN INTÉGRATION. Tout est dans le SQL du magasin : la lecture du jsonb, publié ET brouillon, et surtout le
 * filtre d'espace, sans lequel le scénario d'un autre client bloquerait la suppression, ou y laisserait lire son nom.
 */
describe.skipIf(!url)('les scénarios qui désignent une requête (Postgres)', () => {
  let pool: Pool;
  let requetes: PgRequeteStore;
  let tenantId: string;
  let autreTenantId: string;
  let sourceId: string;

  const graphe = (requestId: string) => JSON.stringify({
    nodes: [{ id: 'n1', type: 'http', position: { x: 0, y: 0 }, data: { requestId, champCible: '' } }],
    edges: [],
  });
  const scenario = async (tenant: string, name: string, publie: string | null, brouillon: string | null) => {
    await pool.query(
      'insert into workflows (tenant_id, name, graph, draft_graph) values ($1, $2, $3::jsonb, $4::jsonb)',
      [tenant, name, publie ?? JSON.stringify({ nodes: [], edges: [] }), brouillon],
    );
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    requetes = new PgRequeteStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-requete-scenarios') returning id`)).rows[0]!.id;
    autreTenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-requete-scenarios-autre') returning id`)).rows[0]!.id;
    sourceId = (await pool.query<{ id: string }>(
      `insert into agent_tool_sources (tenant_id, kind, label, base_url, auth_kind, status)
       values ($1, 'http', 'itest-source', 'https://exemple.test/api', 'none', 'active') returning id`,
      [tenantId],
    )).rows[0]!.id;
  });

  afterAll(async () => {
    if (tenantId) await pool.query('delete from tenants where id = $1', [tenantId]);
    if (autreTenantId) await pool.query('delete from tenants where id = $1', [autreTenantId]);
    await pool.end();
  });

  it('🔴 publié ou brouillon, la vue nomme les scénarios de L’ESPACE qui la désignent, et seulement eux', async () => {
    const creer = async (label: string) => (await requetes.creer(tenantId, {
      sourceId, label, methode: 'GET', chemin: '/x', parametres: [], entetes: [], corps: { mode: 'aucun' },
      variables: [], outputPaths: [], valeursTest: {},
    })).id;
    const visee = await creer('Visée');
    const autre = await creer('Autre');

    await scenario(tenantId, 'Relance devis', graphe(visee), null);
    await scenario(tenantId, 'Accueil', null, graphe(visee));
    await scenario(tenantId, 'Sans rapport', graphe(autre), null);
    // Le même identifiant dans le graphe d'un AUTRE client : il ne doit ni compter ni se lire.
    await scenario(autreTenantId, 'Scénario d’un autre client', graphe(visee), null);

    expect(await requetes.scenariosQuiUtilisent(tenantId, visee)).toEqual(['Accueil', 'Relance devis']);
    expect(await requetes.scenariosQuiUtilisent(tenantId, autre)).toEqual(['Sans rapport']);
    // L'autre client ne lit pas la requête par son identifiant : rien, et surtout pas le nom de ses scénarios.
    expect(await requetes.scenariosQuiUtilisent(autreTenantId, visee)).toEqual([]);
    const listees = await requetes.lister(tenantId);
    expect(listees.find((r) => r.id === visee)!.scenarios).toEqual(['Accueil', 'Relance devis']);
  });

  it('une requête qu’aucun scénario ne désigne rend une liste vide, jamais null, et un graphe mal formé ne casse rien', async () => {
    const seule = (await requetes.creer(tenantId, {
      sourceId, label: 'Seule', methode: 'GET', chemin: '/x', parametres: [], entetes: [], corps: { mode: 'aucun' },
      variables: [], outputPaths: [], valeursTest: {},
    })).id;
    // `nodes` qui n'est pas un tableau : `jsonb_array_elements` lèverait sans la garde.
    await pool.query(
      'insert into workflows (tenant_id, name, graph) values ($1, $2, $3::jsonb)',
      [tenantId, 'Graphe mal formé', JSON.stringify({ nodes: { n1: { type: 'http' } }, edges: [] })],
    );
    expect(await requetes.scenariosQuiUtilisent(tenantId, seule)).toEqual([]);
    expect((await requetes.lister(tenantId)).find((r) => r.id === seule)!.scenarios).toEqual([]);
  });
});
