import { describe, it, expect } from 'vitest';
import { calculerRoi, PLAFOND_SOURCES_ROI, type EntreeRoi } from '../src/shopify/roi';
import { prixServiceEffectif } from '../src/stats/cout-messages';
import { GRILLE_DEFAUT } from '../src/stats/prix';
import type { LigneLevier } from '../src/shopify/cout-leviers.pg';

/** Les valeurs sont calculées à la main : chaque cas dit son calcul. */
const ligne = (o: Partial<LigneLevier>): LigneLevier => ({
  jour: '2026-11-02', source: 'campagne', campaignId: 'k1', nom: 'Soldes', nature: 'modele', categorie: 'marketing',
  n: 0, nProvision: 0, provisionMicroEur: 0, ...o,
});

const base = (o: Partial<EntreeRoi>): EntreeRoi => ({
  range: { from: '2026-11-01', to: '2026-11-03' },
  serieChiffre: [],
  totaux: [],
  sources: [],
  leviers: [],
  iaParJour: [],
  tarifs: { marketing: 0.1, utility: 0.02, currency: 'EUR' },
  prixService: 0,
  grille: GRILLE_DEFAUT,
  ...o,
});

describe('calculerRoi', () => {
  it('400 modèles marketing à 0,10 € (40 €) pour 920 € de ventes : ROI de 2 200 %', () => {
    const r = calculerRoi(base({
      leviers: [ligne({ n: 400 })],
      totaux: [{ devise: 'EUR', brut: '920', prouve: '300', commandes: 4 }],
      sources: [{ source: 'campagne', campaignId: 'k1', nom: 'Soldes', devise: 'EUR', brut: '920', prouve: '300', commandes: 4 }],
      serieChiffre: [{ jour: '2026-11-03', devise: 'EUR', brutCumule: '920', prouveCumule: '300' }],
    }));
    expect(r.depense).toBe(40);
    expect(r.ramene).toBe('920');
    expect(r.prouve).toBe('300');
    expect(r.roiPct).toBe(2200); // (920 - 40) / 40 = 22
    expect(r.estime).toBe(true);
    expect(r.sources).toEqual([
      { source: 'campagne', campaignId: 'k1', nom: 'Soldes', cout: 40, brut: '920', roiPct: 2200, partiel: false },
    ]);
  });

  it('la série est dense et cumulée, et son dernier point égale les totaux', () => {
    const r = calculerRoi(base({
      leviers: [ligne({ jour: '2026-11-01', n: 100 }), ligne({ jour: '2026-11-03', n: 50 })],
      totaux: [{ devise: 'EUR', brut: '70.5', prouve: '0', commandes: 2 }],
      serieChiffre: [{ jour: '2026-11-02', devise: 'EUR', brutCumule: '20', prouveCumule: '0' },
        { jour: '2026-11-03', devise: 'EUR', brutCumule: '70.5', prouveCumule: '0' }],
    }));
    expect(r.serie).toEqual([
      { jour: '2026-11-01', chiffreCumule: '0', coutCumule: 10 },
      { jour: '2026-11-02', chiffreCumule: '20', coutCumule: 10 },
      { jour: '2026-11-03', chiffreCumule: '70.5', coutCumule: 15 },
    ]);
    expect(r.depense).toBe(15);
    expect(r.ramene).toBe('70.5');
  });

  it('rien n’a coûté : pas de ROI (jamais une division par zéro ni un « infini »)', () => {
    const r = calculerRoi(base({ totaux: [{ devise: 'EUR', brut: '50', prouve: '0', commandes: 1 }] }));
    expect(r.depense).toBe(0);
    expect(r.roiPct).toBeNull();
  });

  it('une période sans aucune vente mais avec des envois : ramené 0, ROI de -100 %', () => {
    const r = calculerRoi(base({ leviers: [ligne({ n: 10 })] }));
    expect(r.ramene).toBe('0');
    expect(r.depense).toBe(1);
    expect(r.roiPct).toBe(-100);
    expect(r.sources[0]).toMatchObject({ cout: 1, brut: '0', roiPct: -100 });
  });

  it('la provision du Crédit WhatsApp est préférée à l’estimation, message par message', () => {
    // 10 messages : 4 provisionnés pour 0,60 € au total, 6 estimés à 0,10 € (0,60 €).
    const r = calculerRoi(base({ leviers: [ligne({ n: 10, nProvision: 4, provisionMicroEur: 600_000 })] }));
    expect(r.depense).toBe(1.2);
    // Tout provisionné : rien d'estimé.
    const tout = calculerRoi(base({ leviers: [ligne({ n: 4, nProvision: 4, provisionMicroEur: 600_000 })] }));
    expect(tout.depense).toBe(0.6);
    expect(tout.estime).toBe(false);
  });

  it('une boutique en USD, l’IA et le Crédit WhatsApp en EUR : le ROI sur l’USD, l’EUR à part et annoncé', () => {
    const r = calculerRoi(base({
      tarifs: { marketing: 0.1, utility: 0.02, currency: 'USD' },
      leviers: [ligne({ n: 100 }), ligne({ n: 5, nProvision: 5, provisionMicroEur: 500_000 })],
      iaParJour: [{ jour: '2026-11-02', coutMicroEur: 2_000_000 }],
      totaux: [{ devise: 'USD', brut: '200', prouve: '0', commandes: 2 }],
    }));
    expect(r.devise).toBe('USD');
    expect(r.depense).toBe(10);
    expect(r.roiPct).toBe(1900);
    expect(r.ia).toBe(0);
    expect(r.autresDevises).toEqual([{ devise: 'EUR', cout: 2.5 }]);
  });

  it('l’IA en euros entre dans le coût, sous l’agent IA, et se lit à part', () => {
    const r = calculerRoi(base({
      iaParJour: [{ jour: '2026-11-02', coutMicroEur: 3_500_000 }],
      leviers: [ligne({ source: 'agent', campaignId: null, nom: null, nature: 'service', categorie: null, n: 20 })],
      prixService: 0.05,
      totaux: [{ devise: 'EUR', brut: '100', prouve: '0', commandes: 1 }],
      sources: [{ source: 'agent', campaignId: null, nom: null, devise: 'EUR', brut: '100', prouve: '0', commandes: 1 }],
    }));
    expect(r.ia).toBe(3.5);
    expect(r.depense).toBe(4.5); // 3,50 d'IA + 20 x 0,05 de service
    expect(r.sources).toEqual([{ source: 'agent', campaignId: null, nom: null, cout: 4.5, brut: '100', roiPct: 2122, partiel: false }]);
  });

  it('un étage e-mail n’a pas de prix : le coût est partiel, jamais compté zéro en silence', () => {
    const r = calculerRoi(base({ leviers: [ligne({ n: 10 }), ligne({ nature: 'email', categorie: null, n: 30 })] }));
    expect(r.depense).toBe(1);
    expect(r.partiel).toBe(true);
    expect(r.sources[0]?.partiel).toBe(true);
  });

  it('un RCS au prix simple de la grille, dit estimé', () => {
    const r = calculerRoi(base({ leviers: [ligne({ nature: 'rcs', categorie: null, n: 10 })] }));
    expect(r.depense).toBe((GRILLE_DEFAUT.rcsSimpleCentimes * 10) / 100);
    expect(r.estime).toBe(true);
  });

  it('une source sans vente a sa ligne à -100 %, une source vendeuse sans coût a la sienne, case de coût vide', () => {
    const r = calculerRoi(base({
      leviers: [ligne({ campaignId: 'k2', nom: 'Rien', n: 30 })],
      totaux: [{ devise: 'EUR', brut: '80', prouve: '80', commandes: 1 }],
      sources: [{ source: 'relance_panier', campaignId: null, nom: null, devise: 'EUR', brut: '80', prouve: '80', commandes: 1 }],
    }));
    expect(r.sources).toEqual([
      { source: 'campagne', campaignId: 'k2', nom: 'Rien', cout: 3, brut: '0', roiPct: -100, partiel: false },
      { source: 'relance_panier', campaignId: null, nom: null, cout: null, brut: '80', roiPct: null, partiel: false },
    ]);
  });

  it('au-delà du plafond, les sources les moins coûteuses sont regroupées et comptées', () => {
    const leviers = Array.from({ length: PLAFOND_SOURCES_ROI + 2 }, (_, i) => ligne({ campaignId: `k${i}`, nom: `C${i}`, n: i + 1 }));
    const r = calculerRoi(base({ leviers }));
    expect(r.sources).toHaveLength(PLAFOND_SOURCES_ROI);
    expect(r.autres).toEqual({ sources: 2, cout: 0.3 }); // les deux plus petites : 1 et 2 messages à 0,10 €
    expect(r.depense).toBe(round(((PLAFOND_SOURCES_ROI + 2) * (PLAFOND_SOURCES_ROI + 3)) / 2 * 0.1));
  });
});

function round(x: number): number { return Math.round(x * 100) / 100; }

describe('prixServiceEffectif', () => {
  it('deux mois traversés : deux franchises, comme le coût des messages', () => {
    const grille = { ...GRILLE_DEFAUT, serviceDepuis: '2026-01-01', serviceCentimes: 2, serviceFranchise: 10 };
    // Octobre : 8 avant la période, 6 dedans -> 4 payants. Novembre : 0 avant, 12 dedans -> 2 payants.
    const p = prixServiceEffectif([
      { mois: '2026-10', avantLaPeriode: 8, dansLaPeriode: 6 },
      { mois: '2026-11', avantLaPeriode: 0, dansLaPeriode: 12 },
    ], { marketing: null, utility: null, currency: 'EUR' }, grille);
    expect(p).toBeCloseTo((6 * 0.02) / 18, 10);
  });
});
