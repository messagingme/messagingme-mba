import { describe, it, expect } from 'vitest';
import { jwtVerify } from 'jose';
import {
  arreterLesLignesEtLeursAttaches, attacherEtVerifier, CompteInconnuDuPartenaire, creerAttacheLigne, MoyenDePaiementEnPlace,
  relancerLesLignesEtLeursAttaches, retirerLAttacheSansLever, type AttacheLigne,
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
/** Le refus de l'attache de l'essai réel 258 (alerte du 2026-11-13) : Meta voit déjà un moyen de paiement. */
const MOYEN_EN_PLACE = {
  statut: 500,
  corps: { ok: 0, error: { error: { message: `(#100) WABA inputted (id ${W}) is already using a payment method`, type: 'OAuthException', code: 100 } } },
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

  it('🔴 un compte que le partenaire ne voit pas (Graph 100/33, mesuré le 2026-11-12) lève `CompteInconnuDuPartenaire`, une autre panne non', async () => {
    const leve = (p: Promise<unknown>): Promise<unknown> => p.then(() => null, (e: unknown) => e);
    for (const geste of ['attacher', 'verifier', 'retirer'] as const) {
      const err = await leve(client([GRAPH_100]).a[geste]('123'));
      expect(err, geste).toBeInstanceOf(CompteInconnuDuPartenaire);
      expect(String(err), geste).toMatch(/500.*does not exist/);
    }
    for (const corps of [
      { ok: 0, error: 'panne' },
      // Une autre erreur de Graph (un jeton refusé) reste une panne ordinaire : le partenaire peut la réparer.
      { ok: 0, error: { error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } } },
    ]) {
      const err = await leve(client([{ statut: 500, corps }]).a.retirer(W));
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(CompteInconnuDuPartenaire);
    }
  });

  it('🔴 un code de Graph absent ou d’un type inattendu ne fait pas perdre la cause du refus', async () => {
    for (const [nom, error, cause] of [
      // Zod 4 exige une clé `z.unknown()` : sans sous-code (la plupart des erreurs de Graph), le message se perdait.
      ['sans sous-code', { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 }, /HTTP 500 : Invalid OAuth access token/],
      ['sans code', { message: 'Service temporarily unavailable' }, /HTTP 500 : Service temporarily unavailable/],
      ['code en texte', { message: 'Object with ID ‘123’ does not exist', code: '100', error_subcode: null }, /HTTP 500 : Object with ID .123. does not exist/],
    ] as const) {
      const err = await client([{ statut: 500, corps: { ok: 0, error: { error } } }]).a.retirer('123').then(() => null, (e: unknown) => e);
      expect(String(err), nom).toMatch(cause);
      expect(err, nom).not.toBeInstanceOf(CompteInconnuDuPartenaire);
    }
  });

  it('🔴 un compte qui a déjà un moyen de paiement chez Meta (alerte du 2026-11-13) lève `MoyenDePaiementEnPlace`, avec sa cause', async () => {
    const leve = (p: Promise<unknown>): Promise<unknown> => p.then(() => null, (e: unknown) => e);
    const err = await leve(client([MOYEN_EN_PLACE]).a.attacher(W));
    expect(err).toBeInstanceOf(MoyenDePaiementEnPlace);
    expect(String(err)).toMatch(new RegExp(`HTTP 500 : \\(#100\\) WABA inputted \\(id ${W}\\) is already using a payment method`));
    // Le même refus en texte nu se reconnaît aussi ; un autre refus reste une panne ordinaire.
    const texte = await leve(client([{ statut: 500, corps: { ok: 0, error: 'WABA is already using a payment method' } }]).a.attacher(W));
    expect(texte).toBeInstanceOf(MoyenDePaiementEnPlace);
    for (const r of [GRAPH_100, { statut: 500, corps: { ok: 0, error: 'panne' } }]) {
      expect(await leve(client([r]).a.attacher(W))).not.toBeInstanceOf(MoyenDePaiementEnPlace);
    }
  });
});

describe('retirer l’attache sans lever', () => {
  function attache(issue: 'retiree' | 'deja_absente' | Error): AttacheLigne {
    return {
      attacher: async () => undefined,
      verifier: async () => true,
      retirer: async () => { if (issue instanceof Error) throw issue; return issue; },
    };
  }

  it('🔴 rend `true` quand le partenaire confirme (retirée, ou déjà absente), `false` sur une panne, qui alerte Julien', async () => {
    for (const issue of ['retiree', 'deja_absente'] as const) {
      const alertes: string[] = [];
      expect(await retirerLAttacheSansLever({ attache: attache(issue), alerter: async (t) => { alertes.push(t); } }, 't1', W, 'Essai'), issue).toBe(true);
      expect(alertes, issue).toEqual([]);
    }
    const alertes: string[] = [];
    const { resultat } = await capturerJournal(() => retirerLAttacheSansLever(
      { attache: attache(new Error('HTTP 500 : panne')), alerter: async (t) => { alertes.push(t); } }, 't1', W, 'Essai',
    ));
    expect(resultat).toBe(false);
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(new RegExp(`^Essai : espace t1.*${W}.*panne`));
    expect(await retirerLAttacheSansLever({ attache: null, alerter: async () => undefined }, 't1', W, 'Essai')).toBe(true);
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
    // Refusée, et la relecture dit qu'elle manque : la cause du refus remonte, rien d'autre n'est tenté.
    const refusee = faux({ attache: new Error('HTTP 500 : refus'), verifie: false });
    await expect(attacherEtVerifier(refusee, W)).rejects.toThrow(/refus/);
    expect(refusee.gestes).toEqual([`attacher:${W}`, `verifier:${W}`]);
  });

  /** Un partenaire dont chaque geste rend, dans l'ordre, la réponse suivante de sa liste (la dernière se répète). */
  function suite(o: { attacher: Array<Error | null>; verifier: Array<boolean | Error>; retirer?: 'retiree' | 'deja_absente' }) {
    const gestes: string[] = [];
    const prochain = <T>(l: T[]): T => (l.length > 1 ? (l.shift() as T) : (l[0] as T));
    const a: AttacheLigne = {
      attacher: async (w) => { gestes.push(`attacher:${w}`); const r = prochain(o.attacher); if (r !== null) throw r; },
      verifier: async (w) => { gestes.push(`verifier:${w}`); const r = prochain(o.verifier); if (r instanceof Error) throw r; return r; },
      retirer: async (w) => { gestes.push(`retirer:${w}`); return o.retirer ?? 'retiree'; },
    };
    return { a, gestes };
  }
  const moyen = (): MoyenDePaiementEnPlace => new MoyenDePaiementEnPlace(`HTTP 500 : (#100) WABA inputted (id ${W}) is already using a payment method`);

  it('🔴 une attache refusée ou coupée se relit avant de conclure : déjà là (attachée avant nous, ou par ce PUT malgré la panne), rien n’est retiré', async () => {
    for (const refus of [new Error('API du partenaire injoignable : timeout'), moyen()]) {
      const p = suite({ attacher: [refus], verifier: [true] });
      await attacherEtVerifier(p.a, W);
      expect(p.gestes, refus.message).toEqual([`attacher:${W}`, `verifier:${W}`]);
    }
  });

  it('🔴 la relecture en panne ne remplace pas la cause du refus', async () => {
    const p = suite({ attacher: [new Error('HTTP 500 : refus du partenaire')], verifier: [new Error('HTTP 502 : relecture en panne')] });
    await expect(attacherEtVerifier(p.a, W)).rejects.toThrow(/refus du partenaire/);
    expect(p.gestes).toEqual([`attacher:${W}`, `verifier:${W}`]);
  });

  it('🔴 Meta voit déjà un moyen de paiement que le partenaire ne tient pas pour sa ligne : retirée par son API, puis redemandée UNE fois, et vérifiée', async () => {
    const p = suite({ attacher: [moyen(), null], verifier: [false, true] });
    const { lignes } = await capturerJournal(() => attacherEtVerifier(p.a, W));
    expect(p.gestes).toEqual([`attacher:${W}`, `verifier:${W}`, `retirer:${W}`, `attacher:${W}`, `verifier:${W}`]);
    // Ce que le retrait a trouvé se journalise : il dit, la prochaine fois, si la ligne était déjà là ou non.
    expect(lignes).toEqual([expect.objectContaining({ lvl: 'warn', msg: 'ligne_partenaire_moyen_de_paiement_en_place', wabaId: W, retrait: 'retiree' })]);
  });

  it('🔴 un moyen de paiement qui reste (une carte, la ligne d’un autre fournisseur) : `MoyenDePaiementEnPlace` remonte après un seul nouvel essai', async () => {
    const p = suite({ attacher: [moyen()], verifier: [false], retirer: 'deja_absente' });
    const err = await capturerJournal(() => attacherEtVerifier(p.a, W)).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(MoyenDePaiementEnPlace);
    expect(p.gestes).toEqual([`attacher:${W}`, `verifier:${W}`, `retirer:${W}`, `attacher:${W}`]);
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
      // Un compte en panne n'est pas attaché : la relecture d'une attache refusée le dit (sinon le refus passerait pour fait).
      verifier: async (w) => { gestes.push(`verifier:${w}`); return !(o.panne ?? []).includes(w); },
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
    expect(gestes).toEqual(['relancer', 'attacher:W1', 'verifier:W1', 'attacher:W2', 'verifier:W2']);
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
