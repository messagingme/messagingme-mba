import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgDepenseStore } from '../../src/assistant/budget';

/**
 * L'ENVELOPPE DE NOS APPELS DE MODÈLE PAR ESPACE (`assistant_depense_mois`), CONTRE UNE VRAIE BASE.
 *
 * 🔴 CE QU'AUCUN TEST UNITAIRE NE VOIT : que des réservations SIMULTANÉES, venues de deux copies de l'API, ne passent
 * pas toutes quand il ne reste de place que pour une. C'est le `where` de l'upsert, relu par Postgres sous le verrou de
 * la ligne, qui tranche ; le double en mémoire le simule, il ne le prouve pas (passage 2 de l'audit : vingt tours
 * partaient là où un seul aurait dû).
 *
 * DEUX POOLS, et pas un : c'est la seule façon d'imiter deux copies.
 *
 * ⚠️ Jamais joué en local (le `DATABASE_URL` local pointe l'ancienne production), joué par le job `integration`.
 */
const url = process.env.DATABASE_URL ?? '';
const MOIS = '2026-11-01';
const PLAFOND = 2_000_000;

describe.skipIf(!url)('l’enveloppe des assistants, en base', () => {
  let poolA: Pool;
  let poolB: Pool;
  let copieA: PgDepenseStore;
  let copieB: PgDepenseStore;
  const espaces: string[] = [];

  beforeAll(() => {
    poolA = new Pool({ connectionString: url, ssl: pgSsl(), max: 10 });
    poolB = new Pool({ connectionString: url, ssl: pgSsl(), max: 10 });
    copieA = new PgDepenseStore(poolA);
    copieB = new PgDepenseStore(poolB);
  });

  afterAll(async () => {
    if (espaces.length > 0) await poolA.query(`delete from tenants where id = any($1::uuid[])`, [espaces]).catch(() => {});
    await poolA.end().catch(() => {});
    await poolB.end().catch(() => {});
  });

  const espace = async (nom: string): Promise<string> => {
    const id = (await poolA.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    espaces.push(id);
    return id;
  };

  it('🔴 vingt réservations simultanées à un micro-euro du plafond : une seule passe, et le compte est exact', async () => {
    const t = await espace('itest-depense-concurrence');
    await copieA.ajouter(t, MOIS, PLAFOND - 1);
    const issues = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      (i % 2 === 0 ? copieA : copieB).reserver(t, MOIS, 50_000, PLAFOND)));
    expect(issues.filter(Boolean)).toHaveLength(1);
    expect(await copieB.lire(t, MOIS)).toBe(PLAFOND - 1 + 50_000);
  });

  it('sans ligne du mois, la première réservation crée la ligne ; au plafond, plus rien ne passe ni ne s’écrit', async () => {
    const t = await espace('itest-depense-premiere');
    expect(await copieA.reserver(t, MOIS, 50_000, PLAFOND)).toBe(true);
    expect(await copieA.lire(t, MOIS)).toBe(50_000);
    await copieA.ajouter(t, MOIS, PLAFOND);
    expect(await copieA.reserver(t, MOIS, 50_000, PLAFOND)).toBe(false);
    expect(await copieA.lire(t, MOIS)).toBe(PLAFOND + 50_000);
  });

  it('🔴 le solde d’une réservation trop haute redescend au coût réel, jamais sous zéro, même sans ligne', async () => {
    const t = await espace('itest-depense-solde');
    expect(await copieA.reserver(t, MOIS, 50_000, PLAFOND)).toBe(true);
    await copieA.ajouter(t, MOIS, 9_200 - 50_000);
    expect(await copieA.lire(t, MOIS)).toBe(9_200);
    await copieA.ajouter(t, MOIS, -1_000_000);
    expect(await copieA.lire(t, MOIS)).toBe(0);
    const vierge = await espace('itest-depense-vierge');
    await copieA.ajouter(vierge, MOIS, -50_000);
    expect(await copieA.lire(vierge, MOIS)).toBe(0);
  });
});
