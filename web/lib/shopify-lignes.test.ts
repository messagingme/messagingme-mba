import { describe, it, expect } from 'vitest';
import { delaiEnClair, etatDeLAutomation } from './shopify-lignes';
import { lireEtatShopify, type LigneShopifyVue } from './api-shopify';

const ligne = (o: Partial<LigneShopifyVue> = {}): LigneShopifyVue => ({
  evenement: 'order_paid', actif: true, workflowId: 'wf-1', scenario: 'Commande payée', modele: 'confirmation', langue: 'fr',
  etatChezMeta: 'APPROVED', blocs: 1, versionProgrammee: false, ...o,
});

describe('l’état d’une automation Shopify (menu « Scénario », lot 5)', () => {
  it('🔴 sans ligne : à créer ; éteinte ; allumée sans premier template : à compléter dans son scénario', () => {
    expect(etatDeLAutomation(undefined)).toBe('a_creer');
    expect(etatDeLAutomation(ligne({ actif: false }))).toBe('eteinte');
    expect(etatDeLAutomation(ligne({ actif: false, modele: null, etatChezMeta: null }))).toBe('eteinte');
    expect(etatDeLAutomation(ligne({ modele: null, langue: null, etatChezMeta: null }))).toBe('a_completer');
  });

  it('🔴 son premier template chez Meta : en validation, refusé ou bloqué, actif, nouvelle version en validation', () => {
    expect(etatDeLAutomation(ligne({ etatChezMeta: 'PENDING' }))).toBe('en_validation');
    expect(etatDeLAutomation(ligne({ etatChezMeta: 'REJECTED' }))).toBe('refuse');
    expect(etatDeLAutomation(ligne({ etatChezMeta: 'PAUSED' }))).toBe('refuse');
    expect(etatDeLAutomation(ligne())).toBe('active');
    expect(etatDeLAutomation(ligne({ versionProgrammee: true }))).toBe('active_nouvelle_version');
  });

  it('la liste de Meta illisible : allumée, l’état de son template non lu (jamais « refusé » par défaut)', () => {
    expect(etatDeLAutomation(ligne({ etatChezMeta: null }))).toBe('meta_non_lu');
  });
});

describe('le délai en clair', () => {
  it('« 15 min », « 1 h », « 1 h 30 », « 72 h »', () => {
    expect([15, 60, 90, 180, 1440, 4320].map(delaiEnClair)).toEqual(['15 min', '1 h', '1 h 30', '3 h', '24 h', '72 h']);
  });
});

describe('la lecture de l’état', () => {
  it('🔴 lit les lignes des automations ; une ligne mal formée ou d’un événement inconnu est écartée', () => {
    const v = lireEtatShopify({
      boutique: { domaine: 'b.myshopify.com', nom: 'B', etat: 'connectee', origine: 'console', pauseLe: '2026-11-19T10:00:00.000Z' },
      lignes: [
        { evenement: 'checkout_abandoned', actif: true, workflowId: 'wf-2', scenario: 'Panier abandonné', modele: null, langue: null, etatChezMeta: null, blocs: 1, versionProgrammee: false },
        { evenement: 'inconnu', actif: true, workflowId: 'wf-3' },
        { evenement: 'order_paid', actif: 'oui', workflowId: 'wf-4' },
        null,
      ],
    });
    expect(v?.boutique).toMatchObject({ origine: 'console', pauseLe: '2026-11-19T10:00:00.000Z' });
    expect(v?.lignes).toEqual([ligne({
      evenement: 'checkout_abandoned', workflowId: 'wf-2', scenario: 'Panier abandonné', modele: null, langue: null, etatChezMeta: null,
    })]);
  });

  it('🔴 une API plus ancienne (sans origine, sans pause, sans lignes) ne casse pas l’écran', () => {
    const v = lireEtatShopify({ boutique: { domaine: 'b.myshopify.com', etat: 'connectee' }, messages: [] });
    expect(v?.boutique?.origine).toBe('claude_code');
    expect(v?.boutique?.pauseLe).toBeNull();
    expect(v?.lignes).toEqual([]);
    // Les récupérés (plan 2026-10-30) absents : zéro et aucune ligne, jamais une exception.
    expect(v?.paniers).toEqual({ relances: {}, fermesATemps: 0, enAttente: 0, relancesParties: 0, recuperes: 0, montantsRecuperes: [], recuperesTest: 0 });
  });

  it('lit les relances parties et les récupérés des 7 jours, une ligne de montant mal formée écartée (plan 2026-10-30)', () => {
    const v = lireEtatShopify({
      boutique: { domaine: 'b.myshopify.com', etat: 'connectee' },
      paniers: {
        relances: { envoye: 3 }, fermesATemps: 1, enAttente: 2, relancesParties: 4, recuperes: 2, recuperesTest: 1,
        montantsRecuperes: [{ devise: 'EUR', montant: '59.9' }, { devise: 'EUR', montant: '12,5' }, { montant: '3' }],
      },
    });
    expect(v?.paniers).toEqual({
      relances: { envoye: 3 }, fermesATemps: 1, enAttente: 2,
      relancesParties: 4, recuperes: 2, montantsRecuperes: [{ devise: 'EUR', montant: '59.9' }], recuperesTest: 1,
    });
  });
});
