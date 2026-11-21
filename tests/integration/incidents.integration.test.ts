import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgIncidentsStore } from '../../src/ops/incidents.pg';
import { PgBossQueue } from '../../src/queue/pgboss';

const url = process.env.DATABASE_URL ?? '';
const SCHEMA = process.env.PGBOSS_SCHEMA ?? 'pgboss';

/**
 * L'INSTANTANÉ D'UN INCIDENT (plan 2026-11-21, lot 1) : du SQL sur `pgboss.job`, `pg_stat_activity` et les tables de
 * mesures, qu'aucun test unitaire ne fait tourner. Chaque lecture doit rendre des lignes, jamais « illisible », et
 * l'incident s'ouvre puis se clôt par son signal.
 */
describe.skipIf(!url)('incidents de santé (Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 3 });
    // Le schéma de pg-boss doit exister pour que la lecture des files soit jugée.
    const queue = new PgBossQueue(url, SCHEMA);
    await queue.start();
    await queue.stop();
  });

  afterAll(async () => {
    await pool.query(`delete from incidents where signal like 'itest-%'`).catch(() => {});
    await pool.end().catch(() => {});
  });

  it('🔴 chaque lecture de l’instantané tourne sur un vrai Postgres, sans aucune lecture illisible', async () => {
    const inst = await new PgIncidentsStore(pool, SCHEMA).lireInstantane();
    for (const cle of ['files', 'jobs_lents', 'base', 'verrous_en_attente', 'pool', 'http_lent', 'taches']) {
      expect(Array.isArray(inst[cle]), `${cle} : ${JSON.stringify(inst[cle])}`).toBe(true);
    }
    // La lecture de la base voit au moins sa propre connexion voisine du pool.
    expect(inst.verrous_en_attente).toEqual([{ n: expect.any(Number) }]);
  });

  it('un incident s’ouvre avec son instantané, et le retour au vert clôt le dernier ouvert de son signal', async () => {
    const store = new PgIncidentsStore(pool, SCHEMA);
    const premier = await store.ouvrir({ source: 'sante', signal: 'itest-entrants', etat: 'orange', texte: 't1', instantane: { a: 1 } });
    const second = await store.ouvrir({ source: 'sante', signal: 'itest-entrants', etat: 'rouge', texte: 't2', instantane: null });
    await store.clore('itest-entrants', { fin: true });
    const lignes = (await pool.query<{ id: string; clos: boolean; instantane: unknown; instantane_fin: unknown }>(
      `select id, clos_le is not null as clos, instantane, instantane_fin from incidents where signal = 'itest-entrants' order by id`,
    )).rows;
    expect(lignes.map((l) => [Number(l.id), l.clos])).toEqual([[premier, false], [second, true]]);
    expect(lignes[0]!.instantane).toEqual({ a: 1 });
    expect(lignes[1]!.instantane_fin).toEqual({ fin: true });
    // Rien d'ouvert : clore ne fait rien, sans erreur.
    await store.clore('itest-rien', null);
  });

  it('🔴 le rapport s’inscrit une seule fois, et respecte les contraintes de la 0308', async () => {
    const store = new PgIncidentsStore(pool, SCHEMA);
    const id = await store.ouvrir({ source: 'charge', signal: 'itest-rapport', etat: 'alerte', texte: 't', instantane: null });
    const r = { categorie: 'plomberie' as const, issue: 2 as const, rapport: 'vingt jobs', action: 'vider en continu', fichier: 'incidents/x.md' };
    expect(await store.rapporter(id, r)).toEqual({ signal: 'itest-rapport' });
    expect(await store.rapporter(id, r)).toBeNull();
    expect(await store.rapporter(999_999_999, r)).toBeNull();
    const ligne = (await pool.query(`select categorie, issue, action, rapport_le is not null as rendu from incidents where id = $1`, [id])).rows[0];
    expect(ligne).toEqual({ categorie: 'plomberie', issue: 2, action: 'vider en continu', rendu: true });
    // La décision : une seule fois, et seulement sur une issue 2.
    expect(await store.decider(id, 'approuve')).toBe(true);
    expect(await store.decider(id, 'refuse')).toBe(false);
    const autre = await store.ouvrir({ source: 'charge', signal: 'itest-rapport', etat: 'alerte', texte: 't', instantane: null });
    await store.rapporter(autre, { categorie: 'faux_positif', issue: 1, rapport: 'r' });
    expect(await store.decider(autre, 'approuve')).toBe(false);
  });
});
