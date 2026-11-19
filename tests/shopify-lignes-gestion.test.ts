import { describe, it, expect, vi } from 'vitest';
import {
  assurerLigne, brancherLePremierBloc, etatDesLignes, grapheDUneLigne, NOM_DU_SCENARIO, reglerLigne, reglerPause,
} from '../src/shopify/lignes-gestion';
import { MARQUE_PREMIER_BLOC, blocVerrouille } from '../src/shopify/premier-bloc';
import type { WorkflowGraph } from '../src/workflow/graph';
import { DOMAINE, modeleMeta, monterLignes, VUE_LIGNES as VUE } from './shopify-lignes-faux';

/**
 * LES LIGNES SHOPIFY, CÔTÉ GESTION (menu « Scénario », lot 5, tâche 8) : la ligne et son scénario d'un bloc verrouillé,
 * l'interrupteur, la pause, le template du premier bloc posé par `set_shopify_message`, et l'état que lisent la console et
 * `get_shopify_state`. Des CLASSES dont les méthodes lisent `this`, comme les vrais magasins, passés entiers.
 */

const T = 't1';

const monter = monterLignes;
const modele = modeleMeta;

describe('la ligne et son scénario', () => {
  it('🔴 la première fois : un scénario du rayon shopify, nommé par l’événement, PUBLIÉ avec son seul bloc verrouillé, et la ligne ÉTEINTE', async () => {
    const m = monter();
    const l = await assurerLigne(m.deps, T, 'order_paid', 'u1');
    expect(l).toMatchObject({ evenement: 'order_paid', actif: false });
    const wf = await m.workflows.getById(l.workflowId, T);
    expect(wf).toMatchObject({ name: NOM_DU_SCENARIO.order_paid, rayon: 'shopify' });
    expect(blocVerrouille(wf!.graph)?.data).toEqual({ [MARQUE_PREMIER_BLOC]: true });
    expect(wf!.draftGraph).toBeNull();
    // La seconde fois : la même ligne, aucun second scénario.
    expect((await assurerLigne(m.deps, T, 'order_paid', 'u1')).workflowId).toBe(l.workflowId);
    expect(m.workflows.parId.size).toBe(1);
  });

  it('le graphe d’une ligne neuve : un seul bloc template, marqué, sans template ni flèche', () => {
    const g = grapheDUneLigne();
    expect(g.edges).toEqual([]);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]).toMatchObject({ type: 'template', data: { [MARQUE_PREMIER_BLOC]: true } });
  });
});

describe('l’interrupteur d’une ligne et la pause', () => {
  it('🔴 allumer crée la ligne si elle manque ; éteindre arrête les parcours de CETTE ligne, par son préfixe', async () => {
    const m = monter();
    expect(await reglerLigne(m.deps, T, 'checkout_abandoned', { actif: true, delaiMinutes: 30 }, 'u1')).toMatchObject({ ok: true });
    expect(m.store.gestes).toEqual(['allumer:checkout_abandoned', 'delai:30']);
    expect(await reglerLigne(m.deps, T, 'checkout_abandoned', { actif: false }, 'u1')).toMatchObject({ ok: true });
    expect(m.parcours.arrets).toEqual([{ prefixe: `shopify:${DOMAINE}:checkouts/abandoned:`, motif: 'ligne éteinte' }]);
  });

  it('🔴 éteindre une automation sans ligne : rien à éteindre, rien de créé ; un arrêt en panne n’empêche pas l’extinction', async () => {
    const m = monter({ arretLeve: true });
    // Une automation qui n'a jamais été allumée est éteinte : le geste réussit, sans rien créer (un numéro relié par QR
    // code, qui ne peut rien allumer, l'arrête sans erreur).
    expect(await reglerLigne(m.deps, T, 'order_paid', { actif: false }, 'u1')).toEqual({ ok: true, valeur: null });
    expect(m.workflows.parId.size, 'éteindre ne crée rien').toBe(0);
    await reglerLigne(m.deps, T, 'order_paid', { actif: true }, 'u1');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await reglerLigne(m.deps, T, 'order_paid', { actif: false }, 'u1')).toMatchObject({ ok: true });
    expect((await m.store.ligne(T, 'order_paid'))?.actif).toBe(false);
    vi.restoreAllMocks();
  });

  it('le délai se règle sur la ligne du panier seulement ; sans boutique, ou coupée, rien ne se règle', async () => {
    const m = monter();
    expect(await reglerLigne(m.deps, T, 'order_paid', { actif: true, delaiMinutes: 30 }, 'u1')).toMatchObject({ ok: false, statut: 400 });
    expect(await reglerLigne(monter({ vue: null }).deps, T, 'order_paid', { actif: true }, 'u1')).toMatchObject({ ok: false, statut: 409 });
    expect(await reglerLigne(monter({ vue: { ...VUE, etat: 'coupee' } }).deps, T, 'order_paid', { actif: true }, 'u1')).toMatchObject({ ok: false, statut: 409 });
  });

  it('🔴 la pause arrête les parcours de TOUTE la boutique ; la reprise n’arrête rien ; chacune ne vaut qu’une fois', async () => {
    const m = monter();
    expect(await reglerPause(m.deps, T, true)).toEqual({ ok: true, valeur: { changee: true } });
    expect(m.parcours.arrets).toEqual([{ prefixe: `shopify:${DOMAINE}:`, motif: 'boutique en pause' }]);
    expect(await reglerPause(m.deps, T, true)).toEqual({ ok: true, valeur: { changee: false } });
    expect(await reglerPause(m.deps, T, false)).toEqual({ ok: true, valeur: { changee: true } });
    expect(m.parcours.arrets).toHaveLength(1);
  });
});

describe('le template du premier bloc (set_shopify_message)', () => {
  it('🔴 pose le template, sa langue, ses réponses rapides et ses données dans le bloc verrouillé, puis publie', async () => {
    const m = monter();
    const r = await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: ['first_name', 'order_number'] }, 'u1');
    expect(r).toMatchObject({ ok: true });
    const l = await m.store.ligne(T, 'order_paid');
    const bloc = blocVerrouille((await m.workflows.getById(l!.workflowId, T))!.graph);
    expect(bloc?.data).toEqual({
      [MARQUE_PREMIER_BLOC]: true, templateName: 'commande_payee', language: 'fr', templateButtons: [{ type: 'QUICK_REPLY', text: 'Suivre' }],
      variables: [{ position: 1, source: { type: 'variable', key: 'first_name' } }, { position: 2, source: { type: 'variable', key: 'order_number' } }],
    });
  });

  it('🔴 la suite du scénario est gardée ; changer les réponses rapides d’où part une flèche est refusé', async () => {
    const m = monter();
    await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: [] }, 'u1');
    const l = (await m.store.ligne(T, 'order_paid'))!;
    const wf = (await m.workflows.getById(l.workflowId, T))!;
    const suite: WorkflowGraph = {
      nodes: [...wf.graph.nodes, { id: 'merci', type: 'quick_message', position: { x: 0, y: 1 }, data: { body: 'Merci' } }],
      edges: [{ id: 'e1', source: 'depart', target: 'merci', sourceHandle: 'btn:0' }],
    };
    await m.workflows.publish(l.workflowId, T, suite);
    // Le même bouton : la suite reste.
    expect(await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: [] }, 'u1')).toMatchObject({ ok: true });
    expect((await m.workflows.getById(l.workflowId, T))!.graph.edges).toEqual(suite.edges);
    // Un autre template sans ce bouton : refusé, rien n'est publié.
    const m2 = monter({ modeles: [modele({ name: 'autre', buttons: [] })] });
    m2.store.lignesEnBase = m.store.lignesEnBase;
    m2.workflows.parId = m.workflows.parId;
    const avant = m2.workflows.publications.length;
    expect(await brancherLePremierBloc(m2.deps, T, { evenement: 'order_paid', modele: 'autre', langue: 'fr', variables: [] }, 'u1')).toMatchObject({ ok: false, statut: 409 });
    expect(m2.workflows.publications).toHaveLength(avant);
  });

  it('🔴 une version programmée du scénario (en attente de Meta) est annulée par cette publication, et le geste le dit', async () => {
    const m = monter();
    const premier = await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: [] }, 'u1');
    expect(premier).toMatchObject({ ok: true, valeur: { programmationAnnulee: false, ligne: { evenement: 'order_paid' } } });
    const l = (await m.store.ligne(T, 'order_paid'))!;
    m.workflows.programmees.set(l.workflowId, { graphe: { nodes: [], edges: [] }, le: '2026-11-19T10:00:00.000Z', par: 'u2' });
    expect(await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: [] }, 'u1'))
      .toMatchObject({ ok: true, valeur: { programmationAnnulee: true } });
    expect(m.workflows.programmees.size).toBe(0);
  });

  it('un template absent chez Meta est refusé, sans rien créer', async () => {
    const m = monter({ modeles: [] });
    expect(await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'inconnu', langue: 'fr', variables: [] }, 'u1')).toMatchObject({ ok: false, statut: 422 });
    expect(m.workflows.parId.size).toBe(0);
  });

  it('🔴 le brouillon en cours reçoit le même premier bloc : le builder ne remettrait pas l’ancien template en ligne', async () => {
    const m = monter();
    await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: [] }, 'u1');
    const l = (await m.store.ligne(T, 'order_paid'))!;
    const wf = (await m.workflows.getById(l.workflowId, T))!;
    m.workflows.parId.set(l.workflowId, { ...wf, draftGraph: { ...wf.graph, nodes: wf.graph.nodes.map((n) => ({ ...n, position: { x: 5, y: 5 } })) } });
    await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: ['first_name'] }, 'u1');
    const brouillon = (await m.workflows.getById(l.workflowId, T))!.draftGraph!;
    expect(blocVerrouille(brouillon)?.data).toMatchObject({ variables: [{ position: 1, source: { type: 'variable', key: 'first_name' } }] });
    expect(blocVerrouille(brouillon)?.position).toEqual({ x: 5, y: 5 });
  });
});

describe('l’état des lignes', () => {
  it('chaque ligne : allumée, son scénario, son premier template et son état chez Meta, le nombre de blocs', async () => {
    const m = monter({ modeles: [modele({ status: 'PENDING' })] });
    await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: [] }, 'u1');
    await reglerLigne(m.deps, T, 'order_paid', { actif: true }, 'u1');
    await assurerLigne(m.deps, T, 'checkout_abandoned', 'u1');
    expect(await etatDesLignes(m.deps, T)).toEqual([
      expect.objectContaining({ evenement: 'order_paid', actif: true, scenario: NOM_DU_SCENARIO.order_paid, modele: 'commande_payee', langue: 'fr', etatChezMeta: 'PENDING', blocs: 1 }),
      expect.objectContaining({ evenement: 'checkout_abandoned', actif: false, modele: null, etatChezMeta: null, blocs: 1 }),
    ]);
  });
});
