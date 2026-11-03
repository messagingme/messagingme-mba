import { describe, it, expect } from 'vitest';
import {
  champsDeFiche, cleChampHubspot, declarerChampsHubspot, schemaChampsGroupes, schemaListeChoisie, typeChampHubspot,
} from '../src/hubspot-workflow/champs';
import type { UserFieldDef } from '../src/crm/types';

/**
 * LES CHAMPS HUBSPOT CHOISIS (lot 2 du plan du 2026-11-02, le contrat avec le connecteur). 🔴 La clé de fiche vient du NOM
 * interne de la propriété, jamais de son libellé : un libellé renommé dans HubSpot ferait pointer les sources du modèle sur
 * un champ que personne n'écrit. Et mba n'écrit qu'une clé DÉCLARÉE dans l'espace.
 */
describe('la règle de clé et la déclaration', () => {
  const store = () => {
    const defs: UserFieldDef[] = [];
    return { defs, list: async () => [...defs], upsert: async (_t: string, d: UserFieldDef) => { defs.push(d); } };
  };

  it('🔴 hs_contact_, hs_deal_ et hs_calc_ : un calculé ne rencontre jamais une propriété de transaction du même nom', () => {
    expect(cleChampHubspot('contact', 'firstname')).toBe('hs_contact_firstname');
    expect(cleChampHubspot('deal', 'conseiller')).toBe('hs_deal_conseiller');
    expect(cleChampHubspot('calcule', 'conseiller')).toBe('hs_calc_conseiller');
    expect(cleChampHubspot('calcule', 'lien_agenda')).toBe('hs_calc_lien_agenda');
    expect(cleChampHubspot('calcule', 'lien_devis')).toBe('hs_calc_lien_devis');
    expect(cleChampHubspot('calcule', 'pdf_devis')).toBe('hs_calc_pdf_devis');
    // La plus longue clé possible tient dans les 64 caractères d'une clé de l'API publique.
    expect(cleChampHubspot('contact', 'a'.repeat(53))).toHaveLength(64);
  });

  it('🔴 déclarés une fois, libellé HubSpot suivi de « (HubSpot) », du texte sauf les liens calculés (réservation, devis, PDF)', async () => {
    const s = store();
    const champs = [
      { objet: 'contact' as const, propriete: 'firstname', libelle: 'Prénom' },
      { objet: 'deal' as const, propriete: 'montant_devis', libelle: 'Montant du devis' },
      { objet: 'calcule' as const, propriete: 'conseiller', libelle: 'Conseiller (propriétaire de la transaction)' },
      { objet: 'calcule' as const, propriete: 'lien_agenda', libelle: 'Lien de réservation du conseiller' },
      { objet: 'calcule' as const, propriete: 'lien_devis', libelle: 'Lien du devis' },
      { objet: 'calcule' as const, propriete: 'pdf_devis', libelle: 'PDF du devis' },
    ];
    await declarerChampsHubspot(s, 't1', champs);
    await declarerChampsHubspot(s, 't1', champs);
    expect(s.defs).toEqual([
      { key: 'hs_contact_firstname', label: 'Prénom (HubSpot)', type: 'text' },
      { key: 'hs_deal_montant_devis', label: 'Montant du devis (HubSpot)', type: 'text' },
      { key: 'hs_calc_conseiller', label: 'Conseiller (propriétaire de la transaction) (HubSpot)', type: 'text' },
      { key: 'hs_calc_lien_agenda', label: 'Lien de réservation du conseiller (HubSpot)', type: 'url' },
      { key: 'hs_calc_lien_devis', label: 'Lien du devis (HubSpot)', type: 'url' },
      { key: 'hs_calc_pdf_devis', label: 'PDF du devis (HubSpot)', type: 'url' },
    ]);
    expect(typeChampHubspot('deal', 'lien_agenda')).toBe('text');
    // Une propriété de transaction nommée comme un calculé reste du texte.
    expect(typeChampHubspot('deal', 'lien_devis')).toBe('text');
  });

  it('une clé que le client a déjà est reprise telle quelle', async () => {
    const s = store();
    s.defs.push({ key: 'hs_contact_firstname', label: 'Mon prénom', type: 'text' });
    await declarerChampsHubspot(s, 't1', [{ objet: 'contact', propriete: 'firstname', libelle: 'Prénom' }]);
    expect(s.defs).toEqual([{ key: 'hs_contact_firstname', label: 'Mon prénom', type: 'text' }]);
  });
});

describe('la liste choisie', () => {
  const champ = (i: number) => ({ objet: 'contact', propriete: `p${i}` });

  it('🔴 au plus 20, calculés compris : 21 champs refusés', () => {
    const vingt = [
      ...Array.from({ length: 16 }, (_, i) => champ(i)),
      ...['conseiller', 'lien_agenda', 'lien_devis', 'pdf_devis'].map((propriete) => ({ objet: 'calcule', propriete })),
    ];
    expect(schemaListeChoisie.safeParse(vingt).success).toBe(true);
    expect(schemaListeChoisie.safeParse([...vingt, champ(99)]).success).toBe(false);
  });

  it('🔴 un nom trop long (54 caractères) ou hors de l’alphabet refusé ; un doublon refusé ; un calculé inconnu refusé', () => {
    expect(schemaListeChoisie.safeParse([{ objet: 'deal', propriete: 'a'.repeat(53) }]).success).toBe(true);
    expect(schemaListeChoisie.safeParse([{ objet: 'deal', propriete: 'a'.repeat(54) }]).success).toBe(false);
    expect(schemaListeChoisie.safeParse([{ objet: 'deal', propriete: 'Montant' }]).success).toBe(false);
    expect(schemaListeChoisie.safeParse([champ(1), champ(1)]).success).toBe(false);
    // La même propriété sur deux objets n'est pas un doublon.
    expect(schemaListeChoisie.safeParse([{ objet: 'contact', propriete: 'ville' }, { objet: 'deal', propriete: 'ville' }]).success).toBe(true);
    expect(schemaListeChoisie.safeParse([{ objet: 'calcule', propriete: 'email' }]).success).toBe(false);
    expect(schemaListeChoisie.safeParse([{ objet: 'company', propriete: 'name' }]).success).toBe(false);
    expect(schemaListeChoisie.safeParse([{ ...champ(1), libelle: 'Prénom' }]).success).toBe(false);
  });
});

describe('champsDeFiche : la forme groupée', () => {
  const DECLAREES = ['hs_contact_firstname', 'hs_deal_montant', 'hs_calc_conseiller', 'hs_calc_lien_agenda', 'ville'];

  it('🔴 une valeur posée, une valeur vide RETIRÉE, une propriété non reçue pas touchée', () => {
    const recus = schemaChampsGroupes.parse({ contact: { firstname: 'Claire' }, deal: { montant: '' }, calcules: { conseiller: 'Cédric Weiss' } });
    expect(champsDeFiche(recus, DECLAREES)).toEqual({
      poser: { hs_contact_firstname: 'Claire', hs_calc_conseiller: 'Cédric Weiss' },
      // `hs_calc_lien_agenda`, non reçu, n'est pas touché.
      retirer: ['hs_deal_montant'],
    });
  });

  it('🔴 une clé reçue sans champ déclaré dans l’espace est ignorée', () => {
    const recus = schemaChampsGroupes.parse({ contact: { firstname: 'Claire', lastname: 'Martin' }, deal: { dealname: '' } });
    expect(champsDeFiche(recus, DECLAREES)).toEqual({ poser: { hs_contact_firstname: 'Claire' }, retirer: [] });
    expect(champsDeFiche(recus, [])).toEqual({ poser: {}, retirer: [] });
  });

  it('le contrat des valeurs : coupées à 1 000 par le connecteur (au-delà, refusé), le lien en https ou vide, 20 au plus', () => {
    expect(schemaChampsGroupes.safeParse({ contact: { notes: 'x'.repeat(1000) } }).success).toBe(true);
    expect(schemaChampsGroupes.safeParse({ contact: { notes: 'x'.repeat(1001) } }).success).toBe(false);
    expect(schemaChampsGroupes.safeParse({ calcules: { lien_agenda: '' } }).success).toBe(true);
    expect(schemaChampsGroupes.safeParse({ calcules: { lien_agenda: 'http://meetings.hubspot.com/x' } }).success).toBe(false);
    expect(schemaChampsGroupes.safeParse({ calcules: { email: 'x' } }).success).toBe(false);
    expect(schemaChampsGroupes.safeParse({ contact: { 'Bad-Key': 'x' } }).success).toBe(false);
    const vingtEtUn = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}`, 'x']));
    expect(schemaChampsGroupes.safeParse({ contact: vingtEtUn }).success).toBe(false);
    expect(schemaChampsGroupes.safeParse({ contact: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`p${i}`, 'x'])), deal: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p${i}`, 'x'])) }).success).toBe(false);
  });
});

describe('le lien et le PDF du devis (cadrage du 2026-11-02, « lien du devis »)', () => {
  const DEVIS = 'https://app-eu1.hubspot.com/quotes/1234/abcd';
  const PDF = 'https://app-eu1.hubspot.com/quotes/1234/abcd/download';
  const DECLAREES = ['hs_calc_lien_devis', 'hs_calc_pdf_devis'];

  it('🔴 un lien de devis en https seulement, ou vide, borné : http, javascript:, un texte ou une valeur trop longue refusés', () => {
    for (const cle of ['lien_devis', 'pdf_devis']) {
      expect(schemaChampsGroupes.safeParse({ calcules: { [cle]: DEVIS } }).success, cle).toBe(true);
      expect(schemaChampsGroupes.safeParse({ calcules: { [cle]: '' } }).success, cle).toBe(true);
      for (const faux of ['http://app-eu1.hubspot.com/quotes/1', 'javascript:alert(1)', 'devis 12', `https://x.fr/${'a'.repeat(1000)}`]) {
        expect(schemaChampsGroupes.safeParse({ calcules: { [cle]: faux } }).success, `${cle} ${faux.slice(0, 30)}`).toBe(false);
      }
    }
  });

  it('🔴 un devis valable est posé ; aucun devis (vide) RETIRE les deux champs de la fiche', () => {
    expect(champsDeFiche(schemaChampsGroupes.parse({ calcules: { lien_devis: DEVIS, pdf_devis: PDF } }), DECLAREES))
      .toEqual({ poser: { hs_calc_lien_devis: DEVIS, hs_calc_pdf_devis: PDF }, retirer: [] });
    expect(champsDeFiche(schemaChampsGroupes.parse({ calcules: { lien_devis: '', pdf_devis: '' } }), DECLAREES))
      .toEqual({ poser: {}, retirer: ['hs_calc_lien_devis', 'hs_calc_pdf_devis'] });
    // Non déclarés dans l'espace : ignorés, comme toute autre clé.
    expect(champsDeFiche(schemaChampsGroupes.parse({ calcules: { lien_devis: DEVIS } }), [])).toEqual({ poser: {}, retirer: [] });
  });
});
