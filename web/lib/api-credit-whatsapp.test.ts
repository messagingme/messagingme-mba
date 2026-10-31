import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError } from './http';
import { aUneFactureWhatsapp, getCreditWhatsapp, ouvrirAchatWhatsapp, type LigneCreditWhatsapp } from './api-credit-whatsapp';

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
      soldeMicroEur: 12_340_000,
      prixFrance: [{ categorie: 'marketing', prixMicroEur: 74_760 }],
      franchiseServiceParNumero: 1000,
      achat: { disponible: true, permis: 'ok', offres: [{ offre: 'wa_50', htCentimes: 5_000 }] },
      ligneArretee: false,
      historique: [{ id: 'envois:2026-10-31', raison: 'envois', deltaMicroEur: -149_520, jour: '2026-10-31', at: '2026-10-31T10:00:00.000Z', messages: 2, reference: null, facture: false }],
    };
    const appels = repondre(200, vue);
    expect(await getCreditWhatsapp('t1')).toEqual(vue);
    expect(appels[0]!.url).toContain('/tenants/t1/credit-whatsapp');
  });

  it('🔴 un corps sans listes ne fait pas tomber l’écran : historique et offres vides, prix inconnus', async () => {
    repondre(200, { soldeMicroEur: 0 });
    expect(await getCreditWhatsapp('t1')).toEqual({
      soldeMicroEur: 0, prixFrance: null, franchiseServiceParNumero: 0,
      achat: { disponible: false, permis: 'ok', offres: [] }, ligneArretee: false, historique: [],
    });
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
