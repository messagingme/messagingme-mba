import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { AUTORISATION_REVOQUEE, PgOauthStore, verrouillerAutorisationVivante, type NouveauxJetons } from '../../src/oauth/store.pg';
import { PgApiKeyStore, type PlafondCles } from '../../src/auth/api-key-store.pg';
import { PgAdressesEvenementsStore } from '../../src/evenements/store.pg';
import { CLIENTS_OAUTH } from '../../src/oauth/clients';
import { sha256Hex } from '../../src/lib/signature';
import { nouveauJeton, PREFIXE_ACCES, PREFIXE_CODE, PREFIXE_RENOUVELLEMENT } from '../../src/oauth/jetons';

// Ne PAS lancer ce fichier en local : le DATABASE_URL du .env local pointe sur l'ancienne base de production
// (cf. CLAUDE.md du repo), et ce fichier crée puis supprime des espaces. La CI monte un Postgres jetable (job
// `integration`). `describe.skipIf(!url)` le rend inerte sans DATABASE_URL.
const url = process.env.DATABASE_URL ?? '';

/**
 * LOT D DE L'AUDIT (migration 0282) : ce qu'une application connectée crée, une clé d'API ou une adresse de webhook,
 * reste rattaché à son autorisation OAuth, et meurt quand un admin la révoque dans la console. Les autres fins de
 * l'autorisation (déconnexion par le client, jeton rejoué, fin de vie, purge) le laissent vivre (décision de Julien du
 * 2026-11-06), et l'application reste listée tant qu'une création vit.
 *
 * 🔴 POURQUOI EN INTÉGRATION. Le contrat tient dans le SQL et dans les verrous : la clé étrangère et son `set null`, la
 * révocation en une transaction, le `FOR SHARE` qui sérialise une création en vol avec la révocation, les index partiels,
 * la clause `tenant_id` qui isole deux clients. Un faux pool dirait oui à tout.
 */
describe.skipIf(!url)('créations d’une application connectée (Postgres réel)', () => {
  let pool: Pool;
  let oauth: PgOauthStore;
  let cles: PgApiKeyStore;
  let adresses: PgAdressesEvenementsStore;
  let tenantId: string;
  let autreTenantId: string;
  let adminId: string;
  let autreAdminId: string;

  const CLAUDE_CODE = CLIENTS_OAUTH[0]!.id;
  const PLAFOND: PlafondCles = { max: 10, horsDroit: 'mba:relais' };
  const SANS_LIMITE: PlafondCles = { max: null, horsDroit: 'mba:relais' };
  const DROITS = ['contacts:write', 'sends:create', 'conversations:read'];

  const creerCompte = async (tenant: string): Promise<string> =>
    (await pool.query<{ id: string }>(
      `insert into users (tenant_id, email, role) values ($1, $2, 'admin') returning id`,
      [tenant, `itest-creations-${randomUUID()}@exemple.test`],
    )).rows[0]!.id;

  const paire = (): NouveauxJetons => ({
    acces: nouveauJeton(PREFIXE_ACCES).empreinte, refresh: nouveauJeton(PREFIXE_RENOUVELLEMENT).empreinte,
    accesExpireLe: new Date(Date.now() + 3600_000), refreshExpireLe: new Date(Date.now() + 30 * 86_400_000),
  });

  /** Une autorisation vivante (code échangé, jetons posés), comme Claude Code en tient une. */
  const autoriser = async (o: { tenant?: string; user?: string; client?: string; declaree?: { nom: string; hote: string } } = {}) => {
    const code = nouveauJeton(PREFIXE_CODE);
    const { autorisationId } = await oauth.creerAutorisation({
      tenantId: o.tenant ?? tenantId, userId: o.user ?? adminId, clientId: o.client ?? CLAUDE_CODE,
      scopes: ['mcp:read', 'mcp:write'], resource: 'https://api.exemple.test/mcp',
      code: { empreinte: code.empreinte, challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', redirectUri: 'http://localhost:33418/callback' },
      ...(o.declaree ? { client: { nom: o.declaree.nom, marque: 'declaree' as const, hote: o.declaree.hote } } : {}),
    });
    expect(await oauth.consommerCode(code.empreinte)).not.toBeNull();
    const jetons = paire();
    expect(await oauth.poserJetons(autorisationId, { ...jetons, refreshMaxLe: new Date(Date.now() + 90 * 86_400_000) })).toBe(true);
    return { autorisationId, jetons };
  };

  /** Une clé créée sous une autorisation (ou par la console, `null`), avec son clair pour la relire comme `/v1`. */
  const cle = async (autorisationId: string | null, nom = `clé ${randomUUID().slice(0, 8)}`, tenant = tenantId) => {
    const r = await cles.creerSousPlafond(tenant, nom, DROITS, PLAFOND, autorisationId);
    if (r === null || r === AUTORISATION_REVOQUEE) throw new Error(`création refusée : ${String(r)}`);
    return { ...r, nom };
  };
  const vivante = async (key: string) => (await cles.findActiveByHash(sha256Hex(key))) !== null;

  const adresse = async (autorisationId: string | null, tenant = tenantId) => {
    const a = await adresses.creer(tenant, {
      url: `https://app.client.fr/hook/${randomUUID().slice(0, 8)}`, description: '', types: ['message.received'], secretChiffre: 'c',
    }, autorisationId);
    if (a === null) throw new Error('création d’adresse refusée');
    return a;
  };
  const active = async (id: string) => (await pool.query<{ active: boolean }>(`select active from adresses_evenements where id = $1`, [id])).rows[0]!.active;
  const lien = async (table: 'api_keys' | 'adresses_evenements', id: string) =>
    (await pool.query<{ l: string | null }>(`select oauth_autorisation_id as l from ${table} where id = $1`, [id])).rows[0]!.l;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    oauth = new PgOauthStore(pool);
    cles = new PgApiKeyStore(pool);
    adresses = new PgAdressesEvenementsStore(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-creations') returning id`)).rows[0]!.id;
    autreTenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-creations-autre') returning id`)).rows[0]!.id;
    adminId = await creerCompte(tenantId);
    autreAdminId = await creerCompte(autreTenantId);
  });

  afterAll(async () => {
    if (tenantId) await pool.query('delete from tenants where id = $1', [tenantId]);
    if (autreTenantId) await pool.query('delete from tenants where id = $1', [autreTenantId]);
    await pool.end();
  });

  it('🔴 la clé et l’adresse créées sous une autorisation lui sont rattachées, celles de la console non ; les listes le disent', async () => {
    const { autorisationId } = await autoriser();
    const parClaude = await cle(autorisationId, 'Mon application');
    const parConsole = await cle(null, 'Intégration');
    const w = await adresse(autorisationId);
    const wConsole = await adresse(null);
    expect(await lien('api_keys', parClaude.id)).toBe(autorisationId);
    expect(await lien('api_keys', parConsole.id)).toBeNull();
    expect(await lien('adresses_evenements', w.id)).toBe(autorisationId);
    expect(await lien('adresses_evenements', wConsole.id)).toBeNull();
    const liste = await cles.listByTenant(tenantId);
    expect(liste.find((k) => k.id === parClaude.id)?.application).toEqual({ nom: 'Claude Code', marque: 'epingle', hote: null });
    expect(liste.find((k) => k.id === parConsole.id)?.application).toBeNull();
    expect(w.application).toEqual({ nom: 'Claude Code', marque: 'epingle', hote: null });
    expect((await adresses.lire(tenantId, wConsole.id))?.application).toBeNull();
    // La liste des applications nomme ce que celle-ci a créé.
    const app = (await oauth.lister(tenantId)).find((a) => a.id === autorisationId);
    expect(app).toMatchObject({ connectee: true });
    expect(app?.creations.cles.map((k) => k.id)).toContain(parClaude.id);
    expect(app?.creations.adresses.map((a) => a.id)).toContain(w.id);
  });

  it('🔴 un client qui se déclare « Claude Code » reste déclaré dans la provenance', async () => {
    const { autorisationId } = await autoriser({ client: `mcl_${'a'.repeat(32)}`, declaree: { nom: 'Claude Code', hote: 'evil.example' } });
    const k = await cle(autorisationId);
    expect((await cles.listByTenant(tenantId)).find((x) => x.id === k.id)?.application)
      .toEqual({ nom: 'Claude Code', marque: 'declaree', hote: 'evil.example' });
  });

  it('🔴 l’offre sans limite (Entreprise) : la clé passe par la même transaction et reçoit son lien', async () => {
    const { autorisationId } = await autoriser();
    const r = await cles.creerSousPlafond(tenantId, 'sans limite', DROITS, SANS_LIMITE, autorisationId);
    if (r === null || r === AUTORISATION_REVOQUEE) throw new Error('refusée');
    expect(await lien('api_keys', r.id)).toBe(autorisationId);
    await oauth.revoquer(tenantId, autorisationId);
    expect(await vivante(r.key)).toBe(false);
  });

  it('🔴 révoquer par un admin coupe ce que l’application a créé, et seulement ça', async () => {
    const a = await autoriser();
    const b = await autoriser();
    const ailleurs = await autoriser({ tenant: autreTenantId, user: autreAdminId });
    const kA = await cle(a.autorisationId, 'A');
    const kB = await cle(b.autorisationId, 'B');
    const kConsole = await cle(null, 'console');
    const kAilleurs = await cle(ailleurs.autorisationId, 'ailleurs', autreTenantId);
    const wA = await adresse(a.autorisationId);
    const wConsole = await adresse(null);

    expect(await oauth.revoquer(tenantId, a.autorisationId)).toEqual({ cles: [{ id: kA.id, name: 'A' }], adresses: [{ id: wA.id, url: wA.url }] });
    expect(await vivante(kA.key)).toBe(false);
    expect(await active(wA.id)).toBe(false);
    for (const k of [kB, kConsole, kAilleurs]) expect(await vivante(k.key)).toBe(true);
    expect(await active(wConsole.id)).toBe(true);
    // 🔴 L'autorisation d'un autre espace ne se révoque pas d'ici : rien n'est touché chez lui.
    expect(await oauth.revoquer(tenantId, ailleurs.autorisationId)).toBeNull();
    expect(await vivante(kAilleurs.key)).toBe(true);
    // Déjà révoquée, plus rien à couper : 404 comme avant le lot.
    expect(await oauth.revoquer(tenantId, a.autorisationId)).toBeNull();
  });

  it('🔴 une création ou une réactivation sous une autorisation déjà révoquée est refusée et n’écrit rien', async () => {
    const { autorisationId } = await autoriser();
    const w = await adresse(autorisationId);
    await oauth.revoquer(tenantId, autorisationId);
    expect(await cles.creerSousPlafond(tenantId, 'après la révocation', DROITS, PLAFOND, autorisationId)).toBe(AUTORISATION_REVOQUEE);
    expect(await cles.creerSousPlafond(tenantId, 'après la révocation', DROITS, SANS_LIMITE, autorisationId)).toBe(AUTORISATION_REVOQUEE);
    const n = await pool.query(`select 1 from api_keys where tenant_id = $1 and name = 'après la révocation'`, [tenantId]);
    expect(n.rowCount).toBe(0);
    expect(await adresses.creer(tenantId, { url: 'https://app.client.fr/apres', description: '', types: ['message.received'], secretChiffre: 'c' }, autorisationId)).toBeNull();
    expect(await adresses.modifier(tenantId, w.id, { active: true }, autorisationId)).toBe(AUTORISATION_REVOQUEE);
    expect(await active(w.id)).toBe(false);
    // La console (aucune autorisation) peut la rallumer : c'est la décision d'un humain.
    expect(await adresses.modifier(tenantId, w.id, { active: true }, null)).toMatchObject({ active: true });
  });

  it('🔴 la course : une révocation qui arrive pendant une création attend sa fin, puis la coupe', async () => {
    const { autorisationId } = await autoriser();
    const client = await pool.connect();
    let revocation: Promise<unknown> | null = null;
    try {
      await client.query('begin');
      expect(await verrouillerAutorisationVivante(client, tenantId, autorisationId)).toBe(true);
      const key = `mba_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '').slice(0, 11)}`;
      const ins = await client.query<{ id: string }>(
        `insert into api_keys (tenant_id, key_hash, name, scopes, oauth_autorisation_id) values ($1, $2, 'en vol', $3, $4) returning id`,
        [tenantId, sha256Hex(key), DROITS, autorisationId],
      );
      revocation = oauth.revoquer(tenantId, autorisationId);
      // La révocation DOIT attendre le verrou de la création : sans le FOR SHARE, elle passerait avant la clé.
      let attend = false;
      for (let i = 0; i < 40 && !attend; i += 1) {
        const r = await pool.query(
          `select 1 from pg_stat_activity where wait_event_type = 'Lock' and state = 'active' and query like '%oauth_autorisations%for no key update%'`,
        );
        attend = (r.rowCount ?? 0) > 0;
        if (!attend) await new Promise((fin) => { setTimeout(fin, 50); });
      }
      expect(attend, 'la révocation devait attendre la création en vol').toBe(true);
      await client.query('commit');
      expect(await revocation).toEqual({ cles: [{ id: ins.rows[0]!.id, name: 'en vol' }], adresses: [] });
      expect(await vivante(key)).toBe(false);
    } finally {
      await client.query('rollback').catch(() => {});
      client.release();
      await revocation?.catch(() => {});
    }
  });

  it('🔴 déconnexion par le client et jeton rejoué : les créations vivent, l’application reste listée « déconnectée », la révocation par un admin les coupe', async () => {
    const parLeClient = await autoriser();
    const kClient = await cle(parLeClient.autorisationId);
    expect(await oauth.revoquerParJeton(parLeClient.jetons.acces)).toBe(true);
    expect(await vivante(kClient.key)).toBe(true);

    const rejouee = await autoriser();
    const wRejeu = await adresse(rejouee.autorisationId);
    expect(await oauth.renouveler(rejouee.jetons.refresh, CLAUDE_CODE, paire())).toBe('ok');
    expect(await oauth.renouveler(rejouee.jetons.refresh, CLAUDE_CODE, paire())).toBe('rejeu');
    expect(await active(wRejeu.id)).toBe(true);

    const liste = await oauth.lister(tenantId);
    expect(liste.find((a) => a.id === parLeClient.autorisationId)).toMatchObject({ connectee: false, creations: { cles: [{ id: kClient.id, name: kClient.nom }], adresses: [] } });
    expect(liste.find((a) => a.id === rejouee.autorisationId)).toMatchObject({ connectee: false });

    expect(await oauth.revoquer(tenantId, parLeClient.autorisationId)).toEqual({ cles: [{ id: kClient.id, name: kClient.nom }], adresses: [] });
    expect(await vivante(kClient.key)).toBe(false);
    // Plus rien de vivant : elle quitte la liste.
    expect((await oauth.lister(tenantId)).map((a) => a.id)).not.toContain(parLeClient.autorisationId);
  });

  it('🔴 la purge épargne une autorisation finie qui porte une création vivante, et remet à vide le lien des autres', async () => {
    const gardee = await autoriser();
    const kGardee = await cle(gardee.autorisationId);
    const effacee = await autoriser();
    const kEffacee = await cle(effacee.autorisationId);
    await cles.revoke(tenantId, kEffacee.id);
    await pool.query(`update oauth_autorisations set revoque_le = now() - interval '31 days' where id = any($1::uuid[])`, [[gardee.autorisationId, effacee.autorisationId]]);

    await oauth.purger();
    const existe = async (id: string) => ((await pool.query(`select 1 from oauth_autorisations where id = $1`, [id])).rowCount ?? 0) > 0;
    expect(await existe(gardee.autorisationId)).toBe(true);
    expect(await existe(effacee.autorisationId)).toBe(false);
    expect(await lien('api_keys', kEffacee.id)).toBeNull();
    expect(await vivante(kGardee.key)).toBe(true);
    expect((await cles.listByTenant(tenantId)).find((k) => k.id === kGardee.id)?.application).toMatchObject({ nom: 'Claude Code' });
  });
});
