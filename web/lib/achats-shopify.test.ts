import { describe, it, expect } from 'vitest';
import { lireAchatsShopify } from './achats-shopify';

/**
 * L'onglet « Shopify » de la fiche (plan 2026-11-16) : la réponse lue défensivement. 🔴 Une réponse illisible rend
 * `null` (l'écran dit « indisponible »), jamais une fiche vide qui dirait « aucune commande ».
 */
const COMPLET = {
  boutique: { nom: 'Demo', domaine: 'demo.myshopify.com', devise: 'EUR', commandesDepuis: '2026-11-01T00:00:00.000Z', coupeeLe: null },
  resume: { commandes: 2, commandesTest: 1, depense: '69.9', derniereLe: '2026-11-03T10:00:00.000Z' },
  rapporte: [{ devise: 'EUR', montant: '49.9', prouve: '49.9', commandes: 1 }],
  commandes: [
    { commandeId: '1002', payeeLe: '2026-11-03T10:00:00.000Z', montant: '20', devise: 'EUR', test: true, attribution: null },
    { commandeId: '1001', payeeLe: '2026-11-02T10:00:00.000Z', montant: '49.9', devise: 'EUR', test: false,
      attribution: { source: 'campagne', campagne: 'Soldes', preuve: 'utm' } },
  ],
  paniers: [{ ouvertLe: '2026-11-10T10:00:00.000Z', relanceLe: null, fermeLe: null, issue: null }],
};

describe('lireAchatsShopify', () => {
  it('lit une réponse complète, montants gardés en texte', () => {
    expect(lireAchatsShopify(COMPLET)).toEqual(COMPLET);
  });

  it('les lignes d’une commande (lot 3) se lisent ; une ligne illisible s’écarte seule ; absentes, elles restent absentes', () => {
    const ligne = { titre: 'Sérum', varianteTitre: '30 ml', sku: 'SER-30', quantite: 2, carteCadeau: false };
    const avec = { ...COMPLET, commandes: [{ ...COMPLET.commandes[0], lignes: [ligne, { titre: '', quantite: 1 }, { titre: 'Cadeau', quantite: 0 }], lignesTronquees: true }] };
    expect(lireAchatsShopify(avec)?.commandes[0]).toEqual({ ...COMPLET.commandes[0], lignes: [ligne], lignesTronquees: true });
    // Une API d'avant le lot 3 : aucune clé `lignes`, l'écran n'en dit rien (jamais « aucun produit »).
    expect(lireAchatsShopify(COMPLET)?.commandes[0]).not.toHaveProperty('lignes');
  });

  it('un espace sans boutique se lit tel quel', () => {
    expect(lireAchatsShopify({ ...COMPLET, boutique: null, commandes: [], paniers: [] })?.boutique).toBeNull();
  });

  it('🔴 une réponse illisible rend null, jamais « aucune commande »', () => {
    expect(lireAchatsShopify({ error: 'Not Found' })).toBeNull();
    expect(lireAchatsShopify(null)).toBeNull();
    expect(lireAchatsShopify({ ...COMPLET, boutique: { nom: 'x' } })).toBeNull();
  });

  it('une ligne mal formée disparaît seule ; une source inconnue perd son attribution, pas sa commande', () => {
    const a = lireAchatsShopify({
      ...COMPLET,
      commandes: [{ commandeId: 1 }, { ...COMPLET.commandes[1], montant: 49.9, attribution: { source: 'inconnue' } }],
    });
    expect(a?.commandes).toEqual([{ ...COMPLET.commandes[1], montant: null, attribution: null }]);
  });
});
