import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import { hashPasswordSync, verifyPassword } from '../src/auth/password';
import { makeRequireOps, sessionAnterieure } from '../src/auth/middleware';
import type { AuthRouteDeps } from '../src/auth/routes';
import { MfaEnMemoire, UtilisateursFaux, comptesDe } from './mfa';
import { accesOps, ADRESSE_OPS } from './acces-ops';

/**
 * L'ÉPOQUE DES SESSIONS D'UNE IDENTITÉ (audit du 2026-11-04, `identities.sessions_depuis`, migration 0277).
 *
 * Une session est un JWT de 12 h : sans époque, celle d'un poste partagé ou d'un jeton volé restait valide après que son
 * titulaire avait réinitialisé ou changé son mot de passe pour reprendre la main. La garde refuse désormais toute session
 * émise AVANT le dernier changement d'identifiant de son identité, et celui qui vient de changer le sien reçoit une
 * session neuve.
 *
 * L'époque se compte à la seconde (`iat`) : une session de la même seconde passe. Les sessions « d'avant » sont donc
 * signées une minute plus tôt, pas à l'instant.
 */
const SECRET = 'secret-des-tests-de-l-epoque-des-sessions';
const ANCIEN = 'ancien-mot-de-passe';
const NOUVEAU = 'nouveau-mot-de-passe';
const USER = { id: 'u1', tenantId: 't1', email: 'admin@x.fr', role: 'admin', passwordHash: hashPasswordSync(ANCIEN) };
const json = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ ...json, authorization: `Bearer ${t}` });

async function sessionDIlYAUneMinute(): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() - 60_000);
  try {
    return await signSession({ userId: USER.id, tenantId: USER.tenantId, role: USER.role }, SECRET);
  } finally {
    vi.useRealTimers();
  }
}

/** Le faux magasin des comptes pose l'époque comme le vrai (`PgUserStore.setPassword`) : à chaque mot de passe écrit. */
function app() {
  const etat = { hash: USER.passwordHash, sessionsDepuis: null as Date | null };
  const mfa = new MfaEnMemoire(comptesDe([USER]));
  const deps: AuthRouteDeps = {
    users: new UtilisateursFaux([USER], mfa),
    secret: SECRET,
    mfa,
    getUserState: async () => ({ role: 'admin', disabled: false, tenantStatus: 'active', horsOffre: null, sessionsDepuis: etat.sessionsDepuis }),
    comptes: {
      getPasswordHash: async () => etat.hash,
      setPassword: async (_userId, hash) => { etat.hash = hash; etat.sessionsDepuis = new Date(); return true; },
    },
    tokens: { create: async () => 'RAW', consume: async (p, raw) => (p === 'reset' && raw === 'BON' ? USER.id : null) },
  };
  return { server: buildServer({ queue: new FakeQueue(), auth: deps }), etat };
}

describe('🔴 une session émise avant un changement de mot de passe est refusée', () => {
  it('la réinitialisation coupe la session d’avant', async () => {
    const { server } = app();
    const avant = await sessionDIlYAUneMinute();
    expect((await server.inject({ method: 'GET', url: '/auth/mfa/moi', headers: bearer(avant) })).statusCode).toBe(200);
    const reset = await server.inject({ method: 'POST', url: '/auth/reset-password', headers: json, payload: { token: 'BON', password: NOUVEAU } });
    expect(reset.statusCode).toBe(200);
    const apres = await server.inject({ method: 'GET', url: '/auth/mfa/moi', headers: bearer(avant) });
    expect(apres.statusCode).toBe(401);
    expect(apres.json()).toEqual({ error: 'session révoquée' });
    await server.close();
  });

  it('le changement coupe les autres sessions et rend une session neuve, acceptée', async () => {
    const { server, etat } = app();
    const autrePoste = await sessionDIlYAUneMinute();
    const courante = await sessionDIlYAUneMinute();
    const res = await server.inject({
      method: 'POST', url: '/auth/change-password', headers: bearer(courante),
      payload: { currentPassword: ANCIEN, newPassword: NOUVEAU },
    });
    expect(res.statusCode).toBe(200);
    expect(await verifyPassword(NOUVEAU, etat.hash)).toBe(true);
    const { token } = res.json<{ ok: boolean; token?: string }>();
    expect(typeof token).toBe('string');
    expect((await server.inject({ method: 'GET', url: '/auth/mfa/moi', headers: bearer(autrePoste) })).statusCode).toBe(401);
    expect((await server.inject({ method: 'GET', url: '/auth/mfa/moi', headers: bearer(courante) })).statusCode).toBe(401);
    expect((await server.inject({ method: 'GET', url: '/auth/mfa/moi', headers: bearer(token!) })).statusCode).toBe(200);
    await server.close();
  });

  it('sans époque (jamais de changement), rien n’est coupé', async () => {
    const { server } = app();
    const avant = await sessionDIlYAUneMinute();
    expect((await server.inject({ method: 'GET', url: '/auth/mfa/moi', headers: bearer(avant) })).statusCode).toBe(200);
    await server.close();
  });
});

describe('🔴 /ops : une session d’exploitation émise avant l’époque de son identité est refusée', () => {
  it('par la même garde, à chaque requête', async () => {
    const acces = accesOps({ auth: { secret: SECRET } });
    const serveur = buildServer({ queue: new FakeQueue(), auth: acces.auth });
    const jeton = await acces.jeton(serveur);
    await serveur.close();
    const app = Fastify();
    app.get('/ops/sonde', { preHandler: makeRequireOps({ secret: SECRET, mfa: acces.mfa, opsEmails: acces.liste }) }, async () => ({ ok: true }));
    expect((await app.inject({ method: 'GET', url: '/ops/sonde', headers: bearer(jeton) })).statusCode).toBe(200);
    // Une époque posée APRÈS l'émission de la session (ici dans une minute, pour ne pas dépendre de la seconde) : le mot
    // de passe de l'exploitant a changé, la session d'avant tombe.
    acces.mfa.poserEpoque(ADRESSE_OPS, new Date(Date.now() + 60_000));
    expect((await app.inject({ method: 'GET', url: '/ops/sonde', headers: bearer(jeton) })).statusCode).toBe(401);
    await app.close();
  });
});

describe('🔴 sessionAnterieure, aux bornes (jaune de la relecture du lot A)', () => {
  const epoque = new Date('2026-11-05T10:00:00.750Z');
  const seconde = Math.floor(epoque.getTime() / 1000);

  it('sans époque, rien ne tombe ; une session de la même seconde que l’époque passe, celle d’avant tombe', () => {
    expect(sessionAnterieure(undefined, null)).toBe(false);
    expect(sessionAnterieure(seconde - 1000, null)).toBe(false);
    expect(sessionAnterieure(seconde, epoque)).toBe(false);
    expect(sessionAnterieure(seconde + 1, epoque)).toBe(false);
    expect(sessionAnterieure(seconde - 1, epoque)).toBe(true);
  });

  it('🔴 un jeton sans iat tombe dès qu’une époque existe ; une époque qui n’est pas une date refuse', () => {
    expect(sessionAnterieure(undefined, epoque)).toBe(true);
    expect(sessionAnterieure(seconde + 10, '2026-11-05' as unknown as Date)).toBe(true);
    expect(sessionAnterieure(seconde + 10, undefined as unknown as Date)).toBe(true);
  });
});
