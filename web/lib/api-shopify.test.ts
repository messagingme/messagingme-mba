import { describe, it, expect } from 'vitest';
import { gesteEtiquettesDe } from './api-shopify';

/**
 * La réponse d'un geste de la carte des étiquettes Shopify (lot 6b) : la vue, et si CE geste a lancé une lecture. 🔴 Une
 * synchronisation qui tournait déjà rend `lancee: false` : la carte ne doit pas dire « lancée ».
 */
const SYNCHRO = {
  allumee: true, synchroLe: '2026-11-24T08:00:00.000Z', enCours: true, refus: null,
  comptes: { clientsLus: 1, trouvesParTelephone: 1, sansFiche: 0, fichesEtiquetees: 1 },
};

describe('gesteEtiquettesDe', () => {
  it('🔴 lancée seulement si le serveur le dit, et la vue lue à part', () => {
    expect(gesteEtiquettesDe({ synchro: { ...SYNCHRO, lancee: true } })).toEqual({ vue: SYNCHRO, lancee: true });
    expect(gesteEtiquettesDe({ synchro: { ...SYNCHRO, lancee: false } })).toEqual({ vue: SYNCHRO, lancee: false });
    // Absent ou illisible : jamais « lancée ».
    expect(gesteEtiquettesDe({ synchro: SYNCHRO })).toEqual({ vue: SYNCHRO, lancee: false });
    expect(gesteEtiquettesDe({ synchro: { ...SYNCHRO, lancee: 'oui' } }).lancee).toBe(false);
    for (const r of [null, undefined, 'x', [], {}, { synchro: null }]) expect(gesteEtiquettesDe(r), JSON.stringify(r)).toEqual({ vue: null, lancee: false });
  });
});
