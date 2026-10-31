import { describe, it, expect } from 'vitest';
import { OUTILS_AGENT } from '../src/mcp/outils-agent';
import type { DepsMcp, PersonneMcp } from '../src/mcp/outils';
import type { ReponseStripe, TransportStripe } from '../src/stripe/client';
import type { GrilleMeta } from '../src/credit-whatsapp/grille';
import { creditWhatsappInerte, mcpAgentInerte } from './routes-inertes';

/**
 * LE CRÉDIT WHATSAPP CÔTÉ CLAUDE (plan du Crédit WhatsApp, tâche 11) : `get_credit` le montre à un espace dont un numéro
 * est sur la ligne, jamais ailleurs ; `buy_credit` ouvre son achat (offres `wa_*`, ou `credit: "whatsapp"`). Les outils
 * appelés directement, sur les MÊMES objets que la console (ici des faux).
 */
const T1 = '5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01';
const PERSONNE = { userId: 'u1' } as PersonneMcp;
const outil = (nom: string) => OUTILS_AGENT.find((o) => o.nom === nom)!;

const GRILLE: GrilleMeta = {
  id: 'g1', enVigueurLe: '2026-10-01',
  tarifs: [
    { marche: 'FR', categorie: 'marketing', palier: 0, prixMicroEur: 71_200 },
    { marche: 'FR', categorie: 'utility', palier: 0, prixMicroEur: 30_000 },
    { marche: 'FR', categorie: 'authentication', palier: 0, prixMicroEur: 30_000 },
    { marche: 'FR', categorie: 'service', palier: 0, prixMicroEur: 24_800 },
  ],
};

class FauxStripe implements TransportStripe {
  readonly sessions: URLSearchParams[] = [];
  async post(url: string, corps: string): Promise<ReponseStripe> {
    if (url.endsWith('/customers')) return { status: 200, json: { id: 'cus_A' } };
    this.sessions.push(new URLSearchParams(corps));
    return { status: 200, json: { id: 'cs_live_1', url: 'https://checkout.stripe.com/c/pay/cs_live_1' } };
  }
  async get(): Promise<ReponseStripe> {
    return { status: 200, json: { id: 'price_wa_100', unit_amount: 10_000, currency: 'eur', tax_behavior: 'exclusive' } };
  }
  async delete(): Promise<ReponseStripe> { throw new Error('non prévu'); }
}

function deps(o: { onglet: boolean }) {
  const transport = new FauxStripe();
  const d = {
    ...mcpAgentInerte,
    couteux: { consommer: async () => ({ accepte: true, attenteMs: 0 }) },
    agentIa: {
      ...mcpAgentInerte.agentIa,
      gestion: { ...mcpAgentInerte.agentIa.gestion, credits: { solde: async () => 4_000_000, historique: async () => [] } },
      creditWhatsapp: {
        ...creditWhatsappInerte,
        onglet: async () => o.onglet,
        achat: {
          ...creditWhatsappInerte.achat,
          stripe: {
            cle: 'rk_live_x', livemode: true, transport,
            prix: { wa_50: 'price_wa_50', wa_100: 'price_wa_100', wa_250: 'price_wa_250', wa_500: 'price_wa_500' },
            pageOffre: 'https://console.exemple/offre', pageClaude: 'https://console.exemple/paiement-recu',
          },
          payeurAutorise: async () => true,
          achatPermis: async () => 'ok' as const,
        },
        vue: {
          ...creditWhatsappInerte.vue,
          solde: async () => 12_340_000,
          grille: async () => GRILLE,
          historique: async () => [{ id: 'envois:2026-10-31', raison: 'envois', deltaMicroEur: -149_520, jour: '2026-10-31', at: '2026-10-31T10:00:00.000Z', messages: 2, reference: null, facture: false }],
        },
      },
    },
  } as unknown as DepsMcp;
  return { d, transport };
}

describe('get_credit et le Crédit WhatsApp', () => {
  it('🔴 sans numéro sur la ligne, `get_credit` n’en dit RIEN (pas de clé, pas de solde à zéro)', async () => {
    const r = await outil('get_credit').executer(deps({ onglet: false }).d, T1, {}, PERSONNE) as Record<string, unknown>;
    expect(r).not.toHaveProperty('credit_whatsapp');
    expect(r.solde_eur).toBeDefined();
  });

  it('🔴 avec un numéro sur la ligne : le solde, le prix en France commission comprise (jamais son taux), les envois du jour', async () => {
    const r = await outil('get_credit').executer(deps({ onglet: true }).d, T1, {}, PERSONNE) as { credit_whatsapp: Record<string, unknown> };
    const wa = r.credit_whatsapp;
    expect(wa.solde_eur).toBeDefined();
    expect(Object.keys(wa.prix_france_eur as object)).toEqual(['marketing', 'utility', 'authentication', 'service']);
    expect(JSON.stringify(r)).not.toMatch(/commission/i);
    expect(wa.mouvements).toEqual([expect.objectContaining({ raison: 'envois', messages: 2 })]);
  });
});

describe('buy_credit et le Crédit WhatsApp', () => {
  it('🔴 une offre `wa_*` ouvre l’achat du Crédit WhatsApp (produit et codes promo fermés), retour par la page publique', async () => {
    const { d, transport } = deps({ onglet: true });
    const r = await outil('buy_credit').executer(d, T1, { offre: 'wa_100' }, PERSONNE) as Record<string, unknown>;
    expect(r).toMatchObject({ url: 'https://checkout.stripe.com/c/pay/cs_live_1', offre: 'wa_100', credit: 'whatsapp', montant_ht_eur: 100 });
    const session = transport.sessions[0]!;
    expect(session.get('metadata[produit]')).toBe('credit_whatsapp');
    expect(session.get('allow_promotion_codes')).toBe('false');
    expect(session.get('success_url')).toBe('https://console.exemple/paiement-recu?produit=credit_whatsapp');
  });

  it('`credit: "whatsapp"` avec une offre du crédit IA est refusé ; sans `credit`, une offre `refill_*` reste au crédit IA', async () => {
    const { d, transport } = deps({ onglet: true });
    await expect(outil('buy_credit').executer(d, T1, { offre: 'refill_50', credit: 'whatsapp' }, PERSONNE)).rejects.toThrow(/offre inconnue/);
    expect(transport.sessions).toEqual([]);
  });

  it('la description annonce les deux familles d’offres, et le schéma les accepte', () => {
    const b = outil('buy_credit');
    expect(b.description).toMatch(/wa_50/);
    expect(b.description).toMatch(/refill_5/);
    expect((b.entree as unknown as { properties: { credit: { enum: string[] } } }).properties.credit.enum).toEqual(['ia', 'whatsapp']);
  });
});
