import { describe, it, expect } from 'vitest';
import {
  CHAMPS_HUBSPOT_MAX, basculerChamp, caseGrisee, champsSelectionnes, corpsDesChamps, groupesDeChamps, idChamp, portailLisible, selectionDe, selectionModifiee,
  type LigneChamp,
} from './hubspot-champs';
import type { ChampsHubspotDuPortail } from './api';

const PORTAIL: ChampsHubspotDuPortail = {
  proprietes: {
    contact: [
      { nom: 'firstname', libelle: 'Prénom', type: 'string' },
      { nom: 'city', libelle: 'Ville', type: 'string' },
    ],
    deal: [{ nom: 'montant_devis', libelle: 'Montant du devis', type: 'number' }],
  },
  calcules: [
    { cle: 'conseiller', libelle: 'Conseiller (propriétaire de la transaction)', disponible: true },
    { cle: 'lien_agenda', libelle: 'Lien de réservation du conseiller', disponible: false },
  ],
  choisis: [{ objet: 'contact', propriete: 'firstname', libelle: 'Prénom' }],
};

const ligne = (objet: LigneChamp['objet'], propriete: string, disponible = true): LigneChamp => ({ objet, propriete, nom: propriete, libelle: propriete, disponible });

describe('les champs HubSpot à importer', () => {
  it('trois groupes, Contact, Transaction, Calculés, dans cet ordre', () => {
    const g = groupesDeChamps(PORTAIL, '', new Set());
    expect(g.map((x) => [x.objet, x.lignes.map((l) => l.propriete)])).toEqual([
      ['contact', ['firstname', 'city']], ['deal', ['montant_devis']], ['calcule', ['conseiller', 'lien_agenda']],
    ]);
    expect(g[2]!.lignes[1]!.disponible).toBe(false);
  });

  it('🔴 la recherche filtre sur le libellé ou le nom, sans accents ; un champ choisi reste visible', () => {
    const g = groupesDeChamps(PORTAIL, 'reservation', new Set(['contact:firstname']));
    expect(g.map((x) => x.lignes.map((l) => l.propriete))).toEqual([['firstname'], [], ['lien_agenda']]);
    expect(groupesDeChamps(PORTAIL, 'MONTANT_', new Set()).map((x) => x.lignes.length)).toEqual([0, 1, 0]);
  });

  it('🔴 au plus 20 : la 21e case est grisée et ne se coche pas ; une case cochée se décoche toujours', () => {
    const pleine = new Set(Array.from({ length: CHAMPS_HUBSPOT_MAX }, (_, i) => `contact:p${i}`));
    const vingtEtUnieme = ligne('deal', 'montant');
    expect(caseGrisee(pleine, vingtEtUnieme)).toBe(true);
    expect(basculerChamp(pleine, vingtEtUnieme).size).toBe(CHAMPS_HUBSPOT_MAX);
    expect(caseGrisee(pleine, ligne('contact', 'p0'))).toBe(false);
    expect(basculerChamp(pleine, ligne('contact', 'p0')).has('contact:p0')).toBe(false);
    expect(caseGrisee(new Set(), vingtEtUnieme)).toBe(false);
  });

  it('🔴 un champ choisi disparu de HubSpot a sa ligne, avec la raison : il se décoche, jamais ne se recoche', () => {
    const portail: ChampsHubspotDuPortail = { ...PORTAIL, choisis: [...PORTAIL.choisis, { objet: 'deal', propriete: 'ancien_devis', libelle: 'Ancien devis' }] };
    const s = selectionDe(portail.choisis);
    const disparu = groupesDeChamps(portail, '', s)[1]!.lignes.find((l) => l.propriete === 'ancien_devis')!;
    expect(disparu).toMatchObject({ disponible: false, libelle: 'Ancien devis (n’existe plus dans HubSpot)' });
    const sans = basculerChamp(s, disparu);
    expect(corpsDesChamps(sans)).toEqual([{ objet: 'contact', propriete: 'firstname' }]);
    expect(basculerChamp(sans, disparu).has('deal:ancien_devis')).toBe(false);
    // Un champ choisi et toujours proposé n'est pas doublé.
    expect(groupesDeChamps(portail, '', s)[0]!.lignes.map((l) => l.propriete)).toEqual(['firstname', 'city']);
  });

  it('🔴 la liste des sélectionnés : chacun avec son libellé, dans l’ordre des groupes, disparus compris, quelle que soit la recherche', () => {
    const portail: ChampsHubspotDuPortail = { ...PORTAIL, choisis: [...PORTAIL.choisis, { objet: 'deal', propriete: 'ancien_devis', libelle: 'Ancien devis' }] };
    const s = new Set(['calcule:conseiller', 'deal:ancien_devis', 'contact:firstname']);
    expect(champsSelectionnes(portail, s).map((l) => [idChamp(l), l.libelle])).toEqual([
      ['contact:firstname', 'Prénom'],
      ['deal:ancien_devis', 'Ancien devis (n’existe plus dans HubSpot)'],
      ['calcule:conseiller', 'Conseiller (propriétaire de la transaction)'],
    ]);
    // La croix retire le champ de la sélection.
    const sans = basculerChamp(s, champsSelectionnes(portail, s)[0]!);
    expect(champsSelectionnes(portail, sans).map(idChamp)).toEqual(['deal:ancien_devis', 'calcule:conseiller']);
  });

  it('le lien de réservation sans l’accès à l’agenda ne se coche pas, mais se décoche s’il était choisi', () => {
    const lien = ligne('calcule', 'lien_agenda', false);
    expect(basculerChamp(new Set(), lien).size).toBe(0);
    expect(basculerChamp(new Set(['calcule:lien_agenda']), lien).size).toBe(0);
  });

  it('🔴 le corps envoyé : objet et propriété, jamais de libellé ; la sélection part de la liste enregistrée', () => {
    const s = selectionDe(PORTAIL.choisis);
    expect([...s]).toEqual(['contact:firstname']);
    const suivante = basculerChamp(basculerChamp(s, ligne('deal', 'montant_devis')), ligne('calcule', 'conseiller'));
    expect(corpsDesChamps(suivante)).toEqual([
      { objet: 'contact', propriete: 'firstname' }, { objet: 'deal', propriete: 'montant_devis' }, { objet: 'calcule', propriete: 'conseiller' },
    ]);
    expect(idChamp({ objet: 'deal', propriete: 'a_b' })).toBe('deal:a_b');
  });

  it('le bouton « Enregistrer » ne sert que si la sélection a changé', () => {
    const s = selectionDe(PORTAIL.choisis);
    expect(selectionModifiee(new Set(s), s)).toBe(false);
    expect(selectionModifiee(basculerChamp(s, ligne('contact', 'city')), s)).toBe(true);
    expect(selectionModifiee(new Set(['contact:city']), s)).toBe(true);
  });

  it('une réponse d’une autre forme est illisible (l’écran le dit, la page ne tombe pas)', () => {
    expect(portailLisible(PORTAIL)).toBe(true);
    for (const r of [{}, null, { proprietes: { contact: [] }, calcules: [], choisis: [] }, { ...PORTAIL, choisis: undefined }]) {
      expect(portailLisible(r), JSON.stringify(r)).toBe(false);
    }
  });
});
