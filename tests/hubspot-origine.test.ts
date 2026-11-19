import { describe, it, expect } from 'vitest';
import { origineHubspot, prefixeHubspot, type EvenementHubspot } from '../src/hubspot/origine';
import { ORIGINE_MAX, evenementValide } from '../src/workflow/evenement';
import { parcoursShopifyEncoreVoulu } from '../src/shopify/parcours-voulu';

/**
 * L'ORIGINE D'UN PARCOURS HUBSPOT (menu « Scénario », lot 6, décision 37) : une naissance par origine, tous statuts (0300).
 * L'origine porte donc la fenêtre : un même deal à la même étape le même jour ne renaît pas ; revenu le lendemain, ou un
 * rendez-vous déplacé, il repart. Elle tient en `ORIGINE_MAX` caractères, sinon aucun pont n'est posé (le premier message
 * part seul, comme pour Shopify).
 */

const LIGNE = '6f1d2c3b-4a5e-4f60-8a9b-0c1d2e3f4a5b';
const AUTRE_LIGNE = '7a2e3d4c-5b6f-4071-9bac-1d2e3f4a5b6c';
const etape = (o: Partial<Extract<EvenementHubspot, { famille: 'etape' }>> = {}): EvenementHubspot => ({
  famille: 'etape', portail: '4242', ligne: LIGNE, deal: '9001', etape: 'closedwon', le: new Date('2026-11-19T09:30:00Z'), ...o,
});
const rdv = (o: Partial<Extract<EvenementHubspot, { famille: 'rdv' }>> = {}): EvenementHubspot => ({
  famille: 'rdv', portail: '4242', ligne: LIGNE, contact: '33611223344', champ: 'hs_date_rdv', date: '2026-11-20T14:30:00+01:00', ...o,
});

describe('origineHubspot : le changement d’étape d’un deal', () => {
  it('🔴 le portail, la ligne, le deal, l’étape et le jour UTC du changement', () => {
    expect(origineHubspot(etape())).toBe(`hubspot:4242:etape:${LIGNE}:9001:closedwon:2026-11-19`);
  });

  it('🔴 la fenêtre de 24 h (décision 37) : le même jour UTC, la même origine ; le lendemain, une autre', () => {
    const matin = origineHubspot(etape({ le: new Date('2026-11-19T00:00:01Z') }));
    expect(origineHubspot(etape({ le: new Date('2026-11-19T23:59:59Z') }))).toBe(matin);
    expect(origineHubspot(etape({ le: new Date('2026-11-20T00:00:00Z') }))).not.toBe(matin);
  });

  it('un autre deal, une autre étape ou une autre ligne : une autre origine', () => {
    const a = origineHubspot(etape());
    for (const autre of [etape({ deal: '9002' }), etape({ etape: 'contractsent' }), etape({ ligne: AUTRE_LIGNE })]) {
      expect(origineHubspot(autre)).not.toBe(a);
    }
  });
});

describe('origineHubspot : le rendez-vous', () => {
  it('🔴 le portail, la ligne, le contact, le champ date et sa valeur, deux-points de l’heure compris', () => {
    expect(origineHubspot(rdv())).toBe(`hubspot:4242:rdv:${LIGNE}:33611223344:hs_date_rdv:2026-11-20T14:30:00+01:00`);
  });

  it('🔴 un rendez-vous déplacé repart (une autre date, une autre origine) ; le même, jamais', () => {
    expect(origineHubspot(rdv())).toBe(origineHubspot(rdv()));
    expect(origineHubspot(rdv({ date: '2026-11-21T10:00:00+01:00' }))).not.toBe(origineHubspot(rdv()));
  });

  it('🔴 deux lignes sur le même champ (un rappel la veille, un autre deux heures avant) : deux origines', () => {
    // Avec une seule origine, la seconde ligne serait « déjà née » (0300) : sa suite ne partirait jamais.
    expect(origineHubspot(rdv({ ligne: AUTRE_LIGNE }))).not.toBe(origineHubspot(rdv()));
  });
});

describe('origineHubspot : ses bornes', () => {
  it('🔴 jusqu’à ORIGINE_MAX caractères, et le schéma de l’événement la relit ; au-delà, aucune origine', () => {
    const sansDate = `hubspot:4242:rdv:${LIGNE}:33611223344:hs_date_rdv:`;
    const juste = rdv({ date: 'x'.repeat(ORIGINE_MAX - sansDate.length) });
    const origine = origineHubspot(juste);
    expect(origine).toHaveLength(ORIGINE_MAX);
    expect(evenementValide({ origine: origine!, variables: {} })).toBe(true);
    expect(origineHubspot(rdv({ date: 'x'.repeat(ORIGINE_MAX - sansDate.length + 1) }))).toBeNull();
  });

  it('🔴 une partie vide, ou des deux-points ailleurs que dans la date du rendez-vous : aucune origine', () => {
    for (const e of [
      etape({ portail: '' }), etape({ ligne: '' }), etape({ deal: '' }), etape({ etape: '' }), rdv({ contact: '' }), rdv({ champ: '' }), rdv({ date: '' }),
      etape({ portail: '42:etape' }), etape({ deal: '9:1' }), etape({ etape: 'a:b' }), rdv({ ligne: 'l:1' }), rdv({ contact: 'c:1' }), rdv({ champ: 'hs:x' }),
    ]) {
      expect(origineHubspot(e), JSON.stringify(e)).toBeNull();
    }
  });

  it('un instant illisible : aucune origine, jamais une exception', () => {
    expect(origineHubspot(etape({ le: new Date('pas une date') }))).toBeNull();
  });
});

describe('prefixeHubspot : de quoi arrêter les parcours d’un portail, d’une famille ou d’une ligne', () => {
  it('🔴 chaque origine commence par ses trois préfixes, qui finissent tous par deux-points', () => {
    for (const e of [etape(), rdv()]) {
      const origine = origineHubspot(e)!;
      for (const prefixe of [prefixeHubspot(e.portail), prefixeHubspot(e.portail, e.famille), prefixeHubspot(e.portail, e.famille, e.ligne)]) {
        expect(prefixe.endsWith(':')).toBe(true);
        expect(origine.startsWith(prefixe), prefixe).toBe(true);
      }
    }
  });

  it('🔴 le préfixe d’une ligne ne recouvre jamais une autre ligne, ni un autre portail, dont l’identifiant commence pareil', () => {
    expect(origineHubspot(etape({ ligne: 'l10' }))!.startsWith(prefixeHubspot('4242', 'etape', 'l1'))).toBe(false);
    expect(origineHubspot(etape({ portail: '42420' }))!.startsWith(prefixeHubspot('4242'))).toBe(false);
  });
});

describe('une origine HubSpot devant la règle « encore voulu » (lot 6, tâche 2)', () => {
  it('🔴 elle reste voulue sans rien lire du magasin Shopify : sa règle viendra avec les lignes HubSpot (6b)', async () => {
    const lus: string[] = [];
    const magasin = {
      async etatPourParcours() { lus.push('etat'); return { boutique: 'absente' as const, ligneActive: false }; },
      async panierOuvert() { lus.push('panier'); return false; },
    };
    for (const e of [etape(), rdv()]) expect(await parcoursShopifyEncoreVoulu(magasin, 't1', origineHubspot(e)!)).toBe(true);
    expect(lus).toEqual([]);
  });
});
