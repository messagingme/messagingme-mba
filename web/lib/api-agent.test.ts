import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCreditIa, getSoldeAgent } from './api-agent';

/**
 * Le Crédit IA côté navigateur. 🔴 La console part avant l'API (Vercel publie au push) : une API d'avant l'Entreprise
 * illimitée ne rend que le solde, et l'écran doit alors se lire comme un prépayé, jamais comme un illimité inventé.
 */
function repondre(corps: unknown): Array<{ url: string }> {
  const appels: Array<{ url: string }> = [];
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    appels.push({ url });
    return new Response(JSON.stringify(corps), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return appels;
}

describe('getCreditIa', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('🔴 une Entreprise : l’illimité, la consommation du mois et le plafond atteint passent tels quels', async () => {
    const appels = repondre({ soldeMicroEur: 4_820_000, illimite: true, consommationDuMoisMicroEur: 100_020_000, plafondAtteint: true });
    expect(await getCreditIa('t1')).toEqual({ soldeMicroEur: 4_820_000, illimite: true, consommationDuMoisMicroEur: 100_020_000, plafondAtteint: true });
    expect(appels[0]!.url).toContain('/tenants/t1/agents/solde');
  });

  it('🔴 une API plus ancienne (le solde seul) se lit comme un prépayé : ni illimité, ni plafond, aucune consommation', async () => {
    repondre({ soldeMicroEur: 3_000_000 });
    expect(await getCreditIa('t1')).toEqual({ soldeMicroEur: 3_000_000, illimite: false, consommationDuMoisMicroEur: 0, plafondAtteint: false });
  });

  it('un solde absent reste `null` (aucun crédit suivi), jamais un zéro qui dirait « épuisé »', async () => {
    repondre({ soldeMicroEur: null });
    expect(await getCreditIa('t1')).toMatchObject({ soldeMicroEur: null, illimite: false });
    repondre({});
    expect(await getSoldeAgent('t1')).toBeNull();
  });
});
