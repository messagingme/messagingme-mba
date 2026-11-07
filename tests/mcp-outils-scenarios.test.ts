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
import { lireCible, schemaCorps, schemaDestinataire, type ResultatEnvoiPublic } from '../src/api/envoi-public';
import { validateParamMapping } from '../src/crm/template';
import { cleIdempotence } from '../src/api/idempotence';

/**
 * LES OUTILS MCP DES SCÉNARIOS : `create_scenario`, `get_scenario`, `update_scenario`, `delete_scenario`. Ils appellent le
 * MÊME service que `/v1/scenarios` (`src/workflow/scenarios-api.ts`) et n'ont aucune logique à eux.
 */
const outil = (nom: string) => OUTILS.find((o) => o.nom === nom)!;
const MOI = { userId: 'u1', autorisationId: 'aut-1' };
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

/**
 * FAIRE PARTIR UN SCÉNARIO VERS UNE PERSONNE (plan `2026-11-03-outil-envoyer-scenario.md`) : le trou de l'essai réel du
 * 2026-11-02. Le même envoi que `send_template_to_contact` (`envoyerAUnePersonne`, `tests/mcp-serveur.test.ts`), cible
 * `scenario`.
 */
describe('send_scenario_to_contact', () => {
  const RAPPORT = { sendId: 'send-9', opening: 'whatsapp_template', recipientCount: 1, created: 0, matched: 1, skipped: [], skippedTotal: 0 };
  const ARGS = { scenario: 'scn_by5p57_01M6EJHTYPGD555ENTMES2CJGY', phone: '+33612345678', values: ['Julien'], idempotency_key: 'claude-scn-1' };

  function monterEnvoi(reponse: ResultatEnvoiPublic) {
    const corps: unknown[] = [];
    const deps = {
      couteux: { consommer: async () => ({ accepte: true, attenteMs: 0 }) },
      quotaEnvois: async () => ({ accepte: true }),
      envoyerModele: async (_t: string, c: unknown, compter: (n: number) => Promise<boolean>) => { corps.push(c); await compter(1); return reponse; },
    } as unknown as DepsMcp;
    return { deps, corps };
  }

  it('🔴 réservé à une PERSONNE, sous la fonction « scénarios » : une clé d’API ne le voit pas', () => {
    expect(outil('send_scenario_to_contact')).toMatchObject({ scope: 'mcp:write', exigePersonne: true, fonction: 'scenarios' });
    expect(outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null } as never).map((o) => o.nom)).not.toContain('send_scenario_to_contact');
    expect(outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: MOI } as never).map((o) => o.nom)).toContain('send_scenario_to_contact');
  });

  it('🔴 le corps construit est un corps de POST /v1/sends que ses propres règles acceptent : cible scénario, UNE personne', async () => {
    const { deps, corps } = monterEnvoi({ statut: 201, corps: RAPPORT });
    expect(await outil('send_scenario_to_contact').executer(deps, TENANT, ARGS, MOI)).toEqual({ send_id: 'send-9', contact_created: false });
    const lu = schemaCorps.safeParse(corps[0]);
    expect(lu.success).toBe(true);
    if (!lu.success) return;
    expect(cleIdempotence(undefined, lu.data)).toEqual({ ok: true, cle: 'claude-scn-1' });
    const params = validateParamMapping(lu.data.params ?? [], { accepterVariables: true });
    expect(params).toEqual([{ position: 1, source: { type: 'literal', value: 'Julien' } }]);
    // `utility` ne déclare rien : le chemin public prend la plus stricte de celle-ci et de celle du template chez Meta.
    expect(lireCible(lu.data, params!)).toEqual({ kind: 'scenario', ref: ARGS.scenario, category: 'utility' });
    // L'accord de la personne, déclaré par le client et signé de la personne connectée, comme pour un modèle.
    expect(lu.data.recipients).toEqual([{ phone: '+33612345678', consent: 'opted_in', consentSource: 'déclaré dans Claude par u1' }]);
    expect(schemaDestinataire.safeParse(lu.data.recipients[0]).success).toBe(true);
  });

  it('les refus du chemin public reviennent à Claude avec leur phrase et leur code ; un scénario sans nom n’appelle rien', async () => {
    const ouvert = monterEnvoi({ statut: 422, corps: { error: 'ce scénario ouvre par un message de session', code: 'unsendable_target' } });
    await expect(outil('send_scenario_to_contact').executer(ouvert.deps, TENANT, ARGS, MOI)).rejects.toThrow(/message de session.*unsendable_target/);
    const absent = monterEnvoi({ statut: 404, corps: { error: 'scénario introuvable', code: 'scenario_not_found' } });
    await expect(outil('send_scenario_to_contact').executer(absent.deps, TENANT, ARGS, MOI)).rejects.toThrow(/introuvable.*scenario_not_found/);
    const rien = monterEnvoi({ statut: 201, corps: RAPPORT });
    await expect(outil('send_scenario_to_contact').executer(rien.deps, TENANT, { ...ARGS, scenario: '  ' }, MOI)).rejects.toThrow(RefusOutil);
    await expect(outil('send_scenario_to_contact').executer(rien.deps, TENANT, { ...ARGS, values: ['a\nb'] }, MOI)).rejects.toThrow(/retour à la ligne/);
    expect(rien.corps).toHaveLength(0);
  });

  it('🔴 l’id que rend list_scenarios est traduit en code dans l’espace ; un id inconnu est refusé AVANT l’envoi', async () => {
    // Relecture du lot : le chemin public ne connaît que le code et le nom, l'id y était cherché comme un nom (404),
    // après avoir usé le plafond coûteux et le quota du jour.
    const ID = 'cfeb395f-0215-4d91-b373-9140b02ffbdd';
    const lus: string[] = [];
    const avecMagasin = (m: ReturnType<typeof monterEnvoi>) => ({
      ...m.deps,
      scenariosApi: { scenarios: { lireParApi: async (t: string, ref: string) => { lus.push(`${t}/${ref}`); return ref === ID ? { code: 'scn_trouve' } : null; } } },
    }) as unknown as DepsMcp;
    const ok = monterEnvoi({ statut: 201, corps: RAPPORT });
    await outil('send_scenario_to_contact').executer(avecMagasin(ok), TENANT, { ...ARGS, scenario: ID }, MOI);
    expect((ok.corps[0] as { target: unknown }).target).toEqual({ scenario: 'scn_trouve' });
    expect(lus).toEqual([`${TENANT}/${ID}`]);
    const inconnu = monterEnvoi({ statut: 201, corps: RAPPORT });
    await expect(outil('send_scenario_to_contact').executer(avecMagasin(inconnu), TENANT, { ...ARGS, scenario: ID.replace('c', 'd') }, MOI))
      .rejects.toThrow(/introuvable/);
    expect(inconnu.corps).toHaveLength(0);
  });

  it('🔴 les écritures de scénario citent ce nouvel outil pour le faire partir, plus send_template_to_contact', () => {
    for (const nom of ['create_scenario', 'update_scenario']) {
      expect(outil(nom).description, nom).toContain('send_scenario_to_contact');
      expect(outil(nom).description, nom).not.toContain('send_template_to_contact');
    }
  });
});
