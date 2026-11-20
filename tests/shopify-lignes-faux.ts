import type { DepsLignesShopify } from '../src/shopify/lignes-gestion';
import type { LigneShopify } from '../src/shopify/lignes';
import type { EvenementShopify } from '../src/shopify/donnees';
import type { VueBoutique } from '../src/shopify/store.pg';
import type { WorkflowGraph } from '../src/workflow/graph';
import type { Programmation, WorkflowRow } from '../src/workflow/store.pg';
import type { TemplateSummary } from '../src/meta/templates';
import type { JobOubli } from '../src/shopify/preparation';
import type { IssueCreationDeBloc } from '../src/workflow/modeles-de-bloc';
import type { Filiere } from '../src/application/comptes';

/**
 * LES FAUX DES LIGNES SHOPIFY (menu « Scénario », lot 5, tâche 8), partagés par les tests de la gestion des lignes, de la
 * gestion du connecteur, des outils MCP et des routes. Des CLASSES dont les méthodes lisent `this`, comme les vrais
 * magasins, passés entiers.
 */

export const DOMAINE = 'b.myshopify.com';
export const VUE_LIGNES: VueBoutique = {
  domaine: DOMAINE, nom: 'Essai', pays: 'FR', devise: 'EUR', etat: 'connectee', motifCoupure: null, coupeeLe: null,
  connecteeLe: '2026-11-19T00:00:00.000Z', dernierEvenementLe: null, delaiPanierMinutes: 60, origine: 'claude_code', pauseLe: null,
};

export class FauxBoutique {
  lignesEnBase = new Map<EvenementShopify, LigneShopify>();
  pause = false;
  gestes: string[] = [];
  /** `lire` rend la vue du moment : un test qui coupe la boutique la change ici. */
  constructor(public vue: VueBoutique | null = VUE_LIGNES) {}
  async lire(): Promise<VueBoutique | null> { return this.vue === null ? null : { ...this.vue, pauseLe: this.pause ? '2026-11-19T10:00:00.000Z' : null }; }
  async lignes(): Promise<LigneShopify[]> { return [...this.lignesEnBase.values()]; }
  async ligne(_t: string, e: EvenementShopify): Promise<LigneShopify | null> { return this.lignesEnBase.get(e) ?? null; }
  async poserLigne(_t: string, l: { evenement: EvenementShopify; workflowId: string }): Promise<LigneShopify> {
    if (!this.lignesEnBase.has(l.evenement)) this.lignesEnBase.set(l.evenement, { evenement: l.evenement, workflowId: l.workflowId, actif: false, modifieLe: 'x' });
    return this.lignesEnBase.get(l.evenement)!;
  }
  async allumerLigne(_t: string, e: EvenementShopify): Promise<boolean> {
    const l = this.lignesEnBase.get(e);
    if (!l || l.actif) return false;
    l.actif = true; this.gestes.push(`allumer:${e}`); return true;
  }
  async eteindreLigne(_t: string, e: EvenementShopify): Promise<boolean> {
    const l = this.lignesEnBase.get(e);
    if (!l || !l.actif) return false;
    l.actif = false; this.gestes.push(`eteindre:${e}`); return true;
  }
  async mettreEnPause(): Promise<boolean> { if (this.pause) return false; this.pause = true; return true; }
  async reprendre(): Promise<boolean> { if (!this.pause) return false; this.pause = false; return true; }
  async reglerDelaiPanier(_t: string, m: number): Promise<void> { this.gestes.push(`delai:${m}`); }
}

export class FauxScenarios {
  parId = new Map<string, WorkflowRow>();
  publications: WorkflowGraph[] = [];
  brouillons: WorkflowGraph[] = [];
  /** Les versions programmées (lot 3) : une publication à la main les annule, comme le vrai magasin. */
  programmees = new Map<string, Programmation>();
  constructor(private readonly espace = 't1') {}
  async insert(tenantId: string, name: string, graph: WorkflowGraph, rayon: 'general' | 'shopify' | 'hubspot'): Promise<{ id: string }> {
    const id = `wf-${this.parId.size + 1}`;
    this.parId.set(id, {
      id, tenantId, name, graph: { nodes: [], edges: [] }, draftGraph: graph, publishedAt: null,
      createdAt: 'x', updatedAt: 'x', rayon,
    });
    return { id };
  }
  async publish(id: string, tenantId: string, graphe?: WorkflowGraph): Promise<WorkflowRow | null> {
    const wf = this.parId.get(id);
    if (!wf || wf.tenantId !== tenantId) return null;
    const g = graphe ?? wf.draftGraph ?? wf.graph;
    this.publications.push(g);
    this.programmees.delete(id);
    const neuf = { ...wf, graph: g, draftGraph: graphe !== undefined ? wf.draftGraph : null };
    this.parId.set(id, neuf);
    return neuf;
  }
  async getById(id: string, tenantId: string): Promise<WorkflowRow | null> {
    const wf = this.parId.get(id);
    return wf && wf.tenantId === tenantId ? wf : null;
  }
  async update(id: string, tenantId: string, patch: { graph?: WorkflowGraph }): Promise<{ trouve: boolean; brouillon: boolean }> {
    const wf = this.parId.get(id);
    if (!wf || tenantId !== this.espace) return { trouve: false, brouillon: false };
    if (patch.graph) { this.brouillons.push(patch.graph); this.parId.set(id, { ...wf, draftGraph: patch.graph }); }
    return { trouve: true, brouillon: true };
  }
  async publicationProgrammee(id: string, tenantId: string): Promise<Programmation | null> {
    const wf = this.parId.get(id);
    return wf && wf.tenantId === tenantId ? (this.programmees.get(id) ?? null) : null;
  }
  async programmer(id: string, tenantId: string, par: string | null, graphe: WorkflowGraph): Promise<{ le: string } | null> {
    const wf = this.parId.get(id);
    if (!wf || wf.tenantId !== tenantId) return null;
    this.programmees.set(id, { graphe, le: 'le', par });
    return { le: 'le' };
  }
}

/** La création d'un template depuis un bloc (`creerModeleDuBloc`) : chaque appel noté, l'issue choisie par le test. */
export class FauxCreation {
  appels: Array<{ tenantId: string; workflowId: string; nodeId: string; corps: Record<string, unknown>; par: string | null }> = [];
  constructor(public issue: IssueCreationDeBloc | 'leve' = { ok: true, modele: 'commande_payee_x', langue: 'fr', etat: 'en_validation', categorie: 'UTILITY', boutons: [] }) {}
  creer = async (tenantId: string, e: { workflowId: string; nodeId: string; corps: Record<string, unknown>; par: string | null }): Promise<IssueCreationDeBloc> => {
    this.appels.push({ tenantId, ...e });
    if (this.issue === 'leve') throw new Error('Meta indisponible');
    return this.issue;
  };
}

export class FauxParcours {
  arrets: Array<{ prefixe: string; motif: string }> = [];
  constructor(private readonly leve = false) {}
  async arreterParcours(_t: string, cible: { origine: string } | { prefixe: string; waId?: string } | { workflowIds: readonly string[] }, motif: string): Promise<number> {
    if (this.leve) throw new Error('base indisponible');
    if ('prefixe' in cible) this.arrets.push({ prefixe: cible.prefixe, motif });
    return 0;
  }
}

/** Le ménage des templates remplacés : les templates « écrits depuis un bloc » (`marques`), et ce qui est programmé. */
export class FauxMenage {
  programmes: JobOubli[] = [];
  constructor(public marques: string[] = []) {}
  lignes = {
    desModelesDAutomation: async (_t: string, paires: ReadonlyArray<{ modele: string; langue: string }>) => paires
      .filter((p) => this.marques.includes(p.modele))
      .map((p) => ({ workflowId: 'wf', modele: p.modele, langue: p.langue, etat: 'approuve' as const, raison: null, creeLe: 'x', trancheLe: null })),
  };
  programmerOubli = async (job: JobOubli): Promise<void> => { this.programmes.push(job); };
}

export const modeleMeta = (o: Partial<TemplateSummary> = {}): TemplateSummary => ({
  id: 'm1', name: 'commande_payee', status: 'APPROVED', category: 'UTILITY', language: 'fr', body: 'Merci {{1}}', headerFormat: null,
  buttons: [{ type: 'QUICK_REPLY', text: 'Suivre' }], ...o,
} as TemplateSummary);

/** Les dépendances des lignes, montées sur ces faux. */
export function monterLignes(o: {
  vue?: VueBoutique | null; modeles?: TemplateSummary[] | 'panne'; arretLeve?: boolean; store?: FauxBoutique; marques?: string[];
  creation?: IssueCreationDeBloc | 'leve'; filiere?: Filiere | null;
} = {}) {
  const store = o.store ?? new FauxBoutique(o.vue === undefined ? VUE_LIGNES : o.vue);
  const workflows = new FauxScenarios();
  const parcours = new FauxParcours(o.arretLeve === true);
  const menage = new FauxMenage(o.marques);
  const creation = new FauxCreation(o.creation);
  const modeles = async (): Promise<TemplateSummary[]> => {
    if (o.modeles === 'panne') throw new Error('Graph indisponible');
    return o.modeles ?? [modeleMeta()];
  };
  const filiere = async (): Promise<Filiere | null> => (o.filiere === undefined ? 'api' : o.filiere);
  const deps: DepsLignesShopify = { store, workflows, parcours, modeles, menage, creerModele: creation.creer, filiere };
  return { deps, store, workflows, parcours, menage, creation };
}
