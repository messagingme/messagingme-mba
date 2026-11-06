import { describe, it, expect } from 'vitest';
import { fmtRoi, lireRoi } from './roi';

/** Quantitatif > Shopify, le ROI (plan 2026-11-06, tâche 6) : la réponse de `/stats/roi` lue défensivement. */
const COMPLET = {
  devise: 'EUR',
  serie: [{ jour: '2026-11-01', chiffreCumule: '0', coutCumule: 10 }, { jour: '2026-11-02', chiffreCumule: '920', coutCumule: 40 }],
  depense: 40, ramene: '920', prouve: '300', roiPct: 2200, ia: 3.5, estime: true, partiel: false,
  autresDevises: [{ devise: 'USD', cout: 2.5 }],
  sources: [{ source: 'campagne', campaignId: 'k1', nom: 'Soldes', cout: 40, brut: '920', roiPct: 2200, partiel: false }],
  autres: { sources: 2, cout: 0.3 },
};

describe('lireRoi', () => {
  it('lit une réponse complète, le chiffre gardé en texte', () => {
    expect(lireRoi(COMPLET)).toEqual(COMPLET);
  });

  it('une réponse illisible rend null (la carte disparaît plutôt qu’un zéro faux)', () => {
    expect(lireRoi(null)).toBeNull();
    expect(lireRoi({ ...COMPLET, depense: 'quarante' })).toBeNull();
    expect(lireRoi({ ...COMPLET, ramene: 920 })).toBeNull();
    expect(lireRoi({ ...COMPLET, serie: undefined })).toBeNull();
  });

  it('un ROI absent (aucun coût) reste null, une ligne mal formée disparaît seule', () => {
    const r = lireRoi({ ...COMPLET, roiPct: null, sources: [...COMPLET.sources, { source: 'inconnue', brut: '1' }], autres: null });
    expect(r?.roiPct).toBeNull();
    expect(r?.sources).toHaveLength(1);
    expect(r?.autres).toBeNull();
  });
});

describe('fmtRoi', () => {
  it('signe le pourcentage', () => {
    expect(fmtRoi(2200, 'fr-FR').replace(/\s/g, ' ')).toBe('+2 200 %');
    expect(fmtRoi(-100, 'fr-FR')).toBe('-100 %');
    expect(fmtRoi(0, 'en-US')).toBe('0 %');
  });
});
