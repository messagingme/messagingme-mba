import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgEtiquettesStore } from '../../src/shopify/etiquettes.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LES ÉTIQUETTES EN DIRECT contre un VRAI Postgres (segments Shopify enrichis, lot 6d) : un webhook
 * \`customer.tags_added\` ou \`customer.tags_removed\` écrit sur CHAQUE fiche active reliée au client (le couple
 * fiche-client du lot 6b bis), sans la casse au retrait, et seulement synchronisation allumée hors Free ; jamais un autre
 * espace, au même identifiant de client.
 *
 * ⚠️ Jamais joué en local contre `DATABASE_URL` (l'ancienne production) : joué par le job `integration`, ou sur le banc
 * PGlite.
 */
describe.skipIf(!url)('les étiquettes en direct, par webhook (Postgres)', () => {
  let pool: Pool;
  let magasin: PgEtiquettesStore;
  let ici = '';
  let ailleurs = '';
  let A = '';
  let B = '';
  let C = '';
  let X = '';

  const etiquettes = async (t: string, fiche: string): Promise<string[]> => (await pool.query<{ e: string }>(
    `select client_id || ':' || etiquette as e from shopify_etiquettes where tenant_id = $1 and contact_id = $2 order by 1`, [t, fiche])).rows.map((r) => r.e);
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
    ici = await espace('itest-etiquettes-webhook');
    ailleurs = await espace('itest-etiquettes-webhook-autre');
    const fiche = async (t: string, tel: string) =>
      (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [t, tel])).rows[0]!.id;
    A = await fiche(ici, '+33600679001');
    B = await fiche(ici, '+33600679002');
    C = await fiche(ici, '+33600679003');
    X = await fiche(ailleurs, '+33600679001');
    for (const t of [ici, ailleurs]) {
      await pool.query(
        `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre, devise) values ($1, $2, 'cid', 'x', 'EUR')`,
        [t, `itest-${randomUUID().slice(0, 8)}.myshopify.com`],
      );
    }
    // 5001 a deux numéros (A et C), 5002 est B, 5003 partage le numéro de A et porte déjà « VIP » ; ailleurs, 5001 est X.
    const j = await tenir(ici);
    await magasin.ecrireRecherche(ici, j, {
      cherchees: [A, B, C],
      trouves: [{ contactId: A, clientId: '5001', etiquettes: [] }, { contactId: C, clientId: '5001', etiquettes: [] }, { contactId: B, clientId: '5002', etiquettes: [] },
        { contactId: A, clientId: '5003', etiquettes: ['VIP'] }],
      complete: true,
    });
    await magasin.finir(ici, j, 'lue', null);
    const k = await tenir(ailleurs);
    await magasin.ecrireRecherche(ailleurs, k, { cherchees: [X], trouves: [{ contactId: X, clientId: '5001', etiquettes: [] }], complete: true });
    await magasin.finir(ailleurs, k, 'lue', null);
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[ici, ailleurs]]);
    await pool.end();
  });

  it('🔴 ajoutées : sur CHAQUE fiche du client, jamais celles d’un autre client ni d’un autre espace ; en double, rien de plus', async () => {
    expect(await magasin.appliquerDuWebhook(ici, '5001', ['VIP', 'Fidèle'], 'ajout')).toBe(4);
    expect(await etiquettes(ici, A)).toEqual(['5001:Fidèle', '5001:VIP', '5003:VIP']);
    expect(await etiquettes(ici, C)).toEqual(['5001:Fidèle', '5001:VIP']);
    expect(await etiquettes(ici, B)).toEqual([]);
    expect(await etiquettes(ailleurs, X)).toEqual([]);
    expect(await magasin.appliquerDuWebhook(ici, '5001', ['VIP'], 'ajout')).toBe(0);
  });

  it('🔴 retirées sans la casse, seulement celles-là, seulement pour ce client : le « VIP » d’un autre client de la même fiche reste', async () => {
    await magasin.appliquerDuWebhook(ici, '5002', ['VIP'], 'ajout');
    expect(await magasin.appliquerDuWebhook(ici, '5001', ['Vip'], 'retrait')).toBe(2);
    expect(await etiquettes(ici, A)).toEqual(['5001:Fidèle', '5003:VIP']);
    expect(await etiquettes(ici, B)).toEqual(['5002:VIP']);
  });

  it('🔴 une fiche supprimée n’est jamais écrite ; un client relié à aucune fiche, ou une liste vide, n’écrit rien', async () => {
    await pool.query(`update contacts set deleted_at = now() where id = $1`, [C]);
    try {
      expect(await magasin.appliquerDuWebhook(ici, '5001', ['Hiver'], 'ajout')).toBe(1);
      expect(await etiquettes(ici, C)).not.toContain('5001:Hiver');
    } finally {
      await pool.query(`update contacts set deleted_at = null where id = $1`, [C]);
    }
    expect(await magasin.appliquerDuWebhook(ici, '9999', ['Hiver'], 'ajout')).toBe(0);
    expect(await magasin.appliquerDuWebhook(ici, '5001', [], 'ajout')).toBe(0);
  });

  it('🔴 rien quand la synchronisation est éteinte, ni en Free (qui synchronise à la demande)', async () => {
    await magasin.regler(ici, false);
    expect(await magasin.appliquerDuWebhook(ici, '5001', ['Printemps'], 'ajout')).toBe(0);
    await magasin.regler(ici, true);
    await pool.query(`update tenants set offre_business = false where id = $1`, [ici]);
    try {
      expect(await magasin.appliquerDuWebhook(ici, '5001', ['Printemps'], 'ajout')).toBe(0);
    } finally {
      await pool.query(`update tenants set offre_business = true where id = $1`, [ici]);
    }
    expect(await etiquettes(ici, A)).not.toContain('5001:Printemps');
    expect(await magasin.appliquerDuWebhook(ici, '5001', ['Printemps'], 'ajout')).toBe(2);
  });
});
