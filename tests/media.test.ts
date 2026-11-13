import { describe, it, expect, beforeAll } from 'vitest';
import { MetaMediaClient, MediaUploadError } from '../src/meta/media';
import { MetaApiError } from '../src/meta/errors';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { FetchLike } from '../src/meta/templates';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import type { MediaRouteDeps } from '../src/http/media';

function makeFetch(responses: Array<{ ok: boolean; status: number; json: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fn: FetchLike = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return { ok: r.ok, status: r.status, json: async () => r.json } as Response;
  };
  return { fn, calls };
}

describe('MetaMediaClient.telechargerEntrant', () => {
  function fetchAvecBinaire(meta: { ok: boolean; status: number; json: unknown }, octets = Buffer.from([1, 2, 3])) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fn: FetchLike = async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) return { ok: meta.ok, status: meta.status, json: async () => meta.json } as Response;
      return { ok: true, status: 200, arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) } as Response;
    };
    return { fn, calls };
  }

  it('deux appels, le jeton en Bearer sur les DEUX, et le type du média', async () => {
    const { fn, calls } = fetchAvecBinaire({ ok: true, status: 200, json: { url: 'https://lookaside.fb.com/x', mime_type: 'audio/ogg', file_size: 3 } });
    const client = new MetaMediaClient('tok', '988', 'v25.0', fn);
    const r = await client.telechargerEntrant('MEDIA/1', 10);
    expect([...r.bytes]).toEqual([1, 2, 3]);
    expect(r.mime).toBe('audio/ogg');
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v25.0/MEDIA%2F1');
    expect(calls[0]!.init).toEqual({ headers: { authorization: 'Bearer tok' } });
    expect(calls[1]!.url).toBe('https://lookaside.fb.com/x');
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('première lecture refusée -> MetaApiError avec le statut et le code de Meta, sans second appel', async () => {
    const { fn, calls } = fetchAvecBinaire({ ok: false, status: 404, json: { error: { message: 'media introuvable', code: 100 } } });
    const client = new MetaMediaClient('tok', '988', 'v25.0', fn);
    const err = await client.telechargerEntrant('M1', 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect((err as MetaApiError).httpStatus).toBe(404);
    expect((err as MetaApiError).code).toBe(100);
    expect((err as MetaApiError).message).toBe('media introuvable');
    expect(calls).toHaveLength(1);
  });

  it('taille annoncée au-delà du plafond -> refus AVANT de télécharger', async () => {
    const { fn, calls } = fetchAvecBinaire({ ok: true, status: 200, json: { url: 'https://lookaside.fb.com/x', file_size: 11 } });
    const client = new MetaMediaClient('tok', '988', 'v25.0', fn);
    await expect(client.telechargerEntrant('M1', 10)).rejects.toThrow('media trop gros (11 octets, plafond 10)');
    expect(calls).toHaveLength(1);
  });
});

describe('MetaMediaClient.uploadImage', () => {
  it('2 appels (start /{appId}/uploads puis POST session) -> handle', async () => {
    const { fn, calls } = makeFetch([
      { ok: true, status: 200, json: { id: 'upload:SESSION' } },
      { ok: true, status: 200, json: { h: 'HANDLE_ABC' } },
    ]);
    const client = new MetaMediaClient('tok', '988', 'v25.0', fn);
    const handle = await client.uploadImage(Buffer.from([1, 2, 3, 4]), 'image/png');
    expect(handle).toBe('HANDLE_ABC');
    expect(calls[0]!.url).toContain('/988/uploads');
    expect(calls[0]!.url).toContain('file_length=4');
    expect(calls[0]!.url).toContain('file_type=image%2Fpng');
    expect(calls[1]!.url).toContain('/upload:SESSION');
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('OAuth tok');
  });

  it('start HTTP non-ok -> MetaApiError', async () => {
    const { fn } = makeFetch([{ ok: false, status: 400, json: { error: { message: 'x', code: 100 } } }]);
    const client = new MetaMediaClient('tok', '988', 'v25.0', fn);
    await expect(client.uploadImage(Buffer.from([1]), 'image/png')).rejects.toBeInstanceOf(MetaApiError);
  });

  it('upload sans handle -> MediaUploadError', async () => {
    const { fn } = makeFetch([
      { ok: true, status: 200, json: { id: 'upload:S' } },
      { ok: true, status: 200, json: {} },
    ]);
    const client = new MetaMediaClient('tok', '988', 'v25.0', fn);
    await expect(client.uploadImage(Buffer.from([1]), 'image/png')).rejects.toBeInstanceOf(MediaUploadError);
  });
});

// --- Route media ---
const SECRET = 'test-secret';
let adminTok = '';
let agentTok = '';
beforeAll(async () => {
  adminTok = await signSession({ userId: 'u1', tenantId: 't1', role: 'admin' }, SECRET);
  agentTok = await signSession({ userId: 'u2', tenantId: 't1', role: 'agent' }, SECRET);
});
const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
const h = (t: string) => ({ headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` } });
const PNG_DATAURL = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71]).toString('base64');

/** La médiathèque du faux : un code par espace. Un code d'un autre espace se lit comme un code inconnu (`lireDeLEspace`). */
const CODE_T1 = '01hgw2v8k4m6n8p0q2r4s6t8vx';
const CODE_T2 = '01hgw2v8k4m6n8p0q2r4s6t8vz';
const CODE_GIF = '01hgw2v8k4m6n8p0q2r4s6t8vy';
const CODE_FAUX_PDF = '01hgw2v8k4m6n8p0q2r4s6t8vw';
const MEDIATHEQUE: Record<string, Record<string, { bytes: Buffer; mime: string; nom: string | null }>> = {
  t1: {
    [CODE_T1]: { bytes: Buffer.from([137, 80, 78, 71, 1]), mime: 'image/png', nom: 'bandeau.png' },
    [CODE_GIF]: { bytes: Buffer.from('GIF89a'), mime: 'image/gif', nom: 'anime.gif' },
    [CODE_FAUX_PDF]: { bytes: Buffer.from('<html>'), mime: 'application/pdf', nom: 'faux.pdf' },
  },
  t2: { [CODE_T2]: { bytes: Buffer.from([137, 80, 78, 71, 2]), mime: 'image/png', nom: 'ailleurs.png' } },
};
const adresse = (code: string, ext = 'png') => `https://api.messagingme.app/m/${code}.${ext}`;

function app(over: Partial<MediaRouteDeps> = {}) {
  const cap: { bytes?: Buffer; mime?: string; lus: Array<[string, string]> } = { lus: [] };
  const deps: MediaRouteDeps = {
    uploadImage: async (bytes, mime) => { cap.bytes = bytes; cap.mime = mime; return 'HANDLE'; },
    lireMediatheque: async (tenant, code) => { cap.lus.push([tenant, code]); return MEDIATHEQUE[tenant]?.[code] ?? null; },
    ...over,
  };
  return { server: buildServer({ queue: new FakeQueue(), auth: { users: noUsers, secret: SECRET }, media: deps }), cap };
}

describe('route media', () => {
  it('POST admin -> 200 {handle}, décode le data URL', async () => {
    const { server, cap } = app();
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/media', ...h(adminTok), payload: { dataUrl: PNG_DATAURL } });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ handle: string }>().handle).toBe('HANDLE');
    expect(cap.mime).toBe('image/png');
    expect(cap.bytes?.length).toBe(4);
    await server.close();
  });

  it('🔴 POST d’un PDF (en-tête Document, lot B3b) -> 200 ; un faux PDF (signature absente) -> 400, rien n’est déposé', async () => {
    const { server, cap } = app();
    const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.7 devis témoin').toString('base64');
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/media', ...h(adminTok), payload: { dataUrl: pdf } });
    expect(res.statusCode).toBe(200);
    expect(cap.mime).toBe('application/pdf');
    const faux = app();
    const html = 'data:application/pdf;base64,' + Buffer.from('<html>pas un pdf</html>').toString('base64');
    const refus = await faux.server.inject({ method: 'POST', url: '/tenants/t1/media', ...h(adminTok), payload: { dataUrl: html } });
    expect(refus.statusCode).toBe(400);
    expect(refus.json<{ error: string }>().error).toBe('le fichier n’est pas un document PDF');
    expect(faux.cap.mime).toBeUndefined();
    await server.close();
    await faux.server.close();
  });

  it('POST agent -> 403', async () => {
    const { server } = app();
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/media', ...h(agentTok), payload: { dataUrl: PNG_DATAURL } });
    expect(res.statusCode).toBe(403);
    await server.close();
  });

  it('POST vidéo mp4 -> 200 {handle}, mime video/mp4', async () => {
    const { server, cap } = app();
    const mp4 = 'data:video/mp4;base64,' + Buffer.from([0, 0, 0, 24]).toString('base64');
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/media', ...h(adminTok), payload: { dataUrl: mp4 } });
    expect(res.statusCode).toBe(200);
    expect(cap.mime).toBe('video/mp4');
    await server.close();
  });

  it('POST dataUrl invalide (pas image/vidéo) -> 400', async () => {
    const { server } = app();
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/media', ...h(adminTok), payload: { dataUrl: 'data:text/plain;base64,QQ==' } });
    expect(res.statusCode).toBe(400);
    await server.close();
  });

  it('🔴 un en-tête choisi dans la médiathèque (2026-11-13) : lu dans l’espace de la session par son code, déposé chez Meta, avec son nom', async () => {
    const { server, cap } = app();
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/media', ...h(adminTok), payload: { mediatheque: adresse(CODE_T1), format: 'IMAGE' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ handle: 'HANDLE', nom: 'bandeau.png' });
    expect(cap.lus).toEqual([['t1', CODE_T1]]);
    expect(cap.mime).toBe('image/png');
    expect([...cap.bytes!]).toEqual([137, 80, 78, 71, 1]);
    await server.close();
  });

  it('🔴 le fichier d’un AUTRE espace est introuvable (404), et rien n’est déposé', async () => {
    const { server, cap } = app();
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/media', ...h(adminTok), payload: { mediatheque: adresse(CODE_T2), format: 'IMAGE' } });
    expect(res.statusCode).toBe(404);
    expect(cap.lus).toEqual([['t1', CODE_T2]]);
    expect(cap.mime).toBeUndefined();
    await server.close();
  });

  it('un fichier qui ne convient pas au format de l’en-tête, une adresse hors médiathèque, une saisie incomplète : 400, rien n’est déposé', async () => {
    const cas: Array<[Record<string, unknown>, RegExp]> = [
      [{ mediatheque: adresse(CODE_GIF, 'gif'), format: 'IMAGE' }, /une image JPEG ou PNG/],
      [{ mediatheque: adresse(CODE_T1), format: 'VIDEO' }, /une vidéo MP4/],
      [{ mediatheque: adresse(CODE_FAUX_PDF, 'pdf'), format: 'DOCUMENT' }, /n’est pas un document PDF/],
      [{ mediatheque: 'https://exemple.com/image.png', format: 'IMAGE' }, /pas celle d’un fichier de la médiathèque/],
      [{ mediatheque: adresse(CODE_T1) }, /format/],
      [{ mediatheque: adresse(CODE_T1), format: 'IMAGE', dataUrl: PNG_DATAURL }, /format/],
    ];
    for (const [payload, attendu] of cas) {
      const { server, cap } = app();
      const res = await server.inject({ method: 'POST', url: '/tenants/t1/media', ...h(adminTok), payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json<{ error: string }>().error, JSON.stringify(payload)).toMatch(attendu);
      expect(cap.mime, JSON.stringify(payload)).toBeUndefined();
      await server.close();
    }
  });

  it('POST sans dataUrl -> 400', async () => {
    const { server } = app();
    const res = await server.inject({ method: 'POST', url: '/tenants/t1/media', ...h(adminTok), payload: {} });
    expect(res.statusCode).toBe(400);
    await server.close();
  });
});
