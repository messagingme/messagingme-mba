import { describe, it, expect } from 'vitest';
import { jwtVerify } from 'jose';
import {
  arreterLesLignesEtLeursAttaches, attacherEtVerifier, creerAttacheLigne, relancerLesLignesEtLeursAttaches,
  type AttacheLigne,
} from '../src/credit-whatsapp/attache';
import { capturerJournal } from './journal';

/**
 * LA LIGNE DU PARTENAIRE ATTACHÉE PAR SON API (plan `2026-11-12-credit-whatsapp-attache-par-l-api.md`). Les réponses
 * simulées sont celles MESURÉES le 2026-11-12 sur le compte de test de l'essai 236 : vérifier rend
 * `{"ok":1,"data":{"wabaId","creditLineAdded"}}`, attacher `{"ok":1}` (aussi sur un compte déjà attaché), retirer
 * `{"ok":1}` puis `500 {"ok":0,"error":"Credit line is not attached to this WABA"}`, un compte inconnu une erreur Graph.
 */
const URL_API = 'https://ligne.exemple.test/credit-line';
const EMETTEUR = 'messaging-me';
// Fabriqué à l'exécution (aucune vraie clé ici, et gitleaks ne lit pas un littéral qui n'existe pas).
const SECRET = ['test', 'z'.repeat(44)].join('-');
const W = '1815162959535129';

interface Appel { url: string; method: string; corps: unknown; auth: string | null; signal: boolean }

/** Un faux réseau : chaque appel rend la réponse suivante (statut, corps), ou lève. */
function reseau(reponses: Array<{ statut: number; corps: unknown } | Error>) {
  const appels: Appel[] = [];
  const fetchFaux = (async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    appels.push({
      url, method: init.method ?? 'GET', corps: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      auth: headers.get('authorization'), signal: init.signal !== undefined,
    });
    const r = reponses.shift();
    if (r === undefined) throw new Error('aucune réponse prévue');
    if (r instanceof Error) throw r;
    return new Response(typeof r.corps === 'string' ? r.corps : JSON.stringify(r.corps), {
      status: r.statut, headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { appels, fetchFaux };
}

function client(reponses: Array<{ statut: number; corps: unknown } | Error>) {
  const r = reseau(reponses);
  return { ...r, a: creerAttacheLigne({ url: URL_API, emetteur: EMETTEUR, secret: SECRET }, { fetch: r.fetchFaux }) };
}

const PAS_ATTACHEE = { statut: 500, corps: { ok: 0, error: 'Credit line is not attached to this WABA' } };
const GRAPH_100 = {
  statut: 500,
  corps: { ok: 0, error: { error: { message: "Unsupported post request. Object with ID '123' does not exist", type: 'GraphMethodException', code: 100, error_subcode: 33 } } },
};

describe('le client de l’API du partenaire', () => {
  it('🔴 le jeton : HS256, notre émetteur, l’audience `whatsapp-cloud`, cinq minutes, signé du secret', async () => {
    const { a, appels } = client([{ statut: 200, corps: { ok: 1, data: { wabaId: W, creditLineAdded: true } } }]);
    await a.verifier(W);
    const jeton = (appels[0]?.auth ?? '').replace(/^Bearer /, '');
    const { payload, protectedHeader } = await jwtVerify(jeton, new TextEncoder().encode(SECRET), {
      algorithms: ['HS256'], issuer: EMETTEUR, audience: 'whatsapp-cloud',
    });
    expect(protectedHeader.alg).toBe('HS256');
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(300);
    // Un autre secret ne le vérifie pas.
    await expect(jwtVerify(jeton, new TextEncoder().encode(`${SECRET}x`))).rejects.toThrow();
  });

  it('vérifier : GET `?waba_id=`, et la réponse dit si la ligne est attachée', async () => {
    const oui = client([{ statut: 200, corps: { ok: 1, data: { wabaId: W, creditLineAdded: true } } }]);
    expect(await oui.a.verifier(W)).toBe(true);
    expect(oui.appels[0]).toMatchObject({ url: `${URL_API}?waba_id=${W}`, method: 'GET', corps: null, signal: true });
    const non = client([{ statut: 200, corps: { ok: 1, data: { wabaId: W, creditLineAdded: false } } }]);
    expect(await non.a.verifier(W)).toBe(false);
  });

  it('attacher : PUT `{wabaId}` ; un compte déjà attaché répond pareil', async () => {
    const { a, appels } = client([{ statut: 200, corps: { ok: 1 } }, { statut: 200, corps: { ok: 1 } }]);
    await a.attacher(W);
    await a.attacher(W);
    expect(appels.map((x) => [x.url, x.method, x.corps, x.signal])).toEqual([
      [URL_API, 'PUT', { wabaId: W }, true], [URL_API, 'PUT', { wabaId: W }, true],
    ]);
  });

  it('retirer : DELETE `{wabaId}` ; « plus rien à retirer » se lit comme déjà retirée, pas comme une panne', async () => {
    const { a, appels } = client([{ statut: 200, corps: { ok: 1 } }, PAS_ATTACHEE]);
    expect(await a.retirer(W)).toBe('retiree');
    expect(await a.retirer(W)).toBe('deja_absente');
    expect(appels.map((x) => [x.url, x.method, x.corps])).toEqual([[URL_API, 'DELETE', { wabaId: W }], [URL_API, 'DELETE', { wabaId: W }]]);
  });

  it('🔴 chaque panne lève avec sa cause, jamais un succès inventé', async () => {
    await expect(client([GRAPH_100]).a.attacher('123')).rejects.toThrow(/500.*Object with ID '123' does not exist/);
    await expect(client([{ statut: 200, corps: { ok: 0, error: 'refus' } }]).a.attacher(W)).rejects.toThrow(/refus/);
    await expect(client([{ statut: 200, corps: 'pas du JSON' }]).a.verifier(W)).rejects.toThrow(/illisible/);
    await expect(client([{ statut: 200, corps: { ok: 1, data: { wabaId: W } } }]).a.verifier(W)).rejects.toThrow(/illisible/);
    await expect(client([new Error('The operation was aborted due to timeout')]).a.retirer(W)).rejects.toThrow(/injoignable.*timeout/);
    // Une autre erreur que « plus rien à retirer » reste une panne.
    await expect(client([GRAPH_100]).a.retirer('123')).rejects.toThrow(/does not exist/);
  });
});

describe('attacher puis vérifier', () => {
  function faux(o: { attache?: Error; verifie?: boolean }): AttacheLigne & { gestes: string[] } {
    const gestes: string[] = [];
    return {
      gestes,
      attacher: async (w) => { gestes.push(`attacher:${w}`); if (o.attache) throw o.attache; },
      verifier: async (w) => { gestes.push(`verifier:${w}`); return o.verifie ?? true; },
      retirer: async (w) => { gestes.push(`retirer:${w}`); return 'retiree'; },
    };
  }

  it('🔴 la ligne n’est tenue pour attachée que vérifiée : une attache que la vérification dément lève', async () => {
    const ok = faux({});
    await attacherEtVerifier(ok, W);
    expect(ok.gestes).toEqual([`attacher:${W}`, `verifier:${W}`]);
    await expect(attacherEtVerifier(faux({ verifie: false }), W)).rejects.toThrow(/pas attachée/);
    const refusee = faux({ attache: new Error('HTTP 500 : refus') });
    await expect(attacherEtVerifier(refusee, W)).rejects.toThrow(/refus/);
    expect(refusee.gestes).toEqual([`attacher:${W}`]);
  });
});

describe('le cycle de l’option : la fin retire l’attache, la reprise la rattache', () => {
  type L = { phoneNumberId: string; wabaId: string | null; origine: 'ops' | 'option'; arreteeLe: string | null };
  const ARRETEE = '2026-11-12T10:00:00.000Z';
  function deps(o: { n?: number; lignes: L[]; attache?: AttacheLigne | null; panne?: string[] }) {
    const gestes: string[] = [];
    const alertes: string[] = [];
    const attache: AttacheLigne | null = o.attache === undefined ? {
      attacher: async (w) => { gestes.push(`attacher:${w}`); if ((o.panne ?? []).includes(w)) throw new Error(`HTTP 500 : panne ${w}`); },
      verifier: async (w) => { gestes.push(`verifier:${w}`); return true; },
      retirer: async (w) => { gestes.push(`retirer:${w}`); if ((o.panne ?? []).includes(w)) throw new Error(`HTTP 500 : panne ${w}`); return 'retiree'; },
    } : o.attache;
    return {
      gestes, alertes,
      d: {
        lignes: {
          arreterLesLignesDeLOption: async () => { gestes.push('arreter'); return o.n ?? 1; },
          relancerLesLignesDeLOption: async () => { gestes.push('relancer'); return o.n ?? 1; },
          lignesDeLEspace: async () => o.lignes.map((l) => ({ id: `l-${l.phoneNumberId}`, tenantId: 't1', depuis: ARRETEE, retireeLe: null, ...l })),
        },
        attache,
        alerter: async (texte: string) => { alertes.push(texte); },
      },
    };
  }

  it('🔴 la fin de l’option retire l’attache de chaque compte de l’option arrêté, et seulement de lui', async () => {
    const { d, gestes, alertes } = deps({ lignes: [
      { phoneNumberId: 'pn-1', wabaId: 'W1', origine: 'option', arreteeLe: ARRETEE },
      { phoneNumberId: 'pn-2', wabaId: 'W2', origine: 'ops', arreteeLe: null },
      { phoneNumberId: 'pn-3', wabaId: 'W3', origine: 'option', arreteeLe: null },
      { phoneNumberId: 'pn-4', wabaId: null, origine: 'option', arreteeLe: ARRETEE },
    ] });
    expect(await arreterLesLignesEtLeursAttaches(d, 't1')).toBe(1);
    expect(gestes).toEqual(['arreter', 'retirer:W1']);
    expect(alertes).toEqual([]);
  });

  it('🔴 un retrait en panne n’empêche pas l’arrêt : il alerte Julien, qui retire à la main (sinon nous payons sa consommation)', async () => {
    const { d, alertes } = deps({ lignes: [{ phoneNumberId: 'pn-1', wabaId: 'W1', origine: 'option', arreteeLe: ARRETEE }], panne: ['W1'] });
    const { resultat, lignes } = await capturerJournal(() => arreterLesLignesEtLeursAttaches(d, 't1'));
    expect(resultat).toBe(1);
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(/t1.*W1.*panne W1/);
    expect(lignes).toEqual([expect.objectContaining({ lvl: 'error', msg: 'ligne_partenaire_retrait_impossible', tenantId: 't1', wabaId: 'W1' })]);
  });

  it('la reprise rattache, vérifiée, chaque compte de l’option relancé ; une panne alerte', async () => {
    const { d, gestes, alertes } = deps({ lignes: [
      { phoneNumberId: 'pn-1', wabaId: 'W1', origine: 'option', arreteeLe: null },
      { phoneNumberId: 'pn-2', wabaId: 'W2', origine: 'option', arreteeLe: null },
      { phoneNumberId: 'pn-3', wabaId: 'W3', origine: 'ops', arreteeLe: null },
    ], panne: ['W2'], n: 2 });
    const { resultat } = await capturerJournal(() => relancerLesLignesEtLeursAttaches(d, 't1'));
    expect(resultat).toBe(2);
    expect(gestes).toEqual(['relancer', 'attacher:W1', 'verifier:W1', 'attacher:W2']);
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(/t1.*W2.*panne W2/);
  });

  it('rien d’arrêté, rien de relancé, ou l’attache non configurée : aucun appel au partenaire', async () => {
    const vide = deps({ n: 0, lignes: [{ phoneNumberId: 'pn-1', wabaId: 'W1', origine: 'option', arreteeLe: ARRETEE }] });
    expect(await arreterLesLignesEtLeursAttaches(vide.d, 't1')).toBe(0);
    expect(await relancerLesLignesEtLeursAttaches(vide.d, 't1')).toBe(0);
    expect(vide.gestes).toEqual(['arreter', 'relancer']);
    const sans = deps({ lignes: [{ phoneNumberId: 'pn-1', wabaId: 'W1', origine: 'option', arreteeLe: ARRETEE }], attache: null });
    expect(await arreterLesLignesEtLeursAttaches(sans.d, 't1')).toBe(1);
    expect(sans.gestes).toEqual(['arreter']);
  });
});
