import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { hashPasswordSync } from '../src/auth/password';
import { MESSAGE_LIENS_DE_REINITIALISATION, type AuthRouteDeps } from '../src/auth/routes';
import { FILET_PAR_ADRESSE, MESSAGE_DEFI_REQUIS, MESSAGE_TROP_DE_TENTATIVES } from '../src/auth/tentatives';
import type { AuthUser, UserAuthStore } from '../src/auth/store';
import type { CompteurDebit } from '../src/db/debit';
import { CompteurDebitMemoire } from '../src/db/debit.memoire';
import { MfaEnMemoire, UtilisateursFaux, comptesDe } from './mfa';

/**
 * LE LOT E DE L'AUDIT DE SÉCURITÉ : la connexion par mot de passe comptait ses essais sur `req.ip::adresse`, et
 * `req.ip` est le frontal de Scaleway pour tout le monde. Dix mauvais mots de passe par minute, de n'importe où,
 * fermaient la connexion du titulaire. Ici, l'adresse réelle du client voyage dans `cf-connecting-ip`, comme en
 * production derrière Cloudflare, et `req.ip` reste le même pour toutes les requêtes (`app.inject`).
 */
const SECRET = 'test-secret-please-change';
const HASH = hashPasswordSync('bon-mot-de-passe');
// Un agent : la connexion rend la session, sans étape de second facteur.
const titulaire: AuthUser = { id: 'u1', tenantId: 't1', email: 'a@b.co', role: 'agent', passwordHash: HASH };

function serveur(extra: Partial<AuthRouteDeps> = {}, debit?: CompteurDebit) {
  const mfa = new MfaEnMemoire(comptesDe([titulaire]));
  const envois: string[] = [];
  const fauxUtilisateurs = new UtilisateursFaux([titulaire], mfa);
  let lectures = 0;
  // Compte les lectures d'identité : un essai refusé par les plafonds ne doit jamais aller jusqu'au mot de passe.
  const users: UserAuthStore = { findIdentity: async (email) => { lectures += 1; return fauxUtilisateurs.findIdentity(email); } };
  const deps: AuthRouteDeps = {
    users,
    secret: SECRET,
    mfa,
    comptes: {
      // Lève si on l'appelle : un 500 trahirait une inscription passée au travers du filet.
      createTenantWithAdmin: async () => { throw new Error('aucun espace ne doit naître ici'); },
      motDePasseDeLAdresse: async (email) => (email === 'a@b.co' ? HASH : undefined),
      compteAReinitialiser: async (email) => (email === 'a@b.co' ? 'u1' : null),
    },
    tokens: { create: async () => 'LIEN', consume: async () => null },
    sendEmail: async (e) => { envois.push(e.to); },
    appUrl: 'https://console.test',
    ...extra,
  };
  return { app: buildServer({ queue: new FakeQueue(), auth: deps, ...(debit ? { debit } : {}) }), envois, lectures: () => lectures };
}

const entete = (cf: string) => ({ 'content-type': 'application/json', 'cf-connecting-ip': cf });
const connexion = (app: FastifyInstance, cf: string, password: string, autres: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/auth/login', headers: entete(cf), payload: { email: 'a@b.co', password, ...autres } });
const inscription = (app: FastifyInstance, cf: string, corps: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/auth/signup', headers: entete(cf), payload: { email: 'a@b.co', ...corps } });
const BON = 'bon-mot-de-passe';
const MAUVAIS = 'mauvais-mdp-123';

describe('connexion par mot de passe : un tiers ne ferme plus la porte du titulaire', () => {
  it('🔴 dix échecs d’une source ne ferment pas la connexion du titulaire venu d’une autre adresse réelle', async () => {
    const { app } = serveur();
    for (let i = 0; i < 10; i++) expect((await connexion(app, '198.51.100.7', 'nope')).statusCode).toBe(401);
    expect((await connexion(app, '198.51.100.7', 'nope')).statusCode).toBe(429);
    const titulaireEntre = await connexion(app, '203.0.113.9', BON);
    expect(titulaireEntre.statusCode).toBe(200);
    expect(titulaireEntre.json()).toHaveProperty('token');
    await app.close();
  });

  it('🔴 le filet plein exige le défi, avec le bon mot de passe comme avec le mauvais, avant toute lecture ; le titulaire le passe', async () => {
    const turnstile = { verifier: vi.fn(async (jeton: string, _ip: string | null) => jeton === 'bon') };
    const { app, lectures } = serveur({ filetParAdresse: { max: 3, dureeMs: 600_000 }, turnstile });
    for (const cf of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) expect((await connexion(app, cf, 'nope')).statusCode).toBe(401);
    const avant = lectures();

    // Sans jeton : 403 `defi`, jamais 200 ni 401, quel que soit le mot de passe, et sans lire l'identité.
    for (const password of [BON, MAUVAIS]) {
      const r = await connexion(app, '203.0.113.9', password);
      expect(r.statusCode, password).toBe(403);
      expect(r.json(), password).toEqual({ error: MESSAGE_DEFI_REQUIS, code: 'defi' });
    }
    // L'entrée `/ops` : le défi, pas le refus d'une adresse hors de la liste.
    const ops = await connexion(app, '203.0.113.9', BON, { ops: true });
    expect(ops.statusCode).toBe(403);
    expect(ops.json()).toMatchObject({ code: 'defi' });
    expect(turnstile.verifier).not.toHaveBeenCalled();
    // Un jeton refusé : le défi encore, quel que soit le mot de passe.
    for (const password of [BON, MAUVAIS]) {
      expect((await connexion(app, '203.0.113.9', password, { turnstile: 'faux' })).json(), password).toMatchObject({ code: 'defi' });
    }
    expect(lectures(), 'aucun mot de passe essayé tant que le défi manque').toBe(avant);

    // Le jeton valable : le mot de passe décide de nouveau.
    expect((await connexion(app, '203.0.113.9', MAUVAIS, { turnstile: 'bon' })).statusCode).toBe(401);
    const avecJeton = await connexion(app, '203.0.113.9', BON, { turnstile: 'bon' });
    expect(avecJeton.statusCode).toBe(200);
    expect(avecJeton.json()).toHaveProperty('token');
    // Cloudflare reçoit l'adresse réelle du client, pas celle du frontal.
    expect(turnstile.verifier).toHaveBeenLastCalledWith('bon', '203.0.113.9');
    await app.close();
  });

  it('🔴 le filet décidé, câblé par défaut : trente essais, puis le défi pour le trente et unième, d’où qu’il vienne', async () => {
    expect(FILET_PAR_ADRESSE).toEqual({ max: 30, dureeMs: 600_000 });
    const turnstile = { verifier: vi.fn(async (jeton: string, _ip: string | null) => jeton === 'bon') };
    const { app } = serveur({ turnstile });
    for (const reseau of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
      for (let i = 0; i < 10; i++) expect((await connexion(app, reseau, 'nope')).statusCode).toBe(401);
    }
    const trenteEtUnieme = await connexion(app, '203.0.113.9', BON);
    expect(trenteEtUnieme.statusCode).toBe(403);
    expect(trenteEtUnieme.json()).toMatchObject({ code: 'defi' });
    await app.close();
    // Trente et une vérifications de mot de passe (scrypt) : les 5 s par défaut ne tiennent pas sous la charge d'une suite
    // entière (mesuré : 5 049 ms, la suite racine en parallèle).
  }, 30_000);

  it('sans clé secrète Turnstile, le filet plein refuse (429), même avec le bon mot de passe', async () => {
    const { app } = serveur({ filetParAdresse: { max: 2, dureeMs: 600_000 } });
    await connexion(app, '198.51.100.1', 'nope');
    await connexion(app, '198.51.100.2', 'nope');
    expect((await connexion(app, '203.0.113.9', BON, { turnstile: 'bon' })).statusCode).toBe(429);
    await app.close();
  });

  it('🔴 l’inscription d’une adresse connue compte dans le MÊME filet que la connexion, avant le mot de passe', async () => {
    const { app } = serveur({ filetParAdresse: { max: 2, dureeMs: 600_000 } });
    expect((await connexion(app, '198.51.100.1', 'nope')).statusCode).toBe(401);
    expect((await inscription(app, '198.51.100.2', { password: MAUVAIS, workspaceName: 'Espace' })).statusCode).toBe(409);
    // Le filet a ses deux essais : le suivant est refusé, par une route comme par l'autre, AVANT le mot de passe (un
    // mauvais mot de passe vérifié d'abord rendrait 409, un bon créerait l'espace).
    expect((await connexion(app, '198.51.100.3', BON)).statusCode).toBe(429);
    expect((await inscription(app, '198.51.100.4', { password: MAUVAIS, workspaceName: 'Espace' })).statusCode).toBe(429);
    expect((await inscription(app, '198.51.100.5', { password: BON, workspaceName: 'Espace' })).statusCode).toBe(429);
    await app.close();
  });

  it('🔴 l’inscription d’une adresse connue passe par le défi, et aucun espace ne naît sans lui', async () => {
    const turnstile = { verifier: vi.fn(async (jeton: string, _ip: string | null) => jeton === 'bon') };
    const { app } = serveur({ filetParAdresse: { max: 1, dureeMs: 600_000 }, turnstile });
    expect((await connexion(app, '198.51.100.1', 'nope')).statusCode).toBe(401);
    for (const password of [BON, MAUVAIS]) {
      const r = await inscription(app, '203.0.113.9', { password, workspaceName: 'Espace' });
      expect(r.statusCode, password).toBe(403);
      expect(r.json(), password).toMatchObject({ code: 'defi' });
    }
    // Le jeton valable rouvre le mot de passe : le mauvais est refusé comme avant (409).
    expect((await inscription(app, '203.0.113.9', { password: MAUVAIS, workspaceName: 'Espace', turnstile: 'bon' })).statusCode).toBe(409);
    await app.close();
  });

  it('🔴 l’inscription se freine par réseau du client : un tiers ne la ferme plus pour une adresse', async () => {
    const { app } = serveur();
    for (let i = 0; i < 10; i++) expect((await inscription(app, '198.51.100.7', {})).statusCode).toBe(409);
    expect((await inscription(app, '198.51.100.7', {})).statusCode).toBe(429);
    expect((await inscription(app, '203.0.113.9', {})).statusCode).toBe(409);
    await app.close();
  });

  it('deux adresses IPv6 du même /64 partagent leur plafond, un autre /64 non', async () => {
    const { app } = serveur({ loginRateLimit: { max: 2, windowMs: 60_000 } });
    expect((await connexion(app, '2001:db8:1:2::a', 'nope')).statusCode).toBe(401);
    expect((await connexion(app, '2001:db8:1:2::b', 'nope')).statusCode).toBe(401);
    expect((await connexion(app, '2001:db8:1:2::c', 'nope')).statusCode).toBe(429);
    expect((await connexion(app, '2001:db8:1:3::a', 'nope')).statusCode).toBe(401);
    await app.close();
  });
});

describe('mot de passe oublié : cinq liens par jour et par adresse', () => {
  const oublier = (app: FastifyInstance, cf: string, email = 'a@b.co') =>
    app.inject({ method: 'POST', url: '/auth/forgot-password', headers: entete(cf), payload: { email } });

  it('🔴 la sixième demande du jour est refusée d’où qu’elle vienne, et aucun sixième e-mail ne part', async () => {
    // L'horloge du compteur avance entre la cinquième et la sixième : une fenêtre d'une minute ou d'une heure serait rouverte.
    let maintenant = Date.UTC(2026, 10, 16, 8, 0, 0);
    const { app, envois } = serveur({}, new CompteurDebitMemoire(() => maintenant));
    for (let i = 1; i <= 5; i++) expect((await oublier(app, `198.51.100.${i}`)).statusCode).toBe(200);
    maintenant += 3 * 60 * 60_000;
    const sixieme = await oublier(app, '203.0.113.9');
    expect(sixieme.statusCode).toBe(429);
    expect(sixieme.json()).toEqual({ error: MESSAGE_LIENS_DE_REINITIALISATION });
    expect(Number(sixieme.headers['retry-after'])).toBeGreaterThan(3600);
    expect(envois).toEqual(['a@b.co', 'a@b.co', 'a@b.co', 'a@b.co', 'a@b.co']);
    // Une adresse inconnue suit le même seuil : le refus ne dit pas si le compte existe.
    for (let i = 1; i <= 5; i++) expect((await oublier(app, `198.51.100.${i}`, 'x@y.co')).statusCode).toBe(200);
    expect((await oublier(app, '203.0.113.9', 'x@y.co')).json()).toEqual({ error: MESSAGE_LIENS_DE_REINITIALISATION });
    await app.close();
  });

  it('🔴 un réseau qui balaie des adresses est freiné, et ses refus n’entament pas les liens du jour de la victime', async () => {
    const { app, envois } = serveur();
    for (let i = 0; i < 10; i++) expect((await oublier(app, '198.51.100.7', `robot${i}@y.co`)).statusCode).toBe(200);
    // Le onzième, pour la victime : refusé par le réseau, sans rien compter pour son adresse.
    const refus = await oublier(app, '198.51.100.7');
    expect(refus.statusCode).toBe(429);
    expect(refus.json()).toEqual({ error: MESSAGE_TROP_DE_TENTATIVES });
    expect(envois).toEqual([]);
    // La victime, d'un autre réseau, a toujours ses cinq liens du jour.
    for (let i = 1; i <= 5; i++) expect((await oublier(app, `203.0.113.${i}`)).statusCode).toBe(200);
    expect(envois).toHaveLength(5);
    await app.close();
  });
});
