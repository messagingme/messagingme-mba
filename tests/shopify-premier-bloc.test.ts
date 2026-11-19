import { describe, it, expect } from 'vitest';
import { donneeManquante, premierBloc, MARQUE_PREMIER_BLOC, type LecturesPremierBloc } from '../src/shopify/premier-bloc';
import { origineShopify, prefixeShopify, SUJET_DE_L_EVENEMENT } from '../src/shopify/lignes';
import { parcoursShopifyEncoreVoulu } from '../src/shopify/parcours-voulu';
import { EVENEMENTS_SHOPIFY } from '../src/shopify/donnees';
import type { WorkflowRow } from '../src/workflow/store.pg';
import type { WorkflowGraph, WorkflowNode } from '../src/workflow/graph';
import type { ParamHint } from '../src/crm/template-hints.pg';
import type { TemplateParam } from '../src/crm/template';

/**
 * LE PREMIER BLOC D'UNE LIGNE SHOPIFY (menu « Scénario », lot 5, tâche 6) : ce que le circuit envoie quand un événement
 * arrive. Le bloc VERROUILLÉ du graphe PUBLIÉ, lu comme l'envoi le lit (`actionOf`), ses sources effectives, et s'il a une
 * suite (le pont ne se pose que s'il en a une).
 */

const T = '5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01';
const W = '9a1f2d6b-7e8c-4c3e-8b7d-5f0c1e2a9f02';

const template = (id: string, data: Record<string, unknown>): WorkflowNode => ({ id, type: 'template', position: { x: 0, y: 0 }, data });
const verrouille = (data: Record<string, unknown>, id = 'depart'): WorkflowNode => template(id, { ...data, [MARQUE_PREMIER_BLOC]: true });

const scenario = (graph: WorkflowGraph, over: Partial<WorkflowRow> = {}): WorkflowRow => ({
  id: W, tenantId: T, name: 'Commande payée', graph, draftGraph: null, publishedAt: '2026-11-19T00:00:00.000Z',
  createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z', rayon: 'shopify', ...over,
});

/** Des CLASSES dont les méthodes lisent `this` : `premierBloc` doit appeler les magasins sur leur objet. */
class FauxScenarios {
  constructor(private readonly wf: WorkflowRow | null) {}
  async getById(id: string, tenantId: string): Promise<WorkflowRow | null> {
    return this.wf !== null && id === this.wf.id && tenantId === this.wf.tenantId ? this.wf : null;
  }
}
class FauxIndices {
  lus: Array<[string, string, string]> = [];
  constructor(private readonly indices: ParamHint[]) {}
  async get(tenantId: string, name: string, language: string): Promise<ParamHint[]> {
    this.lus.push([tenantId, name, language]);
    return this.indices;
  }
}

function lectures(wf: WorkflowRow | null, indices: ParamHint[] = []): { l: LecturesPremierBloc; idx: FauxIndices } {
  const idx = new FauxIndices(indices);
  return { l: { workflows: new FauxScenarios(wf), indices: idx }, idx };
}

const BLOC = { templateName: 'commande_payee', language: 'fr', templateButtons: [{ type: 'QUICK_REPLY', text: 'Merci' }] };

describe('le premier bloc d’une ligne Shopify', () => {
  it('🔴 un scénario absent, ou d’un autre rayon, est illisible', async () => {
    expect(await premierBloc(lectures(null).l, T, W)).toEqual({ etat: 'illisible', raison: 'scenario_absent' });
    const general = scenario({ nodes: [verrouille(BLOC)], edges: [] }, { rayon: 'general' });
    expect(await premierBloc(lectures(general).l, T, W)).toEqual({ etat: 'illisible', raison: 'scenario_absent' });
  });

  it('aucun bloc marqué, deux blocs marqués ou un bloc marqué qui n’est pas un template : pas de premier bloc', async () => {
    const sansMarque = scenario({ nodes: [template('a', BLOC)], edges: [] });
    const deux = scenario({ nodes: [verrouille(BLOC, 'a'), verrouille(BLOC, 'b')], edges: [] });
    const message: WorkflowNode = { id: 'm', type: 'quick_message', position: { x: 0, y: 0 }, data: { body: 'x', [MARQUE_PREMIER_BLOC]: true } };
    const pasTemplate = scenario({ nodes: [message], edges: [] });
    for (const wf of [sansMarque, deux, pasTemplate]) {
      expect(await premierBloc(lectures(wf).l, T, W)).toEqual({ etat: 'illisible', raison: 'bloc_absent' });
    }
  });

  it('un bloc verrouillé sans template écrit : sans modèle', async () => {
    const vide = scenario({ nodes: [verrouille({ templateName: '   ' })], edges: [] });
    expect(await premierBloc(lectures(vide).l, T, W)).toEqual({ etat: 'illisible', raison: 'sans_modele' });
  });

  it('🔴 lit le graphe PUBLIÉ, jamais le brouillon', async () => {
    const wf = scenario(
      { nodes: [verrouille(BLOC)], edges: [] },
      { draftGraph: { nodes: [verrouille({ ...BLOC, templateName: 'brouillon' })], edges: [] } },
    );
    const r = await premierBloc(lectures(wf).l, T, W);
    expect(r).toMatchObject({ etat: 'pret', modele: 'commande_payee' });
  });

  it('prêt : le nom sans ses espaces, la langue « fr » quand elle manque, les boutons dans l’ordre du template', async () => {
    const boutons = [{ type: 'QUICK_REPLY', text: 'Oui' }, { type: 'URL', text: 'Suivre' }, { type: 'QUICK_REPLY', text: 'Non' }];
    const wf = scenario({ nodes: [verrouille({ templateName: ' panier_relance ', templateButtons: boutons })], edges: [] });
    const { l, idx } = lectures(wf);
    expect(await premierBloc(l, T, W)).toEqual({
      etat: 'pret', workflowId: W, noeudId: 'depart', modele: 'panier_relance', langue: 'fr', boutons, params: [], aUneSuite: false,
    });
    expect(idx.lus).toEqual([[T, 'panier_relance', 'fr']]);
  });

  it('les sources : celles du template, remplacées position par position par celles du bloc, dans l’ordre des positions', async () => {
    const indices: ParamHint[] = [
      { position: 2, source: { type: 'literal', value: 'x' } },
      { position: 1, source: { type: 'field', key: 'prenom' } },
    ];
    const wf = scenario({
      nodes: [verrouille({ ...BLOC, variables: [{ position: 2, source: { type: 'variable', key: 'order_number' } }] })],
      edges: [],
    });
    const r = await premierBloc(lectures(wf, indices).l, T, W);
    expect(r.etat === 'pret' && r.params).toEqual([
      { position: 1, source: { type: 'field', key: 'prenom' } },
      { position: 2, source: { type: 'variable', key: 'order_number' } },
    ]);
  });

  it('« a une suite » quand une flèche part du bloc, et seulement de lui', async () => {
    const suite = template('suite', { templateName: 'merci', language: 'fr' });
    const avec = scenario({ nodes: [verrouille(BLOC), suite], edges: [{ id: 'e1', source: 'depart', target: 'suite', sourceHandle: 'btn:0' }] });
    const r1 = await premierBloc(lectures(avec).l, T, W);
    expect(r1.etat === 'pret' && r1.aUneSuite).toBe(true);
    // Une flèche qui part d'un AUTRE bloc ne fait pas une suite du premier.
    const ailleurs = scenario({ nodes: [verrouille(BLOC), suite, template('x', BLOC)], edges: [{ id: 'e1', source: 'suite', target: 'x' }] });
    const r2 = await premierBloc(lectures(ailleurs).l, T, W);
    expect(r2.etat === 'pret' && r2.aUneSuite).toBe(false);
  });
});

describe('une donnée manquante', () => {
  const variable = (position: number, key: string): TemplateParam => ({ position, source: { type: 'variable', key } });

  it('🔴 une variable que l’événement ne sait pas remplir manque, même si une valeur du même nom traîne', () => {
    expect(donneeManquante([variable(1, 'checkout_url')], 'order_paid', { checkout_url: 'https://x' })).toBe(true);
  });

  it('une variable de l’événement sans valeur manque ; avec sa valeur, non', () => {
    expect(donneeManquante([variable(1, 'order_status_url')], 'order_paid', {})).toBe(true);
    expect(donneeManquante([variable(1, 'order_status_url')], 'order_paid', { order_status_url: 'https://s' })).toBe(false);
  });

  it('les autres sources ne sont pas des données de l’événement : elles ne manquent jamais ici', () => {
    expect(donneeManquante([{ position: 1, source: { type: 'field', key: 'prenom' } }, { position: 2, source: { type: 'now' } }], 'order_paid', {})).toBe(false);
  });
});

describe('l’origine d’un parcours Shopify', () => {
  it('reprend la clé d’idempotence d’aujourd’hui : la boutique, le sujet du webhook, la référence', () => {
    expect(origineShopify('b.myshopify.com', 'order_paid', '1002')).toBe('shopify:b.myshopify.com:orders/paid:1002');
    expect(origineShopify('b.myshopify.com', 'order_fulfilled', '5001')).toBe('shopify:b.myshopify.com:fulfillments/create:5001');
    expect(origineShopify('b.myshopify.com', 'checkout_abandoned', 'tok')).toBe('shopify:b.myshopify.com:checkouts/abandoned:tok');
    expect(prefixeShopify('b.myshopify.com')).toBe('shopify:b.myshopify.com:');
    expect(prefixeShopify('b.myshopify.com', 'checkout_abandoned')).toBe('shopify:b.myshopify.com:checkouts/abandoned:');
  });

  it('🔴 chaque origine se relit par la règle « encore voulu » (un sujet qu’elle ne connaîtrait pas resterait voulu à vie)', async () => {
    for (const evenement of EVENEMENTS_SHOPIFY) {
      const lus: string[] = [];
      const store = {
        async etatPourParcours(_t: string, _d: string, e: typeof evenement) { lus.push(e); return { boutique: 'pause' as const, ligneActive: true }; },
        async panierOuvert() { return true; },
      };
      expect(await parcoursShopifyEncoreVoulu(store, T, origineShopify('b.myshopify.com', evenement, 'ref'))).toBe(false);
      expect(lus).toEqual([evenement]);
    }
    expect(Object.keys(SUJET_DE_L_EVENEMENT).sort()).toEqual([...EVENEMENTS_SHOPIFY].sort());
  });
});
