import type { Pool } from 'pg';
import { screensOf } from '../../meta/flow-json';
import { estUuid } from '../../http/scope';
import type { ReferenceDependance } from './graphe';
import type { DependancesSource, NomsPris, OutilSource } from './dependances';
import type { FlowSource } from './meta';

/**
 * LES DÉPENDANCES D'UN SCÉNARIO DUPLIQUÉ, EN BASE (lot 2 ; plan `docs/superpowers/plans/2026-11-17-duplication-scenario-lot-2.md`).
 *
 * 🔴 ISOLATION. Chaque lecture filtre l'espace SOURCE ; chaque copie est un `INSERT … SELECT` qui porte les DEUX
 * filtres : la ligne lue `where id = $1 and tenant_id = $2` (la source), la ligne écrite avec `tenant_id` = la
 * destination. Une copie qui n'insère rien (ligne disparue, ou id d'un autre espace) LÈVE : la transaction est annulée.
 *
 * 🔴 SECRET. `auth_secret_enc` passe d'une ligne à l'autre sans jamais être lu par l'application : chiffré par la seule
 * `ENCRYPTION_KEY`, sans donnée associée (`src/crypto/secretbox.ts`), il se déchiffre tel quel dans la destination.
 *
 * Toutes les fonctions prennent le client de la transaction (`Pick<Pool, 'query'>`), jamais le pool.
 */

type Q = Pick<Pool, 'query'>;

const uniques = (l: readonly string[]): string[] => [...new Set(l)];

/** Ce que le scénario désigne dans la source, et ce qu'il emporterait : agents et leurs outils, requêtes, sources, modèles. */
export async function lireDependances(q: Q, source: string, refs: readonly ReferenceDependance[]): Promise<DependancesSource> {
  // Un identifiant qui n'est pas un UUID (écrit par l'API REST dans un bloc) ferait échouer le cast `uuid[]` et toute la
  // lecture : il est écarté, et son bloc arrive débranché comme au lot 1 (relecture du lot 2).
  const ids = (sorte: ReferenceDependance['sorte']) => uniques(refs.filter((r) => r.sorte === sorte && estUuid(r.id)).map((r) => r.id));
  const agentIds = ids('agent');

  const agents = agentIds.length === 0 ? [] : (await q.query<{ id: string; label: string; fiches: number }>(
    `select a.id, a.label,
            (select count(*)::int from agent_knowledge k where k.agent_id = a.id and k.tenant_id = $1) as fiches
       from agents a where a.tenant_id = $1 and a.id = any($2::uuid[]) order by a.id`,
    [source, agentIds],
  )).rows;
  const outils = agents.length === 0 ? [] : (await q.query<{
    consommateur: string; id: string; name: string; origin: OutilSource['origine']; agent_id: string | null; binding: unknown; request_id: string | null;
    gestes: unknown;
  }>(
    `select c.consommateur, t.id, t.name, t.origin, t.agent_id, t.binding, t.request_id, t.gestes
       from agent_tool_consommateurs c
       join agent_tools t on t.id = c.tool_id and t.tenant_id = c.tenant_id
      where c.tenant_id = $1 and c.consommateur = any($2::text[])
      order by c.consommateur, t.id`,
    [source, agents.map((a) => `agent:${a.id}`)],
  )).rows;

  const requeteIds = uniques([...ids('requete'), ...outils.flatMap((o) => (o.request_id ? [o.request_id] : []))]);
  const requetes = requeteIds.length === 0 ? [] : (await q.query<{ id: string; label: string; source_id: string; variables: unknown }>(
    `select id, label, source_id, variables from connector_requests where tenant_id = $1 and id = any($2::uuid[]) order by id`,
    [source, requeteIds],
  )).rows;
  const sourceIds = uniques(requetes.map((r) => r.source_id));
  const sources = sourceIds.length === 0 ? [] : (await q.query<{ id: string; label: string; secret: boolean }>(
    // Le chiffré n'est jamais lu : seulement sa présence.
    `select id, label, (auth_secret_enc is not null) as secret from agent_tool_sources
      where tenant_id = $1 and id = any($2::uuid[]) order by id`,
    [source, sourceIds],
  )).rows;
  const modeleIds = ids('modele_email');
  const modeles = modeleIds.length === 0 ? [] : (await q.query<{ id: string; name: string; subject: string; body: string }>(
    `select id, name, subject, body from email_templates
      where tenant_id = $1 and id = any($2::uuid[]) and deleted_at is null order by id`,
    [source, modeleIds],
  )).rows;

  return {
    agents: agents.map((a) => ({
      id: a.id, label: a.label, fiches: a.fiches,
      outils: outils.filter((o) => o.consommateur === `agent:${a.id}`).map((o) => ({
        id: o.id, nom: o.name, origine: o.origin, proprietaire: o.agent_id === a.id, binding: o.binding, requeteId: o.request_id,
        gestes: o.gestes,
      })),
    })),
    requetes: requetes.map((r) => ({ id: r.id, label: r.label, sourceId: r.source_id, variables: r.variables })),
    sources: sources.map((s) => ({ id: s.id, label: s.label, secret: s.secret })),
    modelesEmail: modeles.map((m) => ({ id: m.id, nom: m.name, sujet: m.subject, corps: m.body })),
  };
}

/** Les noms déjà pris dans la destination, table par table (les outils : ceux de l'espace, pas ceux d'un agent). */
export async function nomsPris(q: Q, destination: string): Promise<NomsPris> {
  const lire = async (sql: string): Promise<string[]> => (await q.query<{ n: string }>(sql, [destination])).rows.map((r) => r.n).sort();
  return {
    agents: await lire('select label as n from agents where tenant_id = $1'),
    requetes: await lire('select label as n from connector_requests where tenant_id = $1'),
    sources: await lire('select label as n from agent_tool_sources where tenant_id = $1'),
    modelesEmail: await lire('select name as n from email_templates where tenant_id = $1 and deleted_at is null'),
    outils: await lire('select name as n from agent_tools where tenant_id = $1 and agent_id is null'),
    flows: await lire('select name as n from flows where tenant_id = $1'),
  };
}

/**
 * Les Flows de la source que le scénario ouvre (lot 3), par leurs ids Meta, dans l'espace source SEULEMENT : un id d'un
 * autre espace, glissé dans un graphe ou un bouton, ne se lit pas. Écrans normalisés comme la base les sert (`screensOf`).
 */
export async function lireFlowsSource(q: Q, source: string, ids: readonly string[]): Promise<FlowSource[]> {
  if (ids.length === 0) return [];
  const lignes = (await q.query<{ id: string; name: string; status: string; elements: unknown; mapping: Record<string, string> | null; cta: string | null }>(
    `select id, name, status, elements, mapping, cta from flows where tenant_id = $1 and id = any($2::text[]) order by id`,
    [source, [...new Set(ids)]],
  )).rows;
  return lignes.map((f) => ({
    id: f.id, nom: f.name, publie: f.status === 'PUBLISHED', ecrans: screensOf(f.elements), mapping: f.mapping ?? {}, cta: f.cta,
  }));
}

async function inserer(q: Q, sql: string, params: unknown[], quoi: string): Promise<string> {
  const r = await q.query<{ id: string }>(sql, params);
  const id = r.rows[0]?.id;
  if (!id) throw new Error(`duplication : ${quoi} introuvable dans l’espace source`);
  return id;
}

/**
 * La source : sa configuration et son chiffré tels quels, son statut ; jamais essayée depuis la destination. Sans
 * `secret_publie_le`, qui date l'acceptation du secret par Meta pour CET espace (0129) : faux dans la destination
 * (relecture du lot 2).
 */
export function copierSource(q: Q, source: string, destination: string, id: string, label: string): Promise<string> {
  return inserer(q, `
    insert into agent_tool_sources (tenant_id, kind, label, base_url, auth_kind, auth_header_name, auth_secret_enc, status)
    select $3, kind, $4, base_url, auth_kind, auth_header_name, auth_secret_enc, status
      from agent_tool_sources where id = $1 and tenant_id = $2
    returning id`, [id, source, destination, label], 'la source');
}

/** La requête, sur la source copiée ; ses en-têtes suivent, pas ses valeurs d'essai (celles d'un vrai contact, peut-être). */
export function copierRequete(q: Q, source: string, destination: string, id: string, label: string, sourceCopiee: string): Promise<string> {
  return inserer(q, `
    insert into connector_requests (tenant_id, source_id, label, method, path, query, headers, body_mode, body_json, body_champs, variables, output_paths)
    select $3, $5, $4, method, path, query, headers, body_mode, body_json, body_champs, variables, output_paths
      from connector_requests where id = $1 and tenant_id = $2
    returning id`, [id, source, destination, label, sourceCopiee], 'la requête');
}

export function copierModeleEmail(q: Q, source: string, destination: string, id: string, nom: string): Promise<string> {
  return inserer(q, `
    insert into email_templates (tenant_id, name, format, subject, body)
    select $3, $4, format, subject, body from email_templates where id = $1 and tenant_id = $2 and deleted_at is null
    returning id`, [id, source, destination, nom], 'le modèle d’e-mail');
}

/** L'agent en brouillon, puis TOUTES ses fiches en un `INSERT … SELECT`, vecteurs et provenance compris (rien à revectoriser). */
export async function copierAgent(q: Q, source: string, destination: string, id: string, label: string): Promise<string> {
  const copie = await inserer(q, `
    insert into agents (tenant_id, label, fiche, fiche_version, mention_ia, modele, max_tours, max_appels_outils, budget_micro_eur,
                        inactivite_minutes, contact_inconnu, status)
    select $3, $4, fiche, fiche_version, mention_ia, modele, max_tours, max_appels_outils, budget_micro_eur,
           inactivite_minutes, contact_inconnu, 'draft'
      from agents where id = $1 and tenant_id = $2
    returning id`, [id, source, destination, label], 'l’agent');
  await q.query(`
    insert into agent_knowledge (tenant_id, agent_id, titre, corps, source_url, derniere_lecture_at, embedding, embedding_modele, source_type, source_nom)
    select $3, $4, titre, corps, source_url, derniere_lecture_at, embedding, embedding_modele, source_type, source_nom
      from agent_knowledge where agent_id = $1 and tenant_id = $2`, [id, source, destination, copie]);
  return copie;
}

/** La DÉFINITION d'un outil : sa configuration telle quelle, sa cible rebranchée (`binding`), ses requête et source
 *  copiées. Sans liaison : `lierOutil` la donne à chaque agent copié qui la consomme. */
export async function copierOutil(q: Q, source: string, destination: string, id: string, o: {
  nom: string; agentProprietaire: string | null; requeteCopiee: string | null; sourceCopiee: string | null; binding: unknown;
}): Promise<string> {
  return inserer(q, `
    insert into agent_tools (tenant_id, origin, name, title, description, ne_pas_utiliser, params, binding, output_paths, risk, timeout_ms,
                             max_bytes, source_id, request_id, nature, source_kind, agent_id, gestes, pour_agent_meta, mcp_propose)
    select $3, origin, $4, title, description, ne_pas_utiliser, params, $5::jsonb, output_paths, risk, timeout_ms,
           max_bytes, $6, $7, nature, source_kind, $8, gestes, pour_agent_meta, mcp_propose
      from agent_tools where id = $1 and tenant_id = $2
    returning id`,
  [id, source, destination, o.nom, JSON.stringify(o.binding ?? {}), o.sourceCopiee, o.requeteCopiee, o.agentProprietaire], 'l’outil');
}

/** La liaison d'un outil copié à un agent copié, DÉSACTIVÉE (la base exige qu'un humain de l'espace l'active :
 *  `active_par`). `nom` est celui de l'outil : la clé composite `(tool_id, tool_name)` le recopie. */
export async function lierOutil(q: Q, destination: string, outil: string, agent: string, nom: string): Promise<void> {
  await q.query(
    `insert into agent_tool_consommateurs (tenant_id, tool_id, consommateur, actif, autonome, tool_name)
     values ($1, $2, 'agent:' || $3::text, false, false, $4)`,
    [destination, outil, agent, nom],
  );
}
