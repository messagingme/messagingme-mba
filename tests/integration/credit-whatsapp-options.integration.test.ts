import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgLignesCreditStore } from '../../src/credit-whatsapp/lignes.pg';
import { PgOptionsCreditStore } from '../../src/credit-whatsapp/options.pg';
import { PgOffresStore } from '../../src/offres/offre.pg';

/**
 * L'OPTION DU CRÉDIT WHATSAPP SUR UNE VRAIE BASE (migration 0276, lot 4a du plan `2026-11-03-credit-whatsapp-lot-4.md`).
 *
 * 🔴 CE QU'AUCUN TEST UNITAIRE NE VOIT : l'enregistrement idempotent sous l'index « une vivante par espace », l'échec
 * rejoué après le paiement qui ne remet rien en retard, la fin datée une fois, l'ordre des numéros que comptent les
 * places (le numéro de la ligne d'abord, puis l'ancienneté, délié exclu), l'arrêt des seules lignes de l'option, et une
 * seule ligne en cours par compte WhatsApp, tenue par la base.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur une base de production. La CI monte un
 * Postgres jetable pour ça (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';

describe.skipIf(!url)('l’option du Crédit WhatsApp (0276)', () => {
  let pool: Pool;
  let options: PgOptionsCreditStore;
  let lignes: PgLignesCreditStore;
  const espaces: string[] = [];
  let n = 0;

  async function espace(): Promise<string> {
    const id = (await pool.query<{ id: string }>(`insert into tenants (name) values ('credit-wa-option') returning id`)).rows[0]!.id;
    espaces.push(id);
    return id;
  }

  /** Un compte WhatsApp de l'espace et ses numéros, créés dans l'ordre donné (l'ancienneté compte). */
  async function compte(tenantId: string, numeros: Array<{ id: string; delie?: boolean }>): Promise<string> {
    n += 1;
    const waba = `waba-itest-opt-${n}-${Date.now()}`;
    await pool.query(`insert into waba (id, tenant_id, name) values ($1, $2, 'itest')`, [waba, tenantId]);
    for (const [i, p] of numeros.entries()) {
      await pool.query(
        `insert into phone_numbers (id, tenant_id, waba_id, display_phone_number, delie_le, created_at)
         values ($1, $2, $3, '+33 6 00 00 00 00', case when $4 then now() end, now() - make_interval(mins => $5))`,
        [p.id, tenantId, waba, p.delie ?? false, 100 - i],
      );
    }
    return waba;
  }

  const sub = (): string => `sub_itestopt${Date.now()}${Math.floor(Math.random() * 1e6)}`;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(url) });
    options = new PgOptionsCreditStore(pool);
    lignes = new PgLignesCreditStore(pool);
  });

  afterAll(async () => {
    if (espaces.length > 0) await pool.query('delete from tenants where id = any($1::uuid[])', [espaces]);
    await pool.end();
  });

  it('🔴 enregistrée une fois, rejouée sans doublon ; une seconde option vivante est un doublon ; une finie le reste', async () => {
    const t = await espace();
    const a = sub();
    expect(await options.enregistrer({ tenantId: t, abonnementId: a, livemode: false, places: 2, periodeFin: null }))
      .toEqual({ etat: 'enregistre', tenantId: t, nouveau: true });
    expect(await options.enregistrer({ tenantId: t, abonnementId: a, livemode: false, places: 3, periodeFin: null }))
      .toEqual({ etat: 'enregistre', tenantId: t, nouveau: false });
    expect(await options.placesPayees(t)).toBe(3);
    expect(await options.enregistrer({ tenantId: t, abonnementId: sub(), livemode: false, places: 1, periodeFin: null })).toEqual({ etat: 'doublon' });
    const fin = await options.finir(a, 'resiliation', new Date('2026-11-03T20:00:00Z'));
    expect(fin?.premiereFin).toBe(true);
    expect(await options.enregistrer({ tenantId: t, abonnementId: a, livemode: false, places: 5, periodeFin: null })).toEqual({ etat: 'fini' });
    expect(await options.placesPayees(t)).toBe(0);
  });

  it('🔴 en retard, l’option garde ses places ; un échec rejoué après le paiement de sa période ne remet rien en retard', async () => {
    const t = await espace();
    const a = sub();
    const periode = new Date('2026-12-03T00:00:00Z');
    await options.enregistrer({ tenantId: t, abonnementId: a, livemode: false, places: 2, periodeFin: periode });
    expect(await options.majStatut(a, 'en_retard', null, new Date('2026-12-03T00:00:00Z'))).toBeNull();
    expect((await options.majStatut(a, 'en_retard', null, new Date('2027-01-03T00:00:00Z')))?.statut).toBe('en_retard');
    expect(await options.placesPayees(t)).toBe(2);
    expect((await options.majStatut(a, 'actif', new Date('2027-01-03T00:00:00Z')))?.periodeFin?.toISOString()).toBe('2027-01-03T00:00:00.000Z');
  });

  it('les places relues et la fin programmée se notent ; la fin est datée une fois, un rejeu ne la déplace pas', async () => {
    const t = await espace();
    const a = sub();
    await options.enregistrer({ tenantId: t, abonnementId: a, livemode: false, places: 1, periodeFin: null });
    const prevue = new Date('2026-12-01T00:00:00Z');
    expect(await options.noterPlaces(a, 4, prevue)).toMatchObject({ places: 4, finPrevueLe: prevue });
    const premiere = await options.finir(a, 'impaye', new Date('2026-11-03T20:00:00Z'));
    const rejeu = await options.finir(a, 'resiliation', new Date('2026-11-04T20:00:00Z'));
    expect([premiere?.premiereFin, rejeu?.premiereFin, rejeu?.finRaison, rejeu?.finiLe?.toISOString()])
      .toEqual([true, false, 'impaye', '2026-11-03T20:00:00.000Z']);
    expect(await options.noterPlaces(a, 6, null)).toBeNull();
    expect(await options.vivante(t)).toBeNull();
  });

  it('🔴 les numéros que comptent les places : celui de la ligne d’abord, puis l’ancienneté, délié et lignes « ops » ou arrêtées exclus', async () => {
    const t = await espace();
    // Trois numéros du compte, le plus ancien d'abord ; la ligne est posée sur le plus récent.
    const w = await compte(t, [{ id: 'itest-opt-ancien' }, { id: 'itest-opt-delie', delie: true }, { id: 'itest-opt-ligne' }]);
    expect(await lignes.poser(t, 'itest-opt-ligne', w, 'option', 'option')).toBe(true);
    // Un autre compte posé par /ops (un essai forcé) : hors des places.
    const w2 = await compte(t, [{ id: 'itest-opt-essai' }]);
    expect(await lignes.poser(t, 'itest-opt-essai', w2, 'ops', 'essai forcé')).toBe(true);
    expect(await lignes.numerosCouvertsParOption(t)).toEqual(['itest-opt-ligne', 'itest-opt-ancien']);
    // L'option finie arrête SES lignes, jamais celle de /ops ; arrêtées, elles ne comptent plus.
    expect(await lignes.arreterLesLignesDeLOption(t)).toBe(1);
    expect(await lignes.arreterLesLignesDeLOption(t)).toBe(0);
    expect(await lignes.numerosCouvertsParOption(t)).toEqual([]);
    expect((await lignes.ligneDuNumero('itest-opt-essai'))?.arreteeLe).toBeNull();
  });

  it('🔴 une seule ligne en cours par compte WhatsApp, tenue par la base : la seconde pose sur le compte ne passe pas', async () => {
    const t = await espace();
    const w = await compte(t, [{ id: 'itest-opt-a' }, { id: 'itest-opt-b' }]);
    expect(await lignes.poser(t, 'itest-opt-a', w, 'ops', 'premier')).toBe(true);
    expect(await lignes.poser(t, 'itest-opt-b', w, 'ops', 'second du même compte')).toBe(false);
    expect((await lignes.lignesDeLEspace(t)).map((l) => l.phoneNumberId)).toEqual(['itest-opt-a']);
    // La ligne retirée libère le compte.
    expect(await lignes.retirer(t, 'itest-opt-a')).toBe(true);
    expect(await lignes.poser(t, 'itest-opt-b', w, 'ops', 'après le retrait')).toBe(true);
  });

  it('l’annonce de /ops : une option sans Pro dit qu’un retrait de l’offre posée à la main la résiliera', async () => {
    const t = await espace();
    const offres = new PgOffresStore(pool);
    expect((await offres.alertes(t)).optionCreditWhatsappSansDroit).toBe(false);
    await options.enregistrer({ tenantId: t, abonnementId: sub(), livemode: false, places: 1, periodeFin: null });
    expect((await offres.alertes(t)).optionCreditWhatsappSansDroit).toBe(true);
  });
});
