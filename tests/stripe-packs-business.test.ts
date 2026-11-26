import { describe, it, expect } from 'vitest';
import type { ReponseStripe, TransportStripe } from '../src/stripe/client';
import {
  changerPacksBusiness, changerPacksContactsDeLOffre, finDeDroitPacks, packsBusinessChezStripe, PRODUIT_PACKS_BUSINESS,
  resilierPacksChezStripe, type DepsFinDeDroitPacks, type DepsPacksBusiness,
} from '../src/stripe/packs-business';
import type { DepsPacksContacts } from '../src/stripe/packs-contacts';
import type { PacksBusiness } from '../src/offres/packs-business.pg';

/**
 * LES PACKS DE CONTACTS DU BUSINESS (lot B du plan `2026-11-26-contacts-packs-business-et-alertes-entreprise.md`) : un
 * abonnement Stripe à part, 20 € HT par mois et par pack, dont la quantité est le nombre de packs. Le premier pack passe
 * par Checkout ; les suivants changent la quantité, Stripe d'abord, la limite ensuite ; un retrait ne rembourse rien et
 * n'est accepté que si les contacts tiennent ; le dernier retiré résilie l'abonnement ; la fin du Business le résilie.
 */
const T1 = '5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01';

class FauxStripe implements TransportStripe {
  readonly posts: Array<{ url: string; corps: URLSearchParams; cle: string }> = [];
  readonly suppressions: Array<{ url: string; corps: URLSearchParams }> = [];
  constructor(readonly objets: Record<string, unknown>, private readonly reponses: ReponseStripe[] = []) {}
  async post(url: string, corps: string, entetes: Record<string, string>): Promise<ReponseStripe> {
    this.posts.push({ url, corps: new URLSearchParams(corps), cle: entetes['idempotency-key'] ?? '' });
    if (url.endsWith('/customers')) return { status: 200, json: { id: 'cus_1' } };
    if (url.endsWith('/checkout/sessions')) return { status: 200, json: { id: 'cs_1', url: 'https://checkout.stripe.com/c/1' } };
    const expiree = url.match(/\/checkout\/sessions\/(cs_[^/]+)\/expire$/);
    if (expiree) return { status: 200, json: { id: expiree[1], status: 'expired' } };
    const r = this.reponses.shift();
    if (!r) throw new Error(`appel non prévu : ${url}`);
    // L'abonnement relu ensuite est celui que la modification a rendu, si elle s'est appliquée.
    const j = r.json as { id?: string; pending_update?: unknown } | null;
    if (r.status === 200 && j?.id === 'sub_pk' && !j.pending_update) this.objets.sub_pk = { ...j, latest_invoice: 'in_prorata' };
    return r;
  }
  async delete(url: string, corps: string): Promise<ReponseStripe> {
    this.suppressions.push({ url, corps: new URLSearchParams(corps) });
    return this.reponses.shift() ?? { status: 200, json: { id: 'sub_pk', status: 'canceled' } };
  }
  async get(url: string): Promise<ReponseStripe> {
    const id = decodeURIComponent((url.split('/').pop() ?? '').split('?')[0]!);
    const o = this.objets[id];
    if (o instanceof Error) throw o;
    if (typeof o === 'number') return { status: o, json: { error: { message: 'refus' } } };
    return o === undefined ? { status: 404, json: { error: { message: 'inconnu' } } } : { status: 200, json: o };
  }
}

const PRIX = { id: 'price_pack_mois', unit_amount: 2000, currency: 'eur', recurring: { interval: 'month', interval_count: 1 } };
const abonnement = (packs: number, o: { statut?: string; facture?: string } = {}) => ({
  id: 'sub_pk', status: o.statut ?? 'active', latest_invoice: o.facture ?? 'in_avant',
  items: { data: [{ id: 'si_pk', quantity: packs, price: { id: 'price_pack_mois', unit_amount: 2000 } }] },
});
const change = (packs: number, enAttente = false): ReponseStripe => ({
  status: 200,
  json: {
    id: 'sub_pk', status: 'active', pending_update: enAttente ? { expires_at: 1_900_000_000 } : null,
    latest_invoice: { id: 'in_prorata', hosted_invoice_url: 'https://invoice.stripe.com/i/prorata' },
    items: { data: [{ id: 'si_pk', quantity: packs, price: { id: 'price_pack_mois' } }] },
  },
});
const VIVANT: PacksBusiness = {
  abonnementId: 'sub_pk', tenantId: T1, livemode: true, statut: 'actif', packs: 1, periodeFin: null, finiLe: null, finRaison: null,
};
/** Le Business de l'espace : les 5 000 contacts de la grille. */
const BUSINESS = { contactsInclus: 5000 };

function deps(o: {
  vivant?: PacksBusiness | null; prixPackMois?: string; objets?: Record<string, unknown>; reponses?: ReponseStripe[];
  contacts?: number; verrouTenu?: boolean;
} = {}) {
  const transport = new FauxStripe({ price_pack_mois: PRIX, sessions: { object: 'list', data: [] }, ...(o.objets ?? {}) }, o.reponses ?? []);
  const journal: string[] = [];
  const alertes: string[] = [];
  const verrous = { pris: [] as string[], relaches: 0 };
  const d: DepsPacksBusiness = {
    stripe: { cle: 'rk_live_x', livemode: true, transport, prix: { refill_5: '', refill_10: '', refill_50: '', refill_100: '' }, pageCredit: 'https://c/credit' } as never,
    clients: { clientDe: async () => null, retenirClient: async (_t, _l, c) => c },
    payeurAutorise: async () => true,
    urlConsole: 'https://console.messagingme.app',
    prixPackMois: o.prixPackMois ?? 'price_pack_mois',
    packs: {
      vivant: async () => (o.vivant === undefined ? null : o.vivant),
      noterPacks: async (id, packs) => { journal.push(`noter:${id}:${packs}`); return null; },
      finir: async (id, raison) => { journal.push(`finir:${id}:${raison}`); return { ...VIVANT, premiereFin: true }; },
    },
    contacts: async () => o.contacts ?? 0,
    invalider: (t) => { journal.push(`invalider:${t}`); },
    alerter: async (t) => { alertes.push(t); },
    verrous: {
      prendre: async (cles) => {
        verrous.pris.push(...cles.map(([c]) => c));
        return o.verrouTenu ? null : { jeton: 'j', cles: cles.map(([c]) => c) };
      },
      relacher: async () => { verrous.relaches += 1; },
    },
    now: () => new Date('2026-11-26T10:00:00Z'),
  };
  return { d, transport, journal, alertes, verrous };
}

describe('le premier pack du Business', () => {
  it('🔴 sans abonnement : une session Checkout d’abonnement mensuel à part, quantité 1, codes promo fermés, la marque des packs sur la session et l’abonnement', async () => {
    const { d, transport, verrous, journal } = deps();
    expect(await changerPacksBusiness(d, T1, BUSINESS, { depuis: 0, cible: 1 }, 'u1')).toEqual({ ok: true, valeur: { url: 'https://checkout.stripe.com/c/1' } });
    const session = transport.posts.find((p) => p.url.endsWith('/checkout/sessions'))!.corps;
    expect(Object.fromEntries(['mode', 'line_items[0][price]', 'line_items[0][quantity]', 'allow_promotion_codes', 'metadata[produit]',
      'subscription_data[metadata][produit]', 'subscription_data[metadata][tenant_id]'].map((k) => [k, session.get(k)])))
      .toEqual({
        mode: 'subscription', 'line_items[0][price]': 'price_pack_mois', 'line_items[0][quantity]': '1', allow_promotion_codes: 'false',
        'metadata[produit]': PRODUIT_PACKS_BUSINESS, 'subscription_data[metadata][produit]': PRODUIT_PACKS_BUSINESS,
        'subscription_data[metadata][tenant_id]': T1,
      });
    expect([...session.keys()].some((k) => k.includes('trial'))).toBe(false);
    expect(session.get('success_url')).toBe('https://console.messagingme.app/offre?packs=recus');
    expect(session.get('cancel_url')).toBe('https://console.messagingme.app/offre?packs=abandon');
    // Un achat à la fois, le verrou relâché ; rien n'est écrit chez nous avant le webhook signé.
    expect([verrous.pris, verrous.relaches]).toEqual([[`packs-business.prendre:${T1}`], 1]);
    expect(journal).toEqual([]);
  });

  it('🔴 une session des packs encore ouverte est expirée avant d’en ouvrir une autre : un seul paiement possible', async () => {
    const ouvertes = {
      object: 'list',
      data: [
        { id: 'cs_ancienne', status: 'open', customer: 'cus_1', metadata: { produit: PRODUIT_PACKS_BUSINESS, tenant_id: T1 } },
        { id: 'cs_option', status: 'open', customer: 'cus_1', metadata: { produit: 'option_credit_whatsapp', tenant_id: T1 } },
      ],
    };
    const { d, transport } = deps({ objets: { sessions: ouvertes } });
    expect(await changerPacksBusiness(d, T1, BUSINESS, { depuis: 0, cible: 1 }, 'u1')).toMatchObject({ ok: true });
    expect(transport.posts.filter((p) => p.url.endsWith('/expire')).map((p) => p.url.split('/').at(-2))).toEqual(['cs_ancienne']);
  });

  it('🔴 le prix relu chez Stripe doit valoir 20 € HT par mois, en euros : sinon rien n’est créé', async () => {
    for (const prix of [{ ...PRIX, unit_amount: 24000, recurring: { interval: 'year', interval_count: 1 } }, { ...PRIX, currency: 'usd' }, { ...PRIX, unit_amount: 1500 }]) {
      const { d, transport } = deps({ objets: { price_pack_mois: prix } });
      expect(await changerPacksBusiness(d, T1, BUSINESS, { depuis: 0, cible: 1 }, 'u1')).toMatchObject({ ok: false, statut: 422, details: { code: 'prix_incoherent' } });
      expect(transport.posts).toEqual([]);
    }
  });

  it('pas en vente, une vue périmée ou un achat déjà en cours : refusés, rien chez Stripe', async () => {
    const horsVente = deps({ prixPackMois: '' });
    expect(await changerPacksBusiness(horsVente.d, T1, BUSINESS, { depuis: 0, cible: 1 }, 'u1')).toMatchObject({ ok: false, statut: 503, details: { code: 'packs_contacts_indisponibles' } });
    // L'écran croyait un pack que l'abonnement fini n'a plus.
    const perimee = deps();
    expect(await changerPacksBusiness(perimee.d, T1, BUSINESS, { depuis: 1, cible: 2 }, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'packs_contacts_changes' } });
    const tenu = deps({ verrouTenu: true });
    expect(await changerPacksBusiness(tenu.d, T1, BUSINESS, { depuis: 0, cible: 1 }, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'packs_contacts_en_cours' } });
    expect([horsVente.transport.posts, perimee.transport.posts, tenu.transport.posts.filter((p) => p.url.endsWith('/checkout/sessions'))]).toEqual([[], [], []]);
  });
});

describe('ajouter et retirer un pack du Business', () => {
  it('🔴 un ajout : la quantité changée chez Stripe, le prorata facturé, appliqué seulement payé ; la base suit ce que Stripe REND', async () => {
    const { d, transport, journal, alertes } = deps({ vivant: VIVANT, objets: { sub_pk: abonnement(1) }, reponses: [change(2)] });
    expect(await changerPacksBusiness(d, T1, BUSINESS, { depuis: 1, cible: 2 }, 'u1')).toEqual({ ok: true, valeur: { packs: 2 } });
    const p = transport.posts.find((x) => x.url.endsWith('/subscriptions/sub_pk'))!;
    expect(Object.fromEntries(['items[0][id]', 'items[0][quantity]', 'proration_behavior', 'payment_behavior'].map((k) => [k, p.corps.get(k)])))
      .toEqual({ 'items[0][id]': 'si_pk', 'items[0][quantity]': '2', proration_behavior: 'always_invoice', payment_behavior: 'pending_if_incomplete' });
    expect(p.cle).toBe('pack-business-sub_pk-1-2-in_avant');
    expect(journal).toEqual(['noter:sub_pk:2', `invalider:${T1}`]);
    expect(alertes[0]).toMatch(/Pack de contacts du Business ajouté \(1 vers 2\)/);
  });

  it('🔴 un ajout dont le prorata n’est pas payé : rien ne change ici, la facture est proposée', async () => {
    const { d, journal } = deps({ vivant: VIVANT, objets: { sub_pk: abonnement(1) }, reponses: [change(1, true)] });
    expect(await changerPacksBusiness(d, T1, BUSINESS, { depuis: 1, cible: 2 }, 'u1'))
      .toMatchObject({ ok: false, statut: 402, details: { code: 'paiement_pack_contacts_incomplet', url: 'https://invoice.stripe.com/i/prorata' } });
    expect(journal).toEqual([]);
  });

  it('🔴 un retrait refusé tant que les contacts ne tiennent pas dans ce qui reste (la limite de /ops + les packs gardés) : rien chez Stripe', async () => {
    const { d, transport, journal } = deps({ vivant: { ...VIVANT, packs: 2 }, objets: { sub_pk: abonnement(2) }, contacts: 6001 });
    const r = await changerPacksBusiness(d, T1, BUSINESS, { depuis: 2, cible: 1 }, 'u1');
    expect(r).toMatchObject({ ok: false, statut: 409, details: { code: 'contacts_en_trop' } });
    expect(r.ok ? '' : r.erreur).toMatch(/6.001 contacts : supprimez-en d’abord 1, pour tenir dans 6.000 contacts/);
    // La limite posée dans /ops compte, pas la grille : réglé à 8 000, les 6 001 tiennent.
    const ops = deps({ vivant: { ...VIVANT, packs: 2 }, objets: { sub_pk: abonnement(2) }, reponses: [change(1)], contacts: 6001 });
    expect(await changerPacksBusiness(ops.d, T1, { contactsInclus: 8000 }, { depuis: 2, cible: 1 }, 'u1')).toEqual({ ok: true, valeur: { packs: 1 } });
    expect([transport.posts, transport.suppressions, journal]).toEqual([[], [], []]);
  });

  it('🔴 un retrait accepté : sans prorata ni remboursement, la base suit ce que Stripe rend', async () => {
    const { d, transport, journal } = deps({ vivant: { ...VIVANT, packs: 2 }, objets: { sub_pk: abonnement(2) }, reponses: [change(1)], contacts: 6000 });
    expect(await changerPacksBusiness(d, T1, BUSINESS, { depuis: 2, cible: 1 }, 'u1')).toEqual({ ok: true, valeur: { packs: 1 } });
    const p = transport.posts.find((x) => x.url.endsWith('/subscriptions/sub_pk'))!;
    expect([p.corps.get('items[0][quantity]'), p.corps.get('proration_behavior'), p.corps.get('payment_behavior')]).toEqual(['1', 'none', null]);
    expect(journal).toEqual(['noter:sub_pk:1', `invalider:${T1}`]);
  });

  it('🔴 le dernier pack retiré résilie l’abonnement, sans avoir, et le note fini ; refusé lui aussi si les contacts ne tiennent pas', async () => {
    const { d, transport, journal, alertes } = deps({ vivant: VIVANT, objets: { sub_pk: abonnement(1) }, contacts: 5000 });
    expect(await changerPacksBusiness(d, T1, BUSINESS, { depuis: 1, cible: 0 }, 'u1')).toEqual({ ok: true, valeur: { packs: 0 } });
    expect(transport.suppressions.map((s) => [s.url.split('/').pop(), s.corps.toString()])).toEqual([['sub_pk', '']]);
    expect(journal).toEqual(['finir:sub_pk:resiliation', `invalider:${T1}`]);
    expect(alertes[0]).toMatch(/Dernier pack de contacts du Business retiré .* sans remboursement/);
    const plein = deps({ vivant: VIVANT, objets: { sub_pk: abonnement(1) }, contacts: 5001 });
    expect(await changerPacksBusiness(plein.d, T1, BUSINESS, { depuis: 1, cible: 0 }, 'u1')).toMatchObject({ ok: false, details: { code: 'contacts_en_trop' } });
    expect([plein.transport.suppressions, plein.journal]).toEqual([[], []]);
  });

  it('un abonnement en retard, une ligne réglée à la main, une vue périmée : refusés ; un second clic se recale sans rien écrire chez Stripe', async () => {
    const retard = deps({ vivant: VIVANT, objets: { sub_pk: abonnement(1, { statut: 'past_due' }) } });
    expect(await changerPacksBusiness(retard.d, T1, BUSINESS, { depuis: 1, cible: 2 }, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'packs_contacts_en_retard' } });
    const deuxLignes = { ...abonnement(1), items: { data: [...abonnement(1).items.data, { id: 'si_2', quantity: 1, price: { id: 'price_pack_mois' } }] } };
    const aRegler = deps({ vivant: VIVANT, objets: { sub_pk: deuxLignes } });
    expect(await changerPacksBusiness(aRegler.d, T1, BUSINESS, { depuis: 1, cible: 2 }, 'u1')).toMatchObject({ ok: false, details: { code: 'packs_contacts_a_regler' } });
    const perimee = deps({ vivant: VIVANT, objets: { sub_pk: abonnement(3) } });
    expect(await changerPacksBusiness(perimee.d, T1, BUSINESS, { depuis: 1, cible: 2 }, 'u1')).toMatchObject({ ok: false, details: { code: 'packs_contacts_changes' } });
    const deja = deps({ vivant: VIVANT, objets: { sub_pk: abonnement(2) } });
    expect(await changerPacksBusiness(deja.d, T1, BUSINESS, { depuis: 1, cible: 2 }, 'u1')).toEqual({ ok: true, valeur: { packs: 2 } });
    expect(deja.transport.posts).toEqual([]);
    expect(deja.journal).toEqual(['noter:sub_pk:2', `invalider:${T1}`]);
  });
});

describe('la route des packs choisit son chemin sur l’offre', () => {
  const pro = (journal: string[]): DepsPacksContacts => ({
    stripe: { cle: 'rk_live_x', livemode: true, transport: new FauxStripe({}) } as never,
    prixPackMois: 'price_pack_mois', prixPackAn: 'price_pack_an', payeurAutorise: async () => true,
    proVivant: async () => { journal.push('pro'); return null; },
    contacts: async () => 0, noterPacks: async () => null, invalider: () => {}, alerter: async () => {},
  });
  it('🔴 un Business prend l’abonnement à part ; toute autre offre, le chemin du Pro (qui refuse hors Pro)', async () => {
    const journal: string[] = [];
    const b = deps();
    expect(await changerPacksContactsDeLOffre({ pro: pro(journal), business: b.d, businessDe: async () => BUSINESS }, T1, { depuis: 0, cible: 1 }, 'u1'))
      .toEqual({ ok: true, valeur: { url: 'https://checkout.stripe.com/c/1' } });
    expect(journal).toEqual([]);
    expect(await changerPacksContactsDeLOffre({ pro: pro(journal), business: b.d, businessDe: async () => null }, T1, { depuis: 0, cible: 1 }, 'u1'))
      .toMatchObject({ ok: false, statut: 409, details: { code: 'aucun_pro' } });
    expect(journal).toEqual(['pro']);
  });
});

describe('les packs du Business relus chez Stripe, et résiliés sur un impayé', () => {
  it('le statut et les packs relus ; un refus durable prévient l’équipe et rend null ; une panne passagère lève ; hors vente, rien', async () => {
    const lu = deps({ objets: { sub_pk: abonnement(3, { statut: 'past_due' }) } });
    expect(await packsBusinessChezStripe(lu.d, 'sub_pk')).toEqual({ statut: 'past_due', packs: 3 });
    const refus = deps({ objets: { sub_pk: 403 } });
    expect(await packsBusinessChezStripe(refus.d, 'sub_pk')).toBeNull();
    expect(refus.alertes[0]).toMatch(/illisibles chez Stripe \(403\)/);
    await expect(packsBusinessChezStripe(deps({ objets: { sub_pk: 503 } }).d, 'sub_pk')).rejects.toThrow();
    expect(await packsBusinessChezStripe(deps({ prixPackMois: '' }).d, 'sub_pk')).toBeNull();
  });

  it('un impayé : résilié sans avoir ; une résiliation refusée mais relue résiliée compte ; sinon l’équipe résilie à la main', async () => {
    const ok = deps();
    expect(await resilierPacksChezStripe(ok.d, 'sub_pk')).toBe(true);
    expect(ok.transport.suppressions).toHaveLength(1);
    const relue = deps({ objets: { sub_pk: abonnement(1, { statut: 'canceled' }) }, reponses: [{ status: 500, json: { error: { message: 'erreur' } } }] });
    expect(await resilierPacksChezStripe(relue.d, 'sub_pk')).toBe(true);
    const refusee = deps({ objets: { sub_pk: abonnement(1, { statut: 'unpaid' }) }, reponses: [{ status: 400, json: { error: { message: 'non' } } }] });
    expect(await resilierPacksChezStripe(refusee.d, 'sub_pk')).toBe(false);
    expect(refusee.alertes[0]).toMatch(/À résilier à la main, sans remboursement/);
  });
});

describe('🔴 la fin de droit des packs : plus de Business, plus de packs', () => {
  function fin(o: { vivant?: PacksBusiness | null; enBusiness?: boolean; refus?: ReponseStripe; relu?: unknown; stripe?: null; livemode?: boolean } = {}) {
    const transport = new FauxStripe(o.relu === undefined ? {} : { sub_pk: o.relu }, o.refus ? [o.refus] : []);
    const journal: string[] = [];
    const alertes: string[] = [];
    const d: DepsFinDeDroitPacks = {
      stripe: o.stripe === null ? null : { cle: 'rk_live_x', livemode: o.livemode ?? true, transport },
      packs: {
        vivant: async () => (o.vivant === undefined ? { ...VIVANT, packs: 2 } : o.vivant),
        finir: async (id, raison) => { journal.push(`finir:${id}:${raison}`); return { ...VIVANT, premiereFin: true }; },
      },
      enBusiness: async () => o.enBusiness ?? false,
      invalider: (t) => { journal.push(`invalider:${t}`); },
      alerter: async (t) => { alertes.push(t); },
      now: () => new Date('2026-11-26T10:00:00Z'),
    };
    return { d, transport, journal, alertes };
  }

  it('🔴 le Business retiré : l’abonnement résilié tout de suite chez Stripe, sans avoir, noté fini, l’offre en cache vidée', async () => {
    const { d, transport, journal, alertes } = fin();
    expect(await finDeDroitPacks(d, T1, 'fin_de_droit')).toBe('resilie');
    expect(transport.suppressions.map((s) => [s.url.split('/').pop(), s.corps.toString()])).toEqual([['sub_pk', '']]);
    expect(journal).toEqual(['finir:sub_pk:fin_de_droit', `invalider:${T1}`]);
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(/résiliés chez Stripe.* 2 packs \(sans remboursement\)/);
  });

  it('un Business encore posé, ou aucun pack : rien ne bouge', async () => {
    const droit = fin({ enBusiness: true });
    expect(await finDeDroitPacks(droit.d, T1, 'fin_de_droit')).toBe('garde_son_droit');
    const sans = fin({ vivant: null });
    expect(await finDeDroitPacks(sans.d, T1, 'fin_de_droit')).toBe('sans_packs');
    expect([droit.transport.suppressions, droit.journal, sans.journal]).toEqual([[], [], []]);
  });

  it('🔴 payés sans Business : résiliés, et l’équipe décide du remboursement (jamais « sans remboursement »)', async () => {
    const { d, alertes } = fin();
    expect(await finDeDroitPacks(d, T1, 'payee_sans_droit')).toBe('resilie');
    expect(alertes[0]).toMatch(/remboursement à décider/);
    expect(alertes.join(' ')).not.toMatch(/sans remboursement/);
  });

  it('🔴 une résiliation ne se compte que RELUE : refusée et relue active, à vérifier ; relue résiliée, résiliée ; noté fini dans les deux cas', async () => {
    const refusee = fin({ refus: { status: 500, json: { error: { message: 'erreur' } } }, relu: abonnement(2) });
    expect(await finDeDroitPacks(refusee.d, T1, 'fin_de_droit')).toBe('a_verifier');
    expect(refusee.alertes[0]).toMatch(/Stripe n'a pas résilié sub_pk \(500 ; relu : active\)\. À résilier à la main \(sans remboursement\)/);
    expect(refusee.journal).toEqual(['finir:sub_pk:fin_de_droit', `invalider:${T1}`]);
    const relue = fin({ refus: { status: 500, json: { error: { message: 'erreur' } } }, relu: abonnement(2, { statut: 'canceled' }) });
    expect(await finDeDroitPacks(relue.d, T1, 'fin_de_droit')).toBe('resilie');
    // Sans Stripe dans cette copie, ou dans l'autre mode : à résilier à la main, rien n'est appelé.
    for (const c of [fin({ stripe: null }), fin({ livemode: false })]) {
      expect(await finDeDroitPacks(c.d, T1, 'fin_de_droit')).toBe('a_verifier');
      expect(c.transport.suppressions).toEqual([]);
      expect(c.journal).toEqual(['finir:sub_pk:fin_de_droit', `invalider:${T1}`]);
    }
  });

  it('🔴 une panne hors Stripe (la base) prévient l’équipe, puis remonte au geste : sinon le client serait prélevé sans trace (relecture du lot B)', async () => {
    const { d, alertes } = fin();
    d.packs.vivant = async () => { throw new Error('connexion perdue'); };
    await expect(finDeDroitPacks(d, T1, 'fin_de_droit')).rejects.toThrow('connexion perdue');
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(/Fin de droit des packs de contacts de l'espace .* en échec \(connexion perdue\).*résilier à la main/);
  });
});
