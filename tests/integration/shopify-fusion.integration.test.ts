import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgEtiquettesStore } from '../../src/shopify/etiquettes.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LA FUSION DE DEUX CLIENTS SHOPIFY contre un VRAI Postgres (segments Shopify enrichis, lot 7d) : tout ce qui portait le
 * client absorbé (ses liens vers les fiches, les étiquettes qu'il leur donnait, ses commandes notées) passe au client
 * gardé, dans l'espace, sans doubler une fiche déjà liée au gardé ; une fiche supprimée ne reçoit rien ; jamais un autre
 * espace, au même identifiant de client.
 *
 * ⚠️ Jamais joué en local contre `DATABASE_URL` (l'ancienne production) : joué par le job `integration`, ou sur le banc
 * PGlite.
 */
describe.skipIf(!url)('la fusion de deux clients Shopify (Postgres)', () => {
  let pool: Pool;
  let magasin: PgEtiquettesStore;
  let ici = '';
  let ailleurs = '';
  let A = '';
  let B = '';
  let S = '';
  let X = '';

  const liens = async (t: string): Promise<string[]> => (await pool.query<{ l: string }>(
    `select client_id || '>' || contact_id as l from shopify_clients where tenant_id = $1 order by 1`, [t])).rows.map((r) => r.l);
  const etiquettes = async (t: string, fiche: string): Promise<string[]> => (await pool.query<{ e: string }>(
    `select client_id || ':' || etiquette as e from shopify_etiquettes where tenant_id = $1 and contact_id = $2 order by 1`, [t, fiche])).rows.map((r) => r.e);
  const commandes = async (t: string): Promise<string[]> => (await pool.query<{ c: string }>(
    `select commande_id || '>' || coalesce(client_id, '-') as c from shopify_commandes where tenant_id = $1 order by 1`, [t])).rows.map((r) => r.c);
  /** Une synchronisation tenue, le temps de poser des liens. */
  const tenir = async (t: string): Promise<string> => {
    await magasin.regler(t, true);
    await pool.query(`update shopify_etiquettes_synchro set en_cours_depuis = null, bail_jusqua = null, jeton = null, demandee_le = null where tenant_id = $1`, [t]);
    expect(await magasin.demander(t, { auPlusUneFoisParJour: false })).toBeInstanceOf(Date);
    return (await magasin.prendre(t))!.jeton;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    magasin = new PgEtiquettesStore(pool);
    const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name, offre_business) values ($1, true) returning id`, [nom])).rows[0]!.id;
    ici = await espace('itest-fusion');
    ailleurs = await espace('itest-fusion-autre');
    const fiche = async (t: string, tel: string) =>
      (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [t, tel])).rows[0]!.id;
    A = await fiche(ici, '+33600680001');
    B = await fiche(ici, '+33600680002');
    S = await fiche(ici, '+33600680003');
    X = await fiche(ailleurs, '+33600680002');
    for (const t of [ici, ailleurs]) {
      await pool.query(
        `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre, devise) values ($1, $2, 'cid', 'x', 'EUR')`,
        [t, `itest-${randomUUID().slice(0, 8)}.myshopify.com`],
      );
    }
    // Ici : 6001 (le gardé) est A, « VIP » ; 6002 (l'absorbé) est A ET B (un numéro partagé), « Fidèle », et S, qui sera
    // supprimée. Ailleurs : 6002 est X, « Fidèle ».
    const j = await tenir(ici);
    await magasin.ecrireRecherche(ici, j, {
      cherchees: [A, B, S],
      trouves: [
        { contactId: A, clientId: '6001', etiquettes: ['VIP'] },
        { contactId: A, clientId: '6002', etiquettes: ['Fidèle'] },
        { contactId: B, clientId: '6002', etiquettes: ['Fidèle'] },
        { contactId: S, clientId: '6002', etiquettes: ['Fidèle'] },
      ],
      complete: true,
    });
    await magasin.finir(ici, j, 'lue', null);
    const k = await tenir(ailleurs);
    await magasin.ecrireRecherche(ailleurs, k, { cherchees: [X], trouves: [{ contactId: X, clientId: '6002', etiquettes: ['Fidèle'] }], complete: true });
    await magasin.finir(ailleurs, k, 'lue', null);
    const commande = (t: string, id: string, client: string | null, contact: string) => pool.query(
      `insert into shopify_commandes (tenant_id, commande_id, client_id, contact_id, payee_le) values ($1, $2, $3, $4, now())`,
      [t, id, client, contact],
    );
    await commande(ici, 'c1', '6002', B);
    await commande(ici, 'c2', '6001', A);
    await commande(ici, 'c3', null, A);
    await commande(ailleurs, 'c1', '6002', X);
    await pool.query('update contacts set deleted_at = now() where id = $1', [S]);
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[ici, ailleurs]]);
    await pool.end();
  });

  it('🔴 tout ce qui portait l’absorbé passe au gardé, sans doubler A ; la fiche supprimée ne reçoit rien ; l’autre espace est intact', async () => {
    // A était déjà liée au gardé : seule B reçoit un lien neuf ; les « Fidèle » de A et B passent au gardé.
    expect(await magasin.fusionnerClients(ici, '6001', '6002')).toEqual({ liens: 1, etiquettes: 2, commandes: 1 });
    expect(await liens(ici)).toEqual([`6001>${A}`, `6001>${B}`, `6002>${S}`].sort());
    expect(await etiquettes(ici, A)).toEqual(['6001:Fidèle', '6001:VIP']);
    expect(await etiquettes(ici, B)).toEqual(['6001:Fidèle']);
    // La fiche supprimée garde son lien à l'absorbé jusqu'à sa purge, qui l'emporte ; elle ne gagne rien.
    expect(await etiquettes(ici, S)).toEqual(['6002:Fidèle']);
    expect(await commandes(ici)).toEqual(['c1>6001', 'c2>6001', 'c3>-']);
    // Ailleurs, le même identifiant de client n'a pas bougé.
    expect(await liens(ailleurs)).toEqual([`6002>${X}`]);
    expect(await etiquettes(ailleurs, X)).toEqual(['6002:Fidèle']);
    expect(await commandes(ailleurs)).toEqual(['c1>6002']);
  });

  it('rejouée, elle ne fait plus rien ; un gardé égal à l’absorbé, ou un absorbé inconnu, non plus', async () => {
    expect(await magasin.fusionnerClients(ici, '6001', '6002')).toEqual({ liens: 0, etiquettes: 0, commandes: 0 });
    expect(await magasin.fusionnerClients(ici, '6001', '6001')).toEqual({ liens: 0, etiquettes: 0, commandes: 0 });
    expect(await magasin.fusionnerClients(ici, '6001', '9999')).toEqual({ liens: 0, etiquettes: 0, commandes: 0 });
    expect(await liens(ici)).toEqual([`6001>${A}`, `6001>${B}`, `6002>${S}`].sort());
  });

  it('🔴 un espace sans ligne de synchronisation (jamais synchronisé, ou branchement effacé) : rien ne fusionne', async () => {
    await pool.query('delete from shopify_etiquettes_synchro where tenant_id = $1', [ailleurs]);
    expect(await magasin.fusionnerClients(ailleurs, '6001', '6002')).toEqual({ liens: 0, etiquettes: 0, commandes: 0 });
    expect(await liens(ailleurs)).toEqual([`6002>${X}`]);
    expect(await commandes(ailleurs)).toEqual(['c1>6002']);
  });
});
