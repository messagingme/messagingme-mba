import { describe, it, expect } from 'vitest';
import { LIGNES_PAR_COMMANDE, lireDroitsDeLApp, lirePageCommandes } from '../src/shopify/commandes-lues';
import { API_VERSION_SHOPIFY } from '../src/shopify/connexion';
import { lignesDeCommande, telephoneDeCommande } from '../src/shopify/donnees';
import { detailsDeCommande } from '../src/shopify/attribution';

/**
 * UNE PAGE DES COMMANDES PAR L'API ADMIN GRAPHQL (segments Shopify enrichis, lot 5) : chaque commande payée reformée en
 * corps du webhook `orders/paid`, que le numéro, le montant et les lignes se lisent comme une commande reçue ; les autres
 * comptées à part. Les refus de Shopify se traduisent en trois causes : accès refusé, page trop lourde, panne passagère.
 */

const ACCES = { domaine: 'b.myshopify.com', jeton: 'jeton' };
const PARAMS = { depuis: new Date('2026-09-24T00:00:00Z'), apres: null, parPage: 10, delaiMs: 20_000 };

const noeud = (id: number, o: Record<string, unknown> = {}) => ({
  legacyResourceId: String(id), name: `#${id}`, processedAt: '2026-11-01T10:00:00Z', test: false, displayFinancialStatus: 'PAID',
  totalPriceSet: { shopMoney: { amount: '42.50', currencyCode: 'EUR' } },
  phone: null,
  shippingAddress: { phone: '06 12 34 56 78', countryCodeV2: 'FR' },
  billingAddress: null,
  customer: { legacyResourceId: '77', defaultPhoneNumber: { phoneNumber: '+33698765432' } },
  lineItems: {
    pageInfo: { hasNextPage: false },
    nodes: [{
      id: `gid://shopify/LineItem/${id}01`, title: 'Bougie', variantTitle: 'Rouge', sku: 'SKU-7', quantity: 2, isGiftCard: false,
      product: { legacyResourceId: '7' }, variant: { legacyResourceId: '8' },
    }],
  },
  ...o,
});
const reponse = (nodes: unknown[], o: { suivant?: string | null; cout?: unknown } = {}) => ({
  data: { orders: { pageInfo: { hasNextPage: o.suivant != null, endCursor: o.suivant ?? null }, nodes } },
  extensions: { cost: o.cout ?? { requestedQueryCost: 300, actualQueryCost: 42, throttleStatus: { currentlyAvailable: 1700, restoreRate: 100 } } },
});
const erreur = (code: string, message = code) => ({
  errors: [{ message, extensions: { code } }],
  extensions: { cost: { requestedQueryCost: 500, throttleStatus: { currentlyAvailable: 100, restoreRate: 50 } } },
});

/** Un faux `fetch` qui sert ces réponses dans l'ordre et garde les requêtes. */
function servir(...reponses: Array<{ statut?: number; corps: unknown } | Error>) {
  const requetes: Array<{ url: string; init: RequestInit; corps: { query: string; variables: Record<string, unknown> } }> = [];
  const attentes: number[] = [];
  const appeler = (async (url: string, init: RequestInit) => {
    requetes.push({ url, init, corps: JSON.parse(String(init.body)) });
    const r = reponses.shift();
    if (!r) throw new Error('plus de réponse');
    if (r instanceof Error) throw r;
    return new Response(typeof r.corps === 'string' ? r.corps : JSON.stringify(r.corps), { status: r.statut ?? 200 });
  }) as unknown as typeof fetch;
  const attendre = async (ms: number) => { attentes.push(ms); };
  return { appeler, attendre, requetes, attentes };
}

describe('la requête', () => {
  it('les commandes créées depuis le début de la fenêtre, de la plus ancienne, au curseur donné, avec le jeton de l’app', async () => {
    const s = servir({ corps: reponse([]) });
    await lirePageCommandes(ACCES, { ...PARAMS, apres: 'curseur-1', parPage: 5 }, s.appeler, s.attendre);
    const [r] = s.requetes;
    expect(r!.url).toBe(`https://b.myshopify.com/admin/api/${API_VERSION_SHOPIFY}/graphql.json`);
    expect(r!.init).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(new Headers(r!.init.headers).get('x-shopify-access-token')).toBe('jeton');
    expect(r!.corps.variables).toEqual({ n: 5, apres: 'curseur-1', q: 'created_at:>=2026-09-24' });
    expect(r!.corps.query).toMatch(/sortKey: CREATED_AT/);
    expect(r!.corps.query).toContain(`lineItems(first: ${LIGNES_PAR_COMMANDE})`);
  });
});

describe('les commandes rendues', () => {
  it('🔴 reformées en corps du webhook : le même numéro, le même montant, les mêmes lignes qu’une commande reçue', async () => {
    const s = servir({ corps: reponse([noeud(5001)], { suivant: 'c2' }) });
    const p = await lirePageCommandes(ACCES, PARAMS, s.appeler, s.attendre);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.suivant).toBe('c2');
    // Le coût compté par Shopify revient avec la page : le job le journalise pour régler la taille des pages.
    expect(p.cout).toEqual({ demande: 300, reel: 42 });
    const [c] = p.commandes;
    expect(c!.lignesTronquees).toBe(false);
    // L'identifiant numérique (celui du webhook) : un GID gardé ferait une seconde commande.
    expect(c!.corps).toMatchObject({ id: 5001, name: '#5001', customer: { id: 77, phone: '+33698765432' }, processed_at: '2026-11-01T10:00:00Z', test: false });
    // Le numéro de l'adresse d'expédition d'abord, lu avec son pays : comme le webhook.
    expect(telephoneDeCommande(c!.corps, null)).toBe('+33612345678');
    expect(detailsDeCommande(c!.corps, { devise: 'EUR' }, Date.now)).toMatchObject({ montant: '42.50', devise: 'EUR', payeeLe: new Date('2026-11-01T10:00:00Z') });
    expect(lignesDeCommande(c!.corps).lignes).toEqual([
      { ligneId: '500101', produitId: '7', varianteId: '8', sku: 'SKU-7', titre: 'Bougie', varianteTitre: 'Rouge', quantite: 2, carteCadeau: false },
    ]);
  });

  it('🔴 seules les commandes PAYÉES (payées, remboursées en tout ou partie) ; les autres et les illisibles sont comptées à part', async () => {
    const s = servir({
      corps: reponse([
        noeud(1), noeud(2, { displayFinancialStatus: 'PARTIALLY_REFUNDED' }), noeud(3, { displayFinancialStatus: 'REFUNDED' }),
        noeud(4, { displayFinancialStatus: 'PENDING' }), noeud(5, { displayFinancialStatus: 'VOIDED' }),
        noeud(6, { displayFinancialStatus: 'PARTIALLY_PAID' }), noeud(7, { displayFinancialStatus: 'AUTHORIZED' }),
        noeud(8, { legacyResourceId: 'gid://shopify/Order/8' }), { pas: 'une commande' },
      ]),
    });
    const p = await lirePageCommandes(ACCES, PARAMS, s.appeler, s.attendre);
    expect(p.ok && p.commandes.map((c) => c.corps.id)).toEqual([1, 2, 3]);
    expect(p.ok && p.ecartees).toBe(6);
    expect(p.ok && p.suivant).toBeNull();
  });

  it('une commande aux lignes plus nombreuses que la page le dit ; une ligne illisible s’écarte seule', async () => {
    const lignes = { pageInfo: { hasNextPage: true }, nodes: [{ id: 'pas-un-gid', title: 'X', quantity: 1 }, { id: 'gid://shopify/LineItem/9', title: 'Y', quantity: 'deux' }, { id: 'gid://shopify/LineItem/10', title: 'Z', quantity: 1 }] };
    const s = servir({ corps: reponse([noeud(1, { lineItems: lignes })]) });
    const p = await lirePageCommandes(ACCES, PARAMS, s.appeler, s.attendre);
    if (!p.ok) throw new Error(p.message);
    expect(p.commandes[0]!.lignesTronquees).toBe(true);
    // La ligne sans GID lisible n'a pas d'identifiant : `lignesDeCommande` l'écarte, comme une ligne de webhook sans id.
    expect(lignesDeCommande(p.commandes[0]!.corps).lignes.map((l) => l.ligneId)).toEqual(['10']);
  });
});

describe('les refus de Shopify', () => {
  it('🔴 le frein (THROTTLED) attend que le seau se recharge, puis relit', async () => {
    const s = servir({ corps: erreur('THROTTLED') }, { corps: reponse([noeud(1)]) });
    const p = await lirePageCommandes(ACCES, PARAMS, s.appeler, s.attendre);
    expect(p.ok).toBe(true);
    // 500 demandés, 100 disponibles, 50 par seconde : 8 secondes.
    expect(s.attentes).toEqual([8_000]);
    expect(s.requetes).toHaveLength(2);
  });

  it('un frein plus long que le délai, ou qui revient plus de cinq fois, rend une panne passagère', async () => {
    const long = servir({ corps: { ...erreur('THROTTLED'), extensions: { cost: { requestedQueryCost: 900, throttleStatus: { currentlyAvailable: 0, restoreRate: 10 } } } } });
    expect(await lirePageCommandes(ACCES, PARAMS, long.appeler, long.attendre)).toMatchObject({ ok: false, code: 'passager' });
    expect(long.attentes).toEqual([]);
    const tetu = servir(...Array.from({ length: 7 }, () => ({ corps: erreur('THROTTLED') })));
    expect(await lirePageCommandes(ACCES, PARAMS, tetu.appeler, tetu.attendre)).toMatchObject({ ok: false, code: 'passager' });
    expect(tetu.requetes).toHaveLength(6);
  });

  it('🔴 le délai borne l’appel ENTIER, attentes du frein comprises : la troisième attente dépasserait, la page rend une panne passagère', async () => {
    let t = 0;
    const s = servir(...Array.from({ length: 4 }, () => ({ corps: erreur('THROTTLED') })));
    const attendre = async (ms: number) => { s.attentes.push(ms); t += ms; };
    expect(await lirePageCommandes(ACCES, PARAMS, s.appeler, attendre, () => t)).toMatchObject({ ok: false, code: 'passager' });
    // 8 s, puis 8 s : 16 s ; une troisième finirait à 24 s, au-delà des 20 s de l'appel.
    expect(s.attentes).toEqual([8_000, 8_000]);
    expect(s.requetes).toHaveLength(3);
  });

  it('accès refusé : 401, 403, ou un champ refusé (ACCESS_DENIED)', async () => {
    for (const r of [{ statut: 401, corps: '' }, { statut: 403, corps: '' }, { corps: erreur('ACCESS_DENIED', 'Access denied for orders field.') }]) {
      const s = servir(r);
      expect(await lirePageCommandes(ACCES, PARAMS, s.appeler, s.attendre)).toMatchObject({ ok: false, code: 'acces_refuse' });
    }
  });

  it('🔴 un champ refusé se dit par le message de Shopify, jamais par une cause devinée (2026-11-24 : read_products, pas les données protégées)', async () => {
    const message = 'Access denied for product field. Required access: `read_products` access scope.';
    const s = servir({ corps: { ...reponse([noeud(1)]), ...erreur('ACCESS_DENIED', message) } });
    const p = await lirePageCommandes(ACCES, PARAMS, s.appeler, s.attendre);
    expect(p).toMatchObject({ ok: false, code: 'acces_refuse', message: expect.stringContaining(message) });
    expect(p.ok === false && p.message).not.toMatch(/données client protégées/);
  });

  it('page trop lourde : un 5xx, MAX_COST_EXCEEDED, INTERNAL_SERVER_ERROR, un corps démesuré', async () => {
    for (const r of [
      { statut: 502, corps: '' }, { corps: erreur('MAX_COST_EXCEEDED') }, { corps: erreur('INTERNAL_SERVER_ERROR') },
      { corps: 'x'.repeat(4_000_001) },
    ]) {
      const s = servir(r);
      expect(await lirePageCommandes(ACCES, PARAMS, s.appeler, s.attendre)).toMatchObject({ ok: false, code: 'trop_lourd' });
    }
  });

  it('panne passagère : réseau coupé, corps illisible, autre statut, autre erreur GraphQL, aucune donnée', async () => {
    for (const r of [
      new Error('délai dépassé'), { corps: 'pas du json' }, { statut: 429, corps: reponse([]) }, { corps: erreur('BAD_REQUEST', 'Field x does not exist') },
      { corps: { data: null } },
    ]) {
      const s = servir(r);
      expect(await lirePageCommandes(ACCES, PARAMS, s.appeler, s.attendre)).toMatchObject({ ok: false, code: 'passager' });
    }
  });
});

describe('les droits de l’app', () => {
  it('🔴 lit les droits accordés à l’app de la boutique, par la même adresse et le même jeton', async () => {
    const s = servir({ corps: { data: { currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }, { handle: 'read_products' }] } } } });
    expect(await lireDroitsDeLApp(ACCES, s.appeler)).toEqual({ ok: true, droits: ['read_orders', 'read_products'] });
    expect(s.requetes[0]!.url).toBe(`https://b.myshopify.com/admin/api/${API_VERSION_SHOPIFY}/graphql.json`);
    expect(new Headers(s.requetes[0]!.init.headers).get('x-shopify-access-token')).toBe('jeton');
    expect(s.requetes[0]!.corps.query).toContain('currentAppInstallation { accessScopes { handle } }');
  });

  it('une app refusée (401, 403) se dit ; une réponse illisible ou une panne réseau est passagère', async () => {
    for (const statut of [401, 403]) {
      const s = servir({ statut, corps: '' });
      expect(await lireDroitsDeLApp(ACCES, s.appeler)).toMatchObject({ ok: false, code: 'acces_refuse' });
    }
    for (const r of [{ corps: 'pas du json' }, { corps: { data: null } }, { statut: 500, corps: '' }, new Error('délai dépassé')]) {
      const s = servir(r);
      expect(await lireDroitsDeLApp(ACCES, s.appeler)).toMatchObject({ ok: false, code: 'passager' });
    }
  });
});
