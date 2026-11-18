import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowStore } from '../../src/workflow/store.pg';
import { PgAutomationStore } from '../../src/automation/store.pg';
import { PgUserFieldStore } from '../../src/crm/field-store.pg';
import { PgDuplicationStore, type EtatEnBase } from '../../src/ops/duplication/store.pg';
import { planifierDuplication } from '../../src/ops/duplication/plan';
import type { WorkflowGraph } from '../../src/workflow/graph';
import { PgAgentStore } from '../../src/agent/agent-store.pg';
import { PgKnowledgeStore } from '../../src/agent/knowledge.pg';
import { PgSourceStore } from '../../src/agent/sources.pg';
import { PgRequeteStore } from '../../src/agent/requetes.pg';
import { PgToolCatalog } from '../../src/agent/catalog.pg';
import { PgEmailTemplateStore } from '../../src/email/template-store.pg';
import { randomUUID } from 'node:crypto';
import { PgFlowStore } from '../../src/flow/store.pg';
import type { FlowScreenDef } from '../../src/meta/flow-json';
import { copierAgent, copierModeleEmail, copierOutil, copierRequete, copierSource } from '../../src/ops/duplication/dependances.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LA DUPLICATION D'UN SCÉNARIO ENTRE ESPACES, SUR POSTGRES (lot 1, tâche 4 du plan
 * `docs/superpowers/plans/2026-11-16-duplication-scenario-lot-1.md`).
 *
 * 🔴 POURQUOI EN INTÉGRATION. Ce qui doit être prouvé est dans le SQL : le filtre d'espace de chaque lecture (un scénario
 * d'un autre espace, ou le scénario système, ne se lit pas), le brouillon comme seule colonne écrite, la transaction qui
 * ne laisse rien après une panne, et la source jamais touchée.
 *
 * Jamais joué en local (le DATABASE_URL local pointe l'ancienne base de production), joué par le job `integration`.
 */
describe.skipIf(!url)('duplication de scénario entre espaces (Postgres)', () => {
  let pool: Pool;
  let store: PgDuplicationStore;
  let workflows: PgWorkflowStore;
  let source: string;
  let destination: string;
  let tiers: string;
  let scenario: string;

  const graphe = (version: string): WorkflowGraph => ({
    nodes: [
      { id: 'q1', type: 'question', position: { x: 0, y: 0 }, data: { body: `Ville ? ${version}`, champReponse: 'ville' } },
      { id: 'a2', type: 'aller_a', position: { x: 0, y: 0 }, data: { cible: 'nod_x_01J00000000000000000000000' } },
    ],
    edges: [{ id: 'e1', source: 'q1', target: 'a2' }],
  });

  const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
  const compter = async (tenant: string) => (await pool.query<{ w: number; a: number; c: number }>(
    `select (select count(*)::int from workflows where tenant_id = $1) as w,
            (select count(*)::int from automations where tenant_id = $1) as a,
            (select count(*)::int from user_fields where tenant_id = $1) as c`, [tenant],
  )).rows[0]!;
  const plan = (e: EtatEnBase) => planifierDuplication({ ...e, templatesDestination: [], modelesSource: [], flowsSource: [], indicesSource: [], offreOuvreScenarios: true, creditIaOuvert: true });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    store = new PgDuplicationStore(pool);
    workflows = new PgWorkflowStore(pool);
    source = await espace('itest-dup-source');
    destination = await espace('itest-dup-destination');
    tiers = await espace('itest-dup-tiers');
    await pool.query(`insert into waba (id, tenant_id) values ($1, $2)`, [`itest-dup-${destination}`, destination]);
    await new PgUserFieldStore(pool).create(source, { key: 'ville', label: 'Ville', type: 'text' });
    // Publié en v1, puis un brouillon v2 : la copie doit prendre le brouillon.
    scenario = (await workflows.insert(source, 'Accueil', graphe('v1'), 'general')).id;
    await workflows.publish(scenario, source);
    await workflows.update(scenario, source, { graph: graphe('v2') });
    await new PgAutomationStore(pool).create(source, { rayon: 'general',
      name: 'Accueil', triggerKind: 'keyword', triggerConfig: { keywords: ['bonjour'] }, conditionGroup: null,
      workflowId: scenario, startNodeId: 'q1', cooldownSeconds: null, enabled: true,
    });
  });

  afterAll(async () => {
    for (const t of [source, destination, tiers]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  it('lit le BROUILLON du scénario, ses déclencheurs et les champs des deux espaces', async () => {
    const e = (await store.lireEtat(source, scenario, destination))!;
    expect(e.scenario.graphe.nodes[0]!.data.body).toBe('Ville ? v2');
    expect(e.automationsDuScenario.map((a) => a.name)).toEqual(['Accueil']);
    expect(e.champsSource).toEqual([{ key: 'ville', label: 'Ville', type: 'text' }]);
    expect(e.champsDestination).toEqual([]);
    expect(e.destination.codeClient).not.toBe('');
  });

  it('🔴 un scénario d’un AUTRE espace, ou le scénario système, ne se lit pas', async () => {
    const autre = (await workflows.insert(tiers, 'Chez le tiers', graphe('t'), 'general')).id;
    expect(await store.lireEtat(source, autre, destination)).toBeNull();
    const systeme = await workflows.assurerScenarioSysteme(source, 'repondeur');
    expect(await store.lireEtat(source, systeme, destination)).toBeNull();
    expect((await store.scenarios(source)).map((s) => s.id)).not.toContain(systeme);
    // Le Builder seul (menu « Scénario », lot 2) : un scénario Shopify de l'espace ne se lit ni ne se liste.
    const panier = (await workflows.insert(source, 'Panier abandonné', graphe('s'), 'shopify')).id;
    expect(await store.lireEtat(source, panier, destination)).toBeNull();
    expect((await store.scenarios(source)).map((s) => s.id)).not.toContain(panier);
  });

  it('écrit dans la destination seulement : brouillon, champ, déclencheur éteint ; la source ne bouge pas', async () => {
    const avantSource = await compter(source);
    const e = (await store.lireEtat(source, scenario, destination))!;
    const r = await store.ecrire(destination, source, e.scenario, plan(e));
    expect(r.nom).toBe('Accueil (copie)');
    expect(r.champsCrees).toEqual(['ville']);
    const copie = (await workflows.getById(r.scenarioId, destination))!;
    expect(copie.graph.nodes).toHaveLength(0);
    expect(copie.draftGraph?.nodes[1]!.data.cible).toBe('');
    const autos = await new PgAutomationStore(pool).toutesPourLaDuplication(destination);
    expect(autos.map((a) => [a.workflowId, a.enabled, a.startNodeId])).toEqual([[r.scenarioId, false, 'q1']]);
    expect(await compter(source)).toEqual(avantSource);
  });

  it('une seconde copie prend « (copie 2) »', async () => {
    const e = (await store.lireEtat(source, scenario, destination))!;
    expect((await store.ecrire(destination, source, e.scenario, plan(e))).nom).toBe('Accueil (copie 2)');
  });

  it('🔴 une panne en route ne laisse RIEN dans la destination', async () => {
    const vierge = await espace('itest-dup-vierge');
    try {
      const e = (await store.lireEtat(source, scenario, vierge))!;
      const p = plan(e);
      // Un `bigint` ne se sérialise pas : l'insertion du déclencheur lève APRÈS le champ et le scénario.
      p.declencheurs.copies[0]!.triggerConfig = { keywords: ['bonjour'], n: 1n };
      await expect(store.ecrire(vierge, source, e.scenario, p)).rejects.toThrow();
      expect(await compter(vierge)).toEqual({ w: 0, a: 0, c: 0 });
    } finally {
      await pool.query('delete from tenants where id = $1', [vierge]);
    }
  });

  it('liste les espaces avec leur WABA', async () => {
    const espaces = await store.espaces();
    expect(espaces.find((x) => x.id === destination)?.waba).toBe(true);
    expect(espaces.find((x) => x.id === tiers)?.waba).toBe(false);
  });
});

/**
 * LOT 2 : LES DÉPENDANCES COCHÉES, SUR POSTGRES (plan `docs/superpowers/plans/2026-11-17-duplication-scenario-lot-2.md`).
 * Les fixtures passent par les stores réels : elles respectent d'office les contraintes de la base (CHECK, unicités).
 */
describe.skipIf(!url)('duplication des dépendances d’un scénario (Postgres)', () => {
  let pool: Pool;
  let store: PgDuplicationStore;
  let source: string;
  let destination: string;
  let tiers: string;
  let scenario: string;
  let agent: string;
  let requete: string;
  let modele: string;
  let codeBloc: string;
  let outilAppel: string;
  let sourceCrm: string;

  const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
  const vecteur = (x: number) => Array.from({ length: 1536 }, () => x);
  const lignesDe = async (tenant: string) => Number((await pool.query<{ n: string }>(
    `select (select count(*) from agents where tenant_id = $1) + (select count(*) from agent_knowledge where tenant_id = $1)
          + (select count(*) from agent_tools where tenant_id = $1) + (select count(*) from agent_tool_consommateurs where tenant_id = $1)
          + (select count(*) from connector_requests where tenant_id = $1) + (select count(*) from agent_tool_sources where tenant_id = $1)
          + (select count(*) from email_templates where tenant_id = $1) + (select count(*) from workflows where tenant_id = $1) as n`, [tenant],
  )).rows[0]!.n);
  const etat = async (dest: string) => (await store.lireEtat(source, scenario, dest))!;
  const plan = (e: EtatEnBase, choix?: Parameters<typeof planifierDuplication>[1]) =>
    planifierDuplication({ ...e, templatesDestination: [], modelesSource: [], flowsSource: [], indicesSource: [], offreOuvreScenarios: true, creditIaOuvert: true }, choix);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    store = new PgDuplicationStore(pool);
    source = await espace('itest-dup2-source');
    destination = await espace('itest-dup2-destination');
    tiers = await espace('itest-dup2-tiers');
    const workflows = new PgWorkflowStore(pool);
    // Le scénario d'abord, pour que l'action puisse viser un de ses blocs (la garde de `ajouter` exige un scénario de l'espace).
    scenario = (await workflows.insert(source, 'Accueil', { nodes: [{ id: 'q1', type: 'question', position: { x: 0, y: 0 }, data: { body: 'Ville ?' } }], edges: [] }, 'general')).id;
    codeBloc = 'nod_src01_01J00000000000000000000001';
    agent = (await new PgAgentStore(pool).create(source, 'Conseiller', 'Je suis une IA.', 'openai/gpt-4.1-mini')).id;
    const fiches = new PgKnowledgeStore(pool, 0);
    const f1 = (await fiches.creer(source, agent, { titre: 'Horaires', corps: 'Ouvert de 9 h à 18 h.' }))!;
    const f2 = (await fiches.creer(source, agent, { titre: 'Adresse', corps: '12 rue de la Paix.' }))!;
    await fiches.ecrireVecteurs('cohere/embed-v4.0', [{ id: f1.id, vecteur: vecteur(0.25) }, { id: f2.id, vecteur: vecteur(0.5) }]);
    const src = await new PgSourceStore(pool).creer(source, {
      kind: 'http', label: 'CRM', baseUrl: 'https://crm.exemple.fr', authKind: 'bearer', authSecret: 'cle-tres-secrete',
    });
    sourceCrm = src.id;
    requete = (await new PgRequeteStore(pool).creer(source, {
      sourceId: src.id, label: 'Créer le lead', methode: 'POST', chemin: '/leads', parametres: [],
      entetes: [{ nom: 'X-Origine', valeur: 'whatsapp' }], corps: { mode: 'aucun' },
      variables: [{ nom: 'ville', type: 'string', origine: { type: 'champ', cle: 'ville' } }], outputPaths: [], valeursTest: { ville: 'Lyon' },
    })).id;
    await new PgUserFieldStore(pool).create(source, { key: 'ville', label: 'Ville', type: 'text' });
    const outils = new PgToolCatalog(pool);
    await outils.ajouter(source, agent, {
      handler: 'envoyer_bloc', cible: { handler: 'envoyer_bloc', workflowId: scenario, code: codeBloc }, name: 'envoyer_horaires',
      title: 'Envoyer les horaires', description: 'Envoie le bloc des horaires.', nePasUtiliser: '', params: [], risk: 'irreversible',
    });
    outilAppel = (await outils.ajouterConnecteur(source, agent, {
      sourceId: src.id, requestId: requete, name: 'creer_lead', title: 'Créer le lead', description: 'Crée le lead dans le CRM.',
      nePasUtiliser: '', risk: 'write', nature: 'integre', outputPaths: [],
    }))!.id;
    await pool.query('update agent_tools set gestes = $2::jsonb where id = $1', [outilAppel, JSON.stringify([{ type: 'tag', valeur: 'lead crm' }])]);
    modele = (await new PgEmailTemplateStore(pool).create(source, {
      name: 'Confirmation', format: 'basic', subject: 'Bonjour', body: 'Votre ville : {{ville}}',
    })).id;
    // Le graphe définitif désigne l'agent, la requête et le modèle ; le bloc q1 porte le code que vise l'action.
    await workflows.update(scenario, source, { graph: { nodes: [
      { id: 'q1', type: 'question', position: { x: 0, y: 0 }, data: { body: 'Ville ?', code: codeBloc } },
      { id: 'g2', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: agent, agentLabel: 'Conseiller' } },
      { id: 'h3', type: 'http', position: { x: 0, y: 0 }, data: { requestId: requete } },
      { id: 'm4', type: 'email', position: { x: 0, y: 0 }, data: { templateId: modele, emailAccountId: 'x' } },
    ], edges: [] } });
    // Un homonyme dans la destination : l'agent copié s'appellera « Conseiller (copie) ».
    await new PgAgentStore(pool).create(destination, 'Conseiller', 'Je suis une IA.', 'openai/gpt-4.1-mini');
  });

  afterAll(async () => {
    for (const t of [source, destination, tiers]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  it('lit l’agent, ses outils, la requête et sa source, et le modèle d’e-mail du scénario', async () => {
    const e = await etat(destination);
    expect(e.dependances.agents.map((a) => [a.label, a.fiches, a.outils.map((o) => o.nom).sort()])).toEqual([['Conseiller', 2, ['creer_lead', 'envoyer_horaires']]]);
    expect(e.dependances.agents[0]!.outils.find((o) => o.nom === 'creer_lead')!.gestes).toEqual([{ type: 'tag', valeur: 'lead crm' }]);
    expect(e.dependances.requetes.map((r) => r.label)).toEqual(['Créer le lead']);
    expect(e.dependances.sources).toEqual([{ id: expect.any(String), label: 'CRM', secret: true }]);
    expect(e.dependances.modelesEmail.map((m) => m.nom)).toEqual(['Confirmation']);
    expect(e.nomsPris.agents).toEqual(['Conseiller']);
  });

  it('🔴 copie ce qui est coché, dans la destination seulement : secret octet pour octet, outils désactivés, blocs rebranchés', async () => {
    const avant = await lignesDe(source);
    const e = await etat(destination);
    const r = await store.ecrire(destination, source, e.scenario, plan(e, { agents: [agent], requetes: [requete], modelesEmail: [modele] }));
    expect(r.dependancesCopiees).toEqual({ agents: ['Conseiller (copie)'], requetes: ['Créer le lead'], modelesEmail: ['Confirmation'], sourcesAvecSecret: ['CRM'] });
    expect(await lignesDe(source)).toBe(avant);

    const copieAgent = (await pool.query<{ id: string; status: string }>(
      `select id, status from agents where tenant_id = $1 and label = 'Conseiller (copie)'`, [destination],
    )).rows[0]!;
    expect(copieAgent.status).toBe('draft');
    const v = await pool.query<{ meme: boolean; n: string }>(
      `select bool_and(c.embedding = s.embedding and c.embedding_modele = s.embedding_modele) as meme, count(*) as n
         from agent_knowledge c join agent_knowledge s on s.titre = c.titre and s.agent_id = $2 where c.agent_id = $1`,
      [copieAgent.id, agent],
    );
    expect(v.rows[0]).toEqual({ meme: true, n: '2' });
    const liaisons = await pool.query<{ actif: boolean; autonome: boolean }>(
      `select actif, autonome from agent_tool_consommateurs where consommateur = $1`, [`agent:${copieAgent.id}`],
    );
    expect(liaisons.rows).toHaveLength(2);
    expect(liaisons.rows.every((l) => !l.actif && !l.autonome)).toBe(true);
    const secrets = await pool.query<{ auth_secret_enc: string }>(
      `select auth_secret_enc from agent_tool_sources where label = 'CRM' and tenant_id = any($1::uuid[])`, [[source, destination]],
    );
    expect(secrets.rows).toHaveLength(2);
    expect(secrets.rows[0]!.auth_secret_enc).toBe(secrets.rows[1]!.auth_secret_enc);
    const req = await pool.query<{ id: string; valeurs_test: unknown; headers: unknown }>(
      `select id, valeurs_test, headers from connector_requests where tenant_id = $1`, [destination],
    );
    expect(req.rows).toHaveLength(1);
    expect(JSON.stringify(req.rows[0]!.valeurs_test)).not.toContain('Lyon');
    expect(JSON.stringify(req.rows[0]!.headers)).toContain('whatsapp');
    // Une seule copie de la requête, partagée par le bloc et par l'outil de l'agent.
    const outilAppel = (await pool.query<{ request_id: string }>(
      `select request_id from agent_tools where tenant_id = $1 and name = 'creer_lead'`, [destination],
    )).rows[0]!;
    expect(outilAppel.request_id).toBe(req.rows[0]!.id);
    // L'action vise la COPIE du scénario et le nouveau code de son bloc.
    const copie = (await new PgWorkflowStore(pool).getById(r.scenarioId, destination))!;
    const action = (await pool.query<{ binding: { workflowId: string; code: string } }>(
      `select binding from agent_tools where tenant_id = $1 and name = 'envoyer_horaires'`, [destination],
    )).rows[0]!;
    expect(action.binding.workflowId).toBe(r.scenarioId);
    expect(action.binding.code).toBe(copie.draftGraph!.nodes.find((n) => n.id === 'q1')!.data.code);
    // Les blocs du scénario sont posés sur les copies ; l'e-mail garde une boîte vide.
    const bloc = (id: string) => copie.draftGraph!.nodes.find((n) => n.id === id)!.data;
    expect(bloc('g2').agentId).toBe(copieAgent.id);
    expect(bloc('h3').requestId).toBe(req.rows[0]!.id);
    expect(bloc('m4').emailAccountId).toBe('');
    expect(bloc('m4').templateId).not.toBe(modele);
  });

  it('🔴 un agent d’un troisième espace, glissé dans les choix, ne se copie pas', async () => {
    const autre = (await new PgAgentStore(pool).create(tiers, 'Espion', 'Je suis une IA.', 'openai/gpt-4.1-mini')).id;
    const p = plan(await etat(tiers), { agents: [autre], requetes: [], modelesEmail: [] });
    expect(p.choixInvalides).toEqual([autre]);
    expect(p.copies.agents).toEqual([]);
  });

  it('🔴 une panne après la copie de l’agent ne laisse RIEN dans la destination', async () => {
    const vierge = await espace('itest-dup2-vierge');
    try {
      const e = await etat(vierge);
      const p = plan(e, { agents: [agent], requetes: [], modelesEmail: [] });
      // Un `bigint` ne se sérialise pas : l'écriture du scénario lève APRÈS la source, la requête et l'agent.
      p.graphe.graphe.nodes[0]!.data.casse = 1n;
      await expect(store.ecrire(vierge, source, e.scenario, p)).rejects.toThrow();
      expect(await lignesDe(vierge)).toBe(0);
    } finally {
      await pool.query('delete from tenants where id = $1', [vierge]);
    }
  });

  it('🔴 un graphe forgé qui désigne l’agent d’un troisième espace : rien n’en est lu, et le cocher est refusé', async () => {
    const espion = (await new PgAgentStore(pool).create(tiers, 'Espion forgé', 'Je suis une IA.', 'openai/gpt-4.1-mini')).id;
    const forge = (await new PgWorkflowStore(pool).insert(source, 'Forgé', { nodes: [
      { id: 'g1', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: espion } },
    ], edges: [] }, 'general')).id;
    const e = (await store.lireEtat(source, forge, destination))!;
    expect(e.dependances.agents).toEqual([]);
    expect(plan(e, { agents: [espion], requetes: [], modelesEmail: [] }).choixInvalides).toEqual([espion]);
  });

  it('🔴 chaque copie filtre l’espace SOURCE : l’identifiant d’une ligne d’un troisième espace lève, et la destination ne reçoit rien', async () => {
    const vierge = await espace('itest-dup2-isolation');
    try {
      const srcT = await new PgSourceStore(pool).creer(tiers, {
        kind: 'http', label: 'CRM tiers', baseUrl: 'https://tiers.exemple.fr', authKind: 'bearer', authSecret: 'secret-du-tiers',
      });
      const reqT = (await new PgRequeteStore(pool).creer(tiers, {
        sourceId: srcT.id, label: 'Lire tiers', methode: 'GET', chemin: '/x', parametres: [], entetes: [], corps: { mode: 'aucun' },
        variables: [], outputPaths: [], valeursTest: {},
      })).id;
      const modT = (await new PgEmailTemplateStore(pool).create(tiers, { name: 'Modèle tiers', format: 'basic', subject: 'S', body: 'B' })).id;
      const agT = (await new PgAgentStore(pool).create(tiers, 'Agent tiers', 'Je suis une IA.', 'openai/gpt-4.1-mini')).id;
      const outT = (await new PgToolCatalog(pool).ajouterConnecteur(tiers, agT, {
        sourceId: srcT.id, requestId: reqT, name: 'lire_tiers', title: 'Lire', description: 'Lit le tiers.',
        nePasUtiliser: '', risk: 'write', nature: 'integre', outputPaths: [],
      }))!.id;
      const copies: Array<[string, () => Promise<string>]> = [
        ['la source', () => copierSource(pool, source, vierge, srcT.id, 'CRM tiers')],
        ['la requête', () => copierRequete(pool, source, vierge, reqT, 'Lire tiers', srcT.id)],
        ['le modèle', () => copierModeleEmail(pool, source, vierge, modT, 'Modèle tiers')],
        ['l’agent', () => copierAgent(pool, source, vierge, agT, 'Agent tiers')],
        ['l’outil', () => copierOutil(pool, source, vierge, outT, { nom: 'lire_tiers', agentProprietaire: null, requeteCopiee: null, sourceCopiee: null, binding: {} })],
      ];
      for (const [quoi, copier] of copies) await expect(copier(), quoi).rejects.toThrow('introuvable dans l’espace source');
      expect(await lignesDe(vierge)).toBe(0);
    } finally {
      await pool.query('delete from tenants where id = $1', [vierge]);
    }
  });

  it('deux déclencheurs écrits dans la même transaction se lisent dans l’ordre de leur identifiant', async () => {
    const t = await espace('itest-dup2-ordre');
    try {
      const wf = (await new PgWorkflowStore(pool).insert(t, 'Ordre', { nodes: [], edges: [] }, 'general')).id;
      const c = await pool.connect();
      try {
        // Même `now()` pour les deux : seul l'identifiant les départage, et le second écrit est le plus petit.
        await c.query('begin');
        for (const [id, mot] of [['ffffffff-ffff-4fff-bfff-ffffffffffff', 'b'], ['00000000-0000-4000-8000-000000000000', 'a']] as const) {
          await c.query(
            `insert into automations (id, tenant_id, name, enabled, trigger_kind, trigger_config, workflow_id, start_node_id)
             values ($1, $2, $3, false, 'keyword', $4::jsonb, $5, 'q1')`,
            [id, t, `Mot ${mot}`, JSON.stringify({ keywords: [mot] }), wf],
          );
        }
        await c.query('commit');
      } finally {
        c.release();
      }
      const ids = (await new PgAutomationStore(pool).toutesPourLaDuplication(t)).map((a) => a.id);
      expect(ids).toEqual(['00000000-0000-4000-8000-000000000000', 'ffffffff-ffff-4fff-bfff-ffffffffffff']);
    } finally {
      await pool.query('delete from tenants where id = $1', [t]);
    }
  });

  it('🔴 un outil de l’espace partagé par deux agents cochés : UNE copie, deux liaisons, sous un nom libre hors des actions de ses agents', async () => {
    const dest = await espace('itest-dup2-partage');
    try {
      const agents = new PgAgentStore(pool);
      const outils = new PgToolCatalog(pool);
      // Dans la source, un second agent consomme le même appel et porte une action au nom que sa copie prendrait.
      const vendeur = (await agents.create(source, 'Vendeur', 'Je suis une IA.', 'openai/gpt-4.1-mini')).id;
      // Un appel ne se rattache qu'à une source active (`source_inactive` sinon).
      await new PgSourceStore(pool).patch(source, sourceCrm, { status: 'active' });
      expect(await outils.rattacher(source, vendeur, outilAppel)).toEqual({ ok: true });
      await outils.ajouter(source, vendeur, {
        handler: 'poser_tag', cible: { handler: 'poser_tag', tag: 'lead' }, name: 'creer_lead_copie',
        title: 'Marquer le lead', description: 'Pose le tag lead.', nePasUtiliser: '', params: [], risk: 'write',
      });
      const deuxAgents = (await new PgWorkflowStore(pool).insert(source, 'Deux agents', { nodes: [
        { id: 'g1', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: agent } },
        { id: 'g2', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: vendeur } },
      ], edges: [] }, 'general')).id;
      // Dans la destination, un appel homonyme existe déjà : sa copie prendrait `creer_lead_copie`, le nom de l'action.
      const hote = (await agents.create(dest, 'Hôte', 'Je suis une IA.', 'openai/gpt-4.1-mini')).id;
      const erp = await new PgSourceStore(pool).creer(dest, { kind: 'http', label: 'ERP', baseUrl: 'https://erp.exemple.fr', authKind: 'none' });
      const lire = (await new PgRequeteStore(pool).creer(dest, {
        sourceId: erp.id, label: 'Lire', methode: 'GET', chemin: '/lire', parametres: [], entetes: [], corps: { mode: 'aucun' },
        variables: [], outputPaths: [], valeursTest: {},
      })).id;
      await outils.ajouterConnecteur(dest, hote, {
        sourceId: erp.id, requestId: lire, name: 'creer_lead', title: 'Créer', description: 'Crée.', nePasUtiliser: '',
        risk: 'write', nature: 'integre', outputPaths: [],
      });

      const e = (await store.lireEtat(source, deuxAgents, dest))!;
      await store.ecrire(dest, source, e.scenario, plan(e, { agents: [agent, vendeur], requetes: [], modelesEmail: [] }));
      const definitions = (await pool.query<{ name: string; liaisons: string }>(
        `select t.name, (select count(*) from agent_tool_consommateurs c where c.tool_id = t.id) as liaisons
           from agent_tools t where t.tenant_id = $1 and t.agent_id is null order by t.name`, [dest],
      )).rows;
      expect(definitions).toEqual([{ name: 'creer_lead', liaisons: '1' }, { name: 'creer_lead_copie_2', liaisons: '2' }]);
    } finally {
      await pool.query('delete from tenants where id = $1', [dest]);
    }
  });
});

/**
 * LOT 3 : LES FLOWS DE LA SOURCE ET LES BLOCS QUI LES OUVRENT, SUR POSTGRES (plan
 * `docs/superpowers/plans/2026-11-17-duplication-scenario-lot-3.md`). Meta n'est pas joint : le Flow « recréé » est passé
 * à `ecrire` comme l'orchestration le rendrait.
 */
describe.skipIf(!url)('duplication des templates et des Flows (Postgres)', () => {
  let pool: Pool;
  let store: PgDuplicationStore;
  let source: string;
  let destination: string;
  let tiers: string;
  let scenario: string;
  const ECRANS: FlowScreenDef[] = [{ title: 'Inscription', elements: [] }];
  const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    store = new PgDuplicationStore(pool);
    source = await espace('itest-dup3-source');
    destination = await espace('itest-dup3-destination');
    tiers = await espace('itest-dup3-tiers');
    const flows = new PgFlowStore(pool);
    await flows.insert({ id: '7001', tenantId: source, name: 'Inscription', screens: ECRANS, ref: randomUUID(), mapping: { email: 'email_pro' } });
    await flows.insert({ id: '7002', tenantId: tiers, name: 'Espion', screens: ECRANS, ref: randomUUID(), mapping: {} });
    scenario = (await new PgWorkflowStore(pool).insert(source, 'Inscriptions', { nodes: [
      { id: 'f1', type: 'flow', position: { x: 0, y: 0 }, data: { flowId: '7001', flowName: 'Inscription' } },
      { id: 't2', type: 'template', position: { x: 0, y: 0 }, data: { templateName: 'absent_de_la_destination', language: 'fr' } },
    ], edges: [] }, 'general')).id;
  });

  afterAll(async () => {
    for (const t of [source, destination, tiers]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  it('🔴 les Flows de la source se lisent dans l’espace source SEULEMENT : l’id d’un autre espace ne rend rien', async () => {
    const lus = await store.flowsSource(source, ['7001', '7002']);
    expect(lus.map((f) => [f.id, f.nom, f.ecrans?.length, f.mapping])).toEqual([['7001', 'Inscription', 1, { email: 'email_pro' }]]);
  });

  it('le bloc Flow se rebranche sur le Flow recréé ; le template absent et décoché arrive vidé, listé débranché', async () => {
    const e = (await store.lireEtat(source, scenario, destination))!;
    const flowsSource = await store.flowsSource(source, ['7001']);
    const p = planifierDuplication({ ...e, templatesDestination: [], modelesSource: [], flowsSource, indicesSource: [], offreOuvreScenarios: true, creditIaOuvert: true });
    const r = await store.ecrire(destination, source, e.scenario, p, new Map([['7001', { id: '8001', nom: 'Inscription' }]]));
    const copie = (await new PgWorkflowStore(pool).getById(r.scenarioId, destination))!;
    const bloc = (id: string) => copie.draftGraph!.nodes.find((n) => n.id === id)!.data;
    expect(bloc('f1')).toMatchObject({ flowId: '8001', flowName: 'Inscription' });
    expect(bloc('t2')).toMatchObject({ templateName: '', language: 'fr' });
    expect(r.debranches.map((d) => [d.nodeId, d.raison])).toEqual([['t2', 'template']]);
  });
});
