import { describe, it, expect } from 'vitest';
import { flechesSuivantLesBoutons, sortiesDeBoutons, SORTIE_PAS_DE_REPONSE } from './workflow-sorties';

/**
 * Les flèches des boutons d'un bloc template quand son template change (menu « Scénario », lot 3) : écrit depuis le
 * bloc, ou choisi dans la liste. Les sorties d'un template sont POSITIONNELLES (`btn:<i>`) : retirer un bouton du milieu
 * décalait les suivants, et leurs flèches menaient à la mauvaise branche sans aucun signal.
 */
const qr = (text: string) => ({ type: 'QUICK_REPLY', text });
const lien = (text: string) => ({ type: 'URL', text, url: 'https://x.fr' });
const fleche = (sourceHandle: string | undefined, target: string) => ({ id: `${sourceHandle ?? 'libre'}-${target}`, source: 'n1', target, sourceHandle });

describe('sortiesDeBoutons', () => {
  it('les réponses rapides, à leur rang parmi TOUS les boutons (le canevas compte aussi les liens)', () => {
    expect(sortiesDeBoutons({ templateButtons: [lien('Voir'), qr('Oui'), qr('Non')] })).toEqual([
      { poignee: 'btn:1', texte: 'Oui' }, { poignee: 'btn:2', texte: 'Non' },
    ]);
  });

  it('un carousel : les poignées de ses cartes', () => {
    expect(sortiesDeBoutons({ templateButtons: [], templateCards: [{ type: 'QUICK_REPLY', text: 'A', handle: 'card:0:btn:0', cardIndex: 0 }, { type: 'URL', text: 'L', handle: 'card:0:btn:1', cardIndex: 0 }] }))
      .toEqual([{ poignee: 'card:0:btn:0', texte: 'A' }]);
  });

  it('des données anciennes ou mal formées ne font rien tomber', () => {
    expect(sortiesDeBoutons({})).toEqual([]);
    expect(sortiesDeBoutons({ templateButtons: 'x' })).toEqual([]);
  });
});

describe('flechesSuivantLesBoutons', () => {
  const avant = sortiesDeBoutons({ templateButtons: [qr('Oui'), qr('Peut-être'), qr('Non')] });

  it('🔴 le bouton du milieu retiré : « Non » garde SA branche, celle de « Peut-être » disparaît', () => {
    const apres = sortiesDeBoutons({ templateButtons: [qr('Oui'), qr('Non')] });
    const edges = [fleche('btn:0', 'oui'), fleche('btn:1', 'peut-etre'), fleche('btn:2', 'non')];
    expect(flechesSuivantLesBoutons(edges, 'n1', avant, apres).map((e) => [e.sourceHandle, e.target])).toEqual([
      ['btn:0', 'oui'], ['btn:1', 'non'],
    ]);
  });

  it('l’ordre changé : chaque flèche suit son texte', () => {
    const apres = sortiesDeBoutons({ templateButtons: [qr('Non'), qr('Oui'), qr('Peut-être')] });
    const edges = [fleche('btn:0', 'oui'), fleche('btn:2', 'non')];
    expect(flechesSuivantLesBoutons(edges, 'n1', avant, apres).map((e) => [e.sourceHandle, e.target])).toEqual([
      ['btn:1', 'oui'], ['btn:0', 'non'],
    ]);
  });

  it('un texte changé : sa flèche disparaît (jamais une branche devinée)', () => {
    const apres = sortiesDeBoutons({ templateButtons: [qr('Oui, merci'), qr('Peut-être'), qr('Non')] });
    const edges = [fleche('btn:0', 'oui'), fleche('btn:2', 'non')];
    expect(flechesSuivantLesBoutons(edges, 'n1', avant, apres).map((e) => [e.sourceHandle, e.target])).toEqual([['btn:2', 'non']]);
  });

  it('deux boutons au même texte : chacun prend le premier libre, dans l’ordre', () => {
    const doubles = sortiesDeBoutons({ templateButtons: [qr('Oui'), qr('Oui')] });
    const edges = [fleche('btn:0', 'a'), fleche('btn:1', 'b')];
    const apres = sortiesDeBoutons({ templateButtons: [qr('Non'), qr('Oui'), qr('Oui')] });
    expect(flechesSuivantLesBoutons(edges, 'n1', doubles, apres).map((e) => [e.sourceHandle, e.target])).toEqual([
      ['btn:1', 'a'], ['btn:2', 'b'],
    ]);
  });

  it('🔴 l’ordre des flèches dans le graphe ne change rien : la correspondance suit l’ordre des boutons', () => {
    const doubles = sortiesDeBoutons({ templateButtons: [qr('Oui'), qr('Oui')] });
    const apres = sortiesDeBoutons({ templateButtons: [qr('Non'), qr('Oui'), qr('Oui')] });
    const edges = [fleche('btn:1', 'b'), fleche('btn:0', 'a')];
    expect(flechesSuivantLesBoutons(edges, 'n1', doubles, apres).map((e) => [e.sourceHandle, e.target])).toEqual([
      ['btn:2', 'b'], ['btn:1', 'a'],
    ]);
  });

  it('🔴 « Pas de réponse », la sortie libre et les flèches des AUTRES blocs ne bougent pas', () => {
    const apres = sortiesDeBoutons({ templateButtons: [] });
    const autres = [
      fleche(SORTIE_PAS_DE_REPONSE, 'relance'),
      fleche(undefined, 'libre'),
      { id: 'x', source: 'n2', target: 'y', sourceHandle: 'btn:0' },
    ];
    const edges = [fleche('btn:0', 'oui'), ...autres];
    expect(flechesSuivantLesBoutons(edges, 'n1', avant, apres)).toEqual(autres);
  });

  it('rien ne change quand les boutons sont les mêmes : les objets sont rendus tels quels', () => {
    const edges = [fleche('btn:0', 'oui'), fleche('btn:2', 'non')];
    const r = flechesSuivantLesBoutons(edges, 'n1', avant, avant);
    expect(r).toEqual(edges);
    expect(r[0]).toBe(edges[0]);
  });
});
