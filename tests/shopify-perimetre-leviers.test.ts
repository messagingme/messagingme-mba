import { describe, it, expect } from 'vitest';
import { TOUCHES } from '../src/shopify/ventes.pg';
import { LEVIERS_ENVOIS } from '../src/shopify/cout-leviers.pg';
import {
  VALEURS_CAMPAGNE_LEVIER, campagneLevier, origineLevier, sourceDeCampagne, sourceDeLOrigine,
} from '../src/shopify/perimetre-leviers';
import { LIGNE_RELANCE_PANIER, PREFIXE_LIGNE_SHOPIFY } from '../src/shopify/attribution';
import { PREFIXE_ENVOI_API } from '../src/api/cible-rcs';
import { PREFIXE_LIGNE_HUBSPOT } from '../src/hubspot-workflow/envoi';

/**
 * 🔴 LE COÛT ET LE CHIFFRE PARLENT DES MÊMES MESSAGES (spec 2026-11-06, « La règle qui tient tout »). L'attribution et le
 * coût du ROI interpolent les mêmes fragments de `perimetre-leviers.ts` : si l'un recopie sa condition au lieu de
 * l'importer, ce test casse avant que le ROI d'une source ne mente.
 */
const condTouches = campagneLevier('k', { relance: '$6', shopify: '$7', api: '$8', hubspot: '$10' });

describe('le périmètre des leviers, une seule définition', () => {
  it('l’attribution (TOUCHES) interpole la condition des campagnes et celle des origines', () => {
    expect(TOUCHES).toContain(condTouches);
    expect(TOUCHES).toContain(sourceDeCampagne('k', '$6'));
    expect(TOUCHES).toContain(origineLevier('m'));
    expect(TOUCHES).toContain(sourceDeLOrigine('m'));
  });

  it('le coût des leviers interpole les mêmes fragments', () => {
    expect(LEVIERS_ENVOIS).toMatch(/starts_with\(k\.name, \$\d+\) or starts_with\(k\.name, \$\d+\)/);
    expect(LEVIERS_ENVOIS).toContain(origineLevier('m'));
    expect(LEVIERS_ENVOIS).toContain(sourceDeLOrigine('m'));
  });

  it('les valeurs liées sont celles des lignes techniques, la relance incluse et les trois préfixes exclus', () => {
    expect(VALEURS_CAMPAGNE_LEVIER).toEqual({
      relance: LIGNE_RELANCE_PANIER,
      shopify: PREFIXE_LIGNE_SHOPIFY,
      api: PREFIXE_ENVOI_API,
      hubspot: PREFIXE_LIGNE_HUBSPOT,
    });
    expect(condTouches).toBe(
      '(k.name = $6 or not (starts_with(k.name, $7) or starts_with(k.name, $8) or starts_with(k.name, $10)))',
    );
  });

  it('les origines leviers sont le scénario, l’agent IA et l’agent de Meta, et aucune autre', () => {
    expect(origineLevier('m')).toBe("m.origin in ('scenario', 'ia', 'mba')");
    expect(sourceDeLOrigine('m')).toBe("case m.origin when 'scenario' then 'scenario' when 'ia' then 'agent' else 'agent_meta' end");
  });
});
