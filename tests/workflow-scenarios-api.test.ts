import { describe, it, expect } from 'vitest';
import { creerScenario, lireScenario, remplacerScenario, supprimerScenario } from '../src/workflow/scenarios-api';
import type { WorkflowGraph } from '../src/workflow/graph';
import { AGENT, TENANT, depsScenarios as deps, recette, tpl } from './aide/scenarios-api';
import type { TemplateSummary } from '../src/meta/templates';

/**
 * LE SERVICE DE LA CRÉATION DE SCÉNARIOS : ce que la route REST et l'outil MCP appellent, et rien d'autre. Ses
 * dépendances sont simulées ; le SQL du magasin est prouvé en intégration (`tests/integration/workflow-scenarios-api`).
 */
describe('creerScenario', () => {
  it('compile, publie, et rend la recette relue, son empreinte et son ouverture', async () => {
    const { d, store, journal } = deps();
    const r = await creerScenario(d, TENANT, recette(), 'api');
    if (!r.ok) throw new Error(r.message);
    expect(r.valeur).toMatchObject({ nom: 'Relance', origine: 'api', ouverture: 'whatsapp_template' });
    expect(r.valeur.entreeCode).toMatch(/^nod_t1_/);
    expect(r.valeur.recette.entree).toMatchObject({ template: { nom: 'relance', variables: { 1: { champ: 'prenom' } } } });
    const graphe = store.creerPublieParApi.mock.calls[0]![2];
    expect(graphe.nodes.every((n) => typeof n.data.code === 'string')).toBe(true);
    expect(journal).toHaveBeenCalledWith(TENANT, 'workflow.published', r.valeur.id, expect.objectContaining({ origine: 'api' }), { userId: null, acces: null });
  });

  it('🔴 hors offre : 402, avant toute lecture chez Meta', async () => {
    const { d, templates, store } = deps({ offres: { offreDe: async () => ({ droits: { fonctions: new Set() } }) as never } });
    const r = await creerScenario(d, TENANT, recette(), 'api');
    expect(r).toMatchObject({ ok: false, statut: 402, code: 'plan_feature_unavailable' });
    expect(templates).not.toHaveBeenCalled();
    expect(store.creerPublieParApi).not.toHaveBeenCalled();
  });

  it('un template approuvé en fr et en revue en en : jugé par langue', async () => {
    const { d } = deps();
    const en = recette({ template: { nom: 'relance', langue: 'en' }, boutons: [{ texte: 'Yes', suite: { humain: {} } }, { texte: 'No', suite: { humain: {} } }] });
    expect(await creerScenario(d, TENANT, en, 'api')).toMatchObject({ ok: false, statut: 422, code: 'template_not_approved' });
    expect((await creerScenario(d, TENANT, recette(), 'api')).ok).toBe(true);
  });

  it('🔴 un template carrousel est refusé : ses réponses rapides vivent dans ses cartes, qu’une recette ne relie pas', async () => {
    const carrousel = { ...tpl('vitrine', 'fr', 'APPROVED'), isCarousel: true } as TemplateSummary;
    const { d } = deps({ templates: async () => [carrousel] });
    const r = await creerScenario(d, TENANT, recette({ template: { nom: 'vitrine', langue: 'fr' } }), 'api');
    expect(r).toMatchObject({ ok: false, statut: 422, code: 'unsendable_target' });
    expect(!r.ok && r.message).toMatch(/carrousel/);
  });

  it('🔴 la vérification des fichiers est bornée : une place de téléchargement par fichier, et un délai total', async () => {
    const deuxFichiers = recette({
      message: { texte: 'a', fichier: { url: 'https://exemple.fr/1.pdf' } },
      suite: { message: { texte: 'b', fichier: { url: 'https://exemple.fr/2.pdf' } } },
    });
    // Toutes les places de la copie prises : refus lisible, aucun téléchargement.
    let telecharges = 0;
    const plein = deps({ verifierFichier: async () => { telecharges += 1; return null; }, places: { prendre: () => null } });
    expect(await creerScenario(plein.d, TENANT, deuxFichiers, 'api')).toMatchObject({ ok: false, code: 'file_refused' });
    expect(telecharges).toBe(0);
    // Chaque place prise est rendue, même quand le fichier est refusé.
    let prises = 0;
    let rendues = 0;
    const places = { prendre: () => { prises += 1; return () => { rendues += 1; }; } };
    const refuse = deps({ verifierFichier: async () => 'HTTP 404', places });
    await creerScenario(refuse.d, TENANT, deuxFichiers, 'api');
    expect([prises, rendues]).toEqual([1, 1]);
    // Au-delà du délai total, le fichier suivant n'est plus vérifié : l'appel est refusé au lieu de traîner.
    let t = 0;
    const lent = deps({ maintenant: () => t, verifierFichier: async () => { t += 70_000; return null; } });
    const r = await creerScenario(lent.d, TENANT, deuxFichiers, 'api');
    expect(r).toMatchObject({ ok: false, code: 'file_refused' });
    expect(!r.ok && r.message).toMatch(/trop long/);
  });

  it('un fichier refusé : 422 `file_refused`, avec l’adresse et la raison', async () => {
    const { d, store } = deps({ verifierFichier: async () => 'le serveur du fichier a répondu HTTP 404' });
    const r = await creerScenario(d, TENANT, recette({ message: { texte: 'Bonjour', fichier: { url: 'https://exemple.fr/a.pdf' } } }), 'api');
    expect(r).toMatchObject({ ok: false, statut: 422, code: 'file_refused', details: { url: 'https://exemple.fr/a.pdf' } });
    expect(store.creerPublieParApi).not.toHaveBeenCalled();
  });

  it('ce que l’envoi refuserait est refusé à l’écriture : une entrée qui n’envoie rien', async () => {
    const { d } = deps();
    expect(await creerScenario(d, TENANT, recette({ humain: {} }), 'api')).toMatchObject({ ok: false, statut: 422, code: 'unsendable_target' });
  });

  it('un nom déjà pris : 409 avec l’id du scénario existant', async () => {
    const { d } = deps();
    const a = await creerScenario(d, TENANT, recette(), 'api');
    const b = await creerScenario(d, TENANT, { ...recette(), nom: ' relance ' }, 'api');
    expect(b).toMatchObject({ ok: false, statut: 409, code: 'scenario_name_taken', details: { id: a.ok && a.valeur.id } });
  });

  it('une recette mal formée : 400 avec le chemin', async () => {
    const { d } = deps();
    expect(await creerScenario(d, TENANT, { nom: 'x', entree: {} }, 'api')).toMatchObject({ ok: false, statut: 400, code: 'invalid_body', details: { chemin: 'entree' } });
  });
});

describe('remplacerScenario', () => {
  async function cree() {
    const x = deps();
    const r = await creerScenario(x.d, TENANT, recette(), 'api');
    if (!r.ok) throw new Error(r.message);
    return { ...x, vue: r.valeur };
  }
  const autre = recette({
    template: { nom: 'relance', langue: 'fr' },
    boutons: [{ texte: 'Oui', suite: { agent: { agent_id: AGENT } } }, { texte: 'Non', suite: { message: { texte: 'Dommage !' } } }],
  });

  it('sans empreinte : 428', async () => {
    const { d, vue } = await cree();
    expect(await remplacerScenario(d, TENANT, vue.id, autre, undefined, 'api')).toMatchObject({ ok: false, statut: 428, code: 'precondition_required' });
  });

  it('🔴 garde l’id du bloc où un contact attend, et publie la nouvelle version', async () => {
    const { d, store, vue } = await cree();
    const avant = store.lignes.get(vue.id)!.graph;
    const r = await remplacerScenario(d, TENANT, vue.id, autre, vue.empreinte, 'api');
    if (!r.ok) throw new Error(r.message);
    const apres = store.lignes.get(vue.id)!.graph;
    expect(apres.nodes[0]!.id).toBe(avant.nodes[0]!.id);
    expect(apres.nodes[0]!.data.code).toBe(avant.nodes[0]!.data.code);
    expect(apres.nodes.some((n) => n.data.body === 'Dommage !')).toBe(true);
    expect(r.valeur.empreinte).not.toBe(vue.empreinte);
  });

  it('une empreinte périmée : 409 `scenario_changed`', async () => {
    const { d, vue } = await cree();
    const r1 = await remplacerScenario(d, TENANT, vue.id, autre, vue.empreinte, 'api');
    expect(r1.ok).toBe(true);
    expect(await remplacerScenario(d, TENANT, vue.id, recette(), vue.empreinte, 'api')).toMatchObject({ ok: false, statut: 409, code: 'scenario_changed' });
  });

  it('un scénario de la console : 409, intouchable', async () => {
    const { d, store, vue } = await cree();
    store.lignes.set(vue.id, { ...store.lignes.get(vue.id)!, origine: 'console' });
    expect(await remplacerScenario(d, TENANT, vue.id, autre, vue.empreinte, 'api')).toMatchObject({ ok: false, statut: 409, code: 'scenario_managed_in_console' });
  });

  it('un brouillon de la console qui décrit autre chose : 409 ; un brouillon qui n’a bougé que des blocs : accepté', async () => {
    const { d, store, vue } = await cree();
    const l = store.lignes.get(vue.id)!;
    const deplace: WorkflowGraph = { ...l.graph, nodes: l.graph.nodes.map((n) => ({ ...n, position: { x: n.position.x + 50, y: n.position.y } })) };
    store.lignes.set(vue.id, { ...l, draftGraph: deplace });
    expect((await remplacerScenario(d, TENANT, vue.id, autre, vue.empreinte, 'api')).ok).toBe(true);
    const l2 = store.lignes.get(vue.id)!;
    const lu = await lireScenario(d, TENANT, vue.id);
    if (!lu.ok) throw new Error(lu.message);
    const change: WorkflowGraph = { ...l2.graph, nodes: l2.graph.nodes.map((n) => (n.data.body === 'Dommage !' ? { ...n, data: { ...n.data, body: 'Tant pis' } } : n)) };
    store.lignes.set(vue.id, { ...l2, draftGraph: change });
    expect(await remplacerScenario(d, TENANT, vue.id, recette(), lu.valeur.empreinte, 'api')).toMatchObject({ ok: false, statut: 409, code: 'scenario_changed' });
  });

  it('un scénario inconnu, ou d’un autre espace : 404', async () => {
    const { d, vue } = await cree();
    expect(await remplacerScenario(d, 'autre-espace', vue.id, autre, vue.empreinte, 'api')).toMatchObject({ ok: false, statut: 404, code: 'scenario_not_found' });
  });
});

describe('lireScenario et supprimerScenario', () => {
  it('lit par uuid ou par code scn_', async () => {
    const { d } = deps();
    const c = await creerScenario(d, TENANT, recette(), 'mcp');
    if (!c.ok) throw new Error(c.message);
    const parCode = await lireScenario(d, TENANT, c.valeur.code);
    expect(parCode.ok && parCode.valeur.empreinte).toBe(c.valeur.empreinte);
  });

  it('la suppression traduit chaque issue du magasin, et se journalise', async () => {
    const { d, store, journal } = deps();
    const c = await creerScenario(d, TENANT, recette(), 'api');
    if (!c.ok) throw new Error(c.message);
    expect(await supprimerScenario(d, TENANT, 'inconnu', 'api')).toMatchObject({ ok: false, statut: 404, code: 'scenario_not_found' });
    store.supprimerParApi.mockResolvedValueOnce({ utilise: ['l’automation « Bienvenue »'] } as never);
    const r = await supprimerScenario(d, TENANT, c.valeur.id, 'api');
    expect(r).toMatchObject({ ok: false, statut: 409, code: 'scenario_in_use' });
    expect(!r.ok && r.message).toContain('Bienvenue');
    store.supprimerParApi.mockResolvedValueOnce('console' as never);
    expect(await supprimerScenario(d, TENANT, c.valeur.id, 'api')).toMatchObject({ ok: false, statut: 409, code: 'scenario_managed_in_console' });
    expect(await supprimerScenario(d, TENANT, c.valeur.code, 'mcp', { userId: 'u1', acces: 'oauth:o1' })).toMatchObject({ ok: true });
    expect(store.supprimerParApi).toHaveBeenLastCalledWith(c.valeur.id, TENANT);
    expect(journal).toHaveBeenLastCalledWith(TENANT, 'workflow.deleted', c.valeur.id, { origine: 'mcp' }, { userId: 'u1', acces: 'oauth:o1' });
  });
});
