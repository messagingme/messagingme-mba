import { describe, it, expect } from 'vitest';
import type { ReponseStripe, TransportStripe } from '../src/stripe/client';
import { HTTP_TIMEOUT_DEFAUT_MS } from '../src/meta/http';
import {
  brancherFinDeDroit, changerPlaces, finDeDroitOption, optionChezStripe, ouvrirOption, PRODUIT_OPTION_WA, resilierOptionChezStripe,
  type DepsFinDeDroitOption, type DepsOptionCredit,
} from '../src/stripe/option-credit-whatsapp';
import type { Offre } from '../src/offres/offres';
import type { OptionCredit } from '../src/credit-whatsapp/options.pg';

/**
 * L'OPTION DU CRÉDIT WHATSAPP (lot 4a) : 30 € HT par numéro et par mois, la quantité de l'abonnement est le nombre de places.
 * Comme les sièges du Pro, Stripe d'abord, les places ensuite ; sans essai, codes promo fermés ; et la fin de droit qui
 * résilie sans remboursement et arrête les lignes de l'option.
 */
const T1 = '5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01';

class FauxStripe implements TransportStripe {
  readonly posts: Array<{ url: string; corps: URLSearchParams; cle: string }> = [];
  readonly suppressions: Array<{ url: string; corps: URLSearchParams }> = [];
  readonly lectures: string[] = [];
  constructor(private readonly objets: Record<string, unknown>, private readonly reponses: ReponseStripe[] = []) {}
  async post(url: string, corps: string, entetes: Record<string, string>): Promise<ReponseStripe> {
    this.posts.push({ url, corps: new URLSearchParams(corps), cle: entetes['idempotency-key'] ?? '' });
    if (url.endsWith('/customers')) return { status: 200, json: { id: 'cus_1' } };
    if (url.endsWith('/checkout/sessions')) return { status: 200, json: { id: 'cs_1', url: 'https://checkout.stripe.com/c/1' } };
    // Une session expirée (jaune 11 du lot B) : Stripe la rend, son statut `expired`.
    const expiree = url.match(/\/checkout\/sessions\/(cs_[^/]+)\/expire$/);
    if (expiree) return { status: 200, json: { id: expiree[1], status: 'expired' } };
    const r = this.reponses.shift();
    if (!r) throw new Error(`appel non prévu : ${url}`);
    // L'abonnement relu ensuite est celui que la modification a rendu, si elle s'est appliquée.
    const j = r.json as { id?: string; pending_update?: unknown } | null;
    if (r.status === 200 && j?.id === 'sub_opt' && !j.pending_update) this.objets.sub_opt = { ...j, latest_invoice: 'in_prorata' };
    return r;
  }
  async delete(url: string, corps: string): Promise<ReponseStripe> {
    this.suppressions.push({ url, corps: new URLSearchParams(corps) });
    return this.reponses.shift() ?? { status: 200, json: { id: 'sub_opt', status: 'canceled' } };
  }
  async get(url: string): Promise<ReponseStripe> {
    this.lectures.push(url);
    const id = decodeURIComponent((url.split('/').pop() ?? '').split('?')[0]!);
    const o = this.objets[id];
    if (o instanceof Error) throw o;
    if (typeof o === 'number') return { status: o, json: { error: { message: 'refus' } } };
    return o === undefined ? { status: 404, json: { error: { message: 'inconnu' } } } : { status: 200, json: o };
  }
}

const PRIX = { id: 'price_opt', unit_amount: 3000, currency: 'eur', recurring: { interval: 'month', interval_count: 1 } };
const abonnement = (places: number, o: { statut?: string; facture?: string } = {}) => ({
  id: 'sub_opt', status: o.statut ?? 'active', latest_invoice: o.facture ?? 'in_avant',
  items: { data: [{ id: 'si_opt', quantity: places, price: { id: 'price_opt', unit_amount: 3000 } }] },
});
const change = (places: number, enAttente = false): ReponseStripe => ({
  status: 200,
  json: {
    id: 'sub_opt', status: 'active', pending_update: enAttente ? { expires_at: 1_900_000_000 } : null,
    latest_invoice: { id: 'in_prorata', hosted_invoice_url: 'https://invoice.stripe.com/i/prorata' },
    items: { data: [{ id: 'si_opt', quantity: places, price: { id: 'price_opt' } }] },
  },
});
const OPTION: OptionCredit = {
  abonnementId: 'sub_opt', tenantId: T1, livemode: true, statut: 'actif', places: 1, periodeFin: null, finPrevueLe: null, finiLe: null, finRaison: null,
};

function deps(o: {
  offre?: Offre; vivante?: OptionCredit | null; prixOption?: string; objets?: Record<string, unknown>; reponses?: ReponseStripe[]; couverts?: number;
  formulePayee?: boolean;
  /** La règle de la prise (`optionPrenable`, V1 du plan du 2026-11-10) : un Pro en essai la prend. Vraie par défaut. */
  optionPrenable?: boolean;
  /** La formule Pro en retard de paiement (relecture du lot C5, jaune 7). */
  formuleEnRetard?: boolean;
  /** Le verrou de la prise déjà tenu par un autre clic (jaune 7 du lot C). */
  verrouTenu?: boolean;
  /** Le numéro de l'espace connecté avec sa carte chez Meta (décision de Julien du 2026-11-13) ; non par défaut. */
  numeroAvecCarte?: boolean;
} = {}) {
  // Les sessions Checkout ouvertes du client (jaune 11) : aucune par défaut.
  const transport = new FauxStripe({ price_opt: PRIX, sessions: { object: 'list', data: [] }, ...(o.objets ?? {}) }, o.reponses ?? []);
  const notes: Array<[string, number, Date | null]> = [];
  const alertes: string[] = [];
  const reprises: string[] = [];
  const verrous = { pris: [] as string[], relaches: 0 };
  const d: DepsOptionCredit = {
    stripe: { cle: 'rk_live_x', livemode: true, transport, prix: { refill_5: '', refill_10: '', refill_50: '', refill_100: '' }, pageCredit: 'https://c/credit' } as never,
    clients: { clientDe: async () => null, retenirClient: async (_t, _l, c) => c },
    payeurAutorise: async () => true,
    urlConsole: 'https://console.messagingme.app',
    prixOption: o.prixOption ?? 'price_opt',
    options: {
      vivante: async () => (o.vivante === undefined ? null : o.vivante),
      noterPlaces: async (id, places, fin) => { notes.push([id, places, fin]); return null; },
    },
    offre: async () => o.offre ?? 'pro',
    formuleEtPrise: async () => ({ formulePayee: o.formulePayee ?? true, prisePossible: o.optionPrenable ?? true }),
    optionPrenable: async () => o.optionPrenable ?? true,
    formuleEnRetard: async () => o.formuleEnRetard ?? false,
    numeroAvecCarte: async () => o.numeroAvecCarte ?? false,
    numerosCouverts: async () => o.couverts ?? 0,
    reprendreCampagnes: async (t) => { reprises.push(t); return 0; },
    alerter: async (t) => { alertes.push(t); },
    verrous: {
      prendre: async (cles) => {
        verrous.pris.push(...cles.map(([c]) => c));
        return o.verrouTenu ? null : { jeton: 'j', cles: cles.map(([c]) => c) };
      },
      relacher: async () => { verrous.relaches += 1; },
    },
  };
  return { d, transport, notes, alertes, reprises, verrous };
}

describe('ouvrir l’option', () => {
  it('🔴 un Pro : Checkout d’abonnement à la quantité demandée, codes promo fermés, jamais d’essai, la marque sur la session et l’abonnement', async () => {
    const { d, transport } = deps();
    expect(await ouvrirOption(d, T1, 2, 'u1')).toEqual({ ok: true, valeur: { url: 'https://checkout.stripe.com/c/1' } });
    const session = transport.posts.find((p) => p.url.endsWith('/checkout/sessions'))!.corps;
    expect(Object.fromEntries(['mode', 'line_items[0][price]', 'line_items[0][quantity]', 'allow_promotion_codes', 'metadata[produit]', 'subscription_data[metadata][produit]', 'subscription_data[metadata][tenant_id]'].map((k) => [k, session.get(k)])))
      .toEqual({
        mode: 'subscription', 'line_items[0][price]': 'price_opt', 'line_items[0][quantity]': '2', allow_promotion_codes: 'false',
        'metadata[produit]': PRODUIT_OPTION_WA, 'subscription_data[metadata][produit]': PRODUIT_OPTION_WA, 'subscription_data[metadata][tenant_id]': T1,
      });
    expect([...session.keys()].some((k) => k.includes('trial'))).toBe(false);
    expect(session.get('success_url')).toBe('https://console.messagingme.app/offre?tab=whatsapp&option=recue');
  });

  it('🔴 une session de l’option encore ouverte (deux onglets, une carte périmée) est expirée avant d’en ouvrir une autre : un seul paiement possible (jaune 11 du lot B)', async () => {
    const ouvertes = {
      object: 'list',
      data: [
        { id: 'cs_ancienne', status: 'open', customer: 'cus_1', metadata: { produit: PRODUIT_OPTION_WA, tenant_id: T1 } },
        // Une session du Pro, ou d'un autre client, n'est pas la nôtre : elle reste ouverte.
        { id: 'cs_pro', status: 'open', customer: 'cus_1', metadata: { produit: 'pro', tenant_id: T1 } },
        { id: 'cs_autre', status: 'open', customer: 'cus_2', metadata: { produit: PRODUIT_OPTION_WA, tenant_id: T1 } },
      ],
    };
    const { d, transport } = deps({ objets: { sessions: ouvertes } });
    expect(await ouvrirOption(d, T1, 1, 'u1')).toMatchObject({ ok: true });
    const chemins = transport.posts.map((p) => new URL(p.url).pathname);
    expect(chemins).toEqual(['/v1/customers', '/v1/checkout/sessions/cs_ancienne/expire', '/v1/checkout/sessions']);
    const liste = new URL(transport.lectures.find((u) => new URL(u).pathname === '/v1/checkout/sessions')!);
    expect([liste.searchParams.get('customer'), liste.searchParams.get('status')]).toEqual(['cus_1', 'open']);
  });

  it('🔴 un second clic pendant une prise (deux onglets) : 409 option_en_cours, ni client ni session chez Stripe ; une prise faite relâche son verrou (jaune 7 du lot C)', async () => {
    const tenu = deps({ verrouTenu: true });
    expect(await ouvrirOption(tenu.d, T1, 1, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'option_en_cours' } });
    expect(tenu.transport.posts).toEqual([]);
    expect(tenu.verrous).toEqual({ pris: [`option.prendre:${T1}`], relaches: 0 });
    const libre = deps();
    expect(await ouvrirOption(libre.d, T1, 1, 'u1')).toMatchObject({ ok: true });
    expect(libre.verrous).toEqual({ pris: [`option.prendre:${T1}`], relaches: 1 });
  });

  it('🔴 depuis les cartes « Qui règle Meta ? » (lot B), le retour de Stripe ramène sur Connecter WhatsApp, payé ou abandonné', async () => {
    const { d, transport } = deps();
    expect(await ouvrirOption(d, T1, 1, 'u1', 'connecter')).toMatchObject({ ok: true });
    const session = transport.posts.find((p) => p.url.endsWith('/checkout/sessions'))!.corps;
    expect([session.get('success_url'), session.get('cancel_url')]).toEqual([
      'https://console.messagingme.app/connecter-whatsapp?option=recue',
      'https://console.messagingme.app/connecter-whatsapp?option=abandon',
    ]);
  });

  it('🔴 depuis Claude (take_credit_line), le retour de Stripe ramène sur la page publique « paiement reçu » de l’option, payée ou abandonnée', async () => {
    const { d, transport } = deps();
    expect(await ouvrirOption(d, T1, 1, 'u1', 'claude')).toMatchObject({ ok: true });
    const session = transport.posts.find((p) => p.url.endsWith('/checkout/sessions'))!.corps;
    expect([session.get('success_url'), session.get('cancel_url')]).toEqual([
      'https://console.messagingme.app/paiement-recu?produit=option_credit_whatsapp',
      'https://console.messagingme.app/paiement-recu?produit=option_credit_whatsapp&abonnement=abandon',
    ]);
  });

  it('🔴 rien ne part chez Stripe : sans prix, en Free, en Entreprise, déjà prise, hors des bornes', async () => {
    const cas: Array<[string, Parameters<typeof deps>[0], number, number, string]> = [
      ['sans prix', { prixOption: '' }, 1, 503, 'option_indisponible'],
      ['Free', { offre: 'base' }, 1, 409, 'option_avec_le_pro'],
      ['Entreprise', { offre: 'entreprise' }, 1, 409, 'option_inutile'],
      // Un Business en essai attend la confirmation de Julien (AskUserQuestion du 2026-11-10) ; un Pro en essai, non (V1).
      ['Business en essai', { offre: 'business', formulePayee: false, optionPrenable: false }, 1, 409, 'option_apres_essai'],
      // Relecture du lot C5, jaune 7 (décision de Julien du 2026-11-09) : un Pro en retard lit la vraie raison.
      ['Pro en retard', { formulePayee: false, optionPrenable: false, formuleEnRetard: true }, 1, 409, 'formule_en_retard'],
      ['déjà prise', { vivante: OPTION }, 1, 409, 'option_deja_prise'],
      // Décision de Julien du 2026-11-13 : Meta refuse qu'un numéro servi en direct passe sur la ligne, l'option ne s'y vend plus.
      ['numéro connecté avec sa carte', { numeroAvecCarte: true }, 1, 409, 'numero_avec_carte'],
      ['zéro', {}, 0, 400, 'places_invalides'],
      ['vingt et un', {}, 21, 400, 'places_invalides'],
    ];
    for (const [nom, o, places, statut, code] of cas) {
      const { d, transport } = deps(o);
      expect(await ouvrirOption(d, T1, places, 'u1'), nom).toMatchObject({ ok: false, statut, details: { code } });
      expect(transport.posts, nom).toEqual([]);
    }
  });

  it('🔴 un numéro connecté avec sa carte : le refus dit le texte validé par Julien (version A, 2026-11-13), avant les refus de la formule', async () => {
    const refus = JSON.stringify(await ouvrirOption(deps({ numeroAvecCarte: true }).d, T1, 1, 'u1'));
    expect(refus).toContain('Votre numéro est connecté avec votre carte chez Meta : la ligne de crédit ne peut pas le prendre en charge. Pour changer, écrivez au Support.');
    // Le numéro d'abord, comme la console : sa raison est définitive, celle de la formule passe (un Business confirmé, un
    // retard réglé, et l'option resterait refusée). Un Business en essai ou un Pro en retard lit donc celle de son numéro.
    for (const o of [{ offre: 'business' as const, optionPrenable: false }, { optionPrenable: false, formuleEnRetard: true }]) {
      const r = await ouvrirOption(deps({ numeroAvecCarte: true, ...o }).d, T1, 1, 'u1');
      expect(r, JSON.stringify(o)).toMatchObject({ ok: false, details: { code: 'numero_avec_carte' } });
    }
  });

  it('🔴 un Pro en essai prend l’option et la paie tout de suite, sa formule pas encore payée (décisions de Julien du 2026-11-10, V1)', async () => {
    // La règle de la prise (`optionPrenable`), jamais celle du paiement de la formule : l'essai de 14 jours ne la ferme plus.
    const { d, transport } = deps({ formulePayee: false, optionPrenable: true });
    expect(await ouvrirOption(d, T1, 1, 'u1')).toEqual({ ok: true, valeur: { url: 'https://checkout.stripe.com/c/1' } });
    // Sans essai pour l'option, qui se paie dès sa prise : seule la formule Pro attend la fin des 14 jours.
    const session = transport.posts.find((p) => p.url.endsWith('/checkout/sessions'))!.corps;
    expect([...session.keys()].some((k) => k.includes('trial'))).toBe(false);
  });

  it('🔴 une formule Pro en retard lit la vraie raison du refus ; un Business en essai, la sienne (relecture du lot C5, jaune 7 ; V1)', async () => {
    // Décision de Julien du 2026-11-09 : la prise est la seule porte (l'onglet, les cartes), le refus y dit la raison.
    const enRetard = JSON.stringify(await ouvrirOption(deps({ formulePayee: false, optionPrenable: false, formuleEnRetard: true }).d, T1, 1, 'u1'));
    expect(enRetard).toContain('Le paiement de votre formule Pro est en retard : réglez-le, puis prenez l’option.');
    expect(enRetard).not.toContain('essai');
    const business = JSON.stringify(await ouvrirOption(deps({ offre: 'business', formulePayee: false, optionPrenable: false }).d, T1, 1, 'u1'));
    expect(business).toContain('L’option Ligne de crédit s’ouvre quand votre formule Business est confirmée.');
    expect(business).not.toContain('pas pendant un essai');
  });

  it('🔴 un prix posé chez Stripe qui ne vaut pas 30 € HT par mois : refus lisible, aucune session', async () => {
    const { d, transport } = deps({ objets: { price_opt: { ...PRIX, unit_amount: 2900 } } });
    expect(await ouvrirOption(d, T1, 1, 'u1')).toMatchObject({ ok: false, statut: 422, details: { code: 'prix_incoherent' } });
    expect(transport.posts.some((p) => p.url.endsWith('/checkout/sessions'))).toBe(false);
  });
});

describe('changer les places', () => {
  it('🔴 un ajout se facture au prorata et ne compte que payé : les places notées sont celles que Stripe RELIT', async () => {
    const { d, transport, notes, reprises } = deps({ vivante: OPTION, objets: { sub_opt: abonnement(1) }, reponses: [change(2)] });
    expect(await changerPlaces(d, T1, { depuis: 1, cible: 2 }, 'u1')).toEqual({ ok: true, valeur: { places: 2 } });
    const modif = transport.posts.find((p) => p.url.endsWith('/subscriptions/sub_opt'))!.corps;
    expect([modif.get('items[0][quantity]'), modif.get('proration_behavior'), modif.get('payment_behavior')]).toEqual(['2', 'always_invoice', 'pending_if_incomplete']);
    expect(notes).toEqual([['sub_opt', 2, null]]);
    // La place en plus libère peut-être un numéro resté dehors : ses campagnes en pause repartent (jaune 6).
    expect(reprises).toEqual([T1]);
  });

  it('🔴 un ajout dont la facture attend son paiement : 402 avec la page de la facture, aucune place notée', async () => {
    const { d, notes, reprises } = deps({ vivante: OPTION, objets: { sub_opt: abonnement(1) }, reponses: [change(1, true)] });
    const r = await changerPlaces(d, T1, { depuis: 1, cible: 2 }, 'u1');
    expect(r).toMatchObject({ ok: false, statut: 402, details: { code: 'paiement_place_incomplet', url: 'https://invoice.stripe.com/i/prorata' } });
    // Régler la facture applique l'ajout : le message ne fait jamais recommencer, qui ferait payer une seconde place.
    expect(r.ok ? '' : r.erreur).toMatch(/s’ajoutera dès qu’elle sera payée\. Ne recommencez pas/);
    expect([notes, reprises]).toEqual([[], []]);
  });

  it('🔴 un retrait ne passe jamais sous les numéros déjà couverts ; dessus, il s’applique sans prorata', async () => {
    const trop = deps({ vivante: { ...OPTION, places: 2 }, objets: { sub_opt: abonnement(2) }, couverts: 2 });
    expect(await changerPlaces(trop.d, T1, { depuis: 2, cible: 1 }, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'numeros_en_trop' } });
    expect(trop.transport.posts).toEqual([]);
    const juste = deps({ vivante: { ...OPTION, places: 2 }, objets: { sub_opt: abonnement(2) }, couverts: 1, reponses: [change(1)] });
    expect(await changerPlaces(juste.d, T1, { depuis: 2, cible: 1 }, 'u1')).toEqual({ ok: true, valeur: { places: 1 } });
    expect(juste.transport.posts[0]!.corps.get('proration_behavior')).toBe('none');
  });

  it('une vue périmée, une option en retard ou absente : refus, rien n’est écrit chez Stripe', async () => {
    const perimee = deps({ vivante: OPTION, objets: { sub_opt: abonnement(2) } });
    expect(await changerPlaces(perimee.d, T1, { depuis: 1, cible: 3 }, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'places_changees' } });
    const retard = deps({ vivante: OPTION, objets: { sub_opt: abonnement(1, { statut: 'past_due' }) } });
    expect(await changerPlaces(retard.d, T1, { depuis: 1, cible: 2 }, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'option_en_retard' } });
    const sans = deps();
    expect(await changerPlaces(sans.d, T1, { depuis: 1, cible: 2 }, 'u1')).toMatchObject({ ok: false, statut: 409, details: { code: 'sans_option' } });
    expect([...perimee.transport.posts, ...retard.transport.posts, ...sans.transport.posts]).toEqual([]);
  });
});

describe('l’option relue chez Stripe (le webhook)', () => {
  it('les places sont la somme des lignes au prix de l’option ; un refus durable rend null et prévient, une panne lève', async () => {
    const autre = { id: 'si_autre', quantity: 5, price: { id: 'price_autre' } };
    const lu = deps({ objets: { sub_opt: { ...abonnement(3), cancel_at_period_end: false, items: { data: [...abonnement(3).items.data, autre] } } } });
    expect(await optionChezStripe(lu.d, 'sub_opt')).toEqual({ statut: 'active', places: 3, finPrevueLe: null });
    const refus = deps({ objets: { sub_opt: 403 } });
    expect(await optionChezStripe(refus.d, 'sub_opt')).toBeNull();
    expect(refus.alertes).toHaveLength(1);
    const panne = deps({ objets: { sub_opt: 503 } });
    await expect(optionChezStripe(panne.d, 'sub_opt')).rejects.toThrow();
    // Pas en vente : rien à relire.
    expect(await optionChezStripe(deps({ prixOption: '' }).d, 'sub_opt')).toBeNull();
  });
});

describe('la fin de droit', () => {
  function fin(o: {
    vivante?: OptionCredit | null; aDroit?: boolean; refus?: ReponseStripe; premiereFin?: boolean; stripe?: null;
    /** L'abonnement relu chez Stripe après une erreur de la résiliation : un objet, un statut HTTP en échec, ou une panne. */
    relu?: unknown;
    /** La résiliation part en panne réseau : Stripe a pu la faire, sa réponse est perdue. */
    reseau?: boolean;
    /** Une autre fin de droit de l'espace tient le verrou. */
    verrouTenu?: boolean;
    /** Les clés déjà tenues par une autre fin de droit (relecture du lot C5, jaune 1 : un verrou par cas). */
    clesTenues?: string[];
    /** L'option relue sous le verrou, quand elle a changé depuis la première lecture (finie entre-temps). */
    vivanteSousVerrou?: OptionCredit | null;
  } = {}) {
    const transport = new FauxStripe(o.relu === undefined ? {} : { sub_opt: o.relu }, o.refus ? [o.refus] : []);
    if (o.reseau) {
      transport.delete = async (url: string) => { transport.suppressions.push({ url, corps: new URLSearchParams() }); throw new Error('ECONNRESET'); };
    }
    const journal: string[] = [];
    const alertes: string[] = [];
    const verrous = { pris: [] as string[], relaches: 0, durees: [] as number[] };
    let lectures = 0;
    const d: DepsFinDeDroitOption = {
      stripe: o.stripe === null ? null : { cle: 'rk_live_x', livemode: true, transport },
      options: {
        vivante: async () => {
          lectures += 1;
          if (lectures > 1 && o.vivanteSousVerrou !== undefined) return o.vivanteSousVerrou;
          return o.vivante === undefined ? OPTION : o.vivante;
        },
        finir: async (id, raison) => { journal.push(`finir:${id}:${raison}`); return { ...OPTION, premiereFin: o.premiereFin ?? true }; },
      },
      aDroit: async () => o.aDroit ?? false,
      arreterLesLignes: async (t) => { journal.push(`arret:${t}`); return 2; },
      prevenirSansDroit: async (t, id) => { journal.push(`courriel:${t}:${id}`); },
      alerter: async (t) => { journal.push(`alerte:${t.slice(0, 20)}`); alertes.push(t); },
      verrous: {
        prendre: async (cles) => {
          verrous.pris.push(...cles.map(([c]) => c));
          verrous.durees.push(...cles.map(([, ms]) => ms));
          const tenue = o.verrouTenu || cles.some(([c]) => (o.clesTenues ?? []).includes(c));
          return tenue ? null : { jeton: 'j', cles: cles.map(([c]) => c) };
        },
        relacher: async () => { verrous.relaches += 1; },
      },
      now: () => new Date('2026-11-03T20:00:00Z'),
    };
    return { d, transport, journal, alertes, verrous };
  }
  const RESILIE = abonnement(1, { statut: 'canceled' });

  it('🔴 plus aucune offre n’y donne droit : résiliée tout de suite sans avoir, finie, ses lignes arrêtées, Julien prévenu', async () => {
    const { d, transport, journal } = fin();
    expect(await finDeDroitOption(d, T1, 'fin_de_droit')).toBe('resiliee');
    expect(transport.suppressions.map((s) => [s.url.split('/').pop(), s.corps.toString()])).toEqual([['sub_opt', '']]);
    expect(journal).toEqual(['finir:sub_opt:fin_de_droit', `arret:${T1}`, 'alerte:Option Ligne de créd']);
  });

  it('🔴 une offre y donne encore droit (un Pro, un Business, une Entreprise), ou aucune option : rien ne bouge', async () => {
    const droit = fin({ aDroit: true });
    expect(await finDeDroitOption(droit.d, T1, 'fin_de_droit')).toBe('garde_son_droit');
    const sans = fin({ vivante: null });
    expect(await finDeDroitOption(sans.d, T1, 'fin_de_droit')).toBe('sans_option');
    expect([droit.transport.suppressions, droit.journal, sans.journal]).toEqual([[], [], []]);
  });

  it('🔴 Stripe refuse de résilier : les envois s’arrêtent QUAND MÊME et Julien résilie à la main', async () => {
    const { d, journal } = fin({ refus: { status: 400, json: { error: { code: 'resource_missing', message: 'non' } } } });
    expect(await finDeDroitOption(d, T1, 'fin_de_droit')).toBe('a_verifier');
    expect(journal.filter((j) => !j.startsWith('alerte'))).toEqual(['finir:sub_opt:fin_de_droit', `arret:${T1}`]);
    const sansStripe = fin({ stripe: null });
    expect(await finDeDroitOption(sansStripe.d, T1, 'fin_de_droit')).toBe('a_verifier');
    expect(sansStripe.journal).toContain(`arret:${T1}`);
  });

  it('un rejeu (l’option déjà finie par un autre chemin) ne réarrête rien et ne réalerte pas', async () => {
    const { d, journal } = fin({ premiereFin: false });
    await finDeDroitOption(d, T1, 'fin_de_droit');
    expect(journal).toEqual(['finir:sub_opt:fin_de_droit']);
  });

  /**
   * La relecture des derniers jaunes d'avant la vente (jaunes 1 et 6) : une option payée sans droit faisait jusqu'à trois
   * alertes contradictoires (« résiliée » quand l'abonnement courait encore, « sans remboursement » puis « à rembourser »),
   * et le client n'apprenait rien. Décision de Julien du 2026-11-04 : un e-mail aux admins, sans promesse, et le
   * remboursement décidé au cas par cas.
   */
  it('🔴 payée sans droit, résiliée chez Stripe : l’e-mail et la consigne AVANT la fin, puis les lignes arrêtées', async () => {
    const { d, journal, alertes } = fin();
    expect(await finDeDroitOption(d, T1, 'payee_sans_droit')).toBe('resiliee');
    expect(journal).toEqual([`courriel:${T1}:sub_opt`, 'alerte:Option Ligne de créd', 'finir:sub_opt:fin_de_droit', `arret:${T1}`, 'alerte:Option Ligne de créd']);
    expect(alertes).toHaveLength(2);
    expect(alertes[0]).toMatch(/payée sans offre qui y donne droit : .*résiliée chez Stripe, un e-mail part à ses admins\. Remboursement à décider au cas par cas/);
    expect(alertes[1]).toMatch(/payée sans droit, finie chez nous : .*2 lignes arrêtées/);
    expect(alertes.join(' ')).not.toMatch(/sans remboursement/);
  });

  it('🔴 payée sans droit, Stripe refuse de résilier : AUCUN e-mail (il la dirait résiliée), Julien résilie puis prévient', async () => {
    // La relecture du correctif (jaune 1) : l'e-mail disait « Nous l'avons résiliée » alors que l'abonnement courait encore.
    const { d, journal, alertes } = fin({ refus: { status: 400, json: { error: { code: 'resource_missing', message: 'non' } } } });
    expect(await finDeDroitOption(d, T1, 'payee_sans_droit')).toBe('a_verifier');
    expect(journal.some((j) => j.startsWith('courriel'))).toBe(false);
    expect(alertes).toHaveLength(2);
    expect(alertes.join(' ')).not.toMatch(/sans remboursement|résiliée chez Stripe/);
    // La consigne ne promet plus d'e-mail après une résiliation à la main : aucun chemin ne l'envoie (relecture du
    // correctif de l'e-mail sans droit, jaune 5).
    expect(alertes[0]).toMatch(/À vérifier chez Stripe, et à résilier à la main \(payée sans droit : son remboursement est à décider, et ses admins à prévenir à la main, aucun e-mail ne partira\)/);
    expect(alertes[1]).toMatch(/payée sans droit, finie chez nous/);
  });

  /**
   * La relecture du correctif de l'e-mail sans droit (plan du lot 4, jaunes 1 à 3) : une panne passagère faisait lever pour
   * que Stripe rejoue ; mais le rejeu retombait sur un abonnement déjà résilié (la session relue n'y repasse plus : ni
   * e-mail ni consigne), ou sur le même 500, que la clé d'idempotence garde 24 h, sans alerte.
   */
  it('🔴 payée sans droit, une panne sans résiliation (503, 429, le 500 que la clé garde 24 h) : à vérifier tout de suite, rien ne lève, aucun e-mail', async () => {
    for (const status of [503, 429, 500]) {
      const { d, journal, alertes } = fin({ refus: { status, json: { error: { message: 'indisponible' } } }, relu: abonnement(1) });
      expect(await finDeDroitOption(d, T1, 'payee_sans_droit'), String(status)).toBe('a_verifier');
      expect(journal.filter((j) => !j.startsWith('alerte')), String(status)).toEqual(['finir:sub_opt:fin_de_droit', `arret:${T1}`]);
      expect(alertes, String(status)).toHaveLength(2);
      expect(alertes[0], String(status)).toMatch(new RegExp(`Stripe n'a pas résilié sub_opt \\(${status} ; relue : active\\)\\. À vérifier chez Stripe, et à résilier à la main \\(payée sans droit`));
    }
    // L'abonnement illisible au relu (une panne de plus) : le doute ne vaut jamais résiliation.
    for (const relu of [503, new Error('ECONNRESET')]) {
      const { d, journal, alertes } = fin({ reseau: true, relu });
      expect(await finDeDroitOption(d, T1, 'payee_sans_droit'), String(relu)).toBe('a_verifier');
      expect(journal.some((j) => j.startsWith('courriel')), String(relu)).toBe(false);
      expect(alertes[0], String(relu)).toMatch(/Stripe n'a pas résilié sub_opt \(réseau ; relue : illisible\)/);
    }
  });

  it('🔴 une résiliation ne se compte que RELUE : réponse perdue, 500 rendu après elle, 409 d’un appel concurrent, arrêt déjà fait, relue résiliée : l’e-mail et la consigne partent', async () => {
    const cas: Array<{ nom: string; reseau?: boolean; refus?: ReponseStripe }> = [
      { nom: 'réseau', reseau: true },
      { nom: '500', refus: { status: 500, json: { error: { message: 'erreur' } } } },
      { nom: '409', refus: { status: 409, json: { error: { code: 'idempotency_key_in_use', message: 'en cours' } } } },
      { nom: '400', refus: { status: 400, json: { error: { code: 'resource_missing', message: 'non' } } } },
    ];
    for (const c of cas) {
      const { d, journal, alertes } = fin({ ...c, relu: RESILIE });
      expect(await finDeDroitOption(d, T1, 'payee_sans_droit'), c.nom).toBe('resiliee');
      expect(journal, c.nom).toEqual([`courriel:${T1}:sub_opt`, 'alerte:Option Ligne de créd', 'finir:sub_opt:fin_de_droit', `arret:${T1}`, 'alerte:Option Ligne de créd']);
      expect(alertes[0], c.nom).toMatch(/résiliée chez Stripe, un e-mail part à ses admins/);
    }
    // Une fin de droit ordinaire aussi : résiliée, relue, sans alerte « à la main ».
    const ordinaire = fin({ refus: { status: 500, json: { error: { message: 'erreur' } } }, relu: RESILIE });
    expect(await finDeDroitOption(ordinaire.d, T1, 'fin_de_droit')).toBe('resiliee');
    expect(ordinaire.alertes.join(' ')).not.toMatch(/à la main/);
  });

  it('🔴 une seule fin de droit à la fois par espace : pendant une autre, rien n’est résilié ni dit ; l’option finie entre-temps, rien non plus', async () => {
    // La relecture du correctif de l'e-mail sans droit (jaune 2) : la session et la première facture arrivent ensemble, et
    // chacune envoyait la consigne de remboursement.
    const tenue = fin({ verrouTenu: true });
    expect(await finDeDroitOption(tenue.d, T1, 'payee_sans_droit')).toBe('en_cours');
    expect([tenue.transport.suppressions, tenue.journal, tenue.verrous.pris]).toEqual([[], [], [`option.fin:payee_sans_droit:${T1}`]]);
    // L'option se relit sous le verrou : finie par l'autre appel, rien à faire.
    const finie = fin({ vivanteSousVerrou: null });
    expect(await finDeDroitOption(finie.d, T1, 'payee_sans_droit')).toBe('sans_option');
    expect([finie.transport.suppressions, finie.journal, finie.verrous.relaches]).toEqual([[], [], 1]);
    const complete = fin();
    expect(await finDeDroitOption(complete.d, T1, 'payee_sans_droit')).toBe('resiliee');
    expect([complete.verrous.pris, complete.verrous.relaches]).toEqual([[`option.fin:payee_sans_droit:${T1}`], 1]);
  });

  it('🔴 le verrou est par CAS : la fin du Pro en cours ne fait pas taire l’option payée sans droit (relecture du lot C5, jaune 1)', async () => {
    // La fin du Pro et la session d'une option payée sans droit traitées ensemble : sous un verrou par espace, la seconde
    // recevait `en_cours`, et l'option partait « sans remboursement », sans e-mail ni consigne.
    const pendantLaFinDuPro = fin({ clesTenues: [`option.fin:fin_de_droit:${T1}`] });
    expect(await finDeDroitOption(pendantLaFinDuPro.d, T1, 'payee_sans_droit')).toBe('resiliee');
    expect(pendantLaFinDuPro.journal).toContain(`courriel:${T1}:sub_opt`);
    expect(pendantLaFinDuPro.alertes.join(' ')).toMatch(/Remboursement à décider au cas par cas/);
    // Le même cas reste sérialisé : la session et la première facture.
    const memeCas = fin({ clesTenues: [`option.fin:payee_sans_droit:${T1}`] });
    expect(await finDeDroitOption(memeCas.d, T1, 'payee_sans_droit')).toBe('en_cours');
  });

  it('🔴 le bail du verrou couvre le pire cas qu’il protège : la résiliation et sa relecture (deux délais HTTP), puis trois alertes (jaune 2)', async () => {
    // Le bail échu avant la fin, un second appel reprenait le verrou et rejouait tout : deux consignes.
    const c = fin();
    await finDeDroitOption(c.d, T1, 'payee_sans_droit');
    // `sendTelegram` attend 5 s au plus (`src/ops/telegram.ts`) ; la fin de droit alerte jusqu'à trois fois.
    expect(c.verrous.durees[0]).toBeGreaterThan(2 * HTTP_TIMEOUT_DEFAUT_MS + 3 * 5_000);
  });

  it('une fin de droit ordinaire garde la résiliation à la main sur une panne passagère : /ops ne la rejouerait pas', async () => {
    const { d, journal } = fin({ refus: { status: 503, json: { error: { message: 'indisponible' } } } });
    expect(await finDeDroitOption(d, T1, 'fin_de_droit')).toBe('a_verifier');
    expect(journal).toContain(`arret:${T1}`);
  });

  it('🔴 payée sans droit, la fin déjà écrite par l’avis « deleted » de Stripe : la consigne est partie avant elle', async () => {
    // La relecture du correctif (jaune 2) : notre résiliation déclenche l'avis `deleted`, qui peut écrire la fin avant nous
    // et ne dit que « terminée (résiliation) ».
    const { d, journal, alertes } = fin({ premiereFin: false });
    expect(await finDeDroitOption(d, T1, 'payee_sans_droit')).toBe('resiliee');
    expect(journal).toEqual([`courriel:${T1}:sub_opt`, 'alerte:Option Ligne de créd', 'finir:sub_opt:fin_de_droit']);
    expect(alertes[0]).toMatch(/Remboursement à décider au cas par cas/);
  });

  it('une fin de droit ordinaire (la fin du Pro) : aucun e-mail aux admins, le mois entamé sans remboursement', async () => {
    const { d, journal, alertes } = fin({ stripe: null });
    expect(await finDeDroitOption(d, T1, 'fin_de_droit')).toBe('a_verifier');
    expect(journal.some((j) => j.startsWith('courriel'))).toBe(false);
    expect(alertes[0]).toMatch(/à résilier à la main \(sans remboursement\)/);
    expect(alertes[1]).toMatch(/^Option Ligne de crédit finie, plus aucune offre n'y donne droit/);
  });

  it('🔴 branchée pour le câblage du webhook, la fin de droit reçoit le cas tel quel : payée sans droit, l’e-mail part ; fin du Pro, non', async () => {
    const payee = fin();
    await brancherFinDeDroit(payee.d)(T1, 'payee_sans_droit');
    const ordinaire = fin();
    await brancherFinDeDroit(ordinaire.d)(T1, 'fin_de_droit');
    expect([payee.journal.includes(`courriel:${T1}:sub_opt`), ordinaire.journal.some((j) => j.startsWith('courriel'))]).toEqual([true, false]);
  });

  it('payée avec droit, ou sans option : ni e-mail ni alerte', async () => {
    const droit = fin({ aDroit: true });
    expect(await finDeDroitOption(droit.d, T1, 'payee_sans_droit')).toBe('garde_son_droit');
    const sans = fin({ vivante: null });
    expect(await finDeDroitOption(sans.d, T1, 'payee_sans_droit')).toBe('sans_option');
    expect([droit.journal, sans.journal]).toEqual([[], []]);
  });
});

/**
 * La résiliation d'un impayé abandonné (`unpaid`, relecture du lot 4a, jaune 3) : Stripe garde l'abonnement vivant et le
 * prélèverait au règlement d'une facture en retard, alors que ses lignes sont arrêtées.
 */
describe('résilier une option impayée', () => {
  it('🔴 résiliée sans avoir ; sur une erreur, relue chez Stripe : résiliée, true ; sinon une alerte « à vérifier » et false, sans jamais lever', async () => {
    const ok = deps();
    expect(await resilierOptionChezStripe(ok.d, 'sub_opt')).toBe(true);
    expect(ok.transport.suppressions.map((s) => [s.url.split('/').pop(), s.corps.toString()])).toEqual([['sub_opt', '']]);
    // Relecture du lot C5, jaune 3 : une panne levait pour que Stripe rejoue, et un vrai 500 que la clé d'idempotence
    // garde 24 h laissait les lignes d'une option impayée actives, sans alerte. La réponse perdue d'une résiliation faite
    // se relit `canceled`.
    const faite = deps({ reponses: [{ status: 500, json: { error: { message: 'erreur' } } }], objets: { sub_opt: abonnement(1, { statut: 'canceled' }) } });
    expect(await resilierOptionChezStripe(faite.d, 'sub_opt')).toBe(true);
    expect(faite.alertes).toEqual([]);
    for (const status of [503, 429, 400]) {
      const r = deps({ reponses: [{ status, json: { error: { message: 'non' } } }], objets: { sub_opt: abonnement(1, { statut: 'unpaid' }) } });
      expect(await resilierOptionChezStripe(r.d, 'sub_opt'), String(status)).toBe(false);
      expect(r.alertes.join(' '), String(status)).toMatch(new RegExp(`Stripe n'a pas résilié sub_opt \\(${status} ; relue : unpaid\\)\\. À vérifier chez Stripe, et à résilier à la main, sans remboursement`));
    }
    // L'abonnement illisible au relu : le doute ne vaut jamais résiliation.
    const illisible = deps({ reponses: [{ status: 503, json: { error: { message: 'indisponible' } } }], objets: { sub_opt: 503 } });
    expect(await resilierOptionChezStripe(illisible.d, 'sub_opt')).toBe(false);
    expect(illisible.alertes.join(' ')).toMatch(/relue : illisible/);
  });
});
