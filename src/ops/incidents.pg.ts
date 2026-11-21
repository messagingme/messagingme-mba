import type { Pool } from 'pg';
import type { Instantane, IncidentsStore } from './incidents';
import { BASE_QUEUES } from '../queue/names';
import type { Rapport } from '../http/incidents-rapport';
import type { Decision } from '../http/incidents-decision';

/**
 * Les lectures de l'instantané d'un incident et le stockage des incidents (plan 2026-11-21, lot 1). Tout est en lecture
 * seule, sur le dernier quart d'heure. ⚠️ Jamais de `group_id` de pg-boss (pour `webhook`, c'est le numéro et le wa_id
 * d'un contact) ni de texte de requête de `pg_stat_activity` (il peut porter un message) : des noms, des durées, des
 * comptes.
 */

const QUART = `now() - interval '15 minutes'`;

/** Le plafond de chaque lecture : une capture ne doit jamais aggraver la base qu'elle photographie. */
export const DELAI_LECTURE_INSTANTANE_MS = 3_000;

export class PgIncidentsStore implements IncidentsStore {
  constructor(private readonly pool: Pool, private readonly schemaPgBoss: string) {}

  async ouvrir(i: Parameters<IncidentsStore['ouvrir']>[0]): Promise<number> {
    const res = await this.pool.query<{ id: string }>(
      `insert into incidents (source, signal, etat, texte, instantane) values ($1, $2, $3, $4, $5) returning id`,
      [i.source, i.signal.slice(0, 200), i.etat, i.texte, i.instantane === null ? null : JSON.stringify(i.instantane)],
    );
    return Number(res.rows[0]!.id);
  }

  async clore(signal: string, instantane: Instantane | null): Promise<void> {
    // Sert `incidents_ouverts_idx` : son prédicat est `clos_le is null`, mot pour mot.
    await this.pool.query(
      `update incidents set clos_le = now(), instantane_fin = $2
        where id = (select id from incidents where signal = $1 and clos_le is null order by ouvert_le desc limit 1)`,
      [signal, instantane === null ? null : JSON.stringify(instantane)],
    );
  }

  /** Inscrit le rapport de la tâche cloud, une seule fois par incident (`rapport_le is null`). */
  async rapporter(id: number, r: Rapport): Promise<{ signal: string } | null> {
    const res = await this.pool.query<{ signal: string }>(
      `update incidents set categorie = $2, issue = $3, rapport = $4, action = $5, fichier = $6, rapport_le = now()
        where id = $1 and rapport_le is null returning signal`,
      [id, r.categorie, r.issue, r.rapport, r.action ?? null, r.fichier ?? null],
    );
    return res.rows[0] ?? null;
  }

  /** Inscrit la décision de Julien, une seule fois, et seulement sur un incident qui la demandait (issue 2). */
  async decider(id: number, decision: Decision): Promise<boolean> {
    const res = await this.pool.query(
      `update incidents set decision = $2, decide_le = now() where id = $1 and issue = 2 and decision is null`,
      [id, decision],
    );
    return (res.rowCount ?? 0) === 1;
  }

  /** L'état du système maintenant. Une lecture qui échoue est notée dans l'instantané, sans faire échouer les autres. */
  async lireInstantane(): Promise<Instantane> {
    const s = this.schemaPgBoss;
    const lectures: Record<string, string> = {
      files: `
        select name as file,
               count(*) filter (where created_on > ${QUART})::int as crees_15min,
               count(*) filter (where state in ('created', 'retry') and start_after <= now())::int as prets,
               count(*) filter (where state = 'active')::int as en_cours,
               round(max(extract(epoch from (now() - start_after))) filter (where state in ('created', 'retry') and start_after <= now()))::int as plus_vieux_pret_s,
               round((percentile_cont(0.95) within group (order by extract(epoch from (started_on - start_after)))
                 filter (where state = 'completed' and completed_on > ${QUART}))::numeric, 1) as attente_p95_s,
               round((percentile_cont(0.95) within group (order by extract(epoch from (completed_on - started_on)))
                 filter (where state = 'completed' and completed_on > ${QUART}))::numeric, 1) as traitement_p95_s,
               count(*) filter (where state = 'failed' and completed_on > ${QUART})::int as echecs_15min
          from ${s}.job
         where name = any($1) and created_on > now() - interval '2 hours' and (state <> 'completed' or completed_on > ${QUART})
         group by name
        having count(*) filter (where created_on > ${QUART} or state in ('created', 'retry', 'active')) > 0
         order by name`,
      jobs_lents: `
        select name as file, state as etat,
               round(extract(epoch from (coalesce(completed_on, now()) - started_on))::numeric, 1) as traitement_s,
               round(extract(epoch from (started_on - start_after))::numeric, 1) as attente_s,
               to_char(started_on at time zone 'Europe/Paris', 'HH24:MI:SS') as debut
          from ${s}.job
         where name = any($1) and created_on > now() - interval '2 hours' and started_on is not null
           and (completed_on > ${QUART} or state = 'active')
         order by coalesce(completed_on, now()) - started_on desc
         limit 15`,
      base: `
        select coalesce(nullif(application_name, ''), '?') as application, coalesce(state, '?') as etat,
               coalesce(wait_event_type, '-') as attente, count(*)::int as n,
               round(max(extract(epoch from (now() - query_start)))::numeric, 1) as plus_longue_s
          from pg_stat_activity
         where datname = current_database() and pid <> pg_backend_pid()
         group by 1, 2, 3 order by n desc limit 20`,
      verrous_en_attente: `select count(*)::int as n from pg_locks where not granted`,
      pool: `
        select process, to_char(minute at time zone 'Europe/Paris', 'HH24:MI') as minute, echantillons, attentes, max_ms
          from pool_attentes where minute > ${QUART} and attentes > 0 order by minute`,
      http_lent: `
        select process, methode, route, code, max_ms
          from http_latences where fenetre > ${QUART} and max_ms > 2000 order by max_ms desc limit 10`,
      taches: `
        select process, tache, passes, echecs, sautees, round(somme_ms::numeric / nullif(passes, 0)) as moy_ms
          from taches_mesures where fenetre > now() - interval '1 hour' order by somme_ms desc limit 10`,
    };
    const instantane: Instantane = { pris_le: new Date().toISOString() };
    // 🔴 UNE connexion, en transaction en lecture seule, chaque lecture plafonnée à 3 s, l'une après l'autre : l'alerte
    // part souvent quand la base sature, et la capture ne doit pas lui prendre plus d'une connexion ni la faire ramer
    // davantage (relecture du lot 1). `set local` ne vit que le temps de la transaction : rien ne reste sur la
    // connexion rendue au pool. Une lecture qui dépasse est notée « illisible », grâce à un point de sauvegarde qui
    // garde la transaction utilisable pour les suivantes.
    const client = await this.pool.connect();
    try {
      await client.query('begin read only');
      await client.query(`set local statement_timeout = ${DELAI_LECTURE_INSTANTANE_MS}`);
      for (const [cle, sql] of Object.entries(lectures)) {
        await client.query('savepoint lecture');
        try {
          instantane[cle] = (await client.query(sql, sql.includes('$1') ? [[...BASE_QUEUES]] : [])).rows;
          await client.query('release savepoint lecture');
        } catch (err) {
          await client.query('rollback to savepoint lecture');
          instantane[cle] = { illisible: err instanceof Error ? err.message.replace(/\u0000/g, '').slice(0, 200) : 'erreur' };
        }
      }
      await client.query('rollback');
    } finally {
      client.release();
    }
    return instantane;
  }
}
