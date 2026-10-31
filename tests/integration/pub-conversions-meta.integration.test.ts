import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgConversionsMetaStore } from '../../src/pub/conversions-meta.pg';
import { consentementCouvre } from '../../src/pub/conversions-meta';
import { decouperInstructions } from '../../src/db/migration-directives';

// Ne PAS lancer ce fichier en local : le DATABASE_URL du .env local pointe sur l'ancienne base de production.
const url = process.env.DATABASE_URL ?? '';

/**
 * LE JOURNAL DES CONVERSIONS EN BASE (pixel, lot 2, migration 0265) : ce que les tests unitaires ne peuvent qu'affirmer.
 *
 *  - 🔴 le dédoublonnage : plusieurs copies qui réservent le même fait en même temps n'en créent qu'UN ;
 *  - 🔴 la personne d'un fait d'espace : l'admin actif le plus ancien ;
 *  - 🔴 l'accord : l'heure du fait (`cree_le`) suit un accord donné avant, jamais un accord donné après ; le retrait
 *    abandonne ce qui attendait ;
 *  - la prise d'une tentative, unique ; le balayage ; la cascade avec l'espace.
 */
describe.skipIf(!url)('le journal des conversions de nos publicités (Postgres réel)', () => {
  let pool: Pool;
  let store: PgConversionsMetaStore;
  let tenantId = '';
  const identites: Record<string, string> = {};
  /** L'espace d'avant le déploiement, que le cas de la reprise crée et que la fin efface. */
  const espacesAnciens: string[] = [];
  const suffixe = randomUUID().slice(0, 8);
  const adresse = (nom: string): string => `itest-pub-${nom}-${suffixe}@example.test`;

  const identite = async (nom: string): Promise<string> => {
    const id = (await pool.query<{ id: string }>('insert into identities (email) values ($1) returning id', [adresse(nom)])).rows[0]!.id;
    identites[nom] = id;
    return id;
  };
  const compte = async (tenant: string, ident: string, role: string, creeLe: string, parti = false) => {
    await pool.query(
      `insert into users (tenant_id, email, role, identity_id, created_at, disabled_at)
       values ($1, (select email from identities where id = $2), $3, $2, $4, $5)`,
      [tenant, ident, role, creeLe, parti ? new Date() : null],
    );
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 6 });
    store = new PgConversionsMetaStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-pub') returning id`)).rows[0]!.id;
    // Le plus ancien est parti : c'est le suivant, actif, qui porte les faits de l'espace. L'agent n'en porte jamais.
    await compte(tenantId, await identite('parti'), 'admin', '2026-01-01T00:00:00Z', true);
    await compte(tenantId, await identite('fondateur'), 'admin', '2026-02-01T00:00:00Z');
    await compte(tenantId, await identite('second'), 'admin', '2026-03-01T00:00:00Z');
    await compte(tenantId, await identite('agent'), 'agent', '2025-12-01T00:00:00Z');
  });

  afterAll(async () => {
    if (pool) {
      for (const t of [tenantId, ...espacesAnciens]) if (t) await pool.query('delete from tenants where id = $1', [t]);
      await pool.query('delete from identities where id = any($1::uuid[])', [Object.values(identites)]);
      await pool.end();
    }
  });

  it('🔴 trois copies réservent le même fait en même temps : UNE ligne, portée par l’admin actif le plus ancien', async () => {
    const prises = await Promise.all([1, 2, 3].map(() => store.reserver({ evenement: 'NumeroConnecte', tenantId })));
    expect(prises.filter((id) => id !== null)).toHaveLength(1);
    const lu = await store.pourEnvoi(prises.find((id) => id !== null)!);
    expect(lu).toMatchObject({ cle: `numero:${tenantId}`, evenement: 'NumeroConnecte', identityId: identites.fondateur, statut: 'a_envoyer' });
  });

  it('une inscription se réserve par l’adresse, sans égard à la casse ; une adresse inconnue ne réserve rien', async () => {
    const id = await store.reserver({ evenement: 'CompleteRegistration', adresse: adresse('second').toUpperCase(), ip: '203.0.113.7', navigateur: 'N/1' });
    expect(id).not.toBeNull();
    expect(await store.pourEnvoi(id!)).toMatchObject({ cle: `inscription:${identites.second}`, ip: '203.0.113.7', navigateur: 'N/1' });
    expect(await store.reserver({ evenement: 'CompleteRegistration', adresse: 'inconnue@example.test' })).toBeNull();
  });

  it('🔴 un accord donné AVANT le fait le couvre ; un accord donné APRÈS, non ; le retrait abandonne ce qui attendait', async () => {
    await store.enregistrerConsentement(adresse('fondateur'), { fbc: 'fb.1.1793300000000.essai' }, 'Navigateur/2.0');
    const id = await store.reserver({ evenement: 'Subscribe', tenantId, valeurCentimes: 4900, devise: 'EUR' });
    const avant = await store.pourEnvoi(id!);
    expect(avant).toMatchObject({ fbc: 'fb.1.1793300000000.essai', navigateurAccord: 'Navigateur/2.0', valeurCentimes: 4900, devise: 'EUR' });
    expect(consentementCouvre(avant!)).toBe(true);

    await store.poserConsentement(identites.fondateur!, false, null);
    expect(await store.pourEnvoi(id!)).toMatchObject({ statut: 'ignore', consentiLe: null, fbc: null, navigateurAccord: null });
    await store.poserConsentement(identites.fondateur!, true, 'Navigateur/3.0');
    // Le fait du numéro, réservé AVANT ce nouvel accord, n'est pas couvert : pas de rattrapage.
    const numero = (await pool.query<{ id: string }>('select id from conversions_meta where cle = $1', [`numero:${tenantId}`])).rows[0]!.id;
    expect(consentementCouvre((await store.pourEnvoi(numero))!)).toBe(false);
  });

  it('une tentative se prend une fois ; le balayage voit une conversion due, jamais une partie', async () => {
    const id = (await pool.query<{ id: string }>('select id from conversions_meta where cle = $1', [`inscription:${identites.second}`])).rows[0]!.id;
    expect(await store.prendre(id, 0)).toBe(true);
    expect(await store.prendre(id, 0)).toBe(false);
    await store.noterEchec(id, 'meta 500', new Date(Date.now() - 1000));
    await pool.query("update conversions_meta set cree_le = now() - interval '10 minutes' where id = $1", [id]);
    expect((await store.aReprendre(1000)).map((l) => l.id)).toContain(id);
    await store.noterEnvoye(id);
    expect((await store.aReprendre(1000)).map((l) => l.id)).not.toContain(id);
    expect(await store.pourEnvoi(id)).toMatchObject({ statut: 'envoye', ip: null, navigateur: null });
  });

  it('🔴 pas de rattrapage : la reprise de la migration bloque le numéro et l’offre d’un espace déjà connecté et abonné', async () => {
    const espace = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-pub-ancien') returning id`)).rows[0]!.id;
    espacesAnciens.push(espace);
    await compte(espace, await identite('ancien'), 'admin', '2026-01-01T00:00:00Z');
    const waba = `itest-waba-${suffixe}`;
    await pool.query('insert into waba (id, tenant_id) values ($1, $2)', [waba, espace]);
    await pool.query('insert into phone_numbers (id, waba_id, tenant_id) values ($1, $2, $3)', [`itest-pn-${suffixe}`, waba, espace]);
    // `abonnements_offre_id_chk` : `sub_` puis des lettres et des chiffres seulement (le suffixe est hexadécimal).
    await pool.query('insert into abonnements_offre (stripe_subscription_id, tenant_id, periodicite, livemode) values ($1, $2, $3, false)', [`sub_itest${suffixe}`, espace, 'mois']);
    // Les deux reprises de la migration, rejouées telles qu'écrites (en CI, la migration a tourné sur une base vide).
    const reprises = decouperInstructions(readFileSync(new URL('../../db/migrations/0265_conversions_meta.sql', import.meta.url), 'utf8'))
      .map((i) => i.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n').trim())
      .filter((i) => i.startsWith('insert into conversions_meta'));
    expect(reprises).toHaveLength(2);
    for (const r of reprises) await pool.query(r);
    const lignes = await pool.query<{ cle: string; statut: string; raison: string; identity_id: string }>(
      'select cle, statut, raison, identity_id from conversions_meta where tenant_id = $1 order by cle', [espace]);
    expect(lignes.rows).toEqual([
      { cle: `numero:${espace}`, statut: 'ignore', raison: 'anterieur', identity_id: identites.ancien },
      { cle: `pro:${espace}`, statut: 'ignore', raison: 'anterieur', identity_id: identites.ancien },
    ]);
    // L'accord donné ensuite ne rattrape rien : le geste rejoué et la facture suivante ne réservent plus.
    await store.poserConsentement(identites.ancien!, true, 'Navigateur/1.0');
    expect(await store.reserver({ evenement: 'NumeroConnecte', tenantId: espace })).toBeNull();
    expect(await store.reserver({ evenement: 'Subscribe', tenantId: espace, valeurCentimes: 4900, devise: 'EUR' })).toBeNull();
  });

  it('🔴 la première preuve d’adresse efface un accord donné avant elle ; les suivantes ne réécrivent rien', async () => {
    await store.enregistrerConsentement(adresse('second'), {}, 'Navigateur/1.0');
    await store.marquerAdresseProuvee(adresse('second'));
    const apres = (await pool.query<{ le: Date; accord: Date | null }>(
      'select adresse_prouvee_le as le, pub_consenti_le as accord from identities where id = $1', [identites.second])).rows[0]!;
    expect(apres.accord).toBeNull();
    // L'accord donné par l'entrée Google elle-même (case cochée) survit aux preuves suivantes.
    await store.enregistrerConsentement(adresse('second'), {}, 'Navigateur/1.0');
    await store.marquerAdresseProuvee(adresse('second'));
    const encore = (await pool.query<{ le: Date; accord: Date | null }>(
      'select adresse_prouvee_le as le, pub_consenti_le as accord from identities where id = $1', [identites.second])).rows[0]!;
    expect(encore.le.getTime()).toBe(apres.le.getTime());
    expect(encore.accord).not.toBeNull();
  });

  it('🔴 la cascade efface le journal avec l’espace', async () => {

    await pool.query('delete from tenants where id = $1', [tenantId]);
    const reste = await pool.query('select 1 from conversions_meta where tenant_id = $1', [tenantId]);
    expect(reste.rowCount).toBe(0);
    tenantId = '';
  });
});
