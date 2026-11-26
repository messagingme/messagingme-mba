import { describe, it, expect } from 'vitest';
import { OUTILS, type DepsMcp } from '../src/mcp/outils';
import { RefusOutil } from '../src/mcp/saisie';
import type { EtatConfirme } from '../src/campaign/confirmation';
import { accepter, proposer } from '../src/mise-en-ligne/mise-en-ligne';
import type { DepsEnvoisAuOui } from '../src/mise-en-ligne/envois';
import { ADMIN, CSM, monter } from './mise-en-ligne-fixtures';

/**
 * `launch_campaign` depuis le oui (lot 1 du CSM virtuel, B8, décisions de Julien du 2026-11-26) : il prend l'identifiant du
 * clic, plus un code. 🔴 Rien ne part sans le clic d'un admin dans la console ; le clic lance par le MÊME chemin que le
 * bouton de la console (`lancerCampagne`, réel ici, sur un faux câblage de la route) : une campagne datée est PROGRAMMÉE
 * à sa date, jamais envoyée tout de suite ; la reprise d'une campagne en pause repart tout de suite. L'outil rend ce que
 * le clic a fait, et reprend un clic coupé sans rien renvoyer.
 */
const T = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ID = '55555555-5555-4555-8555-555555555555';
const AUTRE_CAMPAGNE = '66666666-6666-4666-8666-666666666666';
const PERSONNE = { userId: 'u1', autorisationId: 'aut-1' };
const outil = OUTILS.find((o) => o.nom === 'launch_campaign')!;

const ETAT: EtatConfirme = {
  templateName: 'retard_livraison', templateLanguage: 'fr', category: 'utility', prevueLe: null,
  paramMapping: [], recipientCount: 38, status: 'draft',
};

function monterLancement(o: {
  etat?: EtatConfirme | null; programmable?: boolean; appartient?: boolean;
  credit?: { montantMicroEur: number; soldeMicroEur: number; manqueMicroEur: number } | null;
} = {}) {
  const trace: string[] = [];
  const etats = new Map<string, EtatConfirme | null>([[ID, o.etat === undefined ? ETAT : o.etat], [AUTRE_CAMPAGNE, ETAT]]);
  // Le câblage de la route des campagnes : les MÊMES objets pour l'outil (`campagnes.route`) et pour le clic (`envois`).
  const route = {
    repo: {
      etatPourConfirmation: async (t: string, id: string) => (t === T ? etats.get(id) ?? null : null),
      pauseDe: async (t: string) => (t === T ? { motif: null, jusqua: null } : null),
      campaignBelongsTo: async (_id: string, t: string) => (o.appartient ?? true) && t === T,
      scheduleCampaign: async (_id: string, _t: string, quand: Date) => { trace.push(`programme:${quand.toISOString()}`); return o.programmable ?? true; },
      resumeCampaign: async () => { trace.push('reprend'); return true; },
      pauseCampaign: async () => true,
      getRunSizing: async () => ({ ratePerMinute: null, pendingCount: 38 }),
    },
    queue: { enqueue: async (name: string, data: unknown) => { trace.push(`enfile:${name}:${JSON.stringify(data)}`); } },
    modelesDuLancement: async () => null,
    creditDuLancement: async () => o.credit ?? null,
    defaultRatePerMinute: 0,
    plafondLePlusBas: 80,
  };
  const m = monter({ envois: { campagnes: route, suppression: { selection: async () => [], effacement: {} } } as unknown as DepsEnvoisAuOui });
  const d = {
    couteux: { consommer: async () => { trace.push('plafond'); return { accepte: true, attenteMs: 0 }; } },
    campagnes: { route },
    misesEnLigne: m.deps,
  } as unknown as DepsMcp;
  /** Le oui tel que `prepare_campaign` le prépare, puis, si demandé, le clic d'un admin. */
  const oui = async (clic: boolean, campagne = ID): Promise<string> => {
    const r = await proposer(m.deps, T, CSM, [{ type: 'campagne', campagne }]);
    if (!r.ok) throw new Error(`oui refusé : ${r.erreur}`);
    if (clic) await accepter(m.deps, T, r.valeur.id, ADMIN);
    return r.valeur.id;
  };
  return { d, trace, m, etats, oui };
}

describe('launch_campaign (B8 : l’identifiant du clic)', () => {
  it('🔴 une écriture au nom d’une personne, qui exige l’identifiant du oui, plus aucun code', () => {
    expect(outil).toMatchObject({ scope: 'mcp:write', exigePersonne: true });
    expect(outil.entree.required).toEqual(['campaign_id', 'go_live_id']);
    expect(Object.keys(outil.entree.properties)).not.toContain('confirmation_code');
  });

  it('🔴 cliqué : lancé par le chemin de la console, et l’outil le rend', async () => {
    const { d, trace, oui } = monterLancement();
    const id = await oui(true);
    // Le chemin du bouton « Lancer » : la pause levée (sans effet sur un brouillon), puis le run enfilé.
    expect(trace).toEqual(['reprend', `enfile:campaign-run:${JSON.stringify({ campaignId: ID })}`]);
    expect(await outil.executer(d, T, { campaign_id: ID, go_live_id: id }, PERSONNE)).toMatchObject({ campaign_id: ID, status: 'sending', recipients: 38 });
    // Rien n'est relancé par l'outil : un seul enfilement.
    expect(trace.filter((t) => t.startsWith('enfile'))).toHaveLength(1);
  });

  it('🔴 pas encore cliqué : refusé, RIEN ne part ; expiré : refusé', async () => {
    const { d, trace, m, oui } = monterLancement();
    const id = await oui(false);
    await expect(outil.executer(d, T, { campaign_id: ID, go_live_id: id }, PERSONNE)).rejects.toMatchObject({ code: 'conflict' });
    m.horloge.now += 25 * 3_600_000;
    await expect(outil.executer(d, T, { campaign_id: ID, go_live_id: id }, PERSONNE)).rejects.toMatchObject({ code: 'conflict' });
    expect(trace.some((t) => t.startsWith('enfile') || t.startsWith('programme') || t === 'reprend')).toBe(false);
  });

  it('🔴 il manque du Crédit WhatsApp : le clic n’envoie rien, l’outil le dit avec sa famille', async () => {
    const { d, trace, oui } = monterLancement({ credit: { montantMicroEur: 9_000_000, soldeMicroEur: 1_000_000, manqueMicroEur: 8_000_000 } });
    const id = await oui(true);
    expect(trace.some((t) => t.startsWith('enfile'))).toBe(false);
    await expect(outil.executer(d, T, { campaign_id: ID, go_live_id: id }, PERSONNE)).rejects.toMatchObject({ code: 'credit_required' });
  });

  it('🔴 une campagne datée est PROGRAMMÉE à sa date, rien n’est enfilé', async () => {
    const quand = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const { d, trace, m, oui } = monterLancement({ etat: { ...ETAT, prevueLe: quand } });
    m.horloge.now = Date.now();
    const id = await oui(true);
    expect(trace).toEqual([`programme:${quand}`]);
    expect(await outil.executer(d, T, { campaign_id: ID, go_live_id: id }, PERSONNE)).toMatchObject({ status: 'scheduled' });
  });

  it('🔴 la campagne d’un autre espace : « inconnue », avant toute reprise ; lire un résultat n’entame pas le plafond', async () => {
    const { d, trace, oui } = monterLancement();
    const id = await oui(false);
    await expect(outil.executer(d, 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', { campaign_id: ID, go_live_id: id }, PERSONNE)).rejects.toMatchObject({ code: 'not_found' });
    expect(trace).toEqual([]);
    const fait = await oui(true);
    await outil.executer(d, T, { campaign_id: ID, go_live_id: fait }, PERSONNE);
    expect(trace).not.toContain('plafond');
  });

  it('🔴 un refus noté au clic d’une REPRISE garde la consigne de reprise, jamais « préparez à nouveau »', async () => {
    const { d, oui } = monterLancement({
      // Le lancement refusé au clic (la campagne n'appartient plus à l'espace pour `lancerCampagne`) : un refus noté.
      etat: { ...ETAT, status: 'paused', recipientCount: 2 }, appartient: false,
    });
    const id = await oui(true);
    const refus = await outil.executer(d, T, { campaign_id: ID, go_live_id: id }, PERSONNE).catch((e: Error) => e.message);
    expect(refus).toMatch(/prepare_resume/);
    expect(refus).not.toMatch(/prepare_campaign/);
  });

  it('🔴 le oui d’une AUTRE campagne : refusé, rien ne part', async () => {
    const { d, trace, oui } = monterLancement();
    const id = await oui(true, AUTRE_CAMPAGNE);
    const avant = trace.length;
    await expect(outil.executer(d, T, { campaign_id: ID, go_live_id: id }, PERSONNE)).rejects.toMatchObject({ code: 'conflict' });
    expect(trace.slice(avant).some((t) => t.startsWith('enfile'))).toBe(false);
  });

  it('une campagne que la base ne programme plus (déjà en cours ou terminée) : « déjà partie », rien n’est relancé', async () => {
    const quand = new Date(Date.now() + 86_400_000).toISOString();
    const { d, m, oui } = monterLancement({ etat: { ...ETAT, prevueLe: quand }, programmable: false });
    m.horloge.now = Date.now();
    const id = await oui(true);
    expect(await outil.executer(d, T, { campaign_id: ID, go_live_id: id }, PERSONNE)).toMatchObject({ status: 'already_launched' });
  });

  it('🔴 la reprise d’une campagne en pause repart TOUT DE SUITE : sa date passée ne la fait pas refuser', async () => {
    const { d, trace, oui } = monterLancement({ etat: { ...ETAT, status: 'paused', recipientCount: 2, prevueLe: '2020-01-01T09:00:00.000Z' } });
    const id = await oui(true);
    expect(trace).toEqual(['reprend', `enfile:campaign-run:${JSON.stringify({ campaignId: ID })}`]);
    expect(await outil.executer(d, T, { campaign_id: ID, go_live_id: id }, PERSONNE)).toMatchObject({ status: 'resumed', recipients: 2 });
  });

  it('🔴 le oui d’une reprise refusé (pas cliqué, expiré) ne renvoie JAMAIS vers prepare_campaign, qui écrirait à tous', async () => {
    const { d, m, oui } = monterLancement({ etat: { ...ETAT, status: 'paused', recipientCount: 2 } });
    const id = await oui(false);
    for (const avance of [0, 25 * 3_600_000]) {
      m.horloge.now += avance;
      const refus = await outil.executer(d, T, { campaign_id: ID, go_live_id: id }, PERSONNE).catch((e: Error) => e.message);
      expect(refus).not.toMatch(/prepare_campaign/);
      expect(refus).toMatch(/prepare_resume/);
    }
  });

  it('🔴 une campagne qui n’est plus ni brouillon ni en pause : le clic est refusé, rien ne part, et rien ne renvoie vers prepare_campaign', async () => {
    for (const status of ['running', 'scheduled', 'completed', 'failed']) {
      const { d, trace, etats, m, oui } = monterLancement();
      const id = await oui(false);
      etats.set(ID, { ...ETAT, status });
      const clic = await accepter(m.deps, T, id, ADMIN);
      expect(clic.ok ? '' : clic.erreur, status).not.toMatch(/prepare_campaign/);
      const refus = await outil.executer(d, T, { campaign_id: ID, go_live_id: id }, PERSONNE).catch((e: Error) => e.message);
      expect(refus, status).not.toMatch(/prepare_campaign/);
      expect(trace.some((t) => t.startsWith('enfile') || t.startsWith('programme') || t === 'reprend'), status).toBe(false);
    }
  });

  it('identifiant mal formé ou sans personne : refusé avant toute lecture', async () => {
    const { d, trace } = monterLancement();
    await expect(outil.executer(d, T, { campaign_id: 'pas-un-uuid', go_live_id: ID }, PERSONNE)).rejects.toThrow(RefusOutil);
    await expect(outil.executer(d, T, { campaign_id: ID, go_live_id: 'pas-un-uuid' }, PERSONNE)).rejects.toThrow(RefusOutil);
    await expect(outil.executer(d, T, { campaign_id: ID, go_live_id: ID }, null)).rejects.toThrow(RefusOutil);
    expect(trace).toEqual([]);
  });
});
