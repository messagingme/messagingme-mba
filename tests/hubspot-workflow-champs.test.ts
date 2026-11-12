import { describe, it, expect } from 'vitest';
import {
  champsDeFiche, cleChampHubspot, declarerChampsHubspot, schemaChampsGroupes, schemaListeChoisie, typeChampHubspot,
} from '../src/hubspot-workflow/champs';
import type { UserFieldDef } from '../src/crm/types';

/** Des clés déclarées en texte, comme `UserFieldStore.list` les rend. */
const declarees = (cles: readonly string[]) => cles.map((key) => ({ key, type: 'text' as const }));

/**
 * LES CHAMPS HUBSPOT CHOISIS (lot 2 du plan du 2026-11-02, le contrat avec le connecteur). 🔴 La clé de fiche vient du NOM
 * interne de la propriété, jamais de son libellé : un libellé renommé dans HubSpot ferait pointer les sources du modèle sur
 * un champ que personne n'écrit. Et mba n'écrit qu'une clé DÉCLARÉE dans l'espace.
 */
describe('la règle de clé et la déclaration', () => {
  const store = () => {
    const defs: UserFieldDef[] = [];
    return {
      defs,
      list: async () => [...defs],
      upsert: async (_t: string, d: UserFieldDef) => { defs.push(d); },
      updateField: async (_t: string, key: string, patch: { type: UserFieldDef['type'] }) => {
        const d = defs.find((x) => x.key === key);
        if (d) d.type = patch.type;
        return d !== undefined;
      },
    };
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
    expect(champsDeFiche(recus, declarees(DECLAREES), 't1')).toEqual({
      poser: { hs_contact_firstname: 'Claire', hs_calc_conseiller: 'Cédric Weiss' },
      // `hs_calc_lien_agenda`, non reçu, n'est pas touché.
      retirer: ['hs_deal_montant'],
    });
  });

  it('🔴 une clé reçue sans champ déclaré dans l’espace est ignorée', () => {
    const recus = schemaChampsGroupes.parse({ contact: { firstname: 'Claire', lastname: 'Martin' }, deal: { dealname: '' } });
    expect(champsDeFiche(recus, declarees(DECLAREES), 't1')).toEqual({ poser: { hs_contact_firstname: 'Claire' }, retirer: [] });
    expect(champsDeFiche(recus, declarees([]), 't1')).toEqual({ poser: {}, retirer: [] });
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
    expect(champsDeFiche(schemaChampsGroupes.parse({ calcules: { lien_devis: DEVIS, pdf_devis: PDF } }), declarees(DECLAREES), 't1'))
      .toEqual({ poser: { hs_calc_lien_devis: DEVIS, hs_calc_pdf_devis: PDF }, retirer: [] });
    expect(champsDeFiche(schemaChampsGroupes.parse({ calcules: { lien_devis: '', pdf_devis: '' } }), declarees(DECLAREES), 't1'))
      .toEqual({ poser: {}, retirer: ['hs_calc_lien_devis', 'hs_calc_pdf_devis'] });
    // Non déclarés dans l'espace : ignorés, comme toute autre clé.
    expect(champsDeFiche(schemaChampsGroupes.parse({ calcules: { lien_devis: DEVIS } }), declarees([]), 't1')).toEqual({ poser: {}, retirer: [] });
  });
});

/**
 * LES PROPRIÉTÉS HUBSPOT DE TYPE DATE (plan `docs/superpowers/plans/2026-11-12-champs-hubspot-dates.md`) : la date d'un
 * rendez-vous pris dans HubSpot doit pouvoir porter le déclencheur « avant ou après une date », qui n'accepte qu'un champ
 * « date et heure ». Décisions de Julien du 2026-11-12 : un champ resté en texte passe en date ; une date illisible vide le
 * champ.
 */
describe('les propriétés HubSpot de type date', () => {
  const store = (defs: UserFieldDef[] = []) => ({
    defs,
    retypes: [] as string[],
    list: async () => [...defs],
    upsert: async (_t: string, d: UserFieldDef) => { defs.push(d); },
    async updateField(_t: string, key: string, patch: { type: UserFieldDef['type'] }) {
      this.retypes.push(`${key}:${patch.type}`);
      const d = defs.find((x) => x.key === key);
      if (d) d.type = patch.type;
      return d !== undefined;
    },
  });
  const RDV = { objet: 'contact' as const, propriete: 'engagements_last_meeting_booked', libelle: 'Dernière réunion réservée' };

  it('le type de la propriété : datetime et date deviennent des dates, le reste du texte ; les calculés ne changent pas', () => {
    expect(typeChampHubspot('contact', 'p', 'datetime')).toBe('datetime');
    expect(typeChampHubspot('deal', 'p', 'date')).toBe('date');
    for (const t of ['string', 'number', 'bool', 'enumeration', 'phone_number', '', undefined]) {
      expect(typeChampHubspot('contact', 'p', t), String(t)).toBe('text');
    }
    expect(typeChampHubspot('calcule', 'lien_agenda', 'datetime')).toBe('url');
    expect(typeChampHubspot('calcule', 'conseiller', 'datetime')).toBe('text');
  });

  it('🔴 un champ neuf est déclaré « date et heure » ; une seconde déclaration ne retype rien', async () => {
    const s = store();
    await declarerChampsHubspot(s, 't1', [{ ...RDV, typeHubspot: 'datetime' }]);
    await declarerChampsHubspot(s, 't1', [{ ...RDV, typeHubspot: 'datetime' }]);
    expect(s.defs).toEqual([{ key: 'hs_contact_engagements_last_meeting_booked', label: 'Dernière réunion réservée (HubSpot)', type: 'datetime' }]);
    expect(s.retypes).toEqual([]);
  });

  it('🔴 un champ importé AVANT, resté en texte, passe en date (libellé gardé) ; jamais un autre type, jamais l’inverse', async () => {
    const s = store([
      { key: 'hs_contact_engagements_last_meeting_booked', label: 'Mon RDV', type: 'text' },
      { key: 'hs_deal_closedate', label: 'Clôture', type: 'number' },
      { key: 'hs_contact_firstname', label: 'Prénom', type: 'text' },
      { key: 'hs_contact_naissance', label: 'Naissance', type: 'datetime' },
    ]);
    await declarerChampsHubspot(s, 't1', [
      { ...RDV, typeHubspot: 'datetime' },
      { objet: 'deal', propriete: 'closedate', libelle: 'Close date', typeHubspot: 'datetime' },
      { objet: 'contact', propriete: 'firstname', libelle: 'First name', typeHubspot: 'string' },
      { objet: 'contact', propriete: 'naissance', libelle: 'Naissance', typeHubspot: 'date' },
    ]);
    expect(s.retypes).toEqual(['hs_contact_engagements_last_meeting_booked:datetime']);
    expect(s.defs[0]).toEqual({ key: 'hs_contact_engagements_last_meeting_booked', label: 'Mon RDV', type: 'datetime' });
    expect(s.defs.slice(1).map((d) => d.type)).toEqual(['number', 'text', 'datetime']);
  });

  const DATES = [
    { key: 'hs_contact_rdv', type: 'datetime' as const },
    { key: 'hs_deal_jour', type: 'date' as const },
    { key: 'hs_contact_firstname', type: 'text' as const },
  ];
  const recus = (contact: Record<string, string>, deal: Record<string, string> = {}) => schemaChampsGroupes.parse({ contact, deal });

  it('🔴 une date reçue est posée en ISO : ISO avec Z, avec millisecondes, horodatage en millisecondes', () => {
    expect(champsDeFiche(recus({ rdv: '2026-11-14T09:30:00Z' }), DATES, 't1').poser).toEqual({ hs_contact_rdv: '2026-11-14T09:30:00Z' });
    expect(champsDeFiche(recus({ rdv: '2026-11-14T09:30:00.000Z' }), DATES, 't1').poser).toEqual({ hs_contact_rdv: '2026-11-14T09:30:00.000Z' });
    expect(champsDeFiche(recus({ rdv: '1794648600000' }), DATES, 't1').poser).toEqual({ hs_contact_rdv: '2026-11-14T09:30:00.000Z' });
    // Une propriété `date` de HubSpot peut arriver à minuit UTC : le champ « date » garde le jour.
    expect(champsDeFiche(recus({}, { jour: '2026-11-14T00:00:00Z' }), DATES, 't1').poser).toEqual({ hs_deal_jour: '2026-11-14' });
    // Le texte n'est pas touché.
    expect(champsDeFiche(recus({ firstname: ' 03/04/2026 ' }), DATES, 't1').poser).toEqual({ hs_contact_firstname: ' 03/04/2026 ' });
  });

  it('🔴 une date illisible, ambiguë ou sans heure est RETIRÉE, jamais posée telle quelle ; une valeur vide retirée aussi', () => {
    for (const v of ['demain', '03/04/2026 10:00', '2026-11-14', '2026-02-30T10:00:00Z']) {
      expect(champsDeFiche(recus({ rdv: v }), DATES, 't1'), v).toEqual({ poser: {}, retirer: ['hs_contact_rdv'] });
    }
    expect(champsDeFiche(recus({ rdv: '' }), DATES, 't1')).toEqual({ poser: {}, retirer: ['hs_contact_rdv'] });
  });
});
