import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgVentesStore } from '../../src/shopify/ventes.pg';
import { PgCoutLeviersStore } from '../../src/shopify/cout-leviers.pg';
import { LIGNE_RELANCE_PANIER } from '../../src/shopify/attribution';
import { PREFIXE_LIGNE_HUBSPOT } from '../../src/hubspot-workflow/envoi';

/**
 * Intégration des deux lectures du ROI (plan 2026-11-06, tâches 2 et 3) : la série du chiffre par jour, et les volumes
 * des leviers. Ce qu'aucun faux ne prouve : le jour de Paris, les commandes de test écartées, l'isolation entre espaces,
 * et surtout que le coût compte EXACTEMENT les messages que l'attribution prend pour des touches. Espaces jetables.
 */
const url = process.env.DATABASE_URL ?? '';
const range = { from: '2026-10-18', to: '2026-10-20' };
const le = (iso: string) => new Date(iso);

describe.skipIf(!url)('les lectures du ROI', () => {
  let pool: Pool;
  let ventes: PgVentesStore;
  let leviers: PgCoutLeviersStore;
  let T = '';
  let autre = '';
  let contact = '';
  let contactAutre = '';
  let fil = '';

  async function vente(o: { espace?: string; commande: string; montant: string; payee: Date; test?: boolean; preuve?: string }): Promise<void> {
    await pool.query(
      `insert into ventes_attribuees (tenant_id, commande_id, montant, devise, payee_le, source, preuve, test)
       values ($1, $2, $3::numeric, 'EUR', $4, 'campagne', $5, $6)`,
      [o.espace ?? T, o.commande, o.montant, o.payee, o.preuve ?? null, o.test ?? false],
    );
  }

  async function campagne(nom: string, o: { wamid?: string; envoye?: Date; workflow?: boolean; espace?: string } = {}): Promise<string> {
    const espace = o.espace ?? T;
    const wf = o.workflow
      ? (await pool.query<{ id: string }>(`insert into workflows (tenant_id, name) values ($1, 'itest') returning id`, [espace])).rows[0]!.id
      : null;
    const k = (await pool.query<{ id: string }>(
      `insert into campaigns (tenant_id, phone_number_id, name, category, template_name, template_language, status, workflow_id)
       values ($1, 'pn', $2, 'marketing', $3, 'fr', 'completed', $4) returning id`,
      [espace, nom, o.workflow ? null : 'promo', wf],
    )).rows[0]!.id;
    await pool.query(
      `insert into campaign_recipients (campaign_id, contact_id, to_e164, status, sent_at, claimed_at, delivery_status, message_id)
       values ($1, $2, '+33600000009', 'sent', $3, $3, 'delivered', $4)`,
      [k, espace === T ? contact : contactAutre, o.envoye ?? le('2026-10-19T10:00:00Z'), o.wamid ?? null],
    );
    return k;
  }

  async function message(origine: string, o: { type?: string; categorie?: string; wamid?: string; le?: Date } = {}): Promise<void> {
    await pool.query(
      `insert into conversation_messages (conversation_id, direction, type, body, origin, statut, created_at, template_name,
                                          template_category, meta_message_id)
       values ($1, 'out', $2, 'x', $3, 'delivered', $4, $5, $6, $7)`,
      [fil, o.type ?? 'text', origine, o.le ?? le('2026-10-19T12:00:00Z'), o.type === 'template' ? 'modele_scenario' : null,
        o.categorie ?? null, o.wamid ?? null],
    );
  }

  async function vider(): Promise<void> {
    for (const espace of [T, autre]) {
      await pool.query('delete from conversation_messages where conversation_id in (select id from conversations where tenant_id = $1)', [espace]);
      await pool.query('delete from campaigns where tenant_id = $1', [espace]);
      await pool.query('delete from workflows where tenant_id = $1', [espace]);
      await pool.query('delete from ventes_attribuees where tenant_id = $1', [espace]);
      await pool.query('delete from credit_whatsapp_provisions where tenant_id = $1', [espace]);
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    ventes = new PgVentesStore(pool);
    leviers = new PgCoutLeviersStore(pool);
    T = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-roi') returning id`)).rows[0]!.id;
    autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-roi-autre') returning id`)).rows[0]!.id;
    contact = (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164) values ($1, '+33600000009') returning id`, [T],
    )).rows[0]!.id;
    contactAutre = (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164) values ($1, '+33600000009') returning id`, [autre],
    )).rows[0]!.id;
    fil = (await pool.query<{ id: string }>(
      `insert into conversations (tenant_id, wa_id, contact_id) values ($1, '33600000009', $2) returning id`, [T, contact],
    )).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[T, autre]]);
    await pool.end();
  });

  it('la série du chiffre : cumulée par jour de Paris, sans les commandes de test ni un autre espace', async () => {
    await vider();
    await vente({ commande: 'a', montant: '20', payee: le('2026-10-18T09:00:00Z'), preuve: 'utm' });
    // 23 h 30 à Paris le 19 (21 h 30 UTC) : reste sur le 19.
    await vente({ commande: 'b', montant: '30.5', payee: le('2026-10-19T21:30:00Z') });
    await vente({ commande: 'c', montant: '999', payee: le('2026-10-19T10:00:00Z'), test: true });
    await vente({ espace: autre, commande: 'd', montant: '500', payee: le('2026-10-19T10:00:00Z') });
    expect(await ventes.lireSerieChiffre(T, range)).toEqual([
      { jour: '2026-10-18', devise: 'EUR', brutCumule: '20', prouveCumule: '20' },
      { jour: '2026-10-19', devise: 'EUR', brutCumule: '50.5', prouveCumule: '20' },
    ]);
    const { totaux } = await ventes.lireChiffre(T, range);
    expect(totaux.find((t) => !t.test)?.brut).toBe('50.5');
  });

  it('🔴 les volumes ne comptent que les leviers : ni confirmation Shopify, ni [API], ni HubSpot, ni un humain', async () => {
    await vider();
    const k = await campagne('Soldes', { wamid: 'w-soldes' });
    await campagne(LIGNE_RELANCE_PANIER);
    await campagne('Shopify · commande payée · #1002');
    await campagne('[API] essai');
    await campagne(`${PREFIXE_LIGNE_HUBSPOT}3f2a`);
    await message('ia');
    await message('mba');
    await message('humain');
    await message('mcp');
    await campagne('Ailleurs', { espace: autre });
    const v = await leviers.lireVolumes(T, range);
    expect(v.map((l) => [l.source, l.campaignId, l.nature, l.n]).sort()).toEqual([
      ['agent', null, 'service', 1],
      ['agent_meta', null, 'service', 1],
      ['campagne', k, 'modele', 1],
      ['relance_panier', null, 'modele', 1],
    ].sort());
    expect(v.find((l) => l.source === 'campagne')).toMatchObject({ nom: 'Soldes', categorie: 'marketing', jour: '2026-10-19' });
  });

  it('un message de scénario lancé par une campagne revient à cette campagne, un scénario seul reste « scénario »', async () => {
    await vider();
    await message('scenario', { le: le('2026-10-18T08:00:00Z') });
    const k = await campagne('Parcours', { workflow: true, envoye: le('2026-10-19T09:00:00Z') });
    await message('scenario', { type: 'template', categorie: 'marketing', le: le('2026-10-19T09:00:01Z') });
    const v = await leviers.lireVolumes(T, range);
    expect(v.map((l) => [l.source, l.campaignId, l.nature]).sort()).toEqual([
      ['campagne', k, 'modele'],
      ['scenario', null, 'service'],
    ].sort());
  });

  it('une provision non rendue du Crédit WhatsApp est portée par son message, une rendue non', async () => {
    await vider();
    await campagne('Payée', { wamid: 'w-1' });
    await campagne('Rendue', { wamid: 'w-2' });
    await pool.query(
      `insert into credit_whatsapp_provisions (tenant_id, phone_number_id, wamid, categorie, montant_micro_eur, etat)
       values ($1, 'pn', 'w-1', 'marketing', 123000, 'provisionne'), ($1, 'pn', 'w-2', 'marketing', 456000, 'rendu')`,
      [T],
    );
    const v = await leviers.lireVolumes(T, range);
    expect(v.find((l) => l.nom === 'Payée')).toMatchObject({ n: 1, nProvision: 1, provisionMicroEur: 123000 });
    expect(v.find((l) => l.nom === 'Rendue')).toMatchObject({ n: 1, nProvision: 0, provisionMicroEur: 0 });
  });

  it('hors de la période, rien ; un message compte sur son jour de Paris', async () => {
    await vider();
    await campagne('Vieille', { envoye: le('2026-09-01T10:00:00Z') });
    const v0 = await leviers.lireVolumes(T, range);
    expect(v0).toEqual([]);
    await message('ia', { le: le('2026-10-20T10:00:00Z') });
    expect((await leviers.lireVolumes(T, range)).map((l) => l.jour)).toEqual(['2026-10-20']);
  });
});
