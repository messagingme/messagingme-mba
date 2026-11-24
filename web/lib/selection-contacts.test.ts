import { describe, expect, it } from 'vitest';
import {
  basculerContact, basculerLignesAffichees, cibleContacts, estRetenu, nbRetenus, selectionTout, selectionVide,
} from './selection-contacts';

describe('sélection commune aux contacts et aux campagnes', () => {
  it('coche les lignes affichées, retire une ligne, puis vide via l’en-tête', () => {
    const vide = selectionVide();
    const page = basculerLignesAffichees(vide, ['a', 'b']);
    expect(cibleContacts(page, { tags: ['vip'] })).toEqual({ ids: ['a', 'b'] });

    const retire = basculerContact(page, 'b');
    expect(cibleContacts(retire, {})).toEqual({ ids: ['a'] });
    expect(estRetenu(page, 'b')).toBe(true); // le précédent état React reste intact
    expect(cibleContacts(basculerLignesAffichees(page, ['a', 'b']), {})).toEqual({ ids: [] });
  });

  it('garde l’intention « tous les filtres » même quand une ligne affichée est exclue', () => {
    const tous = selectionTout();
    const moinsUn = basculerContact(tous, 'b');
    expect(estRetenu(moinsUn, 'a')).toBe(true);
    expect(estRetenu(moinsUn, 'b')).toBe(false);
    expect(nbRetenus(moinsUn, 1000)).toBe(999);
    expect(cibleContacts(moinsUn, { tags: ['vip'] })).toEqual({
      filters: { tags: ['vip'] }, excludeIds: ['b'],
    });
    expect(cibleContacts(tous, {})).toEqual({ filters: {}, excludeIds: [] });
    expect(basculerLignesAffichees(moinsUn, ['a', 'b'])).toEqual(selectionVide());
  });

  it('🔴 l’en-tête d’une page ne touche pas aux lignes cochées sur une autre page', () => {
    const page1 = basculerContact(basculerContact(selectionVide(), 'a'), 'b');
    const avecPage2 = basculerLignesAffichees(page1, ['c', 'd']);
    expect(cibleContacts(avecPage2, {})).toEqual({ ids: ['a', 'b', 'c', 'd'] });
    // Décochée, la page 2 seule part : la page 1 reste cochée.
    expect(cibleContacts(basculerLignesAffichees(avecPage2, ['c', 'd']), {})).toEqual({ ids: ['a', 'b'] });
  });
});
