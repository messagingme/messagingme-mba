import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgAccesCreditIaStore } from '../../src/agent/acces-credit';
import { PgCreditStore } from '../../src/agent/credits.pg';

const url = process.env.DATABASE_URL ?? '';
const MICRO = 1_000_000;

/**
 * L'ACCÈS AU CRÉDIT IA (migration 0268 ; Entreprise illimitée, lot B, décision de Julien du 2026-11-02).
 *
 * 🔴 POURQUOI EN INTÉGRATION. La règle vit en SQL (`acces_credit_ia`, `consommation_ia_du_mois`) : la vectorisation la
 * lit dans sa requête, le store ici. Ce qui compte n'existe qu'en base : le mois de PARIS qui borne la consommation, les
 * débits illimités seuls comptés (un espace passé en Entreprise en cours de mois ne paie pas deux fois ses débits
 * prépayés), le plafond de l'espace qui prime sur le défaut, et la clé primaire qui ne laisse partir qu'une alerte par
 * seuil et par mois.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ancienne base de production. La CI monte
 * un Postgres jetable pour ça (job `integration`).
 */
describe.skipIf(!url)('l’accès au Crédit IA (Postgres, 0268)', () => {
  let pool: Pool;
  let credits: PgCreditStore;
  let t = '';
  // Un store neuf à chaque lecture : celui d'une Entreprise garde son accès dix secondes.
  const acces = () => new PgAccesCreditIaStore(pool, 100 * MICRO);
  const entreprise = (plafondMicroEur: number | null = null) => pool.query(
    'update tenants set offre_entreprise = true, entreprise_plafond_ia_micro_eur = $2 where id = $1', [t, plafondMicroEur],
  );

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 8 });
    credits = new PgCreditStore(pool, null);
  });
  afterAll(async () => { if (t) await pool.query('delete from tenants where id = $1', [t]); await pool.end(); });
  beforeEach(async () => {
    if (t) await pool.query('delete from tenants where id = $1', [t]);
    t = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-acces-credit-ia') returning id`)).rows[0]!.id;
  });

  it('un prépayé : `ok` sur un solde positif, `epuise` à zéro comme sans ligne', async () => {
    expect(await acces().acces(t)).toBe('epuise');
    await credits.crediter(t, 1 * MICRO, 'itest');
    expect(await acces().acces(t)).toBe('ok');
    await credits.debiter(t, 1 * MICRO);
    expect(await acces().acces(t)).toBe('epuise');
    expect(await acces().etat(t)).toEqual({ acces: 'epuise', illimite: false, soldeMicroEur: 0, consommationDuMoisMicroEur: 0, plafondMicroEur: null });
  });

  it('🔴 une Entreprise à solde NUL consomme jusqu’à son plafond du mois, et s’arrête à lui', async () => {
    await entreprise();
    expect(await acces().acces(t)).toBe('ok');
    await credits.debiter(t, 60 * MICRO);
    expect(await credits.solde(t)).toBe(0);
    expect(await acces().acces(t)).toBe('ok');
    await credits.debiterTraduction(t, 40 * MICRO);
    expect(await acces().etat(t)).toEqual({
      acces: 'plafond', illimite: true, soldeMicroEur: 0, consommationDuMoisMicroEur: 100 * MICRO, plafondMicroEur: 100 * MICRO,
    });
    expect(await acces().margeDeCle(t)).toBe(100 * MICRO);
  });

  it('le plafond de l’espace prime sur le défaut ; remis à nul, le défaut revient', async () => {
    await entreprise(150 * MICRO);
    await credits.debiter(t, 120 * MICRO);
    expect(await acces().acces(t)).toBe('ok');
    expect(await acces().margeDeCle(t)).toBe(150 * MICRO);
    await entreprise(null);
    expect(await acces().acces(t)).toBe('plafond');
  });

  it('🔴 le mois de PARIS borne la consommation : un débit d’avant le 1er ne compte plus', async () => {
    await entreprise();
    await credits.debiter(t, 150 * MICRO);
    await pool.query(
      `update agent_credit_mouvements
          set at = (date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris') - interval '1 second'
        where tenant_id = $1`,
      [t],
    );
    expect(await acces().acces(t)).toBe('ok');
    expect((await acces().etat(t)).consommationDuMoisMicroEur).toBe(0);
  });

  it('🔴 les débits PRÉPAYÉS d’un espace passé en Entreprise ne comptent pas dans sa consommation', async () => {
    await credits.crediter(t, 50 * MICRO, 'itest');
    await credits.debiter(t, 30 * MICRO);
    await entreprise();
    await credits.debiter(t, 5 * MICRO);
    expect(await acces().etat(t)).toEqual({
      acces: 'ok', illimite: true, soldeMicroEur: 20 * MICRO, consommationDuMoisMicroEur: 5 * MICRO, plafondMicroEur: 100 * MICRO,
    });
  });

  it('un prépayé n’a ni marge de clé ni plafond', async () => {
    await credits.crediter(t, 5 * MICRO, 'itest');
    expect(await acces().margeDeCle(t)).toBe(0);
    expect(await acces().illimite(t)).toBe(false);
  });

  it('🔴 une alerte par espace, par mois et par seuil, même lancées ensemble', async () => {
    const lances = await Promise.all([acces().marquerAlerte(t, 80), acces().marquerAlerte(t, 80), acces().marquerAlerte(t, 80)]);
    expect(lances.filter(Boolean)).toHaveLength(1);
    expect(await acces().marquerAlerte(t, 100)).toBe(true);
    expect(await acces().marquerAlerte(t, 100)).toBe(false);
    // Une alerte que Telegram n'a pas prise se démarque : la suivante repasse.
    await acces().oublierAlerte(t, 100);
    expect(await acces().marquerAlerte(t, 100)).toBe(true);
    expect(await acces().marquerAlerte(t, 80)).toBe(false);
  });

  it('la liste des Entreprises porte la consommation et le plafond de chacune, jamais un prépayé', async () => {
    await entreprise(250 * MICRO);
    await credits.debiter(t, 3 * MICRO);
    expect((await acces().entreprises()).find((e) => e.tenantId === t)).toEqual({
      tenantId: t, nom: 'itest-acces-credit-ia', consommationDuMoisMicroEur: 3 * MICRO, plafondMicroEur: 250 * MICRO, cle: false,
    });
    await pool.query('update tenants set offre_entreprise = false where id = $1', [t]);
    expect((await acces().entreprises()).some((e) => e.tenantId === t)).toBe(false);
  });

  it('un plafond nul ou négatif est refusé par la base', async () => {
    await expect(entreprise(0)).rejects.toThrow(/tenants_entreprise_plafond_ia_chk/);
  });
});
