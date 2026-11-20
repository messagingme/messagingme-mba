import { describe, it, expect } from 'vitest';
import { audienceVoulue, creerAlignerAudience, realignerLesAudiences } from '../src/mba/audience';
import type { ClientReglages } from '../src/mba/client';
import type { ReglageDuRepondeur } from '../src/repondeur/mode';
import type { Fonction } from '../src/offres/offres';

/**
 * L'AUDIENCE VOULUE DE L'AGENT DE META (décision de Julien du 2026-11-20) : tout le monde quand il est le répondeur de
 * l'espace, sa liste seule sinon. Mesuré chez MUTAC le même jour : un inconnu qui écrivait au numéro restait sans réponse,
 * l'audience ayant été remise à la liste par le passage de main du balayage.
 */
const reglages = (o: Partial<ReglageDuRepondeur>): ReglageDuRepondeur => ({
  mbaEnabled: true, repondeurMode: 'mba', repondeurAgentId: null, repondeurWorkflowId: null, repondeurAdresseId: null, ...o,
});

describe('audienceVoulue', () => {
  it('🔴 tout le monde quand l’agent de Meta est le répondeur, allumé', () => {
    expect(audienceVoulue(reglages({}))).toBe('EVERYONE');
  });

  it('🔴 la liste dès qu’il ne l’est pas : éteint, ou un autre répondeur', () => {
    expect(audienceVoulue(reglages({ mbaEnabled: false }))).toBe('ALLOWLISTED_ONLY');
    expect(audienceVoulue(reglages({ repondeurMode: 'equipe' }))).toBe('ALLOWLISTED_ONLY');
    expect(audienceVoulue(reglages({ repondeurMode: 'agent', repondeurAgentId: 'ag' }))).toBe('ALLOWLISTED_ONLY');
    expect(audienceVoulue(reglages({ repondeurMode: 'scenario', repondeurWorkflowId: 'wf' }))).toBe('ALLOWLISTED_ONLY');
    expect(audienceVoulue(reglages({ repondeurMode: 'application', repondeurAdresseId: 'ad' }))).toBe('ALLOWLISTED_ONLY');
  });
});

describe('creerAlignerAudience', () => {
  /** Un faux Meta qui garde ses réglages et note chaque écriture. */
  function meta(audience: string | null) {
    let etat: Record<string, unknown> | null = audience === null ? null : { agent_id: 'a1', ai_audience: audience, handoff: { message: 'm' } };
    const ecritures: Array<Record<string, unknown>> = [];
    const client: ClientReglages = {
      getSettings: async () => etat,
      putSettings: async (_pn, s) => { ecritures.push(s as Record<string, unknown>); etat = s as Record<string, unknown>; return {}; },
    };
    return { client, ecritures };
  }
  const aligner = (r: ReglageDuRepondeur, client: ClientReglages, numero: string | null = 'pn1') =>
    creerAlignerAudience({ reglages: { get: async () => r }, numero: async () => numero, client: async () => client });

  it('🔴 ouvre l’agent à tout le monde quand il devient le répondeur, en gardant le reste des réglages', async () => {
    const m = meta('ALLOWLISTED_ONLY');
    await aligner(reglages({}), m.client)('t1');
    expect(m.ecritures).toHaveLength(1);
    expect(m.ecritures[0]).toMatchObject({ ai_audience: 'EVERYONE', handoff: { message: 'm' } });
  });

  it('🔴 le referme sur sa liste quand il ne l’est plus', async () => {
    const m = meta('EVERYONE');
    await aligner(reglages({ repondeurMode: 'equipe' }), m.client)('t1');
    expect(m.ecritures[0]).toMatchObject({ ai_audience: 'ALLOWLISTED_ONLY' });
  });

  it('n’écrit rien quand l’audience est déjà la bonne, sans numéro, ou sans réglages chez Meta', async () => {
    const deja = meta('EVERYONE');
    await aligner(reglages({}), deja.client)('t1');
    expect(deja.ecritures).toHaveLength(0);
    const sansNumero = meta('ALLOWLISTED_ONLY');
    await aligner(reglages({}), sansNumero.client, null)('t1');
    expect(sansNumero.ecritures).toHaveLength(0);
    const jamaisConfigure = meta(null);
    await aligner(reglages({}), jamaisConfigure.client)('t1');
    expect(jamaisConfigure.ecritures).toHaveLength(0);
  });

  it('🔴 ne lève jamais : le geste qui la précède est déjà écrit, chez nous et chez Meta', async () => {
    const enPanne: ClientReglages = { getSettings: async () => { throw new Error('Meta injoignable'); }, putSettings: async () => ({}) };
    await expect(aligner(reglages({}), enPanne)('t1')).resolves.toBeUndefined();
  });
});

describe('realignerLesAudiences : le filet', () => {
  const OFFRE_PLEINE = { droits: { fonctions: new Set<Fonction>(['agent_meta', 'scenarios']) } };
  const BASE = { droits: { fonctions: new Set<Fonction>() } };

  it('🔴 chaque espace relié reçoit l’audience de son répondeur, sous son offre ; une panne reste locale', async () => {
    const etats: Record<string, Record<string, unknown> | null> = {
      mba: { ai_audience: 'ALLOWLISTED_ONLY' },
      agentIA: { ai_audience: 'EVERYONE' },
      gele: { ai_audience: 'EVERYONE' },
      panne: { ai_audience: 'EVERYONE' },
      deja: { ai_audience: 'ALLOWLISTED_ONLY' },
    };
    const ecritures: Array<[string, unknown]> = [];
    const r: Record<string, ReglageDuRepondeur> = {
      mba: reglages({}),
      agentIA: reglages({ repondeurMode: 'agent', repondeurAgentId: 'ag' }),
      gele: reglages({}), // en mode `mba`, mais l'offre est retombée en Base
      panne: reglages({ repondeurMode: 'equipe' }),
      deja: reglages({ repondeurMode: 'equipe' }),
    };
    const n = await realignerLesAudiences({
      reglages: { tenantsAvecNumeroRelie: async () => Object.keys(r), get: async (t) => r[t]! },
      offres: { offreDe: async (t) => (t === 'gele' ? BASE : OFFRE_PLEINE) },
      numero: async (t) => `pn-${t}`,
      client: async (t) => ({
        getSettings: async () => { if (t === 'panne') throw new Error('Meta injoignable'); return etats[t]; },
        putSettings: async (_pn, s) => { ecritures.push([t, (s as Record<string, unknown>).ai_audience]); return {}; },
      }),
    });
    expect(ecritures).toEqual([['mba', 'EVERYONE'], ['agentIA', 'ALLOWLISTED_ONLY'], ['gele', 'ALLOWLISTED_ONLY']]);
    expect(n).toBe(3);
  });
});
