import { describe, it, expect } from 'vitest';
import { balayerRendezVous, type DepsRendezVous } from '../src/hubspot/rendez-vous';
import { origineHubspot } from '../src/hubspot/origine';
import type { LigneHubspot } from '../src/hubspot/lignes';
import type { EvenementDeLigne } from '../src/hubspot/circuit';
import type { Fonction } from '../src/offres/offres';

/**
 * LE BALAYAGE DES RENDEZ-VOUS HUBSPOT (menu « Scénario », lot 6b, tâche 2) : dans l'API, comme la relance des paniers (l'envoi
 * public n'existe que là). Les lignes de rendez-vous allumées du rayon `hubspot`, leur propriété date importée de HubSpot,
 * l'échéance jugée par la règle du déclencheur de date (`estDu`), et chaque contact dû servi par le circuit, son tir posé
 * avec la date pour marqueur (un rendez-vous déplacé redonne un rappel).
 */
const L1 = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-11-19T09:00:00Z');
const rdv = (id: string, over: Partial<{ fieldKey: string; sens: 'avant' | 'apres'; delaiMinutes: number }> = {}): LigneHubspot => ({
  id, famille: 'rdv', config: { fieldKey: 'hs_rdv', sens: 'avant', delaiMinutes: 1440, ...over }, actif: true, workflowId: `wf-${id}`, nom: 'Rappel J-1',
});
/** Un rendez-vous demain à la même heure : dû maintenant pour un rappel la veille. */
const DEMAIN = '2026-11-20T09:00:00.000Z';

function monter(o: {
  espaces?: string[]; lignes?: Record<string, LigneHubspot[]>; contacts?: Array<{ waId: string; valeur: string; dejaTirePour: string | null }>;
  branchees?: boolean; fonctions?: Fonction[]; servir?: DepsRendezVous['servir']; lignesQuiLevent?: string[];
} = {}) {
  const servis: Array<{ t: string; e: EvenementDeLigne }> = [];
  const fenetres: Array<{ t: string; ligne: string; champ: string; basse: string; haute: string }> = [];
  const deps: DepsRendezVous = {
    lignes: {
      tenantsAvecRendezVous: async () => o.espaces ?? ['t1'],
      rendezVousAllumes: async (t) => (o.lignes ?? { t1: [rdv(L1)] })[t] ?? [],
    },
    declencheurs: {
      contactsDusPourDate: async (t, ligne, champ, basse, haute) => {
        if (o.lignesQuiLevent?.includes(ligne)) throw new Error('panne');
        fenetres.push({ t, ligne, champ, basse, haute });
        return o.contacts ?? [{ waId: '33612345678', valeur: DEMAIN, dejaTirePour: null }];
      },
    },
    automationsBranchees: async () => o.branchees ?? true,
    fonctions: async () => new Set<Fonction>(o.fonctions ?? ['crm', 'scenarios']),
    timeZone: async () => 'Europe/Paris',
    servir: o.servir ?? (async (t, e) => { servis.push({ t, e }); return 'envoye'; }),
    toleranceMinutes: 60,
    now: () => NOW,
  };
  return { deps, servis, fenetres };
}

describe('le balayage des rendez-vous HubSpot', () => {
  it('🔴 un contact dû est servi par le circuit : l’origine du rendez-vous, le numéro, et la date pour marqueur', async () => {
    const m = monter();
    expect(await balayerRendezVous(m.deps)).toBe(1);
    expect(m.servis).toEqual([{
      t: 't1',
      e: {
        ligne: rdv(L1), telephone: '+33612345678', waId: '33612345678', marqueur: DEMAIN,
        origine: origineHubspot({ famille: 'rdv', ligne: L1, contact: '33612345678', champ: 'hs_rdv', date: DEMAIN }),
      },
    }]);
    // La fenêtre grossière autour de l'échéance, sur la propriété de la ligne, centrée sur maintenant + délai.
    expect(m.fenetres).toEqual([{ t: 't1', ligne: L1, champ: 'hs_rdv', basse: '2026-11-19T09:00:00.000Z', haute: '2026-11-21T09:00:00.000Z' }]);
  });

  it('🔴 pas encore dû, trop tard, ou déjà tiré pour cette date : rien n’est servi ; une date déplacée redonne un rappel', async () => {
    const cas = [
      { waId: '33600000001', valeur: '2026-11-21T09:00:00.000Z', dejaTirePour: null },
      { waId: '33600000002', valeur: '2026-11-20T06:00:00.000Z', dejaTirePour: null },
      { waId: '33600000003', valeur: DEMAIN, dejaTirePour: DEMAIN },
      { waId: '33600000004', valeur: DEMAIN, dejaTirePour: '2026-11-18T09:00:00.000Z' },
    ];
    const m = monter({ contacts: cas });
    expect(await balayerRendezVous(m.deps)).toBe(1);
    expect(m.servis.map((s) => s.e.waId)).toEqual(['33600000004']);
  });

  it('« après » : la fenêtre se centre de l’autre côté de maintenant', async () => {
    const m = monter({ lignes: { t1: [rdv(L1, { sens: 'apres', delaiMinutes: 60 })] }, contacts: [{ waId: '33612345678', valeur: '2026-11-19T08:00:00.000Z', dejaTirePour: null }] });
    expect(await balayerRendezVous(m.deps)).toBe(1);
    expect(m.fenetres[0]).toMatchObject({ basse: '2026-11-18T08:00:00.000Z', haute: '2026-11-20T08:00:00.000Z' });
  });

  it('🔴 « Automations HubSpot » éteinte, ou une offre sans `crm` : l’espace est passé, rien n’est lu ni servi', async () => {
    for (const m of [monter({ branchees: false }), monter({ fonctions: ['scenarios'] })]) {
      expect(await balayerRendezVous(m.deps)).toBe(0);
      expect([m.fenetres, m.servis]).toEqual([[], []]);
    }
  });

  it('un contact sans numéro (identifiant de Meta seul) n’est pas servi : un template part vers un numéro', async () => {
    const m = monter({ contacts: [{ waId: 'BR.abc123', valeur: DEMAIN, dejaTirePour: null }] });
    expect(await balayerRendezVous(m.deps)).toBe(0);
    expect(m.servis).toEqual([]);
  });

  it('🔴 une ligne en panne n’empêche pas les autres ; seul ce qui est parti est compté', async () => {
    const m = monter({ lignes: { t1: [rdv(L1), rdv(L2)] }, lignesQuiLevent: [L1] });
    expect(await balayerRendezVous(m.deps)).toBe(1);
    expect(m.servis.map((s) => s.e.ligne.id)).toEqual([L2]);
    const refuse = monter({ servir: async () => 'plafond' });
    expect(await balayerRendezVous(refuse.deps)).toBe(0);
  });
});
