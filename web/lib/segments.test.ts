import { describe, it, expect } from 'vitest';
import {
  collectionsLuesDe, etiquettesShopifyLuesDe, lirePlageSaisie, produitsVusDe, saisieDePlage, segmentsShopifyLusDe, suiviSegmentsDe, synchroEtiquettesDe,
} from './segments';

/**
 * Les segments côté console (spec du 2026-10-31). 🔴 Deux gardes : une réponse illisible de la route rend `null` (le
 * panneau ne propose alors aucun critère), et une saisie invalide n'est JAMAIS envoyée (le serveur la refuserait en 400,
 * et la liste disparaîtrait).
 */
describe('suiviSegmentsDe', () => {
  it('lit une boutique, ou son absence', () => {
    expect(suiviSegmentsDe({ boutique: { devise: 'EUR', commandesDepuis: '2026-11-03T10:00:00.000Z', coupeeLe: null }, activiteCompleteDepuis: '2026-11-03' }))
      .toEqual({ boutique: { devise: 'EUR', commandesDepuis: '2026-11-03T10:00:00.000Z', coupeeLe: null }, activiteCompleteDepuis: '2026-11-03' });
    expect(suiviSegmentsDe({ boutique: null, activiteCompleteDepuis: '2026-11-03' })).toEqual({ boutique: null, activiteCompleteDepuis: '2026-11-03' });
  });

  it('lit la date du dernier rattrapage des commandes (lot 5) ; absente ou illisible, il n’y en a pas', () => {
    const boutique = { devise: 'EUR', commandesDepuis: '2026-11-03T10:00:00.000Z', coupeeLe: null };
    expect(suiviSegmentsDe({ boutique: { ...boutique, rattrapeesDepuis: '2026-09-24T00:00:00.000Z' }, activiteCompleteDepuis: '2026-11-03' })?.boutique)
      .toEqual({ ...boutique, rattrapeesDepuis: '2026-09-24T00:00:00.000Z' });
    expect(suiviSegmentsDe({ boutique: { ...boutique, rattrapeesDepuis: 12 }, activiteCompleteDepuis: '2026-11-03' })?.boutique).toEqual(boutique);
  });

  it('🔴 illisible : null, donc aucun critère proposé', () => {
    for (const v of [null, 'x', [], {}, { boutique: null }, { boutique: {}, activiteCompleteDepuis: '2026-11-03' }, { boutique: 3, activiteCompleteDepuis: 'x' }]) {
      expect(suiviSegmentsDe(v), JSON.stringify(v)).toBeNull();
    }
  });

  it('🔴 les critères produit (lot 3) ne s’annoncent que sur un `true` en toutes lettres', () => {
    const base = { boutique: null, activiteCompleteDepuis: '2026-11-03' };
    expect(suiviSegmentsDe({ ...base, produits: true })).toEqual({ ...base, produits: true });
    for (const produits of [undefined, false, 'true', 1]) {
      expect(suiviSegmentsDe({ ...base, produits }), String(produits)).toEqual(base);
    }
  });

  it('🔴 les pastilles des boutons prêts (lot 4) : les deux entiers, sinon aucune (jamais un nombre faux)', () => {
    const base = { boutique: { devise: 'EUR', commandesDepuis: '2026-11-03T10:00:00.000Z', coupeeLe: null }, activiteCompleteDepuis: '2026-11-03' };
    expect(suiviSegmentsDe({ ...base, boutons: { ecritSansCommande: 12, clicSansCommande: 0 } }))
      .toEqual({ ...base, boutons: { ecritSansCommande: 12, clicSansCommande: 0 } });
    for (const boutons of [
      undefined, null, [], { ecritSansCommande: 12 }, { ecritSansCommande: '12', clicSansCommande: 3 },
      { ecritSansCommande: 1.5, clicSansCommande: 3 }, { ecritSansCommande: -1, clicSansCommande: 3 },
    ]) {
      expect(suiviSegmentsDe({ ...base, boutons }), JSON.stringify(boutons)).toEqual(base);
    }
  });
});

describe('produitsVusDe', () => {
  it('lit les produits vus ; une entrée sans titre, ou sans identifiant ni SKU, s’écarte seule', () => {
    expect(produitsVusDe({ produits: [
      { produitId: '8801', sku: 'SER-30', titre: 'Sérum', varianteTitre: '30 ml', commandes: 4 },
      { produitId: null, sku: 'TIP', titre: 'Pourboire', varianteTitre: null, commandes: 1 },
      { produitId: '1', sku: 'X' }, { produitId: null, sku: null, titre: 'Rien' }, 'pas une entrée',
    ] })).toEqual([
      { produitId: '8801', sku: 'SER-30', titre: 'Sérum', varianteTitre: '30 ml', commandes: 4 },
      { produitId: null, sku: 'TIP', titre: 'Pourboire', varianteTitre: null, commandes: 1 },
    ]);
  });

  it('🔴 une réponse illisible rend null (l’écran le dit), jamais « aucun produit »', () => {
    for (const v of [null, {}, { produits: 'x' }, []]) expect(produitsVusDe(v), JSON.stringify(v)).toBeNull();
    expect(produitsVusDe({ produits: [] })).toEqual([]);
  });
});

/** Le critère de collection (lot 6a) : annoncé en toutes lettres, et la liste des collections lues lue défensivement. */
describe('les collections lues (lot 6a)', () => {
  it('🔴 le critère ne s’annonce que sur un `true` en toutes lettres', () => {
    const base = { boutique: null, activiteCompleteDepuis: '2026-11-03' };
    expect(suiviSegmentsDe({ ...base, collections: true })).toEqual({ ...base, collections: true });
    for (const collections of [undefined, false, 'true', 1]) {
      expect(suiviSegmentsDe({ ...base, collections }), String(collections)).toEqual(base);
    }
  });

  it('lit les collections et l’état ; une collection sans identifiant s’écarte seule, un titre vide devient nul', () => {
    expect(collectionsLuesDe({
      collections: [
        { collectionId: '4401', titre: 'Été', produits: 3 }, { collectionId: '4402', titre: '', produits: 'x' }, { titre: 'Sans id' }, 'x',
      ],
      lecture: { lueLe: '2026-11-24T08:00:00.000Z', enCours: false, refus: null, incompletes: true },
    })).toEqual({
      collections: [{ collectionId: '4401', titre: 'Été', produits: 3 }, { collectionId: '4402', titre: null, produits: 0 }],
      lecture: { lueLe: '2026-11-24T08:00:00.000Z', enCours: false, refus: null, incompletes: true },
    });
  });

  it('le refus se lit seulement sous une forme connue ; illisible, la réponse rend null (rien n’est proposé)', () => {
    const lecture = (refus: unknown) => collectionsLuesDe({ collections: [], lecture: { lueLe: null, enCours: false, refus } })?.lecture.refus;
    expect(lecture({ code: 'sans_droit', message: 'm' })).toEqual({ code: 'sans_droit', message: 'm' });
    expect(lecture({ code: 'inconnu', message: 'm' })).toBeNull();
    expect(lecture({ code: 'erreur' })).toBeNull();
    for (const v of [null, {}, { collections: [] }, { collections: 'x', lecture: {} }, []]) expect(collectionsLuesDe(v), JSON.stringify(v)).toBeNull();
  });
});

/** Les étiquettes Shopify (lot 6b) : annoncées en toutes lettres, la liste et l'état de la synchronisation lus défensivement. */
describe('les étiquettes Shopify lues (lot 6b)', () => {
  const SYNCHRO = {
    allumee: true, synchroLe: '2026-11-24T08:00:00.000Z', enCours: false, refus: null,
    comptes: { clientsLus: 12, trouvesParTelephone: 3, sansFiche: 1, fichesEtiquetees: 9 },
  };

  it('🔴 le critère ne s’annonce que sur un `true` en toutes lettres', () => {
    const base = { boutique: null, activiteCompleteDepuis: '2026-11-03' };
    expect(suiviSegmentsDe({ ...base, etiquettesShopify: true })).toEqual({ ...base, etiquettesShopify: true });
    for (const etiquettesShopify of [undefined, false, 'true', 1]) {
      expect(suiviSegmentsDe({ ...base, etiquettesShopify }), String(etiquettesShopify)).toEqual(base);
    }
  });

  it('lit les étiquettes et l’état ; une étiquette vide s’écarte seule, un compte illisible vaut zéro', () => {
    expect(etiquettesShopifyLuesDe({ etiquettes: [{ etiquette: 'VIP', fiches: 4 }, { etiquette: '', fiches: 1 }, { fiches: 2 }, { etiquette: 'Grossiste', fiches: -1 }], synchro: SYNCHRO }))
      .toEqual({ etiquettes: [{ etiquette: 'VIP', fiches: 4 }, { etiquette: 'Grossiste', fiches: 0 }], synchro: SYNCHRO });
    expect(synchroEtiquettesDe({ ...SYNCHRO, comptes: { clientsLus: 'x' } })?.comptes).toEqual({ clientsLus: 0, trouvesParTelephone: 0, sansFiche: 0, fichesEtiquetees: 0 });
  });

  it('un refus se lit avec un code connu, sinon il n’y en a pas', () => {
    const refus = (r: unknown) => synchroEtiquettesDe({ ...SYNCHRO, refus: r })?.refus;
    expect(refus({ code: 'sans_droit', message: 'm' })).toEqual({ code: 'sans_droit', message: 'm' });
    expect(refus({ code: 'inconnu', message: 'm' })).toBeNull();
    expect(refus({ code: 'erreur' })).toBeNull();
  });

  it('🔴 une réponse illisible rend null : rien n’est proposé', () => {
    for (const v of [null, {}, { etiquettes: [] }, { etiquettes: 'x', synchro: SYNCHRO }, { etiquettes: [], synchro: { allumee: 'oui', enCours: false } }, []]) {
      expect(etiquettesShopifyLuesDe(v), JSON.stringify(v)).toBeNull();
    }
  });
});

describe('les segments Shopify lus (lot 6c)', () => {
  const SYNCHRO = {
    allumee: true, synchroLe: '2026-11-24T08:00:00.000Z', enCours: false, refus: null,
    comptes: { clientsLus: 12, trouvesParTelephone: 3, sansFiche: 1, fichesEtiquetees: 9 },
  };
  const VIP = { segmentId: '11', nom: 'VIP', requete: 'number_of_orders >= 3', suivi: true, absent: false, luLe: '2026-11-24T08:00:00.000Z', partiel: false, membres: 9, fiches: 4 };

  it('🔴 le critère ne s’annonce que sur un `true` en toutes lettres', () => {
    const base = { boutique: null, activiteCompleteDepuis: '2026-11-03' };
    expect(suiviSegmentsDe({ ...base, segmentsShopify: true })).toEqual({ ...base, segmentsShopify: true });
    for (const segmentsShopify of [undefined, false, 'true', 1]) {
      expect(suiviSegmentsDe({ ...base, segmentsShopify }), String(segmentsShopify)).toEqual(base);
    }
  });

  it('🔴 lit les segments (identifiants en chiffres) et l’état ; un segment illisible s’écarte seul, un compte illisible vaut zéro', () => {
    expect(segmentsShopifyLusDe({
      segments: [VIP, { ...VIP, segmentId: '98765432109876543', nom: 'Long', fiches: -1, membres: 'x', luLe: 3, requete: 7 },
        { ...VIP, segmentId: 'gid://shopify/Segment/12' }, { ...VIP, segmentId: 'd' }, { ...VIP, nom: '' }, { segmentId: '13' }, null],
      synchro: SYNCHRO,
    })).toEqual({
      segments: [VIP, { ...VIP, segmentId: '98765432109876543', nom: 'Long', fiches: 0, membres: 0, luLe: null, requete: null }],
      synchro: SYNCHRO,
    });
  });

  it('🔴 une réponse illisible rend null : rien n’est proposé', () => {
    for (const v of [null, {}, { segments: [] }, { segments: 'x', synchro: SYNCHRO }, { segments: [], synchro: { allumee: 'oui', enCours: false } }, []]) {
      expect(segmentsShopifyLusDe(v), JSON.stringify(v)).toBeNull();
    }
  });
});

describe('lirePlageSaisie', () => {
  const COMMANDES = { max: 1000, entier: true, avecJours: true, restreint: true };
  const s = (min = '', max = '', jours = '') => ({ min, max, jours });

  it('rien de tapé, ou des jours seuls : pas de critère, sans erreur', () => {
    expect(lirePlageSaisie(s(), COMMANDES)).toEqual({ plage: undefined });
    expect(lirePlageSaisie(s('', '', '90'), COMMANDES)).toEqual({ plage: undefined });
  });

  it('une plage valide, virgule décimale comprise pour la dépense', () => {
    expect(lirePlageSaisie(s('2', '', '90'), COMMANDES)).toEqual({ plage: { min: 2, jours: 90 } });
    expect(lirePlageSaisie(s('', '0'), COMMANDES)).toEqual({ plage: { max: 0 } });
    expect(lirePlageSaisie(s('49,9'), { ...COMMANDES, entier: false, max: 10_000_000 })).toEqual({ plage: { min: 49.9 } });
  });

  it('🔴 une saisie invalide n’envoie rien et dit pourquoi', () => {
    expect(lirePlageSaisie(s('3', '2'), COMMANDES)).toEqual({ erreur: 'ordre' });
    expect(lirePlageSaisie(s('0'), COMMANDES)).toEqual({ erreur: 'zero' });
    expect(lirePlageSaisie(s('1.5'), COMMANDES)).toEqual({ erreur: 'nombre' });
    expect(lirePlageSaisie(s('1001'), COMMANDES)).toEqual({ erreur: 'nombre' });
    expect(lirePlageSaisie(s('1', '', '0'), COMMANDES)).toEqual({ erreur: 'nombre' });
    expect(lirePlageSaisie(s('-1'), COMMANDES)).toEqual({ erreur: 'nombre' });
  });

  it('« au moins 0 jour » de la dernière commande est un vrai critère (au moins une commande)', () => {
    expect(lirePlageSaisie(s('0'), { max: 3650, entier: true, avecJours: false, restreint: false })).toEqual({ plage: { min: 0 } });
  });

  it('une plage posée se relit en saisie', () => {
    expect(saisieDePlage({ min: 2, jours: 90 })).toEqual({ min: '2', max: '', jours: '90' });
    expect(saisieDePlage(undefined)).toEqual({ min: '', max: '', jours: '' });
  });
});
