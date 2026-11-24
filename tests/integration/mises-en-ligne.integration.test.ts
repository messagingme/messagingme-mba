import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgMisesEnLigne } from '../../src/mise-en-ligne/store.pg';
import type { ActionGardee } from '../../src/mise-en-ligne/mise-en-ligne';

const url = process.env.DATABASE_URL ?? '';

/**
 * LES MISES EN LIGNE EN BASE (lot 1 du CSM virtuel, B2, migration 0316). Ce que le cœur suppose du magasin, prouvé sur
 * le vrai Postgres : le clic est UNE requête conditionnelle (une seule acceptation, pas échue, sur la même empreinte) ;
 * le bail n'a qu'un porteur, se reprend à l'échéance, et son jeton garde chaque écriture ; les accès (l'admin qui a
 * cliqué, la personne et l'autorisation qui ont préparé) se relisent à la prise du bail ; les CHECK tiennent.
 */
describe.skipIf(!url)('les mises en ligne (Postgres)', () => {
  let pool: Pool;
  let tenantId = '';
  let autreTenant = '';
  let csm = '';
  let admin = '';
  let autorisation = '';
  const store = () => new PgMisesEnLigne(pool);
  const ACTIONS: ActionGardee[] = [{ type: 'repondeur', scenario: randomUUID(), nom: 'Qualification', delaiS: 86400 }];
  const proposer = (expireLe = new Date(Date.now() + 3_600_000)) => store().inserer(tenantId, {
    proposeePar: csm, autorisationId: autorisation, libelle: 'Activer sur WhatsApp',
    recapitulatif: ['Le scénario « Qualification » répond.'], actions: ACTIONS, empreinte: 'e1', expireLe,
  });
  const acceptee = async (): Promise<string> => {
    const { id } = await proposer();
    expect(await store().accepter(tenantId, id, admin, 'e1')).toBe('ok');
    return id;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    const espace = async (nom: string) => (await pool.query<{ id: string }>('insert into tenants (name) values ($1) returning id', [nom])).rows[0]!.id;
    tenantId = await espace('itest-mises-en-ligne');
    autreTenant = await espace('itest-mises-en-ligne-autre');
    const membre = async (role: string) => (await pool.query<{ id: string }>(
      'insert into users (tenant_id, email, role) values ($1, $2, $3) returning id', [tenantId, `itest-mel-${randomUUID()}@exemple.test`, role],
    )).rows[0]!.id;
    csm = await membre('admin');
    admin = await membre('admin');
    autorisation = (await pool.query<{ id: string }>(
      `insert into oauth_autorisations (tenant_id, user_id, client_id, scopes, resource) values ($1, $2, $3, $4, $5) returning id`,
      [tenantId, csm, 'https://claude.ai/itest-mel', ['mcp:write'], 'https://api.exemple.test/mcp'],
    )).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[tenantId, autreTenant]]);
    await pool.end();
  });

  it('🔴 le clic, en une requête : une seule acceptation, pas échue, sur la même empreinte, dans son espace', async () => {
    const { id } = await proposer();
    expect(await store().accepter(tenantId, id, admin, 'autre')).toBe('modifiee');
    expect(await store().accepter(autreTenant, id, admin, 'e1')).toBe('inconnue');
    expect(await store().lire(autreTenant, id)).toBeNull();
    const deux = await Promise.all([store().accepter(tenantId, id, admin, 'e1'), store().accepter(tenantId, id, admin, 'e1')]);
    expect([...deux].sort()).toEqual(['deja', 'ok']);
    expect(await store().lire(tenantId, id)).toMatchObject({ etat: 'acceptee', accepteePar: admin, expiree: false, enCours: false });

    const echue = await proposer(new Date(Date.now() - 1000));
    expect(await store().accepter(tenantId, echue.id, admin, 'e1')).toBe('expiree');
    expect(await store().lire(tenantId, echue.id)).toMatchObject({ etat: 'proposee', expiree: true });
  });

  it('🔴 le bail : un seul porteur, repris à l’échéance, et le jeton garde chaque écriture', async () => {
    const { id } = await proposer();
    expect(await store().reclamer(tenantId, id, randomUUID(), 120)).toBeNull();
    expect(await store().accepter(tenantId, id, admin, 'e1')).toBe('ok');
    const j1 = randomUUID();
    expect(await store().reclamer(tenantId, id, j1, 120)).toMatchObject({ accepteePar: admin, clicValide: true, accesValide: true, resultat: [] });
    expect(await store().reclamer(tenantId, id, randomUUID(), 120)).toBeNull();
    expect((await store().lire(tenantId, id))?.enCours).toBe(true);
    expect(await store().noterResultat(tenantId, id, randomUUID(), { ok: true, etat: 'branche' }, 120)).toBe(false);
    expect(await store().noterResultat(tenantId, id, j1, { ok: true, etat: 'branche' }, 120)).toBe(true);

    // Le bail échu : un autre le reprend avec ce qui est déjà fait, et l'ancien porteur ne peut plus rien conclure.
    await pool.query(`update mises_en_ligne set execution_bail = now() - interval '1 second' where id = $1`, [id]);
    const j2 = randomUUID();
    expect((await store().reclamer(tenantId, id, j2, 120))?.resultat).toEqual([{ ok: true, etat: 'branche' }]);
    expect(await store().terminer(tenantId, id, j1, 'faite')).toBe(false);
    expect(await store().terminer(tenantId, id, j2, 'faite')).toBe(true);
    expect(await store().lire(tenantId, id)).toMatchObject({ etat: 'faite', enCours: false });
    expect(await store().reclamer(tenantId, id, randomUUID(), 120)).toBeNull();
  });

  it('relâcher rend le bail tout de suite, sous son seul jeton', async () => {
    const id = await acceptee();
    const j = randomUUID();
    await store().reclamer(tenantId, id, j, 120);
    await store().relacher(tenantId, id, randomUUID());
    expect(await store().reclamer(tenantId, id, randomUUID(), 120)).toBeNull();
    await store().relacher(tenantId, id, j);
    expect(await store().reclamer(tenantId, id, randomUUID(), 120)).not.toBeNull();
  });

  it('🔴 les accès se relisent à la prise du bail : l’admin qui a cliqué, la personne et l’autorisation qui ont préparé', async () => {
    const id = await acceptee();
    const prendre = async () => {
      await pool.query('update mises_en_ligne set execution_jeton = null, execution_bail = null where id = $1', [id]);
      return store().reclamer(tenantId, id, randomUUID(), 120);
    };
    await pool.query('update users set disabled_at = now() where id = $1', [admin]);
    expect(await prendre()).toMatchObject({ clicValide: false, accesValide: true });
    await pool.query('update users set disabled_at = null, role = $2 where id = $1', [admin, 'agent']);
    expect(await prendre()).toMatchObject({ clicValide: false });
    await pool.query('update users set role = $2 where id = $1', [admin, 'admin']);
    expect(await prendre()).toMatchObject({ clicValide: true, accesValide: true });
    await pool.query('update oauth_autorisations set revoque_le = now() where id = $1', [autorisation]);
    expect(await prendre()).toMatchObject({ clicValide: true, accesValide: false });
    await pool.query('update oauth_autorisations set revoque_le = null where id = $1', [autorisation]);
    await pool.query('update users set disabled_at = now() where id = $1', [csm]);
    expect(await prendre()).toMatchObject({ accesValide: false });
    await pool.query('update users set disabled_at = null where id = $1', [csm]);
  });

  it('les CHECK, sous leur nom : un état connu, un clic complet hors proposée, de 1 à 10 actions', async () => {
    const { id } = await proposer();
    await expect(pool.query(`update mises_en_ligne set etat = 'acceptee' where id = $1`, [id]))
      .rejects.toMatchObject({ constraint: 'mises_en_ligne_clic_check' });
    // Un clic complet, pour que seul l'état viole un CHECK (Postgres nommerait sinon le premier des deux).
    await expect(pool.query(`update mises_en_ligne set etat = 'perdue', acceptee_par = $2, acceptee_le = now() where id = $1`, [id, admin]))
      .rejects.toMatchObject({ constraint: 'mises_en_ligne_etat_check' });
    await expect(pool.query(`update mises_en_ligne set actions = '[]'::jsonb where id = $1`, [id]))
      .rejects.toMatchObject({ constraint: 'mises_en_ligne_actions_check' });
  });

  it('la suppression de l’espace emporte ses mises en ligne', async () => {
    const t = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-mel-cascade') returning id`)).rows[0]!.id;
    const { id } = await store().inserer(t, {
      proposeePar: csm, autorisationId: null, libelle: 'Publier les modifications', recapitulatif: [], actions: ACTIONS,
      empreinte: 'e', expireLe: new Date(Date.now() + 1000),
    });
    await pool.query('delete from tenants where id = $1', [t]);
    expect((await pool.query('select 1 from mises_en_ligne where id = $1', [id])).rowCount).toBe(0);
  });
});
