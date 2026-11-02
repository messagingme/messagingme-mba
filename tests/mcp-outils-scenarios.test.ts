import { describe, it, expect } from 'vitest';
import { OUTILS, outilsPour, RefusOutil, type DepsMcp } from '../src/mcp/outils';
import { creerScenario } from '../src/workflow/scenarios-api';
import {
  LONGUEUR_URL_FICHIER_MAX, MAX_BOUTONS_TEMPLATE, MAX_FICHIERS_RECETTE, MAX_TEXTE_BOUTON_TEMPLATE, NOM_SCENARIO_MAX, PROFONDEUR_MAX_RECETTE,
} from '../src/workflow/recette';
import { MAX_NODES } from '../src/workflow/graph';
import {
  MAX_REPONSES_RAPIDES, MAX_TEXTE_REPONSE_RAPIDE, TEXTE_MAX_AVEC_FICHIER_OU_BOUTON, TEXTE_MAX_SIMPLE,
} from '../web/lib/partage/message-rapide';
import { TENANT, depsScenarios, recette } from './aide/scenarios-api';

/**
 * LES OUTILS MCP DES SCÉNARIOS : `create_scenario`, `get_scenario`, `update_scenario`, `delete_scenario`. Ils appellent le
 * MÊME service que `/v1/scenarios` (`src/workflow/scenarios-api.ts`) et n'ont aucune logique à eux.
 */
const outil = (nom: string) => OUTILS.find((o) => o.nom === nom)!;
const MOI = { userId: 'u1' };
const NOMS = ['create_scenario', 'get_scenario', 'update_scenario', 'delete_scenario'];

function monter() {
  const s = depsScenarios();
  return { ...s, deps: { scenariosApi: s.d } as unknown as DepsMcp };
}

describe('les outils MCP des scénarios', () => {
  it('🔴 les trois écritures exigent une personne, et la fonction « scénarios » de l’offre', () => {
    for (const nom of NOMS) expect(outil(nom).fonction, nom).toBe('scenarios');
    for (const nom of ['create_scenario', 'update_scenario', 'delete_scenario']) {
      expect(outil(nom)).toMatchObject({ scope: 'mcp:write', exigePersonne: true });
    }
    expect(outil('get_scenario').scope).toBe('mcp:read');
    const parCle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null } as never).map((o) => o.nom);
    expect(parCle).toContain('get_scenario');
    for (const nom of ['create_scenario', 'update_scenario', 'delete_scenario']) expect(parCle).not.toContain(nom);
  });

  it('la même recette donne le même graphe par le MCP et par le service de la route', async () => {
    const parMcp = monter();
    const vue = await outil('create_scenario').executer(parMcp.deps, TENANT, recette(), MOI) as { id: string; empreinte: string };
    const parRoute = depsScenarios();
    const r = await creerScenario(parRoute.d, TENANT, recette(), 'api');
    if (!r.ok) throw new Error(r.message);
    expect(vue.empreinte).toBe(r.valeur.empreinte);
    expect(parMcp.store.creerPublieParApi.mock.calls[0]![2].nodes.map((n) => n.id))
      .toEqual(parRoute.store.creerPublieParApi.mock.calls[0]![2].nodes.map((n) => n.id));
    expect(parMcp.journal).toHaveBeenCalledWith(TENANT, 'workflow.published', vue.id, expect.objectContaining({ origine: 'mcp' }), { userId: 'u1', acces: null });
  });

  it('un refus du service devient un refus lisible, avec son chemin', async () => {
    const { deps } = monter();
    await expect(outil('create_scenario').executer(deps, TENANT, { nom: 'x', entree: {} }, MOI)).rejects.toThrow(RefusOutil);
    await expect(outil('create_scenario').executer(deps, TENANT, { nom: 'x', entree: {} }, MOI)).rejects.toThrow(/entree/);
  });

  it('get, update et delete : par id ou code scn_, le remplacement exige l’empreinte', async () => {
    const { deps, store } = monter();
    const cree = await outil('create_scenario').executer(deps, TENANT, recette(), MOI) as { id: string; code: string; empreinte: string };
    const lu = await outil('get_scenario').executer(deps, TENANT, { scenario: cree.code }, null) as { empreinte: string };
    expect(lu.empreinte).toBe(cree.empreinte);
    const autre = recette({ template: { nom: 'relance', langue: 'fr' }, boutons: [{ texte: 'Oui', suite: { humain: {} } }, { texte: 'Non', suite: { humain: {} } }] });
    await expect(outil('update_scenario').executer(deps, TENANT, { scenario: cree.id, ...autre }, MOI)).rejects.toThrow(/empreinte/);
    const maj = await outil('update_scenario').executer(deps, TENANT, { scenario: cree.id, ...autre, empreinte: cree.empreinte }, MOI) as { empreinte: string };
    expect(maj.empreinte).not.toBe(cree.empreinte);
    store.supprimerParApi.mockImplementation((async (id: string) => { store.lignes.delete(id); return 'ok'; }) as never);
    expect(await outil('delete_scenario').executer(deps, TENANT, { scenario: cree.id }, MOI)).toEqual({ id: cree.id, supprime: true });
  });

  it('🔴 le schéma annoncé porte chaque borne que la lecture applique', () => {
    // Une borne appliquée sans être annoncée est une panne qu'aucune coopération du modèle ne peut éviter (règle du dépôt).
    const annonce = JSON.stringify([outil('create_scenario').entree, outil('create_scenario').description]);
    for (const borne of [
      MAX_REPONSES_RAPIDES, MAX_TEXTE_REPONSE_RAPIDE, TEXTE_MAX_AVEC_FICHIER_OU_BOUTON, TEXTE_MAX_SIMPLE, MAX_TEXTE_BOUTON_TEMPLATE,
      MAX_BOUTONS_TEMPLATE, PROFONDEUR_MAX_RECETTE, MAX_NODES, NOM_SCENARIO_MAX, LONGUEUR_URL_FICHIER_MAX, MAX_FICHIERS_RECETTE,
    ]) expect(annonce, String(borne)).toMatch(new RegExp(`(^|[^0-9])${borne}([^0-9]|$)`));
    for (const mot of ['https', 'template', 'message', 'agent', 'humain', 'boutons', 'reponses', 'autre_reponse', 'suite', 'fichier']) {
      expect(annonce, mot).toContain(mot);
    }
    // update_scenario annonce la même recette.
    expect(JSON.stringify(outil('update_scenario').entree.properties.entree)).toBe(JSON.stringify(outil('create_scenario').entree.properties.entree));
  });
});
