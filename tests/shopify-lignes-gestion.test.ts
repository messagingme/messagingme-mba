import { describe, it, expect, vi } from 'vitest';
import {
  assurerLigne, brancherLePremierBloc, etatDesLignes, grapheDUneLigne, NOM_DU_SCENARIO, PHRASE_ATTESTATION_REQUISE, PHRASE_SHOPIFY_QR_CODE,
  proposerMessageStandard, reglerAttestation, reglerLigne, reglerPause,
} from '../src/shopify/lignes-gestion';
import { TEXTE_ATTESTATION_SHOPIFY } from '../web/lib/partage/shopify-messages';
import { corpsStandard } from '../src/shopify/messages-standard';
import { MARQUE_PREMIER_BLOC, blocVerrouille } from '../src/shopify/premier-bloc';
import type { WorkflowGraph } from '../src/workflow/graph';
import { ATTESTEE, DOMAINE, modeleMeta, monterLignes, VUE_LIGNES as VUE } from './shopify-lignes-faux';

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
      templateCards: [],
      variables: [{ position: 1, source: { type: 'variable', key: 'first_name' } }, { position: 2, source: { type: 'variable', key: 'order_number' } }],
    });
  });

  it('🔴 changer le template garde le reste du bloc : la sortie « Pas de réponse », le code, ce que l’éditeur y range (décision 7)', async () => {
    const m = monter({ modeles: [modele(), modele({ id: 'm2', name: 'commande_payee_v2', buttons: [] })] });
    await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: ['first_name'] }, 'u1');
    const l = (await m.store.ligne(T, 'order_paid'))!;
    const wf = (await m.workflows.getById(l.workflowId, T))!;
    const reglee: WorkflowGraph = {
      nodes: wf.graph.nodes.map((n) => ({ ...n, data: { ...n.data, timeoutValue: 30, timeoutUnit: 'minutes', code: 'nod_k7m2p3_01', templateCards: [{ handle: 'vieux' }] } })),
      edges: [],
    };
    await m.workflows.publish(l.workflowId, T, reglee);
    await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee_v2', langue: 'fr', variables: [] }, 'u1');
    expect(blocVerrouille((await m.workflows.getById(l.workflowId, T))!.graph)?.data).toEqual({
      [MARQUE_PREMIER_BLOC]: true, timeoutValue: 30, timeoutUnit: 'minutes', code: 'nod_k7m2p3_01',
      templateName: 'commande_payee_v2', language: 'fr', templateButtons: [], templateCards: [], variables: [],
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

  it('🔴 le template remplacé, écrit depuis un bloc, part au ménage ; un template choisi à la main jamais', async () => {
    const m = monter({ modeles: [modele(), modele({ id: 'm2', name: 'commande_payee_v2' })], marques: ['commande_payee'] });
    await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: [] }, 'u1');
    expect(m.menage.programmes, 'la première pose ne remplace rien').toEqual([]);
    await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee_v2', langue: 'fr', variables: [] }, 'u1');
    expect(m.menage.programmes).toEqual([{ type: 'bloc', tenantId: T, modele: 'commande_payee', langue: 'fr', essai: 0 }]);
    await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: [] }, 'u1');
    expect(m.menage.programmes, 'commande_payee_v2 n’est pas marqué : il reste').toHaveLength(1);
  });

  it('🔴 la liste des templates illisible chez Meta : refus propre (503) AVANT toute écriture', async () => {
    const m = monter({ modeles: 'panne' });
    expect(await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: [] }, 'u1'))
      .toMatchObject({ ok: false, statut: 503 });
    expect([m.workflows.parId.size, m.store.lignesEnBase.size]).toEqual([0, 0]);
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

  it('🔴 la liste des templates illisible chez Meta : l’état se lit quand même, sans l’état chez Meta (la carte ne tombe pas)', async () => {
    const lignes = monter();
    await brancherLePremierBloc(lignes.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: [] }, 'u1');
    const enPanne = { ...lignes.deps, modeles: async () => { throw new Error('Graph indisponible'); } };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await etatDesLignes(enPanne, T)).toEqual([expect.objectContaining({ evenement: 'order_paid', modele: 'commande_payee', etatChezMeta: null, blocs: 1 })]);
    vi.restoreAllMocks();
  });

  it('🔴 une version programmée du scénario (un template de bloc en validation chez Meta) se dit : la console montre « nouvelle version en validation »', async () => {
    const m = monter();
    await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: [] }, 'u1');
    expect((await etatDesLignes(m.deps, T))[0]).toMatchObject({ versionProgrammee: false });
    const l = (await m.store.ligne(T, 'order_paid'))!;
    m.workflows.programmees.set(l.workflowId, { graphe: { nodes: [], edges: [] }, le: '2026-11-19T10:00:00.000Z', par: 'u1' });
    expect((await etatDesLignes(m.deps, T))[0]).toMatchObject({ versionProgrammee: true });
  });
});

describe('le message standard d’une ligne (2026-11-20)', () => {
  const blocDe = async (m: ReturnType<typeof monter>, graphe: 'programme' | 'publie' | 'brouillon') => {
    const l = (await m.store.ligne(T, 'order_paid'))!;
    const wf = (await m.workflows.getById(l.workflowId, T))!;
    const g = graphe === 'programme' ? m.workflows.programmees.get(l.workflowId)?.graphe : graphe === 'publie' ? wf.graph : wf.draftGraph;
    return g ? blocVerrouille(g) : null;
  };

  it('🔴 crée le template standard depuis le bloc verrouillé, le pose dans une version PROGRAMMÉE (sans auteur) et le brouillon, jamais dans le publié ; la ligne reste éteinte', async () => {
    const m = monter();
    expect(await proposerMessageStandard(m.deps, T, 'order_paid', 'u1')).toBe('propose');
    expect(m.creation.appels).toEqual([expect.objectContaining({ tenantId: T, nodeId: 'depart', par: 'u1', corps: corpsStandard('order_paid').corps })]);
    const data = {
      [MARQUE_PREMIER_BLOC]: true, templateName: 'commande_payee_x', language: 'fr', templateButtons: [], templateCards: [],
      variables: corpsStandard('order_paid').variables.map((key, i) => ({ position: i + 1, source: { type: 'variable', key } })),
    };
    expect((await blocDe(m, 'programme'))?.data).toEqual(data);
    expect((await blocDe(m, 'brouillon'))?.data).toEqual(data);
    expect((await blocDe(m, 'publie'))?.data).toEqual({ [MARQUE_PREMIER_BLOC]: true });
    const l = (await m.store.ligne(T, 'order_paid'))!;
    expect(m.workflows.programmees.get(l.workflowId)?.par).toBeNull();
    expect(l.actif).toBe(false);
  });

  it('un template approuvé d’emblée par Meta part dans le publié', async () => {
    const m = monter({ creation: { ok: true, modele: 'commande_payee_x', langue: 'fr', etat: 'approuve', categorie: 'UTILITY', boutons: [] } });
    expect(await proposerMessageStandard(m.deps, T, 'order_paid', 'u1')).toBe('propose');
    expect((await blocDe(m, 'publie'))?.data).toMatchObject({ templateName: 'commande_payee_x' });
    expect(m.workflows.programmees.size).toBe(0);
  });

  it('🔴 jamais deux fois, jamais par-dessus le message du marchand : un template publié, programmé ou au brouillon arrête tout', async () => {
    const m = monter();
    await proposerMessageStandard(m.deps, T, 'order_paid', 'u1');
    expect(await proposerMessageStandard(m.deps, T, 'order_paid', 'u1')).toBe('deja');
    const publie = monter();
    await brancherLePremierBloc(publie.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: [] }, 'u1');
    expect(await proposerMessageStandard(publie.deps, T, 'order_paid', 'u1')).toBe('deja');
    const brouillon = monter();
    const l = await assurerLigne(brouillon.deps, T, 'order_paid', 'u1');
    const wf = (await brouillon.workflows.getById(l.workflowId, T))!;
    brouillon.workflows.parId.set(l.workflowId, { ...wf, draftGraph: { nodes: wf.graph.nodes.map((n) => ({ ...n, data: { ...n.data, templateName: 'le_sien' } })), edges: [] } });
    expect(await proposerMessageStandard(brouillon.deps, T, 'order_paid', 'u1')).toBe('deja');
    expect([...m.creation.appels, ...publie.creation.appels, ...brouillon.creation.appels]).toHaveLength(1);
  });

  it('🔴 un numéro relié par QR code : rien n’est créé ; un refus ou une panne de Meta ne lèvent jamais et ne laissent rien dans le scénario', async () => {
    const qr = monter({ filiere: 'application' });
    expect(await proposerMessageStandard(qr.deps, T, 'order_paid', 'u1')).toBe('filiere_application');
    expect(qr.creation.appels).toHaveLength(0);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const refuse = monter({ creation: { ok: false, statut: 400, erreur: 'Cet espace n’a pas de compte WhatsApp Business relié à Meta' } });
    expect(await proposerMessageStandard(refuse.deps, T, 'order_paid', 'u1')).toBe('non_cree');
    expect(refuse.workflows.programmees.size).toBe(0);
    const rejete = monter({ creation: { ok: true, modele: 'x', langue: 'fr', etat: 'refuse', categorie: null, boutons: [] } });
    expect(await proposerMessageStandard(rejete.deps, T, 'order_paid', 'u1')).toBe('non_cree');
    expect(rejete.workflows.programmees.size).toBe(0);
    const panne = monter({ creation: 'leve' });
    expect(await proposerMessageStandard(panne.deps, T, 'order_paid', 'u1')).toBe('echec');
    vi.restoreAllMocks();
  });

  it('le délai d’une relance DÉJÀ allumée se change même sur un numéro relié par QR code, sans rien proposer', async () => {
    const m = monter();
    await reglerLigne(m.deps, T, 'checkout_abandoned', { actif: true }, 'u1');
    const qr = { ...m.deps, filiere: async () => 'application' as const };
    const appels = m.creation.appels.length;
    expect(await reglerLigne(qr, T, 'checkout_abandoned', { actif: true, delaiMinutes: 180 }, 'u1')).toMatchObject({ ok: true });
    expect(m.store.gestes.at(-1)).toBe('delai:180');
    expect(m.creation.appels).toHaveLength(appels);
    expect((await m.store.ligne(T, 'checkout_abandoned'))?.actif).toBe(true);
  });

  it('🔴 « allumée » renvoyée sur une ligne DÉJÀ allumée (nouveau délai, set_shopify_message active true) la LAISSE allumée, sans arrêter ses parcours', async () => {
    const m = monter();
    await reglerLigne(m.deps, T, 'checkout_abandoned', { actif: true }, 'u1');
    expect(await reglerLigne(m.deps, T, 'checkout_abandoned', { actif: true, delaiMinutes: 180 }, 'u1')).toMatchObject({ ok: true, valeur: { actif: true } });
    expect(await reglerLigne(m.deps, T, 'checkout_abandoned', { actif: true }, 'u1')).toMatchObject({ ok: true, valeur: { actif: true } });
    expect(m.store.gestes).toEqual(['allumer:checkout_abandoned', 'delai:180']);
    expect(m.parcours.arrets).toEqual([]);
  });

  it('🔴 allumer un cas encore vide le propose ; allumer sur un numéro relié par QR code est refusé, éteindre reste permis', async () => {
    const m = monter();
    expect(await reglerLigne(m.deps, T, 'checkout_abandoned', { actif: true }, 'u1')).toMatchObject({ ok: true });
    expect(m.creation.appels).toEqual([expect.objectContaining({ corps: corpsStandard('checkout_abandoned').corps })]);
    expect((await m.store.ligne(T, 'checkout_abandoned'))?.actif).toBe(true);
    const qr = monter({ filiere: 'application' });
    expect(await reglerLigne(qr.deps, T, 'order_paid', { actif: true }, 'u1')).toEqual({ ok: false, statut: 409, message: PHRASE_SHOPIFY_QR_CODE });
    expect(qr.workflows.parId.size).toBe(0);
    expect(await reglerLigne(qr.deps, T, 'order_paid', { actif: false }, 'u1')).toMatchObject({ ok: true });
  });

  it('🔴 l’aperçu d’une ligne : le template de la version programmée (en validation), ses exemples par position et son pied', async () => {
    const corps = corpsStandard('checkout_abandoned').corps;
    const m = monter({
      creation: { ok: true, modele: 'panier_abandonne_x', langue: 'fr', etat: 'en_validation', categorie: 'MARKETING', boutons: [] },
      modeles: [modele({ name: 'panier_abandonne_x', status: 'PENDING', body: corps.body, footer: corps.footer, buttons: [] })],
    });
    await proposerMessageStandard(m.deps, T, 'checkout_abandoned', 'u1');
    const [etat] = await etatDesLignes(m.deps, T);
    expect(etat).toMatchObject({ modele: null, versionProgrammee: true });
    expect(etat!.apercu).toEqual({ corps: corps.body, pied: corps.footer, exemples: corps.example, donnees: ['first_name', 'checkout_url'], enValidation: true });
  });

  it('l’aperçu du publié, une source qui n’est pas une donnée Shopify laissée en repère ; sans template : null', async () => {
    const m = monter({ modeles: [modele({ body: 'Merci {{1}} pour {{2}}' })] });
    await brancherLePremierBloc(m.deps, T, { evenement: 'order_paid', modele: 'commande_payee', langue: 'fr', variables: ['first_name'] }, 'u1');
    await assurerLigne(m.deps, T, 'checkout_abandoned', 'u1');
    const etats = await etatDesLignes(m.deps, T);
    expect(etats[0]!.apercu).toEqual({ corps: 'Merci {{1}} pour {{2}}', pied: null, exemples: ['Camille', '{{2}}'], donnees: ['first_name', null], enValidation: false });
    expect(etats[1]!.apercu).toBeNull();
  });
});

describe('l’attestation du consentement des clients (2026-11-20)', () => {
  it('🔴 sans attestation, aucune automation ne s’allume (409), rien n’est créé ; éteindre reste permis', async () => {
    const m = monter();
    m.store.attestationInitiale = null;
    expect(await reglerLigne(m.deps, T, 'order_paid', { actif: true }, 'u1')).toEqual({ ok: false, statut: 409, message: PHRASE_ATTESTATION_REQUISE });
    expect(m.workflows.parId.size).toBe(0);
    expect(m.creation.appels).toHaveLength(0);
    expect(await reglerLigne(m.deps, T, 'order_paid', { actif: false }, 'u1')).toMatchObject({ ok: true });
    // Retirée : même refus.
    m.store.attestations.push({ domaine: DOMAINE, coche: false, texte: 'x', par: 'u1', origine: 'console' });
    expect(await reglerLigne(m.deps, T, 'order_paid', { actif: true }, 'u1')).toMatchObject({ ok: false, statut: 409 });
  });

  it('🔴 une ligne DÉJÀ allumée continue sans attestation (Julien : rien n’est coupé), et son délai se règle', async () => {
    const m = monter();
    await reglerLigne(m.deps, T, 'checkout_abandoned', { actif: true }, 'u1');
    m.store.attestationInitiale = null;
    expect(await reglerLigne(m.deps, T, 'checkout_abandoned', { actif: true, delaiMinutes: 180 }, 'u1')).toMatchObject({ ok: true });
    expect((await m.store.ligne(T, 'checkout_abandoned'))?.actif).toBe(true);
  });

  it('🔴 cocher HISTORISE le texte de la langue reçue, la boutique, qui et d’où ; l’allumage passe ensuite', async () => {
    const m = monter();
    m.store.attestationInitiale = null;
    expect(await reglerAttestation(m.deps, T, { coche: true, langue: 'en', origine: 'console' }, 'u1')).toMatchObject({ ok: true });
    expect(m.store.attestations).toEqual([{ domaine: DOMAINE, coche: true, texte: TEXTE_ATTESTATION_SHOPIFY.en, par: 'u1', origine: 'console' }]);
    expect(await reglerLigne(m.deps, T, 'order_paid', { actif: true }, 'u1')).toMatchObject({ ok: true });
  });

  it('🔴 décocher historise aussi, et éteint les automations allumées (leurs parcours s’arrêtent)', async () => {
    const m = monter();
    await reglerLigne(m.deps, T, 'order_paid', { actif: true }, 'u1');
    await reglerLigne(m.deps, T, 'checkout_abandoned', { actif: true }, 'u1');
    expect(await reglerAttestation(m.deps, T, { coche: false, langue: 'fr', origine: 'console' }, 'u1')).toMatchObject({ ok: true });
    expect(m.store.attestations.at(-1)).toEqual({ domaine: DOMAINE, coche: false, texte: TEXTE_ATTESTATION_SHOPIFY.fr, par: 'u1', origine: 'console' });
    expect([...m.store.lignesEnBase.values()].every((l) => !l.actif)).toBe(true);
    expect(m.parcours.arrets.map((a) => a.motif)).toEqual(['attestation retirée', 'attestation retirée']);
  });

  it('🔴 l’attestation d’une AUTRE boutique de l’espace ne vaut pas pour celle qui est branchée', async () => {
    const m = monter();
    m.store.attestationInitiale = { ...ATTESTEE, domaine: 'ancienne.myshopify.com' };
    expect(await reglerLigne(m.deps, T, 'order_paid', { actif: true }, 'u1')).toEqual({ ok: false, statut: 409, message: PHRASE_ATTESTATION_REQUISE });
  });

  it('sans boutique branchée, ou coupée, rien ne s’atteste', async () => {
    const sans = monter({ vue: null });
    expect(await reglerAttestation(sans.deps, T, { coche: true, langue: 'fr', origine: 'console' }, 'u1')).toMatchObject({ ok: false, statut: 409 });
    const coupee = monter({ vue: { ...VUE, etat: 'coupee' } });
    expect(await reglerAttestation(coupee.deps, T, { coche: true, langue: 'fr', origine: 'console' }, 'u1')).toMatchObject({ ok: false, statut: 409 });
    expect([...sans.store.attestations, ...coupee.store.attestations]).toEqual([]);
  });
});
