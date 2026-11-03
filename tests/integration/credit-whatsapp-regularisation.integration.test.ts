import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgCreditWhatsappStore } from '../../src/credit-whatsapp/credit.pg';
import { PgCreditWhatsappReglagesStore } from '../../src/credit-whatsapp/reglages.pg';
import { PgRegularisationStore } from '../../src/credit-whatsapp/regularisation.pg';
import type { CalculRegularisation } from '../../src/credit-whatsapp/regularisation';

/**
 * LA RÉGULARISATION SUR UNE VRAIE BASE (migration 0274, lot E du plan `2026-11-03-credit-whatsapp-fiabilite.md`).
 *
 * 🔴 CE QU'AUCUN TEST UNITAIRE NE VOIT : les jours de Paris calculés par la base, une régularisation REMPLACÉE et jamais
 * cumulée, l'invariant « solde = mouvements − provisions non rendues et non illimitées » après elle, deux passes
 * simultanées sur le même jour sans double débit (le verrou par espace et par jour), et la grille du jour.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur une base de production. La CI monte un
 * Postgres jetable pour ça (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';
const NUMERO = 'pn-regul-wa-test';

const calcul = (ecart: number, meta = Math.max(ecart, 0) + 100_000): CalculRegularisation => ({
  metaMicroEur: meta, nousMicroEur: meta - ecart, ecartMicroEur: ecart, messagesMeta: 3, messagesNous: 3, volumeMeta: 3, livresNous: 3, nonChiffres: 0,
  demiHeures: 4, detail: [],
});

describe.skipIf(!url)('la régularisation du Crédit WhatsApp (0274)', () => {
  let pool: Pool;
  let store: PgRegularisationStore;
  let credit: PgCreditWhatsappStore;
  const espaces: string[] = [];
  const grilles: string[] = [];

  async function espace(): Promise<string> {
    const id = (await pool.query<{ id: string }>(`insert into tenants (name) values ('regul-wa-test') returning id`)).rows[0]!.id;
    espaces.push(id);
    return id;
  }

  async function invariant(tenantId: string): Promise<void> {
    const { rows } = await pool.query<{ stocke: string | null; recalcule: string }>(
      `select (select solde_micro_eur from credits_whatsapp where tenant_id = $1) as stocke,
              (select coalesce(sum(delta_micro_eur), 0) from credit_whatsapp_mouvements where tenant_id = $1)
            - (select coalesce(sum(montant_micro_eur), 0) from credit_whatsapp_provisions
                where tenant_id = $1 and etat <> 'rendu' and not illimite) as recalcule`,
      [tenantId],
    );
    expect(Number(rows[0]!.stocke ?? 0)).toBe(Number(rows[0]!.recalcule));
  }

  /** Le jour de Paris d'aujourd'hui, tel que la base le voit (le mois à facturer le lit). */
  async function aujourdhuiParis(): Promise<string> {
    return (await pool.query<{ j: string }>(`select (now() at time zone 'Europe/Paris')::date::text as j`)).rows[0]!.j;
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(url) });
    store = new PgRegularisationStore(pool);
    credit = new PgCreditWhatsappStore(pool);
  });

  afterAll(async () => {
    if (espaces.length > 0) await pool.query('delete from tenants where id = any($1::uuid[])', [espaces]);
    if (grilles.length > 0) await pool.query('delete from grilles_meta where id = any($1::uuid[])', [grilles]);
    await pool.end();
  });

  it('les deux jours clos sont la veille et l’avant-veille de PARIS, bornés à minuit de Paris, et attendent leur marge', async () => {
    const jours = await store.joursClos(0);
    const veille = (await pool.query<{ j: string }>(`select ((now() at time zone 'Europe/Paris')::date - 1)::text as j`)).rows[0]!.j;
    expect(jours.map((j) => j.jour)[0]).toBe(veille);
    expect(jours).toHaveLength(2);
    // 23, 24 ou 25 heures selon un changement d'heure ; l'avant-veille finit où la veille commence.
    for (const j of jours) expect([82_800, 86_400, 90_000]).toContain(j.finS - j.debutS);
    expect(jours[1]!.finS).toBe(jours[0]!.debutS);
    // Une marge de trois jours : aucun des deux n'a fini depuis assez longtemps.
    expect(await store.joursClos(3 * 86_400)).toEqual([]);
  });

  it('🔴 les espaces couverts : une ligne en cours ou retirée depuis, pas une ligne retirée avant la période', async () => {
    const t = await espace();
    await pool.query(
      `insert into lignes_credit_whatsapp (tenant_id, phone_number_id, waba_id, origine, depuis, retiree_le) values
         ($1, 'pn-a', 'waba-a', 'ops', now() - interval '5 days', null),
         ($1, 'pn-b', 'waba-b', 'ops', now() - interval '5 days', now() - interval '1 hour'),
         ($1, 'pn-c', 'waba-c', 'ops', now() - interval '20 days', now() - interval '10 days')`,
      [t],
    );
    const depuisS = Math.floor(Date.now() / 1000) - 3 * 86_400;
    const e = (await store.espacesARegulariser(depuisS)).find((x) => x.tenantId === t);
    expect(e?.comptes.map((c) => [c.wabaId, c.couvertures[0]!.jusqua === null])).toEqual([['waba-a', true], ['waba-b', false]]);
  });

  it('🔴 nos provisions par demi-heure : à la livraison, à défaut à la création, sans les rendues', async () => {
    const t = await espace();
    await credit.crediter(t, 1_000_000, 'achat', 'cs_regul_demi');
    const base = Math.floor(Date.now() / 1000 / 1800) * 1800 - 6 * 1800;
    const livree = await credit.provisionner({ tenantId: t, phoneNumberId: NUMERO, pays: 'FR', categorie: 'utility', montantMicroEur: 26_040, openBar: false });
    const enDoute = await credit.provisionner({ tenantId: t, phoneNumberId: NUMERO, pays: 'FR', categorie: 'marketing', montantMicroEur: 74_760, openBar: false });
    const rendue = await credit.provisionner({ tenantId: t, phoneNumberId: NUMERO, pays: 'FR', categorie: 'marketing', montantMicroEur: 74_760, openBar: false });
    if (!livree.ok || !enDoute.ok || !rendue.ok) throw new Error('provision refusée');
    // Créée dans une demi-heure, livrée dans la suivante : elle compte dans la seconde.
    await pool.query(`update credit_whatsapp_provisions set cree_le = to_timestamp($2 + 1700), livre_le = to_timestamp($2 + 1810) where id = $1`, [livree.provisionId, base]);
    await pool.query(`update credit_whatsapp_provisions set cree_le = to_timestamp($2 + 60) where id = $1`, [enDoute.provisionId, base]);
    await credit.rendre(rendue.provisionId);
    const nous = await store.nosDemiHeures(t, base, base + 4 * 1800);
    expect(nous.sort((a, b) => a.debut - b.debut)).toEqual([
      { debut: base, montantMicroEur: 74_760, messages: 1, livres: 0 },
      { debut: base + 1800, montantMicroEur: 26_040, messages: 1, livres: 1 },
    ]);
  });

  it('🔴 un prépayé : la régularisation du jour se REMPLACE, le solde suit la dernière valeur, l’invariant tient', async () => {
    const t = await espace();
    await credit.crediter(t, 1_000_000, 'achat', 'cs_regul_prep');
    // Meta a facturé 30 000 µ€ de plus que nos provisions : on débite.
    expect(await store.enregistrer({ tenantId: t, jour: '2026-10-29', calcul: calcul(30_000), illimite: false })).toEqual({ alerteDejaPartie: false, soldeMicroEur: 970_000 });
    // La passe suivante voit une livraison tardive : 10 000 seulement. Remplacé, pas cumulé.
    expect((await store.enregistrer({ tenantId: t, jour: '2026-10-29', calcul: calcul(10_000), illimite: false })).soldeMicroEur).toBe(990_000);
    // Un jour où nous avons trop compté : rendu au client.
    expect((await store.enregistrer({ tenantId: t, jour: '2026-10-30', calcul: calcul(-26_040), illimite: false })).soldeMicroEur).toBe(1_016_040);
    const mouvements = (await pool.query(`select jour::text, delta_micro_eur::text as delta from credit_whatsapp_mouvements where tenant_id = $1 and raison = 'regularisation' order by jour`, [t])).rows;
    expect(mouvements).toEqual([{ jour: '2026-10-29', delta: '-10000' }, { jour: '2026-10-30', delta: '26040' }]);
    await invariant(t);
    // La passe suivante retrouve la même valeur : rien n'est réécrit, l'instant du mouvement ne remonte pas en tête.
    const avant = (await pool.query<{ le: Date }>(`select le from credit_whatsapp_mouvements where tenant_id = $1 and raison = 'regularisation' and jour = '2026-10-30'`, [t])).rows[0]!.le;
    await store.enregistrer({ tenantId: t, jour: '2026-10-30', calcul: calcul(-26_040), illimite: false });
    const apres = (await pool.query<{ le: Date }>(`select le from credit_whatsapp_mouvements where tenant_id = $1 and raison = 'regularisation' and jour = '2026-10-30'`, [t])).rows[0]!.le;
    expect(apres.toISOString()).toBe(avant.toISOString());
  });

  it('🔴 une Entreprise : aucun mouvement, le solde ne bouge pas, l’écart va au mois à facturer', async () => {
    const t = await espace();
    await credit.crediter(t, 500_000, 'achat', 'cs_regul_ent');
    const jour = await aujourdhuiParis();
    // Un mouvement d'avant, du temps où l'espace prépayait, puis le même jour recalculé en Entreprise : ramené à zéro.
    await store.enregistrer({ tenantId: t, jour, calcul: calcul(40_000), illimite: false });
    expect((await store.enregistrer({ tenantId: t, jour, calcul: calcul(40_000), illimite: true })).soldeMicroEur).toBe(500_000);
    expect(await credit.consommationDuMois(t)).toBe(40_000);
    await invariant(t);
  });

  it('🔴 deux passes simultanées sur le même jour : un seul débit (le verrou de l’espace et du jour)', async () => {
    const t = await espace();
    await credit.crediter(t, 1_000_000, 'achat', 'cs_regul_conc');
    await Promise.all([
      store.enregistrer({ tenantId: t, jour: '2026-10-28', calcul: calcul(20_000), illimite: false }),
      store.enregistrer({ tenantId: t, jour: '2026-10-28', calcul: calcul(20_000), illimite: false }),
    ]);
    expect(await credit.solde(t)).toBe(980_000);
    await invariant(t);
  });

  it('l’alerte d’un jour, une fois marquée, ne repart pas', async () => {
    const t = await espace();
    await store.enregistrer({ tenantId: t, jour: '2026-10-27', calcul: calcul(900_000), illimite: true });
    await store.marquerAlerte(t, '2026-10-27');
    expect((await store.enregistrer({ tenantId: t, jour: '2026-10-27', calcul: calcul(950_000), illimite: true })).alerteDejaPartie).toBe(true);
  });

  it('🔴 la grille d’un jour est celle qui était en vigueur ce jour-là, pas la dernière chargée', async () => {
    const reglages = new PgCreditWhatsappReglagesStore(pool);
    const tarif = (prix: number) => [{ marche: 'FR', categorie: 'marketing' as const, palier: 0, prixMicroEur: prix }];
    grilles.push(await reglages.chargerGrille({ enVigueurLe: '2000-01-01', tarifs: tarif(60_000), auteur: 'ops@exemple.fr', note: 'T1 2000' }));
    grilles.push(await reglages.chargerGrille({ enVigueurLe: '2000-04-01', tarifs: tarif(70_000), auteur: 'ops@exemple.fr', note: 'T2 2000' }));
    expect((await reglages.grilleAu('2000-03-31'))?.tarifs[0]?.prixMicroEur).toBe(60_000);
    expect((await reglages.grilleAu('2000-04-01'))?.tarifs[0]?.prixMicroEur).toBe(70_000);
    expect(await reglages.grilleAu('1999-12-31')).toBeNull();
  });
});
