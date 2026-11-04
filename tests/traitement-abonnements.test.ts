import { describe, expect, it } from 'vitest';
import {
  creerTraitementAbonnements, type DepsTraitementAbonnements, type EvenementStripeVerifie,
} from '../src/stripe/traitement-abonnements';
import type { IssueFinDeDroitOption } from '../src/stripe/option-credit-whatsapp';
import { stripeNumeroInerte, stripeOptionInerte, stripeProInerte } from './routes-inertes';

const TENANT = '5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01';

function evenement(type: string, objet: unknown): EvenementStripeVerifie {
  return { id: 'evt_1', type, livemode: true, objet };
}

function creer(over: Partial<DepsTraitementAbonnements> = {}) {
  return creerTraitementAbonnements({
    numero: stripeNumeroInerte,
    pro: stripeProInerte,
    option: stripeOptionInerte,
    paiementRefuse: async () => {},
    signalerPro: async () => {},
    now: () => 1_790_000_000_000,
    ...over,
  });
}

describe('le traitement des événements Stripe d’abonnement', () => {
  it('laisse une recharge au chemin de crédit', async () => {
    const traitement = creer();
    const e = evenement('checkout.session.completed', {
      id: 'cs_1', mode: 'payment', payment_status: 'paid', metadata: { offre: 'refill_50', tenant_id: TENANT },
    });

    expect(traitement.concerne(e)).toBe(false);
    await expect(traitement.traiter(e)).resolves.toEqual({ issue: 'non_abonnement' });
  });

  it('reconnaît la marque du Pro avant de refuser sa forme illisible', async () => {
    const traitement = creer();
    const e = evenement('checkout.session.completed', { metadata: { produit: 'pro' } });

    expect(traitement.concerne(e)).toBe(true);
    await expect(traitement.traiter(e)).resolves.toEqual({ issue: 'illisible', domaine: 'pro' });
  });

  it('enregistre directement une session payée du numéro fourni', async () => {
    const enregistres: unknown[] = [];
    const reprises: string[] = [];
    const numero: DepsTraitementAbonnements['numero'] = {
      ...stripeNumeroInerte,
      enregistrer: async (a) => { enregistres.push(a); return { etat: 'enregistre', numero: '33123456789' }; },
      reprendreCampagnes: async (tenantId) => { reprises.push(tenantId); },
      inclusDansLOffre: async () => false,
    };
    const traitement = creer({ numero });
    const e = evenement('checkout.session.completed', {
      id: 'cs_numero', mode: 'subscription', payment_status: 'paid', subscription: 'sub_numero',
      metadata: { tenant_id: TENANT, produit: 'numero' },
    });

    await expect(traitement.traiter(e)).resolves.toEqual({ issue: 'acquitte' });
    expect(enregistres).toEqual([{
      tenantId: TENANT, abonnementId: 'sub_numero', livemode: true, periodeFin: null,
    }]);
    expect(reprises).toEqual([TENANT]);
  });

  it('laisse remonter une panne inattendue pour que Stripe rejoue', async () => {
    const panne = new Error('connexion perdue');
    const pro: DepsTraitementAbonnements['pro'] = {
      ...stripeProInerte,
      enregistrer: async () => { throw panne; },
    };
    const traitement = creer({ pro });
    const e = evenement('checkout.session.completed', {
      id: 'cs_pro', mode: 'subscription', payment_status: 'paid', subscription: 'sub_pro',
      metadata: { tenant_id: TENANT, produit: 'pro', periodicite: 'mois' },
    });

    await expect(traitement.traiter(e)).rejects.toBe(panne);
  });
});

/**
 * L'OPTION DU CRÉDIT WHATSAPP (lot 4a) : aiguillée avant le numéro, ses places toujours RELUES chez Stripe, en retard sans
 * perdre ses places, finie à l'annonce de Stripe avec ses lignes arrêtées.
 */
describe('l’option du Crédit WhatsApp', () => {
  const META = { tenant_id: TENANT, produit: 'option_credit_whatsapp' };
  function option(o: {
    relu?: { statut: string; places: number; finPrevueLe: Date | null } | null; connue?: boolean; vivante?: boolean; premiereFin?: boolean;
    illimite?: boolean; issue?: 'fini' | 'doublon'; nouveau?: boolean; droit?: IssueFinDeDroitOption;
  } = {}) {
    const journal: string[] = [];
    const refus: string[] = [];
    const alertes: string[] = [];
    const droits: string[] = [];
    const ligneDe = { abonnementId: 'sub_opt', tenantId: TENANT, livemode: true, statut: 'actif' as const, places: 2, periodeFin: null, finPrevueLe: null, finiLe: null, finRaison: null };
    const dep: DepsTraitementAbonnements['option'] = {
      enregistrer: async (a) => {
        journal.push(`enregistrer:${a.abonnementId}:${a.places}`);
        return o.issue === undefined ? { etat: 'enregistre', tenantId: TENANT, nouveau: o.nouveau ?? true } : { etat: o.issue };
      },
      majStatut: async (id, statut) => { journal.push(`statut:${id}:${statut}`); return o.connue === false ? null : { ...ligneDe, statut }; },
      noterPlaces: async (id, places) => { journal.push(`places:${id}:${places}`); return o.connue === false ? null : ligneDe; },
      finir: async (id, raison) => { journal.push(`finir:${id}:${raison}`); return { ...ligneDe, premiereFin: o.premiereFin ?? true }; },
      vivante: async () => (o.vivante ? ligneDe : null),
      chezStripe: async () => (o.relu === undefined ? { statut: 'active', places: 2, finPrevueLe: null } : o.relu),
      arreterLesLignes: async (t) => { journal.push(`arret:${t}`); return 1; },
      illimite: async () => o.illimite === true,
      relancerLesLignes: async (t) => { journal.push(`relance:${t}`); return 1; },
      reprendreCampagnes: async (t) => { journal.push(`reprise:${t}`); return 0; },
      resilier: async (id) => { journal.push(`resilier:${id}`); return true; },
      // Une option enregistrée relit son droit : une offre y donne droit, sauf avis contraire du test.
      finDeDroit: async (t) => { droits.push(t); return o.droit ?? 'garde_son_droit'; },
      alerter: async (texte) => { alertes.push(texte); },
    };
    const traitement = creer({ option: dep, paiementRefuse: async (p) => { refus.push(`${p.offre}:${p.factureId}`); } });
    return { traitement, journal, refus, alertes, droits };
  }
  const facture = (billing_reason = 'subscription_cycle') => ({
    id: 'in_1', billing_reason, amount_paid: 3000, parent: { subscription_details: { subscription: 'sub_opt', metadata: META } },
    lines: { data: [{ period: { end: 1_800_000_000 } }] },
  });

  it('🔴 la session payée enregistre les places RELUES chez Stripe ; une session impayée ou un abonnement incomplet, rien', async () => {
    const paye = option({ relu: { statut: 'active', places: 3, finPrevueLe: null } });
    const session = { id: 'cs_opt', mode: 'subscription', payment_status: 'paid', subscription: 'sub_opt', metadata: META };
    expect(paye.traitement.concerne(evenement('checkout.session.completed', session))).toBe(true);
    await expect(paye.traitement.traiter(evenement('checkout.session.completed', session))).resolves.toEqual({ issue: 'acquitte' });
    // Une option neuve (ou reprise) relance les lignes que la fin de la précédente avait arrêtées, et ses campagnes en
    // pause faute de ligne repartent (jaunes 4 et 6 de la relecture du lot 4a).
    expect(paye.journal).toEqual(['enregistrer:sub_opt:3', `relance:${TENANT}`, `reprise:${TENANT}`]);
    const impaye = option();
    await impaye.traitement.traiter(evenement('checkout.session.completed', { ...session, payment_status: 'unpaid' }));
    const incomplet = option({ relu: { statut: 'incomplete', places: 3, finPrevueLe: null } });
    await incomplet.traitement.traiter(evenement('checkout.session.completed', session));
    expect([impaye.journal, incomplet.journal]).toEqual([[], []]);
  });

  it('🔴 une modification relit les places chez Stripe ; un abonnement que Stripe dit impayé finit l’option et arrête ses lignes', async () => {
    const modif = option({ relu: { statut: 'active', places: 4, finPrevueLe: null } });
    await modif.traitement.traiter(evenement('customer.subscription.updated', { id: 'sub_opt', metadata: META }));
    expect(modif.journal).toEqual(['places:sub_opt:4', `reprise:${TENANT}`]);
    const impaye = option({ relu: { statut: 'unpaid', places: 4, finPrevueLe: null } });
    await impaye.traitement.traiter(evenement('customer.subscription.updated', { id: 'sub_opt', metadata: META }));
    // 🔴 `unpaid` reste vivant chez Stripe, qui le prélèverait encore : résilié d'abord (jaune 3).
    expect(impaye.journal).toEqual(['resilier:sub_opt', 'finir:sub_opt:impaye', `arret:${TENANT}`]);
  });

  it('🔴 la fin annoncée par Stripe arrête les lignes ; une AUTRE option vivante (reprise depuis) garde les siennes', async () => {
    const fin = option();
    await fin.traitement.traiter(evenement('customer.subscription.deleted', { id: 'sub_opt', metadata: META, cancellation_details: { reason: 'payment_failed' } }));
    expect(fin.journal).toEqual(['finir:sub_opt:impaye', `arret:${TENANT}`]);
    const reprise = option({ vivante: true, premiereFin: false });
    await reprise.traitement.traiter(evenement('customer.subscription.deleted', { id: 'sub_opt', metadata: META }));
    expect(reprise.journal).toEqual(['finir:sub_opt:resiliation']);
  });

  it('🔴 la fin de l’option d’un espace passé en Entreprise n’arrête pas ses lignes : l’illimité les couvre, Julien le sait', async () => {
    // Relecture du lot 4a : la garde lit l'arrêt d'une ligne AVANT l'illimité, des lignes arrêtées couperaient tous les
    // envois de l'Entreprise, réponses comprises.
    const resiliee = option({ illimite: true });
    await resiliee.traitement.traiter(evenement('customer.subscription.deleted', { id: 'sub_opt', metadata: META }));
    expect(resiliee.journal).toEqual(['finir:sub_opt:resiliation']);
    expect(resiliee.alertes.join(' ')).toMatch(/Entreprise : ses lignes restent actives/);
    const impayee = option({ illimite: true, relu: { statut: 'unpaid', places: 2, finPrevueLe: null } });
    await impayee.traitement.traiter(evenement('customer.subscription.updated', { id: 'sub_opt', metadata: META }));
    expect(impayee.journal).toEqual(['resilier:sub_opt', 'finir:sub_opt:impaye']);
  });

  it('🔴 un échec de renouvellement : en retard, places gardées, l’e-mail aux admins ; le prorata d’une place refusé ne change rien', async () => {
    const echec = option();
    await echec.traitement.traiter(evenement('invoice.payment_failed', facture()));
    expect([echec.journal, echec.refus]).toEqual([['statut:sub_opt:en_retard'], ['option_credit_whatsapp:in_1']]);
    const prorata = option();
    await prorata.traitement.traiter(evenement('invoice.payment_failed', facture('subscription_update')));
    expect([prorata.journal, prorata.refus]).toEqual([[], []]);
  });

  it('une facture payée remet l’option à jour et relit ses places ; arrivée avant la session, elle l’enregistre', async () => {
    const payee = option();
    await payee.traitement.traiter(evenement('invoice.paid', facture()));
    expect(payee.journal).toEqual(['statut:sub_opt:actif', 'places:sub_opt:2', `reprise:${TENANT}`]);
    const avant = option({ connue: false });
    await avant.traitement.traiter(evenement('invoice.paid', facture('subscription_create')));
    expect(avant.journal).toEqual(['statut:sub_opt:actif', 'enregistrer:sub_opt:2', `relance:${TENANT}`, `reprise:${TENANT}`]);
  });

  it('🔴 un paiement que rien ne trace se dit : l’option illisible chez Stripe, ou finie chez nous et encore facturée (jaune 3)', async () => {
    const session = { id: 'cs_opt', mode: 'subscription', payment_status: 'paid', subscription: 'sub_opt', metadata: META };
    const illisible = option({ relu: null });
    await illisible.traitement.traiter(evenement('checkout.session.completed', session));
    expect(illisible.journal).toEqual([]);
    expect(illisible.alertes.join(' ')).toMatch(/elle n'est PAS enregistrée, à vérifier/);
    const finie = option({ connue: false, issue: 'fini' });
    await finie.traitement.traiter(evenement('invoice.paid', facture()));
    expect(finie.journal).toEqual(['statut:sub_opt:actif', 'enregistrer:sub_opt:2']);
    expect(finie.alertes.join(' ')).toMatch(/finie chez nous, mais Stripe la dit active et l'a facturée/);
    // Un doublon ne relance ni ne reprend rien : l'option vivante garde ses lignes.
    const doublon = option({ issue: 'doublon' });
    await doublon.traitement.traiter(evenement('checkout.session.completed', session));
    expect(doublon.journal).toEqual(['enregistrer:sub_opt:2']);
    // Venue d'une modification et non d'une facture : rien n'a été « facturé » (formulation de l'alerte).
    const finieModif = option({ connue: false, issue: 'fini' });
    await finieModif.traitement.traiter(evenement('customer.subscription.updated', { id: 'sub_opt', metadata: META }));
    expect(finieModif.alertes.join(' ')).toMatch(/Stripe la dit active\. À résilier chez Stripe\./);
  });

  /** Les jaunes d'avant la vente, relecture du 2026-11-04 (plan du lot 4, § « La relecture des jaunes d'avant la vente »). */
  const SESSION = { id: 'cs_opt', mode: 'subscription', payment_status: 'paid', subscription: 'sub_opt', metadata: META };

  it('🔴 une option payée sans offre qui y donne droit se résilie au lieu de relancer ses lignes (jaune 1)', async () => {
    // Un Checkout ouvert pendant l'essai du Pro et réglé après sa fin : la session vit 24 h.
    const sansDroit = option({ droit: 'resiliee' });
    await sansDroit.traitement.traiter(evenement('checkout.session.completed', SESSION));
    expect([sansDroit.droits, sansDroit.journal]).toEqual([[TENANT], ['enregistrer:sub_opt:2']]);
    expect(sansDroit.alertes.join(' ')).toMatch(/sans offre qui y donne droit : résiliée \(resiliee\)/);
    // Une offre y donne droit : la relance et la levée suivent la lecture du droit.
    const avecDroit = option();
    await avecDroit.traitement.traiter(evenement('checkout.session.completed', SESSION));
    expect([avecDroit.droits, avecDroit.journal]).toEqual([[TENANT], ['enregistrer:sub_opt:2', `relance:${TENANT}`, `reprise:${TENANT}`]]);
  });

  it('🔴 un rejeu refait la relance et la levée d’une option déjà connue, sans réalerter « nouvelle option » (jaune 2)', async () => {
    const rejeu = option({ nouveau: false });
    await rejeu.traitement.traiter(evenement('checkout.session.completed', SESSION));
    expect(rejeu.journal).toEqual(['enregistrer:sub_opt:2', `relance:${TENANT}`, `reprise:${TENANT}`]);
    expect(rejeu.alertes).toEqual([]);
  });

  it('🔴 une facture payée pour une option que Stripe dit finie se dit, avec son montant ; à zéro, rien (jaune 3)', async () => {
    // Après notre résiliation d'un impayé, une facture restée ouverte se paie encore à la main.
    const payee = option({ connue: false, relu: { statut: 'canceled', places: 2, finPrevueLe: null } });
    await payee.traitement.traiter(evenement('invoice.paid', facture()));
    expect(payee.journal).toEqual(['statut:sub_opt:actif']);
    expect(payee.alertes.join(' ')).toMatch(/Facture de 30,00 € payée pour l'option Crédit WhatsApp sub_opt .* que Stripe dit canceled : à rembourser/);
    const nulle = option({ connue: false, relu: { statut: 'canceled', places: 2, finPrevueLe: null } });
    await nulle.traitement.traiter(evenement('invoice.paid', { ...facture(), amount_paid: 0 }));
    expect(nulle.alertes).toEqual([]);
  });

  it('🔴 un événement de l’option ne tombe jamais dans le chemin du numéro (qui acquitte en silence) : marquée mais illisible, 422', async () => {
    // Le numéro inerte LÈVE sur toute écriture : passer par lui ferait échouer ce test.
    const o = option();
    await expect(o.traitement.traiter(evenement('customer.subscription.updated', { metadata: { produit: 'option_credit_whatsapp' } })))
      .resolves.toEqual({ issue: 'illisible', domaine: 'option' });
    await expect(o.traitement.traiter(evenement('invoice.paid', { id: 'in_x', parent: { subscription_details: { subscription: 'sub_opt', metadata: { produit: 'option_credit_whatsapp' } } } })))
      .resolves.toEqual({ issue: 'illisible', domaine: 'option' });
  });
});
