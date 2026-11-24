import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowStore } from '../../src/workflow/store.pg';
import type { WorkflowGraph } from '../../src/workflow/graph';

const url = process.env.DATABASE_URL ?? '';

/**
 * LE MAGASIN DES SCÉNARIOS ÉCRITS PAR L'API (migration 0267, plan `2026-11-02-scenarios-api.md`, tâche 4).
 *
 * Ce qui se prouve ici est dans le SQL : le nom unique sous verrou, la marque d'origine, la publication directe, le
 * contrôle sous le verrou de la ligne, et la liste de ce qui utilise un scénario. Jamais joué en local (le
 * DATABASE_URL du poste pointe l'ancienne production), joué par le job `integration`.
 */
describe.skipIf(!url)('scénarios écrits par l’API (Postgres)', () => {
  let pool: Pool;
  let store: PgWorkflowStore;
  let tenantId: string;
  let autreTenantId: string;

  const graphe = (body: string, code?: string): WorkflowGraph => ({
    nodes: [{ id: 'n1', type: 'quick_message', position: { x: 0, y: 0 }, data: { body, quickReplies: [], ...(code ? { code } : {}) } }],
    edges: [],
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 6 });
    store = new PgWorkflowStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-scenarios-api') returning id`)).rows[0]!.id;
    autreTenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-scenarios-api-voisin') returning id`)).rows[0]!.id;
  });

  afterAll(async () => {
    for (const t of [tenantId, autreTenantId]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  it('crée un scénario PUBLIÉ, d’origine api, sans brouillon', async () => {
    const r = await store.creerPublieParApi(tenantId, 'Publié', graphe('v1'));
    if ('nomPris' in r) throw new Error('nom attendu libre');
    const l = (await store.lireParApi(tenantId, r.id))!;
    expect(l).toMatchObject({ origine: 'api', name: 'Publié', draftGraph: null });
    expect(l.graph.nodes[0]!.data.body).toBe('v1');
    expect(l.publishedAt).not.toBeNull();
    expect(r.code).toMatch(/^scn_/);
    expect((await store.lireParApi(tenantId, r.code))?.id).toBe(r.id);
    // Un scénario de la console garde l'origine par défaut.
    const { id } = await store.insert(tenantId, 'console', graphe('c'), 'general');
    expect((await store.lireParApi(tenantId, id))?.origine).toBe('console');
  });

  it('🔴 deux créations simultanées du même nom, à la casse près : une seule réussit', async () => {
    const [a, b] = await Promise.all([
      store.creerPublieParApi(tenantId, 'Doublon', graphe('a')),
      store.creerPublieParApi(tenantId, ' doublon ', graphe('b')),
    ]);
    const reussies = [a, b].filter((x) => !('nomPris' in x));
    expect(reussies).toHaveLength(1);
    const echouee = [a, b].find((x) => 'nomPris' in x) as { nomPris: string };
    expect(echouee.nomPris).toBe((reussies[0] as { id: string }).id);
    // Le nom d'un AUTRE espace ne compte pas.
    expect('nomPris' in await store.creerPublieParApi(autreTenantId, 'Doublon', graphe('c'))).toBe(false);
  });

  it('le remplacement : contrôle sous verrou, publication, et refus d’un nom pris par un autre', async () => {
    const r = await store.creerPublieParApi(tenantId, 'Remplacé', graphe('v1')) as { id: string };
    expect(await store.remplacerPublieParApi(r.id, tenantId, 'Remplacé', graphe('v2'), () => 'non')).toEqual({ refus: 'non' });
    expect((await store.lireParApi(tenantId, r.id))!.graph.nodes[0]!.data.body).toBe('v1');
    await pool.query(`update workflows set draft_graph = $3::jsonb where id = $1 and tenant_id = $2`, [r.id, tenantId, JSON.stringify(graphe('brouillon'))]);
    let vu: string | undefined;
    expect(await store.remplacerPublieParApi(r.id, tenantId, 'Remplacé v2', graphe('v2'), (l) => { vu = l.draftGraph?.nodes[0]?.data.body as string; return null; })).toBe('ok');
    expect(vu).toBe('brouillon');
    const l = (await store.lireParApi(tenantId, r.id))!;
    expect(l).toMatchObject({ name: 'Remplacé v2', draftGraph: null });
    expect(l.graph.nodes[0]!.data.body).toBe('v2');
    expect(await store.remplacerPublieParApi(r.id, tenantId, 'Publié', graphe('v3'), () => null)).toMatchObject({ nomPris: expect.any(String) });
    expect(await store.remplacerPublieParApi(r.id, autreTenantId, 'x', graphe('v3'), () => null)).toBe('inconnu');
  });

  /** Les versions d'un scénario (migration 0315) : seule une écriture de `graph` en fait une, jamais un brouillon. */
  const versions = async (id: string) =>
    (await pool.query<{ n: number }>('select count(*)::int as n from workflow_versions where workflow_id = $1', [id])).rows[0]!.n;

  it('🔴 créer en BROUILLON (CSM, B4) : le publié reste vide, la recette attend en brouillon, aucune version', async () => {
    const r = await store.creerBrouillonParApi(tenantId, 'En brouillon', graphe('b1'));
    if ('nomPris' in r) throw new Error('nom attendu libre');
    const l = (await store.lireParApi(tenantId, r.id))!;
    expect(l).toMatchObject({ origine: 'api', name: 'En brouillon', publishedAt: null });
    expect(l.graph.nodes).toEqual([]);
    expect(l.draftGraph!.nodes[0]!.data.body).toBe('b1');
    expect(r.code).toMatch(/^scn_/);
    expect(await versions(r.id)).toBe(0);
    // Le nom reste unique dans le Builder, publié ou non : un rejeu rend le scénario déjà créé.
    expect(await store.creerBrouillonParApi(tenantId, ' en BROUILLON ', graphe('b2'))).toEqual({ nomPris: r.id });
    expect(await store.creerPublieParApi(tenantId, 'En brouillon', graphe('b2'))).toEqual({ nomPris: r.id });
  });

  it('🔴 remplacer le BROUILLON (CSM, B4) : le publié ne bouge pas, console comprise ; un brouillon égal au publié disparaît', async () => {
    const r = await store.creerPublieParApi(tenantId, 'Travail', graphe('en ligne')) as { id: string };
    let vu: string | undefined;
    expect(await store.remplacerBrouillonParApi(r.id, tenantId, 'Travail', graphe('à venir'), (l) => { vu = l.graph.nodes[0]?.data.body as string; return null; })).toBe('ok');
    expect(vu).toBe('en ligne');
    let l = (await store.lireParApi(tenantId, r.id))!;
    expect(l.graph.nodes[0]!.data.body).toBe('en ligne');
    expect(l.draftGraph!.nodes[0]!.data.body).toBe('à venir');
    expect(await versions(r.id)).toBe(1);
    // Redire le publié, positions mises à part : il ne reste aucun brouillon (la règle de `update`).
    const deplace = graphe('en ligne');
    deplace.nodes[0]!.position = { x: 120, y: 40 };
    expect(await store.remplacerBrouillonParApi(r.id, tenantId, 'Travail', deplace, () => null)).toBe('ok');
    expect((await store.lireParApi(tenantId, r.id))!.draftGraph).toBeNull();
    // Le contrôle refuse : rien n'est écrit. Un nom pris, un autre espace : refusés.
    expect(await store.remplacerBrouillonParApi(r.id, tenantId, 'Travail', graphe('non'), () => 'non')).toEqual({ refus: 'non' });
    expect((await store.lireParApi(tenantId, r.id))!.draftGraph).toBeNull();
    expect(await store.remplacerBrouillonParApi(r.id, tenantId, 'Publié', graphe('x'), () => null)).toMatchObject({ nomPris: expect.any(String) });
    expect(await store.remplacerBrouillonParApi(r.id, autreTenantId, 'x', graphe('x'), () => null)).toBe('inconnu');
    // Un scénario fait dans la console : son brouillon se remplace aussi, et rien n'est publié.
    const { id } = await store.insert(tenantId, 'Console B4', graphe('console'), 'general');
    expect(await store.remplacerBrouillonParApi(id, tenantId, 'Console B4', graphe('par Claude'), () => null)).toBe('ok');
    l = (await store.lireParApi(tenantId, id))!;
    expect(l).toMatchObject({ origine: 'console', publishedAt: null });
    expect(l.graph.nodes).toEqual([]);
    expect(l.draftGraph!.nodes[0]!.data.body).toBe('par Claude');
    expect(await versions(id)).toBe(0);
  });

  it('🔴 ce qui utilise un scénario bloque sa suppression : automation, widget, répondeur, « Aller à »', async () => {
    const r = await store.creerPublieParApi(tenantId, 'Utilisé', graphe('u', 'nod_itest_01HZZZZZZZZZZZZZZZZZZZZZZZ')) as { id: string };
    expect(await store.utilisationsDuScenario(tenantId, r.id)).toEqual([]);
    await pool.query(
      `insert into automations (tenant_id, name, enabled, trigger_kind, trigger_config, workflow_id)
       values ($1, 'Bienvenue', true, 'keyword', '{"keyword":"itest"}'::jsonb, $2)`, [tenantId, r.id]);
    await pool.query(`insert into widgets (tenant_id, code, nom, phrase, devenir, workflow_id) values ($1, gen_random_uuid()::text, 'Bulle', 'itest', 'scenario', $2)`, [tenantId, r.id]);
    await pool.query(
      `insert into tenant_settings (tenant_id, repondeur_mode, repondeur_workflow_id) values ($1, 'scenario', $2)
       on conflict (tenant_id) do update set repondeur_mode = 'scenario', repondeur_workflow_id = $2`, [tenantId, r.id]);
    const saut: WorkflowGraph = { nodes: [{ id: 's', type: 'aller_a', position: { x: 0, y: 0 }, data: { cible: 'nod_itest_01HZZZZZZZZZZZZZZZZZZZZZZZ' } }], edges: [] };
    await store.insert(tenantId, 'Sauteur', saut, 'general');
    const u = await store.utilisationsDuScenario(tenantId, r.id);
    expect(u.join(' | ')).toMatch(/Bienvenue/);
    expect(u.join(' | ')).toMatch(/Bulle/);
    expect(u.join(' | ')).toMatch(/répondeur/);
    expect(u.join(' | ')).toMatch(/Sauteur/);
    expect(await store.supprimerParApi(r.id, tenantId)).toMatchObject({ utilise: expect.any(Array) });
    expect(await store.lireParApi(tenantId, r.id)).not.toBeNull();
    // Rien d'un autre espace n'est lu : son automation ne bloque pas un scénario de cet espace.
    expect(await store.utilisationsDuScenario(autreTenantId, r.id)).toEqual([]);
    await pool.query(`update tenant_settings set repondeur_mode = 'equipe', repondeur_workflow_id = null where tenant_id = $1`, [tenantId]);
  });

  it('supprime un scénario de l’API libre, refuse un scénario de la console', async () => {
    const r = await store.creerPublieParApi(tenantId, 'Jetable', graphe('j')) as { id: string };
    expect(await store.supprimerParApi(r.id, tenantId)).toBe('ok');
    expect(await store.lireParApi(tenantId, r.id)).toBeNull();
    const { id } = await store.insert(tenantId, 'console à garder', graphe('c'), 'general');
    expect(await store.supprimerParApi(id, tenantId)).toBe('console');
    expect(await store.supprimerParApi(id, autreTenantId)).toBe('inconnu');
  });
});
