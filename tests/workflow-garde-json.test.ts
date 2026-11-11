import { describe, it, expect } from 'vitest';
import { avecGardeJson } from '../src/workflow/garde-json';
import { MAX_OCTETS_CHAMP_JSON } from '../src/crm/fields';
import type { UserFieldType } from '../src/crm/types';

/**
 * 🔴 UN CHAMP `json` NE PORTE QU'UN JSON VALIDE (spec du 2026-11-11) : toutes les écritures de fiche d'un parcours passent
 * par cette garde, qui vide un champ `json` plutôt que d'y laisser un texte que le bloc d'extraction ne saurait pas lire.
 */
function monter(types: Record<string, UserFieldType>) {
  const ecrit: string[] = [];
  const lus: string[] = [];
  const fiche = avecGardeJson({
    setField: async (_t, _w, key, value) => { ecrit.push(`${key}=${value}`); },
    clearField: async (_t, _w, key) => { ecrit.push(`clear:${key}`); },
  }, async (_t, cle) => { lus.push(cle); return types[cle] ?? null; });
  return { fiche, ecrit, lus };
}

describe('la garde des champs JSON du parcours', () => {
  it('🔴 un texte qui n’est pas du JSON VIDE un champ json (bloc Action, Question, Fonction JS)', async () => {
    const { fiche, ecrit } = monter({ reponse: 'json' });
    await fiche.setField('t1', '33600', 'reponse', 'livré');
    expect(ecrit).toEqual(['reponse=']);
  });

  it('un JSON valide y prend sa forme compacte', async () => {
    const { fiche, ecrit } = monter({ reponse: 'json' });
    await fiche.setField('t1', '33600', 'reponse', '{ "a" : [ 1 ] }');
    expect(ecrit).toEqual(['reponse={"a":[1]}']);
  });

  it('🔴 au-delà de 16 Ko, le champ json est vidé, jamais tronqué', async () => {
    const { fiche, ecrit } = monter({ reponse: 'json' });
    await fiche.setField('t1', '33600', 'reponse', JSON.stringify('a'.repeat(MAX_OCTETS_CHAMP_JSON)));
    expect(ecrit).toEqual(['reponse=']);
  });

  it('un champ d’un autre type reçoit la valeur telle quelle, JSON ou pas', async () => {
    const { fiche, ecrit } = monter({ ville: 'text' });
    await fiche.setField('t1', '33600', 'ville', '{ pas du json');
    await fiche.setField('t1', '33600', 'inconnu', 'x');
    expect(ecrit).toEqual(['ville={ pas du json', 'inconnu=x']);
  });

  it('vider ne lit pas le type (toujours permis), et clearField passe', async () => {
    const { fiche, ecrit, lus } = monter({ reponse: 'json' });
    await fiche.setField('t1', '33600', 'reponse', '');
    await fiche.clearField('t1', '33600', 'reponse');
    expect(ecrit).toEqual(['reponse=', 'clear:reponse']);
    expect(lus).toEqual([]);
  });
});
