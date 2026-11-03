import { describe, it, expect } from 'vitest';
import { creerPlacesOption } from '../src/credit-whatsapp/places';

/**
 * LES PLACES DE L'OPTION (lot 4a, décision de Julien du 2026-11-03 : une place est un NUMÉRO). Les numéros couverts par
 * les lignes de l'option se rangent ; seuls les premiers, autant que de places payées, envoient.
 */
describe('les places de l’option', () => {
  function places(o: { payees: number; ordre: string[] }) {
    let lectures = 0;
    let t = 0;
    const p = creerPlacesOption({
      placesPayees: async () => { lectures += 1; return o.payees; },
      numerosCouvertsParOption: async () => o.ordre,
      maintenant: () => t,
    });
    return { p, lectures: () => lectures, avancer: (ms: number) => { t += ms; } };
  }

  it('🔴 les premiers numéros rangés, autant que de places payées, envoient ; le suivant non, ni un numéro hors des lignes', async () => {
    const { p } = places({ payees: 2, ordre: ['pn_ligne', 'pn_ancien', 'pn_recent'] });
    expect(await Promise.all(['pn_ligne', 'pn_ancien', 'pn_recent', 'pn_autre'].map((n) => p.couvre('t1', n)))).toEqual([true, true, false, false]);
  });

  it('🔴 sans option payée, aucun numéro ne tient', async () => {
    const { p } = places({ payees: 0, ordre: ['pn_ligne'] });
    expect(await p.couvre('t1', 'pn_ligne')).toBe(false);
  });

  it('lu une fois par espace pendant cinq secondes, puis relu (une place de plus vaut vite partout)', async () => {
    const { p, lectures, avancer } = places({ payees: 1, ordre: ['pn_ligne'] });
    await p.couvre('t1', 'pn_ligne');
    await p.couvre('t1', 'pn_ligne');
    expect(lectures()).toBe(1);
    avancer(5_000);
    await p.couvre('t1', 'pn_ligne');
    expect(lectures()).toBe(2);
  });
});
