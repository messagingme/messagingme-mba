import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import type { CreditWhatsappRouteDeps } from '../src/http/credit-whatsapp';
import type { AchatPermis } from '../src/stripe/achat-whatsapp';
import type { ReponseStripe, TransportStripe } from '../src/stripe/client';
import { achatPermis } from '../src/credit-whatsapp/achat-permis';
import type { LigneCredit } from '../src/credit-whatsapp/lignes.pg';
import type { GrilleMeta } from '../src/credit-whatsapp/grille';

/**
 * ACHETER DU CRÉDIT WHATSAPP (plan du Crédit WhatsApp, tâche 10) : la route qui ouvre l'achat. Aucun appel ne part chez
 * Stripe (transport simulé). Le webhook qui crédite : `tests/stripe-traitement-recharge.test.ts`.
 */
const SECRET_SESSION = 'test-secret';
const CLE = ['rk', 'live', randomBytes(12).toString('hex')].join('_');
const T1 = '5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01';

let admin = '';
let membre = '';
beforeAll(async () => {
  admin = await signSession({ userId: 'u1', tenantId: T1, role: 'admin' }, SECRET_SESSION);
  membre = await signSession({ userId: 'u2', tenantId: T1, role: 'agent' }, SECRET_SESSION);
});
const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
const h = (jeton: string) => ({ headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` } });

const prix = (id: string, centimes: number, o: { devise?: string; taxe?: string } = {}): ReponseStripe =>
  ({ status: 200, json: { id, unit_amount: centimes, currency: o.devise ?? 'eur', tax_behavior: o.taxe ?? 'exclusive' } });
const PRIX_JUSTES: Record<string, ReponseStripe> = {
  price_wa_50: prix('price_wa_50', 5_000), price_wa_100: prix('price_wa_100', 10_000),
  price_wa_250: prix('price_wa_250', 25_000), price_wa_500: prix('price_wa_500', 50_000),
};

class FauxStripe implements TransportStripe {
  readonly appels: Array<{ url: string; corps: URLSearchParams }> = [];
  readonly lectures: string[] = [];
  constructor(private readonly reponses: ReponseStripe[], private readonly lesPrix: Record<string, ReponseStripe>) {}
  async post(url: string, corps: string): Promise<ReponseStripe> {
    this.appels.push({ url, corps: new URLSearchParams(corps) });
    const r = this.reponses.shift();
    if (!r) throw new Error('appel non prévu');
    return r;
  }
  async get(url: string): Promise<ReponseStripe> {
    this.lectures.push(url);
    const r = this.lesPrix[url.slice(url.lastIndexOf('/') + 1)];
    if (!r) throw new Error('lecture non prévue');
    return r;
  }
  async delete(): Promise<ReponseStripe> { throw new Error('non prévu'); }
}

const CLIENT_OK: ReponseStripe = { status: 200, json: { id: 'cus_A' } };
const SESSION_OK: ReponseStripe = { status: 200, json: { id: 'cs_live_1', url: 'https://checkout.stripe.com/c/pay/cs_live_1' } };

/** Une grille de Meta minimale : la France, quatre catégories (micro-euros). */
const GRILLE: GrilleMeta = {
  id: 'g1', enVigueurLe: '2026-10-01',
  tarifs: [
    { marche: 'FR', categorie: 'marketing', palier: 0, prixMicroEur: 71_200 },
    { marche: 'FR', categorie: 'utility', palier: 0, prixMicroEur: 30_000 },
    { marche: 'FR', categorie: 'authentication', palier: 0, prixMicroEur: 30_000 },
    { marche: 'FR', categorie: 'service', palier: 0, prixMicroEur: 24_800 },
  ],
};

function achat(o: {
  permis?: AchatPermis; payeur?: boolean; stripe?: 'aucun'; lesPrix?: Record<string, ReponseStripe>; prixVides?: boolean;
  grille?: GrilleMeta | null; lignes?: LigneCredit[];
} = {}) {
  const transport = new FauxStripe([CLIENT_OK, SESSION_OK], o.lesPrix ?? PRIX_JUSTES);
  const deps: CreditWhatsappRouteDeps = {
    vue: {
      solde: async () => 12_340_000,
      historique: async () => [{ id: 'envois:2026-10-31', raison: 'envois', deltaMicroEur: -149_520, jour: '2026-10-31', at: '2026-10-31T10:00:00.000Z', messages: 2, reference: null, facture: false }],
      grille: async () => (o.grille === undefined ? GRILLE : o.grille),
      conditions: async () => ({ openBar: false, commissionPct: 5 }),
      lignes: async () => o.lignes ?? [ligne()],
    },
    achat: {
      stripe: o.stripe === 'aucun' ? null : {
        cle: CLE, livemode: true, transport,
        prix: o.prixVides
          ? { wa_50: '', wa_100: '', wa_250: '', wa_500: '' }
          : { wa_50: 'price_wa_50', wa_100: 'price_wa_100', wa_250: 'price_wa_250', wa_500: 'price_wa_500' },
        pageOffre: 'https://console.exemple/offre', pageClaude: 'https://console.exemple/paiement-recu',
      },
      clients: { clientDe: async () => null, retenirClient: async (_t, _l, c) => c },
      payeurAutorise: async () => o.payeur ?? true,
      achatPermis: async () => o.permis ?? 'ok',
    },
  };
  const srv = buildServer({ queue: new FakeQueue(), auth: { users: noUsers, secret: SECRET_SESSION }, creditWhatsapp: deps });
  return { srv, transport };
}

const acheter = (srv: ReturnType<typeof buildServer>, corps: unknown, jeton = admin) =>
  srv.inject({ method: 'POST', url: `/tenants/${T1}/credit-whatsapp/achat`, ...h(jeton), payload: JSON.stringify(corps) });

describe('POST /tenants/:tenantId/credit-whatsapp/achat', () => {
  it('🔴 ouvre la session de SON offre : produit `credit_whatsapp`, codes promo FERMÉS, retour sur l’onglet Crédit WhatsApp', async () => {
    const a = achat();
    const r = await acheter(a.srv, { offre: 'wa_250' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_live_1' });
    expect(a.transport.lectures).toEqual(['https://api.stripe.com/v1/prices/price_wa_250']);
    const session = a.transport.appels.find((x) => x.url.endsWith('/checkout/sessions'))!.corps;
    expect(session.get('line_items[0][price]')).toBe('price_wa_250');
    expect(session.get('metadata[produit]')).toBe('credit_whatsapp');
    expect(session.get('metadata[offre]')).toBe('wa_250');
    expect(session.get('metadata[tenant_id]')).toBe(T1);
    expect(session.get('allow_promotion_codes')).toBe('false');
    expect(session.get('success_url')).toBe('https://console.exemple/offre?tab=whatsapp&paiement=recu');
    expect(session.get('cancel_url')).toBe('https://console.exemple/offre?tab=whatsapp&paiement=abandon');
    await a.srv.close();
  });

  it('🔴 la formule Free, l’open bar et un espace sans numéro actif sur la ligne sont refusés, sans rien appeler chez Stripe', async () => {
    for (const [permis, statut, code] of [['free', 403, 'credit_whatsapp_hors_offre'], ['open_bar', 409, 'credit_whatsapp_open_bar'], ['sans_ligne', 409, 'credit_whatsapp_sans_ligne']] as const) {
      const a = achat({ permis });
      const r = await acheter(a.srv, { offre: 'wa_50' });
      expect(r.statusCode, permis).toBe(statut);
      expect(r.json(), permis).toMatchObject({ code });
      expect(a.transport.appels).toEqual([]);
      expect(a.transport.lectures).toEqual([]);
      await a.srv.close();
    }
  });

  it('réservé aux administrateurs', async () => {
    const a = achat();
    expect((await acheter(a.srv, { offre: 'wa_50' }, membre)).statusCode).toBe(403);
    expect(a.transport.appels).toEqual([]);
    await a.srv.close();
  });

  it('🔴 en mode test, un non-exploitant ne paie pas ; sans Stripe ou sans prix : 503, rien d’appelé', async () => {
    for (const o of [{ payeur: false }, { stripe: 'aucun' as const }, { prixVides: true }]) {
      const a = achat(o);
      const r = await acheter(a.srv, { offre: 'wa_50' });
      expect(r.statusCode, JSON.stringify(o)).toBe(503);
      expect(r.json()).toMatchObject({ code: 'credit_whatsapp_indisponible' });
      expect(a.transport.appels).toEqual([]);
      await a.srv.close();
    }
  });

  it('🔴 un prix configuré qui ne vaut pas l’offre (montant, devise, taxe incluse) : 422 AVANT le paiement, rien de créé', async () => {
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const faux of [prix('price_wa_50', 4_000), prix('price_wa_50', 5_000, { devise: 'usd' }), prix('price_wa_50', 5_000, { taxe: 'inclusive' })]) {
        const a = achat({ lesPrix: { ...PRIX_JUSTES, price_wa_50: faux } });
        const r = await acheter(a.srv, { offre: 'wa_50' });
        expect(r.statusCode).toBe(422);
        expect(r.json()).toMatchObject({ code: 'prix_incoherent' });
        expect(a.transport.appels).toEqual([]);
        await a.srv.close();
      }
    } finally {
      erreurs.mockRestore();
    }
  });

  it('le corps ne porte qu’une offre de la liste : une offre du crédit IA ou un montant sont refusés', async () => {
    const a = achat();
    for (const corps of [{ offre: 'refill_50' }, { offre: 'wa_1000' }, { montant: 5_000 }, {}]) {
      expect((await acheter(a.srv, corps)).statusCode, JSON.stringify(corps)).toBe(400);
    }
    expect(a.transport.appels).toEqual([]);
    await a.srv.close();
  });
});

describe('GET /tenants/:tenantId/credit-whatsapp (l’onglet)', () => {
  const lire = (srv: ReturnType<typeof buildServer>, jeton = membre) =>
    srv.inject({ method: 'GET', url: `/tenants/${T1}/credit-whatsapp`, ...h(jeton) });

  it('🔴 le solde, l’historique, le prix d’un message en France COMMISSION COMPRISE (jamais son taux), et l’achat', async () => {
    const a = achat();
    const r = await lire(a.srv);
    expect(r.statusCode).toBe(200);
    const v = r.json();
    expect(v.soldeMicroEur).toBe(12_340_000);
    // 5 % compris : 71 200 devient 74 760 ; l'authentification prend le plus cher de ses deux tarifs du marché.
    expect(v.prixFrance).toEqual([
      { categorie: 'marketing', prixMicroEur: 74_760 }, { categorie: 'utility', prixMicroEur: 31_500 },
      { categorie: 'authentication', prixMicroEur: 31_500 }, { categorie: 'service', prixMicroEur: 26_040 },
    ]);
    expect(r.body).not.toMatch(/commission/i);
    expect(v.franchiseServiceParNumero).toBe(1_000);
    expect(v.achat).toEqual({
      disponible: true, permis: 'ok',
      offres: [{ offre: 'wa_50', htCentimes: 5_000 }, { offre: 'wa_100', htCentimes: 10_000 }, { offre: 'wa_250', htCentimes: 25_000 }, { offre: 'wa_500', htCentimes: 50_000 }],
    });
    expect(v.ligneArretee).toBe(false);
    expect(v.historique).toEqual([expect.objectContaining({ raison: 'envois', messages: 2, deltaMicroEur: -149_520 })]);
    await a.srv.close();
  });

  it('sans grille : aucun prix ; toutes les lignes arrêtées : dit ; prix Stripe absents : achat indisponible', async () => {
    const a = achat({ grille: null, lignes: [ligne({ arreteeLe: '2026-10-31T11:00:00Z' })], prixVides: true, permis: 'sans_ligne' });
    const v = (await lire(a.srv)).json();
    expect(v.prixFrance).toBeNull();
    expect(v.ligneArretee).toBe(true);
    expect(v.achat).toMatchObject({ disponible: false, permis: 'sans_ligne' });
    await a.srv.close();
  });
});

const ligne = (o: Partial<LigneCredit> = {}): LigneCredit => ({
  id: 'l1', tenantId: T1, phoneNumberId: 'pn1', wabaId: 'w1', origine: 'ops', depuis: '2026-10-31T10:00:00Z', arreteeLe: null, ...o,
});

describe('qui peut acheter du Crédit WhatsApp', () => {
  const deps = (o: { offre?: 'base' | 'pro' | 'business' | 'entreprise'; openBar?: boolean; lignes?: LigneCredit[] }) => ({
    offre: async () => o.offre ?? 'pro',
    conditions: async () => ({ openBar: o.openBar ?? false, commissionPct: 5 }),
    lignes: async () => o.lignes ?? [ligne()],
  });

  it('la formule Free jamais, l’open bar jamais, un espace sans ligne active jamais ; sinon oui', async () => {
    expect(await achatPermis(deps({ offre: 'base' }), T1)).toBe('free');
    expect(await achatPermis(deps({ offre: 'entreprise', openBar: true }), T1)).toBe('open_bar');
    expect(await achatPermis(deps({ lignes: [] }), T1)).toBe('sans_ligne');
    // Une ligne arrêtée ne laisse rien partir : le crédit ne servirait pas.
    expect(await achatPermis(deps({ lignes: [ligne({ arreteeLe: '2026-10-31T11:00:00Z' })] }), T1)).toBe('sans_ligne');
    expect(await achatPermis(deps({}), T1)).toBe('ok');
    expect(await achatPermis(deps({ offre: 'business' }), T1)).toBe('ok');
    expect(await achatPermis(deps({ offre: 'entreprise' }), T1)).toBe('ok');
  });
});
