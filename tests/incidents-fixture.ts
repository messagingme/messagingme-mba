import type { CaptureIncidents } from '../src/ops/incidents';

/** Une capture d'incidents qui ne fait rien, pour les tests des veilles qui ne regardent pas les incidents. */
export const sansIncidents: CaptureIncidents = { ouvrir: () => {}, clore: () => {} };

/** Une capture qui note chaque appel, pour vérifier ce qu'une veille déclenche. */
export function incidentsNotes() {
  const appels: Array<{ quoi: 'ouvrir' | 'clore'; args: unknown[] }> = [];
  const capture: CaptureIncidents = {
    ouvrir: (...args) => { appels.push({ quoi: 'ouvrir', args }); },
    clore: (...args) => { appels.push({ quoi: 'clore', args }); },
  };
  return { capture, appels };
}
