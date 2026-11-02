import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerPieceQuestion, type PieceQuestionRouteDeps } from '../src/http/piece-question';
import { RateLimiter } from '../src/auth/rate-limit';
import { MediaExpire } from '../src/inbox/media-entrant';
import { MediaTropGros } from '../src/meta/media';

/**
 * LA ROUTE PUBLIQUE D'UNE PIÈCE REÇUE (`GET /f/:code`, spec du 2026-11-02), classe `code-url` : le jeton signé de
 * l'adresse autorise, et il n'ouvre qu'UNE pièce d'UN espace pendant quinze minutes. Elle sert souvent une pièce
 * d'identité : un jeton faux, échu ou d'un autre espace ne doit rien lire, rien servir, rien tracer, et ne doit pas
 * même dire lequel des trois il est.
 */
const BON = 'jeton-bon';
const AUTRE_ESPACE = 'jeton-autre-espace';
const message = (media: { expired: boolean } | null) => ({
  idInterne: '7f000000-0000-4000-8000-000000000001', conversationId: 'c1', id: 'wamid.P1',
  media: media === null ? null : { mimeType: 'image/jpeg', filename: 'carte.jpg', ...media },
});

function monter(over: Partial<PieceQuestionRouteDeps> = {}) {
  const lus: string[] = [];
  const traces: Array<[string, string]> = [];
  const deps: PieceQuestionRouteDeps = {
    lire: (jeton) => (jeton === BON ? { tenantId: 't1', metaMessageId: 'wamid.P1' }
      : jeton === AUTRE_ESPACE ? { tenantId: 't2', metaMessageId: 'wamid.P1' } : null),
    conversations: {
      // 🔴 Relu DANS l'espace du jeton : le message de t1 n'existe pas pour t2.
      message: async (t, id) => (t === 't1' && id === 'wamid.P1' ? message({ expired: false }) as never : null),
    },
    lireMediaMessage: async (t, id) => { lus.push(`${t}:${id}`); return { bytes: Buffer.from('JPEG-OCTETS'), mime: 'image/jpeg', nom: 'carte.jpg' }; },
    tracer: async (t, id) => { traces.push([t, id]); },
    limiteur: new RateLimiter(100, 60_000),
    ...over,
  };
  const app = Fastify();
  registerPieceQuestion(app, deps);
  return { app, lus, traces };
}

describe('GET /f/:code', () => {
  it('🔴 un lien valide sert les octets, sans cache partagé ni devinette de type, et laisse une trace', async () => {
    const { app, lus, traces } = monter();
    const res = await app.inject({ method: 'GET', url: `/f/${BON}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('JPEG-OCTETS');
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(lus).toEqual(['t1:7f000000-0000-4000-8000-000000000001']);
    expect(traces).toEqual([['t1', '7f000000-0000-4000-8000-000000000001']]);
    await app.close();
  });

  it('🔴 un jeton faux, échu, ou d’un autre espace : le même 404, rien lu, rien tracé, le jeton jamais renvoyé', async () => {
    const { app, lus, traces } = monter();
    const faux = await app.inject({ method: 'GET', url: '/f/jeton-faux-123' });
    const autre = await app.inject({ method: 'GET', url: `/f/${AUTRE_ESPACE}` });
    expect(faux.statusCode).toBe(404);
    expect(autre.statusCode).toBe(404);
    expect(autre.body).toBe(faux.body);
    expect(faux.json<{ code: string }>().code).toBe('lien_invalide');
    expect(faux.body).not.toContain('jeton-faux-123');
    expect(lus).toEqual([]);
    expect(traces).toEqual([]);
    await app.close();
  });

  it('un message sans fichier reçu : le même 404', async () => {
    const { app, lus } = monter({ conversations: { message: async () => message(null) as never } });
    const res = await app.inject({ method: 'GET', url: `/f/${BON}` });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ code: string }>().code).toBe('lien_invalide');
    expect(lus).toEqual([]);
    await app.close();
  });

  it('au-delà des 7 jours de Meta : 410, que l’âge se lise d’avance ou que Meta le dise', async () => {
    const vieux = monter({ conversations: { message: async () => message({ expired: true }) as never } });
    expect((await vieux.app.inject({ method: 'GET', url: `/f/${BON}` })).statusCode).toBe(410);
    expect(vieux.lus).toEqual([]);
    await vieux.app.close();

    const meta = monter({ lireMediaMessage: async () => { throw new MediaExpire(); } });
    const res = await meta.app.inject({ method: 'GET', url: `/f/${BON}` });
    expect(res.statusCode).toBe(410);
    expect(res.json<{ code: string }>().code).toBe('media_expired');
    expect(meta.traces).toEqual([]);
    await meta.app.close();
  });

  it('trop lourd, ou Meta en panne : 422, jamais 5xx (Cloudflare remplacerait le corps)', async () => {
    const lourd = monter({ lireMediaMessage: async () => { throw new MediaTropGros(30_000_000, 26_214_400); } });
    expect((await lourd.app.inject({ method: 'GET', url: `/f/${BON}` })).statusCode).toBe(422);
    await lourd.app.close();

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const panne = monter({ lireMediaMessage: async () => { throw new Error('Meta 500'); } });
    const res = await panne.app.inject({ method: 'GET', url: `/f/${BON}` });
    vi.restoreAllMocks();
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('media_unavailable');
    await panne.app.close();
  });

  it('une trace en échec n’empêche pas de servir le fichier', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = monter({ tracer: async () => { throw new Error('base indisponible'); } });
    const res = await app.inject({ method: 'GET', url: `/f/${BON}` });
    vi.restoreAllMocks();
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('au-delà du plafond d’une même pièce : 429, rien lu', async () => {
    const { app, lus } = monter({ limiteur: new RateLimiter(1, 60_000) });
    expect((await app.inject({ method: 'GET', url: `/f/${BON}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/f/${BON}` })).statusCode).toBe(429);
    expect(lus).toHaveLength(1);
    await app.close();
  });

  it('🔴 des jetons faux en rafale n’épuisent pas le plafond d’un lien valide (relecture du lot : req.ip est le proxy)', async () => {
    const { app } = monter({ limiteur: new RateLimiter(1, 60_000) });
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: 'GET', url: `/f/faux-${i}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/f/${BON}` })).statusCode).toBe(200);
    await app.close();
  });

  it('🔴 une panne de la base en relisant le message : 422, jamais 5xx, et le jeton n’entre dans aucun journal', async () => {
    const ecrit: string[] = [];
    const espion = (...a: unknown[]) => { ecrit.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, Object.getOwnPropertyNames(x ?? {})))).join(' ')); };
    vi.spyOn(console, 'error').mockImplementation(espion);
    vi.spyOn(console, 'log').mockImplementation(espion);
    vi.spyOn(process.stdout, 'write').mockImplementation((t: string | Uint8Array) => { ecrit.push(String(t)); return true; });
    const { app, lus } = monter({ conversations: { message: async () => { throw new Error('pool saturé'); } } });
    const res = await app.inject({ method: 'GET', url: `/f/${BON}` });
    vi.restoreAllMocks();
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('media_unavailable');
    expect(lus).toEqual([]);
    expect(ecrit.join('\n')).not.toContain(BON);
    await app.close();
  });
});
