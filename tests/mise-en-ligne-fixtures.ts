/**
 * Les fixtures du oui de mise en ligne (CSM, B2) : un magasin en mémoire qui reproduit les requêtes conditionnelles de
 * `PgMisesEnLigne`, et un montage complet (scénarios, versions, répondeur, journal) sur une horloge du test. Partagées
 * par les tests du cœur (`tests/mise-en-ligne.test.ts`) et de la route (`tests/http-mises-en-ligne.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import { DROITS, type Offre } from '../src/offres/offres';
import type { DepsReglageRepondeur } from '../src/repondeur/reglage';
import type { ModeRepondeur } from '../src/repondeur/mode';
import type { WorkflowGraph, WorkflowNode } from '../src/workflow/graph';
import type { WorkflowRow } from '../src/workflow/store.pg';
import type { VersionScenarioLue } from '../src/workflow/versions.pg';
import type { DepsPublication } from '../src/workflow/modeles-de-bloc';
import {
  proposer, type ActionGardee, type DemandeAction, type DepsMisesEnLigne, type ResultatAction,
} from '../src/mise-en-ligne/mise-en-ligne';
import type { IssueAcceptation, LigneMiseEnLigne, Reclamation } from '../src/mise-en-ligne/store.pg';
import { envoisAuOuiInertes, modelesDeBlocInertes } from './routes-inertes';
import { RECAPITULATIF_EFFACE, type DepsEnvoisAuOui } from '../src/mise-en-ligne/envois';

export const T = 't1';
export const AUTRE = 't2';
export const WF = '33333333-3333-4333-8333-333333333333';
export const WF2 = '66666666-6666-4666-8666-666666666666';
export const CSM = { userId: 'u-csm', autorisationId: 'a-1' };
export const ADMIN = { userId: 'u-admin' };

export const bloc = (id: string, texte: string, x = 0): WorkflowNode => ({ id, type: 'quick_message', position: { x, y: 0 }, data: { text: texte } });
export const graphe = (...nodes: WorkflowNode[]): WorkflowGraph => ({ nodes, edges: [] });
export const V1 = graphe(bloc('a', 'Bonjour'));
export const BROUILLON = graphe(bloc('a', 'Bonjour'), bloc('b', 'Votre besoin ?'));

export const ligne = (id: string, name: string, graph: WorkflowGraph, draftGraph: WorkflowGraph | null, over: Partial<WorkflowRow> = {}): WorkflowRow => ({
  id, tenantId: T, name, rayon: 'general', graph, draftGraph, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', ...over,
});

export interface LigneFausse {
  tenant: string; id: string; libelle: string; recapitulatif: string[]; actions: ActionGardee[]; empreinte: string;
  etat: 'proposee' | 'acceptee' | 'faite' | 'echouee'; expireLe: number; proposeePar: string; autorisationId: string | null;
  accepteePar: string | null; accepteeLe: number | null; jeton: string | null; bail: number | null; resultat: ResultatAction[];
  termineeLe: number | null;
}

/** Le magasin en mémoire : les mêmes conditions que les requêtes de `PgMisesEnLigne`, sur une horloge du test. */
export class FauxMisesEnLigne {
  readonly lignes = new Map<string, LigneFausse>();
  readonly admins = new Set<string>([CSM.userId, ADMIN.userId, 'u-admin2']);
  readonly revoquees = new Set<string>();
  constructor(private readonly horloge: { now: number }) {}

  private vue(l: LigneFausse): LigneMiseEnLigne {
    const now = this.horloge.now;
    const iso = (n: number | null): string | null => (n === null ? null : new Date(n).toISOString());
    return {
      id: l.id, libelle: l.libelle, recapitulatif: l.recapitulatif, actions: l.actions, empreinte: l.empreinte, etat: l.etat,
      expireLe: new Date(l.expireLe).toISOString(), expiree: l.etat === 'proposee' && l.expireLe <= now,
      enCours: l.etat === 'acceptee' && l.bail !== null && l.bail > now, proposeePar: l.proposeePar, accepteePar: l.accepteePar,
      accepteeLe: iso(l.accepteeLe), resultat: [...l.resultat], termineeLe: iso(l.termineeLe),
    };
  }

  private a(tenant: string, id: string): LigneFausse | null {
    const l = this.lignes.get(id);
    return l && l.tenant === tenant ? l : null;
  }

  async inserer(tenant: string, m: {
    proposeePar: string; autorisationId: string | null; libelle: string; recapitulatif: string[];
    actions: ActionGardee[]; empreinte: string; expireLe: Date;
  }): Promise<{ id: string }> {
    const id = randomUUID();
    this.lignes.set(id, {
      tenant, id, libelle: m.libelle, recapitulatif: m.recapitulatif, actions: structuredClone(m.actions), empreinte: m.empreinte,
      etat: 'proposee', expireLe: m.expireLe.getTime(), proposeePar: m.proposeePar, autorisationId: m.autorisationId,
      accepteePar: null, accepteeLe: null, jeton: null, bail: null, resultat: [], termineeLe: null,
    });
    return { id };
  }

  async lire(tenant: string, id: string): Promise<LigneMiseEnLigne | null> {
    const l = this.a(tenant, id);
    return l ? this.vue(l) : null;
  }

  /** La règle de `PgMisesEnLigne.trouverProposee` : proposée, pas échue, même personne, même empreinte, la plus récente. */
  async trouverProposee(tenant: string, par: string, empreinte: string): Promise<string | null> {
    const vivantes = [...this.lignes.values()].filter((l) => l.tenant === tenant && l.proposeePar === par && l.empreinte === empreinte
      && l.etat === 'proposee' && l.expireLe > this.horloge.now);
    return vivantes.at(-1)?.id ?? null;
  }

  async accepter(tenant: string, id: string, par: string, empreinte: string): Promise<IssueAcceptation> {
    const l = this.a(tenant, id);
    if (l && l.etat === 'proposee' && l.expireLe > this.horloge.now && l.empreinte === empreinte) {
      Object.assign(l, { etat: 'acceptee', accepteePar: par, accepteeLe: this.horloge.now });
      return 'ok';
    }
    if (!l) return 'inconnue';
    if (l.etat !== 'proposee') return 'deja';
    return l.expireLe <= this.horloge.now ? 'expiree' : 'modifiee';
  }

  async reclamer(tenant: string, id: string, jeton: string, bailS: number): Promise<Reclamation | null> {
    const l = this.a(tenant, id);
    if (!l || l.etat !== 'acceptee' || (l.bail !== null && l.bail > this.horloge.now)) return null;
    Object.assign(l, { jeton, bail: this.horloge.now + bailS * 1000 });
    return {
      actions: structuredClone(l.actions), resultat: [...l.resultat], accepteePar: l.accepteePar!, accepteeLe: new Date(l.accepteeLe!).toISOString(),
      clicValide: this.admins.has(l.accepteePar!),
      accesValide: this.admins.has(l.proposeePar) && (l.autorisationId === null || !this.revoquees.has(l.autorisationId)),
    };
  }

  async noterResultat(tenant: string, id: string, jeton: string, r: ResultatAction, bailS: number): Promise<boolean> {
    const l = this.a(tenant, id);
    if (!l || l.etat !== 'acceptee' || l.jeton !== jeton) return false;
    l.resultat.push(r);
    l.bail = this.horloge.now + bailS * 1000;
    return true;
  }

  async relacher(tenant: string, id: string, jeton: string): Promise<void> {
    const l = this.a(tenant, id);
    if (l && l.etat === 'acceptee' && l.jeton === jeton) Object.assign(l, { jeton: null, bail: null });
  }

  async terminer(tenant: string, id: string, jeton: string, etat: 'faite' | 'echouee'): Promise<boolean> {
    const l = this.a(tenant, id);
    if (!l || l.etat !== 'acceptee' || l.jeton !== jeton) return false;
    Object.assign(l, { etat, termineeLe: this.horloge.now, jeton: null, bail: null });
    // La règle de `PgMisesEnLigne.terminer` : un envoi à une personne perd ce qu'il gardait de son destinataire.
    if (l.empreinte !== 'expurgee' && l.actions.some((a) => a.type === 'modele' || a.type === 'envoi_scenario')) {
      l.actions = l.actions.map((a) => {
        const { telephone: _t, valeurs: _v, destinataire: _d, ...reste } = a as ActionGardee & { telephone?: string; valeurs?: string[]; destinataire?: string };
        return reste as ActionGardee;
      });
      Object.assign(l, { recapitulatif: [RECAPITULATIF_EFFACE], empreinte: 'expurgee' });
    }
    return true;
  }
}

const sansPositions = (g: WorkflowGraph): string => JSON.stringify(g.nodes.map(({ position: _p, ...n }) => n)) + JSON.stringify(g.edges);

export function monter(o: { offre?: Offre; publication?: Partial<DepsPublication>; envois?: DepsEnvoisAuOui } = {}) {
  const horloge = { now: Date.parse('2026-11-24T10:00:00.000Z') };
  /** L'offre de l'espace, modifiable en cours de test (un espace qui redescend entre la préparation et le clic). */
  const offre: { valeur: Offre } = { valeur: o.offre ?? 'pro' };
  const store = new FauxMisesEnLigne(horloge);
  const rows = new Map<string, WorkflowRow>([
    [WF, ligne(WF, 'Qualification', V1, BROUILLON)],
    [WF2, ligne(WF2, 'Accueil', graphe(bloc('x', 'Salut')), null)],
  ]);
  const publies: Array<{ id: string; blocs: number }> = [];
  const scenarios: DepsMisesEnLigne['scenarios'] = {
    getById: async (id, t) => {
      const r = rows.get(id);
      return r && r.tenantId === t ? structuredClone(r) : null;
    },
    list: async (t, rayon) => [...rows.values()].filter((r) => r.tenantId === t && r.rayon === rayon).map((r) => structuredClone(r)),
    // La règle de `PgWorkflowStore.publish` : le brouillon de même forme part avec sa disposition, sinon le graphe jugé.
    publish: async (id, t, g) => {
      const r = rows.get(id);
      if (!r || r.tenantId !== t) return null;
      if (g !== undefined) {
        const memeForme = r.draftGraph != null && sansPositions(r.draftGraph) === sansPositions(g);
        r.graph = memeForme ? r.draftGraph! : g;
        if (memeForme) r.draftGraph = null;
      }
      publies.push({ id, blocs: r.graph.nodes.length });
      return structuredClone(r);
    },
    programmer: async () => ({ le: '2026-11-24T10:00:00.000Z' }),
  };
  const versions = new Map<string, VersionScenarioLue>();
  const reglage = {
    mbaEnabled: false, repondeurMode: 'equipe' as ModeRepondeur, repondeurAgentId: null as string | null,
    repondeurWorkflowId: null as string | null, repondeurAdresseId: null as string | null, repondeurDelaiScenarioS: 86400,
  };
  const reglagesEcrits: string[] = [];
  const nonAttendu = (nom: string) => async (): Promise<never> => { throw new Error(`${nom} ne devrait pas être appelée`); };
  const repondeur: DepsReglageRepondeur = {
    agents: { complet: async () => null },
    scenarios: { getById: async (id, t) => scenarios.getById(id, t), listResume: async () => [] },
    reglages: {
      get: async () => ({ ...reglage }),
      setRepondeur: async (_t, c) => {
        reglagesEcrits.push(c.mode === 'scenario' ? `scenario:${c.workflowId}:${c.delaiS}` : c.mode);
        if (c.mode === 'scenario') Object.assign(reglage, { repondeurMode: 'scenario', repondeurWorkflowId: c.workflowId, repondeurDelaiScenarioS: c.delaiS });
      },
    },
    gatewayDisponible: true,
    activation: {
      numeroDuTenant: nonAttendu('numeroDuTenant'), eligible: nonAttendu('eligible'), ecrireChezMeta: nonAttendu('ecrireChezMeta'),
      ecrireDrapeau: nonAttendu('ecrireDrapeau'), alignerAudience: async () => {},
    },
    liste: { toutRetirer: nonAttendu('toutRetirer') },
    historique: { ecrire: async () => {} },
    fils: { reprendreLesFilsDeMeta: nonAttendu('reprendreLesFilsDeMeta') },
    offres: { offreDe: async () => ({ offre: offre.valeur, droits: DROITS[offre.valeur], retourEnBaseLe: null }) },
    adresses: { lire: async () => null, lister: async () => [] },
  };
  const audit: Array<{ action: string; userId: string | null; detail?: Record<string, unknown> }> = [];
  const deps: DepsMisesEnLigne = {
    store,
    scenarios,
    versions: {
      lire: async (t, wf, n) => versions.get(`${t}:${wf}:${n}`) ?? null,
      lister: async (t, wf) => [...versions.entries()].filter(([k]) => k.startsWith(`${t}:${wf}:`)).map(([, v]) => v).sort((a, b) => b.numero - a.numero),
    },
    publication: { ...modelesDeBlocInertes.publication, ...o.publication },
    repondeur,
    envois: o.envois ?? envoisAuOuiInertes,
    audit: async (_t, actor, action, _cible, detail) => { audit.push({ action, userId: actor.userId, ...(detail ? { detail } : {}) }); },
    maintenant: () => horloge.now,
  };
  const ajouterVersion = (wf: string, numero: number, g: WorkflowGraph): void => {
    versions.set(`${T}:${wf}:${numero}`, { numero, publieeLe: '2026-11-20T09:00:00.000Z', blocs: g.nodes.length, graph: g });
  };
  return { deps, store, rows, publies, reglage, reglagesEcrits, audit, horloge, ajouterVersion, offre };
}

export const ACTIVER: DemandeAction[] = [{ type: 'repondeur', scenario: WF }, { type: 'publier', scenario: WF }];

export async function proposee(m: ReturnType<typeof monter>, demandes: DemandeAction[] = ACTIVER): Promise<string> {
  const r = await proposer(m.deps, T, CSM, demandes);
  if (!r.ok) throw new Error(`proposition refusée : ${r.erreur}`);
  return r.valeur.id;
}
