import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { finPrevueDe, type ReponseStripe, type TransportStripe } from '../src/stripe/client';
import { changerResiliationPro, demarrerProMaintenant, facturesDeLEspace, finPrevueChezStripe, tarifDuPro, FACTURES_MONTREES, type DepsDemarrerPro, type DepsGestionPro } from '../src/stripe/gestion-pro';
import type { StripeConfigure } from '../src/stripe/paiement';

/**
 * GÉRER LE PRO DEPUIS LA CONSOLE (2026-10-26) : résilier, annuler la résiliation, lire les factures. Contre un transport
 * simulé : aucun appel ne part chez Stripe, la clé est tirée au hasard (rien que `gitleaks` puisse reconnaître).
 */
const CLE = ['rk', 'test', randomBytes(12).toString('hex')].join('_');
const FIN_PERIODE = Date.parse('2026-11-12T08:00:00Z') / 1000;

class FauxTransport implements TransportStripe {
  readonly appels: Array<{ methode: 'GET' | 'POST'; url: string; corps: URLSearchParams; entetes: Record<string, string> }> = [];
  constructor(private readonly reponses: Array<ReponseStripe | Error>) {}
  private suivante(): ReponseStripe {
    const r = this.reponses.shift();
    if (!r) throw new Error('appel non prévu');
    if (r instanceof Error) throw r;
    return r;
  }
  async post(url: string, corps: string, entetes: Record<string, string>): Promise<ReponseStripe> {
    this.appels.push({ methode: 'POST', url, corps: new URLSearchParams(corps), entetes });
    return this.suivante();
  }
  async get(url: string, entetes: Record<string, string>): Promise<ReponseStripe> {
    this.appels.push({ methode: 'GET', url, corps: new URLSearchParams(), entetes });
    return this.suivante();
  }
  async delete(): Promise<ReponseStripe> {
    throw new Error('aucune suppression ici');
  }
}

function monter(o: { reponses?: Array<ReponseStripe | Error>; stripe?: null; payeur?: boolean; pro?: null; client?: null } = {}) {
  const transport = new FauxTransport(o.reponses ?? []);
  const stripe: StripeConfigure = {
    cle: CLE, livemode: false, transport, prix: { refill_5: '', refill_10: '', refill_50: '', refill_100: '' },
    pageCredit: 'https://x', pageClaude: 'https://x',
  };
  const notes: Array<{ abonnementId: string; finPrevueLe: Date | null }> = [];
  const d: DepsGestionPro = {
    stripe: o.stripe === null ? null : stripe,
    payeurAutorise: async () => o.payeur ?? true,
    clients: { clientDe: async (tenant) => (o.client === null ? null : `cus_${tenant}`) },
    proVivant: async () => (o.pro === null ? null : { abonnementId: 'sub_1' }),
    noterFinPrevue: async (abonnementId, finPrevueLe) => { notes.push({ abonnementId, finPrevueLe }); },
    prixSiege: ['price_siege_mois', 'price_siege_an'],
  };
  return { d, transport, notes };
}

const abonnement = (o: { cancel_at?: number | null; cancel_at_period_end?: boolean }) => ({
  status: 200, json: { id: 'sub_1', ...o, items: { data: [{ current_period_end: FIN_PERIODE - 10 }, { current_period_end: FIN_PERIODE }] } },
});

describe('finPrevueDe : le calcul du webhook, partagé avec la console', () => {
  it('🔴 une date posée prime ; sinon la fin de période la plus tardive si la fin est à la fin de période ; sinon aucune', () => {
    expect(finPrevueDe({ cancel_at: 1_800_000_000, cancel_at_period_end: true, items: { data: [{ current_period_end: 5 }] } }))
      .toEqual(new Date(1_800_000_000 * 1000));
    expect(finPrevueDe({ cancel_at: null, cancel_at_period_end: true, items: { data: [{ current_period_end: 5 }, { current_period_end: 9 }] } }))
      .toEqual(new Date(9000));
    expect(finPrevueDe({ cancel_at: null, cancel_at_period_end: false, items: { data: [{ current_period_end: 9 }] } })).toBeNull();
    expect(finPrevueDe({ cancel_at_period_end: true })).toBeNull();
  });
});

describe('changerResiliationPro', () => {
  it('🔴 résilier : la fin de période posée chez Stripe, relue, écrite comme le webhook l’écrirait', async () => {
    const { d, transport, notes } = monter({ reponses: [abonnement({ cancel_at: FIN_PERIODE, cancel_at_period_end: true })] });
    const r = await changerResiliationPro(d, 't1', true, 'u1');
    expect(r).toEqual({ ok: true, valeur: { finPrevueLe: '2026-11-12T08:00:00.000Z' } });
    expect(transport.appels).toHaveLength(1);
    expect(transport.appels[0]!.url).toBe('https://api.stripe.com/v1/subscriptions/sub_1');
    expect(Object.fromEntries(transport.appels[0]!.corps)).toEqual({ cancel_at_period_end: 'true' });
    expect(notes).toEqual([{ abonnementId: 'sub_1', finPrevueLe: new Date(FIN_PERIODE * 1000) }]);
  });

  it('🔴 une clé d’idempotence PAR DEMANDE : « résilier, annuler, résilier » s’applique trois fois', async () => {
    const { d, transport } = monter({ reponses: [
      abonnement({ cancel_at_period_end: true }), abonnement({ cancel_at: null, cancel_at_period_end: false }), abonnement({ cancel_at_period_end: true }),
    ] });
    for (const resilier of [true, false, true]) expect((await changerResiliationPro(d, 't1', resilier, 'u1')).ok).toBe(true);
    const cles = transport.appels.map((a) => a.entetes['idempotency-key']);
    expect(new Set(cles).size).toBe(3);
    expect(cles.every((c) => typeof c === 'string' && c.startsWith('resiliation-sub_1-'))).toBe(true);
  });

  it('annuler : la fin retirée chez Stripe, plus aucune fin écrite', async () => {
    const { d, transport, notes } = monter({ reponses: [abonnement({ cancel_at: null, cancel_at_period_end: false })] });
    expect(await changerResiliationPro(d, 't1', false, 'u1')).toEqual({ ok: true, valeur: { finPrevueLe: null } });
    expect(Object.fromEntries(transport.appels[0]!.corps)).toEqual({ cancel_at_period_end: 'false' });
    expect(notes).toEqual([{ abonnementId: 'sub_1', finPrevueLe: null }]);
  });

  it('🔴 une fin DATÉE (posée au tableau de bord) ne se retire pas d’ici : 409 fin_datee, un seul appel, rien d’écrit', async () => {
    // La retirer recalcule la période et peut ajouter des prorata à la facture (relecture du 2026-10-26).
    const { d, transport, notes } = monter({ reponses: [abonnement({ cancel_at: 1_900_000_000, cancel_at_period_end: false })] });
    expect(await changerResiliationPro(d, 't1', false, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'fin_datee' } });
    expect(transport.appels.map((a) => Object.fromEntries(a.corps))).toEqual([{ cancel_at_period_end: 'false' }]);
    expect(notes).toEqual([]);
  });

  it('🔴 Stripe a changé mais la base ne s’écrit pas : le client lit quand même la fin, le webhook la réécrira', async () => {
    const { d } = monter({ reponses: [abonnement({ cancel_at: FIN_PERIODE, cancel_at_period_end: true })] });
    const panne = { ...d, noterFinPrevue: async () => { throw new Error('lock_timeout'); } };
    expect(await changerResiliationPro(panne, 't1', true, 'u1')).toEqual({ ok: true, valeur: { finPrevueLe: '2026-11-12T08:00:00.000Z' } });
  });

  it('🔴 une réponse qui ne porte pas le changement demandé est un refus : rien n’est écrit', async () => {
    const { d, notes } = monter({ reponses: [abonnement({ cancel_at: null, cancel_at_period_end: false })] });
    const r = await changerResiliationPro(d, 't1', true, 'u1');
    expect(r).toMatchObject({ ok: false, statut: 422, details: { code: 'resiliation_impossible' } });
    expect(notes).toEqual([]);
  });

  it('🔴 un refus de Stripe : 422 lisible, sans son message (il parle de NOTRE compte), rien n’est écrit', async () => {
    const { d, notes } = monter({ reponses: [{ status: 403, json: { error: { type: 'invalid_request_error', message: 'The provided key rk_test_secret does not have write access' } } }] });
    const r = await changerResiliationPro(d, 't1', true, 'u1');
    expect(r).toMatchObject({ ok: false, statut: 422, details: { code: 'resiliation_impossible' } });
    expect(JSON.stringify(r)).not.toContain('rk_test');
    expect(notes).toEqual([]);
  });

  it('sans Pro vivant : 409 ; Stripe absent ou payeur refusé (mode test) : 503 ; aucun appel', async () => {
    for (const [o, statut] of [[{ pro: null }, 409], [{ stripe: null }, 503], [{ payeur: false }, 503]] as const) {
      const { d, transport } = monter(o);
      expect(await changerResiliationPro(d, 't1', true, 'u1')).toMatchObject({ ok: false, statut });
      expect(transport.appels).toEqual([]);
    }
  });
});

const facture = (o: Record<string, unknown> = {}) => ({
  id: 'in_1', customer: 'cus_t1', number: 'MM-0001', created: 1_790_000_000, status: 'paid', total: 5880, currency: 'eur',
  hosted_invoice_url: 'https://invoice.stripe.com/i/1', invoice_pdf: 'https://pay.stripe.com/invoice/1/pdf',
  parent: { subscription_details: { metadata: { produit: 'pro', tenant_id: 't1' } } },
  lines: { data: [{ description: '1 × Messaging Me Pro' }] }, ...o,
});

describe('facturesDeLEspace', () => {
  it('🔴 les factures du client DE L’ESPACE, les 24 dernières, avec leur objet, leur statut et leurs adresses', async () => {
    const { d, transport } = monter({ reponses: [{ status: 200, json: { has_more: true, data: [
      facture(),
      facture({ id: 'in_2', status: 'open', parent: { subscription_details: { metadata: { produit: 'numero' } } } }),
      facture({ id: 'in_3', status: 'void', parent: null, lines: { data: [{ description: 'Recharge du crédit IA 5 € HT' }] } }),
      facture({ id: 'in_4', status: 'uncollectible', hosted_invoice_url: 'http://pas-https.test', invoice_pdf: null }),
    ] } }] });
    const r = await facturesDeLEspace(d, 't1', 'u1');
    expect(transport.appels[0]!.methode).toBe('GET');
    const url = new URL(transport.appels[0]!.url);
    expect(url.pathname).toBe('/v1/invoices');
    expect(Object.fromEntries(url.searchParams)).toEqual({ customer: 'cus_t1', limit: String(FACTURES_MONTREES) });
    expect(r).toEqual({ ok: true, valeur: { plusSurStripe: true, factures: [
      { id: 'in_1', numero: 'MM-0001', le: new Date(1_790_000_000 * 1000).toISOString(), objet: 'pro', libelle: '1 × Messaging Me Pro',
        totalCentimes: 5880, devise: 'eur', statut: 'payee', urlPage: 'https://invoice.stripe.com/i/1', urlPdf: 'https://pay.stripe.com/invoice/1/pdf' },
      expect.objectContaining({ id: 'in_2', objet: 'numero', statut: 'a_regler' }),
      expect.objectContaining({ id: 'in_3', objet: 'autre', libelle: 'Recharge du crédit IA 5 € HT', statut: 'annulee' }),
      // Une adresse qui n'est pas `https` n'est jamais rendue : l'écran y enverrait un onglet.
      expect.objectContaining({ id: 'in_4', statut: 'impayee', urlPage: null, urlPdf: null }),
    ] } });
  });

  it('🔴 un brouillon, un statut inconnu, une facture illisible ou d’un autre client sont écartés, sans cacher les autres', async () => {
    const { d } = monter({ reponses: [{ status: 200, json: { has_more: false, data: [
      facture({ id: 'in_brouillon', status: 'draft' }), facture({ id: 'in_futur', status: 'statut_de_demain' }),
      facture({ id: 'pas_une_facture' }), facture({ id: 'in_autre', customer: 'cus_autre' }), facture({ id: 'in_bonne' }),
    ] } }] });
    const r = await facturesDeLEspace(d, 't1', 'u1');
    expect(r.ok && r.valeur.factures.map((f) => f.id)).toEqual(['in_bonne']);
  });

  it('un espace sans client Stripe (jamais payé) : une liste vide, sans appel', async () => {
    const { d, transport } = monter({ client: null });
    expect(await facturesDeLEspace(d, 't1', 'u1')).toEqual({ ok: true, valeur: { factures: [], plusSurStripe: false } });
    expect(transport.appels).toEqual([]);
  });

  it('un refus de Stripe : 422 lisible ; Stripe absent ou payeur refusé : 503', async () => {
    const { d } = monter({ reponses: [{ status: 500, json: null }] });
    expect(await facturesDeLEspace(d, 't1', 'u1')).toMatchObject({ ok: false, statut: 422, details: { code: 'factures_impossible' } });
    expect(await facturesDeLEspace(monter({ stripe: null }).d, 't1', 'u1')).toMatchObject({ ok: false, statut: 503 });
    expect(await facturesDeLEspace(monter({ payeur: false }).d, 't1', 'u1')).toMatchObject({ ok: false, statut: 503 });
  });
});

/** L'abonnement tel que Stripe le rend à une lecture : ses lignes et leur prix, sa fin posée ou non, ses remises. */
const lu = (o: { cancel_at?: number | null; cancel_at_period_end?: boolean; discounts?: unknown[]; lignes?: unknown[] } = {}) => ({
  status: 200,
  json: {
    id: 'sub_1', status: 'active', latest_invoice: 'in_9', cancel_at: o.cancel_at ?? null, cancel_at_period_end: o.cancel_at_period_end ?? false,
    discounts: o.discounts ?? [],
    items: { data: o.lignes ?? [
      { id: 'si_pro', quantity: 1, current_period_end: FIN_PERIODE, price: { id: 'price_pro_mois', unit_amount: 3900 } },
      { id: 'si_siege', quantity: 2, current_period_end: FIN_PERIODE, price: { id: 'price_siege_mois', unit_amount: 1200 } },
    ] },
  },
});

describe('finPrevueChezStripe : la fin relue pour le webhook (2026-10-26)', () => {
  it('🔴 rend la fin que Stripe a MAINTENANT : aucune, ou la fin de période posée', async () => {
    expect(await finPrevueChezStripe(monter({ reponses: [lu()] }).d, 'sub_1')).toBeNull();
    expect(await finPrevueChezStripe(monter({ reponses: [lu({ cancel_at_period_end: true })] }).d, 'sub_1')).toEqual(new Date(FIN_PERIODE * 1000));
  });

  it('🔴 une panne passagère lève (le webhook échoue, Stripe rejouera) ; un refus durable rend undefined (la charge sert)', async () => {
    await expect(finPrevueChezStripe(monter({ reponses: [{ status: 503, json: null }] }).d, 'sub_1')).rejects.toThrow();
    await expect(finPrevueChezStripe(monter({ reponses: [new Error('réseau')] }).d, 'sub_1')).rejects.toThrow();
    expect(await finPrevueChezStripe(monter({ reponses: [{ status: 404, json: { error: { type: 'invalid_request_error' } } }] }).d, 'sub_1')).toBeUndefined();
    expect(await finPrevueChezStripe(monter({ stripe: null }).d, 'sub_1')).toBeUndefined();
  });
});

describe('tarifDuPro : le prix de l’abonné, pas la grille (2026-10-26)', () => {
  it('🔴 le Pro et le prix d’un siège, lus sur les lignes de l’abonnement, et la remise', async () => {
    const { d } = monter({ reponses: [lu({ discounts: ['di_1'] })] });
    expect(await tarifDuPro(d, 't1', 'u1')).toEqual({ ok: true, valeur: { proHtCentimes: 3900, siegeHtCentimes: 1200, remise: true } });
  });

  it('sans siège ni remise ; une ligne du Pro sans prix fixe : prix inconnu (la console garde la grille)', async () => {
    const seul = monter({ reponses: [lu({ lignes: [{ id: 'si_pro', quantity: 1, price: { id: 'price_pro_an', unit_amount: 39000 } }] })] });
    expect(await tarifDuPro(seul.d, 't1', 'u1')).toEqual({ ok: true, valeur: { proHtCentimes: 39000, siegeHtCentimes: null, remise: false } });
    const variable = monter({ reponses: [lu({ lignes: [{ id: 'si_pro', quantity: 1, price: { id: 'price_pro_mois', unit_amount: null } }] })] });
    expect(await tarifDuPro(variable.d, 't1', 'u1')).toMatchObject({ ok: true, valeur: { proHtCentimes: null } });
  });

  it('🔴 un siège à un prix qui n’est plus configuré (le tarif a changé) ne gonfle pas le Pro : prix inconnu, la grille sert', async () => {
    const ancien = monter({ reponses: [lu({ lignes: [
      { id: 'si_pro', quantity: 1, price: { id: 'price_pro_mois', unit_amount: 3900 } },
      { id: 'si_siege', quantity: 2, price: { id: 'price_siege_ancien', unit_amount: 1200 } },
    ] })] });
    expect(await tarifDuPro(ancien.d, 't1', 'u1')).toMatchObject({ ok: true, valeur: { proHtCentimes: null } });
  });

  it('sans Pro vivant : 409 ; Stripe absent ou payeur refusé : 503 ; un refus de Stripe : 422, sans son message', async () => {
    expect(await tarifDuPro(monter({ pro: null }).d, 't1', 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'aucun_pro' } });
    expect(await tarifDuPro(monter({ stripe: null }).d, 't1', 'u1')).toMatchObject({ ok: false, statut: 503 });
    expect(await tarifDuPro(monter({ payeur: false }).d, 't1', 'u1')).toMatchObject({ ok: false, statut: 503 });
    const refuse = await tarifDuPro(monter({ reponses: [{ status: 403, json: { error: { message: 'The key rk_test_x cannot read subscriptions' } } }] }).d, 't1', 'u1');
    expect(refuse).toMatchObject({ ok: false, statut: 422, details: { code: 'tarif_impossible' } });
    expect(JSON.stringify(refuse)).not.toContain('rk_test');
  });
});

/**
 * DÉMARRER LA FORMULE PRO MAINTENANT (révision du Crédit WhatsApp, 2026-11-04, décision 6) : un client en essai arrête
 * son essai pour prendre la ligne de crédit tout de suite. Stripe prélève la carte prise au début de l'essai ; s'il
 * refuse, rien ne change et l'essai continue.
 */
describe('demarrerProMaintenant', () => {
  const EN_ESSAI = new Date('2026-11-12T08:00:00Z');
  const MAINTENANT = Date.parse('2026-11-05T10:00:00Z');
  function demarrer(o: { reponses?: Array<ReponseStripe | Error>; essai?: Date | null; finPrevue?: Date; verrouTenu?: boolean; pro?: null } = {}) {
    const base = monter({ reponses: o.reponses, ...(o.pro === null ? { pro: null } : {}) });
    const fins: Array<{ abonnementId: string; finLe: Date }> = [];
    const verrous = { pris: [] as string[], relaches: 0 };
    const d: DepsDemarrerPro = {
      ...base.d,
      resumeDuPro: async () => ({ essaiFinLe: o.essai === undefined ? EN_ESSAI : o.essai, finPrevueLe: o.finPrevue ?? null }),
      noterFinEssai: async (abonnementId, finLe) => { fins.push({ abonnementId, finLe }); return true; },
      verrous: {
        prendre: async (cles) => {
          verrous.pris.push(...cles.map(([c]) => c));
          return o.verrouTenu ? null : { jeton: 'j', cles: cles.map(([c]) => c) };
        },
        relacher: async () => { verrous.relaches += 1; },
      },
      maintenant: () => MAINTENANT,
    };
    return { d, transport: base.transport, fins, verrous };
  }
  const relu = (status: string) => ({ status: 200, json: { id: 'sub_1', status, trial_end: Date.parse('2026-11-12T08:00:00Z') / 1000 } });
  const demarreAvec = (facture: unknown) => ({ status: 200, json: { id: 'sub_1', status: 'active', trial_end: MAINTENANT / 1000, latest_invoice: facture } });
  const demarre = demarreAvec({ id: 'in_1', status: 'paid' });

  it('🔴 en essai : relu en essai chez Stripe, arrêté par trial_end=now sans prorata, hors session, refusé si impayé ; la fin notée tout de suite', async () => {
    const { d, transport, fins, verrous } = demarrer({ reponses: [relu('trialing'), demarre] });
    expect(await demarrerProMaintenant(d, 't1', 'u1')).toEqual({ ok: true, valeur: { essaiFini: true, paye: true } });
    expect(transport.appels.map((a) => a.methode)).toEqual(['GET', 'POST']);
    expect(Object.fromEntries(transport.appels[1]!.corps)).toEqual({
      trial_end: 'now', payment_behavior: 'error_if_incomplete', proration_behavior: 'none', off_session: 'true',
      'expand[0]': 'latest_invoice',
    });
    expect(transport.appels[1]!.entetes['idempotency-key']).toMatch(/^essai-fini-sub_1-/);
    expect(fins).toEqual([{ abonnementId: 'sub_1', finLe: new Date(MAINTENANT) }]);
    expect([verrous.pris, verrous.relaches]).toEqual([['pro.demarrer:t1'], 1]);
  });

  it('🔴 carte refusée : 402 paiement_refuse, l’essai continue, aucune fin notée, le verrou relâché', async () => {
    const refusee = { status: 402, json: { error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } } };
    const { d, fins, verrous } = demarrer({ reponses: [relu('trialing'), refusee] });
    expect(await demarrerProMaintenant(d, 't1', 'u1')).toMatchObject({ ok: false, statut: 402, details: { code: 'paiement_refuse' } });
    expect([fins, verrous.relaches]).toEqual([[], 1]);
  });

  it('🔴 déjà payée : en base hors essai, ou relue active chez Stripe (base en retard), 409 pas_en_essai sans aucun prélèvement', async () => {
    const enBase = demarrer({ essai: new Date(MAINTENANT - 1000) });
    expect(await demarrerProMaintenant(enBase.d, 't1', 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'pas_en_essai' } });
    expect(enBase.transport.appels).toEqual([]);
    const chezStripe = demarrer({ reponses: [relu('active')] });
    expect(await demarrerProMaintenant(chezStripe.d, 't1', 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'pas_en_essai' } });
    expect(chezStripe.transport.appels.map((a) => a.methode)).toEqual(['GET']);
  });

  it('🔴 un double clic : le second trouve le verrou tenu, 409 deja_en_cours, aucun appel chez Stripe', async () => {
    const { d, transport } = demarrer({ verrouTenu: true });
    expect(await demarrerProMaintenant(d, 't1', 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'deja_en_cours' } });
    expect(transport.appels).toEqual([]);
  });

  it('🔴 une panne passagère, avant ou après l’envoi : 503, rien de noté, le verrou GARDÉ (l’issue chez Stripe est inconnue, il échoit seul) ; sans Pro, 409 aucun_pro', async () => {
    const indisponible = { status: 503, json: { error: { message: 'indisponible' } } };
    for (const reponses of [[relu('trialing'), indisponible], [relu('trialing'), new Error('TimeoutError')], [indisponible]]) {
      const panne = demarrer({ reponses });
      expect(await demarrerProMaintenant(panne.d, 't1', 'u1')).toMatchObject({ ok: false, statut: 503, details: { code: 'paiement_indisponible' } });
      expect([panne.fins, panne.verrous.pris, panne.verrous.relaches]).toEqual([[], ['pro.demarrer:t1'], 0]);
    }
    const sansPro = demarrer({ pro: null });
    expect(await demarrerProMaintenant(sansPro.d, 't1', 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'aucun_pro' } });
  });

  it('🔴 une résiliation programmée : 409 resiliation_programmee, ni verrou ni appel chez Stripe (le premier paiement n’est pas voulu)', async () => {
    const { d, transport, verrous } = demarrer({ finPrevue: EN_ESSAI });
    expect(await demarrerProMaintenant(d, 't1', 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'resiliation_programmee' } });
    expect([transport.appels, verrous.pris]).toEqual([[], []]);
  });

  it('🔴 un prélèvement différé (SEPA) : la facture relue n’est pas payée, paye: false, la fin notée (l’essai est fini chez Stripe), le verrou relâché', async () => {
    for (const facture of [{ id: 'in_1', status: 'open' }, 'in_1', null, undefined]) {
      const { d, fins, verrous } = demarrer({ reponses: [relu('trialing'), demarreAvec(facture)] });
      expect(await demarrerProMaintenant(d, 't1', 'u1')).toEqual({ ok: true, valeur: { essaiFini: true, paye: false } });
      expect([fins.length, verrous.relaches]).toEqual([1, 1]);
    }
  });
});
