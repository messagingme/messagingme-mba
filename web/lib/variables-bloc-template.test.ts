import { describe, expect, it } from 'vitest';
import { lignesDuBloc, lireSourcesDuBloc, versSourcesDuBloc } from './variables-bloc-template';
import type { UserFieldDef } from './api';

const CHAMPS = [{ key: 'ville', label: 'Ville' }] as UserFieldDef[];
const PRENOM = { position: 1, source: { type: 'field' as const, key: 'prenom' } };
const VILLE = { position: 2, source: { type: 'field' as const, key: 'ville' } };

describe('les variables du bloc « Envoi template »', () => {
  it('part des sources du template, une position sans source reste vide', () => {
    expect(lignesDuBloc(3, [PRENOM, VILLE], [], CHAMPS)).toEqual([
      { sel: 'sys:prenom', value: '' }, { sel: 'field:ville', value: '' }, { sel: '', value: '' },
    ]);
  });

  it('le choix du bloc prime sur le template, position par position', () => {
    const nom = { position: 1, source: { type: 'attribute' as const, key: 'name' } };
    expect(lignesDuBloc(2, [PRENOM, VILLE], [nom], CHAMPS).map((l) => l.sel)).toEqual(['sys:name', 'field:ville']);
  });

  it('ce que le bloc enregistre : les positions choisies, ni le vide ni un texte fixe sans texte', () => {
    expect(versSourcesDuBloc([
      { sel: 'field:ville', value: '' }, { sel: '', value: '' }, { sel: 'literal', value: ' ' }, { sel: 'literal', value: 'Paris' }, { sel: 'now', value: '' },
    ])).toEqual([
      { position: 1, source: { type: 'field', key: 'ville' } },
      { position: 4, source: { type: 'literal', value: 'Paris' } },
      { position: 5, source: { type: 'now' } },
    ]);
  });

  it('🔴 seules les positions changées par rapport au template s’enregistrent : les autres suivent le template', () => {
    const base = lignesDuBloc(2, [PRENOM, VILLE], [], CHAMPS);
    expect(versSourcesDuBloc(base, base)).toEqual([]);
    const lignes = [{ sel: 'sys:name', value: '' }, base[1]!];
    expect(versSourcesDuBloc(lignes, base)).toEqual([{ position: 1, source: { type: 'attribute', key: 'name' } }]);
  });

  it('un aller-retour garde les choix', () => {
    const lignes = lignesDuBloc(2, [PRENOM], [VILLE], CHAMPS);
    expect(lignesDuBloc(2, [], versSourcesDuBloc(lignes), CHAMPS)).toEqual(lignes);
  });

  it('lit défensivement ce que le bloc porte', () => {
    expect(lireSourcesDuBloc(undefined)).toEqual([]);
    expect(lireSourcesDuBloc('x')).toEqual([]);
    expect(lireSourcesDuBloc([VILLE, { position: 'a', source: {} }, null, { position: 3 }])).toEqual([VILLE]);
  });
});
