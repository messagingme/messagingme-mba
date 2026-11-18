import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { DidDejaDeclare, PgNumerosFournisStore } from '../../src/otp/store.pg';

/**
 * LA RÉSERVE DE NUMÉROS FOURNIS ET LES CODES CAPTÉS (migration 0210, lot 3a), sur une vraie base.
 *
 * 🔴 CE QU'AUCUN TEST UNITAIRE NE VOIT : les CHECK et les unicités, exécutés par Postgres. Le CHECK à sens unique de
 * l'espace (un espace supprimé laisse un numéro `attribue` sans espace, et ça doit passer), la paire code et cause, et
 * l'unicité de `appel_id`, qui rend sans effet un envoi rejoué par le script de l'Asterisk.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur la base de PRODUCTION. La CI monte un
 * Postgres jetable pour ça (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';
/** Des numéros que personne n'aura : préfixe britannique non attribué. */
const N1 = '449990000001';
const N2 = '449990000002';

describe.skipIf(!url)('la réserve de numéros fournis (0210)', () => {
  let pool: Pool;
  let store: PgNumerosFournisStore;
  let tenantId = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgNumerosFournisStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-numeros-fournis') returning id`)).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query(`delete from numeros_fournis where numero like '44999%'`);
    if (tenantId) await pool.query('delete from tenants where id = $1', [tenantId]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`delete from numeros_fournis where numero like '44999%'`);
  });

  it('déclarer : inscrit `libre` ; redéclarer rend l’existant sans le réécrire ; le même numéro DIDWW ailleurs : refusé', async () => {
    const a = await store.declarer(N1, 'did-itest-1');
    expect(a).toMatchObject({ cree: true, numero: { numero: N1, didwwDidId: 'did-itest-1', statut: 'libre', tenantId: null } });
    await pool.query(`update numeros_fournis set statut = 'attribue', tenant_id = $2 where numero = $1`, [N1, tenantId]);
    const b = await store.declarer(N1, 'did-itest-1');
    // 🔴 Une seconde déclaration ne remet jamais à `libre` un numéro attribué.
    expect(b).toMatchObject({ cree: false, numero: { statut: 'attribue', tenantId } });
    await expect(store.declarer(N2, 'did-itest-1')).rejects.toBeInstanceOf(DidDejaDeclare);
  });

  it('🔴 les CHECK : le format du numéro, la liste des statuts, et l’espace à sens unique', async () => {
    await expect(pool.query(`insert into numeros_fournis (numero, didww_did_id) values ('+449990000003', 'd3')`)).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(`insert into numeros_fournis (numero, didww_did_id, statut) values ($1, 'd3', 'perdu')`, [N2])).rejects.toMatchObject({ code: '23514' });
    // Un espace sur un numéro libre : refusé.
    await expect(pool.query(`insert into numeros_fournis (numero, didww_did_id, tenant_id) values ($1, 'd3', $2)`, [N2, tenantId])).rejects.toMatchObject({ code: '23514' });
    // L'inverse est atteignable : un numéro attribué dont l'espace a disparu.
    await expect(pool.query(`insert into numeros_fournis (numero, didww_did_id, statut) values ($1, 'd3', 'attribue')`, [N2])).resolves.toBeDefined();
  });

  it('🔴 un espace supprimé laisse son numéro en place, sans espace (set null, pas de cascade)', async () => {
    const autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-numeros-fournis-autre') returning id`)).rows[0]!.id;
    await store.declarer(N1, 'did-itest-1');
    await pool.query(`update numeros_fournis set statut = 'attribue', tenant_id = $2, attribue_le = now() where numero = $1`, [N1, autre]);
    await pool.query('delete from tenants where id = $1', [autre]);
    expect(await store.parNumero(N1)).toMatchObject({ statut: 'attribue', tenantId: null });
  });

  it('🔴 un appel s’écrit une fois : rejoué, rien n’est réécrit ; la paire code et cause est tenue par la base', async () => {
    const { numero } = await store.declarer(N1, 'did-itest-1');
    expect(await store.ecrireCode(numero.id, { appelId: 'itest.1', code: '863801', transcription: 'your code is 8 6 3 8 0 1' })).toBe(true);
    expect(await store.ecrireCode(numero.id, { appelId: 'itest.1', code: '111111', transcription: 'autre' })).toBe(false);
    expect(await store.ecrireCode(numero.id, { appelId: 'itest.2', code: null, transcription: '', cause: 'transcription_indisponible' })).toBe(true);
    // Un code sans cause, ou une cause hors liste : refusés.
    await expect(pool.query(`insert into codes_verification (numero_id, appel_id, code, cause) values ($1, 'itest.3', '123456', 'code_introuvable')`, [numero.id])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(`insert into codes_verification (numero_id, appel_id, code, cause) values ($1, 'itest.4', null, 'autre')`, [numero.id])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(`insert into codes_verification (numero_id, appel_id, code) values ($1, 'itest.5', '12345')`, [numero.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('🔴 une transcription en PANNE se remplace au rejeu ; un appel lu, jamais ; `appelDejaLu` et `appelsRecents`', async () => {
    const { numero } = await store.declarer(N1, 'did-itest-1');
    expect(await store.ecrireCode(numero.id, { appelId: 'itest.20', code: null, transcription: '', cause: 'transcription_indisponible' })).toBe(true);
    expect(await store.appelDejaLu('itest.20')).toBe(false);
    expect(await store.ecrireCode(numero.id, { appelId: 'itest.20', code: '863801', transcription: 'your code is 863801' })).toBe(true);
    expect(await store.appelDejaLu('itest.20')).toBe(true);
    expect(await store.ecrireCode(numero.id, { appelId: 'itest.20', code: null, transcription: '', cause: 'transcription_indisponible' })).toBe(false);
    const ligne = await pool.query(`select code, cause from codes_verification where appel_id = 'itest.20'`);
    expect(ligne.rows).toEqual([{ code: '863801', cause: null }]);
    expect(await store.appelsRecents(numero.id, 60)).toBe(1);
  });

  it('lister : chaque numéro et son DERNIER appel, `null` sans appel ; purger : les appels anciens seulement', async () => {
    const { numero } = await store.declarer(N1, 'did-itest-1');
    await store.declarer(N2, 'did-itest-2');
    await store.ecrireCode(numero.id, { appelId: 'itest.10', code: null, transcription: 'rien', cause: 'code_introuvable' });
    await store.ecrireCode(numero.id, { appelId: 'itest.11', code: '863801', transcription: 'your code is 863801' });
    await pool.query(`update codes_verification set recu_le = now() - interval '10 days' where appel_id = 'itest.10'`);
    const liste = (await store.lister()).filter((n) => n.numero.startsWith('44999'));
    expect(liste.find((n) => n.numero === N1)?.dernierCode).toMatchObject({ appelId: 'itest.11', code: '863801', cause: null });
    expect(liste.find((n) => n.numero === N2)?.dernierCode).toBeNull();
    expect(await store.purgerAvant(7)).toBeGreaterThanOrEqual(1);
    const restants = await pool.query(`select appel_id from codes_verification where numero_id = $1`, [numero.id]);
    expect(restants.rows.map((r) => r.appel_id)).toEqual(['itest.11']);
  });

  /**
   * 🔴 LE NUMÉRO FOURNI CÔTÉ CLIENT (lot 3b, migration 0212). L'attribution est la seule écriture qui donne un numéro de
   * la réserve à un espace : elle doit tenir deux espaces qui se disputent le dernier numéro libre, et deux demandes
   * du MÊME espace (double clic). Le code d'un espace ne se lit que sur SON numéro, après l'attribution.
   */
  describe('l’attribution à un espace (0212)', () => {
    let autre = '';
    beforeAll(async () => {
      autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-numeros-fournis-b') returning id`)).rows[0]!.id;
    });
    afterAll(async () => {
      await pool.query(`delete from numeros_fournis where numero like '44999%'`);
      if (autre) await pool.query('delete from tenants where id = $1', [autre]);
    });
    // ⚠️ Les comptes de numéros libres supposent une réserve qui ne contient que les numéros de ce fichier : c'est le cas
    // en CI (base jetable, seul fichier qui écrit numeros_fournis, fichiers joués l'un après l'autre).

    it('🔴 deux espaces, un seul numéro libre : un seul gagne, l’autre reçoit null', async () => {
      await store.declarer(N1, 'did-itest-1');
      const [a, b] = await Promise.all([store.attribuer(tenantId), store.attribuer(autre)]);
      expect([a, b].filter((x) => x !== null)).toHaveLength(1);
      expect(await store.compterLibres()).toBe(0);
    });

    it('🔴 rejouée par le même espace, elle rend le même numéro ; deux demandes simultanées aussi', async () => {
      await store.declarer(N1, 'did-itest-1');
      await store.declarer(N2, 'did-itest-2');
      const [x, y] = await Promise.all([store.attribuer(tenantId), store.attribuer(tenantId)]);
      expect(x?.numero).toBeDefined();
      expect(y?.numero).toBe(x?.numero);
      expect((await store.attribuer(tenantId))?.numero).toBe(x?.numero);
      expect(await store.compterLibres()).toBe(1);
      expect(await store.numeroDeLEspace(tenantId)).toMatchObject({ numero: x?.numero, statut: 'attribue', tenantId });
    });

    it('🔴 le code d’un espace : sur SON numéro seulement, après l’attribution, jamais un appel sans code', async () => {
      const { numero: n1 } = await store.declarer(N1, 'did-itest-1');
      const { numero: n2 } = await store.declarer(N2, 'did-itest-2');
      // Un appel reçu AVANT l'attribution ne compte pas.
      await store.ecrireCode(n1.id, { appelId: 'itest.30', code: '111111', transcription: 'avant' });
      await pool.query(`update codes_verification set recu_le = now() - interval '1 minute' where appel_id = 'itest.30'`);
      const pris = await store.attribuer(tenantId);
      expect(pris?.numero).toBe(N1);
      expect(await store.codeDeLEspace(tenantId)).toBeNull();
      await store.ecrireCode(n1.id, { appelId: 'itest.31', code: null, transcription: 'rien', cause: 'code_introuvable' });
      expect(await store.codeDeLEspace(tenantId)).toBeNull();
      await store.ecrireCode(n1.id, { appelId: 'itest.32', code: '863801', transcription: 'your code is 863801' });
      expect(await store.codeDeLEspace(tenantId)).toMatchObject({ code: '863801' });
      // Le numéro d'un autre espace : son code n'est jamais vu ici.
      await store.attribuer(autre);
      await store.ecrireCode(n2.id, { appelId: 'itest.33', code: '222222', transcription: 'autre' });
      expect(await store.codeDeLEspace(tenantId)).toMatchObject({ code: '863801' });
      expect(await store.codeDeLEspace(autre)).toMatchObject({ code: '222222' });
      // La borne des 15 minutes, éprouvée SEULE : l'attribution reculée d'une heure, le code reste après elle. L'appel
      // d'AVANT l'attribution recule de deux heures, sinon il repasserait après elle et masquerait la mesure.
      await pool.query(`update codes_verification set recu_le = now() - interval '2 hours' where appel_id = 'itest.30'`);
      await pool.query(`update numeros_fournis set attribue_le = now() - interval '1 hour' where numero = $1`, [N1]);
      await pool.query(`update codes_verification set recu_le = now() - interval '14 minutes' where appel_id = 'itest.32'`);
      expect(await store.codeDeLEspace(tenantId)).toMatchObject({ code: '863801' });
      await pool.query(`update codes_verification set recu_le = now() - interval '16 minutes' where appel_id = 'itest.32'`);
      expect(await store.codeDeLEspace(tenantId)).toBeNull();
    });

    it('🔴 un code capté depuis l’attribution, sans borne de temps : ce que lit « Abandonner » (2026-10-31)', async () => {
      const { numero: n1 } = await store.declarer(N1, 'did-itest-1');
      await store.ecrireCode(n1.id, { appelId: 'itest.40', code: '111111', transcription: 'avant' });
      await pool.query(`update codes_verification set recu_le = now() - interval '1 minute' where appel_id = 'itest.40'`);
      await store.attribuer(tenantId);
      // Un code d'AVANT l'attribution, puis un appel sans code : rien n'a été vérifié pour cet espace.
      expect(await store.codeCapteDepuisLAttribution(tenantId)).toBe(false);
      await store.ecrireCode(n1.id, { appelId: 'itest.41', code: null, transcription: 'rien', cause: 'code_introuvable' });
      expect(await store.codeCapteDepuisLAttribution(tenantId)).toBe(false);
      await store.ecrireCode(n1.id, { appelId: 'itest.42', code: '863801', transcription: 'your code is 863801' });
      expect(await store.codeCapteDepuisLAttribution(tenantId)).toBe(true);
      expect(await store.codeCapteDepuisLAttribution(autre)).toBe(false);
      // Des jours après : toujours vrai, quand `codeDeLEspace` (15 minutes) ne voit plus rien. L'appel d'avant recule plus
      // loin que l'attribution, sinon il repasserait après elle et masquerait la mesure.
      await pool.query(`update codes_verification set recu_le = now() - interval '5 days' where appel_id = 'itest.40'`);
      await pool.query(`update numeros_fournis set attribue_le = now() - interval '4 days' where numero = $1`, [N1]);
      await pool.query(`update codes_verification set recu_le = now() - interval '3 days' where appel_id = 'itest.42'`);
      expect(await store.codeDeLEspace(tenantId)).toBeNull();
      expect(await store.codeCapteDepuisLAttribution(tenantId)).toBe(true);
    });

    it('🔴 la destination du numéro fourni (0280) : inconnue d’abord, retenue par espace avec son heure ; le CHECK tient', async () => {
      await pool.query('update tenants set numero_fourni_destination = null, numero_fourni_destination_le = null where id = any($1)', [[tenantId, autre]]);
      expect(await store.destinationDeLEspace(tenantId)).toBeNull();
      await store.retenirDestination(tenantId, 'application');
      const retenue = await store.destinationDeLEspace(tenantId);
      expect(retenue).toMatchObject({ destination: 'application', depuis: expect.any(Date) });
      // Filtrée sur l'espace : l'autre espace n'a rien.
      expect(await store.destinationDeLEspace(autre)).toBeNull();
      await store.retenirDestination(tenantId, 'api');
      expect(await store.destinationDeLEspace(tenantId)).toMatchObject({ destination: 'api' });
      await expect(pool.query(`update tenants set numero_fourni_destination = 'qr' where id = $1`, [tenantId]))
        .rejects.toMatchObject({ code: '23514' });
    });

    it('🔴 relecture : le code « déjà capté » d’AVANT la destination retenue ne compte pas pour la reprise ; « Abandonner » le voit toujours', async () => {
      const { numero: n1 } = await store.declarer(N1, 'did-itest-1');
      await store.attribuer(tenantId);
      // Un code de la fenêtre de Meta, il y a dix minutes ; puis la personne choisit l'application, il y a cinq minutes.
      await store.ecrireCode(n1.id, { appelId: 'itest.50', code: '222222', transcription: 'fenêtre de Meta' });
      await pool.query(`update numeros_fournis set attribue_le = now() - interval '20 minutes' where numero = $1`, [N1]);
      await pool.query(`update codes_verification set recu_le = now() - interval '10 minutes' where appel_id = 'itest.50'`);
      await pool.query(`update tenants set numero_fourni_destination = 'application', numero_fourni_destination_le = now() - interval '5 minutes' where id = $1`, [tenantId]);
      const depuis = (await store.destinationDeLEspace(tenantId))!.depuis;
      expect(await store.codeCapteDepuisLAttribution(tenantId, depuis)).toBe(false);
      expect(await store.codeCapteDepuisLAttribution(tenantId)).toBe(true);
      // Le code de l'application, après : il compte.
      await store.ecrireCode(n1.id, { appelId: 'itest.51', code: '333333', transcription: 'application' });
      expect(await store.codeCapteDepuisLAttribution(tenantId, depuis)).toBe(true);
      expect(await store.codeCapteDepuisLAttribution(autre, depuis)).toBe(false);
    });

    it('🔴 remplacer sans aucun appel (plan du 2026-11-18) : rendu et marqué ; le même client qui retombe dessus ne le bloque pas, le client suivant si, même sans rien de libre ; un numéro neuf seul : gardé ; rendre le remet en réserve', async () => {
      const marque = async (numero: string): Promise<{ le: Date | null; par: string | null }> =>
        (await pool.query<{ le: Date | null; par: string | null }>(
          'select remplace_sans_appel_le as le, remplace_sans_appel_par as par from numeros_fournis where numero = $1', [numero],
        )).rows[0]!;
      await store.declarer(N1, 'did-itest-1');
      expect(await store.attribuer(tenantId)).toMatchObject({ numero: N1 });
      // Déclaré après : l'ordre de l'attribution ne dépend pas de deux heures de création trop proches.
      await store.declarer(N2, 'did-itest-2');
      // 1re fois sans appel : N1 revient au stock, marqué par cet espace ; l'espace reçoit N2.
      expect(await store.remplacerNumero(tenantId)).toMatchObject({ bloque: null, rendu: N1, nouveau: { numero: N2 } });
      expect(await store.parNumero(N1)).toMatchObject({ statut: 'libre', tenantId: null, attribueLe: null });
      expect(await marque(N1)).toMatchObject({ le: expect.any(Date), par: tenantId });
      // N2 non plus : rendu et marqué ; l'espace retombe sur N1, le seul libre. Son propre échec ne compte pas deux fois.
      expect(await store.remplacerNumero(tenantId)).toMatchObject({ bloque: null, rendu: N2, nouveau: { numero: N1 } });
      expect(await store.remplacerNumero(tenantId)).toMatchObject({ bloque: null, rendu: N1, nouveau: { numero: N2 } });
      expect(await store.rendre(tenantId)).toBe(N2);
      // Le client suivant reçoit N1 (marqué, comme N2 : le plus ancien), sans appel non plus : bloqué, cause `sans_appel`.
      expect(await store.attribuer(autre)).toMatchObject({ numero: N1 });
      const r = await store.remplacerNumero(autre);
      expect(r).toMatchObject({ bloque: N1, cause: 'sans_appel', nouveau: { numero: N2 } });
      expect(r.rendu).toBeUndefined();
      expect(await store.parNumero(N1)).toMatchObject({ statut: 'bloque', tenantId: null });
      // Plus rien de libre : N2, marqué par le premier client, est bloqué de même, et l'espace reste sans numéro.
      expect(await store.remplacerNumero(autre)).toEqual({ bloque: N2, nouveau: null, cause: 'sans_appel' });
      expect(await store.numeroDeLEspace(autre)).toBeNull();
      // Un numéro neuf, rien de libre derrière lui : rien n'est remplacé, l'espace le garde, et il n'est pas marqué.
      await store.declarer('449990000003', 'did-itest-3');
      const t = await store.attribuer(tenantId);
      expect(await store.remplacerNumero(tenantId)).toEqual({ bloque: null, nouveau: null });
      expect(await store.numeroDeLEspace(tenantId)).toMatchObject({ numero: t?.numero, statut: 'attribue' });
      expect(await marque(t!.numero)).toEqual({ le: null, par: null });
      expect(await store.rendre(tenantId)).toBe(t?.numero);
      expect(await store.parNumero(t!.numero)).toMatchObject({ statut: 'libre', tenantId: null, attribueLe: null });
      expect(await store.numeroDeLEspace(tenantId)).toBeNull();
    });

    it('🔴 la marque (0294) : un numéro marqué s’attribue après les autres ; un appel reçu depuis la marque l’annule, même rendu par « Abandonner »', async () => {
      const { numero: n1 } = await store.declarer(N1, 'did-itest-1');
      expect(await store.attribuer(tenantId)).toMatchObject({ numero: N1 });
      await store.declarer(N2, 'did-itest-2');
      expect(await store.remplacerNumero(tenantId)).toMatchObject({ rendu: N1, nouveau: { numero: N2 } });
      expect(await store.rendre(tenantId)).toBe(N2);
      // N1 est le plus ancien, mais marqué : le client suivant reçoit N2, qui ne l'est pas.
      expect(await store.attribuer(autre)).toMatchObject({ numero: N2 });
      expect(await store.rendre(autre)).toBe(N2);
      await pool.query('delete from numeros_fournis where numero = $1', [N2]);
      // Seul N1 reste : le client suivant le reçoit, Meta l'appelle (sans code lu), et il l'abandonne.
      expect(await store.attribuer(autre)).toMatchObject({ numero: N1 });
      await store.ecrireCode(n1.id, { appelId: 'itest.72', code: null, transcription: 'Your verification code is', cause: 'code_introuvable' });
      expect(await store.rendre(autre)).toBe(N1);
      // Repris par ce client et remplacé sans appel : l'appel reçu depuis la marque prouve que Meta veut bien l'appeler.
      // Rendu, pas bloqué.
      expect(await store.attribuer(autre)).toMatchObject({ numero: N1 });
      await store.declarer(N2, 'did-itest-2');
      expect(await store.remplacerNumero(autre)).toMatchObject({ bloque: null, rendu: N1, nouveau: { numero: N2 } });
    });

    it('🔴 remplacer après des appels sans code lu (plan du 2026-11-18) : rendu, sa marque effacée ; une transcription en PANNE le bloque', async () => {
      await pool.query('update tenants set numero_fourni_destination = null, numero_fourni_destination_le = null where id = $1', [tenantId]);
      const { numero: n1 } = await store.declarer(N1, 'did-itest-1');
      // N1 porte la marque d'un remplacement sans appel chez un client précédent.
      await pool.query(`update numeros_fournis set remplace_sans_appel_le = now() - interval '1 day' where numero = $1`, [N1]);
      expect(await store.attribuer(tenantId)).toMatchObject({ numero: N1 });
      const { numero: n2 } = await store.declarer(N2, 'did-itest-2');
      // Meta appelle, la transcription ne contient aucun code certain : personne n'a eu le code.
      await store.ecrireCode(n1.id, { appelId: 'itest.70', code: null, transcription: 'Your verification code is', cause: 'code_introuvable' });
      expect(await store.remplacerNumero(tenantId)).toMatchObject({ bloque: null, rendu: N1, nouveau: { numero: N2 } });
      const m = await pool.query('select remplace_sans_appel_le as le, remplace_sans_appel_par as par from numeros_fournis where numero = $1', [N1]);
      expect(m.rows[0]).toEqual({ le: null, par: null });
      // Sur N2, la transcription est en panne : le rejeu de l'enregistrement peut encore rendre un code. Bloqué, sans cause.
      await store.ecrireCode(n2.id, { appelId: 'itest.71', code: null, transcription: '', cause: 'transcription_indisponible' });
      const r = await store.remplacerNumero(tenantId);
      expect(r).toMatchObject({ bloque: N2, nouveau: { numero: N1 } });
      expect(r.cause).toBeUndefined();
      expect(r.rendu).toBeUndefined();
    });

    it('🔴 l’appel de l’application WhatsApp hors de sa voie (2026-11-17) : son code n’est ni montré ni « déjà capté », l’appel est signalé, et « Remplacer » rend le numéro', async () => {
      await pool.query('update tenants set numero_fourni_destination = null, numero_fourni_destination_le = null where id = $1', [tenantId]);
      const { numero: n1 } = await store.declarer(N1, 'did-itest-1');
      expect(await store.attribuer(tenantId)).toMatchObject({ numero: N1 });
      // Le suivant n'est déclaré qu'après : l'ordre de l'attribution ne dépend pas de deux heures de création trop proches.
      await store.declarer(N2, 'did-itest-2');
      await pool.query(`update numeros_fournis set attribue_le = now() - interval '5 minutes' where numero = $1`, [N1]);
      // La transcription réelle de la nuit du 17 (sans code), puis le même menu suivi d'un code.
      await store.ecrireCode(n1.id, { appelId: 'itest.60', code: null, transcription: 'To receive your WhatsApp verification code, press', cause: 'code_introuvable' });
      await store.ecrireCode(n1.id, { appelId: 'itest.61', code: '416746', transcription: 'To receive your WhatsApp verification code, press 5. Your verification code is 416746.' });
      expect(await store.codeDeLEspace(tenantId)).toBeNull();
      expect(await store.codeCapteDepuisLAttribution(tenantId)).toBe(false);
      expect(await store.appelDeLApplicationRecent(tenantId)).toBe(true);
      // Sur la voie de l'application, le même code se montre, et l'appel n'est plus un signal.
      await pool.query(`update tenants set numero_fourni_destination = 'application', numero_fourni_destination_le = now() - interval '10 minutes' where id = $1`, [tenantId]);
      expect(await store.codeDeLEspace(tenantId)).toMatchObject({ code: '416746' });
      expect(await store.appelDeLApplicationRecent(tenantId)).toBe(false);
      // Hors de sa voie, « Remplacer » rend le numéro (aucun code n'a pu servir) et en attribue un autre.
      await pool.query('update tenants set numero_fourni_destination = null, numero_fourni_destination_le = null where id = $1', [tenantId]);
      const r = await store.remplacerNumero(tenantId);
      expect(r).toMatchObject({ bloque: null, rendu: N1, nouveau: { numero: N2 } });
      expect(await store.parNumero(N1)).toMatchObject({ statut: 'libre', tenantId: null, attribueLe: null });
      // Un appel de Meta sur le nouveau : « Remplacer » le bloque, comme avant.
      const n2 = (await store.parNumero(N2))!;
      await store.ecrireCode(n2.id, { appelId: 'itest.62', code: '123456', transcription: 'Your verification code is 123456.' });
      expect(await store.codeDeLEspace(tenantId)).toMatchObject({ code: '123456' });
      const r2 = await store.remplacerNumero(tenantId);
      expect(r2.bloque).toBe(N2);
      expect(r2.rendu).toBeUndefined();
      expect(await store.parNumero(N2)).toMatchObject({ statut: 'bloque' });
    });

    it('🔴 rouge de la relecture du lot : un code de l’application MONTRÉ sur sa voie, puis la voie changée pour la fenêtre de Meta, garde le numéro (un compte vit peut-être sur le téléphone)', async () => {
      const { numero: n1 } = await store.declarer(N1, 'did-itest-1');
      expect(await store.attribuer(tenantId)).toMatchObject({ numero: N1 });
      await store.declarer(N2, 'did-itest-2');
      await pool.query(`update numeros_fournis set attribue_le = now() - interval '30 minutes' where numero = $1`, [N1]);
      // Sur la voie de l'application depuis vingt minutes ; l'appel de l'application, il y a dix minutes : son code s'est montré.
      await pool.query(`update tenants set numero_fourni_destination = 'application', numero_fourni_destination_le = now() - interval '20 minutes' where id = $1`, [tenantId]);
      await store.ecrireCode(n1.id, { appelId: 'itest.64', code: '416746', transcription: 'To receive your WhatsApp verification code, press 5. Your verification code is 416746.' });
      await pool.query(`update codes_verification set recu_le = now() - interval '10 minutes' where appel_id = 'itest.64'`);
      expect(await store.codeDeLEspace(tenantId)).toMatchObject({ code: '416746' });
      // Puis la voie passe à la fenêtre de Meta, il y a cinq minutes (start_whatsapp_connection en mode fourni).
      await pool.query(`update tenants set numero_fourni_destination = 'api', numero_fourni_destination_le = now() - interval '5 minutes' where id = $1`, [tenantId]);
      // Plus montré (on ne recopie pas un code de l'application dans la fenêtre de Meta), et pas un « appel hors voie » …
      expect(await store.codeDeLEspace(tenantId)).toBeNull();
      expect(await store.appelDeLApplicationRecent(tenantId)).toBe(false);
      // … mais il a PU servir : « Abandonner » le garde, et « Remplacer » le bloque au lieu de le rendre.
      expect(await store.codeCapteDepuisLAttribution(tenantId)).toBe(true);
      const r = await store.remplacerNumero(tenantId);
      expect(r.bloque).toBe(N1);
      expect(r.rendu).toBeUndefined();
      expect(await store.parNumero(N1)).toMatchObject({ statut: 'bloque' });
      await pool.query('update tenants set numero_fourni_destination = null, numero_fourni_destination_le = null where id = $1', [tenantId]);
    });

    it('🔴 seule l’application avait appelé et la réserve est vide : l’espace garde son numéro', async () => {
      await pool.query('update tenants set numero_fourni_destination = null, numero_fourni_destination_le = null where id = $1', [tenantId]);
      const { numero: n1 } = await store.declarer(N1, 'did-itest-1');
      await store.attribuer(tenantId);
      await store.ecrireCode(n1.id, { appelId: 'itest.63', code: null, transcription: 'To receive your WhatsApp verification code, press', cause: 'code_introuvable' });
      // Lot 3 : `nouveau: null`, la route répond « réserve vide » ; l'espace garde son numéro.
      expect(await store.remplacerNumero(tenantId)).toEqual({ bloque: null, nouveau: null });
      expect(await store.numeroDeLEspace(tenantId)).toMatchObject({ numero: N1, statut: 'attribue' });
    });

    it('🔴 l’index tient : un second numéro attribué au même espace est refusé par la base', async () => {
      await store.declarer(N1, 'did-itest-1');
      await store.declarer(N2, 'did-itest-2');
      await store.attribuer(tenantId);
      await expect(pool.query(`update numeros_fournis set statut = 'attribue', tenant_id = $1, attribue_le = now() where numero = $2`, [tenantId, N2]))
        .rejects.toMatchObject({ code: '23505' });
    });
  });
  describe('🔴 un numéro utilisé ailleurs ne part jamais (2026-10-28)', () => {
    // Vécu : le numéro DIDWW de l'application WhatsApp Business de Julien, relié par QR code sans attribution, était resté
    // `libre`. Les deux preuves de `UTILISE_AILLEURS_SQL`, puis la sortie de la réserve depuis /ops.
    let tiers = '';
    const menage = async (): Promise<void> => {
      await pool.query(`delete from comptes_application where numero like '44999%'`);
      await pool.query(`delete from phone_numbers where id = 'itest-nf-pn'`);
    };
    beforeAll(async () => {
      tiers = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-numeros-fournis-c') returning id`)).rows[0]!.id;
      await pool.query(`insert into waba (id, tenant_id, name) values ('itest-nf-waba', $1, 'itest') on conflict (id) do nothing`, [tiers]);
    });
    afterAll(async () => {
      await menage();
      await pool.query(`delete from waba where id = 'itest-nf-waba'`);
      await pool.query(`delete from numeros_fournis where numero like '44999%'`);
      if (tiers) await pool.query('delete from tenants where id = $1', [tiers]);
    });
    beforeEach(menage);

    it('🔴 porté par un compte d’application, même RETIRÉ : jamais attribué ni compté, signalé ; le suivant part à sa place', async () => {
      await store.declarer(N1, 'did-itest-1');
      await pool.query(`insert into comptes_application (tenant_id, numero, statut) values ($1, $2, 'retire')`, [tiers, N1]);
      expect(await store.compterLibres()).toBe(0);
      expect(await store.attribuer(tenantId)).toBeNull();
      expect((await store.lister()).find((n) => n.numero === N1)).toMatchObject({ statut: 'libre', ailleurs: 'application' });
      // N1 est le plus ancien : sans la garde, c'est lui qui partait.
      await store.declarer(N2, 'did-itest-2');
      expect(await store.compterLibres()).toBe(1);
      expect((await store.attribuer(tenantId))?.numero).toBe(N2);
    });

    it('🔴 le numéro API d’un espace (mêmes chiffres, autre écriture) : jamais attribué ni compté, signalé', async () => {
      await store.declarer(N1, 'did-itest-1');
      await pool.query(
        `insert into phone_numbers (id, tenant_id, waba_id, display_phone_number, status) values ('itest-nf-pn', $1, 'itest-nf-waba', '+44 999 0000001', 'CONNECTED')`,
        [tiers],
      );
      expect(await store.compterLibres()).toBe(0);
      expect(await store.attribuer(tenantId)).toBeNull();
      expect((await store.lister()).find((n) => n.numero === N1)).toMatchObject({ statut: 'libre', ailleurs: 'api' });
    });

    it('un numéro libre sans autre usage : `ailleurs` nul, compté, attribuable', async () => {
      await store.declarer(N1, 'did-itest-1');
      expect((await store.lister()).find((n) => n.numero === N1)).toMatchObject({ statut: 'libre', ailleurs: null });
      expect(await store.compterLibres()).toBe(1);
    });

    it('sortir de la réserve : un libre passe en `bloque` et n’est plus attribué ; attribué, déjà sorti ou inconnu : rien', async () => {
      const { numero: n1 } = await store.declarer(N1, 'did-itest-1');
      const { numero: n2 } = await store.declarer(N2, 'did-itest-2');
      expect(await store.sortirDeLaReserve(n1.id)).toBe(N1);
      expect(await store.sortirDeLaReserve(n1.id), 'déjà sorti').toBeNull();
      expect((await store.parNumero(N1))?.statut).toBe('bloque');
      expect((await store.attribuer(tenantId))?.numero).toBe(N2);
      expect(await store.sortirDeLaReserve(n2.id), 'attribué').toBeNull();
      expect((await store.parNumero(N2))?.statut).toBe('attribue');
      expect(await store.sortirDeLaReserve('00000000-0000-4000-8000-000000000000'), 'inconnu').toBeNull();
    });
  });

  /**
   * 🔴 UN NUMÉRO QUI N'A JAMAIS SERVI REVIENT AU STOCK (plan du 2026-11-18). Vécu le 2026-11-17 : un numéro attribué,
   * jamais relié, gardé par l'espace, et le stock vide. La condition entière (`inutiliseSql`), éprouvée une pièce à la fois.
   */
  describe('🔴 un numéro qui n’a jamais servi revient au stock (2026-11-18)', () => {
    let espace = '';
    const menage = async (): Promise<void> => {
      await pool.query(`delete from numeros_fournis where numero like '44999%'`);
      await pool.query('delete from abonnements_numero where tenant_id = $1', [espace]);
      await pool.query('delete from comptes_application where tenant_id = $1', [espace]);
      await pool.query(`delete from phone_numbers where id = 'itest-nf-inutilise'`);
    };
    beforeAll(async () => {
      espace = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-numeros-fournis-d') returning id`)).rows[0]!.id;
      await pool.query(`insert into waba (id, tenant_id, name) values ('itest-nf-waba-d', $1, 'itest') on conflict (id) do nothing`, [espace]);
    });
    afterAll(async () => {
      await menage();
      await pool.query(`delete from waba where id = 'itest-nf-waba-d'`);
      if (espace) await pool.query('delete from tenants where id = $1', [espace]);
    });
    beforeEach(menage);

    /** N1, attribué à l'espace il y a `heures` heures. */
    const attribueDepuis = async (heures: number): Promise<{ id: string }> => {
      const { numero } = await store.declarer(N1, 'did-itest-1');
      expect(await store.attribuer(espace)).toMatchObject({ numero: N1 });
      await pool.query(`update numeros_fournis set attribue_le = now() - make_interval(hours => $2::int) where numero = $1`, [N1, heures]);
      return numero;
    };
    /** Un appel reçu il y a `heures` heures. */
    const appel = async (numeroId: string, appelId: string, heures: number, r: { code: string | null; transcription: string; cause?: 'code_introuvable' | 'transcription_indisponible' }) => {
      await store.ecrireCode(numeroId, r.code === null
        ? { appelId, code: null, transcription: r.transcription, cause: r.cause ?? 'code_introuvable' }
        : { appelId, code: r.code, transcription: r.transcription });
      await pool.query(`update codes_verification set recu_le = now() - make_interval(hours => $2::int) where appel_id = $1`, [appelId, heures]);
    };
    const lus = async (): Promise<string[]> => (await store.numerosInutilises(24)).filter((c) => c.tenantId === espace).map((c) => c.id);

    it('🔴 attribué depuis 25 h sans aucun appel : lu, puis repris ; la marque d’un remplacement sans appel reste', async () => {
      const n = await attribueDepuis(25);
      await pool.query('update numeros_fournis set remplace_sans_appel_le = now() where numero = $1', [N1]);
      expect(await lus()).toEqual([n.id]);
      const r = await store.reprendreSiInutilise(n.id, espace, 24);
      expect(r).toMatchObject({ numero: N1, tenantId: espace, attribueLe: expect.any(Date) });
      const l = await pool.query('select statut, tenant_id, attribue_le, remplace_sans_appel_le as m from numeros_fournis where numero = $1', [N1]);
      expect(l.rows[0]).toMatchObject({ statut: 'libre', tenant_id: null, attribue_le: null });
      expect(l.rows[0].m).toBeInstanceOf(Date);
      // Déjà repris : rien, et plus rien à lire.
      expect(await store.reprendreSiInutilise(n.id, espace, 24)).toBeNull();
      expect(await lus()).toEqual([]);
    });

    it('🔴 le temps : attribué depuis moins de 24 h, ou un appel depuis moins de 24 h, le garde', async () => {
      const n = await attribueDepuis(23);
      expect(await lus()).toEqual([]);
      expect(await store.reprendreSiInutilise(n.id, espace, 24)).toBeNull();
      await pool.query(`update numeros_fournis set attribue_le = now() - interval '30 hours' where numero = $1`, [N1]);
      await appel(n.id, 'itest.80', 2, { code: null, transcription: 'rien' });
      expect(await lus()).toEqual([]);
      await pool.query(`update codes_verification set recu_le = now() - interval '26 hours' where appel_id = 'itest.80'`);
      expect(await lus()).toEqual([n.id]);
    });

    it('🔴 un appel qui a pu livrer un code le garde : un code lu, une transcription en panne ; un appel de l’application caché, non', async () => {
      await pool.query('update tenants set numero_fourni_destination = null, numero_fourni_destination_le = null where id = $1', [espace]);
      const n = await attribueDepuis(30);
      await pool.query('update numeros_fournis set remplace_sans_appel_le = now() where numero = $1', [N1]);
      await appel(n.id, 'itest.81', 27, { code: '416746', transcription: 'Your verification code is 416746.' });
      expect(await lus()).toEqual([]);
      expect(await store.reprendreSiInutilise(n.id, espace, 24)).toBeNull();
      await pool.query(`delete from codes_verification where appel_id = 'itest.81'`);
      await appel(n.id, 'itest.82', 27, { code: null, transcription: '', cause: 'transcription_indisponible' });
      expect(await lus()).toEqual([]);
      await pool.query(`delete from codes_verification where appel_id = 'itest.82'`);
      // L'application WhatsApp a appelé hors de sa voie : son code n'a jamais pu se montrer, il ne retient rien.
      await appel(n.id, 'itest.83', 27, { code: '416746', transcription: 'To receive your WhatsApp verification code, press 5. Your verification code is 416746.' });
      expect(await lus()).toEqual([n.id]);
      // Repris ; un appel avait eu lieu : la marque d'un remplacement sans appel s'efface.
      expect(await store.reprendreSiInutilise(n.id, espace, 24)).toMatchObject({ numero: N1 });
      const m = await pool.query('select remplace_sans_appel_le as m from numeros_fournis where numero = $1', [N1]);
      expect(m.rows[0].m).toBeNull();
    });

    it('🔴 ce qui le porte le garde : un abonnement du numéro vivant, un compte de l’application, un numéro de Meta (ses chiffres, ou inconnus)', async () => {
      const n = await attribueDepuis(30);
      expect(await lus()).toEqual([n.id]);
      // L'abonné le paie : il le garde ; résilié, il ne le retient plus.
      await pool.query(`insert into abonnements_numero (stripe_subscription_id, tenant_id, livemode, statut) values ('sub_itestinutilise', $1, false, 'actif')`, [espace]);
      expect(await lus()).toEqual([]);
      expect(await store.reprendreSiInutilise(n.id, espace, 24)).toBeNull();
      await pool.query(`update abonnements_numero set statut = 'resilie' where stripe_subscription_id = 'sub_itestinutilise'`);
      expect(await lus()).toEqual([n.id]);
      // Un compte de l'application sur cette ligne de la réserve, même retiré et sous d'autres chiffres.
      await pool.query(`insert into comptes_application (tenant_id, numero, statut, fourni_id) values ($1, '33612345678', 'retire', $2)`, [espace, n.id]);
      expect(await lus()).toEqual([]);
      await pool.query('delete from comptes_application where tenant_id = $1', [espace]);
      // Un numéro de Meta de l'espace aux chiffres inconnus : peut-être celui-ci (`vuDeMeta`).
      await pool.query(
        `insert into phone_numbers (id, tenant_id, waba_id, display_phone_number, status) values ('itest-nf-inutilise', $1, 'itest-nf-waba-d', null, 'CONNECTED')`,
        [espace],
      );
      expect(await lus()).toEqual([]);
      // Ses chiffres connus, et ce sont les siens : l'espace a relié son propre numéro, le fourni ne sert à rien.
      await pool.query(`update phone_numbers set display_phone_number = '+33 6 12 34 56 78' where id = 'itest-nf-inutilise'`);
      expect(await lus()).toEqual([n.id]);
      // Les chiffres du numéro fourni, sous une autre écriture : relié, il le garde.
      await pool.query(`update phone_numbers set display_phone_number = '+44 999 0000001' where id = 'itest-nf-inutilise'`);
      expect(await lus()).toEqual([]);
      expect(await store.reprendreSiInutilise(n.id, espace, 24)).toBeNull();
      expect(await store.parNumero(N1)).toMatchObject({ statut: 'attribue', tenantId: espace });
    });

    it('🔴 la condition est relue sous le verrou : un code arrivé après la lecture garde le numéro', async () => {
      const n = await attribueDepuis(30);
      expect(await lus()).toEqual([n.id]);
      await store.ecrireCode(n.id, { appelId: 'itest.84', code: '123456', transcription: 'Your verification code is 123456.' });
      expect(await store.reprendreSiInutilise(n.id, espace, 24)).toBeNull();
      expect(await store.parNumero(N1)).toMatchObject({ statut: 'attribue', tenantId: espace });
      // Un autre espace ne reprend pas ce numéro par son identifiant.
      await pool.query(`delete from codes_verification where appel_id = 'itest.84'`);
      expect(await store.reprendreSiInutilise(n.id, tenantId, 24)).toBeNull();
      expect(await store.parNumero(N1)).toMatchObject({ statut: 'attribue', tenantId: espace });
    });
  });
});
