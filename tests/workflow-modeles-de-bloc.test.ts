import { describe, it, expect } from 'vitest';
import { MetaTemplateClient, type FetchLike } from '../src/meta/templates';
import { estNomDeModele } from '../src/api/creer-modele';
import type { DepsGestionModeles } from '../src/templates/gestion';
import type { WorkflowGraph } from '../src/workflow/graph';
import type { WorkflowRow } from '../src/workflow/store.pg';
import { creerModeleDuBloc, modelesDuGraphe, nomDuModeleDeBloc, type DepsCreationDeBloc } from '../src/workflow/modeles-de-bloc';
import { aucuneCampagneActive, modelesInertes } from './routes-inertes';

/**
 * La porte « template d'un bloc » (menu « Scénario », lot 3, décisions 19 et 27) : le nom naît côté serveur, le bloc doit
 * exister dans le graphe que l'éditeur ouvre et envoyer un template, et ni carousel ni en-tête média ne s'écrivent ici.
 */
const MAINTENANT = new Date('2026-11-18T15:00:00.000Z');
const SUFFIXE = MAINTENANT.getTime().toString(36);

const graphe = (n1: Record<string, unknown> = { type: 'template', data: { templateName: 'ancien', language: 'fr' } }): WorkflowGraph => ({
  nodes: [{ id: 'n1', position: { x: 0, y: 0 }, ...n1 } as WorkflowGraph['nodes'][number], { id: 'n2', type: 'tag', position: { x: 0, y: 0 }, data: { tag: 'x' } }],
  edges: [],
});
const ligne = (g: WorkflowGraph, nom = 'Relance panier été'): WorkflowRow => ({
  id: 'wf1', tenantId: 't1', name: nom, code: null, graph: g, draftGraph: null, publishedAt: null,
  createdAt: '', updatedAt: '', rayon: 'general',
});

function monter(o: {
  scenario?: WorkflowRow | null;
  reponseMeta?: { id: string; status: string; category?: string };
  waba?: string | null;
} = {}) {
  const appelsMeta: Array<{ url: string; body: Record<string, unknown> }> = [];
  const inseres: Array<Record<string, unknown>> = [];
  const fetchMeta: FetchLike = async (url, init) => {
    appelsMeta.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return { ok: true, status: 200, json: async () => o.reponseMeta ?? { id: 'tid', status: 'PENDING' } } as Response;
  };
  const gestion: DepsGestionModeles = {
    ...modelesInertes,
    meta: { templateClientForTenant: async () => new MetaTemplateClient('tok', 'v23.0', fetchMeta) },
    repo: { getTenantWabaId: async () => (o.waba === undefined ? 'waba1' : o.waba), listActiveCampaignsForTemplate: aucuneCampagneActive },
  };
  const deps: DepsCreationDeBloc = {
    gestion,
    scenarios: { getById: async (id, tenant) => (id === 'wf1' && tenant === 't1' ? (o.scenario === undefined ? ligne(graphe()) : o.scenario) : null) },
    lignes: { inserer: async (tenantId, l) => { inseres.push({ tenantId, ...l }); } },
    maintenant: () => MAINTENANT,
  };
  return { deps, appelsMeta, inseres };
}

const CORPS = { category: 'UTILITY', language: 'fr', body: 'Votre panier vous attend', buttons: [{ type: 'QUICK_REPLY', text: 'Je finalise' }] };

describe('nomDuModeleDeBloc', () => {
  it('le nom du scénario ramené à l’alphabet de Meta, suivi de l’horodatage en base 36', () => {
    const n = nomDuModeleDeBloc('Relance Panier Été !', MAINTENANT);
    expect(n).toBe(`relance_panier_ete_${SUFFIXE}`);
    expect(estNomDeModele(n)).toBe(true);
  });

  it('un nom sans lettre ni chiffre devient « scenario »', () => {
    expect(nomDuModeleDeBloc(' ¡¿ § ', MAINTENANT)).toBe(`scenario_${SUFFIXE}`);
  });

  it('un nom très long est coupé à 40 caractères, sans souligné pendant', () => {
    const n = nomDuModeleDeBloc(`${'a'.repeat(39)} bcd`, MAINTENANT);
    expect(n).toBe(`${'a'.repeat(39)}_${SUFFIXE}`);
    expect(estNomDeModele(n)).toBe(true);
  });
});

describe('modelesDuGraphe', () => {
  it('les templates nommés par les blocs, sans doublon ni bloc vide, avec la langue par défaut du moteur', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'a', type: 'template', position: { x: 0, y: 0 }, data: { templateName: 'x', language: 'fr' } },
        { id: 'b', type: 'template', position: { x: 0, y: 0 }, data: { templateName: ' x ', language: 'fr' } },
        { id: 'c', type: 'template', position: { x: 0, y: 0 }, data: { templateName: 'y' } },
        { id: 'd', type: 'template', position: { x: 0, y: 0 }, data: { templateName: '' } },
        { id: 'e', type: 'tag', position: { x: 0, y: 0 }, data: { templateName: 'z' } },
      ],
      edges: [],
    };
    expect(modelesDuGraphe(g)).toEqual([{ modele: 'x', langue: 'fr' }, { modele: 'y', langue: 'fr' }]);
  });
});

describe('creerModeleDuBloc', () => {
  it('🔴 le nom naît côté serveur : un nom reçu dans le corps est ignoré', async () => {
    const { deps, appelsMeta, inseres } = monter();
    const r = await creerModeleDuBloc(deps, 't1', { workflowId: 'wf1', nodeId: 'n1', corps: { ...CORPS, name: 'pirate' }, par: 'u1' });
    expect(r).toEqual({
      ok: true, modele: `relance_panier_ete_${SUFFIXE}`, langue: 'fr', etat: 'en_validation', categorie: 'UTILITY',
      boutons: [{ type: 'QUICK_REPLY', text: 'Je finalise' }],
    });
    expect(appelsMeta).toHaveLength(1);
    expect(appelsMeta[0]!.body.name).toBe(`relance_panier_ete_${SUFFIXE}`);
    expect(inseres).toEqual([{ tenantId: 't1', workflowId: 'wf1', modele: `relance_panier_ete_${SUFFIXE}`, langue: 'fr', etat: 'en_validation', par: 'u1' }]);
  });

  it('le bloc se cherche dans le graphe que l’éditeur ouvre : le brouillon s’il existe', async () => {
    const enLigne = graphe({ type: 'tag', data: { tag: 'x' } });
    const brouillon = graphe();
    const { deps } = monter({ scenario: { ...ligne(enLigne), draftGraph: brouillon } });
    const r = await creerModeleDuBloc(deps, 't1', { workflowId: 'wf1', nodeId: 'n1', corps: CORPS, par: null });
    expect(r.ok).toBe(true);
  });

  it('l’état suit le statut rendu par Meta, et la catégorie est celle que Meta a retenue', async () => {
    const approuve = monter({ reponseMeta: { id: 't', status: 'APPROVED', category: 'MARKETING' } });
    const a = await creerModeleDuBloc(approuve.deps, 't1', { workflowId: 'wf1', nodeId: 'n1', corps: CORPS, par: null });
    expect(a).toMatchObject({ ok: true, etat: 'approuve', categorie: 'MARKETING' });
    expect(approuve.inseres[0]).toMatchObject({ etat: 'approuve' });
    const refuse = monter({ reponseMeta: { id: 't', status: 'REJECTED' } });
    expect(await creerModeleDuBloc(refuse.deps, 't1', { workflowId: 'wf1', nodeId: 'n1', corps: CORPS, par: null })).toMatchObject({ ok: true, etat: 'refuse' });
  });

  it('🔴 scénario d’un autre espace, ou inconnu : 404 sans aucun appel à Meta', async () => {
    const { deps, appelsMeta } = monter();
    expect(await creerModeleDuBloc(deps, 't2', { workflowId: 'wf1', nodeId: 'n1', corps: CORPS, par: null })).toMatchObject({ ok: false, statut: 404 });
    expect(await creerModeleDuBloc(deps, 't1', { workflowId: 'wf9', nodeId: 'n1', corps: CORPS, par: null })).toMatchObject({ ok: false, statut: 404 });
    expect(appelsMeta).toHaveLength(0);
  });

  it('un bloc absent : 404 ; un bloc qui n’envoie pas de template : 400 ; sans appel à Meta', async () => {
    const { deps, appelsMeta } = monter({ scenario: ligne(graphe({ type: 'quick_message', data: { text: 'x' } })) });
    expect(await creerModeleDuBloc(deps, 't1', { workflowId: 'wf1', nodeId: 'n7', corps: CORPS, par: null })).toMatchObject({ ok: false, statut: 404 });
    expect(await creerModeleDuBloc(deps, 't1', { workflowId: 'wf1', nodeId: 'n1', corps: CORPS, par: null })).toMatchObject({ ok: false, statut: 400 });
    expect(appelsMeta).toHaveLength(0);
  });

  it('🔴 ni carousel ni en-tête média depuis un bloc (décision 27) ; un en-tête texte passe', async () => {
    const { deps, appelsMeta } = monter();
    const carte = { body: 'c', header: { format: 'IMAGE', example: 'https://x.fr/a.jpg' }, buttons: [{ type: 'QUICK_REPLY', text: 'Oui' }] };
    const carousel = await creerModeleDuBloc(deps, 't1', { workflowId: 'wf1', nodeId: 'n1', corps: { ...CORPS, buttons: undefined, carousel: { cards: [carte, carte] } }, par: null });
    expect(carousel).toMatchObject({ ok: false, statut: 400 });
    expect((carousel as { erreur: string }).erreur).toContain('Contenu > Templates');
    const image = await creerModeleDuBloc(deps, 't1', { workflowId: 'wf1', nodeId: 'n1', corps: { ...CORPS, header: { format: 'IMAGE', handle: 'h1' } }, par: null });
    expect(image).toMatchObject({ ok: false, statut: 400 });
    expect((image as { erreur: string }).erreur).toContain('Contenu > Templates');
    expect(appelsMeta).toHaveLength(0);
    const texte = await creerModeleDuBloc(deps, 't1', { workflowId: 'wf1', nodeId: 'n1', corps: { ...CORPS, header: { format: 'TEXT', text: 'Bonjour' } }, par: null });
    expect(texte.ok).toBe(true);
  });

  it('un corps invalide est refusé comme par l’écran Templates, sans appel à Meta ni ligne', async () => {
    const { deps, appelsMeta, inseres } = monter();
    expect(await creerModeleDuBloc(deps, 't1', { workflowId: 'wf1', nodeId: 'n1', corps: { ...CORPS, category: 'AUTHENTICATION' }, par: null })).toMatchObject({ ok: false, statut: 400 });
    expect(await creerModeleDuBloc(deps, 't1', { workflowId: 'wf1', nodeId: 'n1', corps: { ...CORPS, language: 'xx' }, par: null })).toMatchObject({ ok: false, statut: 400 });
    expect(appelsMeta).toHaveLength(0);
    expect(inseres).toHaveLength(0);
  });

  it('un espace sans compte WhatsApp Business relié (filière application) : refus lisible, sans ligne', async () => {
    const { deps, inseres } = monter({ waba: null });
    const r = await creerModeleDuBloc(deps, 't1', { workflowId: 'wf1', nodeId: 'n1', corps: CORPS, par: null });
    expect(r).toMatchObject({ ok: false, statut: 400 });
    expect((r as { erreur: string }).erreur).not.toContain('WABA');
    expect(inseres).toHaveLength(0);
  });
});
