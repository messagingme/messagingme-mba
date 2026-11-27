import { describe, it, expect } from 'vitest';
import { creerFournisseurJetons, MARGE_JETON_MS, PAUSE_APRES_REFUS_MS } from '../src/agent/jeton-oauth';
import type { SourceAppel } from '../src/agent/sources';
import type { AppelTransportConnecteur, ResultatTransportConnecteur, TransportConnecteurHttp } from '../src/agent/transport-connecteur-http';
import { preparerCreationSource, preparerPatchSource } from '../src/agent/source-configuration';

/** La connexion OAuth d'un connecteur (plan 2026-11-25) : le jeton se demande, se garde, se renouvelle. */

const source = (o: Partial<SourceAppel> = {}): SourceAppel => ({
  id: 's1', kind: 'http', baseUrl: 'https://api.exemple.com', authKind: 'oauth_password', authHeaderName: null,
  oauth: { tokenUrl: 'https://auth.exemple.com/token', clientId: 'api', username: 'demo', scope: 'openid' },
  authSecret: 'mot-de-passe', status: 'active', ...o,
});

function transport(reponses: ResultatTransportConnecteur[]): TransportConnecteurHttp & { appels: AppelTransportConnecteur[] } {
  const appels: AppelTransportConnecteur[] = [];
  return {
    appels,
    async executer(appel) { appels.push(appel); return reponses.shift() ?? { nature: 'reseau', dureeMs: 0 }; },
  };
}
const jeton = (j: string, expiresIn?: number): ResultatTransportConnecteur => ({
  nature: 'reponse', httpStatus: 200, dureeMs: 0,
  texte: JSON.stringify({ access_token: j, token_type: 'Bearer', ...(expiresIn === undefined ? {} : { expires_in: expiresIn }) }),
});

describe('le jeton OAuth d’un connecteur', () => {
  it('le demande par grant_type=password, en formulaire, à l’adresse du jeton, et le pose en Bearer', async () => {
    const t = transport([jeton('abc', 300)]);
    const r = await creerFournisseurJetons({ transport: t }).entetes(source());
    expect(r).toEqual({ ok: true, entetes: { accept: 'application/json', authorization: 'Bearer abc' } });
    expect(t.appels).toHaveLength(1);
    const a = t.appels[0]!;
    expect(a.url).toBe('https://auth.exemple.com/token');
    expect(a.methode).toBe('POST');
    expect(a.entetes['content-type']).toBe('application/x-www-form-urlencoded');
    const f = new URLSearchParams(String(a.corps ?? ''));
    expect(Object.fromEntries(f)).toEqual({ grant_type: 'password', client_id: 'api', username: 'demo', password: 'mot-de-passe', scope: 'openid' });
  });

  it('sans scope, n’en envoie pas', async () => {
    const t = transport([jeton('abc', 300)]);
    await creerFournisseurJetons({ transport: t }).entetes(source({ oauth: { tokenUrl: 'https://auth.exemple.com/token', clientId: 'api', username: 'demo', scope: '' } }));
    expect(new URLSearchParams(String(t.appels[0]!.corps ?? '')).has('scope')).toBe(false);
  });

  it('garde le jeton jusqu’à son échéance moins la marge, puis en redemande un', async () => {
    let maintenant = 1_000_000;
    const t = transport([jeton('j1', 300), jeton('j2', 300)]);
    const f = creerFournisseurJetons({ transport: t, maintenant: () => maintenant });
    expect(await f.entetes(source())).toMatchObject({ ok: true, entetes: { authorization: 'Bearer j1' } });
    maintenant += 300_000 - MARGE_JETON_MS - 1;
    expect(await f.entetes(source())).toMatchObject({ ok: true, entetes: { authorization: 'Bearer j1' } });
    expect(t.appels).toHaveLength(1);
    maintenant += 2;
    expect(await f.entetes(source())).toMatchObject({ ok: true, entetes: { authorization: 'Bearer j2' } });
    expect(t.appels).toHaveLength(2);
  });

  it('un mot de passe changé ne réutilise pas le jeton de l’ancien', async () => {
    const t = transport([jeton('j1', 300), jeton('j2', 300)]);
    const f = creerFournisseurJetons({ transport: t });
    await f.entetes(source());
    expect(await f.entetes(source({ authSecret: 'nouveau' }))).toMatchObject({ ok: true, entetes: { authorization: 'Bearer j2' } });
  });

  it('oublier (après un 401 de l’API) fait redemander un jeton', async () => {
    const t = transport([jeton('j1', 300), jeton('j2', 300)]);
    const f = creerFournisseurJetons({ transport: t });
    await f.entetes(source());
    f.oublier('s1');
    expect(await f.entetes(source())).toMatchObject({ ok: true, entetes: { authorization: 'Bearer j2' } });
  });

  it('cent appels simultanés ne demandent qu’un jeton', async () => {
    const t = transport([jeton('j1', 300)]);
    const f = creerFournisseurJetons({ transport: t });
    const rs = await Promise.all(Array.from({ length: 100 }, () => f.entetes(source())));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(t.appels).toHaveLength(1);
  });

  it.each([
    [{ nature: 'reponse', httpStatus: 401, texte: '{}', dureeMs: 0 }, 'auth'],
    [{ nature: 'reponse', httpStatus: 400, texte: '{"error":"invalid_grant"}', dureeMs: 0 }, 'auth'],
    [{ nature: 'reponse', httpStatus: 503, texte: '', dureeMs: 0 }, 'indispo'],
    [{ nature: 'reponse', httpStatus: 200, texte: 'pas du json', dureeMs: 0 }, 'illisible'],
    [{ nature: 'reponse', httpStatus: 200, texte: '{"access_token":"a\\r\\nX-Evil: 1"}', dureeMs: 0 }, 'illisible'],
    [{ nature: 'adresse_refusee', dureeMs: 0 }, 'interne'],
    [{ nature: 'reseau', dureeMs: 0 }, 'indispo'],
  ] as [ResultatTransportConnecteur, string][])('un refus du serveur d’autorisation (%o) rend « %s », sans jeton ni secret', async (rep, erreur) => {
    const r = await creerFournisseurJetons({ transport: transport([rep]) }).entetes(source());
    expect(r).toEqual({ ok: false, erreur });
    expect(JSON.stringify(r)).not.toContain('mot-de-passe');
  });

  it('🔴 un mot de passe refusé n’est pas redemandé pendant la pause (un Keycloak verrouillerait le compte)', async () => {
    let maintenant = 1_000_000;
    const t = transport([{ nature: 'reponse', httpStatus: 401, texte: '{}', dureeMs: 0 }, jeton('j1', 300), jeton('j2', 300)]);
    const f = creerFournisseurJetons({ transport: t, maintenant: () => maintenant });
    expect(await f.entetes(source())).toEqual({ ok: false, erreur: 'auth' });
    expect(await f.entetes(source())).toEqual({ ok: false, erreur: 'auth' });
    expect(t.appels).toHaveLength(1);
    // Un mot de passe corrigé à l'écran lève la pause aussitôt.
    expect(await f.entetes(source({ authSecret: 'corrige' }))).toMatchObject({ ok: true, entetes: { authorization: 'Bearer j1' } });
    maintenant += PAUSE_APRES_REFUS_MS + 1;
    expect(await f.entetes(source())).toMatchObject({ ok: true, entetes: { authorization: 'Bearer j2' } });
  });

  it('un échec n’est pas gardé : l’appel suivant redemande', async () => {
    const t = transport([{ nature: 'reseau', dureeMs: 0 }, jeton('j1', 300)]);
    const f = creerFournisseurJetons({ transport: t });
    expect((await f.entetes(source())).ok).toBe(false);
    expect(await f.entetes(source())).toMatchObject({ ok: true, entetes: { authorization: 'Bearer j1' } });
  });

  it('les autres modes ne demandent rien et gardent leurs en-têtes', async () => {
    const t = transport([]);
    const r = await creerFournisseurJetons({ transport: t }).entetes(source({ authKind: 'bearer', oauth: null, authSecret: 'cle' }));
    expect(r).toEqual({ ok: true, entetes: { accept: 'application/json', authorization: 'Bearer cle' } });
    expect(t.appels).toHaveLength(0);
  });
});

describe('la configuration d’une source OAuth', () => {
  const oauth = { tokenUrl: 'https://auth.exemple.com/token', clientId: 'api', username: 'demo', scope: '' };

  it('exige le mot de passe et la connexion complète, et une adresse de jeton publique en HTTPS', () => {
    expect(preparerCreationSource({ baseUrl: 'https://api.exemple.com', authKind: 'oauth_password', oauth, authSecret: 'x' }).ok).toBe(true);
    expect(preparerCreationSource({ baseUrl: 'https://api.exemple.com', authKind: 'oauth_password', oauth })).toMatchObject({ ok: false, motif: 'secret_requis' });
    expect(preparerCreationSource({ baseUrl: 'https://api.exemple.com', authKind: 'oauth_password', authSecret: 'x' })).toMatchObject({ ok: false, motif: 'oauth_requis' });
    for (const tokenUrl of ['http://auth.exemple.com/token', 'https://127.0.0.1/token', 'https://localhost/token']) {
      expect(preparerCreationSource({ baseUrl: 'https://api.exemple.com', authKind: 'oauth_password', oauth: { ...oauth, tokenUrl }, authSecret: 'x' }))
        .toMatchObject({ ok: false, motif: 'oauth_adresse_refusee' });
    }
  });

  it('passer vers ou depuis OAuth exige de ressaisir le secret (un mot de passe ne part jamais comme jeton)', () => {
    const bearer = { baseUrl: 'https://api.exemple.com', authKind: 'bearer' as const, authHeaderName: null, aAuthentification: true, oauth: null, status: 'active' as const };
    expect(preparerPatchSource(bearer, { authKind: 'oauth_password', oauth })).toMatchObject({ ok: false, motif: 'oauth_mot_de_passe_requis' });
    expect(preparerPatchSource(bearer, { authKind: 'oauth_password', oauth, authSecret: 'x' }).ok).toBe(true);
    const enOAuth = { ...bearer, authKind: 'oauth_password' as const, oauth };
    expect(preparerPatchSource(enOAuth, { authKind: 'bearer' })).toMatchObject({ ok: false, motif: 'oauth_mot_de_passe_requis' });
    expect(preparerPatchSource(enOAuth, { authKind: 'none' }).ok).toBe(true);
    // Rester en OAuth sans rien ressaisir garde la connexion existante.
    expect(preparerPatchSource(enOAuth, { label: 'x' } as never).ok).toBe(true);
  });
});

describe('le résolveur et la connexion OAuth', async () => {
  const { creerAppelConnecteur } = await import('../src/agent/resolvers/http');
  const REQUETE = {
    id: 'rq1', tenantId: 't1', sourceId: 's1', label: 'Analyser', methode: 'POST' as const, chemin: '/analyze',
    parametres: [], entetes: [], corps: { mode: 'aucun' as const }, variables: [], outputPaths: ['status'],
    valeursTest: {}, outils: 0, updatedAt: '2026-11-25T00:00:00.000Z',
  };
  function harnais(jetons: { entetes: () => Promise<unknown>; oublier: (id: string) => void }, statut = 200) {
    const appels: AppelTransportConnecteur[] = [];
    const appel = creerAppelConnecteur({
      sources: { pourAppel: async () => source(), marquerEpreuve: async () => {} },
      requetes: { parId: async () => REQUETE },
      fiche: { ficheDuContact: async () => null },
      jetons: jetons as never,
      transportHttp: { async executer(a) { appels.push(a); return { nature: 'reponse', httpStatus: statut, texte: '{"status":"ok"}', dureeMs: 0 }; } },
    });
    const jouer = () => appel({
      tenantId: 't1', waId: '33600000000', contact: null, requestId: 'rq1', maxBytes: 65536, args: {},
      signal: AbortSignal.timeout(5000), journal: null, fichiers: null, lecture: { nature: 'integre', champs: null },
    });
    return { appels, jouer };
  }

  it('pose le jeton sur l’appel', async () => {
    const h = harnais({ entetes: async () => ({ ok: true, entetes: { accept: 'application/json', authorization: 'Bearer abc' } }), oublier: () => {} });
    expect(await h.jouer()).toMatchObject({ contenu: { status: 'ok' } });
    expect(h.appels[0]!.entetes.authorization).toBe('Bearer abc');
  });

  it('🔴 sans jeton, aucun appel ne part vers le système du client', async () => {
    const h = harnais({ entetes: async () => ({ ok: false, erreur: 'auth' }), oublier: () => {} });
    expect(await h.jouer()).toMatchObject({ ok: false, erreur: 'jeton_auth' });
    expect(h.appels).toHaveLength(0);
  });

  it('un 401 de l’API fait oublier le jeton', async () => {
    const oublies: string[] = [];
    const h = harnais({ entetes: async () => ({ ok: true, entetes: { authorization: 'Bearer abc' } }), oublier: (id) => oublies.push(id) }, 401);
    expect(await h.jouer()).toMatchObject({ ok: false, erreur: 'auth' });
    expect(oublies).toEqual(['s1']);
  });
});
