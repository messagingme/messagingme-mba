import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import type { CreditWhatsappRouteDeps } from '../src/http/credit-whatsapp';
import type { AchatPermis } from '../src/stripe/achat-whatsapp';
import type { ReponseStripe, TransportStripe } from '../src/stripe/client';
import { achatPermis, ongletCreditWhatsapp, surLaLigne } from '../src/credit-whatsapp/achat-permis';
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
  grille?: GrilleMeta | null; lignes?: LigneCredit[]; openBar?: boolean;
  /** L'option (lot 4a) : son prix posé (vide = pas en vente) et l'offre de l'espace. */
  prixOption?: string; offre?: 'base' | 'pro' | 'business' | 'entreprise';
  /** La formule payée (`formulePayee`, révision du 2026-11-04) : fausse pendant un essai. */
  formulePayee?: boolean;
  /** L'option vivante de l'espace (lot B) : ses places et son statut ; aucune par défaut. */
  optionVivante?: { places: number; statut: 'actif' | 'en_retard' | 'resilie' };
  /** Les numéros de l'espace (lot B, décision 8) : gardent-ils l'application, sont-ils déliés ; aucun par défaut. */
  numeros?: Array<{ coexistence: boolean; delie: boolean }>;
} = {}) {
  const transport = new FauxStripe([CLIENT_OK, SESSION_OK], o.lesPrix ?? PRIX_JUSTES);
  const deps: CreditWhatsappRouteDeps = {
    vue: {
      solde: async () => 12_340_000,
      consommationDuMois: async () => 2_149_520,
      historique: async () => [{ id: 'envois:2026-10-31', raison: 'envois', deltaMicroEur: -149_520, jour: '2026-10-31', at: '2026-10-31T10:00:00.000Z', messages: 2, reference: null, facture: false }],
      grille: async () => (o.grille === undefined ? GRILLE : o.grille),
      conditions: async () => ({ openBar: o.openBar ?? false, commissionPct: 5 }),
      lignes: async () => o.lignes ?? [ligne()],
      serie: async () => [{ jour: '2026-11-02', soldeMicroEur: 12_340_000, consommationMicroEur: 149_520 }],
      numeros: async () => o.numeros ?? [],
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
    // L'option (lot 4a) : en vente pour un Pro, sans option prise ; les gestes eux-mêmes sont éprouvés par
    // `tests/stripe-option-credit-whatsapp.test.ts`.
    option: {
      stripe: o.stripe === 'aucun' ? null : { cle: CLE, livemode: true, transport } as never,
      clients: { clientDe: async () => null, retenirClient: async (_t, _l, c) => c },
      payeurAutorise: async () => o.payeur ?? true,
      urlConsole: 'https://console.exemple',
      prixOption: o.prixOption ?? 'price_opt',
      options: {
        vivante: async () => (o.optionVivante ? {
          abonnementId: 'sub_opt', tenantId: T1, livemode: true, periodeFin: null, finPrevueLe: null, finiLe: null, finRaison: null,
          ...o.optionVivante,
        } : null),
        noterPlaces: async () => null,
      },
      offre: async () => o.offre ?? 'pro',
      formulePayee: async () => o.formulePayee ?? true,
      numerosCouverts: async () => 1,
      reprendreCampagnes: async () => 0,
      alerter: async () => {},
      verrous: { prendre: async (cles) => ({ jeton: 'j', cles: cles.map(([c]) => c) }), relacher: async () => {} },
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
    expect(v.illimite).toBe(false);
    expect(v.soldeMicroEur).toBe(12_340_000);
    expect(v.consommationDuMoisMicroEur).toBe(2_149_520);
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
    // La courbe de 90 jours (lot C) passe telle que le store la reconstruit.
    expect(v.serie).toEqual([{ jour: '2026-11-02', soldeMicroEur: 12_340_000, consommationMicroEur: 149_520 }]);
    await a.srv.close();
  });

  it('🔴 une Entreprise est illimitée : la vue le dit, avec la consommation du mois, et l’achat lui est refusé', async () => {
    const a = achat({ openBar: true, permis: 'open_bar' });
    const v = (await lire(a.srv)).json();
    expect(v.illimite).toBe(true);
    expect(v.consommationDuMoisMicroEur).toBe(2_149_520);
    expect(v.achat).toMatchObject({ permis: 'open_bar' });
    expect(v.historique).toHaveLength(1);
    await a.srv.close();
  });

  it('🔴 l’option arrêtée (lot C, moment 3) : toutes les lignes arrêtées, dont une venue de l’option ; une ligne vivante, ou des lignes posées à la main seules, non', async () => {
    const ARRET = '2026-11-06T09:00:00Z';
    const cas: Array<[LigneCredit[], boolean, boolean]> = [
      [[ligne({ origine: 'option', arreteeLe: ARRET })], true, true],
      [[ligne({ origine: 'option', arreteeLe: ARRET }), ligne({ id: 'l2', phoneNumberId: 'pn2', arreteeLe: ARRET })], true, true],
      [[ligne({ origine: 'option', arreteeLe: ARRET }), ligne({ id: 'l2', phoneNumberId: 'pn2', origine: 'option' })], false, false],
      // Posée à la main et arrêtée à la main : la sortie se demande au Support, jamais « reprenez l'option ».
      [[ligne({ arreteeLe: ARRET })], true, false],
    ];
    for (const [lignes, ligneArretee, optionArretee] of cas) {
      const a = achat({ lignes });
      const v = (await lire(a.srv)).json();
      expect([v.ligneArretee, v.optionArretee], JSON.stringify(lignes)).toEqual([ligneArretee, optionArretee]);
      await a.srv.close();
    }
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
  id: 'l1', tenantId: T1, phoneNumberId: 'pn1', wabaId: 'w1', origine: 'ops', depuis: '2026-10-31T10:00:00Z', arreteeLe: null, retireeLe: null, ...o,
});

describe('qui peut acheter du Crédit WhatsApp', () => {
  const deps = (o: { offre?: 'base' | 'pro' | 'business' | 'entreprise'; openBar?: boolean; lignes?: LigneCredit[]; optionEnVente?: boolean }) => ({
    offre: async () => o.offre ?? 'pro',
    conditions: async () => ({ openBar: o.openBar ?? false, commissionPct: 5 }),
    lignes: async () => o.lignes ?? [ligne()],
    optionEnVente: o.optionEnVente ?? false,
  });

  it('la formule Free jamais, l’Entreprise (illimitée) jamais, un espace sans ligne active jamais ; sinon oui', async () => {
    expect(await achatPermis(deps({ offre: 'base' }), T1)).toBe('free');
    // Toute Entreprise est illimitée (`PgConditionsCreditStore`, décision du 2026-11-02) : rien à acheter.
    expect(await achatPermis(deps({ offre: 'entreprise', openBar: true }), T1)).toBe('open_bar');
    expect(await achatPermis(deps({ lignes: [] }), T1)).toBe('sans_ligne');
    // Une ligne arrêtée ne laisse rien partir : le crédit ne servirait pas.
    expect(await achatPermis(deps({ lignes: [ligne({ arreteeLe: '2026-10-31T11:00:00Z' })] }), T1)).toBe('sans_ligne');
    expect(await achatPermis(deps({}), T1)).toBe('ok');
    expect(await achatPermis(deps({ offre: 'business' }), T1)).toBe('ok');
  });

  it('🔴 l’onglet : jamais en Free ; dès qu’un numéro est sur la ligne, même arrêtée ; une Entreprise le voit aussi (« Illimité »)', async () => {
    expect(await ongletCreditWhatsapp(deps({ offre: 'base' }), T1)).toBe(false);
    expect(await ongletCreditWhatsapp(deps({ lignes: [] }), T1)).toBe(false);
    expect(await ongletCreditWhatsapp(deps({}), T1)).toBe(true);
    expect(await ongletCreditWhatsapp(deps({ lignes: [ligne({ arreteeLe: '2026-10-31T11:00:00Z' })] }), T1)).toBe(true);
    expect(await ongletCreditWhatsapp(deps({ offre: 'entreprise', openBar: true }), T1)).toBe(true);
    expect(await ongletCreditWhatsapp(deps({ offre: 'entreprise', openBar: true, lignes: [] }), T1)).toBe(false);
  });

  it('🔴 l’option en vente (lot 4a) : un Pro ou un Business sans ligne voient l’onglet, pour la prendre ; ni la Free ni une Entreprise', async () => {
    expect(await ongletCreditWhatsapp(deps({ lignes: [], optionEnVente: true }), T1)).toBe(true);
    expect(await ongletCreditWhatsapp(deps({ offre: 'business', lignes: [], optionEnVente: true }), T1)).toBe(true);
    expect(await ongletCreditWhatsapp(deps({ offre: 'base', lignes: [], optionEnVente: true }), T1)).toBe(false);
    expect(await ongletCreditWhatsapp(deps({ offre: 'entreprise', openBar: true, lignes: [], optionEnVente: true }), T1)).toBe(false);
  });

  it('🔴 « sur la ligne », que Claude lit, n’est pas l’onglet : l’option en vente n’y met pas un Pro sans ligne', async () => {
    // Relecture du lot 4a : `get_setup_state` et `get_credit` lisaient l'onglet, et disaient épuisé le solde d'un Pro dont
    // aucun message ne passe par nous.
    expect(await surLaLigne(deps({ lignes: [], optionEnVente: true }), T1)).toBe(false);
    expect(await surLaLigne(deps({}), T1)).toBe(true);
    expect(await surLaLigne(deps({ lignes: [ligne({ arreteeLe: '2026-10-31T11:00:00Z' })] }), T1)).toBe(true);
    expect(await surLaLigne(deps({ offre: 'base' }), T1)).toBe(false);
  });
});

/**
 * L'OPTION DU CRÉDIT WHATSAPP DANS L'ONGLET (lot 4a) : ce que la vue en dit, et ses deux routes, réservées aux
 * administrateurs. Les gestes chez Stripe sont éprouvés par `tests/stripe-option-credit-whatsapp.test.ts`.
 */
/**
 * L'ÉTAT POUR LES CARTES « QUI RÈGLE META ? » (révision du 2026-11-04, lot B, B1) : une lecture légère, que Connecter
 * WhatsApp et l'Accueil font à chaque affichage, sans l'historique ni la courbe de l'onglet.
 */
describe('GET /tenants/:tenantId/credit-whatsapp/etat', () => {
  const etat = (srv: ReturnType<typeof buildServer>, jeton = admin) => srv.inject({ method: 'GET', url: `/tenants/${T1}/credit-whatsapp/etat`, ...h(jeton) });

  it('🔴 l’état de la ligne (etatLigneCredit) et la vente ouverte ou non, lus par tout membre', async () => {
    const cas: Array<[Parameters<typeof achat>[0], { etat: string; enVente: boolean; avecApplication: boolean }]> = [
      [{ lignes: [] }, { etat: 'a_prendre', enVente: true, avecApplication: false }],
      [{ lignes: [], optionVivante: { places: 1, statut: 'actif' } }, { etat: 'en_attente', enVente: true, avecApplication: false }],
      [{}, { etat: 'active', enVente: true, avecApplication: false }],
      [{ lignes: [], formulePayee: false }, { etat: 'essai', enVente: true, avecApplication: false }],
      [{ lignes: [], prixOption: '' }, { etat: 'a_prendre', enVente: false, avecApplication: false }],
      [{ lignes: [], stripe: 'aucun' }, { etat: 'a_prendre', enVente: false, avecApplication: false }],
      [{ lignes: [], offre: 'base' }, { etat: 'free', enVente: false, avecApplication: false }],
      [{ lignes: [], offre: 'entreprise' }, { etat: 'a_prendre', enVente: false, avecApplication: false }],
    ];
    for (const [o, attendu] of cas) {
      const a = achat(o);
      const r = await etat(a.srv, membre);
      expect(r.statusCode, JSON.stringify(o)).toBe(200);
      expect(r.json(), JSON.stringify(o)).toEqual(attendu);
      await a.srv.close();
    }
  });

  it('🔴 dit quand TOUS les numéros vivants de l’espace gardent l’application (décision 8) : l’écran de paiement prévient', async () => {
    const app = { coexistence: true, delie: false };
    const api = { coexistence: false, delie: false };
    for (const [numeros, attendu] of [
      [[app], true], [[app, app], true], [[app, api], false], [[api], false], [[], false],
      // Un numéro délié ne compte plus : il ne passera jamais sur la ligne, ni ne l'empêche.
      [[app, { coexistence: false, delie: true }], true], [[{ coexistence: true, delie: true }], false],
    ] as const) {
      const a = achat({ lignes: [], numeros: [...numeros] });
      expect((await etat(a.srv, membre)).json().avecApplication, JSON.stringify(numeros)).toBe(attendu);
      await a.srv.close();
    }
  });
});

describe('l’option dans l’onglet', () => {
  const lire = (srv: ReturnType<typeof buildServer>) => srv.inject({ method: 'GET', url: `/tenants/${T1}/credit-whatsapp`, ...h(admin) });
  const option = (srv: ReturnType<typeof buildServer>, method: 'POST' | 'PATCH', corps: unknown, jeton = admin) =>
    srv.inject({ method, url: `/tenants/${T1}/credit-whatsapp/option`, ...h(jeton), payload: JSON.stringify(corps) });

  it('🔴 la vue dit l’option en vente pour un Pro (son prix, ses bornes, ses places), jamais sans prix posé', async () => {
    const enVente = achat();
    expect((await lire(enVente.srv)).json().option).toEqual({
      disponible: true, prixHtCentimes: 3000, placesMax: 20, places: 0, couverts: 1, statut: null, finPrevueLe: null,
      formulePayee: true, avecApplication: false,
    });
    await enVente.srv.close();
    // La même règle que l'état de la ligne : l'onglet prévient aussi au moment de payer.
    const avecApp = achat({ numeros: [{ coexistence: true, delie: false }] });
    expect((await lire(avecApp.srv)).json().option.avecApplication).toBe(true);
    await avecApp.srv.close();
    for (const o of [{ prixOption: '' }, { stripe: 'aucun' as const }, { offre: 'entreprise' as const }]) {
      const a = achat(o);
      expect((await lire(a.srv)).json().option.disponible, JSON.stringify(o)).toBe(false);
      await a.srv.close();
    }
  });

  it('🔴 la vue dit si la formule est payée, par la règle de la prise (`formulePayee`) : faux pendant un essai, Pro comme Business, et hors d’eux', async () => {
    // Révision du 2026-11-04 : l'onglet explique l'essai au lieu de vendre une option que la prise refuserait.
    for (const [o, attendu] of [
      [{ offre: 'pro' as const, formulePayee: false }, false], [{ offre: 'business' as const, formulePayee: false }, false],
      [{ offre: 'business' as const, formulePayee: true }, true], [{ offre: 'entreprise' as const, formulePayee: true }, false],
      [{ offre: 'base' as const, formulePayee: true }, false],
    ] as const) {
      const a = achat(o);
      expect((await lire(a.srv)).json().option.formulePayee, JSON.stringify(o)).toBe(attendu);
      await a.srv.close();
    }
  });

  it('🔴 les deux routes sont réservées aux administrateurs, et un corps faux est refusé sans rien appeler chez Stripe', async () => {
    const a = achat();
    expect((await option(a.srv, 'POST', { places: 1 }, membre)).statusCode).toBe(403);
    expect((await option(a.srv, 'PATCH', { depuis: 1, cible: 2 }, membre)).statusCode).toBe(403);
    expect((await option(a.srv, 'POST', { places: '2' })).statusCode).toBe(400);
    expect((await option(a.srv, 'PATCH', { cible: 2 })).statusCode).toBe(400);
    expect([a.transport.appels, a.transport.lectures]).toEqual([[], []]);
    await a.srv.close();
  });

  it('pas en vente : 503 ; sans option prise, changer ses places : 409', async () => {
    const pasEnVente = achat({ prixOption: '' });
    expect((await option(pasEnVente.srv, 'POST', { places: 1 })).json()).toMatchObject({ code: 'option_indisponible' });
    await pasEnVente.srv.close();
    const sansOption = achat();
    const r = await option(sansOption.srv, 'PATCH', { depuis: 1, cible: 2 });
    expect([r.statusCode, r.json().code]).toEqual([409, 'sans_option']);
    await sansOption.srv.close();
  });
});
