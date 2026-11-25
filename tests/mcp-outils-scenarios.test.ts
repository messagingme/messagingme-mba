import { describe, it, expect, vi } from 'vitest';
import { OUTILS, outilsPour, RefusOutil, type DepsMcp } from '../src/mcp/outils';
import { creerScenario, type VueScenario } from '../src/workflow/scenarios-api';
import {
  BOUTON_MENU_MAX, DESCRIPTION_LIGNE_MAX, ECHEANCE_MAX_JOURS, ETIQUETTE_MAX, LIGNES_MENU_MAX, LISTE_OPERATION_MAX,
  LONGUEUR_CHAMP_MAX, LONGUEUR_URL_FICHIER_MAX, MAX_BOUTONS_TEMPLATE, MAX_FICHIERS_RECETTE, MAX_TEXTE_BOUTON_TEMPLATE, NOM_SCENARIO_MAX,
  OPERATIONS_MAX, PROFONDEUR_MAX_RECETTE, TEXTE_QUESTION_MAX, TITRE_LIGNE_MAX, UNITES_ECHEANCE, VALEUR_CHAMP_RECETTE_MAX,
} from '../src/workflow/recette';
import { MAX_NODES } from '../src/workflow/graph';
import { SORTIE_MAX } from '../src/workflow/simulation';
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
      // La Question et l'Action (CSM, B5).
      TEXTE_QUESTION_MAX, BOUTON_MENU_MAX, TITRE_LIGNE_MAX, DESCRIPTION_LIGNE_MAX, LIGNES_MENU_MAX, ECHEANCE_MAX_JOURS, OPERATIONS_MAX,
      ETIQUETTE_MAX, VALEUR_CHAMP_RECETTE_MAX, LISTE_OPERATION_MAX,
    ]) expect(annonce, String(borne)).toMatch(new RegExp(`(^|[^0-9])${borne}([^0-9]|$)`));
    for (const mot of [
      'https', 'template', 'message', 'agent', 'humain', 'boutons', 'reponses', 'autre_reponse', 'suite', 'fichier',
      'question', 'champ', 'menu', 'titre', 'description', 'bouton', 'ranger_choix', 'sans_reponse_apres', 'sans_reponse', 'valeur',
      ...UNITES_ECHEANCE, 'action', 'etiquette', 'retirer_etiquettes', 'vider_champs',
    ]) {
      expect(annonce, mot).toContain(mot);
    }
    // update_scenario annonce la même recette.
    expect(JSON.stringify(outil('update_scenario').entree.properties.entree)).toBe(JSON.stringify(outil('create_scenario').entree.properties.entree));
  });
});

/**
 * LE BROUILLON (lot 1 du CSM virtuel, B4) : `brouillon: true` n'écrit que la version de travail, que la mise en ligne d'un
 * admin publie (`propose_go_live`). Sans le paramètre, rien ne change : l'écriture publie. Le service est prouvé dans
 * `tests/workflow-scenarios-api.test.ts` ; ici, ce que les outils en font : le paramètre lu, retiré de la recette, refusé
 * s'il n'est pas un booléen, et annoncé.
 */
describe('le paramètre brouillon des outils (CSM, B4)', () => {
  const autre = () => recette({
    template: { nom: 'relance', langue: 'fr' },
    boutons: [{ texte: 'Oui', suite: { humain: {} } }, { texte: 'Non', suite: { humain: {} } }],
  });

  it('🔴 create_scenario avec brouillon : rien de publié ni au journal, la recette lue SANS le paramètre', async () => {
    const { deps, store, journal } = monter();
    const vue = await outil('create_scenario').executer(deps, TENANT, { ...recette(), brouillon: true }, MOI) as VueScenario;
    expect(store.creerPublieParApi).not.toHaveBeenCalled();
    expect(store.creerBrouillonParApi).toHaveBeenCalledTimes(1);
    expect(journal).not.toHaveBeenCalled();
    expect(vue).toMatchObject({ publie: false, recette: null, empreinte: null, brouillonNonDecrit: false });
    expect(vue.brouillon?.recette.nom).toBe('Relance');
    expect(store.lignes.get(vue.id)!.graph.nodes).toEqual([]);
  });

  it('sans le paramètre, ou à false, l’écriture publie comme avant', async () => {
    for (const args of [recette(), { ...recette(), brouillon: false }, { ...recette(), brouillon: null }]) {
      const { deps, store } = monter();
      const vue = await outil('create_scenario').executer(deps, TENANT, args, MOI) as VueScenario;
      expect(store.creerPublieParApi).toHaveBeenCalledTimes(1);
      expect(store.creerBrouillonParApi).not.toHaveBeenCalled();
      expect(vue).toMatchObject({ publie: true, brouillon: null });
    }
  });

  it('🔴 update_scenario avec brouillon : le publié ne bouge pas, get_scenario rend le brouillon, son empreinte prend le relais', async () => {
    const { deps, store } = monter();
    const cree = await outil('create_scenario').executer(deps, TENANT, recette(), MOI) as VueScenario;
    const publie = store.lignes.get(cree.id)!.graph;
    const un = await outil('update_scenario').executer(deps, TENANT, { scenario: cree.id, ...autre(), empreinte: cree.empreinte, brouillon: true }, MOI) as VueScenario;
    expect(store.remplacerPublieParApi).not.toHaveBeenCalled();
    expect(store.lignes.get(cree.id)!.graph).toBe(publie);
    expect(un).toMatchObject({ publie: true, empreinte: cree.empreinte });
    const lu = await outil('get_scenario').executer(deps, TENANT, { scenario: cree.code }, null) as VueScenario;
    expect(lu.brouillon?.empreinte).toBe(un.brouillon?.empreinte);
    // L'empreinte du publié ne vaut plus une fois le brouillon posé : la recette a changé depuis cette lecture.
    await expect(outil('update_scenario').executer(deps, TENANT, { scenario: cree.id, ...recette(), empreinte: cree.empreinte, brouillon: true }, MOI))
      .rejects.toMatchObject({ precisions: { cause: 'scenario_changed' } });
    await outil('update_scenario').executer(deps, TENANT, { scenario: cree.id, ...recette(), empreinte: un.brouillon!.empreinte, brouillon: true }, MOI);
  });

  it('🔴 un brouillon qui n’est pas un booléen est refusé avant toute écriture', async () => {
    const { deps, store } = monter();
    const cree = await outil('create_scenario').executer(deps, TENANT, recette(), MOI) as VueScenario;
    store.creerPublieParApi.mockClear();
    for (const brouillon of ['true', 1, 'oui', {}]) {
      await expect(outil('create_scenario').executer(deps, TENANT, { ...autre(), nom: 'Autre', brouillon }, MOI))
        .rejects.toMatchObject({ code: 'invalid_args', message: expect.stringContaining('brouillon') });
      await expect(outil('update_scenario').executer(deps, TENANT, { scenario: cree.id, ...autre(), empreinte: cree.empreinte, brouillon }, MOI))
        .rejects.toMatchObject({ code: 'invalid_args' });
    }
    expect(store.creerPublieParApi).not.toHaveBeenCalled();
    expect(store.creerBrouillonParApi).not.toHaveBeenCalled();
    expect(store.remplacerPublieParApi).not.toHaveBeenCalled();
    expect(store.remplacerBrouillonParApi).not.toHaveBeenCalled();
  });

  it('les deux écritures annoncent brouillon et disent comment publier, plus que toute écriture publie', () => {
    for (const nom of ['create_scenario', 'update_scenario']) {
      const o = outil(nom);
      expect(o.entree.properties.brouillon, nom).toMatchObject({ type: 'boolean' });
      expect(o.entree.required ?? [], nom).not.toContain('brouillon');
      expect(o.description, nom).toContain('propose_go_live');
      expect(o.description, nom).not.toMatch(/there is no draft/i);
    }
    expect(outil('get_scenario').description).toContain('brouillon');
  });
});

/**
 * LA SIMULATION (lot 1 du CSM virtuel, B6) : `simulate_scenario` joue un scénario pour un contact fictif. La simulation
 * elle-même et sa parité avec l'exécuteur sont prouvées dans `tests/workflow-simulation.test.ts` ; ici, ce que l'outil
 * en fait : la version jouée, les refus, les bornes annoncées, et rien d'écrit.
 */
describe('simulate_scenario (CSM, B6)', () => {
  const qualification = () => ({
    nom: 'Qualification',
    entree: {
      message: { texte: 'Un choix ?' },
      reponses: [{ texte: 'Oui', suite: { action: [{ etiquette: 'oui' }], suite: { humain: {} } } }, { texte: 'Non', suite: { message: { texte: 'Dommage.' } } }],
    },
  });

  it('🔴 une lecture, sous la fonction « scénarios » : une clé d’API la voit, et rien n’est écrit', async () => {
    expect(outil('simulate_scenario')).toMatchObject({ scope: 'mcp:read', fonction: 'scenarios' });
    expect(outilsPour({ scopes: ['mcp:read'], personne: null } as never).map((o) => o.nom)).toContain('simulate_scenario');
    const { deps, store } = monter();
    const cree = await outil('create_scenario').executer(deps, TENANT, { ...qualification(), brouillon: true }, MOI) as VueScenario;
    const ecritures = [store.creerPublieParApi, store.remplacerPublieParApi, store.creerBrouillonParApi, store.remplacerBrouillonParApi, store.supprimerParApi]
      .map((f) => f.mock.calls.length);
    const r = await outil('simulate_scenario').executer(deps, TENANT, { scenario: cree.id, reponses: [{ choix: 'Oui' }] }, null) as Record<string, unknown>;
    expect(r).toMatchObject({ scenario: cree.id, version: 'brouillon', fin: { etat: 'equipe' } });
    expect([store.creerPublieParApi, store.remplacerPublieParApi, store.creerBrouillonParApi, store.remplacerBrouillonParApi, store.supprimerParApi]
      .map((f) => f.mock.calls.length)).toEqual(ecritures);
  });

  it('joue le brouillon par défaut, la version publiée sur demande, et refuse celle qui n’existe pas', async () => {
    const { deps } = monter();
    const brouillon = await outil('create_scenario').executer(deps, TENANT, { ...qualification(), brouillon: true }, MOI) as VueScenario;
    await expect(outil('simulate_scenario').executer(deps, TENANT, { scenario: brouillon.id, version: 'publie', reponses: [] }, null))
      .rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('pas de version publiée') });
    const publie = await outil('create_scenario').executer(deps, TENANT, { ...qualification(), nom: 'Publié' }, MOI) as VueScenario;
    expect(await outil('simulate_scenario').executer(deps, TENANT, { scenario: publie.code, reponses: [{ choix: 'Non' }] }, null))
      .toMatchObject({ version: 'publie', fin: { etat: 'termine' } });
    await expect(outil('simulate_scenario').executer(deps, TENANT, { scenario: publie.id, version: 'brouillon', reponses: [] }, null))
      .rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('pas de brouillon') });
    await expect(outil('simulate_scenario').executer(deps, TENANT, { scenario: '00000000-0000-4000-8000-0000000000ff', reponses: [] }, null))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('🔴 sans version, le brouillon en attente est joué, pas la version publiée', async () => {
    const { deps } = monter();
    const cree = await outil('create_scenario').executer(deps, TENANT, qualification(), MOI) as VueScenario;
    // Le brouillon change la suite de « Oui » : un message, puis la fin, au lieu de l'équipe.
    const entree = { message: { texte: 'Un choix ?' }, reponses: [{ texte: 'Oui', suite: { message: { texte: 'Merci.' } } }, { texte: 'Non', suite: { message: { texte: 'Dommage.' } } }] };
    await outil('update_scenario').executer(deps, TENANT, { scenario: cree.id, nom: 'Qualification', entree, empreinte: cree.empreinte, brouillon: true }, MOI);
    expect(await outil('simulate_scenario').executer(deps, TENANT, { scenario: cree.id, reponses: [{ choix: 'Oui' }] }, null))
      .toMatchObject({ version: 'brouillon', fin: { etat: 'termine' } });
    expect(await outil('simulate_scenario').executer(deps, TENANT, { scenario: cree.id, version: 'publie', reponses: [{ choix: 'Oui' }] }, null))
      .toMatchObject({ version: 'publie', fin: { etat: 'equipe' } });
  });

  it('refuse une réponse mal formée, en disant laquelle, et borne la liste', async () => {
    const { deps } = monter();
    const cree = await outil('create_scenario').executer(deps, TENANT, qualification(), MOI) as VueScenario;
    const simuler = (reponses: unknown, contact?: unknown) => outil('simulate_scenario').executer(deps, TENANT, { scenario: cree.id, reponses, ...(contact === undefined ? {} : { contact }) }, null);
    await expect(simuler([{ choix: 'Oui', texte: 'x' }])).rejects.toMatchObject({ code: 'invalid_args', message: expect.stringContaining('reponses[0]') });
    await expect(simuler([{ choix: 'Oui' }, { sans_reponse: false }])).rejects.toMatchObject({ code: 'invalid_args', message: expect.stringContaining('reponses[1]') });
    await expect(simuler(Array.from({ length: 21 }, () => ({ texte: 'x' })))).rejects.toMatchObject({ code: 'invalid_args' });
    await expect(simuler([], { champs: { ville: 3 } })).rejects.toMatchObject({ code: 'invalid_args', message: expect.stringContaining('contact.champs.ville') });
    await expect(simuler([], { autre: 1 })).rejects.toMatchObject({ code: 'invalid_args' });
    // Une réponse trop longue dit sa borne, au lieu de « exactement un de… ».
    await expect(simuler([{ choix: 'x'.repeat(201) }])).rejects.toMatchObject({ code: 'invalid_args', message: expect.stringMatching(/reponses\[0\]\.choix.*200/) });
    await expect(simuler([{ texte: 'x'.repeat(4097) }])).rejects.toMatchObject({ code: 'invalid_args', message: expect.stringMatching(/reponses\[0\]\.texte.*4096/) });
    // 🔴 Une valeur de la fiche fictive est bornée comme sur une fiche : sans borne, des extractions la recopiaient sans
    // fin et figeaient la copie de l'API (relecture du lot F).
    await expect(simuler([], { champs: { ville: 'x'.repeat(VALEUR_CHAMP_RECETTE_MAX + 1) } }))
      .rejects.toMatchObject({ code: 'invalid_args', message: expect.stringMatching(new RegExp(`contact\\.champs\\.ville.*${VALEUR_CHAMP_RECETTE_MAX}`)) });
    expect(await simuler([{ choix: 'Oui' }], { champs: { ville: 'x'.repeat(VALEUR_CHAMP_RECETTE_MAX) } })).toMatchObject({ fin: { etat: 'equipe' } });
    await expect(simuler([], { champs: { ['k'.repeat(LONGUEUR_CHAMP_MAX + 1)]: 'x' } })).rejects.toMatchObject({ code: 'invalid_args' });
    await expect(simuler([], { etiquettes: ['x'.repeat(ETIQUETTE_MAX + 1)] })).rejects.toMatchObject({ code: 'invalid_args' });
    expect(await simuler([{ choix: 'Oui' }], { champs: { ville: 'Paris' }, etiquettes: ['vip'] })).toMatchObject({ fin: { etat: 'equipe' } });
  });

  it('🔴 la description annonce ses bornes et ses formes de réponse', () => {
    const annonce = JSON.stringify([outil('simulate_scenario').entree, outil('simulate_scenario').description]);
    for (const borne of [20, 50, 200, 4096, VALEUR_CHAMP_RECETTE_MAX, ETIQUETTE_MAX, LONGUEUR_CHAMP_MAX, SORTIE_MAX]) {
      expect(annonce, String(borne)).toMatch(new RegExp(`(^|[^0-9])${borne}([^0-9]|$)`));
    }
    for (const mot of ['choix', 'texte', 'sans_reponse', 'brouillon', 'publie', 'propose_go_live', '24 hours']) expect(annonce, mot).toContain(mot);
  });
});

/**
 * LE LIEN DE TEST, LE DÉROULÉ D'UN CONTACT ET LES JOURNAUX D'ERREURS (lot 1 du CSM virtuel, B6b). Le déroulé en base
 * est prouvé par `tests/integration/deroule.integration.test.ts` ; ici, ce que les outils en font.
 */
describe('le lien de test, le déroulé et les journaux d’erreurs (CSM, B6b)', () => {
  function monterDeroule(numero: string | null = '+33 7 00 00 00 00') {
    const m = monter();
    const jetons = new Map<string, string>();
    // Le jeton par scénario ET par espace, comme le magasin : un autre espace n'a pas ce scénario.
    const liensDeTest = {
      ensureTestToken: vi.fn(async (id: string, t: string, token: string) => {
        if (t !== TENANT) return null;
        if (!jetons.has(id)) jetons.set(id, token);
        return jetons.get(id)!;
      }),
    };
    const deroule = { lire: vi.fn(async () => ({ parcours: [] as unknown[], passages: [] as unknown[] })) };
    const erreurs = {
      // Le journal cherche par morceau de numéro : le second numéro, plus long, contient celui du contact.
      lister: vi.fn(async () => [{ code: 131026, telephone: '+33612345678' }, { code: 131049, telephone: '336123456789' }]),
      listerEchecsSysteme: vi.fn(async () => [{ id: 'e1', nom: 'CRM' }]),
    };
    const contacts = { findByPhone: vi.fn(async (_t: string, phone: string) => (phone === '+33612345678' ? { id: 'c1', phoneE164: phone, bsuid: null } : null)) };
    const deps = { ...(m.deps as object), liensDeTest, deroule, erreurs, contacts, numeroAffiche: async () => numero } as unknown as DepsMcp;
    return { ...m, deps, liensDeTest, deroule, erreurs, contacts };
  }
  const qualification = () => ({ nom: 'Qualification', entree: { message: { texte: 'Un choix ?' }, reponses: [{ texte: 'Oui', suite: { humain: {} } }] } });

  it('🔴 des lectures ; le lien de test au nom d’une personne, les journaux dans toutes les offres', () => {
    expect(outil('get_scenario_test_link')).toMatchObject({ scope: 'mcp:read', exigePersonne: true, fonction: 'scenarios' });
    expect(outil('get_contact_journey')).toMatchObject({ scope: 'mcp:read', fonction: 'scenarios' });
    for (const nom of ['list_delivery_errors', 'list_system_errors']) expect(outil(nom), nom).toMatchObject({ scope: 'mcp:read', fonction: null });
    const parCle = outilsPour({ scopes: ['mcp:read'], personne: null } as never).map((o) => o.nom);
    expect(parCle).not.toContain('get_scenario_test_link');
    for (const nom of ['get_contact_journey', 'list_delivery_errors', 'list_system_errors']) expect(parCle).toContain(nom);
  });

  it('le lien de test : le mot de la console, le même à chaque appel, le numéro de Meta, et pas de lien sans numéro', async () => {
    const { deps, liensDeTest } = monterDeroule();
    const cree = await outil('create_scenario').executer(deps, TENANT, { ...qualification(), brouillon: true }, MOI) as VueScenario;
    const un = await outil('get_scenario_test_link').executer(deps, TENANT, { scenario: cree.id }, MOI) as { mot: string; lien: string; numero: string };
    expect(liensDeTest.ensureTestToken).toHaveBeenCalledWith(cree.id, TENANT, expect.any(String));
    expect(un).toMatchObject({ scenario: cree.id, numero: '+33 7 00 00 00 00' });
    expect(un.lien).toBe(`https://wa.me/33700000000?text=${un.mot}`);
    expect(await outil('get_scenario_test_link').executer(deps, TENANT, { scenario: cree.code }, MOI)).toMatchObject({ mot: un.mot });
    // Le magasin ne rend pas de jeton (le scénario a disparu entre la lecture et l'écriture) : introuvable, pas un lien vide.
    liensDeTest.ensureTestToken.mockResolvedValueOnce(null);
    await expect(outil('get_scenario_test_link').executer(deps, TENANT, { scenario: cree.id }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    const sansNumero = monterDeroule(null);
    const autre = await outil('create_scenario').executer(sansNumero.deps, TENANT, qualification(), MOI) as VueScenario;
    expect(await outil('get_scenario_test_link').executer(sansNumero.deps, TENANT, { scenario: autre.id }, MOI)).toMatchObject({ lien: null, numero: null });
    await expect(outil('get_scenario_test_link').executer(deps, TENANT, { scenario: '00000000-0000-4000-8000-0000000000ff' }, MOI))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('le déroulé : les blocs nommés par le scénario, le numéro du contact, ses dernières erreurs', async () => {
    const { deps, deroule, erreurs, store } = monterDeroule();
    const cree = await outil('create_scenario').executer(deps, TENANT, qualification(), MOI) as VueScenario;
    const bloc = store.lignes.get(cree.id)!.graph.nodes[0]!;
    deroule.lire.mockResolvedValueOnce({
      parcours: [{ id: 'r1', statut: 'waiting', bloc: bloc.id, reprise: null, debut: '2026-11-25T10:00:00.000Z', maj: '2026-11-25T10:00:00.000Z' }],
      passages: [{ bloc: bloc.id, quoi: 'sent', sortie: null, le: '2026-11-25T10:00:01.000Z' }, { bloc: 'disparu', quoi: 'read', sortie: null, le: '2026-11-25T10:00:02.000Z' }],
    });
    const r = await outil('get_contact_journey').executer(deps, TENANT, { scenario: cree.id, phone: '06 12 34 56 78' }, null) as Record<string, unknown>;
    expect(deroule.lire).toHaveBeenCalledWith(TENANT, cree.id, '33612345678');
    expect(erreurs.lister).toHaveBeenCalledWith(TENANT, { telephone: '33612345678', limit: 10 });
    expect(r).toMatchObject({
      contact: { id: 'c1', phone: '+33612345678' }, scenario: { id: cree.id, nom: 'Qualification' },
      parcours: [{ statut: 'waiting', bloc: { id: bloc.id, type: bloc.type } }],
      passages: [{ quoi: 'sent', bloc: { id: bloc.id, type: bloc.type } }, { quoi: 'read', bloc: { id: 'disparu' } }],
      erreurs_de_livraison: [{ code: 131026 }],
    });
    // Le numéro plus long qui contient celui du contact n'est pas ce contact.
    expect((r.erreurs_de_livraison as unknown[]).length).toBe(1);
    await expect(outil('get_contact_journey').executer(deps, TENANT, { scenario: cree.id, phone: '+33699999999' }, null)).rejects.toMatchObject({ code: 'not_found' });
    await expect(outil('get_contact_journey').executer(deps, TENANT, { scenario: cree.id, phone: 'abc' }, null)).rejects.toMatchObject({ code: 'invalid_args' });
  });

  it('les journaux d’erreurs : les filtres de la console, bornés, et refusés au-delà', async () => {
    const { deps, erreurs } = monterDeroule();
    await outil('list_delivery_errors').executer(deps, TENANT, { q: ' relance ', telephone: '336', code: 131026, limit: 500 }, null);
    expect(erreurs.lister).toHaveBeenLastCalledWith(TENANT, { limit: 100, q: 'relance', telephone: '336', code: 131026 });
    await outil('list_delivery_errors').executer(deps, TENANT, {}, null);
    expect(erreurs.lister).toHaveBeenLastCalledWith(TENANT, { limit: 50 });
    await expect(outil('list_delivery_errors').executer(deps, TENANT, { q: 'x'.repeat(121) }, null)).rejects.toMatchObject({ code: 'invalid_args', message: expect.stringContaining('120') });
    await expect(outil('list_delivery_errors').executer(deps, TENANT, { code: '131026' }, null)).rejects.toMatchObject({ code: 'invalid_args' });
    expect(await outil('list_system_errors').executer(deps, TENANT, {}, null)).toEqual({ erreurs: [{ id: 'e1', nom: 'CRM' }] });
    expect(erreurs.listerEchecsSysteme).toHaveBeenLastCalledWith(TENANT, 50);
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
