import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgStatsStore } from '../../src/stats/store.pg';
import { NOTE_ESSAI, NOTE_TRANSCRIPTION, noteVectorisation } from '../../src/agent/natures-credit';

const url = process.env.DATABASE_URL ?? '';

/**
 * « Coût de l'IA » lu au JOURNAL du crédit (plan `docs/superpowers/plans/2026-11-10-cout-ia-et-mba.md`, lot A). Joué
 * par le job `integration` de la CI, jamais en local (le DATABASE_URL du poste pointe l'ancienne production).
 *
 * Ce qu'il verrouille : chaque nature de débit dans sa part, un tour d'agent dont la session a été purgée encore
 * compté en « agent », les débits d'une Entreprise illimitée comptés, les recharges, achats et crédits offerts
 * écartés, la période de l'écran respectée (jours de Paris), un autre espace jamais lu ; et les messages du MBA de
 * la période comptés sur les seuls messages écrits par l'agent de Meta.
 */
describe.skipIf(!url)('PgStatsStore : le coût de l’IA au journal du crédit (Postgres)', () => {
  let pool: Pool;
  let store: PgStatsStore;
  let tenant: string;
  let autre: string;
  const PLAGE = { from: '2026-03-10', to: '2026-03-12' };

  const espace = async (nom: string): Promise<string> =>
    (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
  const mouvement = async (t: string, delta: number, raison: string, note: string | null, at: string, extra: { jour?: string; illimite?: boolean } = {}) => {
    await pool.query(
      `insert into agent_credit_mouvements (tenant_id, delta_micro_eur, raison, note, at, jour, illimite)
       values ($1, $2, $3, $4, $5::timestamptz, $6::date, $7)`,
      [t, delta, raison, note, at, extra.jour ?? null, extra.illimite ?? false],
    );
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    store = new PgStatsStore(pool);
    tenant = await espace('itest-cout-ia-journal');
    autre = await espace('itest-cout-ia-journal-autre');
  });

  afterAll(async () => {
    for (const id of [tenant, autre]) if (id) await pool.query('delete from tenants where id = $1', [id]);
    await pool.end();
  });

  it('🔴 range chaque débit de la période dans sa nature, et le total égale la somme des parts', async () => {
    // Dans la période (jours de Paris du 10 au 12 mars).
    await mouvement(tenant, -100_000, 'conso', null, '2026-03-10T09:00:00Z'); // tour d'agent, session purgée
    await mouvement(tenant, -50_000, 'conso', null, '2026-03-11T09:00:00Z', { illimite: true }); // Entreprise
    await mouvement(tenant, -20_000, 'conso', NOTE_ESSAI.formulaire, '2026-03-11T10:00:00Z');
    await mouvement(tenant, -7_000, 'conso', NOTE_ESSAI.mcp, '2026-03-11T10:05:00Z');
    await mouvement(tenant, -3_000, 'conso', noteVectorisation(4), '2026-03-11T11:00:00Z');
    await mouvement(tenant, -9_000, 'conso', NOTE_TRANSCRIPTION, '2026-03-12T12:00:00Z');
    await mouvement(tenant, -11_000, 'traduction', null, '2026-03-12T13:00:00Z', { jour: '2026-03-12' });
    await mouvement(tenant, -1_000, 'conso', 'une porte inconnue', '2026-03-12T14:00:00Z');
    // Écartés : recharges, achats, crédit offert ; hors période ; autre espace.
    await mouvement(tenant, 5_000_000, 'achat', null, '2026-03-11T08:00:00Z');
    await mouvement(tenant, 1_000_000, 'recharge', 'recharge manuelle', '2026-03-11T08:00:00Z');
    await mouvement(tenant, 5_000_000, 'offert', null, '2026-03-11T08:00:00Z');
    await mouvement(tenant, -999_000, 'conso', null, '2026-03-09T22:30:00Z'); // 23 h 30 à Paris le 9 : hors période
    await mouvement(tenant, -888_000, 'conso', null, '2026-03-12T23:30:00Z'); // 0 h 30 à Paris le 13 : hors période
    await mouvement(autre, -777_000, 'conso', null, '2026-03-11T09:00:00Z');

    const c = await store.consommationIa(tenant, PLAGE, 50);
    expect(c.parNature).toEqual({
      agent: 150_000, essai: 27_000, connaissance: 3_000, transcription: 9_000, traduction: 11_000, autre: 1_000,
    });
    expect(c.coutMicroEur).toBe(201_000);
  });

  it('compte les messages ÉCRITS par le MBA sur la période, et seulement eux', async () => {
    const fil = (await pool.query<{ id: string }>(
      `insert into conversations (tenant_id, wa_id) values ($1, '33650000901') returning id`, [tenant],
    )).rows[0]!.id;
    await pool.query(
      `insert into conversation_messages (conversation_id, direction, type, origin, body, created_at)
       values ($1, 'out', 'text', 'mba', 'dans la période', '2026-03-11T09:00:00Z'),
              ($1, 'out', 'text', 'mba', 'dans la période aussi', '2026-03-12T09:00:00Z'),
              ($1, 'out', 'text', 'mba', 'hors période', '2026-03-20T09:00:00Z'),
              ($1, 'in', 'text', null, 'le client', '2026-03-11T09:01:00Z'),
              ($1, 'out', 'text', 'humain', 'l équipe', '2026-03-11T09:02:00Z')`,
      [fil],
    );
    expect(await store.messagesMbaSurPeriode(tenant, PLAGE)).toBe(2);
    expect(await store.messagesMbaSurPeriode(autre, PLAGE)).toBe(0);
  });
});
