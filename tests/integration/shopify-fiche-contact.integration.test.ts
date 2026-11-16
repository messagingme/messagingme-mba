import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgVentesStore } from '../../src/shopify/ventes.pg';

/**
 * Intégration de l'onglet « Shopify » de la fiche (plan 2026-11-16) : `achatsDuContact`. Ce qu'aucun faux ne prouve :
 * l'isolation entre espaces (une commande et un panier d'un AUTRE espace au même numéro ne remontent jamais), la dépense
 * dans la seule devise de la boutique, les commandes de test comptées au résumé mais pas au rapporté, l'attribution et
 * le nom de sa campagne, les paniers retrouvés par le numéro de la fiche. Espaces jetables.
 */
const url = process.env.DATABASE_URL ?? '';
const TEL = '+33600000961';

describe.skipIf(!url)('les achats Shopify d’un contact', () => {
  let pool: Pool;
  let ventes: PgVentesStore;
  let T = '';
  let autre = '';
  let sansBoutique = '';
  let contact = '';
  let contactAutre = '';
  let contactSans = '';

  async function commande(espace: string, fiche: string, id: string, o: { montant?: string | null; devise?: string; test?: boolean; payee: string }): Promise<void> {
    await pool.query(
      `insert into shopify_commandes (tenant_id, commande_id, contact_id, payee_le, montant, devise, test)
       values ($1, $2, $3, $4, $5::numeric, $6, $7)`,
      [espace, id, fiche, o.payee, o.montant === undefined ? '10' : o.montant, o.montant === null ? null : (o.devise ?? 'EUR'), o.test ?? false],
    );
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    ventes = new PgVentesStore(pool);
    const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    T = await espace('itest-fiche-shopify');
    autre = await espace('itest-fiche-shopify-autre');
    sansBoutique = await espace('itest-fiche-shopify-sans');
    const fiche = async (e: string) => (await pool.query<{ id: string }>(`insert into contacts (tenant_id, phone_e164) values ($1, $2) returning id`, [e, TEL])).rows[0]!.id;
    contact = await fiche(T);
    contactAutre = await fiche(autre);
    contactSans = await fiche(sansBoutique);
    for (const e of [T, autre]) {
      await pool.query(
        `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre, nom, devise, commandes_depuis)
         values ($1, $2, 'cid', 'x', 'Boutique itest', 'EUR', '2026-11-01T00:00:00Z')`,
        [e, `itest-${randomUUID().slice(0, 8)}.myshopify.com`],
      );
    }
    const k = (await pool.query<{ id: string }>(
      `insert into campaigns (tenant_id, phone_number_id, name, category, template_name, template_language, status)
       values ($1, 'pn', 'Soldes', 'marketing', 'promo', 'fr', 'completed') returning id`, [T],
    )).rows[0]!.id;
    await commande(T, contact, '1001', { montant: '49.90', payee: '2026-11-02T10:00:00Z' });
    await commande(T, contact, '1002', { montant: '20', payee: '2026-11-03T10:00:00Z', test: true });
    await commande(T, contact, '1003', { montant: '5', devise: 'USD', payee: '2026-11-04T10:00:00Z' });
    await commande(T, contact, '1004', { montant: null, payee: '2026-11-01T10:00:00Z' });
    await commande(autre, contactAutre, '1001', { montant: '999', payee: '2026-11-05T10:00:00Z' });
    await pool.query(
      `insert into ventes_attribuees (tenant_id, commande_id, contact_id, montant, devise, payee_le, source, campaign_id, preuve, test)
       values ($1, '1001', $2, 49.90, 'EUR', '2026-11-02T10:00:00Z', 'campagne', $3, 'utm', false),
              ($1, '1002', $2, 20, 'EUR', '2026-11-03T10:00:00Z', 'agent', null, null, true)`,
      [T, contact, k],
    );
    await pool.query(
      `insert into shopify_paniers (tenant_id, jeton, telephone, lien, ouvert_le, relance_le, issue)
       values ($1, 'p1', $2, 'https://x', '2026-11-10T10:00:00Z', '2026-11-10T11:00:00Z', 'envoye'),
              ($3, 'p2', $2, 'https://x', '2026-11-11T10:00:00Z', null, null)`,
      [T, TEL, autre],
    );
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[T, autre, sansBoutique]]);
    await pool.end();
  });

  it('la boutique, le résumé (test compris, devise de la boutique) et la liste, la plus récente d’abord', async () => {
    const a = await ventes.achatsDuContact(T, contact);
    expect(a?.boutique).toMatchObject({ nom: 'Boutique itest', devise: 'EUR', commandesDepuis: '2026-11-01T00:00:00.000Z', coupeeLe: null });
    expect(a?.resume).toEqual({ commandes: 4, commandesTest: 1, depense: '69.9', derniereLe: '2026-11-04T10:00:00.000Z' });
    expect(a?.commandes.map((c) => c.commandeId)).toEqual(['1003', '1002', '1001', '1004']);
    expect(a?.commandes.find((c) => c.commandeId === '1004')).toMatchObject({ montant: null, devise: null });
  });

  it('l’attribution et sa campagne, et le rapporté sans les commandes de test', async () => {
    const a = await ventes.achatsDuContact(T, contact);
    expect(a?.commandes.find((c) => c.commandeId === '1001')?.attribution).toEqual({ source: 'campagne', campagne: 'Soldes', preuve: 'utm' });
    expect(a?.commandes.find((c) => c.commandeId === '1002')?.attribution).toEqual({ source: 'agent', campagne: null, preuve: null });
    expect(a?.rapporte).toEqual([{ devise: 'EUR', montant: '49.9', prouve: '49.9', commandes: 1 }]);
  });

  it('🔴 les paniers du numéro de la fiche, jamais ceux d’un autre espace au même numéro', async () => {
    const a = await ventes.achatsDuContact(T, contact);
    expect(a?.paniers).toEqual([{ ouvertLe: '2026-11-10T10:00:00.000Z', relanceLe: '2026-11-10T11:00:00.000Z', fermeLe: null, issue: 'envoye' }]);
  });

  it('🔴 la fiche d’un autre espace est inconnue : null, jamais ses commandes', async () => {
    expect(await ventes.achatsDuContact(T, contactAutre)).toBeNull();
    const b = await ventes.achatsDuContact(autre, contactAutre);
    expect(b?.commandes.map((c) => c.montant)).toEqual(['999']);
    expect(b?.paniers.map((p) => p.ouvertLe)).toEqual(['2026-11-11T10:00:00.000Z']);
  });

  it('un espace sans boutique : boutique nulle, rien d’autre', async () => {
    expect(await ventes.achatsDuContact(sansBoutique, contactSans)).toMatchObject({ boutique: null, commandes: [], paniers: [] });
  });
});
