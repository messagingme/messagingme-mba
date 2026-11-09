import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgUserStore } from '../../src/user/store.pg';
import { PgUserAuthStore } from '../../src/auth/store';
import { PgMfaStore } from '../../src/auth/mfa-store.pg';
import { PgAuthTokenStore } from '../../src/auth/token-store.pg';
import { PgOauthStore } from '../../src/oauth/store.pg';
import { CLIENTS_OAUTH } from '../../src/oauth/clients';
import { nouveauJeton, PREFIXE_ACCES, PREFIXE_CODE, PREFIXE_RENOUVELLEMENT } from '../../src/oauth/jetons';

/**
 * 🔴 UNE INVITATION NE S'OUVRE QUE PAR SON LIEN (lot identité C, migration 0281), en base. Un compte créé par une
 * invitation porte un drapeau que seule `createPending` pose : tant qu'elle n'est pas acceptée, aucune lecture qui ouvre
 * un espace ne le voit (recherche par adresse, connexion, garde, OAuth), aucune lecture par identité ne le compte (second
 * facteur exigé, dernier admin), et l'acceptation se fait en une transaction qui ne laisse rien à moitié.
 *
 * ⚠️ Ne PAS le lancer en local : le `DATABASE_URL` du `.env` local pointe sur l'ancienne base de production. La CI monte
 * un Postgres jetable pour ça (job `integration`).
 */
const url = process.env.DATABASE_URL ?? '';
const JOUR = 24 * 60 * 60 * 1000;

describe.skipIf(!url)('les invitations en attente, en base', () => {
  let pool: Pool;
  let users: PgUserStore;
  let auth: PgUserAuthStore;
  let mfa: PgMfaStore;
  let jetons: PgAuthTokenStore;
  const suffixe = `${Date.now()}.${randomBytes(3).toString('hex')}`;
  const tenants: string[] = [];
  const emails = new Set<string>();
  const adresse = (nom: string): string => {
    const a = `invit.${nom}.${suffixe}@exemple.fr`;
    emails.add(a);
    return a;
  };

  /** Un espace et son admin, ouvert (inscription ou Google : jamais une invitation). */
  async function espace(nom: string, email: string, passwordHash: string | null = 'scrypt$aa$bb') {
    const r = await users.createTenantWithAdmin(nom, { email, name: null, passwordHash });
    tenants.push(r.tenantId);
    return r;
  }
  const drapeau = async (userId: string): Promise<boolean> =>
    (await pool.query<{ e: boolean }>('select invitation_en_attente as e from users where id = $1', [userId])).rows[0]!.e;
  const identite = async (email: string) =>
    (await pool.query<{ id: string; password_hash: string | null; sessions_depuis: Date | null; adresse_prouvee_le: Date | null; langue: string }>(
      'select id, password_hash, sessions_depuis, adresse_prouvee_le, langue from identities where lower(email) = lower($1)', [email],
    )).rows[0];

  beforeAll(() => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    users = new PgUserStore(pool);
    auth = new PgUserAuthStore(pool);
    mfa = new PgMfaStore(pool, randomBytes(32).toString('hex'));
    jetons = new PgAuthTokenStore(pool);
  });

  afterAll(async () => {
    for (const t of tenants) await pool.query('delete from tenants where id = $1', [t]);
    await pool.query('delete from identities where lower(email) = any($1::text[])', [[...emails].map((e) => e.toLowerCase())]);
    await pool.query('delete from inscriptions_attente where lower(email) = any($1::text[])', [[...emails].map((e) => e.toLowerCase())]);
    await pool.end();
  });

  it('🔴 une invitation en attente n’ouvre rien : ni la recherche par adresse, ni la connexion, ni la garde ; Équipe la montre en attente', async () => {
    const invitant = adresse('invitant1');
    const t = await espace('Espace de l’invitant', invitant);
    const v = adresse('victime1');
    const invite = await users.createPending(t.tenantId, v, 'admin', 'Victime', t.userId);
    expect(invite.pending).toBe(true);
    expect(await drapeau(invite.id)).toBe(true);
    expect((await users.list(t.tenantId)).find((m) => m.id === invite.id)?.pending).toBe(true);
    expect((await users.list(t.tenantId)).find((m) => m.id === t.userId)?.pending).toBe(false);
    expect(await users.getByEmail(v)).toEqual([]);
    expect(await auth.findIdentity(v)).toBeNull();
    expect(await users.getAuthState(invite.id)).toBeNull();
    expect(await users.getAuthState(t.userId)).not.toBeNull();
    expect(await users.apercuInvitation(invite.id)).toEqual({
      espace: 'Espace de l’invitant', adresse: v, invitant: { nom: null, adresse: invitant }, aUnMotDePasse: false,
    });
  });

  it('acceptée par un mot de passe choisi : posé avec son époque, drapeau levé, jeton consommé ; le second envoi ne trouve rien', async () => {
    const t = await espace('Espace T2', adresse('invitant2'));
    const v = adresse('victime2');
    const invite = await users.createPending(t.tenantId, v, 'agent', '', t.userId);
    const jeton = await jetons.create('invite', invite.id, JOUR);
    expect(await jetons.lire('invite', jeton)).toBe(invite.id);
    expect(await users.accepterInvitation(jeton, 'scrypt$v2$1')).toEqual({ statut: 'acceptee', userId: invite.id });
    const i = await identite(v);
    expect(i?.password_hash).toBe('scrypt$v2$1');
    expect(i?.sessions_depuis).toBeInstanceOf(Date);
    expect(await drapeau(invite.id)).toBe(false);
    expect((await users.getByEmail(v)).map((c) => c.tenantId)).toEqual([t.tenantId]);
    expect((await auth.findIdentity(v))?.comptes.map((c) => c.tenantId)).toEqual([t.tenantId]);
    expect(await users.getAuthState(invite.id)).not.toBeNull();
    expect(await jetons.lire('invite', jeton)).toBeNull();
    expect(await users.accepterInvitation(jeton, 'scrypt$v2$2')).toEqual({ statut: 'invalide' });
    expect((await identite(v))?.password_hash).toBe('scrypt$v2$1');
  });

  it('🔴 un mot de passe déjà posé n’est jamais écrasé : `mot_de_passe_existe`, rien d’écrit, le jeton reste valable', async () => {
    const t = await espace('Espace T3', adresse('invitant3'));
    const v = adresse('victime3');
    await espace('Espace à elle', v, 'scrypt$v3$propre');
    const avant = await identite(v);
    const invite = await users.createPending(t.tenantId, v, 'admin', '', t.userId);
    const jeton = await jetons.create('invite', invite.id, JOUR);
    expect(await users.accepterInvitation(jeton, 'scrypt$v3$autre')).toEqual({ statut: 'mot_de_passe_existe' });
    expect(await identite(v)).toEqual(avant);
    expect(await drapeau(invite.id)).toBe(true);
    expect(await jetons.lire('invite', jeton)).toBe(invite.id);
    // Le mot de passe ACTUEL, vérifié par la route, n'écrit rien : ni hash ni époque.
    expect(await users.accepterInvitation(jeton, null)).toEqual({ statut: 'acceptee', userId: invite.id });
    expect(await identite(v)).toEqual(avant);
    expect(await drapeau(invite.id)).toBe(false);
  });

  it('🔴 deux acceptations simultanées du même jeton : un seul gagnant, rien d’écrit pour l’autre', async () => {
    const t = await espace('Espace T4', adresse('invitant4'));
    const v = adresse('victime4');
    const invite = await users.createPending(t.tenantId, v, 'agent', '', t.userId);
    const jeton = await jetons.create('invite', invite.id, JOUR);
    const [a, b] = await Promise.all([users.accepterInvitation(jeton, 'scrypt$v4$a'), users.accepterInvitation(jeton, 'scrypt$v4$b')]);
    expect([a.statut, b.statut].sort()).toEqual(['acceptee', 'invalide']);
    const gagnant = a.statut === 'acceptee' ? 'scrypt$v4$a' : 'scrypt$v4$b';
    expect((await identite(v))?.password_hash).toBe(gagnant);
  });

  it('réinitialisation : une identité à mot de passe dont le seul compte est une invitation en attente reçoit son lien ; un compte ouvert passe d’abord', async () => {
    const t = await espace('Espace T5', adresse('invitant5'));
    const v = adresse('victime5');
    await pool.query('insert into identities (email, password_hash) values ($1, $2)', [v, 'scrypt$v5$ancien']);
    const invite = await users.createPending(t.tenantId, v, 'agent', '', t.userId);
    expect(await auth.findIdentity(v)).toBeNull();
    expect(await users.compteAReinitialiser(v)).toBe(invite.id);
    const ouvert = await espace('Espace à elle 5', v, 'scrypt$v5$ancien');
    expect(await users.compteAReinitialiser(v)).toBe(ouvert.userId);
    expect(await users.compteAReinitialiser(adresse('inconnue5'))).toBeNull();
  });

  it('🔴 rattachement au clic : une identité née d’une invitation reçoit le mot de passe et la preuve ; l’invitation reste en attente', async () => {
    const t = await espace('Espace T6', adresse('invitant6'));
    const v = adresse('victime6');
    const invite = await users.createPending(t.tenantId, v, 'admin', '', t.userId);
    const nee = await identite(v);
    expect(nee?.password_hash).toBeNull();
    // Née chez l'invitant, dans la langue par défaut.
    expect(nee?.langue).toBe('fr');
    const lien = await users.demanderInscription({ email: v, langue: 'en', offrePro: false, application: false, pubFbc: null, pubFbp: null }, JOUR);
    const r = await users.confirmerInscription(lien, { workspaceName: 'Espace de la victime', name: null, passwordHash: 'scrypt$v6$clic' });
    expect(r.statut).toBe('cree');
    if (r.statut !== 'cree') throw new Error('attendu : cree');
    tenants.push(r.tenantId);
    const apres = await identite(v);
    expect(apres?.id).toBe(nee?.id);
    expect(apres?.password_hash).toBe('scrypt$v6$clic');
    expect(apres?.adresse_prouvee_le).toBeInstanceOf(Date);
    // 🔴 Reprise au clic (aide à la connexion, lot 2b) : la langue de l'écran qui a demandé le lien.
    expect(apres?.langue).toBe('en');
    expect(await drapeau(invite.id)).toBe(true);
    expect((await users.getByEmail(v)).map((c) => c.tenantId)).toEqual([r.tenantId]);
    expect((await auth.findIdentity(v))?.comptes.map((c) => c.tenantId)).toEqual([r.tenantId]);
  });

  it('🔴 une identité qui a un compte ouvert (Google, sans mot de passe) ne se rattache pas au clic', async () => {
    const v = adresse('google7');
    const lien = await users.demanderInscription({ email: v, langue: 'fr', offrePro: false, application: false, pubFbc: null, pubFbp: null }, JOUR);
    await espace('Espace Google 7', v, null);
    expect(await users.confirmerInscription(lien, { workspaceName: 'Espace du clic', name: null, passwordHash: 'scrypt$v7$tiers' }))
      .toEqual({ statut: 'adresse_connue' });
    expect((await identite(v))?.password_hash).toBeNull();
  });

  it('🔴 dernier admin : une invitation d’admin en attente ne compte pas, le dernier vrai admin ne part pas', async () => {
    const t = await espace('Espace T8', adresse('invitant8'));
    const p = await users.createPending(t.tenantId, adresse('pending8'), 'admin', '', t.userId);
    expect(await users.deleteUser(t.tenantId, t.userId)).toBe('last_admin');
    expect(await users.setDisabled(t.tenantId, t.userId, true)).toBe('last_admin');
    expect(await users.setRole(t.tenantId, t.userId, 'agent')).toBe('last_admin');
    expect(await users.deleteUser(t.tenantId, p.id)).toBe('ok');
  });

  it('🔴 second facteur : une invitation en attente dans un espace qui l’exige n’oblige à rien ; acceptée, elle oblige', async () => {
    const t = await espace('Espace T9', adresse('invitant9'));
    expect(await users.setSecondFacteurAdmins(t.tenantId, true)).toBe(true);
    const v = adresse('victime9');
    const sienne = await espace('Espace à elle 9', v);
    const invite = await users.createPending(t.tenantId, v, 'admin', '', t.userId);
    expect((await mfa.lireParCompte(sienne.userId))?.obligatoire).toBe(false);
    const etat = await mfa.lireParCompte(sienne.userId);
    expect((await mfa.comptes(etat!.identityId)).map((c) => c.tenantId)).toEqual([sienne.tenantId]);
    const jeton = await jetons.create('invite', invite.id, JOUR);
    expect((await users.accepterInvitation(jeton, null)).statut).toBe('acceptee');
    expect((await mfa.lireParCompte(sienne.userId))?.obligatoire).toBe(true);
    expect((await mfa.comptes(etat!.identityId)).map((c) => c.tenantId).sort()).toEqual([sienne.tenantId, t.tenantId].sort());
  });

  it('🔴 le filet OAuth : une autorisation donnée à un compte en attente ne résout plus et ne se renouvelle plus', async () => {
    const oauth = new PgOauthStore(pool);
    const t = await espace('Espace T10', adresse('invitant10'));
    const invite = await users.createPending(t.tenantId, adresse('victime10'), 'admin', '', t.userId);
    const code = nouveauJeton(PREFIXE_CODE);
    const { autorisationId } = await oauth.creerAutorisation({
      tenantId: t.tenantId, userId: invite.id, clientId: CLIENTS_OAUTH[0]!.id, scopes: ['mcp:read', 'mcp:write'],
      resource: 'https://api.exemple.test/mcp',
      code: { empreinte: code.empreinte, challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', redirectUri: 'http://localhost:33418/callback' },
    });
    expect(await oauth.consommerCode(code.empreinte)).not.toBeNull();
    const acces = nouveauJeton(PREFIXE_ACCES);
    const refresh = nouveauJeton(PREFIXE_RENOUVELLEMENT);
    expect(await oauth.poserJetons(autorisationId, {
      acces: acces.empreinte, refresh: refresh.empreinte, accesExpireLe: new Date(Date.now() + 3600_000),
      refreshExpireLe: new Date(Date.now() + 30 * JOUR), refreshMaxLe: new Date(Date.now() + 90 * JOUR),
    })).toBe(true);
    expect((await oauth.resoudreAcces(acces.empreinte))?.valide).toBe(false);
    const neufs = { acces: nouveauJeton(PREFIXE_ACCES).empreinte, refresh: nouveauJeton(PREFIXE_RENOUVELLEMENT).empreinte,
      accesExpireLe: new Date(Date.now() + 3600_000), refreshExpireLe: new Date(Date.now() + 30 * JOUR) };
    expect(await oauth.renouveler(refresh.empreinte, CLIENTS_OAUTH[0]!.id, neufs)).toBe('inconnu');
    // Acceptée, la même autorisation revit : le filet ne tient qu'au drapeau.
    await pool.query('update users set invitation_en_attente = false where id = $1', [invite.id]);
    expect((await oauth.resoudreAcces(acces.empreinte))?.valide).toBe(true);
  });

  it('🔴 la reprise de la migration 0281 : le drapeau va aux seules invitations (un jeton reçu, ni connexion ni mot de passe)', async () => {
    const t = await espace('Espace T11', adresse('invitant11'));
    const ligne = async (email: string, passwordHash: string | null, connecte: boolean): Promise<string> =>
      (await pool.query<{ id: string }>(
        `insert into users (tenant_id, email, role, password_hash, last_login_at) values ($1, $2, 'agent', $3, $4) returning id`,
        [t.tenantId, email, passwordHash, connecte ? new Date() : null],
      )).rows[0]!.id;
    const ancienAvecMotDePasse = await ligne(adresse('ancien11'), 'scrypt$a$b', false);
    const googleConnecte = await ligne(adresse('google11'), null, true);
    // Le compte que sème `db/seed.ts` (son mot de passe est sur l'identité) et un compte Google dont la marque de
    // connexion a échoué : sans connexion ni mot de passe sur le compte, mais jamais invités. Ils restent ouverts.
    const seme = await ligne(adresse('seme11'), null, false);
    const googleNonMarque = await ligne(adresse('googlenm11'), null, false);
    const invitationDAvant = await ligne(adresse('avant11'), null, false);
    await jetons.create('invite', invitationDAvant, JOUR);
    // La reprise telle qu'elle est écrite dans la migration, bornée aux lignes du test (la base est partagée).
    const sql = readFileSync('db/migrations/0281_invitations_en_attente.sql', 'utf8');
    const reprise = /update users set invitation_en_attente = true[\s\S]*?;/.exec(sql)?.[0];
    expect(reprise).toBeDefined();
    const lignes = [ancienAvecMotDePasse, googleConnecte, seme, googleNonMarque, invitationDAvant];
    await pool.query(`${reprise!.replace(/;\s*$/, '')} and id = any($1::uuid[])`, [lignes]);
    expect(await drapeau(ancienAvecMotDePasse)).toBe(false);
    expect(await drapeau(googleConnecte)).toBe(false);
    expect(await drapeau(seme)).toBe(false);
    expect(await drapeau(googleNonMarque)).toBe(false);
    expect(await drapeau(invitationDAvant)).toBe(true);
  });

  it('une invitation révoquée ne s’accepte plus, et un compte en attente ne reçoit jamais de marque de connexion', async () => {
    const t = await espace('Espace T12', adresse('invitant12'));
    const invite = await users.createPending(t.tenantId, adresse('victime12'), 'agent', '', t.userId);
    const jeton = await jetons.create('invite', invite.id, JOUR);
    await users.touchLastLogin(invite.id);
    expect((await pool.query('select last_login_at from users where id = $1', [invite.id])).rows[0]?.last_login_at).toBeNull();
    expect(await users.setDisabled(t.tenantId, invite.id, true)).toBe('ok');
    expect(await users.apercuInvitation(invite.id)).toBeNull();
    expect(await users.accepterInvitation(jeton, 'scrypt$v12$1')).toEqual({ statut: 'invalide' });
    expect(await drapeau(invite.id)).toBe(true);
    // Rien n'est consommé : réactivée par son espace, l'invitation s'accepte de nouveau par le même lien.
    expect(await jetons.lire('invite', jeton)).toBe(invite.id);
    expect(await users.setDisabled(t.tenantId, invite.id, false)).toBe('ok');
    expect((await users.accepterInvitation(jeton, null)).statut).toBe('acceptee');
  });
});
