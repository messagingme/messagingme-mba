import { describe, it, expect } from 'vitest';
import type { ReponseStripe, TransportStripe } from '../src/stripe/client';
import { changerPacksContacts, packsContactsChezStripe, type DepsPacksContacts } from '../src/stripe/packs-contacts';
import { CONTACTS_PAR_PACK, DROITS, PRIX_PACK_CONTACTS_HT_CENTIMES, droitsDe } from '../src/offres/offres';

/**
 * LES PACKS DE CONTACTS DU PRO (décision de Julien du 2026-11-24, plan `2026-11-24-contacts-packs-et-remplacement.md`,
 * lot 1), calqués sur les sièges (`tests/stripe-sieges.test.ts`) : la quantité change chez Stripe D'ABORD, le prorata
 * facturé tout de suite et seulement s'il est payé ; la limite ne suit qu'ensuite, sur ce que Stripe a rendu. Un retrait
 * est refusé tant que les contacts comptés ne tiennent pas dans ce qui reste.
 */
const T1 = '5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01';

class FauxStripe implements TransportStripe {
  readonly posts: Array<{ url: string; corps: URLSearchParams; cle: string }> = [];
  readonly lus: string[] = [];
  constructor(
    private readonly objets: Record<string, unknown>, private readonly reponses: ReponseStripe[],
    /** L'abonnement tel que Stripe le relit après la modification ; absent, celui que la modification a rendu. */
    private readonly apresPost?: unknown,
  ) {}
  async post(url: string, corps: string, entetes: Record<string, string>): Promise<ReponseStripe> {
    this.posts.push({ url, corps: new URLSearchParams(corps), cle: entetes['idempotency-key'] ?? '' });
    const r = this.reponses.shift();
    if (!r) throw new Error('appel non prévu');
    const j = r.json as { id?: string; pending_update?: unknown } | null;
    if (r.status === 200 && j?.id === 'sub_pro1' && !j.pending_update) this.objets.sub_pro1 = this.apresPost ?? { ...j, latest_invoice: 'in_prorata' };
    return r;
  }
  async delete(): Promise<ReponseStripe> {
    throw new Error('arrêt d’abonnement non prévu');
  }
  async get(url: string): Promise<ReponseStripe> {
    this.lus.push(url);
    const id = decodeURIComponent((url.split('/').pop() ?? '').split('?')[0]!);
    const o = this.objets[id];
    return o === undefined ? { status: 404, json: { error: { message: 'inconnu' } } } : { status: 200, json: o };
  }
}

const PACK_MOIS = { id: 'price_pack_mois', unit_amount: 2000, currency: 'eur', recurring: { interval: 'month', interval_count: 1 } };
const PACK_AN = { id: 'price_pack_an', unit_amount: 24000, currency: 'eur', recurring: { interval: 'year', interval_count: 1 } };
const LIGNE_PRO = { id: 'si_pro', quantity: 1, price: { id: 'price_pro_mois' } };
// Un siège sur le même abonnement : ni un pack, ni compté comme tel.
const LIGNE_SIEGE = { id: 'si_siege', quantity: 2, price: { id: 'price_siege_mois' } };

const abonnement = (o: { statut?: string; packs?: number; prixPack?: string; autres?: unknown[]; facture?: string } = {}) => ({
  id: 'sub_pro1',
  status: o.statut ?? 'active',
  latest_invoice: o.facture ?? 'in_avant',
  items: {
    data: [
      LIGNE_PRO, LIGNE_SIEGE,
      ...(o.packs ? [{ id: 'si_pack', quantity: o.packs, price: { id: o.prixPack ?? 'price_pack_mois' } }] : []),
      ...(o.autres ?? []),
    ],
  },
});

/** La réponse de Stripe à la modification : appliquée (`pending_update` nul) ou en attente de paiement. */
const change = (packs: number, o: { enAttente?: boolean; prixPack?: string } = {}): ReponseStripe => ({
  status: 200,
  json: {
    id: 'sub_pro1',
    status: 'active',
    pending_update: o.enAttente ? { expires_at: 1_900_000_000 } : null,
    latest_invoice: { id: 'in_prorata', status: o.enAttente ? 'open' : 'paid', hosted_invoice_url: 'https://invoice.stripe.com/i/prorata' },
    items: {
      data: [LIGNE_PRO, LIGNE_SIEGE, ...(packs > 0 ? [{ id: 'si_pack', quantity: packs, price: { id: o.prixPack ?? 'price_pack_mois' } }] : [])],
    },
  },
});

function deps(o: {
  sub?: unknown; reponses?: ReponseStripe[]; pro?: { periodicite: 'mois' | 'an' } | null; contacts?: number;
  prix?: Record<string, unknown>; prixVides?: boolean; autorise?: boolean; apresPost?: unknown;
} = {}) {
  const transport = new FauxStripe(
    { sub_pro1: o.sub ?? abonnement(), ...(o.prix ?? { price_pack_mois: PACK_MOIS, price_pack_an: PACK_AN }) },
    o.reponses ?? [],
    o.apresPost,
  );
  const notes: Array<[string, number]> = [];
  const invalides: string[] = [];
  const alertes: string[] = [];
  const d: DepsPacksContacts = {
    stripe: { cle: 'rk_test_fausse', livemode: false, prix: { refill_5: '', refill_10: '', refill_50: '', refill_100: '' }, transport, pageCredit: 'https://x', pageClaude: 'https://x' },
    prixPackMois: o.prixVides ? '' : 'price_pack_mois',
    prixPackAn: o.prixVides ? '' : 'price_pack_an',
    payeurAutorise: async () => o.autorise ?? true,
    proVivant: async () => (o.pro === null ? null : { abonnementId: 'sub_pro1', periodicite: o.pro?.periodicite ?? 'mois' }),
    contacts: async () => o.contacts ?? 900,
    noterPacks: async (a, n) => { notes.push([a, n]); return { tenantId: T1 }; },
    invalider: (t) => { invalides.push(t); },
    alerter: async (t) => { alertes.push(t); },
  };
  return { d, transport, notes, invalides, alertes };
}

describe('🔴 la limite de contacts du Pro et ses packs (droitsDe, et là seulement)', () => {
  it('1 000 contacts de plus par pack, en Pro et en Business (2026-11-26) : la Free garde sa grille, l’Entreprise son devis', () => {
    expect(CONTACTS_PAR_PACK).toBe(1000);
    expect(PRIX_PACK_CONTACTS_HT_CENTIMES).toEqual({ mois: 2000, an: 24000 });
    expect(droitsDe('pro', null).limites.contacts).toBe(1000);
    expect(droitsDe('pro', null, 0, 2).limites.contacts).toBe(3000);
    expect(droitsDe('pro', null, 1, 2).limites.utilisateurs).toBe(4);
    expect(droitsDe('pro', null, 0, -3).limites.contacts).toBe(1000);
    // Le Business a ses propres packs, sur un abonnement à part (`src/stripe/packs-business.ts`) : l'appelant passe les siens.
    expect(droitsDe('business', null, 0, 4).limites.contacts).toBe((DROITS.business.limites.contacts ?? 0) + 4000);
    expect(droitsDe('base', null, 0, 4).limites.contacts).toBe(DROITS.base.limites.contacts);
    expect(droitsDe('entreprise', { utilisateurs: null, conservationJours: null, contacts: 10_000 }, 0, 4).limites.contacts).toBe(10_000);
    // Copie neuve : la grille n'est jamais touchée.
    expect(DROITS.pro.limites.contacts).toBe(1000);
  });
});

describe('🔴 ajouter 1 000 contacts (un pack)', () => {
  it('le premier pack d’un Pro mensuel : le prix relu, une ligne ajoutée, prorata facturé tout de suite et seulement s’il est payé', async () => {
    const { d, transport, notes, invalides, alertes } = deps({ reponses: [change(1)] });
    expect(await changerPacksContacts(d, T1, { depuis: 0, cible: 1 }, 'u1')).toEqual({ ok: true, valeur: { packs: 1 } });
    expect(transport.lus.some((u) => u.endsWith('/prices/price_pack_mois'))).toBe(true);
    expect(transport.posts).toHaveLength(1);
    const p = transport.posts[0]!;
    expect(p.url).toMatch(/\/subscriptions\/sub_pro1$/);
    expect(p.corps.get('items[0][price]')).toBe('price_pack_mois');
    expect(p.corps.get('items[0][quantity]')).toBe('1');
    expect(p.corps.get('proration_behavior')).toBe('always_invoice');
    expect(p.corps.get('payment_behavior')).toBe('pending_if_incomplete');
    // Un double clic rejoue la même clé : Stripe rend la même réponse sans facturer deux fois. Une clé à part des sièges.
    expect(p.cle).toBe('pack-contacts-sub_pro1-0-1-in_avant');
    expect(notes).toEqual([['sub_pro1', 1]]);
    expect(invalides).toEqual([T1]);
    expect(alertes[0]).toMatch(/sub_pro1/);
  });

  it('un Pro annuel reçoit le pack ANNUEL ; un deuxième pack change la quantité de la ligne existante', async () => {
    const { d, transport, notes } = deps({ pro: { periodicite: 'an' }, sub: abonnement({ packs: 1, prixPack: 'price_pack_an' }), reponses: [change(2, { prixPack: 'price_pack_an' })] });
    expect(await changerPacksContacts(d, T1, { depuis: 1, cible: 2 }, 'u1')).toEqual({ ok: true, valeur: { packs: 2 } });
    expect(transport.lus.some((u) => u.endsWith('/prices/price_pack_an'))).toBe(true);
    const p = transport.posts[0]!;
    expect(p.corps.get('items[0][id]')).toBe('si_pack');
    expect(p.corps.get('items[0][quantity]')).toBe('2');
    expect(p.corps.has('items[0][price]')).toBe(false);
    expect(notes).toEqual([['sub_pro1', 2]]);
  });

  it('🔴 le prorata pas payé (carte refusée, authentification demandée) : rien n’est noté, la facture est rendue à régler', async () => {
    const { d, notes, invalides } = deps({ reponses: [change(0, { enAttente: true })] });
    const r = await changerPacksContacts(d, T1, { depuis: 0, cible: 1 }, 'u1');
    expect(r).toMatchObject({ ok: false, statut: 402, details: { code: 'paiement_pack_contacts_incomplet', url: 'https://invoice.stripe.com/i/prorata' } });
    expect(notes).toEqual([]);
    expect(invalides).toEqual([]);
  });

  it('🔴 un prix de pack qui ne vaut pas 20 € par mois, ou pas en euros, ou pas mensuel : 422, rien n’est écrit chez Stripe', async () => {
    for (const faux of [{ ...PACK_MOIS, unit_amount: 1500 }, { ...PACK_MOIS, currency: 'usd' }, { ...PACK_MOIS, recurring: { interval: 'year', interval_count: 1 } }]) {
      const { d, transport, notes } = deps({ prix: { price_pack_mois: faux, price_pack_an: PACK_AN } });
      expect(await changerPacksContacts(d, T1, { depuis: 0, cible: 1 }, 'u1')).toMatchObject({ ok: false, statut: 422, details: { code: 'prix_incoherent' } });
      expect([transport.posts, notes]).toEqual([[], []]);
    }
  });

  it('la quantité déjà atteinte (un second clic après le premier) : rien d’écrit chez Stripe, la base se recale', async () => {
    const { d, transport, notes } = deps({ sub: abonnement({ packs: 1 }) });
    expect(await changerPacksContacts(d, T1, { depuis: 0, cible: 1 }, 'u1')).toEqual({ ok: true, valeur: { packs: 1 } });
    expect(transport.posts).toEqual([]);
    expect(notes).toEqual([['sub_pro1', 1]]);
  });
});

describe('🔴 l’état de départ, l’idempotence et la relecture', () => {
  it('🔴 un état de départ périmé (deux onglets) : 409, rien ne change chez Stripe ; un « Ajouter » ne retire jamais', async () => {
    const { d, transport, notes } = deps({ sub: abonnement({ packs: 2 }) });
    expect(await changerPacksContacts(d, T1, { depuis: 0, cible: 1 }, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'packs_contacts_changes' } });
    expect([transport.posts, notes]).toEqual([[], []]);
  });

  it('🔴 la base note ce que Stripe RELIT après la modification, pas la réponse (un rejeu idempotent peut être plus ancien)', async () => {
    const { d, notes } = deps({ reponses: [change(1)], apresPost: abonnement() });
    expect(await changerPacksContacts(d, T1, { depuis: 0, cible: 1 }, 'u1')).toEqual({ ok: true, valeur: { packs: 0 } });
    expect(notes).toEqual([['sub_pro1', 0]]);
  });

  it('la même modification déjà en cours chez Stripe (`idempotency_key_in_use`) : 409 à réessayer', async () => {
    const { d, notes } = deps({ reponses: [{ status: 409, json: { error: { type: 'idempotency_error', code: 'idempotency_key_in_use', message: 'en cours' } } }] });
    expect(await changerPacksContacts(d, T1, { depuis: 0, cible: 1 }, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'packs_contacts_en_cours' } });
    expect(notes).toEqual([]);
  });
});

describe('les refus avant tout appel qui écrit', () => {
  it('packs pas en vente (prix pas posés) ou payeur refusé : 503, rien n’est lu', async () => {
    const vides = deps({ prixVides: true });
    expect(await changerPacksContacts(vides.d, T1, { depuis: 0, cible: 1 }, 'u1')).toMatchObject({ ok: false, statut: 503, details: { code: 'packs_contacts_indisponibles' } });
    const refuse = deps({ autorise: false });
    expect(await changerPacksContacts(refuse.d, T1, { depuis: 0, cible: 1 }, 'u1')).toMatchObject({ ok: false, statut: 503 });
    expect([...vides.transport.lus, ...refuse.transport.lus]).toEqual([]);
  });

  it('pas de Pro vivant (une Free, un Business) : 409, les contacts en plus s’ajoutent à un Pro', async () => {
    const { d, transport } = deps({ pro: null });
    expect(await changerPacksContacts(d, T1, { depuis: 0, cible: 1 }, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'aucun_pro' } });
    expect(transport.lus).toEqual([]);
  });

  it('🔴 un Pro en retard de paiement : 409, la facture du Pro d’abord', async () => {
    const { d, transport } = deps({ sub: abonnement({ statut: 'past_due' }) });
    expect(await changerPacksContacts(d, T1, { depuis: 0, cible: 1 }, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'pro_en_retard' } });
    expect(transport.posts).toEqual([]);
  });

  it('un pack posé à la main dans l’autre formule, ou sur deux lignes : 409, à régler avec nous', async () => {
    const autre = deps({ sub: abonnement({ packs: 1, prixPack: 'price_pack_an' }) });
    expect(await changerPacksContacts(autre.d, T1, { depuis: 1, cible: 2 }, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'packs_contacts_a_regler' } });
    const deux = deps({ sub: abonnement({ packs: 1, autres: [{ id: 'si_pack2', quantity: 1, price: { id: 'price_pack_mois' } }] }) });
    expect(await changerPacksContacts(deux.d, T1, { depuis: 2, cible: 3 }, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'packs_contacts_a_regler' } });
    expect([...autre.transport.posts, ...deux.transport.posts]).toEqual([]);
  });
});

describe('retirer un pack, sans remboursement ni effacement', () => {
  it('🔴 refusé tant que les contacts comptés ne tiennent pas dans 1 000 + 1 000 × la cible : rien n’est effacé, la phrase dit combien supprimer', async () => {
    const { d, transport, notes } = deps({ sub: abonnement({ packs: 2 }), contacts: 2500 });
    const r = await changerPacksContacts(d, T1, { depuis: 2, cible: 1 }, 'u1');
    expect(r).toMatchObject({ ok: false, statut: 409, details: { code: 'contacts_en_trop' } });
    expect(r.ok ? '' : r.erreur).toMatch(/2.500 contacts.*500.*2.000 contacts/);
    expect([transport.posts, notes]).toEqual([[], []]);
  });

  it('les contacts tiennent pile : la quantité baisse sans prorata ni paiement ; à zéro, la ligne est supprimée', async () => {
    const un = deps({ sub: abonnement({ packs: 2 }), contacts: 2000, reponses: [change(1)] });
    expect(await changerPacksContacts(un.d, T1, { depuis: 2, cible: 1 }, 'u1')).toEqual({ ok: true, valeur: { packs: 1 } });
    const p = un.transport.posts[0]!;
    expect(p.corps.get('items[0][id]')).toBe('si_pack');
    expect(p.corps.get('items[0][quantity]')).toBe('1');
    expect(p.corps.get('proration_behavior')).toBe('none');
    expect(p.corps.has('payment_behavior')).toBe(false);
    expect(un.notes).toEqual([['sub_pro1', 1]]);

    const zero = deps({ sub: abonnement({ packs: 1 }), contacts: 1000, reponses: [change(0)] });
    expect(await changerPacksContacts(zero.d, T1, { depuis: 1, cible: 0 }, 'u1')).toEqual({ ok: true, valeur: { packs: 0 } });
    expect(zero.transport.posts[0]!.corps.get('items[0][deleted]')).toBe('true');
  });
});

describe('les packs relus chez Stripe pour le webhook', () => {
  it('🔴 la somme des lignes de pack, quelle que soit leur formule ; ni la ligne du Pro ni celle des sièges ne comptent', async () => {
    const { d } = deps({ sub: abonnement({ packs: 2, autres: [{ id: 'si_pack2', quantity: 1, price: { id: 'price_pack_an' } }] }) });
    expect(await packsContactsChezStripe(d, 'sub_pro1')).toBe(3);
  });

  it('🔴 un refus DURABLE (réponse illisible, 4xx) : Julien prévenu, `null` pour ne pas bloquer la mise à jour du Pro', async () => {
    const { d, alertes } = deps({ sub: { id: 'sub_pro1', status: 'active' } });
    expect(await packsContactsChezStripe(d, 'sub_pro1')).toBeNull();
    expect(alertes[0]).toMatch(/sub_pro1/);
    expect(await packsContactsChezStripe(deps().d, 'sub_inconnu')).toBeNull();
  });

  it('une panne passagère (5xx, réseau) lève : le webhook échoue et Stripe rejouera ; pas en vente : `null`, aucun appel', async () => {
    const { d } = deps();
    const panne: TransportStripe = {
      post: async () => { throw new Error('non prévu'); }, delete: async () => { throw new Error('non prévu'); },
      get: async () => ({ status: 503, json: { error: { message: 'indisponible' } } }),
    };
    await expect(packsContactsChezStripe({ ...d, stripe: { ...d.stripe!, transport: panne } }, 'sub_pro1')).rejects.toThrow();
    const vides = deps({ prixVides: true });
    expect(await packsContactsChezStripe(vides.d, 'sub_pro1')).toBeNull();
    expect(vides.transport.lus).toEqual([]);
  });
});
