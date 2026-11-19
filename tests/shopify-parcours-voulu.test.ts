import { describe, it, expect } from 'vitest';
import { parcoursShopifyEncoreVoulu, type LecturesParcoursShopify } from '../src/shopify/parcours-voulu';
import type { EvenementShopify } from '../web/lib/partage/shopify-messages';

/**
 * LA RÈGLE « LE PARCOURS EST-IL ENCORE VOULU ? » D'UN PARCOURS SHOPIFY (menu « Scénario », lot 5, décisions 4 et 15), lue à
 * chaque reprise et à chaque réponse. Le faux magasin est une CLASSE dont les méthodes lisent `this` : un câblage qui les
 * détacherait (`{ panierOuvert: store.panierOuvert }`) perdrait son `this` sans erreur de compilation (règle du dépôt).
 */
class FauxMagasin implements LecturesParcoursShopify {
  readonly lus: string[] = [];
  constructor(
    private readonly boutique: 'absente' | 'coupee' | 'pause' | 'active',
    private readonly lignesActives: readonly EvenementShopify[],
    private readonly paniersOuverts: readonly string[],
  ) {}
  async etatPourParcours(tenantId: string, domaine: string, evenement: EvenementShopify) {
    this.lus.push(`etat:${tenantId}:${domaine}:${evenement}`);
    return { boutique: this.boutique, ligneActive: this.lignesActives.includes(evenement) };
  }
  async panierOuvert(tenantId: string, jeton: string): Promise<boolean> {
    this.lus.push(`panier:${tenantId}:${jeton}`);
    return this.paniersOuverts.includes(jeton);
  }
}

const PANIER = 'shopify:b.myshopify.com:checkouts/abandoned:jeton-1';
const COMMANDE = 'shopify:b.myshopify.com:orders/paid:42';
const tout = ['order_paid', 'order_fulfilled', 'checkout_abandoned'] as const;

describe('parcoursShopifyEncoreVoulu', () => {
  it('🔴 un panier encore ouvert, sa ligne allumée, la boutique active : voulu ; la commande passée : plus voulu (décision 4)', async () => {
    const ouvert = new FauxMagasin('active', tout, ['jeton-1']);
    expect(await parcoursShopifyEncoreVoulu(ouvert, 't1', PANIER)).toBe(true);
    expect(ouvert.lus).toEqual(['etat:t1:b.myshopify.com:checkout_abandoned', 'panier:t1:jeton-1']);
    expect(await parcoursShopifyEncoreVoulu(new FauxMagasin('active', tout, []), 't1', PANIER)).toBe(false);
  });

  it('🔴 la boutique en pause, coupée ou absente : plus voulu (décision 15)', async () => {
    for (const etat of ['pause', 'coupee', 'absente'] as const) {
      expect(await parcoursShopifyEncoreVoulu(new FauxMagasin(etat, tout, ['jeton-1']), 't1', PANIER), etat).toBe(false);
    }
  });

  it('🔴 la ligne de l’événement éteinte : plus voulu ; une autre ligne éteinte ne compte pas', async () => {
    expect(await parcoursShopifyEncoreVoulu(new FauxMagasin('active', ['order_paid', 'order_fulfilled'], ['jeton-1']), 't1', PANIER)).toBe(false);
    expect(await parcoursShopifyEncoreVoulu(new FauxMagasin('active', ['order_paid'], []), 't1', COMMANDE)).toBe(true);
  });

  it('une commande ne relit aucun panier', async () => {
    const m = new FauxMagasin('active', tout, []);
    expect(await parcoursShopifyEncoreVoulu(m, 't1', COMMANDE)).toBe(true);
    expect(m.lus).toEqual(['etat:t1:b.myshopify.com:order_paid']);
  });

  it('une origine d’une autre source, ou d’un sujet que ce lot ne connaît pas : voulu, sans rien lire', async () => {
    const m = new FauxMagasin('absente', [], []);
    expect(await parcoursShopifyEncoreVoulu(m, 't1', 'hubspot:portail:deal:7')).toBe(true);
    expect(await parcoursShopifyEncoreVoulu(m, 't1', 'shopify:b.myshopify.com:products/update:9')).toBe(true);
    expect(await parcoursShopifyEncoreVoulu(m, 't1', 'shopify:incomplet')).toBe(true);
    expect(m.lus).toEqual([]);
  });
});
