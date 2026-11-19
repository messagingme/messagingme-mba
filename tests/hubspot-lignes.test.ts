import { describe, it, expect, vi } from 'vitest';
import { configDeLaBase, configEnBase, lireConfig, nomParDefaut, scenariosLancesParWorkflow, MESSAGES, DELAI_RDV_MAX_MINUTES, type LigneHubspot, type FamilleLigneHubspot, type ConfigLigneHubspot } from '../src/hubspot/lignes';
import { creerLigne, etatDesLignes, reglerLigne, supprimerLigne, REFUS_A_COMPLETER, REFUS_A_COMPLETER_WORKFLOW, REFUS_LIGNE_INCONNUE, type DepsLignesHubspot } from '../src/hubspot/lignes-gestion';
import { MARQUE_PREMIER_BLOC, blocVerrouille } from '../src/shopify/premier-bloc';
import type { WorkflowGraph } from '../src/workflow/graph';
import type { WorkflowRow } from '../src/workflow/store.pg';
import type { Rayon } from '../src/workflow/rayon';
import type { ParamHint } from '../src/crm/template-hints.pg';
import type { TemplateSummary } from '../src/meta/templates';

/**
 * LES LIGNES HUBSPOT (menu « Scénario », lot 6b, tâche 4) : la configuration de chaque famille, et la gestion que les routes
 * de l'écran Automation > HubSpot appellent. Les faux magasins sont des CLASSES dont les méthodes lisent `this` : un câblage
 * qui détacherait une méthode perdrait son `this` sans erreur de compilation (règle du dépôt).
 */

const T = 't1';

describe('la configuration d’une ligne, famille par famille', () => {
  it('étape : la paire pipeline et étape ; le libellé tel qu’envoyé', () => {
    expect(lireConfig('etape', { pipelineId: 'default', stageId: 'closedwon', stageLabel: ' Gagné ' }))
      .toEqual({ ok: true, config: { pipelineId: 'default', stageId: 'closedwon', stageLabel: ' Gagné ' } });
    for (const brut of [{}, { pipelineId: 'default' }, { pipelineId: 'p', stageId: 'a:b' }, { pipelineId: 'p', stageId: 's', autre: 1 }]) {
      expect(lireConfig('etape', brut), JSON.stringify(brut)).toEqual({ ok: false, message: MESSAGES.etape });
    }
  });

  it('🔴 rendez-vous : une propriété hs_, avant ou après, un délai entier de 1 minute à 30 jours', () => {
    expect(lireConfig('rdv', { fieldKey: 'hs_date_rdv', sens: 'avant', delaiMinutes: 1440 }))
      .toEqual({ ok: true, config: { fieldKey: 'hs_date_rdv', sens: 'avant', delaiMinutes: 1440 } });
    expect(lireConfig('rdv', { fieldKey: 'date_rdv', sens: 'avant', delaiMinutes: 60 })).toEqual({ ok: false, message: MESSAGES.rdvChamp });
    expect(lireConfig('rdv', { fieldKey: 'hs_x', sens: 'pendant', delaiMinutes: 60 })).toEqual({ ok: false, message: MESSAGES.rdvSens });
    for (const delaiMinutes of [0, -5, 1.5, DELAI_RDV_MAX_MINUTES + 1]) {
      expect(lireConfig('rdv', { fieldKey: 'hs_x', sens: 'apres', delaiMinutes }), String(delaiMinutes)).toEqual({ ok: false, message: MESSAGES.rdvDelai });
    }
    expect(lireConfig('rdv', { fieldKey: 'hs_x', sens: 'apres', delaiMinutes: DELAI_RDV_MAX_MINUTES }).ok).toBe(true);
  });

  it('lancé par un workflow : aucune configuration', () => {
    expect(lireConfig('workflow', {})).toEqual({ ok: true, config: {} });
    expect(lireConfig('workflow', undefined)).toEqual({ ok: true, config: {} });
    expect(lireConfig('workflow', { stageId: 's' })).toEqual({ ok: false, message: MESSAGES.workflow });
  });

  it('🔴 le rendez-vous s’écrit dans la forme du déclencheur de date, et se relit à l’identique', () => {
    const rdv = { fieldKey: 'hs_date_rdv', sens: 'apres' as const, delaiMinutes: 90 };
    expect(configEnBase('rdv', rdv)).toEqual({ fieldKey: 'hs_date_rdv', delai: 90, unite: 'minutes', sens: 'apres' });
    expect(configDeLaBase('rdv', configEnBase('rdv', rdv))).toEqual(rdv);
    expect(configDeLaBase('rdv', { fieldKey: 'hs_x', delai: 2, unite: 'heures', sens: 'avant' })).toEqual({ fieldKey: 'hs_x', sens: 'avant', delaiMinutes: 120 });
    expect(configDeLaBase('rdv', { fieldKey: '' })).toBeNull();
    expect(configDeLaBase('etape', { stageId: 's' })).toBeNull();
  });

  it('le nom par défaut du scénario', () => {
    expect(nomParDefaut('etape', { pipelineId: 'p', stageId: 's', stageLabel: 'Devis envoyé' })).toBe('Étape Devis envoyé');
    expect(nomParDefaut('etape', { pipelineId: 'p', stageId: '123' })).toBe('Étape 123');
    expect(nomParDefaut('rdv', { fieldKey: 'hs_date_rdv', sens: 'avant', delaiMinutes: 60 })).toBe('Rendez-vous hs_date_rdv');
  });
});

/** Le magasin des lignes, en mémoire. */
class FauxLignes {
  readonly lignes: LigneHubspot[] = [];
  private suivant = 1;
  async lister(t: string) { return t === T ? this.lignes.map((l) => ({ ...l })) : []; }
  async lire(t: string, id: string) { const l = t === T ? this.lignes.find((x) => x.id === id) : undefined; return l ? { ...l } : null; }
  async creer(_t: string, l: { famille: FamilleLigneHubspot; config: ConfigLigneHubspot; workflowId: string; nom: string }) {
    const id = `00000000-0000-4000-8000-00000000000${this.suivant++}`;
    this.lignes.push({ id, famille: l.famille, config: l.config, actif: false, workflowId: l.workflowId, nom: l.nom });
    return { id };
  }
  async etapeReglee(_t: string, pipelineId: string, stageId: string) {
    return this.lignes.some((l) => l.famille === 'etape' && 'stageId' in l.config && l.config.pipelineId === pipelineId && l.config.stageId === stageId);
  }
  async allumer(_t: string, id: string, actif: boolean) { const l = this.lignes.find((x) => x.id === id); if (l) l.actif = actif; return !!l; }
  async supprimer(_t: string, id: string) { const i = this.lignes.findIndex((x) => x.id === id); if (i >= 0) this.lignes.splice(i, 1); return i >= 0; }
}

/** Le magasin des scénarios, en mémoire : `insert` écrit un brouillon, `publish` le met en ligne. */
class FauxScenarios {
  readonly scenarios = new Map<string, WorkflowRow>();
  readonly programmes = new Set<string>();
  private suivant = 1;
  async insert(t: string, name: string, graph: WorkflowGraph, rayon: Rayon) {
    const id = `wf-${this.suivant++}`;
    this.scenarios.set(id, { id, tenantId: t, name, code: `scn_${id}`, graph: { nodes: [], edges: [] }, draftGraph: graph, publishedAt: null, createdAt: 'x', updatedAt: 'x', rayon });
    return { id };
  }
  async publish(id: string, _t: string, graphe?: WorkflowGraph) {
    const w = this.scenarios.get(id);
    if (!w) return null;
    const publie = { ...w, graph: graphe ?? w.draftGraph ?? w.graph, draftGraph: null, publishedAt: 'x' };
    this.scenarios.set(id, publie);
    return publie;
  }
  async getById(id: string, t: string) { const w = this.scenarios.get(id); return w && w.tenantId === t ? w : null; }
  async publicationProgrammee(id: string) { return this.programmes.has(id) ? { graphe: { nodes: [], edges: [] }, le: 'x', par: null } : null; }
  /** Le marchand écrit le template du premier bloc, et le publie. */
  ecrireTemplate(id: string, templateName: string) {
    const w = this.scenarios.get(id)!;
    const nodes = w.graph.nodes.map((n) => (n.id === 'depart' ? { ...n, data: { ...n.data, templateName, language: 'fr' } } : n));
    this.scenarios.set(id, { ...w, graph: { nodes, edges: w.graph.edges } });
  }
}

class FauxIndices { async get(): Promise<ParamHint[]> { return []; } }

function banc(o: { champs?: Array<{ key: string; type: string }>; modeles?: TemplateSummary[] | 'panne'; choix?: { automations: boolean; workflows: boolean }; reliee?: boolean } = {}) {
  const lignes = new FauxLignes();
  const workflows = new FauxScenarios();
  const arrets: Array<{ prefixe: string; motif: string }> = [];
  const deps: DepsLignesHubspot = {
    lignes, workflows, indices: new FauxIndices(),
    parcours: { arreterParcours: async (_t, cible, motif) => { if ('prefixe' in cible) arrets.push({ prefixe: cible.prefixe, motif }); return 0; } },
    modeles: async () => { if (o.modeles === 'panne') throw new Error('Meta indisponible'); return o.modeles ?? []; },
    champs: async () => (o.champs ?? [{ key: 'hs_date_rdv', type: 'datetime' }, { key: 'hs_ville', type: 'text' }]) as never,
    choix: async () => o.choix ?? { automations: true, workflows: true },
    ligneHubspot: async () => (o.reliee === false ? 'coupee' : 'reliee'),
  };
  return { deps, lignes, workflows, arrets };
}

const ETAPE = { pipelineId: 'default', stageId: 'closedwon', stageLabel: 'Gagné' };

describe('créer une ligne', () => {
  it('🔴 étape : un scénario du rayon hubspot, PUBLIÉ, au premier bloc template verrouillé, et la ligne ÉTEINTE', async () => {
    const m = banc();
    const r = await creerLigne(m.deps, T, { famille: 'etape', config: ETAPE });
    expect(r).toMatchObject({ ok: true, valeur: { famille: 'etape', config: ETAPE, actif: false, scenario: 'Étape Gagné', modele: null, blocs: 1 } });
    const wf = [...m.workflows.scenarios.values()][0]!;
    expect(wf).toMatchObject({ rayon: 'hubspot', draftGraph: null });
    expect(blocVerrouille(wf.graph)?.data).toEqual({ [MARQUE_PREMIER_BLOC]: true });
  });

  it('🔴 lancé par un workflow : son premier bloc template n’est PAS verrouillé (décision 41) ; le nom donné est le sien', async () => {
    const m = banc();
    const r = await creerLigne(m.deps, T, { famille: 'workflow', config: {}, nom: '  Devis avec PDF ' });
    expect(r).toMatchObject({ ok: true, valeur: { famille: 'workflow', config: {}, scenario: 'Devis avec PDF' } });
    const wf = [...m.workflows.scenarios.values()][0]!;
    expect(wf.rayon).toBe('hubspot');
    expect(wf.graph.nodes).toHaveLength(1);
    expect(blocVerrouille(wf.graph)).toBeNull();
  });

  it('🔴 une étape déjà réglée (la même paire) est refusée en 409, rien n’est créé ; une autre paire passe', async () => {
    const m = banc();
    await creerLigne(m.deps, T, { famille: 'etape', config: ETAPE });
    const doublon = await creerLigne(m.deps, T, { famille: 'etape', config: { ...ETAPE, stageLabel: 'Autre libellé' } });
    expect(doublon).toMatchObject({ ok: false, statut: 409, code: 'etape_deja_reglee', message: expect.stringContaining('a déjà sa ligne') });
    expect(m.workflows.scenarios.size).toBe(1);
    expect((await creerLigne(m.deps, T, { famille: 'etape', config: { ...ETAPE, pipelineId: 'autre' } })).ok).toBe(true);
  });

  it('🔴 rendez-vous : une propriété qui n’est pas une date et heure déclarée dans l’espace est refusée, rien n’est créé', async () => {
    const m = banc();
    for (const fieldKey of ['hs_ville', 'hs_absent']) {
      const r = await creerLigne(m.deps, T, { famille: 'rdv', config: { fieldKey, sens: 'avant', delaiMinutes: 60 } });
      expect(r, fieldKey).toMatchObject({ ok: false, statut: 400, message: expect.stringContaining('Tools > Intégrations > HubSpot') });
    }
    expect(m.workflows.scenarios.size).toBe(0);
    expect((await creerLigne(m.deps, T, { famille: 'rdv', config: { fieldKey: 'hs_date_rdv', sens: 'avant', delaiMinutes: 60 } })).ok).toBe(true);
  });

  it('une configuration illisible : 400 avec la phrase de la famille', async () => {
    expect(await creerLigne(banc().deps, T, { famille: 'etape', config: {} })).toEqual({ ok: false, statut: 400, message: MESSAGES.etape });
  });
});

describe('l’interrupteur d’une ligne', () => {
  it('🔴 allumer sans premier template publié : 409 a_completer, la ligne reste éteinte ; avec, elle s’allume', async () => {
    const m = banc();
    const etape = await creerLigne(m.deps, T, { famille: 'etape', config: ETAPE });
    const id = etape.ok ? etape.valeur.id : '';
    expect(await reglerLigne(m.deps, T, id, true)).toEqual({ ok: false, statut: 409, message: REFUS_A_COMPLETER, code: 'a_completer' });
    expect(m.lignes.lignes[0]!.actif).toBe(false);
    m.workflows.ecrireTemplate(etape.ok ? etape.valeur.workflowId : '', 'devis_gagne');
    expect(await reglerLigne(m.deps, T, id, true)).toMatchObject({ ok: true, valeur: { actif: true, modele: 'devis_gagne', langue: 'fr' } });
  });

  it('🔴 un scénario lancé par un workflow s’allume dès que son ouverture est un template publié', async () => {
    const m = banc();
    const w = await creerLigne(m.deps, T, { famille: 'workflow', config: {} });
    const id = w.ok ? w.valeur.id : '';
    expect(await reglerLigne(m.deps, T, id, true)).toEqual({ ok: false, statut: 409, message: REFUS_A_COMPLETER_WORKFLOW, code: 'a_completer' });
    m.workflows.ecrireTemplate(w.ok ? w.valeur.workflowId : '', 'devis_avec_pdf');
    expect(await reglerLigne(m.deps, T, id, true)).toMatchObject({ ok: true, valeur: { actif: true, modele: 'devis_avec_pdf' } });
  });

  it('🔴 éteindre une ligne allumée arrête ses parcours par le préfixe de SA ligne ; une ligne de workflow n’en arrête aucun', async () => {
    const m = banc();
    const etape = await creerLigne(m.deps, T, { famille: 'etape', config: ETAPE });
    const w = await creerLigne(m.deps, T, { famille: 'workflow', config: {} });
    for (const l of m.lignes.lignes) l.actif = true;
    const idEtape = etape.ok ? etape.valeur.id : '';
    expect((await reglerLigne(m.deps, T, idEtape, false)).ok).toBe(true);
    expect((await reglerLigne(m.deps, T, w.ok ? w.valeur.id : '', false)).ok).toBe(true);
    expect(m.arrets).toEqual([{ prefixe: `hubspot:etape:${idEtape}:`, motif: 'ligne HubSpot éteinte' }]);
    // Éteindre une ligne déjà éteinte n'arrête rien de plus.
    await reglerLigne(m.deps, T, idEtape, false);
    expect(m.arrets).toHaveLength(1);
  });

  it('une ligne inconnue, ou d’un autre espace : 404', async () => {
    const m = banc();
    const etape = await creerLigne(m.deps, T, { famille: 'etape', config: ETAPE });
    expect(await reglerLigne(m.deps, T, '00000000-0000-4000-8000-0000000000ff', true)).toEqual({ ok: false, statut: 404, message: REFUS_LIGNE_INCONNUE });
    expect(await reglerLigne(m.deps, 'autre', etape.ok ? etape.valeur.id : '', false)).toEqual({ ok: false, statut: 404, message: REFUS_LIGNE_INCONNUE });
  });
});

describe('supprimer une ligne', () => {
  it('🔴 la ligne disparaît et ses parcours s’arrêtent ; son scénario reste', async () => {
    const m = banc();
    const rdv = await creerLigne(m.deps, T, { famille: 'rdv', config: { fieldKey: 'hs_date_rdv', sens: 'avant', delaiMinutes: 60 } });
    const id = rdv.ok ? rdv.valeur.id : '';
    expect(await supprimerLigne(m.deps, T, id)).toEqual({ ok: true, valeur: null });
    expect(m.lignes.lignes).toEqual([]);
    expect(m.workflows.scenarios.size).toBe(1);
    expect(m.arrets).toEqual([{ prefixe: `hubspot:rdv:${id}:`, motif: 'ligne HubSpot supprimée' }]);
    expect(await supprimerLigne(m.deps, T, id)).toEqual({ ok: false, statut: 404, message: REFUS_LIGNE_INCONNUE });
  });
});

describe('l’état de l’écran', () => {
  it('🔴 relié, les deux interrupteurs, et chaque ligne avec son template PUBLIÉ et son statut chez Meta', async () => {
    const m = banc({
      choix: { automations: false, workflows: true },
      modeles: [{ name: 'devis_gagne', language: 'fr', status: 'APPROVED' } as TemplateSummary],
    });
    const etape = await creerLigne(m.deps, T, { famille: 'etape', config: ETAPE });
    const wfId = etape.ok ? etape.valeur.workflowId : '';
    m.workflows.ecrireTemplate(wfId, 'devis_gagne');
    m.workflows.programmes.add(wfId);
    // Un brouillon pas encore publié ne compte pas : le modèle se lit sur le graphe EN LIGNE.
    const w = m.workflows.scenarios.get(wfId)!;
    m.workflows.scenarios.set(wfId, { ...w, draftGraph: { nodes: [], edges: [] } });
    const etat = await etatDesLignes(m.deps, T);
    expect(etat).toMatchObject({ connecte: true, automationsCoupees: true, workflowsCoupes: false });
    expect(etat.lignes).toEqual([{
      id: etape.ok ? etape.valeur.id : '', famille: 'etape', config: ETAPE, actif: false, workflowId: wfId, scenario: 'Étape Gagné',
      modele: 'devis_gagne', langue: 'fr', etatChezMeta: 'APPROVED', blocs: 1, versionProgrammee: true,
    }]);
  });

  it('non relié : `connecte` est un booléen faux ; Meta en panne : les lignes se lisent sans statut', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = banc({ reliee: false, modeles: 'panne' });
    await creerLigne(m.deps, T, { famille: 'workflow', config: {} });
    const etat = await etatDesLignes(m.deps, T);
    expect(etat.connecte).toBe(false);
    expect(etat.lignes).toHaveLength(1);
    expect(etat.lignes[0]!.etatChezMeta).toBeNull();
  });
});

describe('les scénarios qu’un workflow HubSpot lance (lot 6b, décision 41)', () => {
  it('🔴 les scénarios en ligne du rayon HubSpot que vise une ligne « lancés par un workflow » allumée, et eux seuls', async () => {
    const rayons: Rayon[] = [];
    const publie = (code: string | null) => ({ code, name: String(code), publishedAt: null, graph: { nodes: [], edges: [] } });
    const workflows = { listPublies: async (_t: string, rayon: Rayon) => { rayons.push(rayon); return [publie('scn_devis'), publie('scn_etape'), publie(null)]; } };
    const lignes = { codesLancesParWorkflow: async (t: string) => new Set(t === 't1' ? ['scn_devis', 'scn_ailleurs'] : []) };
    expect((await scenariosLancesParWorkflow(workflows, lignes, 't1')).map((s) => s.code)).toEqual(['scn_devis']);
    expect(await scenariosLancesParWorkflow(workflows, lignes, 't2')).toEqual([]);
    expect(rayons).toEqual(['hubspot', 'hubspot']);
  });
});
