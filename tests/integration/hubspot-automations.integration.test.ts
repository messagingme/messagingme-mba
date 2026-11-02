import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgTenantSettingsStore, type ChoixHubspotEcrit } from '../../src/settings/store.pg';
import { PgContactStore } from '../../src/crm/contact-store.pg';

/**
 * LA LIGNE « AUTOMATIONS HUBSPOT » (lot 3a du 2026-11-02, migration 0270), contre une VRAIE base.
 *
 * 🔴 CE QU'AUCUN TEST UNITAIRE NE VOIT : que `poserChoixHubspot` écrive et relise la colonne sans toucher ses voisines,
 * que la REPRISE allume exactement les espaces qui ont une automation « deal » (active ou non), et qu'une ligne de
 * réglages qu'elle CRÉE se lise comme l'absence de ligne pour tout le reste ; enfin l'écriture des champs importés hors
 * transaction (`ecrireChampsFiche`), filtrée par espace.
 *
 * ⚠️ LA REPRISE TOURNE DANS UNE TRANSACTION ANNULÉE : elle balaie toutes les automations de la base de la CI.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ancienne base de production. La CI monte
 * un Postgres jetable pour ça (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';
const MIGRATION = readFileSync(resolve(__dirname, '..', '..', 'db', 'migrations', '0270_hubspot_automations.sql'), 'utf8');

const CHOIX: ChoixHubspotEcrit = {
  analyse: false, passage: true, injoignable: true, reponse: false, modeles: false, workflows: true, automations: true, listes: false,
};

describe.skipIf(!url)('la ligne « Automations HubSpot » en base', () => {
  let pool: Pool;
  let store: PgTenantSettingsStore;
  let tenantId = '';
  let autreTenantId = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgTenantSettingsStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-hubspot-automations') returning id`)).rows[0]!.id;
    autreTenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-hubspot-automations-autre') returning id`)).rows[0]!.id;
  });

  afterAll(async () => {
    for (const t of [tenantId, autreTenantId]) if (t) await pool.query('delete from tenants where id = $1', [t]);
    await pool.end();
  });

  it('🔴 éteinte sans ligne de réglages ; `poserChoixHubspot` l’écrit, la relit, et ne touche pas ses voisines', async () => {
    expect((await store.lireChoixHubspot(tenantId)).automations).toBe(false);
    const pose = await store.poserChoixHubspot(tenantId, CHOIX);
    expect(pose.choix).toMatchObject({ automations: true, workflows: true, analyse: false });
    expect((await store.lireChoixHubspot(tenantId)).automations).toBe(true);
    await store.poserChoixHubspot(tenantId, { ...CHOIX, automations: false });
    const relu = await store.lireChoixHubspot(tenantId);
    expect(relu).toMatchObject({ automations: false, workflows: true, analyse: false });
    expect((await store.lireChoixHubspot(autreTenantId)).automations, 'isolation').toBe(false);
  });

  it('🔴 la reprise allume les espaces qui ont une automation « deal », active ou non, et eux seuls ; une ligne créée vaut l’absence de ligne', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const nouveau = async (nom: string) => (await client.query<{ id: string }>('insert into tenants (name) values ($1) returning id', [nom])).rows[0]!.id;
      const automation = async (t: string, kind: string, enabled: boolean) => {
        const wf = (await client.query<{ id: string }>(
          `insert into workflows (tenant_id, name, graph) values ($1, 'itest', '{"nodes":[],"edges":[]}'::jsonb) returning id`, [t],
        )).rows[0]!.id;
        await client.query(
          `insert into automations (tenant_id, name, enabled, trigger_kind, trigger_config, workflow_id) values ($1, 'itest', $2, $3, '{}'::jsonb, $4)`,
          [t, enabled, kind, wf],
        );
      };
      const sansLigne = await nouveau('itest-hsa-sans-ligne');
      const avecLigne = await nouveau('itest-hsa-avec-ligne');
      const autreDeclencheur = await nouveau('itest-hsa-mot-cle');
      const temoin = await nouveau('itest-hsa-temoin');
      await automation(sansLigne, 'hubspot_deal_stage', false);
      await automation(avecLigne, 'hubspot_deal_stage', true);
      await automation(avecLigne, 'hubspot_deal_stage', false);
      await automation(autreDeclencheur, 'keyword', true);
      // L'espace qui a DÉJÀ une ligne de réglages : la reprise ne doit bouger que la colonne.
      await client.query(
        'insert into tenant_settings (tenant_id, mba_enabled, hubspot_workflows, hubspot_analyse) values ($1, true, true, false)', [avecLigne],
      );

      await client.query(MIGRATION);

      const lire = async (t: string) => (await client.query<{ hubspot_automations: boolean; mba_enabled: boolean; hubspot_workflows: boolean; hubspot_analyse: boolean }>(
        'select hubspot_automations, mba_enabled, hubspot_workflows, hubspot_analyse from tenant_settings where tenant_id = $1', [t],
      )).rows[0];
      expect(await lire(sansLigne)).toEqual({ hubspot_automations: true, mba_enabled: false, hubspot_workflows: false, hubspot_analyse: true });
      expect(await lire(avecLigne)).toEqual({ hubspot_automations: true, mba_enabled: true, hubspot_workflows: true, hubspot_analyse: false });
      expect(await lire(autreDeclencheur), 'un autre déclencheur n’allume rien').toBeUndefined();
      expect(await lire(temoin)).toBeUndefined();

      // 🔴 La ligne CRÉÉE par la reprise se lit, pour tout le reste, exactement comme l'absence de ligne (le témoin).
      const dansLaTransaction = new PgTenantSettingsStore(client as unknown as Pool);
      expect(await dansLaTransaction.get(sansLigne)).toEqual(await dansLaTransaction.get(temoin));
      const { automations, ...reste } = await dansLaTransaction.lireChoixHubspot(sansLigne);
      expect(automations).toBe(true);
      const { automations: eteinte, ...resteTemoin } = await dansLaTransaction.lireChoixHubspot(temoin);
      expect(eteinte).toBe(false);
      expect(reste).toEqual(resteTemoin);

      // Rejouable : une seconde passe ne change rien.
      await client.query(MIGRATION);
      expect((await lire(sansLigne))?.hubspot_automations).toBe(true);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('🔴 `ecrireChampsFiche` hors transaction : retire puis pose, et jamais sur la fiche d’un autre espace', async () => {
    const contacts = new PgContactStore(pool);
    const fiche = await contacts.creerFicheApi(tenantId, { phoneE164: '+33600000969' });
    if (fiche === 'conflit') throw new Error('fiche attendue');
    await pool.query(`update contacts set fields = '{"hs_deal_montant":"1200","hs_contact_firstname":"Ancien","autre":"x"}'::jsonb where id = $1`, [fiche.id]);

    await contacts.ecrireChampsFiche(tenantId, fiche.id, { poser: { hs_contact_firstname: 'Claire' }, retirer: ['hs_deal_montant'] });
    const lire = async () => (await pool.query<{ fields: Record<string, string> }>('select fields from contacts where id = $1', [fiche.id])).rows[0]!.fields;
    expect(await lire()).toEqual({ hs_contact_firstname: 'Claire', autre: 'x' });

    // Le même identifiant sous un AUTRE espace : rien n'est écrit.
    await contacts.ecrireChampsFiche(autreTenantId, fiche.id, { poser: { hs_contact_firstname: 'Intrus' }, retirer: ['autre'] });
    expect(await lire()).toEqual({ hs_contact_firstname: 'Claire', autre: 'x' });
  });
});
