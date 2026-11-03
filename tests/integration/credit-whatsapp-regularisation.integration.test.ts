import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgCreditWhatsappStore } from '../../src/credit-whatsapp/credit.pg';
import { PgCreditWhatsappReglagesStore } from '../../src/credit-whatsapp/reglages.pg';
import { PgRegularisationStore } from '../../src/credit-whatsapp/regularisation.pg';
import type { CalculRegularisation, EcritureRegularisation } from '../../src/credit-whatsapp/regularisation';

/**
 * LA RÉGULARISATION SUR UNE VRAIE BASE (migrations 0274 et 0275, lot E du plan `2026-11-03-credit-whatsapp-fiabilite.md`).
 *
 * 🔴 CE QU'AUCUN TEST UNITAIRE NE VOIT : les jours de Paris calculés par la base, une régularisation REMPLACÉE et jamais
 * cumulée, l'invariant « solde = mouvements − provisions non rendues et non illimitées » après elle, deux passes
 * simultanées sur le même jour sans double débit (le verrou par espace et par jour), la grille du jour, une provision
 * figée dans sa demi-heure, une écriture refusée quand nos provisions ont bougé, et les conditions lues sur le jour.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur une base de production. La CI monte un
 * Postgres jetable pour ça (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';
const NUMERO = 'pn-regul-wa-test';

/** Un calcul d'écart `ecart` (Meta moins nous), nos provisions valant `nous` : l'écriture relit cette somme en base. */
const calcul = (ecart: number, nous = 0): CalculRegularisation => ({
  metaMicroEur: ecart + nous, nousMicroEur: nous, ecartMicroEur: ecart, messagesMeta: 3, messagesNous: 3, volumeMeta: 3, livresNous: 3, nonChiffres: 0,
  demiHeures: 4, detail: [],
});
/** Une demi-heure où ces espaces neufs n'ont aucune provision. */
const VIDE = 946_684_800;
const sans = { tranches: [VIDE], lectureDepuisS: VIDE };
const ecrite = (e: EcritureRegularisation) => {
  if (!e.ecrit) throw new Error('régularisation non écrite');
  return e;
};
/** Une demi-heure entière d'il y a trois jours. */
const ilYATroisJours = (): number => Math.floor(Date.now() / 1000 / 1800) * 1800 - 3 * 86_400;

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

  /** Une provision créée dans la demi-heure `tranche`, comme si la garde l'avait prise alors. */
  async function provisionDans(t: string, tranche: number, montant: number, o: { openBar?: boolean; commissionPct?: number } = {}): Promise<string> {
    const p = await credit.provisionner({
      tenantId: t, phoneNumberId: NUMERO, pays: 'FR', categorie: 'marketing', montantMicroEur: montant, openBar: o.openBar ?? false, commissionPct: o.commissionPct ?? 5,
    });
    if (!p.ok) throw new Error('provision refusée');
    await pool.query('update credit_whatsapp_provisions set cree_le = to_timestamp($2 + 60) where id = $1', [p.provisionId, tranche]);
    return p.provisionId;
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
    const livree = await credit.provisionner({ tenantId: t, phoneNumberId: NUMERO, pays: 'FR', categorie: 'utility', montantMicroEur: 26_040, openBar: false, commissionPct: 5 });
    const enDoute = await credit.provisionner({ tenantId: t, phoneNumberId: NUMERO, pays: 'FR', categorie: 'marketing', montantMicroEur: 74_760, openBar: false, commissionPct: 5 });
    const rendue = await credit.provisionner({ tenantId: t, phoneNumberId: NUMERO, pays: 'FR', categorie: 'marketing', montantMicroEur: 74_760, openBar: false, commissionPct: 5 });
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
    // Meta a facturé 30 000 µ€ de plus que nos provisions : on débite, et l'écriture rend le solde d'avant (l'e-mail du
    // crédit bas s'y compare).
    expect(await store.enregistrer({ tenantId: t, jour: '2026-10-29', calcul: calcul(30_000), illimite: false, ...sans }))
      .toEqual({ ecrit: true, alerteDejaPartie: false, soldeAvantMicroEur: 1_000_000, soldeMicroEur: 970_000 });
    // La passe suivante voit une livraison tardive : 10 000 seulement. Remplacé, pas cumulé.
    expect(ecrite(await store.enregistrer({ tenantId: t, jour: '2026-10-29', calcul: calcul(10_000), illimite: false, ...sans })))
      .toMatchObject({ soldeAvantMicroEur: 970_000, soldeMicroEur: 990_000 });
    // Un jour où nous avons trop compté (une provision que Meta n'a pas facturée) : rendue au client.
    const T = ilYATroisJours();
    await provisionDans(t, T, 26_040);
    const rendu = { tenantId: t, jour: '2026-10-30', calcul: calcul(-26_040, 26_040), illimite: false, tranches: [T], lectureDepuisS: T };
    expect(ecrite(await store.enregistrer(rendu)).soldeMicroEur).toBe(990_000);
    const mouvements = (await pool.query(`select jour::text, delta_micro_eur::text as delta from credit_whatsapp_mouvements where tenant_id = $1 and raison = 'regularisation' order by jour`, [t])).rows;
    expect(mouvements).toEqual([{ jour: '2026-10-29', delta: '-10000' }, { jour: '2026-10-30', delta: '26040' }]);
    await invariant(t);
    // La passe suivante retrouve la même valeur : rien n'est réécrit, l'instant du mouvement ne remonte pas en tête.
    const avant = (await pool.query<{ le: Date }>(`select le from credit_whatsapp_mouvements where tenant_id = $1 and raison = 'regularisation' and jour = '2026-10-30'`, [t])).rows[0]!.le;
    ecrite(await store.enregistrer(rendu));
    const apres = (await pool.query<{ le: Date }>(`select le from credit_whatsapp_mouvements where tenant_id = $1 and raison = 'regularisation' and jour = '2026-10-30'`, [t])).rows[0]!.le;
    expect(apres.toISOString()).toBe(avant.toISOString());
  });

  it('🔴 une Entreprise : aucun mouvement, le solde ne bouge pas, l’écart va au mois à facturer', async () => {
    const t = await espace();
    await credit.crediter(t, 500_000, 'achat', 'cs_regul_ent');
    const jour = await aujourdhuiParis();
    // Un mouvement d'avant, du temps où l'espace prépayait, puis le même jour recalculé en Entreprise : ramené à zéro.
    ecrite(await store.enregistrer({ tenantId: t, jour, calcul: calcul(40_000), illimite: false, ...sans }));
    expect(ecrite(await store.enregistrer({ tenantId: t, jour, calcul: calcul(40_000), illimite: true, ...sans })).soldeMicroEur).toBe(500_000);
    expect(await credit.consommationDuMois(t)).toBe(40_000);
    await invariant(t);
  });

  it('🔴 deux passes simultanées sur le même jour : un seul débit (le verrou de l’espace et du jour)', async () => {
    const t = await espace();
    await credit.crediter(t, 1_000_000, 'achat', 'cs_regul_conc');
    await Promise.all([
      store.enregistrer({ tenantId: t, jour: '2026-10-28', calcul: calcul(20_000), illimite: false, ...sans }),
      store.enregistrer({ tenantId: t, jour: '2026-10-28', calcul: calcul(20_000), illimite: false, ...sans }),
    ]);
    expect(await credit.solde(t)).toBe(980_000);
    await invariant(t);
  });

  it('l’alerte d’un jour, une fois marquée, ne repart pas', async () => {
    const t = await espace();
    ecrite(await store.enregistrer({ tenantId: t, jour: '2026-10-27', calcul: calcul(900_000), illimite: true, ...sans }));
    await store.marquerAlerte(t, '2026-10-27');
    expect(ecrite(await store.enregistrer({ tenantId: t, jour: '2026-10-27', calcul: calcul(950_000), illimite: true, ...sans })).alerteDejaPartie).toBe(true);
  });

  it('🔴 le gel : une provision comptée reste dans SA demi-heure, et un accusé tardif ne la rend ni ne la corrige plus', async () => {
    const t = await espace();
    await credit.crediter(t, 1_000_000, 'achat', 'cs_regul_gel');
    const T = ilYATroisJours();
    const id = await provisionDans(t, T, 74_760);
    await credit.rattacher(id, 'wamid.regul.gel');
    // Pas encore livré, Meta ne l'a pas facturé ce jour-là : l'écart rend la provision au client.
    ecrite(await store.enregistrer({ tenantId: t, jour: '2026-10-26', calcul: calcul(-74_760, 74_760), illimite: false, tranches: [T], lectureDepuisS: T }));
    const fige = await pool.query<{ tr: string }>('select tranche_regularisee::text as tr from credit_whatsapp_provisions where id = $1', [id]);
    expect(fige.rows[0]!.tr).toBe(String(T));
    // Livré trois jours plus tard : il reste compté dans sa demi-heure, jamais une seconde fois dans celle de sa livraison.
    await credit.marquerLivre(t, 'wamid.regul.gel', new Date((T + 3 * 86_400) * 1000));
    expect(await store.nosDemiHeures(t, T, T + 1800)).toEqual([{ debut: T, montantMicroEur: 74_760, messages: 1, livres: 1 }]);
    expect(await store.nosDemiHeures(t, T + 3 * 86_400, T + 3 * 86_400 + 1800)).toEqual([]);
    // Un « failed » ou un reclassement tardifs ne bougent plus rien : la régularisation a déjà rendu son montant.
    expect(await credit.solde(t)).toBe(1_000_000);
    await credit.rendreParWamid(t, 'wamid.regul.gel');
    await credit.corrigerParWamid(t, 'wamid.regul.gel', 'utility', 26_040);
    expect(await credit.solde(t)).toBe(1_000_000);
    expect(await credit.provisionDuWamid(t, 'wamid.regul.gel')).toMatchObject({ etat: 'provisionne', montantMicroEur: 74_760 });
    await invariant(t);
  });

  it('🔴 une provision rendue entre la lecture de la passe et son écriture : rien n’est écrit ni figé, rendue une seule fois', async () => {
    const t = await espace();
    await credit.crediter(t, 1_000_000, 'achat', 'cs_regul_bouge');
    const T = ilYATroisJours();
    const id = await provisionDans(t, T, 74_760);
    await credit.rattacher(id, 'wamid.regul.bouge');
    const lu = (await store.nosDemiHeures(t, T, T + 1800))[0]!.montantMicroEur;
    // Le « failed » arrive pendant la passe : la provision est rendue au solde avant l'écriture du jour.
    await credit.rendreParWamid(t, 'wamid.regul.bouge');
    expect(await store.enregistrer({ tenantId: t, jour: '2026-10-25', calcul: calcul(-lu, lu), illimite: false, tranches: [T], lectureDepuisS: T }))
      .toEqual({ ecrit: false });
    expect(await credit.solde(t)).toBe(1_000_000);
    const regul = await pool.query<{ n: number }>('select count(*)::int as n from credit_whatsapp_regularisations where tenant_id = $1', [t]);
    expect(regul.rows[0]!.n).toBe(0);
    await invariant(t);
  });

  it('les conditions d’un jour : celles de la plupart de ses provisions ; sans provision qui les porte, aucune', async () => {
    const t = await espace();
    await credit.crediter(t, 1_000_000, 'achat', 'cs_regul_cond');
    const T = ilYATroisJours();
    await provisionDans(t, T, 74_760, { commissionPct: 5 });
    await provisionDans(t, T, 74_760, { commissionPct: 5 });
    await provisionDans(t, T + 1800, 71_200, { openBar: true, commissionPct: 0 });
    expect(await store.conditionsDuJour(t, T, T + 3600)).toEqual({ openBar: false, commissionPct: 5 });
    expect(await store.conditionsDuJour(t, T + 1800, T + 3600)).toEqual({ openBar: true, commissionPct: 0 });
    expect(await store.conditionsDuJour(t, T + 3600, T + 7200)).toBeNull();
    // Une provision d'avant la 0275 ne porte pas sa commission : elle ne dit rien.
    await pool.query('update credit_whatsapp_provisions set commission_pct = null where tenant_id = $1', [t]);
    expect(await store.conditionsDuJour(t, T, T + 3600)).toBeNull();
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
