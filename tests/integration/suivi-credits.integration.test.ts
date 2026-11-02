import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgCreditStore } from '../../src/agent/credits.pg';
import { PgCreditWhatsappStore } from '../../src/credit-whatsapp/credit.pg';
import { PgCleGatewayStore } from '../../src/agent/cles-gateway.pg';
import { PgCreditsOpsStore } from '../../src/ops/credits.pg';

const url = process.env.DATABASE_URL ?? '';
const MICRO = 1_000_000;

/**
 * LE SUIVI DES CRÉDITS (Entreprise illimitée, lot C) : les courbes de 90 jours des deux onglets et la vue « Crédits » de
 * `/ops`, sur le vrai SQL.
 *
 * 🔴 POURQUOI EN INTÉGRATION. Tout ce qui compte est en SQL : le jour de PARIS de chaque mouvement, `generate_series` qui
 * ne laisse aucun trou, le solde courant lu dans le même instantané que les mouvements (sans quoi la reconstruction à
 * rebours dériverait), les débits illimités exclus du solde mais comptés dans la consommation, le mois de Paris et le
 * précédent, la somme des plafonds des Entreprises qui ont une clé.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ancienne base de production. La CI monte
 * un Postgres jetable pour ça (job `integration`), un fichier à la fois.
 */
describe.skipIf(!url)('le suivi des crédits (lot C)', () => {
  let pool: Pool;
  let credits: PgCreditStore;
  let wa: PgCreditWhatsappStore;
  const espaces: string[] = [];
  let jours: string[] = [];

  async function espace(nom: string): Promise<string> {
    const id = (await pool.query<{ id: string }>('insert into tenants (name) values ($1) returning id', [nom])).rows[0]!.id;
    espaces.push(id);
    return id;
  }
  /** Déplace les mouvements IA d'un montant à midi, heure de Paris, `n` jours avant aujourd'hui. */
  const reculerIa = (t: string, delta: number, n: number) => pool.query(
    `update agent_credit_mouvements
        set at = (((now() at time zone 'Europe/Paris')::date - $3::int) + time '12:00') at time zone 'Europe/Paris'
      where tenant_id = $1 and delta_micro_eur = $2`,
    [t, delta, n],
  );

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    credits = new PgCreditStore(pool, null);
    wa = new PgCreditWhatsappStore(pool);
    // Les trois derniers jours de Paris, du plus ancien au plus récent.
    jours = (await pool.query<{ j: string }>(
      `select to_char((now() at time zone 'Europe/Paris')::date - n, 'YYYY-MM-DD') as j from generate_series(2, 0, -1) n`,
    )).rows.map((r) => r.j);
  });
  afterAll(async () => {
    if (espaces.length > 0) await pool.query('delete from tenants where id = any($1::uuid[])', [espaces]);
    await pool.end();
  });

  it('🔴 Crédit IA d’un prépayé : le solde de fin de jour, reconstruit à rebours depuis le solde courant', async () => {
    const t = await espace('itest-serie-ia');
    await credits.crediter(t, 10 * MICRO, 'itest achat');
    await credits.debiter(t, 2 * MICRO);
    await reculerIa(t, 10 * MICRO, 2);
    const serie = await credits.serie(t, 3);
    expect(serie.map((p) => p.jour)).toEqual(jours);
    // L'avant-veille, l'achat ; la veille, rien (le solde de l'avant-veille) ; aujourd'hui, 2 € consommés.
    expect(serie.map((p) => p.soldeMicroEur)).toEqual([10 * MICRO, 10 * MICRO, 8 * MICRO]);
    expect(serie.map((p) => p.consommationMicroEur)).toEqual([0, 0, 2 * MICRO]);
  });

  it('🔴 Crédit IA d’une Entreprise : le solde ne bouge pas, la consommation du jour compte ses débits illimités', async () => {
    const t = await espace('itest-serie-ia-entreprise');
    await credits.crediter(t, 5 * MICRO, 'itest');
    await pool.query('update tenants set offre_entreprise = true where id = $1', [t]);
    await credits.debiter(t, 1 * MICRO);
    await credits.debiterTraduction(t, MICRO / 2);
    const serie = await credits.serie(t, 2);
    expect(serie.map((p) => p.soldeMicroEur)).toEqual([0, 5 * MICRO]);
    expect(serie.map((p) => p.consommationMicroEur)).toEqual([0, 1.5 * MICRO]);
  });

  it('🔴 Crédit WhatsApp : mouvements moins provisions prépayées, une provision rendue ne compte pas, l’illimitée se consomme sans toucher au solde', async () => {
    const t = await espace('itest-serie-wa');
    await wa.crediter(t, MICRO, 'achat', 'cs_itest_serie');
    const prise = (montant: number, openBar = false) => wa.provisionner({ tenantId: t, phoneNumberId: 'pn-itest-serie', pays: 'FR', categorie: 'marketing', montantMicroEur: montant, openBar });
    await prise(74_760);
    const rendue = await prise(26_040);
    if (!rendue.ok) throw new Error('provision refusée');
    await wa.rendre(rendue.provisionId);
    await prise(50_000, true);
    const serie = await wa.serie(t, 2);
    expect(serie.map((p) => p.soldeMicroEur)).toEqual([0, MICRO - 74_760]);
    expect(serie.map((p) => p.consommationMicroEur)).toEqual([0, 74_760 + 50_000]);
    // La fin d'aujourd'hui EST le solde stocké.
    expect(await wa.solde(t)).toBe(MICRO - 74_760);
  });

  it('🔴 la vue « Crédits » : les deux mois, le montant à facturer d’une Entreprise, et la somme des plafonds des Entreprises à clé', async () => {
    const vue = new PgCreditsOpsStore(pool, 100 * MICRO, 0.92);
    const e = await espace('itest-ops-credits-entreprise');
    const p = await espace('itest-ops-credits-prepaye');
    await pool.query('update tenants set offre_entreprise = true, entreprise_plafond_ia_micro_eur = $2 where id = $1', [e, 150 * MICRO]);
    await credits.debiter(e, 1 * MICRO);
    await credits.debiter(e, 2 * MICRO);
    // Le débit de 2 € passe au mois précédent : la veille du premier jour du mois de Paris.
    await pool.query(
      `update agent_credit_mouvements
          set at = (date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris') - interval '1 day'
        where tenant_id = $1 and delta_micro_eur = $2`,
      [e, -2 * MICRO],
    );
    await wa.provisionner({ tenantId: e, phoneNumberId: 'pn-itest-ops', pays: 'FR', categorie: 'marketing', montantMicroEur: 50_000, openBar: true });
    await pool.query(`insert into lignes_credit_whatsapp (tenant_id, phone_number_id, origine) values ($1, 'pn-itest-ops', 'ops')`, [e]);
    await credits.crediter(p, 3 * MICRO, 'itest');
    await credits.debiter(p, 1 * MICRO);

    const avant = await vue.vue();
    const le = avant.espaces.find((x) => x.tenantId === e)!;
    expect(le).toMatchObject({
      offre: 'entreprise',
      ia: { illimite: true, consommation: { moisMicroEur: 1 * MICRO, moisPrecedentMicroEur: 2 * MICRO }, plafondMicroEur: 150 * MICRO, plafondAtteint: false, cle: false },
      whatsapp: { surLaLigne: true, soldeMicroEur: 0, consommation: { moisMicroEur: 50_000, moisPrecedentMicroEur: 0 } },
      aFacturer: { moisMicroEur: 1 * MICRO + 50_000, moisPrecedentMicroEur: 2 * MICRO },
    });
    const lp = avant.espaces.find((x) => x.tenantId === p)!;
    expect(lp).toMatchObject({
      ia: { illimite: false, soldeMicroEur: 2 * MICRO, consommation: { moisMicroEur: 1 * MICRO, moisPrecedentMicroEur: 0 }, plafondMicroEur: null },
      whatsapp: { surLaLigne: false },
      aFacturer: null,
    });
    // Les Entreprises viennent d'abord.
    expect(avant.espaces.findIndex((x) => x.tenantId === e)).toBeLessThan(avant.espaces.findIndex((x) => x.tenantId === p));

    // Sa clé ouverte, son plafond entre dans la somme à comparer au budget d'équipe.
    await new PgCleGatewayStore(pool, (s) => s, (s) => s).enregistrer(e, { cleId: 'key_itest_ops', cle: 'vck_itest_ops', plafondMicroEur: 150 * MICRO });
    const apres = await vue.vue();
    expect(apres.espaces.find((x) => x.tenantId === e)!.ia.cle).toBe(true);
    expect(apres.plafondsEntreprisesAvecCleMicroEur - avant.plafondsEntreprisesAvecCleMicroEur).toBe(150 * MICRO);
    // En dollars au taux du jour, pour la comparer au budget d'équipe : 150 € à 0,92 font 163,04 $.
    expect(apres.plafondsEntreprisesAvecCleDollars - avant.plafondsEntreprisesAvecCleDollars).toBeCloseTo(163.04, 1);
    expect(apres.plafondIaParDefautMicroEur).toBe(100 * MICRO);
  });
});
