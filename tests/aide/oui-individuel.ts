import type { DepsMcp } from '../../src/mcp/outils';
import type { DepsEnvoisAuOui } from '../../src/mise-en-ligne/envois';
import { monter } from '../mise-en-ligne-fixtures';
import { envoisAuOuiInertes } from '../routes-inertes';

export const SCENARIO_ID = 'cfeb395f-0215-4d91-b373-9140b02ffbdd';

/**
 * Un envoi à une personne préparé par son outil (CSM, B8, livraison 2) : le VRAI oui de mise en ligne sur le magasin en
 * mémoire, une cible toujours envoyable (un modèle, ou le scénario « Relance », code `scn_relance`) et un envoi qui LÈVE :
 * rien ne part avant le clic d'un admin, qu'aucun outil ne donne. `jugements` : les corps que la préparation a fait juger.
 */
export function monterOuiIndividuel(o: { couteuxAccepte?: boolean } = {}) {
  const jugements: Array<Record<string, unknown>> = [];
  const individuels: DepsEnvoisAuOui['individuels'] = {
    jugerCible: async (_t, corps) => {
      jugements.push(corps as Record<string, unknown>);
      const scenario = (corps as { target: { scenario?: string } }).target.scenario;
      return scenario === undefined
        ? { ok: true, categorie: 'utility', label: 'modele', workflowId: null }
        : { ok: true, categorie: 'utility', label: 'Relance', workflowId: SCENARIO_ID };
    },
    envoyer: async () => { throw new Error('rien ne part avant le clic d’un admin'); },
    contacts: { getById: async () => null, findByPhone: async () => null },
    scenarios: {
      lireParApi: async (_t, ref) => (ref === SCENARIO_ID || ref === 'scn_relance' ? { id: SCENARIO_ID, code: 'scn_relance', name: 'Relance' } as never : null),
    },
  };
  const m = monter({ envois: { ...envoisAuOuiInertes, individuels } });
  const deps = {
    misesEnLigne: m.deps,
    couteux: { consommer: async () => ({ accepte: o.couteuxAccepte ?? true, attenteMs: 4000 }) },
  } as unknown as DepsMcp;
  return { m, deps, jugements };
}
