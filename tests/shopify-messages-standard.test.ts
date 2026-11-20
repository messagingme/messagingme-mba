import { describe, it, expect } from 'vitest';
import { corpsStandard, versCorps } from '../src/shopify/messages-standard';
import { parseTemplateFields } from '../src/templates/corps';
import { refusChampsUrl } from '../src/links/champs-url';

import { EVENEMENTS_SHOPIFY, EXEMPLES_DONNEES, PIED_STOP } from '../web/lib/partage/shopify-messages';

const DOMAINE = 'b.myshopify.com';

describe('versCorps', () => {
  it('chaque repère devient {{n}} dans l’ordre d’apparition, avec ses exemples', () => {
    const r = versCorps('order_paid', 'Bonjour {{first_name}}, commande {{order_number}}, à bientôt');
    expect(r).toEqual({ ok: true, corps: 'Bonjour {{1}}, commande {{2}}, à bientôt', variables: ['first_name', 'order_number'], exemples: [EXEMPLES_DONNEES.first_name, EXEMPLES_DONNEES.order_number] });
  });

  it('une donnée que l’événement ne sait pas remplir est refusée', () => {
    expect(versCorps('checkout_abandoned', 'Bonjour {{order_number}}, à bientôt')).toMatchObject({ ok: false });
  });

  it('🔴 un corps qui commence ou finit par une donnée est refusé (Meta le rejette)', () => {
    expect(versCorps('order_paid', '{{first_name}}, merci')).toMatchObject({ ok: false });
    expect(versCorps('order_paid', 'Merci {{first_name}}')).toMatchObject({ ok: false });
  });
});

describe('corpsStandard', () => {
  it.each(EVENEMENTS_SHOPIFY)('%s : un corps que l’écran Templates accepterait, en français', (evenement) => {
    const { corps, variables } = corpsStandard(evenement, DOMAINE);
    const lu = parseTemplateFields(corps);
    expect('fields' in lu).toBe(true);
    expect(corps.language).toBe('fr');
    expect(variables.length).toBeGreaterThan(0);
    expect(corps.example).toEqual(variables.map((v) => EXEMPLES_DONNEES[v]));
  });

  it('commandes en UTILITY sans pied ; panier en MARKETING avec la consigne STOP', () => {
    expect(corpsStandard('order_paid', DOMAINE).corps).toMatchObject({ category: 'UTILITY' });
    expect(corpsStandard('order_paid', DOMAINE).corps.footer).toBeUndefined();
    expect(corpsStandard('order_fulfilled', DOMAINE).corps).toMatchObject({ category: 'UTILITY' });
    expect(corpsStandard('order_fulfilled', DOMAINE).corps.footer).toBeUndefined();
    expect(corpsStandard('checkout_abandoned', DOMAINE).corps).toMatchObject({ category: 'MARKETING', footer: PIED_STOP.fr });
  });

  it('les données de la décision du 2026-11-20 : prénom dans le panier, pas de transporteur à l’expédition', () => {
    expect(corpsStandard('checkout_abandoned', DOMAINE).variables).toEqual(['first_name']);
    expect(corpsStandard('order_fulfilled', DOMAINE).variables).toEqual(['first_name', 'order_number', 'tracking_url']);
    expect(corpsStandard('order_paid', DOMAINE).variables).toEqual(['first_name', 'order_number', 'order_total', 'order_status_url']);
  });

  it('🔴 le panier : plus aucun lien dans le texte, un bouton « Reprendre mon panier » vers la boutique et la clé du panier (2026-11-20)', () => {
    const { corps } = corpsStandard('checkout_abandoned', DOMAINE);
    expect(corps.body).not.toMatch(/https?:|checkout/);
    expect(corps.buttons).toEqual([{ type: 'URL', text: 'Reprendre mon panier', url: `https://${DOMAINE}/{panier_shopify}` }]);
    expect(refusChampsUrl(corps.buttons![0]!.url!, [], 'bouton 1')).toBeNull();
    expect(corpsStandard('order_paid', DOMAINE).corps.buttons).toBeUndefined();
  });
});
