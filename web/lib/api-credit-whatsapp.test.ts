import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError } from './http';
import {
  aUneFactureWhatsapp, changerPlacesOption, factureDeLaPlace, getCreditWhatsapp, lireEtatLigne, ouvrirAchatWhatsapp, ouvrirOptionWhatsapp,
  SANS_OPTION, type LigneCreditWhatsapp,
} from './api-credit-whatsapp';

/**
 * Le Crédit WhatsApp côté navigateur : ce qu'une réponse du serveur veut dire pour l'onglet. 🔴 La console part avant
 * l'API (Vercel publie au push) : une route d'achat absente (404) ou des prix de Stripe pas posés (503) disent « pas encore
 * disponible », jamais une erreur brute.
 */
function repondre(status: number, corps: unknown): Array<{ url: string; corps: unknown }> {
  const appels: Array<{ url: string; corps: unknown }> = [];
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    appels.push({ url, corps: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });
  }));
  return appels;
}

describe('getCreditWhatsapp', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('rend la vue telle que le serveur la donne', async () => {
    const vue = {
      illimite: false,
      soldeMicroEur: 12_340_000,
      consommationDuMoisMicroEur: 2_149_520,
      prixFrance: [{ categorie: 'marketing', prixMicroEur: 74_760 }],
      franchiseServiceParNumero: 1000,
      achat: { disponible: true, permis: 'ok', offres: [{ offre: 'wa_50', htCentimes: 5_000 }] },
      ligneArretee: false,
      optionArretee: false,
      historique: [{ id: 'envois:2026-10-31', raison: 'envois', deltaMicroEur: -149_520, jour: '2026-10-31', at: '2026-10-31T10:00:00.000Z', messages: 2, reference: null, facture: false }],
      serie: [{ jour: '2026-10-31', soldeMicroEur: 12_340_000, consommationMicroEur: 149_520 }],
      option: { disponible: true, prixHtCentimes: 3000, placesMax: 20, places: 2, couverts: 1, statut: 'actif', finPrevueLe: null, formulePayee: true, prisePossible: true, avecApplication: false },
    };
    const appels = repondre(200, vue);
    expect(await getCreditWhatsapp('t1')).toEqual(vue);
    expect(appels[0]!.url).toContain('/tenants/t1/credit-whatsapp');
  });

  it('🔴 un corps sans listes ne fait pas tomber l’écran : historique et offres vides, prix inconnus', async () => {
    repondre(200, { soldeMicroEur: 0 });
    expect(await getCreditWhatsapp('t1')).toEqual({
      // Une API d'avant l'Entreprise illimitée (la console part avant l'API) : pas d'illimité, aucune consommation.
      illimite: false, soldeMicroEur: 0, consommationDuMoisMicroEur: 0, prixFrance: null, franchiseServiceParNumero: 0,
      achat: { disponible: false, permis: 'ok', offres: [] }, ligneArretee: false, historique: [], serie: [],
      // Une API d'avant le lot C : un arrêt se dit comme avant, au Support.
      optionArretee: false,
      // Une API d'avant l'option : rien en vente, rien de pris, la section ne paraît pas.
      option: SANS_OPTION,
    });
  });

  it('🔴 l’option arrêtée (lot C, moment 3) passe telle quelle ; un autre corps vaut non', async () => {
    repondre(200, { soldeMicroEur: 0, ligneArretee: true, optionArretee: true });
    expect(await getCreditWhatsapp('t1')).toMatchObject({ ligneArretee: true, optionArretee: true });
    repondre(200, { soldeMicroEur: 0, ligneArretee: true, optionArretee: 'oui' });
    expect((await getCreditWhatsapp('t1')).optionArretee).toBe(false);
  });

  it('🔴 une option illisible n’invente ni places ni statut : des comptes faux valent zéro, un statut inconnu rien', async () => {
    repondre(200, {
      soldeMicroEur: 0,
      option: { disponible: 'oui', prixHtCentimes: -5, placesMax: 2.5, places: '3', couverts: null, statut: 'perdu', finPrevueLe: 12 },
    });
    expect((await getCreditWhatsapp('t1')).option).toEqual(SANS_OPTION);
  });

  it('🔴 la formule payée (révision du 2026-11-04) : fausse quand le serveur le dit ; absente (une API d’avant), lue vraie, l’ancien écran', async () => {
    const option = { disponible: true, prixHtCentimes: 3000, placesMax: 20, places: 0, couverts: 0, statut: null, finPrevueLe: null };
    repondre(200, { soldeMicroEur: 0, option: { ...option, formulePayee: false } });
    expect((await getCreditWhatsapp('t1')).option.formulePayee).toBe(false);
    for (const formulePayee of [undefined, 'non', null]) {
      repondre(200, { soldeMicroEur: 0, option: { ...option, formulePayee } });
      expect((await getCreditWhatsapp('t1')).option.formulePayee, String(formulePayee)).toBe(true);
    }
  });

  it('🔴 la prise possible (lot 3v V1) : lue telle que le serveur la rend, formule payée ou non ; absente (une API d’avant V1), elle vaut la formule payée', async () => {
    const option = { disponible: true, prixHtCentimes: 3000, placesMax: 20, places: 0, couverts: 0, statut: null, finPrevueLe: null };
    // Un Pro en essai : sa formule n'est pas encore payée, l'option se prend quand même.
    repondre(200, { soldeMicroEur: 0, option: { ...option, formulePayee: false, prisePossible: true } });
    expect((await getCreditWhatsapp('t1')).option).toMatchObject({ formulePayee: false, prisePossible: true });
    // Un Pro en retard de paiement : une échéance a été payée, la prise est refusée.
    repondre(200, { soldeMicroEur: 0, option: { ...option, formulePayee: true, prisePossible: false } });
    expect((await getCreditWhatsapp('t1')).option.prisePossible).toBe(false);
    for (const [formulePayee, attendue] of [[false, false], [true, true], [undefined, true]] as const) {
      repondre(200, { soldeMicroEur: 0, option: { ...option, formulePayee } });
      expect((await getCreditWhatsapp('t1')).option.prisePossible, String(formulePayee)).toBe(attendue);
    }
    // Un corps illisible ne vaut pas une prise refusée : la règle d'avant, la formule payée.
    repondre(200, { soldeMicroEur: 0, option: { ...option, formulePayee: true, prisePossible: 'non' } });
    expect((await getCreditWhatsapp('t1')).option.prisePossible).toBe(true);
  });

  it('🔴 les numéros qui gardent tous l’application (lot B, décision 8) : vrai seulement quand le serveur le dit', async () => {
    const option = { disponible: true, prixHtCentimes: 3000, placesMax: 20, places: 0, couverts: 0, statut: null, finPrevueLe: null, formulePayee: true };
    repondre(200, { soldeMicroEur: 0, option: { ...option, avecApplication: true } });
    expect((await getCreditWhatsapp('t1')).option.avecApplication).toBe(true);
    for (const avecApplication of [undefined, 'oui', false]) {
      repondre(200, { soldeMicroEur: 0, option: { ...option, avecApplication } });
      expect((await getCreditWhatsapp('t1')).option.avecApplication, String(avecApplication)).toBe(false);
    }
  });

  it('🔴 une Entreprise : l’illimité et la consommation du mois passent tels quels', async () => {
    repondre(200, { illimite: true, soldeMicroEur: 0, consommationDuMoisMicroEur: 2_149_520 });
    expect(await getCreditWhatsapp('t1')).toMatchObject({ illimite: true, consommationDuMoisMicroEur: 2_149_520 });
  });

  it('🔴 un solde absent est une erreur, jamais un zéro inventé qui dirait « épuisé »', async () => {
    repondre(200, {});
    await expect(getCreditWhatsapp('t1')).rejects.toThrow();
  });
});

describe('ouvrirAchatWhatsapp : ce qu’une réponse veut dire', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('200 : l’adresse de la page de paiement, et le corps ne porte que l’offre', async () => {
    const appels = repondre(200, { url: 'https://checkout.stripe.com/c/pay/cs_wa' });
    expect(await ouvrirAchatWhatsapp('t1', 'wa_250')).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_wa' });
    expect(appels[0]!.url).toContain('/tenants/t1/credit-whatsapp/achat');
    expect(appels[0]!.corps).toEqual({ offre: 'wa_250' });
  });

  it('🔴 404 (route pas encore déployée) et 503 (prix pas posés) : pas encore disponible', async () => {
    repondre(404, { message: 'Route not found' });
    expect(await ouvrirAchatWhatsapp('t1', 'wa_50')).toEqual({ indisponible: true });
    vi.unstubAllGlobals();
    repondre(503, { error: 'Le Crédit WhatsApp n’est pas encore en vente.', code: 'credit_whatsapp_indisponible' });
    expect(await ouvrirAchatWhatsapp('t1', 'wa_50')).toEqual({ indisponible: true });
  });

  it('409 (numéro arrêté) : le refus remonte avec le message du serveur', async () => {
    repondre(409, { error: 'Aucun numéro de cet espace n’est sur le Crédit WhatsApp.', code: 'credit_whatsapp_sans_ligne' });
    const err = await ouvrirAchatWhatsapp('t1', 'wa_100').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toContain('Crédit WhatsApp');
  });
});

describe('l’option : la prendre, changer ses places', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('200 : l’adresse de la page de paiement, et le corps ne porte que le nombre de numéros', async () => {
    const appels = repondre(200, { url: 'https://checkout.stripe.com/c/pay/cs_option' });
    expect(await ouvrirOptionWhatsapp('t1', 3)).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_option' });
    expect(appels[0]!.url).toContain('/tenants/t1/credit-whatsapp/option');
    expect(appels[0]!.corps).toEqual({ places: 3 });
  });

  it('🔴 depuis les cartes « Qui paie vos messages à Meta ? », le corps dit l’origine, pour que Stripe ramène sur Connecter WhatsApp', async () => {
    const appels = repondre(200, { url: 'https://checkout.stripe.com/c/pay/cs_option' });
    expect(await ouvrirOptionWhatsapp('t1', 1, 'connecter')).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_option' });
    expect(appels[0]!.corps).toEqual({ places: 1, origine: 'connecter' });
  });

  it('🔴 404 (route pas encore déployée) et 503 (prix pas posé) : pas encore disponible ; un autre refus remonte', async () => {
    repondre(404, { message: 'Route not found' });
    expect(await ouvrirOptionWhatsapp('t1', 1)).toEqual({ indisponible: true });
    vi.unstubAllGlobals();
    repondre(503, { error: 'L’option Crédit WhatsApp n’est pas encore en vente : contactez-nous.', code: 'option_indisponible' });
    expect(await ouvrirOptionWhatsapp('t1', 1)).toEqual({ indisponible: true });
    vi.unstubAllGlobals();
    repondre(409, { error: 'Votre espace a déjà l’option Crédit WhatsApp : changez son nombre de numéros.', code: 'option_deja_prise' });
    await expect(ouvrirOptionWhatsapp('t1', 1)).rejects.toThrow(/déjà l’option/);
  });

  it('un changement de places part en PATCH, avec les places lues et la cible', async () => {
    const appels = repondre(200, { places: 3 });
    expect(await changerPlacesOption('t1', 2, 3)).toEqual({ places: 3 });
    expect(appels[0]!.url).toContain('/tenants/t1/credit-whatsapp/option');
    expect(appels[0]!.corps).toEqual({ depuis: 2, cible: 3 });
  });

  it('🔴 un ajout dont le prorata n’est pas payé (402) donne la page de sa facture, en https seulement', async () => {
    const refus = async (status: number, corps: unknown): Promise<unknown> => {
      vi.unstubAllGlobals();
      repondre(status, corps);
      return changerPlacesOption('t1', 1, 2).catch((e: unknown) => e);
    };
    const facture = 'https://invoice.stripe.com/i/acct_1/test_facture';
    expect(factureDeLaPlace(await refus(402, { error: 'non abouti', code: 'paiement_place_incomplet', url: facture }))).toBe(facture);
    expect(factureDeLaPlace(await refus(402, { error: 'non abouti', code: 'paiement_place_incomplet', url: 'javascript:alert(1)' }))).toBeNull();
    expect(factureDeLaPlace(await refus(402, { error: 'non abouti', code: 'autre', url: facture }))).toBeNull();
    expect(factureDeLaPlace(await refus(409, { error: 'changé', code: 'paiement_place_incomplet', url: facture }))).toBeNull();
    expect(factureDeLaPlace(new Error('réseau'))).toBeNull();
  });
});

describe('aUneFactureWhatsapp', () => {
  const ligne = (o: Partial<LigneCreditWhatsapp>): LigneCreditWhatsapp => ({
    id: 'm1', raison: 'achat', deltaMicroEur: 50_000_000, jour: null, at: '2026-10-31T10:00:00.000Z', messages: null,
    reference: 'cs_live_wa', facture: true, ...o,
  });

  it('un achat avec sa facture et sa session : oui ; sans facture, sans session ou un envoi : non', () => {
    expect(aUneFactureWhatsapp(ligne({}))).toBe(true);
    expect(aUneFactureWhatsapp(ligne({ facture: false }))).toBe(false);
    expect(aUneFactureWhatsapp(ligne({ reference: null }))).toBe(false);
    expect(aUneFactureWhatsapp(ligne({ reference: '' }))).toBe(false);
    expect(aUneFactureWhatsapp(ligne({ raison: 'envois', reference: null, facture: false }))).toBe(false);
  });
});

describe('lireEtatLigne : l’état pour les cartes « Qui paie vos messages à Meta ? » (lot B)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('rend l’état, la vente et les numéros avec l’application tels que le serveur les donne', async () => {
    const appels = repondre(200, { etat: 'essai', enVente: true, avecApplication: true, fenetrePartenaire: true });
    expect(await lireEtatLigne('t1')).toEqual({ etat: 'essai', enVente: true, avecApplication: true, fenetrePartenaire: true });
    expect(appels[0]!.url).toContain('/tenants/t1/credit-whatsapp/etat');
  });

  it('🔴 un état inconnu, ou une route absente (404) ou fermée à l’offre (402) : rien, la carte reste neutre', async () => {
    repondre(200, { etat: 'perdu', enVente: true });
    expect(await lireEtatLigne('t1')).toBeNull();
    for (const status of [402, 404]) {
      vi.unstubAllGlobals();
      repondre(status, { error: 'non' });
      expect(await lireEtatLigne('t1'), String(status)).toBeNull();
    }
  });

  it('🔴 une vente ou des numéros illisibles valent faux : jamais un bouton de paiement inventé', async () => {
    // La fenêtre du partenaire (lot E) aussi : un champ illisible ou absent (une API d'avant), jamais un bouton.
    repondre(200, { etat: 'a_prendre', enVente: 'oui', avecApplication: 1, fenetrePartenaire: 'oui' });
    expect(await lireEtatLigne('t1')).toEqual({ etat: 'a_prendre', enVente: false, avecApplication: false, fenetrePartenaire: false });
  });
});
