import { describe, it, expect } from 'vitest';
import type { ReponseStripe, TransportStripe } from '../src/stripe/client';
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
  constructor(private readonly objets: Record<string, unknown>, private readonly reponses: ReponseStripe[] = []) {}
  async post(url: string, corps: string, entetes: Record<string, string>): Promise<ReponseStripe> {
    this.posts.push({ url, corps: new URLSearchParams(corps), cle: entetes['idempotency-key'] ?? '' });
    if (url.endsWith('/customers')) return { status: 200, json: { id: 'cus_1' } };
    if (url.endsWith('/checkout/sessions')) return { status: 200, json: { id: 'cs_1', url: 'https://checkout.stripe.com/c/1' } };
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
} = {}) {
  const transport = new FauxStripe({ price_opt: PRIX, ...(o.objets ?? {}) }, o.reponses ?? []);
  const notes: Array<[string, number, Date | null]> = [];
  const alertes: string[] = [];
  const reprises: string[] = [];
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
    formulePayee: async () => o.formulePayee ?? true,
    numerosCouverts: async () => o.couverts ?? 0,
    reprendreCampagnes: async (t) => { reprises.push(t); return 0; },
    alerter: async (t) => { alertes.push(t); },
  };
  return { d, transport, notes, alertes, reprises };
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

  it('🔴 depuis les cartes « Qui règle Meta ? » (lot B), le retour de Stripe ramène sur Connecter WhatsApp, payé ou abandonné', async () => {
    const { d, transport } = deps();
    expect(await ouvrirOption(d, T1, 1, 'u1', 'connecter')).toMatchObject({ ok: true });
    const session = transport.posts.find((p) => p.url.endsWith('/checkout/sessions'))!.corps;
    expect([session.get('success_url'), session.get('cancel_url')]).toEqual([
      'https://console.messagingme.app/connecter-whatsapp?option=recue',
      'https://console.messagingme.app/connecter-whatsapp?option=abandon',
    ]);
  });

  it('🔴 rien ne part chez Stripe : sans prix, en Free, en Entreprise, déjà prise, hors des bornes', async () => {
    const cas: Array<[string, Parameters<typeof deps>[0], number, number, string]> = [
      ['sans prix', { prixOption: '' }, 1, 503, 'option_indisponible'],
      ['Free', { offre: 'base' }, 1, 409, 'option_avec_le_pro'],
      ['Entreprise', { offre: 'entreprise' }, 1, 409, 'option_inutile'],
      // Révision du 2026-11-04 (décision 1) : pas d'option pendant un essai, Pro comme Business.
      ['Pro en essai', { formulePayee: false }, 1, 409, 'option_apres_essai'],
      ['Business en essai', { offre: 'business', formulePayee: false }, 1, 409, 'option_apres_essai'],
      ['déjà prise', { vivante: OPTION }, 1, 409, 'option_deja_prise'],
      ['zéro', {}, 0, 400, 'places_invalides'],
      ['vingt et un', {}, 21, 400, 'places_invalides'],
    ];
    for (const [nom, o, places, statut, code] of cas) {
      const { d, transport } = deps(o);
      expect(await ouvrirOption(d, T1, places, 'u1'), nom).toMatchObject({ ok: false, statut, details: { code } });
      expect(transport.posts, nom).toEqual([]);
    }
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
  function fin(o: { vivante?: OptionCredit | null; aDroit?: boolean; refus?: ReponseStripe; premiereFin?: boolean; stripe?: null } = {}) {
    const transport = new FauxStripe({}, o.refus ? [o.refus] : []);
    const journal: string[] = [];
    const alertes: string[] = [];
    const d: DepsFinDeDroitOption = {
      stripe: o.stripe === null ? null : { cle: 'rk_live_x', livemode: true, transport },
      options: {
        vivante: async () => (o.vivante === undefined ? OPTION : o.vivante),
        finir: async (id, raison) => { journal.push(`finir:${id}:${raison}`); return { ...OPTION, premiereFin: o.premiereFin ?? true }; },
      },
      aDroit: async () => o.aDroit ?? false,
      arreterLesLignes: async (t) => { journal.push(`arret:${t}`); return 2; },
      prevenirSansDroit: async (t, id) => { journal.push(`courriel:${t}:${id}`); },
      alerter: async (t) => { journal.push(`alerte:${t.slice(0, 20)}`); alertes.push(t); },
      now: () => new Date('2026-11-03T20:00:00Z'),
    };
    return { d, transport, journal, alertes };
  }

  it('🔴 plus aucune offre n’y donne droit : résiliée tout de suite sans avoir, finie, ses lignes arrêtées, Julien prévenu', async () => {
    const { d, transport, journal } = fin();
    expect(await finDeDroitOption(d, T1, 'fin_de_droit')).toBe('resiliee');
    expect(transport.suppressions.map((s) => [s.url.split('/').pop(), s.corps.toString()])).toEqual([['sub_opt', '']]);
    expect(journal).toEqual(['finir:sub_opt:fin_de_droit', `arret:${T1}`, 'alerte:Option Crédit WhatsA']);
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
    expect(journal).toEqual([`courriel:${T1}:sub_opt`, 'alerte:Option Crédit WhatsA', 'finir:sub_opt:fin_de_droit', `arret:${T1}`, 'alerte:Option Crédit WhatsA']);
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
    expect(alertes[0]).toMatch(/À résilier à la main \(payée sans droit, son remboursement est à décider, puis prévenir ses admins : aucun e-mail ne part tant qu’elle court\)/);
    expect(alertes[1]).toMatch(/payée sans droit, finie chez nous/);
  });

  it('🔴 payée sans droit, une panne passagère de Stripe lève : ni e-mail, ni fin, ni alerte, Stripe rejouera l’événement', async () => {
    for (const status of [503, 429]) {
      const { d, journal, alertes } = fin({ refus: { status, json: { error: { message: 'indisponible' } } } });
      await expect(finDeDroitOption(d, T1, 'payee_sans_droit'), String(status)).rejects.toThrow();
      expect([journal, alertes], String(status)).toEqual([[], []]);
    }
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
    expect(journal).toEqual([`courriel:${T1}:sub_opt`, 'alerte:Option Crédit WhatsA', 'finir:sub_opt:fin_de_droit']);
    expect(alertes[0]).toMatch(/Remboursement à décider au cas par cas/);
  });

  it('une fin de droit ordinaire (la fin du Pro) : aucun e-mail aux admins, le mois entamé sans remboursement', async () => {
    const { d, journal, alertes } = fin({ stripe: null });
    expect(await finDeDroitOption(d, T1, 'fin_de_droit')).toBe('a_verifier');
    expect(journal.some((j) => j.startsWith('courriel'))).toBe(false);
    expect(alertes[0]).toMatch(/à résilier à la main \(sans remboursement\)/);
    expect(alertes[1]).toMatch(/^Option Crédit WhatsApp finie, plus aucune offre n'y donne droit/);
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
  it('🔴 résiliée sans avoir ; un refus durable prévient Julien et rend false ; une panne passagère lève, Stripe rejouera', async () => {
    const ok = deps();
    expect(await resilierOptionChezStripe(ok.d, 'sub_opt')).toBe(true);
    expect(ok.transport.suppressions.map((s) => [s.url.split('/').pop(), s.corps.toString()])).toEqual([['sub_opt', '']]);
    const refus = deps({ reponses: [{ status: 400, json: { error: { code: 'resource_missing', message: 'non' } } }] });
    expect(await resilierOptionChezStripe(refus.d, 'sub_opt')).toBe(false);
    expect(refus.alertes.join(' ')).toMatch(/À résilier à la main, sans remboursement/);
    const panne = deps({ reponses: [{ status: 503, json: { error: { message: 'indisponible' } } }] });
    await expect(resilierOptionChezStripe(panne.d, 'sub_opt')).rejects.toThrow();
    expect(panne.alertes).toEqual([]);
  });
});
