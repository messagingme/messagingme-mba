import { describe, it, expect, vi, afterEach } from 'vitest';
import { creerAppelHttpScenario, telechargerPieceParLien, DELAI_APPEL_PIECE_MS } from '../src/workflow/appel-http';
import { creerTransportConnecteurHttp } from '../src/agent/transport-connecteur-http';
import { construireCorps, assemblerAppel, porteUnFichier, type GabaritCorps } from '../src/agent/requete-http';
import { construireCible } from '../src/agent/http-cible';
import { materialiserFormulaire, lecteurDEssai } from '../src/agent/corps-formulaire';
import { creerResolveurHttp } from '../src/agent/resolvers/http';
import { FormData as FormDataUndici, fetch as fetchUndici } from 'undici';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * UNE PIÈCE PART EN FICHIER (plan 2026-11-25, essai Everial) : un corps « formulaire » dont une ligne `fichier` désigne
 * la pièce reçue par un bloc Question. Seul l'Appel API d'un scénario la lit, et seulement par le lien qu'il vient de
 * fabriquer.
 */

const formulaire = (champs: { cle: string; valeur: string; fichier: boolean }[]): GabaritCorps => ({ mode: 'formulaire', champs });

describe('le corps « formulaire »', () => {
  it('substitue les variables ligne par ligne, et une valeur ne fabrique jamais une autre partie', () => {
    const r = construireCorps(formulaire([
      { cle: 'file', valeur: '{{piece}}', fichier: true },
      { cle: 'note', valeur: 'de {{nom}}', fichier: false },
      { cle: '  ', valeur: 'ignorée', fichier: false },
    ]), { piece: 'https://api.messagingme.app/f/x', nom: 'a\r\nContent-Disposition: form-data; name="admin"' });
    expect(r).toEqual({ ok: true, corps: { nature: 'formulaire', champs: [
      { cle: 'file', valeur: 'https://api.messagingme.app/f/x', fichier: true },
      { cle: 'note', valeur: 'de a\r\nContent-Disposition: form-data; name="admin"', fichier: false },
    ] } });
  });

  it('une variable inconnue refuse, comme les autres modes', () => {
    expect(construireCorps(formulaire([{ cle: 'file', valeur: '{{piece}}', fichier: true }]), {})).toMatchObject({ ok: false });
  });

  it('ne pose pas de content-type : fetch écrit multipart et sa frontière', () => {
    const a = assemblerAppel({
      baseUrl: 'https://api.exemple.com', methode: 'POST', chemin: '/analyze', corps: formulaire([{ cle: 'a', valeur: 'b', fichier: false }]),
      valeurs: {}, construireCible,
    });
    expect(a.ok && a.entetes['content-type']).toBeUndefined();
  });

  it('porteUnFichier ne voit que les lignes fichier remplies', () => {
    expect(porteUnFichier(formulaire([{ cle: 'file', valeur: '', fichier: true }]))).toBe(true);
    expect(porteUnFichier(formulaire([{ cle: 'a', valeur: '', fichier: false }]))).toBe(false);
    expect(porteUnFichier({ mode: 'json', gabarit: '{}' })).toBe(false);
  });

  it('🔴 sans lecteur de pièces, une ligne fichier refuse : jamais le texte envoyé à la place du fichier', async () => {
    const r = await materialiserFormulaire({ nature: 'formulaire', champs: [{ cle: 'file', valeur: 'https://x/f/1', fichier: true }] }, null);
    expect(r).toMatchObject({ ok: false });
  });

  it('l’essai de la console envoie un petit fichier texte', async () => {
    const r = await materialiserFormulaire({ nature: 'formulaire', champs: [{ cle: 'file', valeur: 'essai', fichier: true }] }, lecteurDEssai);
    expect(r.ok).toBe(true);
    const f = r.ok ? r.formulaire.get('file') : null;
    expect(f instanceof Blob && f.type).toBe('text/plain');
  });
});

describe('l’agent IA ne lit jamais une pièce', () => {
  it('🔴 un outil dont la requête envoie une pièce refuse, sans appel réseau', async () => {
    let appels = 0;
    const resolveur = creerResolveurHttp({
      sources: { pourAppel: async () => ({ id: 's1', kind: 'http', baseUrl: 'https://api.exemple.com', authKind: 'none', authHeaderName: null, oauth: null, authSecret: null, status: 'active' }), marquerEpreuve: async () => {} },
      requetes: { parId: async () => ({
        id: 'rq1', tenantId: 't1', sourceId: 's1', label: 'Analyser', methode: 'POST', chemin: '/analyze',
        parametres: [], entetes: [], corps: formulaire([{ cle: 'file', valeur: 'x', fichier: true }]), variables: [],
        outputPaths: ['status'], valeursTest: {}, outils: 1, updatedAt: '2026-11-25T00:00:00.000Z',
      }) },
      fiche: { ficheDuContact: async () => null },
      transportHttp: creerTransportConnecteurHttp({ fetch: (async () => { appels += 1; return new Response('{}'); }) as unknown as typeof fetch, verifierResolution: async () => ({ ok: true }) }),
    });
    const r = await resolveur({
      outil: { requestId: 'rq1', maxBytes: 65536, nature: 'integre', outputPaths: ['status'] },
      args: {}, signal: AbortSignal.timeout(5000), ctx: { tenantId: 't1', waId: '336', contact: null },
    } as never);
    expect(r.ok).toBe(false);
    expect(appels).toBe(0);
  });
});

describe('l’Appel API d’un scénario envoie la pièce', () => {
  const MENTION = 'Pièce reçue le 25/11/2026 à 10 h 00 (photo)';
  const ESPACE = '11111111-2222-4333-8444-555555555555';
  function harnais(champs: Record<string, unknown>, ligneFichier = '{{piece}}') {
    const envois: { init: RequestInit }[] = [];
    const telecharges: string[] = [];
    const signaux: AbortSignal[] = [];
    const appel = creerAppelHttpScenario({
      sources: { pourAppel: async () => ({ id: 's1', kind: 'http', baseUrl: 'https://api.wizidee.test', authKind: 'none', authHeaderName: null, oauth: null, authSecret: null, status: 'active' }), marquerEpreuve: async () => {} },
      requetes: { parId: async () => ({
        id: 'req-1', tenantId: ESPACE, sourceId: 's1', label: 'Analyser', methode: 'POST', chemin: '/api/v1/analyze',
        parametres: [], entetes: [], corps: formulaire([{ cle: 'file', valeur: ligneFichier, fichier: true }]),
        variables: [{ nom: 'piece', type: 'string', origine: { type: 'champ', cle: 'piece_identite' } }],
        outputPaths: ['status'], valeursTest: {}, outils: 0, updatedAt: '2026-11-25T00:00:00.000Z',
      }) },
      fiche: { ficheDuContact: async () => null },
      projectionContact: async () => ({ nom: 'Jean', tags: [], champs }),
      typeDuChamp: async () => 'text',
      transportHttp: creerTransportConnecteurHttp({
        fetch: (async (_u: string, init: RequestInit) => { envois.push({ init }); return new Response('{"status":"ok"}'); }) as unknown as typeof fetch,
        verifierResolution: async () => ({ ok: true }),
      }),
      pieces: { liensPossibles: async () => [{ cle: 'piece_identite', metaMessageId: 'wamid.P1', mention: MENTION }] },
      secretPiece: 'p'.repeat(40),
      baseApi: 'https://api.messagingme.app',
      telechargerPiece: async (url: string, signal: AbortSignal) => { telecharges.push(url); signaux.push(signal); return { octets: new Uint8Array([0xff, 0xd8, 0xff]), mime: 'image/jpeg', nom: 'piece.jpg' }; },
    } as never);
    return { appel, envois, telecharges, signaux };
  }

  it('🔴 la pièce part en fichier, dans le champ file, et la réponse se range', async () => {
    const h = harnais({ piece_identite: MENTION });
    expect(await h.appel(ESPACE, '33600000001', 'req-1', 'statut')).toEqual({ ok: true, valeur: 'ok' });
    expect(h.telecharges).toHaveLength(1);
    expect(h.telecharges[0]!.startsWith('https://api.messagingme.app/f/')).toBe(true);
    const corps = h.envois[0]!.init.body;
    expect(corps instanceof FormDataUndici).toBe(true);
    const f = (corps as FormDataUndici).get('file');
    expect(f instanceof Blob && f.type).toBe('image/jpeg');
    expect(new Uint8Array(await (f as Blob).arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
  });

  it('🔴 un champ qui ne porte plus la pièce : rien ne se télécharge, rien ne part', async () => {
    const h = harnais({ piece_identite: 'autre chose' });
    expect((await h.appel(ESPACE, '33600000001', 'req-1', 'statut')).ok).toBe(false);
    expect(h.telecharges).toHaveLength(0);
    expect(h.envois).toHaveLength(0);
  });

  it('🔴 une ligne fichier qui vise une autre adresse que le lien fabriqué est refusée sans téléchargement', async () => {
    const h = harnais({ piece_identite: MENTION }, 'https://169.254.169.254/latest/meta-data');
    expect((await h.appel(ESPACE, '33600000001', 'req-1', 'statut')).ok).toBe(false);
    expect(h.telecharges).toHaveLength(0);
    expect(h.envois).toHaveLength(0);
  });

  it('le délai d’un appel qui envoie une pièce est de trente secondes', () => {
    expect(DELAI_APPEL_PIECE_MS).toBe(30_000);
  });
});

describe('le téléchargement d’une pièce par son lien', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const signal = () => AbortSignal.timeout(5000);

  it('rend les octets, le type et un nom à extension', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/pdf' } }));
    expect(await telechargerPieceParLien('https://api.messagingme.app/f/x', signal())).toEqual({ octets: Buffer.from([1, 2, 3]), mime: 'application/pdf', nom: 'piece.pdf' });
  });

  it.each([[410, 'expiré'], [404, 'HTTP 404'], [422, 'HTTP 422']])('un %i est un refus lisible', async (statut, mot) => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: statut }));
    const r = await telechargerPieceParLien('https://api.messagingme.app/f/x', signal());
    expect('refus' in r && r.refus).toContain(mot);
  });

  it('une pièce au-delà du plafond est refusée', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array(10), { status: 200 }));
    expect(await telechargerPieceParLien('https://api.messagingme.app/f/x', signal(), 5)).toEqual({ refus: 'la pièce est trop lourde' });
  });
});

describe('🔴 le formulaire part VRAIMENT en multipart par le fetch d’undici (relecture du lot)', () => {
  /** Le fetch de production (`fetchPublic`) est celui du paquet undici : il ne lit que SON FormData. */
  async function recu(corps: unknown): Promise<{ type: string; texte: string }> {
    const serveur = createServer((req, res) => {
      const morceaux: Buffer[] = [];
      req.on('data', (m: Buffer) => morceaux.push(m));
      req.on('end', () => { res.end(JSON.stringify({ type: req.headers['content-type'] ?? '', texte: Buffer.concat(morceaux).toString('latin1') })); });
    });
    await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
    try {
      const port = (serveur.address() as AddressInfo).port;
      const r = await fetchUndici(`http://127.0.0.1:${port}/`, { method: 'POST', body: corps as never });
      return await r.json() as { type: string; texte: string };
    } finally {
      serveur.close();
    }
  }

  it('le corps fabriqué par materialiserFormulaire arrive en multipart, fichier nommé et typé', async () => {
    const lecteur = async () => ({ octets: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mime: 'application/pdf', nom: 'piece.pdf' });
    const f = await materialiserFormulaire({ nature: 'formulaire', champs: [
      { cle: 'file', valeur: 'lien', fichier: true }, { cle: 'dbId', valeur: '42', fichier: false },
    ] }, lecteur);
    if (!f.ok) throw new Error(f.raison);
    const r = await recu(f.formulaire);
    expect(r.type).toMatch(/^multipart\/form-data; boundary=/);
    expect(r.texte).toContain('name="file"; filename="piece.pdf"');
    expect(r.texte).toContain('Content-Type: application/pdf');
    expect(r.texte).toContain('%PDF');
    expect(r.texte).toContain('name="dbId"');
    expect(r.texte).not.toContain('[object FormData]');
  });
});
