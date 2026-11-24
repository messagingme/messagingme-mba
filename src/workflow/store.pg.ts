import type { Pool, PoolClient } from 'pg';
import type { WorkflowGraph } from './graph';
import { makeCode } from '../ids/code';
import { resolveTenantCode } from '../ids/tenant-code';
import { scanOpening } from './engine';
import { estRayon, type Rayon } from './rayon';
import { AUTOMATION_TRIGGER_KINDS, type AutomationTriggerKind } from '../../web/lib/partage/automations';
import type { Lanceur } from '../../web/lib/partage/fenetre-scenario';
import { NOM_DU_SCENARIO } from '../shopify/lignes';

/**
 * Par quoi ce scénario ouvre, quand il peut ouvrir une campagne. `null` = il ne le peut pas.
 *
 * Calculé depuis le graphe, jamais stocké : une colonne serait une seconde vérité qui finirait périmée.
 * Miroir de la règle de l'écran (`web/lib/campaign-eligibility.ts`), sur le même `scanOpening` (parité gardée
 * par `tests/web-campaign-eligibility.test.ts`), calculé côté serveur pour ne pas envoyer les graphes au
 * navigateur.
 *
 * Une campagne part sur une audience froide : hors fenêtre de 24 h, seul un template (ou un bloc RCS) peut
 * ouvrir. `rcsOpen` est examiné avant `firstTemplate` : un scénario qui ouvre par un bloc RCS ouvre en RCS,
 * même s'il porte un template plus loin. Le modèle sans nom est refusé deux fois (redondant, gardé comme
 * ceinture sur un contrat lu par trois écrans).
 */
export type CanalOuverture = 'whatsapp' | 'rcs' | null;

export function canalDOuverture(graph: WorkflowGraph): CanalOuverture {
  const scan = scanOpening(graph);
  // Un « Aller à » vers un autre scénario avant tout envoi (RC5) : ce qui ouvre se joue dans un graphe que cet examen ne
  // lit pas, donc on ne promet rien à une campagne.
  if (scan.sessionOpen || scan.waitBeforeTemplate || scan.ambiguousTemplate || scan.unnamedOpeningTemplate || scan.sautsHorsScenario.length > 0) return null;
  if (scan.rcsOpen) return 'rcs';
  if (!scan.firstTemplate) return null;
  return String(scan.firstTemplate.data.templateName ?? '').trim() !== '' ? 'whatsapp' : null;
}

/** 'inconnu' = absent de cet espace. 'vide' = aucune version publiée. 'ok' = démarrable. */
export type EtatScenario = 'inconnu' | 'vide' | 'ok';

/**
 * Ce scénario peut-il DÉMARRER ? La question que se posent ceux qui désignent un scénario à démarrer plus tard, sans
 * personne devant : le bouton d'un lien de chaîne, la bulle d'un widget. Écrite une fois, pour eux deux.
 *
 * « Aucune version publiée » se lit sur le graphe PUBLIÉ, le seul que l'exécuteur lise : vide, il ne démarrerait
 * rien, même avec un brouillon à côté. `null` = la lecture par `getById(id, tenant)` n'a rien trouvé, donc un
 * scénario d'un autre espace se lit comme un inconnu.
 *
 * ⚠️ Une ancienne ligne peut porter un graphe SANS `nodes` (`listResume` le prévoit par `coalesce`) : lire
 * `.length` sans garde lèverait, donc une 500 à la console et un « échec interne » au MCP pour un scénario que
 * `list_scenarios` montre pourtant comme non publié. Il se lit `vide`, comme ce qu'il est.
 */
export function etatDuScenario(wf: Pick<WorkflowRow, 'graph' | 'rayon'> | null): EtatScenario {
  // Un scénario d'un autre rayon que le Builder n'existe pas pour un bouton de chaîne ni pour un widget (menu
  // « Scénario », décision 1) : il se lit comme un inconnu.
  if (wf === null || wf.rayon !== 'general') return 'inconnu';
  return (wf.graph.nodes?.length ?? 0) > 0 ? 'ok' : 'vide';
}

/**
 * Une ligne de la liste des scénarios, sans les graphes : ce que les écrans en lisaient est devenu trois
 * champs (nombre de blocs, brouillon, ouverture de campagne).
 */
export interface WorkflowResumeRow {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  nodeCount: number;
  hasDraft: boolean;
  campaignEligible: boolean;
  /**
   * Par quoi il ouvre, quand il le peut. `null` = il ne peut pas ouvrir de campagne. À côté de
   * `campaignEligible`, jamais à sa place : il sert à ne proposer, sur un étage, que des scénarios capables
   * de l'ouvrir.
   */
  canalOuverture: CanalOuverture;
}

/** Un scénario en ligne tel que le catalogue de l'API publique le lit : le graphe publié, jamais le brouillon. */
export interface ScenarioPublie {
  code: string | null;
  name: string;
  /** null = mis en ligne avant que la date soit suivie, pas « jamais publié ». */
  publishedAt: string | null;
  graph: WorkflowGraph;
}

export interface WorkflowRow {
  id: string;
  tenantId: string;
  name: string;
  /** Code public « scn_<client>_<ulid> ». null tant que le backfill n'a pas tourné (lignes anciennes). */
  code?: string | null;
  /**
   * Le graphe publié : celui que l'exécuteur, les campagnes, les automations et l'API publique lisent. Il ne
   * change que par une publication explicite (`publish`, l'API) ou par la mise en ligne d'une version programmée.
   */
  graph: WorkflowGraph;
  /**
   * Le brouillon en attente de publication. null = aucun, le publié fait foi. L'éditeur, la mise en ligne et les outils
   * de Claude le lisent ; rien ne le lance, sauf le lien de test.
   */
  draftGraph?: WorkflowGraph | null;
  /** Dernière mise en ligne. null = jamais publié depuis l'arrivée du bouton (lignes antérieures comprises). */
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Le rayon de la ligne (`src/workflow/rayon.ts`), lu en base. Une garde qui VALIDE un choix fait sur une lecture par
   * identifiant (`getById`, qui n'en filtre aucun) le compare elle-même.
   */
  rayon: Rayon;
}

const EMPTY_GRAPH: WorkflowGraph = { nodes: [], edges: [] };

/** Les colonnes lues partout : une seule liste, sinon un champ ajouté manque à l'une des requêtes. */
const COLS = 'id, tenant_id, name, code, graph, draft_graph, published_at, created_at, updated_at, rayon';

/**
 * 🔴 LE RAYON DES MÉTHODES DE L'API PUBLIQUE (`...ParApi`) : elles ne servent que l'API, Claude Code et le MCP, qui ne
 * voient que le Builder (spec du menu « Scénario », décision 1). Écrit ici et pas en paramètre : un appelant ne peut
 * pas en choisir un autre par erreur. Un scénario d'un autre rayon y est donc un inconnu.
 */
const DU_BUILDER = "rayon = 'general'";

/**
 * Les scénarios SYSTÈME (`workflows.systeme`, migration 0209), liste fermée, miroir du CHECK
 * `workflows_systeme_chk` (tenu par `tests/migration-0209.test.ts`). Un seul aujourd'hui : l'ancre des parcours du
 * répondeur de l'espace (`src/repondeur/demarrer.ts`), une ligne par espace, jamais montrée.
 */
export const SYSTEMES_SCENARIO = ['repondeur'] as const;
export type SystemeScenario = (typeof SYSTEMES_SCENARIO)[number];

/** Le nom qu'une ligne système porte, et celui que la frise et le journal des échecs disent à sa place. */
export const NOM_SCENARIO_SYSTEME: Readonly<Record<SystemeScenario, string>> = { repondeur: 'Répondeur automatique' };

/**
 * 🔴 LE FILTRE DE TOUTES LES LECTURES ET ÉCRITURES PUBLIQUES DE CE MAGASIN : une ligne système n'existe pour aucun
 * appelant. Posé ici, une fois, et pas chez les appelants : `GET /workflows`, `/nodes`, la détection de doublon de
 * nom, la résolution `/v1` par nom ou par code, le catalogue `/v1`, l'outil MCP `list_scenarios`, les outils de
 * l'agent de Meta, le lien de test, la publication et la suppression passent tous par ces méthodes. Seules
 * `assurerScenarioSysteme` et `designation` voient la ligne, et elles disent pourquoi.
 */
const PUBLIC = 'systeme is null';

/**
 * Le graphe sans la position de ses blocs, que le moteur ne lit jamais : déplacer un bloc est du rangement, pas une
 * modification à publier. `update` et la mise en ligne programmée comparent par lui. `g` est une expression SQL.
 * 🔴 Son jumeau SQL, `workflow_graphe_forme` (migration 0315), décide si une écriture de `graph` fait une version :
 * `tests/migration-0315.test.ts` exige que les deux restent la même expression.
 */
export const forme = (g: string): string => `jsonb_build_object(
  'edges', ${g}->'edges',
  'nodes', (select coalesce(jsonb_agg(n - 'position' order by ord), '[]'::jsonb)
              from jsonb_array_elements(coalesce(${g}->'nodes', '[]'::jsonb)) with ordinality as t(n, ord))
)`;

/** Remettre à rien une publication programmée : toute publication EXPLICITE (console, API) l'emporte sur elle. */
const SANS_PROGRAMMATION = 'programmed_graph = null, programmed_at = null, programmed_by = null';

/**
 * Une version programmée (menu « Scénario », lot 3, décision 18) : le brouillon jugé quand « Publier » est tombé pendant
 * la validation d'un template de bloc. `le` est la date à la MILLISECONDE (écrite tronquée) : la mise en ligne la
 * compare à celle de la base, et JS ne garde pas les microsecondes de Postgres.
 */
export interface Programmation {
  graphe: WorkflowGraph;
  le: string;
  par: string | null;
}

/**
 * Résultat d'un enregistrement de l'éditeur. `brouillon` est l'état après écriture : un enregistrement
 * identique au publié ne laisse aucun brouillon (cf. `update`), et l'éditeur ne doit pas proposer de publier
 * le vide.
 */
export interface MajScenario {
  /** Une ligne du tenant a-t-elle bougé ? false = scénario inconnu (ou d'un autre espace) -> 404. */
  trouve: boolean;
  /** Reste-t-il un brouillon non publié ? */
  brouillon: boolean;
}

/**
 * Suppression refusée par la base : un lien de chaîne WhatsApp (Channels Me) référence encore ce scénario
 * (`channelsme_links.workflow_id ... on delete restrict`). Traduite en 409, sinon la violation 23503
 * remonterait en 500 sans dire qu'un lien de chaîne bloque.
 */
/** Une ligne lue par l'API des scénarios : la marque d'origine en plus (migration 0267), hors de `COLS` à dessein. */
export type LigneApi = WorkflowRow & { origine: 'console' | 'api' };

/**
 * Ce qui utilise un scénario, en phrases lisibles : un refus de suppression les cite. Toutes les tables qui le visent
 * (relevé des clés étrangères vers `workflows`) sauf ses propres traces (`workflow_runs`, `workflow_node_events`,
 * `workflow_reports`), plus le répondeur et les « Aller à » d'autres scénarios, qui n'ont pas de clé étrangère. Une
 * campagne ne compte que tant qu'elle peut encore partir. Tout est scopé à l'espace.
 *
 * 🔴 La ligne Shopify qui tient le scénario (lot 5) : `shopify_lignes.workflow_id` est en `on delete cascade` (0299), une
 * suppression emporterait l'automation en silence. Son nom vient de `NOM_DU_SCENARIO` (constantes du serveur, aucune saisie).
 */
const NOM_DE_LA_LIGNE = `case l.evenement ${Object.entries(NOM_DU_SCENARIO).map(([e, n]) => `when '${e}' then '${n}'`).join(' ')} end`;

const UTILISATIONS = `
  select 'l’automation « ' || name || ' »' as u from automations where tenant_id = $1 and workflow_id = $2
  union all
  select 'la campagne « ' || name || ' »' from campaigns
   where tenant_id = $1 and workflow_id = $2 and status in ('scheduled', 'running', 'paused')
  union all
  select 'une étape de la campagne « ' || c.name || ' »' from campaign_etages e join campaigns c on c.id = e.campaign_id
   where c.tenant_id = $1 and e.workflow_id = $2 and c.status in ('scheduled', 'running', 'paused')
  union all
  select 'la publicité « ' || nom || ' »' from publicites where tenant_id = $1 and workflow_id = $2 and etat <> 'echec_creation'
  union all
  select 'le widget « ' || nom || ' »' from widgets where tenant_id = $1 and workflow_id = $2
  union all
  select 'un lien de chaîne WhatsApp' from channelsme_links where tenant_id = $1 and workflow_id = $2
  union all
  select 'le répondeur de l’espace' from tenant_settings where tenant_id = $1 and repondeur_workflow_id = $2
  union all
  select 'l’automation Shopify « ' || ${NOM_DE_LA_LIGNE} || ' »' from shopify_lignes l where l.tenant_id = $1 and l.workflow_id = $2
  union all
  select 'le bloc « Aller à » du scénario « ' || w2.name || ' »' from workflows w2
   where w2.tenant_id = $1 and w2.id <> $2 and w2.systeme is null and exists (
     select 1 from jsonb_array_elements(coalesce(w2.graph->'nodes', '[]'::jsonb) || coalesce(w2.draft_graph->'nodes', '[]'::jsonb)) n
      where n->>'type' = 'aller_a' and n->'data'->>'cible' in (
        select m->'data'->>'code' from workflows w,
               jsonb_array_elements(coalesce(w.graph->'nodes', '[]'::jsonb) || coalesce(w.draft_graph->'nodes', '[]'::jsonb)) m
         where w.id = $2 and w.tenant_id = $1 and w.systeme is null and m->'data'->>'code' is not null))`;

/** Une transaction sur un client du pool : toute requête de l’opération passe par lui. */
async function enTransaction<T>(pool: Pool, f: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await f(c);
    await c.query('commit');
    return r;
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/**
 * Le nom unique d'un scénario dans l'espace, comparé comme `/v1/sends` le résout (`eqName`, `src/ids/resolve.ts`) : sans
 * la casse ni les espaces aux bords. Sous un verrou consultatif de l'espace, tenu jusqu'à la fin de la transaction.
 * Unique PAR rayon : le Builder et le rayon Shopify peuvent avoir chacun leur « Panier abandonné », et `/v1` ne résout
 * jamais que le Builder.
 */
export async function nomPrisSousVerrou(
  c: PoolClient, tenantId: string, nom: string, sauf: string | null, rayon: Rayon,
): Promise<string | null> {
  await c.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`scenario-nom:${tenantId}`]);
  const r = await c.query<{ id: string }>(
    `select id from workflows where tenant_id = $1 and ${PUBLIC} and rayon = $4 and lower(btrim(name)) = lower(btrim($2))
       and ($3::uuid is null or id <> $3::uuid) limit 1`,
    [tenantId, nom, sauf, rayon],
  );
  return r.rows[0]?.id ?? null;
}

/**
 * L'insertion d'un scénario, en BROUILLON seulement (`draft_graph`) : rien n'est en ligne tant que personne n'a cliqué
 * « Publier ». Le seul SQL d'insertion : `PgWorkflowStore.insert` l'appelle avec son pool, la duplication entre espaces
 * (`src/ops/duplication/store.pg.ts`) avec le client de sa transaction, et un `id` tiré d'avance : les outils de l'agent
 * copié visent la copie avant qu'elle soit écrite. Sans `id`, la base le tire. Le rayon est REQUIS : il ne change plus
 * après la création.
 */
export async function insererBrouillon(
  q: Pick<Pool, 'query'>, tenantId: string, name: string, graph: WorkflowGraph, rayon: Rayon, id?: string,
): Promise<{ id: string }> {
  const code = makeCode('scn', await resolveTenantCode(q, tenantId));
  const res = await q.query<{ id: string }>(
    `insert into workflows (id, tenant_id, name, draft_graph, code, rayon)
     values (coalesce($5::uuid, gen_random_uuid()), $1, $2, $3::jsonb, $4, $6)
     returning id`,
    [tenantId, name, JSON.stringify(graph), code, id ?? null, rayon],
  );
  return { id: res.rows[0]!.id };
}

export class WorkflowUtiliseParLienChaine extends Error {
  constructor() { super('ce scénario est utilisé par un lien de chaîne WhatsApp'); this.name = 'WorkflowUtiliseParLienChaine'; }
}

/**
 * Store Postgres des workflows (bot builder). Scopé tenant.
 *
 * Deux graphes : `graph` est le publié (ce qui tourne), `draft_graph` le brouillon (ce qui s'édite). Toute
 * écriture de l'éditeur va au brouillon ; `graph` ne bouge que par une publication explicite (`publish`, l'API) ou par
 * la mise en ligne d'une version programmée (`mettreEnLigneLaVersionProgrammee`, lot 3), que toute publication
 * explicite efface. L'écrire ailleurs remettrait l'édition en direct sur la production.
 */
export class PgWorkflowStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Crée un scénario. Le graphe fourni part en brouillon, jamais en publié : rien n'est en ligne tant que
   * personne n'a cliqué « Publier » (vaut aussi pour la duplication).
   */
  async insert(tenantId: string, name: string, graph: WorkflowGraph, rayon: Rayon): Promise<{ id: string }> {
    return insererBrouillon(this.pool, tenantId, name, graph, rayon);
  }

  /*
   * 🔴 LES LISTES PRENNENT LE RAYON EN PARAMÈTRE REQUIS (menu « Scénario », lot 1) : le compilateur énumère chaque
   * appelant, qui le nomme. Un scénario d'un autre rayon n'existe pour aucune d'elles.
   */

  /** Les noms des scénarios publics, sans leurs graphes : pour une liste qui n'affiche qu'un nom (duplication `/ops`). */
  async listNoms(tenantId: string, rayon: Rayon): Promise<Array<{ id: string; name: string }>> {
    const res = await this.pool.query<{ id: string; name: string }>(
      `select id, name from workflows where tenant_id = $1 and ${PUBLIC} and rayon = $2 order by lower(name), id`,
      [tenantId, rayon],
    );
    return res.rows;
  }

  /**
   * La liste résumée, pour les écrans : jamais les graphes, qui pèseraient sur chaque écran qui n'affiche
   * qu'un nom.
   *
   * Nombre de blocs et présence d'un brouillon se calculent en SQL ; l'éligibilité demande un parcours du
   * graphe et se calcule ici, avec `scanOpening`, la même fonction que la garde de création de campagne. La
   * base envoie donc toujours le graphe à l'application : seul le trajet vers le navigateur disparaît. `list()`
   * reste pour ce qui a réellement besoin des graphes (résolution par code de `/v1/sends`).
   */
  async listResume(tenantId: string, rayon: Rayon): Promise<WorkflowResumeRow[]> {
    const res = await this.pool.query<{
      id: string; tenant_id: string; name: string; code: string | null;
      created_at: Date; updated_at: Date; published_at: Date | null;
      node_count: number; has_draft: boolean; graph: WorkflowGraph;
    }>(
      // `jsonb_array_length` et `is not null` se calculent dans Postgres. `coalesce(...,'[]')` : un graphe sans
      // `nodes` (ligne ancienne) ne doit pas faire échouer la requête pour tout l'espace.
      `select id, tenant_id, name, code, created_at, updated_at, published_at,
              jsonb_array_length(coalesce(graph->'nodes', '[]'::jsonb)) as node_count,
              (draft_graph is not null) as has_draft,
              graph
         from workflows where tenant_id = $1 and ${PUBLIC} and rayon = $2 order by created_at desc`,
      [tenantId, rayon],
    );
    return res.rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      code: r.code,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      publishedAt: r.published_at ? r.published_at.toISOString() : null,
      nodeCount: r.node_count,
      hasDraft: r.has_draft,
      // Même fonction que la garde serveur de création de campagne : l'écran ne peut ni proposer un scénario
      // qu'elle refusera, ni cacher un scénario qu'elle accepterait. Le booléen est dérivé du canal.
      campaignEligible: canalDOuverture(r.graph) !== null,
      canalOuverture: canalDOuverture(r.graph),
    }));
  }

  /**
   * Les scénarios en ligne, pour le catalogue de l'API publique (`GET /v1/scenarios`).
   *
   * « En ligne » = le graphe publié porte au moins un bloc. Un scénario neuf a un publié vide (`insert`) et un
   * envoi joue le publié : l'annoncer ferait construire un appel qui ne joue rien. `published_at` ne décide
   * pas : il vaut null sur des scénarios anciens qui tournent. Le graphe est transporté pour calculer
   * l'ouverture (`ouvertureApi`), il ne sort pas vers l'intégrateur.
   */
  async listPublies(tenantId: string, rayon: Rayon): Promise<ScenarioPublie[]> {
    const res = await this.pool.query<{ code: string | null; name: string; published_at: Date | null; graph: WorkflowGraph }>(
      `select code, name, published_at, graph
         from workflows
        where tenant_id = $1 and ${PUBLIC} and rayon = $2
          and jsonb_array_length(coalesce(graph->'nodes', '[]'::jsonb)) > 0
        order by name, created_at`,
      [tenantId, rayon],
    );
    return res.rows.map((r) => ({
      code: r.code,
      name: r.name,
      publishedAt: r.published_at ? r.published_at.toISOString() : null,
      graph: r.graph,
    }));
  }

  async list(tenantId: string, rayon: Rayon): Promise<WorkflowRow[]> {
    const res = await this.pool.query<Row>(
      `select ${COLS} from workflows where tenant_id = $1 and ${PUBLIC} and rayon = $2 order by created_at desc`,
      [tenantId, rayon],
    );
    return res.rows.map(toRow);
  }

  /**
   * Par identifiant, SANS filtre de rayon : la relecture du graphe d'un parcours (tous rayons), l'éditeur, et les gardes
   * qui comparent `rayon` elles-mêmes.
   */
  async getById(id: string, tenantId: string): Promise<WorkflowRow | null> {
    const res = await this.pool.query<Row>(
      `select ${COLS} from workflows where id = $1 and tenant_id = $2 and ${PUBLIC} limit 1`,
      [id, tenantId],
    );
    const r = res.rows[0];
    return r ? toRow(r) : null;
  }

  /** MAJ partielle (name/graph). `coalesce` : un champ absent ne l'écrase pas. Le graphe passé est déjà
   *  validé/sanitisé par la route (parseGraph).
   *
   *  Le graphe atterrit dans le brouillon : l'éditeur enregistre en continu (auto-save), et aucune de ces
   *  écritures ne doit atteindre les contacts en cours de parcours. */
  async update(id: string, tenantId: string, patch: { name?: string; graph?: WorkflowGraph }): Promise<MajScenario> {
    const res = await this.pool.query<{ brouillon: boolean }>(
      // `forme` : le graphe sans la position des blocs, que le moteur ne lit jamais : déplacer un bloc est du
      // rangement, pas une modification à publier.
      `with sans_positions as (
         select ${forme('w.graph')} as forme
         from workflows w where w.id = $1 and w.tenant_id = $2 and w.${PUBLIC}
       ),
       neuf as (
         select $4::jsonb as g, ${forme('$4::jsonb')} as forme
       )
       update workflows w set
         name = coalesce($3, name),
         -- MÊME SCÉNARIO, blocs déplacés : la nouvelle disposition va DANS le publié. Le rangement est
         -- conservé (il serait perdu au rechargement) sans demander à personne de publier une mise en page.
         graph = case when n.g is not null and n.forme = c.forme then n.g else w.graph end,
         -- Un brouillon IDENTIQUE au publié, AUX POSITIONS PRÈS, n'en est pas un : on le ramène à null, et
         -- l'écran cesse d'annoncer « modifications non publiées ». Sans ce cas, la simple OUVERTURE d'un
         -- scénario suffisait à en poser un (React Flow mesure les blocs au montage, ce qui déclenche
         -- l'auto-save), et tout scénario seulement consulté aurait porté le badge à vie.
         --
         -- ⚠️ Sans le cas des POSITIONS, le badge revenait indéfiniment (constaté le 2026-09-02) : publier,
         -- puis pousser un bloc de 40 px, et l'écran réclame de publier à nouveau. À deux sur un même
         -- scénario, plus personne ne pouvait le voir « en ligne ».
         draft_graph = case
           when n.g is null then w.draft_graph
           when n.forme = c.forme then null
           else n.g
         end,
         updated_at = now()
       from sans_positions c, neuf n
       where w.id = $1 and w.tenant_id = $2 and w.${PUBLIC}
       returning w.draft_graph is not null as brouillon`,
      [id, tenantId, patch.name ?? null, patch.graph ? JSON.stringify(patch.graph) : null],
    );
    const r = res.rows[0];
    return r ? { trouve: true, brouillon: r.brouillon } : { trouve: false, brouillon: false };
  }

  /**
   * Met en ligne le brouillon : il devient le graphe publié. La version précédente reste dans `workflow_versions`
   * (déclencheur de 0315) : on y revient en la republiant.
   *
   * Sans effet quand il n'y a rien à publier : `draft_graph` null laisse `graph` intact grâce au `coalesce`.
   * Sans lui, republier deux fois écraserait le publié par NULL, donc effacerait le scénario en production.
   *
   * Renvoie la ligne à jour (null si le scénario n'est pas au tenant), en un seul aller-retour qu'une autre
   * publication ne peut pas doubler.
   *
   * `graphe` : le brouillon que la route a JUGÉ (lot 3, relecture de 3a). Un enregistrement automatique tombé pendant le
   * jugement (la relecture chez Meta) ne met pas en ligne un brouillon que personne n'a jugé : il reste un brouillon ;
   * seulement déplacé depuis, c'est lui qui part, avec sa disposition (même règle que `update`).
   */
  async publish(id: string, tenantId: string, graphe?: WorkflowGraph): Promise<WorkflowRow | null> {
    if (graphe !== undefined) {
      const memeForme = `(w.draft_graph is not null and ${forme('w.draft_graph')} = ${forme('$3::jsonb')})`;
      const juge = await this.pool.query<Row>(
        `update workflows w set
           graph = case when ${memeForme} then w.draft_graph else $3::jsonb end,
           draft_graph = case when ${memeForme} then null else w.draft_graph end,
           published_at = now(),
           ${SANS_PROGRAMMATION},
           updated_at = now()
         where w.id = $1 and w.tenant_id = $2 and w.${PUBLIC}
         returning ${COLS}`,
        [id, tenantId, JSON.stringify(graphe)],
      );
      const j = juge.rows[0];
      return j ? toRow(j) : null;
    }
    const res = await this.pool.query<Row>(
      `update workflows set
         graph = coalesce(draft_graph, graph),
         -- La date ne bouge QUE s'il y avait quelque chose à mettre en ligne : sinon elle daterait d'un clic
         -- une publication qui n'a rien changé, et on ne pourrait plus dire depuis quand la version en cours
         -- est en ligne.
         published_at = case when draft_graph is not null then now() else published_at end,
         draft_graph = null,
         -- Une publication à la main l'emporte sur une version programmée (lot 3) : elle ne partira plus.
         ${SANS_PROGRAMMATION},
         updated_at = now()
       where id = $1 and tenant_id = $2 and ${PUBLIC}
       returning ${COLS}`,
      [id, tenantId],
    );
    const r = res.rows[0];
    return r ? toRow(r) : null;
  }

  /**
   * ─── La publication programmée (menu « Scénario », lot 3, décision 18) ───
   *
   * « Publier » pendant la validation d'un template de bloc copie ici le graphe JUGÉ (pas le brouillon du moment : une
   * sauvegarde entre le jugement et cette écriture programmerait des templates non jugés). Une programmation plus récente
   * remplace la précédente. null : scénario inconnu de cet espace.
   */
  async programmer(id: string, tenantId: string, par: string | null, graphe: WorkflowGraph): Promise<{ le: string } | null> {
    const r = await this.pool.query<{ le: Date }>(
      `update workflows set programmed_graph = $3::jsonb, programmed_at = date_trunc('milliseconds', now()), programmed_by = $4
        where id = $1 and tenant_id = $2 and ${PUBLIC}
        returning programmed_at as le`,
      [id, tenantId, JSON.stringify(graphe), par],
    );
    return r.rows[0] ? { le: r.rows[0].le.toISOString() } : null;
  }

  /** La version programmée de ce scénario, ou null. */
  async publicationProgrammee(id: string, tenantId: string): Promise<Programmation | null> {
    const r = await this.pool.query<{ graphe: WorkflowGraph; le: Date; par: string | null }>(
      `select programmed_graph as graphe, programmed_at as le, programmed_by as par from workflows
        where id = $1 and tenant_id = $2 and ${PUBLIC} and programmed_graph is not null`,
      [id, tenantId],
    );
    const l = r.rows[0];
    return l ? { graphe: l.graphe, le: l.le.toISOString(), par: l.par } : null;
  }

  /** Les versions programmées de l'espace (tous rayons) : celles qu'un statut tranché par Meta peut mettre en ligne. */
  async programmeesDeLEspace(tenantId: string): Promise<Array<Programmation & { id: string; nom: string; rayon: Rayon }>> {
    const r = await this.pool.query<{ id: string; name: string; rayon: string; graphe: WorkflowGraph; le: Date; par: string | null }>(
      `select id, name, rayon, programmed_graph as graphe, programmed_at as le, programmed_by as par from workflows
        where tenant_id = $1 and ${PUBLIC} and programmed_graph is not null`,
      [tenantId],
    );
    return r.rows.flatMap((l) => (estRayon(l.rayon)
      ? [{ id: l.id, nom: l.name, rayon: l.rayon, graphe: l.graphe, le: l.le.toISOString(), par: l.par }]
      : []));
  }

  /**
   * LECTURE TRANSVERSE (tous espaces), pour le filet seulement : les programmations de plus de `minutes`, tirées au
   * hasard. Elles se retentent (celle qui attend la fin d'une campagne, celle dont le statut est arrivé sans que la
   * mise en ligne ait pu se faire). Sans index : quelques lignes au plus, sur une table de quelques milliers.
   */
  async programmeesAnciennes(
    minutes: number, limite: number,
  ): Promise<Array<Programmation & { tenantId: string; id: string; nom: string; rayon: Rayon }>> {
    const r = await this.pool.query<{ tenant_id: string; id: string; name: string; rayon: string; graphe: WorkflowGraph; le: Date; par: string | null }>(
      `select tenant_id, id, name, rayon, programmed_graph as graphe, programmed_at as le, programmed_by as par from workflows
        where programmed_graph is not null and programmed_at <= now() - make_interval(mins => $1::int) and ${PUBLIC}
        order by random() limit $2`,
      [minutes, limite],
    );
    return r.rows.flatMap((l) => (estRayon(l.rayon)
      ? [{ tenantId: l.tenant_id, id: l.id, nom: l.name, rayon: l.rayon, graphe: l.graphe, le: l.le.toISOString(), par: l.par }]
      : []));
  }

  /**
   * Met en ligne la version programmée À SA DATE, en UNE instruction : si une publication explicite (console, API) ou
   * une programmation plus récente est passée entre-temps, la date ne correspond plus et rien ne bouge (null). Le
   * brouillon tombe s'il est la version programmée aux positions près ; seulement déplacé depuis, c'est lui qui part,
   * avec sa disposition (même règle que `update`) ; modifié depuis, il reste un brouillon.
   */
  async mettreEnLigneLaVersionProgrammee(id: string, tenantId: string, le: string): Promise<WorkflowRow | null> {
    const memeForme = `(w.draft_graph is not null and ${forme('w.draft_graph')} = ${forme('w.programmed_graph')})`;
    const res = await this.pool.query<Row>(
      `update workflows w set
         graph = case when ${memeForme} then w.draft_graph else w.programmed_graph end,
         draft_graph = case when ${memeForme} then null else w.draft_graph end,
         published_at = now(),
         ${SANS_PROGRAMMATION},
         updated_at = now()
       where w.id = $1 and w.tenant_id = $2 and w.${PUBLIC} and w.programmed_graph is not null and w.programmed_at = $3::timestamptz
       returning ${COLS}`,
      [id, tenantId, le],
    );
    const r = res.rows[0];
    return r ? toRow(r) : null;
  }

  /**
   * Annule la version programmée : à sa date seulement (un refus de Meta ne doit pas emporter une programmation plus
   * récente), ou sans condition (`le` null : le marchand l'annule). Le graphe en ligne ne bouge pas.
   */
  async annulerProgrammation(id: string, tenantId: string, le: string | null): Promise<boolean> {
    const r = await this.pool.query(
      `update workflows set ${SANS_PROGRAMMATION}
        where id = $1 and tenant_id = $2 and ${PUBLIC} and programmed_graph is not null
          and ($3::timestamptz is null or programmed_at = $3::timestamptz)`,
      [id, tenantId, le],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Supprime le scénario. Lève `WorkflowUtiliseParLienChaine` (traduite en 409 par la route) quand un lien de
   * chaîne WhatsApp le référence encore : `channelsme_links.workflow_id` est en `on delete restrict`, donc
   * Postgres refuse la suppression (23503) plutôt que de la laisser passer.
   */
  async remove(id: string, tenantId: string): Promise<boolean> {
    try {
      const res = await this.pool.query(`delete from workflows where id = $1 and tenant_id = $2 and ${PUBLIC}`, [id, tenantId]);
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      if ((err as { code?: string } | null)?.code === '23503') throw new WorkflowUtiliseParLienChaine();
      throw err;
    }
  }

  /**
   * ─── L'API des scénarios (spec 2026-11-02-scenarios-api) ───
   *
   * 🔴 Ces deux écritures PUBLIENT (`graph`), jamais le brouillon (leurs jumelles `…BrouillonParApi`, CSM B4, n'écrivent
   * que lui), et la marque `origine = 'api'` est posée à la création
   * seulement. Le nom est unique (`nomPrisSousVerrou`), et 🔴 toute requête de l'opération passe par le client qui tient
   * le verrou, jamais par `this.pool`.
   */
  async creerPublieParApi(tenantId: string, nom: string, graphe: WorkflowGraph): Promise<{ id: string; code: string } | { nomPris: string }> {
    return enTransaction(this.pool, async (c) => {
      const pris = await nomPrisSousVerrou(c, tenantId, nom, null, 'general');
      if (pris) return { nomPris: pris };
      const code = makeCode('scn', await resolveTenantCode(c, tenantId));
      const r = await c.query<{ id: string; code: string }>(
        `insert into workflows (tenant_id, name, graph, draft_graph, published_at, code, origine, rayon)
         values ($1, $2, $3::jsonb, null, now(), $4, 'api', 'general') returning id, code`,
        [tenantId, nom, JSON.stringify(graphe), code],
      );
      return r.rows[0]!;
    });
  }

  /** Par uuid ou par code `scn_`. */
  async lireParApi(tenantId: string, ref: string): Promise<LigneApi | null> {
    const r = await this.pool.query<Row & { origine: 'console' | 'api' }>(
      `select ${COLS}, origine from workflows where tenant_id = $1 and ${PUBLIC} and ${DU_BUILDER} and (id::text = $2 or code = $2) limit 1`,
      [tenantId, ref],
    );
    const l = r.rows[0];
    return l ? { ...toRow(l), origine: l.origine } : null;
  }

  /**
   * Crée en BROUILLON (lot 1 du CSM virtuel, B4) : la recette compilée part dans `draft_graph`, le graphe publié reste
   * vide (la colonne par défaut), donc rien ne peut lancer ce scénario et le déclencheur des versions n'en fait aucune.
   * Le nom reste unique dans le Builder, comme pour une création publiée : un rejeu rend le scénario déjà créé.
   */
  async creerBrouillonParApi(tenantId: string, nom: string, graphe: WorkflowGraph): Promise<{ id: string; code: string } | { nomPris: string }> {
    return enTransaction(this.pool, async (c) => {
      const pris = await nomPrisSousVerrou(c, tenantId, nom, null, 'general');
      if (pris) return { nomPris: pris };
      const code = makeCode('scn', await resolveTenantCode(c, tenantId));
      const r = await c.query<{ id: string; code: string }>(
        `insert into workflows (tenant_id, name, draft_graph, code, origine, rayon)
         values ($1, $2, $3::jsonb, $4, 'api', 'general') returning id, code`,
        [tenantId, nom, JSON.stringify(graphe), code],
      );
      return r.rows[0]!;
    });
  }

  /**
   * Remplace le BROUILLON seul (CSM, B4), sur un scénario du Builder, console comprise : le publié ne bouge pas. Un
   * brouillon de même forme que le publié n'en est pas un (la règle de `update`). `controle` juge la ligne SOUS SON
   * VERROU : un brouillon de la console enregistré entre la lecture de l'appelant et cette écriture est vu ici.
   */
  async remplacerBrouillonParApi<R>(
    id: string, tenantId: string, nom: string, graphe: WorkflowGraph, controle: (l: LigneApi) => R | null,
  ): Promise<'ok' | 'inconnu' | { nomPris: string } | { refus: R }> {
    return enTransaction(this.pool, async (c) => {
      const r = await c.query<Row & { origine: 'console' | 'api' }>(
        `select ${COLS}, origine from workflows where id = $1 and tenant_id = $2 and ${PUBLIC} and ${DU_BUILDER} for update`,
        [id, tenantId],
      );
      const l = r.rows[0];
      if (!l) return 'inconnu' as const;
      const refus = controle({ ...toRow(l), origine: l.origine });
      if (refus !== null) return { refus };
      const pris = await nomPrisSousVerrou(c, tenantId, nom, id, 'general');
      if (pris) return { nomPris: pris };
      await c.query(
        `update workflows w set name = $3,
                draft_graph = case when ${forme('$4::jsonb')} = ${forme('w.graph')} then null else $4::jsonb end,
                updated_at = now()
          where w.id = $1 and w.tenant_id = $2 and w.${PUBLIC} and w.${DU_BUILDER}`,
        [id, tenantId, nom, JSON.stringify(graphe)],
      );
      return 'ok' as const;
    });
  }

  /**
   * Remplace et publie. `controle` juge la ligne SOUS SON VERROU (`for update`) : une publication de la console entre
   * la lecture de l'appelant et cette écriture est vue ici, jamais écrasée.
   */
  async remplacerPublieParApi<R>(
    id: string, tenantId: string, nom: string, graphe: WorkflowGraph, controle: (l: LigneApi) => R | null,
  ): Promise<'ok' | 'inconnu' | { nomPris: string } | { refus: R }> {
    return enTransaction(this.pool, async (c) => {
      const r = await c.query<Row & { origine: 'console' | 'api' }>(
        `select ${COLS}, origine from workflows where id = $1 and tenant_id = $2 and ${PUBLIC} and ${DU_BUILDER} for update`,
        [id, tenantId],
      );
      const l = r.rows[0];
      if (!l) return 'inconnu' as const;
      const refus = controle({ ...toRow(l), origine: l.origine });
      if (refus !== null) return { refus };
      const pris = await nomPrisSousVerrou(c, tenantId, nom, id, 'general');
      if (pris) return { nomPris: pris };
      await c.query(
        `update workflows set name = $3, graph = $4::jsonb, draft_graph = null, published_at = now(), ${SANS_PROGRAMMATION},
                updated_at = now()
          where id = $1 and tenant_id = $2 and ${PUBLIC} and ${DU_BUILDER}`,
        [id, tenantId, nom, JSON.stringify(graphe)],
      );
      return 'ok' as const;
    });
  }

  /**
   * Ce qui lance ce scénario, pour ses départs (menu « Scénario », lot 2) : ses automations ALLUMÉES (déclencheur et bloc
   * de départ) et les campagnes actives (programmées, en cours, en pause) qui le lancent, à l'entrée ou par un étage.
   * Aucune lecture de `workflows` : `tenant_id = $1` sur chaque table lue. Un déclencheur inconnu en base est ignoré.
   */
  async lanceursDuScenario(tenantId: string, id: string): Promise<Lanceur[]> {
    const r = await this.pool.query<{ type: 'automation' | 'campagne'; nom: string; declencheur: string | null; bloc_de_depart: string | null }>(
      `select 'automation' as type, a.name as nom, a.trigger_kind as declencheur, a.start_node_id as bloc_de_depart
         from automations a where a.tenant_id = $1 and a.workflow_id = $2 and a.enabled
       union all
       select 'campagne', c.name, null, null from campaigns c
        where c.tenant_id = $1 and c.workflow_id = $2 and c.status in ('scheduled', 'running', 'paused')
       union all
       select 'campagne', c.name, null, null from campaign_etages e join campaigns c on c.id = e.campaign_id
        where c.tenant_id = $1 and e.workflow_id = $2 and c.status in ('scheduled', 'running', 'paused')`,
      [tenantId, id],
    );
    const connus = AUTOMATION_TRIGGER_KINDS as readonly string[];
    return r.rows.flatMap((l): Lanceur[] => {
      if (l.type === 'campagne') return [{ type: 'campagne', nom: l.nom, declencheur: null, blocDeDepart: null }];
      if (l.declencheur === null || !connus.includes(l.declencheur)) return [];
      return [{ type: 'automation', nom: l.nom, declencheur: l.declencheur as AutomationTriggerKind, blocDeDepart: l.bloc_de_depart }];
    });
  }

  /**
   * Les graphes PUBLIÉS de ces scénarios de l'espace (système exclu, tous rayons), pour l'avertissement de chaque
   * automation (`GET /automations`) : une lecture pour toute la liste, jamais une par automation.
   */
  async graphesPublies(tenantId: string, ids: readonly string[]): Promise<Map<string, WorkflowGraph>> {
    if (ids.length === 0) return new Map();
    const r = await this.pool.query<{ id: string; graph: WorkflowGraph | null }>(
      `select id, graph from workflows where tenant_id = $1 and ${PUBLIC} and id = any($2::uuid[])`,
      [tenantId, [...ids]],
    );
    return new Map(r.rows.map((x) => [x.id, x.graph ?? EMPTY_GRAPH]));
  }

  /**
   * Un graphe de l'espace nomme-t-il encore ce template (un bloc `template`, nom lu sans ses espaces comme `actionOf`) ? Le
   * publié, le brouillon et la version programmée, TOUS rayons (le scénario système n'a pas de graphe) : le ménage des templates de bloc
   * (`traiterOubli`) ne supprime chez Meta que ce que plus rien ici n'envoie ni n'enverra.
   */
  async nommeLeModele(tenantId: string, modele: string): Promise<boolean> {
    const r = await this.pool.query<{ nomme: boolean }>(
      `select exists (
         select 1 from workflows w
          cross join lateral jsonb_array_elements(coalesce(w.graph->'nodes', '[]'::jsonb)
            || coalesce(w.draft_graph->'nodes', '[]'::jsonb) || coalesce(w.programmed_graph->'nodes', '[]'::jsonb)) n
          where w.tenant_id = $1 and w.${PUBLIC} and n->>'type' = 'template' and btrim(n->'data'->>'templateName') = $2) as nomme`,
      [tenantId, modele],
    );
    return r.rows[0]?.nomme === true;
  }

  /** Ce qui utilise ce scénario (`UTILISATIONS`) : vide = il peut partir. */
  async utilisationsDuScenario(tenantId: string, id: string, q: Pick<Pool, 'query'> = this.pool): Promise<string[]> {
    const r = await q.query<{ u: string }>(UTILISATIONS, [tenantId, id]);
    return r.rows.map((x) => x.u);
  }

  /** Supprime un scénario de l'API qui ne sert plus, sous le verrou de sa ligne. */
  async supprimerParApi(id: string, tenantId: string): Promise<'ok' | 'inconnu' | 'console' | { utilise: string[] }> {
    return enTransaction(this.pool, async (c) => {
      const r = await c.query<{ origine: string }>(
        `select origine from workflows where id = $1 and tenant_id = $2 and ${PUBLIC} and ${DU_BUILDER} for update`, [id, tenantId]);
      const l = r.rows[0];
      if (!l) return 'inconnu' as const;
      if (l.origine !== 'api') return 'console' as const;
      const utilise = await this.utilisationsDuScenario(tenantId, id, c);
      if (utilise.length > 0) return { utilise };
      await c.query(`delete from workflows where id = $1 and tenant_id = $2 and ${PUBLIC} and ${DU_BUILDER}`, [id, tenantId]);
      return 'ok' as const;
    });
  }

  /**
   * Jeton de test du scénario, créé à la demande puis stable (le lien wa.me et son QR restent valables).
   * Renvoie le jeton existant, sinon en pose un neuf ; null si le scénario n'appartient pas au tenant.
   * `coalesce` dans l'UPDATE : deux clics simultanés sur « Tester » ne peuvent pas produire deux jetons.
   */
  async ensureTestToken(id: string, tenantId: string, token: string): Promise<string | null> {
    const res = await this.pool.query<{ test_token: string }>(
      `update workflows set test_token = coalesce(test_token, $3), updated_at = updated_at
       where id = $1 and tenant_id = $2 and ${PUBLIC} returning test_token`,
      [id, tenantId, token],
    );
    return res.rows[0]?.test_token ?? null;
  }

  /**
   * Scénario associé à un jeton de test. Chemin chaud (un message entrant qui ressemble à un jeton), servi
   * par l'index unique partiel `workflows_test_token_key`. 🔴 Pas de scope tenant en entrée : le jeton désigne
   * le tenant, et c'est l'appelant qui vérifie ensuite que le numéro correspond.
   */
  async findByTestToken(token: string): Promise<WorkflowRow | null> {
    const res = await this.pool.query<Row>(
      `select ${COLS} from workflows where test_token = $1 and ${PUBLIC} limit 1`,
      [token],
    );
    const r = res.rows[0];
    return r ? toRow(r) : null;
  }

  /**
   * L'identifiant du scénario système de l'espace, créé à sa première utilisation (nom `NOM_SCENARIO_SYSTEME`,
   * graphe publié vide par défaut, aucun brouillon). Il n'est que l'ancre que `workflow_runs.workflow_id` exige : le
   * graphe joué est construit à chaque démarrage et figé dans le parcours, rien ne s'écrit jamais sur cette ligne.
   *
   * Sans course : la lecture d'abord (le cas de tous les démarrages sauf le premier), puis une insertion arbitrée
   * par l'index unique partiel `workflows_systeme_uidx`. Deux premiers démarrages simultanés insèrent chacun ; le
   * second attend la validation du premier, ne fait rien (`do nothing`), et relit la ligne de l'autre. 🔴 Le
   * prédicat du `on conflict` est celui de l'index, mot pour mot : sans lui, Postgres ne trouve aucun index à
   * arbitrer et l'insertion lève (`tests/migration-0209.test.ts` compare les deux).
   */
  async assurerScenarioSysteme(tenantId: string, systeme: SystemeScenario): Promise<string> {
    const lire = async (): Promise<string | null> => (await this.pool.query<{ id: string }>(
      `select id from workflows where tenant_id = $1 and systeme = $2 limit 1`,
      [tenantId, systeme],
    )).rows[0]?.id ?? null;
    const existant = await lire();
    if (existant !== null) return existant;
    const code = makeCode('scn', await resolveTenantCode(this.pool, tenantId));
    const cree = await this.pool.query<{ id: string }>(
      `insert into workflows (tenant_id, name, code, systeme) values ($1, $2, $3, $4)
       on conflict (tenant_id) where systeme = 'repondeur' do nothing
       returning id`,
      [tenantId, NOM_SCENARIO_SYSTEME[systeme], code, systeme],
    );
    const id = cree.rows[0]?.id ?? await lire();
    if (id === null) throw new Error(`scénario système ${systeme} introuvable après sa création (${tenantId})`);
    return id;
  }

  /**
   * Comment la frise et les journaux désignent un scénario, ligne système comprise : c'est la seule lecture de ce
   * magasin qui la voit, parce qu'un parcours du répondeur qui passe la main à l'équipe doit dire « Répondeur
   * automatique » et pas un identifiant. Rien d'autre qu'un libellé n'en sort. `null` : inconnu dans cet espace.
   */
  async designation(id: string, tenantId: string): Promise<{ nom: string; systeme: SystemeScenario | null } | null> {
    const res = await this.pool.query<{ name: string; systeme: string | null }>(
      `select name, systeme from workflows where id = $1 and tenant_id = $2 limit 1`,
      [id, tenantId],
    );
    const r = res.rows[0];
    if (!r) return null;
    const systeme = SYSTEMES_SCENARIO.find((x) => x === r.systeme) ?? null;
    return { nom: r.name, systeme };
  }
}

/**
 * Ce que la frise du panneau Détail dit d'un scénario qui passe la main : « scénario Bienvenue », ou le nom d'un
 * scénario système (« Répondeur automatique »), ou l'identifiant d'un scénario introuvable (supprimé depuis).
 */
export function designationDuScenario(d: { nom: string; systeme: SystemeScenario | null } | null, workflowId: string): string {
  if (d?.systeme) return NOM_SCENARIO_SYSTEME[d.systeme];
  return `scénario ${d?.nom ?? workflowId}`;
}

/**
 * Ce que l'éditeur ouvre, et ce que le lien de test joue : le brouillon s'il existe, sinon le publié. Point
 * de passage unique : tout le reste du dépôt lit `row.graph` (le publié), et un contact réel ne doit jamais
 * tomber dans un brouillon.
 */
export function grapheEditable(row: Pick<WorkflowRow, 'graph' | 'draftGraph'>): WorkflowGraph {
  return row.draftGraph ?? row.graph;
}

interface Row {
  id: string; tenant_id: string; name: string; code: string | null;
  graph: WorkflowGraph | null; draft_graph: WorkflowGraph | null;
  published_at: Date | null; created_at: Date; updated_at: Date; rayon: string;
}
function toRow(r: Row): WorkflowRow {
  // Le CHECK `workflows_rayon_chk` interdit tout autre valeur : en lire une est un état impossible, pas un défaut à
  // deviner (un rayon deviné ferait passer la ligne d'un rayon dans un autre).
  if (!estRayon(r.rayon)) throw new Error(`workflow ${r.id} : rayon illisible (${String(r.rayon)})`);
  return {
    id: r.id,
    rayon: r.rayon,
    tenantId: r.tenant_id,
    name: r.name,
    code: r.code,
    graph: r.graph ?? EMPTY_GRAPH,
    draftGraph: r.draft_graph ?? null,
    publishedAt: r.published_at ? r.published_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
