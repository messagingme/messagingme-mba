import { describe, it, expect } from 'vitest';
import { categorieDePrix, prixMetaFrance } from '../src/mcp/prix-meta';
import type { GrilleMeta, TarifGrille } from '../src/credit-whatsapp/grille';

/**
 * LE PRIX D'UN MESSAGE CHEZ META, TEL QUE CLAUDE LE DIT (plan `docs/superpowers/plans/2026-11-06-prix-et-categories-modeles.md`).
 * Ce fichier tient ce qu'un chiffre dit à un client ne doit jamais être : le tarif d'un autre marché sous le nom de la
 * France, celui d'un palier de volume, ou un prix inventé quand la grille manque.
 */
const grille = (tarifs: TarifGrille[]): GrilleMeta => ({ id: 'g1', enVigueurLe: '2026-10-01', tarifs });
const FR = (categorie: TarifGrille['categorie'], prixMicroEur: number, palier = 0): TarifGrille => ({ marche: 'FR', categorie, palier, prixMicroEur });

describe('prixMetaFrance', () => {
  it('les tarifs de base français, en euros à quatre décimales, avec la date de la grille', () => {
    expect(prixMetaFrance(grille([FR('marketing', 71_200), FR('utility', 24_800), FR('authentication', 24_800), FR('service', 24_800)])))
      .toEqual({
        marche: 'France', grille_du: '2026-10-01', devise: 'EUR', hors_taxes: true,
        par_message_livre: { marketing: 0.0712, utility: 0.0248, authentication: 0.0248, service: 0.0248 },
      });
  });

  it('🔴 le tarif de base, jamais celui d’un palier de volume, quel que soit l’ordre de la grille', () => {
    const p = prixMetaFrance(grille([FR('utility', 19_000, 100_001), FR('utility', 24_800), FR('utility', 15_000, 1_000_001)]));
    expect(p?.par_message_livre.utility).toBe(0.0248);
  });

  it('🔴 jamais le tarif d’un autre marché sous le nom de la France : sans tarif français, rien', () => {
    const autres: TarifGrille[] = [
      { marche: 'other', categorie: 'marketing', palier: 0, prixMicroEur: 60_000 },
      { marche: 'DE', categorie: 'marketing', palier: 0, prixMicroEur: 136_000 },
    ];
    expect(prixMetaFrance(grille(autres))).toBeNull();
    // Une catégorie absente pour la France n'est pas complétée par celle d'un autre marché.
    expect(prixMetaFrance(grille([...autres, FR('utility', 24_800)]))?.par_message_livre).toEqual({ utility: 0.0248 });
  });

  it('sans grille chargée : null', () => {
    expect(prixMetaFrance(null)).toBeNull();
    expect(prixMetaFrance(grille([]))).toBeNull();
  });
});

describe('categorieDePrix', () => {
  it('la catégorie de Meta (UTILITY, Marketing...) ramenée à une catégorie de prix ; une inconnue : null', () => {
    expect(categorieDePrix('UTILITY')).toBe('utility');
    expect(categorieDePrix(' Marketing ')).toBe('marketing');
    expect(categorieDePrix('AUTHENTICATION')).toBe('authentication');
    expect(categorieDePrix('marketing_lite')).toBeNull();
    expect(categorieDePrix(undefined)).toBeNull();
  });
});
