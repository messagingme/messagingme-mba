import { describe, it, expect } from 'vitest';
import { delaiEnClair, donneesDuScenario, etatDeLAutomation } from './shopify-lignes';
import { DONNEES_SHOPIFY } from './partage/shopify-messages';
import { lireEtatShopify, type LigneShopifyVue } from './api-shopify';

const ligne = (o: Partial<LigneShopifyVue> = {}): LigneShopifyVue => ({
  evenement: 'order_paid', actif: true, workflowId: 'wf-1', scenario: 'Commande payée', modele: 'confirmation', langue: 'fr',
  etatChezMeta: 'APPROVED', blocs: 1, versionProgrammee: false, apercu: null, ...o,
});

describe('l’état d’une automation Shopify (menu « Scénario », lot 5)', () => {
  it('🔴 sans ligne : à créer ; éteinte ; allumée sans premier template : à compléter dans son scénario', () => {
    expect(etatDeLAutomation(undefined)).toBe('a_creer');
    expect(etatDeLAutomation(ligne({ actif: false, etatChezMeta: 'REJECTED' }))).toBe('eteinte');
    expect(etatDeLAutomation(ligne({ actif: false, etatChezMeta: null }))).toBe('eteinte');
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

  it('🔴 le message standard (spec 2026-11-20) : éteinte, prête dès que le publié est approuvé, sinon en validation', () => {
    expect(etatDeLAutomation(ligne({ actif: false }))).toBe('prete');
    // Une nouvelle version attend Meta, mais la publiée est approuvée : allumer envoie déjà.
    expect(etatDeLAutomation(ligne({ actif: false, versionProgrammee: true }))).toBe('prete');
    // Le message standard posé dans une version programmée : rien de publié encore.
    expect(etatDeLAutomation(ligne({ actif: false, modele: null, etatChezMeta: null, versionProgrammee: true }))).toBe('eteinte_en_validation');
    expect(etatDeLAutomation(ligne({ actif: false, etatChezMeta: 'PENDING' }))).toBe('eteinte_en_validation');
    expect(etatDeLAutomation(ligne({ actif: false, etatChezMeta: 'IN_APPEAL' }))).toBe('eteinte_en_validation');
  });

  it('🔴 allumée pendant la validation du message standard : en validation, plus « à compléter »', () => {
    expect(etatDeLAutomation(ligne({ modele: null, langue: null, etatChezMeta: null, versionProgrammee: true }))).toBe('en_validation');
    expect(etatDeLAutomation(ligne({ modele: null, langue: null, etatChezMeta: null, versionProgrammee: false }))).toBe('a_completer');
  });

  it('la liste de Meta illisible : allumée, l’état de son template non lu (jamais « refusé » par défaut)', () => {
    expect(etatDeLAutomation(ligne({ etatChezMeta: null }))).toBe('meta_non_lu');
  });
});

describe('les données qu’un scénario Shopify peut lire (le builder)', () => {
  it('🔴 celles de l’événement de sa ligne, dans l’ordre, avec leur libellé', () => {
    const d = donneesDuScenario([ligne({ evenement: 'checkout_abandoned', workflowId: 'wf-panier' }), ligne()], 'wf-panier');
    expect(d).toEqual([
      { cle: 'first_name', libelle: ['prénom', 'first name'] },
      { cle: 'checkout_url', libelle: ['lien du panier', 'checkout link'] },
    ]);
  });

  it('une copie qu’aucune ligne n’envoie (atteinte par un « Aller à ») : toutes les données Shopify', () => {
    expect(donneesDuScenario([ligne()], 'wf-copie').map((x) => x.cle)).toEqual([...DONNEES_SHOPIFY]);
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

  it('🔴 lit l’aperçu d’une ligne ; absent ou mal formé, aucun aperçu (la console est publiée avant l’API)', () => {
    const avec = (apercu: unknown) => lireEtatShopify({
      boutique: { domaine: 'b.myshopify.com', etat: 'connectee' },
      lignes: [{ evenement: 'order_paid', actif: false, workflowId: 'wf-1', modele: null, versionProgrammee: true, ...(apercu === undefined ? {} : { apercu }) }],
    })?.lignes[0]?.apercu;
    expect(avec({ corps: 'Bonjour {{1}}', pied: 'STOP', exemples: ['Camille'], enValidation: true }))
      .toEqual({ corps: 'Bonjour {{1}}', pied: 'STOP', exemples: ['Camille'], enValidation: true });
    expect(avec({ corps: 'Bonjour {{1}}' })).toEqual({ corps: 'Bonjour {{1}}', pied: null, exemples: [], enValidation: false });
    expect(avec({ corps: 'Bonjour {{1}}', exemples: ['Camille', 3] })?.exemples).toEqual([]);
    expect(avec({ corps: 'Bonjour {{1}}', exemples: 'Camille' })?.exemples).toEqual([]);
    expect(avec(undefined)).toBeNull();
    expect(avec(null)).toBeNull();
    expect(avec({ corps: 3 })).toBeNull();
    expect(avec({ corps: '  ' })).toBeNull();
    expect(avec('Bonjour')).toBeNull();
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

describe('la lecture de l’attestation (2026-11-20)', () => {
  const avec = (attestation: unknown) => lireEtatShopify({
    boutique: { domaine: 'b.myshopify.com', etat: 'connectee' }, ...(attestation === undefined ? {} : { attestation }),
  })?.attestation;
  const COCHEE = { coche: true, le: '2026-11-20T09:00:00.000Z', email: 'moi@exemple.fr', texte: 'J’atteste...' };

  it('🔴 absente (une API plus ancienne que la console) : inconnue, jamais « pas attestée »', () => {
    expect(avec(undefined)).toBe('inconnue');
  });

  it('🔴 null : jamais attestée', () => {
    expect(avec(null)).toBeNull();
  });

  it('lit une attestation cochée, puis retirée, l’e-mail absent compris', () => {
    expect(avec(COCHEE)).toEqual(COCHEE);
    expect(avec({ ...COCHEE, coche: false, email: null })).toEqual({ ...COCHEE, coche: false, email: null });
  });

  it('🔴 mal formée : inconnue, la case ne s’affiche pas', () => {
    expect(avec(true)).toBe('inconnue');
    expect(avec('oui')).toBe('inconnue');
    expect(avec({ ...COCHEE, coche: 'oui' })).toBe('inconnue');
    expect(avec({ ...COCHEE, le: 3 })).toBe('inconnue');
    expect(avec({ ...COCHEE, texte: undefined })).toBe('inconnue');
    expect(avec({ ...COCHEE, email: 3 })).toBe('inconnue');
  });

  it('un e-mail absent se lit comme inconnu du serveur, l’attestation reste lue', () => {
    const { email: _sansEmail, ...sansEmail } = COCHEE;
    expect(avec(sansEmail)).toEqual({ ...COCHEE, email: null });
  });
});
