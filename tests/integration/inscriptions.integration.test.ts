import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { sha256Hex } from '../../src/lib/signature';
import { PgUserStore } from '../../src/user/store.pg';
import type { DemandeInscription } from '../../src/user/inscriptions';

/**
 * 🔴 LES DEMANDES D'INSCRIPTION, EN BASE (lot identité B, migration 0279). Une adresse inconnue ne crée rien avant le
 * clic ; au clic, l'identité naît PROUVÉE avec le mot de passe choisi au clic, en une transaction qui efface toutes les
 * demandes de l'adresse, et une adresse née entre-temps ne se rattache jamais.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ancienne base de production.
 */
const url = process.env.DATABASE_URL ?? '';
const JOUR = 24 * 60 * 60 * 1000;

describe.skipIf(!url)('les demandes d’inscription, en base', () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: url, ssl: pgSsl() }); });
  afterAll(async () => { await pool.end(); });

  const demande = (email: string, autre: Partial<DemandeInscription> = {}): DemandeInscription => ({
    email, langue: 'fr', offrePro: false, application: false, pubFbc: null, pubFbp: null, ...autre,
  });
  const nettoyer = async (email: string): Promise<void> => {
    await pool.query(
      `delete from tenants where id in (select tenant_id from users where lower(email) = lower($1))`,
      [email],
    );
    await pool.query('delete from identities where lower(email) = lower($1)', [email]);
    await pool.query('delete from inscriptions_attente where lower(email) = lower($1)', [email]);
  };
  const demandesDe = async (email: string): Promise<number> =>
    (await pool.query('select 1 from inscriptions_attente where lower(email) = lower($1)', [email])).rowCount ?? 0;

  it('🔴 rien avant le clic ; au clic, l’identité naît prouvée avec le mot de passe du clic, et le lien ne sert qu’une fois', async () => {
    const users = new PgUserStore(pool);
    const email = `insc.itest.${Date.now()}@exemple.fr`;
    try {
      const jeton = await users.demanderInscription(demande(email, { langue: 'en', offrePro: true, application: true, pubFbc: 'fb.1.1.abc' }), JOUR);
      // La base ne garde que le sha256 du jeton, et rien n'est créé avant le clic.
      const ligne = await pool.query('select jeton_hash from inscriptions_attente where lower(email) = lower($1)', [email]);
      expect(ligne.rows[0]?.jeton_hash).toBe(sha256Hex(jeton));
      expect((await pool.query('select 1 from identities where lower(email) = lower($1)', [email])).rowCount).toBe(0);
      expect((await pool.query('select 1 from users where lower(email) = lower($1)', [email])).rowCount).toBe(0);

      expect(await users.inscriptionVivante(jeton)).toBe(true);
      const r = await users.confirmerInscription(jeton, { workspaceName: 'Espace du clic', name: 'Titulaire', passwordHash: 'scrypt$clic$1' });
      expect(r).toMatchObject({ statut: 'cree', email, langue: 'en', offrePro: true, application: true, pubFbc: 'fb.1.1.abc', pubFbp: null });
      if (r.statut !== 'cree') throw new Error('attendu : cree');
      const identite = await pool.query<{ password_hash: string; adresse_prouvee_le: Date | null; langue: string }>(
        'select password_hash, adresse_prouvee_le, langue from identities where lower(email) = lower($1)', [email],
      );
      expect(identite.rows[0]?.password_hash).toBe('scrypt$clic$1');
      expect(identite.rows[0]?.adresse_prouvee_le).toBeInstanceOf(Date);
      // 🔴 La langue de l'écran qui a demandé le lien (aide à la connexion, lot 2b) : celle de ses e-mails.
      expect(identite.rows[0]?.langue).toBe('en');
      const compte = await pool.query<{ role: string; name: string; tenant_name: string }>(
        `select u.role, u.name, t.name as tenant_name from users u join tenants t on t.id = u.tenant_id where u.id = $1`, [r.userId],
      );
      expect(compte.rows[0]).toEqual({ role: 'admin', name: 'Titulaire', tenant_name: 'Espace du clic' });
      expect(await demandesDe(email)).toBe(0);
      expect(await users.inscriptionVivante(jeton)).toBe(false);
      // Le même lien, recliqué : il ne vaut plus, et aucun second espace ne naît.
      expect(await users.confirmerInscription(jeton, { workspaceName: 'Bis', name: null, passwordHash: 'scrypt$bis$2' })).toEqual({ statut: 'lien_invalide' });
      expect((await pool.query('select 1 from users where lower(email) = lower($1)', [email])).rowCount).toBe(1);
    } finally {
      await nettoyer(email);
    }
  });

  it('🔴 une adresse née entre la demande et le clic ne se rattache pas : rien n’est créé, la demande reste, l’identité est intacte', async () => {
    const users = new PgUserStore(pool);
    const email = `insc.nee.${Date.now()}@exemple.fr`;
    try {
      const jeton = await users.demanderInscription(demande(email), JOUR);
      // L'identité naît par une autre porte (Google : sans mot de passe) pendant que le lien attend.
      const google = await users.createTenantWithAdmin('Espace Google', { email, name: null, passwordHash: null });
      const avant = await pool.query('select password_hash, sessions_depuis from identities where lower(email) = lower($1)', [email]);
      expect(await users.confirmerInscription(jeton, { workspaceName: 'Espace du clic', name: null, passwordHash: 'scrypt$tiers$1' }))
        .toEqual({ statut: 'adresse_connue' });
      const apres = await pool.query('select password_hash, sessions_depuis from identities where lower(email) = lower($1)', [email]);
      expect(apres.rows).toEqual(avant.rows);
      expect((await pool.query('select tenant_id from users where lower(email) = lower($1)', [email])).rows).toEqual([{ tenant_id: google.tenantId }]);
      // Rouge si la suppression des demandes sortait de la transaction : l'échec l'aurait déjà faite.
      expect(await demandesDe(email)).toBe(1);
    } finally {
      await nettoyer(email);
    }
  });

  it('🔴 la langue de l’écran (aide à la connexion, lot 2b) : posée à la naissance de l’identité, jamais sur une identité qui existe', async () => {
    const users = new PgUserStore(pool);
    const email = `insc.langue.${Date.now()}@exemple.fr`;
    const langue = async (): Promise<string | undefined> =>
      (await pool.query<{ langue: string }>('select langue from identities where lower(email) = lower($1)', [email])).rows[0]?.langue;
    try {
      // L'entrée par Google d'un écran anglais.
      await users.createTenantWithAdmin('Espace anglais', { email, name: null, passwordHash: null, langue: 'en' });
      expect(await langue()).toBe('en');
      // Un second espace de la même adresse, depuis un écran français : l'identité garde sa langue (seul le choix de la
      // personne la change, dans « Mon compte »).
      await users.createTenantWithAdmin('Espace bis', { email, name: null, passwordHash: null, langue: 'fr' });
      expect(await langue()).toBe('en');
    } finally {
      await nettoyer(email);
    }
  });

  it('plusieurs liens vivants pour une adresse : le premier confirmé efface les autres', async () => {
    const users = new PgUserStore(pool);
    const email = `insc.plusieurs.${Date.now()}@exemple.fr`;
    try {
      const premier = await users.demanderInscription(demande(email), JOUR);
      const second = await users.demanderInscription(demande(email), JOUR);
      expect(await demandesDe(email)).toBe(2);
      expect((await users.confirmerInscription(second, { workspaceName: 'Espace', name: null, passwordHash: 'scrypt$s$1' })).statut).toBe('cree');
      expect(await users.confirmerInscription(premier, { workspaceName: 'Espace', name: null, passwordHash: 'scrypt$p$1' })).toEqual({ statut: 'lien_invalide' });
      expect(await demandesDe(email)).toBe(0);
    } finally {
      await nettoyer(email);
    }
  });

  it('🔴 deux liens de la même adresse cliqués en même temps : un espace, un refus propre, jamais un interblocage', async () => {
    const users = new PgUserStore(pool);
    const email = `insc.croises.${Date.now()}@exemple.fr`;
    try {
      const a = await users.demanderInscription(demande(email), JOUR);
      const b = await users.demanderInscription(demande(email), JOUR);
      const simultanes = await Promise.all([
        users.confirmerInscription(a, { workspaceName: 'A', name: null, passwordHash: 'scrypt$a$1' }),
        users.confirmerInscription(b, { workspaceName: 'B', name: null, passwordHash: 'scrypt$b$1' }),
      ]);
      expect(simultanes.map((r) => r.statut).sort()).toEqual(['cree', 'lien_invalide']);
      expect((await pool.query('select 1 from users where lower(email) = lower($1)', [email])).rowCount).toBe(1);
    } finally {
      await nettoyer(email);
    }
  });

  it('un lien échu ne confirme rien, et la purge n’efface que l’échu', async () => {
    const users = new PgUserStore(pool);
    const email = `insc.echu.${Date.now()}@exemple.fr`;
    try {
      const vivant = await users.demanderInscription(demande(email), JOUR);
      const echu = 'jeton-echu-' + Date.now();
      await pool.query(
        `insert into inscriptions_attente (jeton_hash, email, cree_le, expire_le)
         values ($1, $2, now() - interval '2 days', now() - interval '1 day')`,
        [sha256Hex(echu), email],
      );
      expect(await users.inscriptionVivante(echu)).toBe(false);
      expect(await users.confirmerInscription(echu, { workspaceName: 'Espace', name: null, passwordHash: 'scrypt$e$1' })).toEqual({ statut: 'lien_invalide' });
      expect(await users.purgerInscriptionsEchues()).toBeGreaterThanOrEqual(1);
      const restantes = await pool.query<{ jeton_hash: string }>('select jeton_hash from inscriptions_attente where lower(email) = lower($1)', [email]);
      expect(restantes.rows).toEqual([{ jeton_hash: sha256Hex(vivant) }]);
    } finally {
      await nettoyer(email);
    }
  });

  it('un lien qui n’est pas parti s’oublie', async () => {
    const users = new PgUserStore(pool);
    const email = `insc.oubli.${Date.now()}@exemple.fr`;
    try {
      const jeton = await users.demanderInscription(demande(email), JOUR);
      await users.oublierDemande(jeton);
      expect(await demandesDe(email)).toBe(0);
    } finally {
      await nettoyer(email);
    }
  });
});
