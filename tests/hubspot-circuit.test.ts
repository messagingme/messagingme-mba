import { describe, it, expect } from 'vitest';
import { nomDansCampagnes, servirLigneHubspot, type DepsCircuitHubspot, type EvenementDeLigne } from '../src/hubspot/circuit';
import { origineHubspot } from '../src/hubspot/origine';
import { PREFIXE_LIGNE_HUBSPOT } from '../src/hubspot-workflow/ligne';
import type { LigneHubspot } from '../src/hubspot/lignes';
import type { OptionsEnvoiPublic, ResultatEnvoiPublic } from '../src/api/envoi-public';
import type { WorkflowGraph } from '../src/workflow/graph';
import type { WorkflowRow } from '../src/workflow/store.pg';
import type { ParamHint } from '../src/crm/template-hints.pg';
import { DROITS, type Offre } from '../src/offres/offres';

/**
 * LE CIRCUIT D'UNE LIGNE HUBSPOT (menu « Scénario », lot 6b, tâches 1 et 2) : le premier bloc publié part par le cœur public,
 * sans consentement écrit et Service seulement, la clé est l'origine, le pont naît en `evenement_hubspot` quand le bloc a une
 * suite, et le plafond par ligne borne une étape changée en masse (décision 36).
 */
const L1 = '11111111-1111-4111-8111-111111111111';
const LIGNE: LigneHubspot = { id: L1, famille: 'etape', config: { pipelineId: 'default', stageId: 'closedwon', stageLabel: 'Gagné' }, actif: true, workflowId: 'wf-1', nom: 'Étape Gagné' };
const ORIGINE = origineHubspot({ famille: 'etape', ligne: L1, deal: '42', etape: 'closedwon', le: new Date('2026-11-19T10:00:00Z') })!;

const marque = (data: Record<string, unknown> = {}) => ({ id: 'depart', type: 'template' as const, position: { x: 0, y: 0 }, data: { verrouille: true, templateName: 'bienvenue', language: 'fr', ...data } });
const graphe = (o: { suite?: boolean; data?: Record<string, unknown>; sansMarque?: boolean } = {}): WorkflowGraph => ({
  nodes: [
    o.sansMarque ? { ...marque(o.data), data: { templateName: 'bienvenue', language: 'fr' } } : marque(o.data),
    { id: 'suite', type: 'tag', position: { x: 0, y: 0 }, data: { tag: 'x' } },
  ],
  edges: o.suite === false ? [] : [{ id: 'e', source: 'depart', target: 'suite' }],
});

function monter(o: {
  graphe?: WorkflowGraph; rayon?: WorkflowRow['rayon']; indices?: ParamHint[]; filiere?: 'api' | 'application' | null; offre?: Offre;
  tires?: number; claim?: boolean; reponse?: ResultatEnvoiPublic;
} = {}) {
  const envois: Array<{ t: string; corps: unknown; options: OptionsEnvoiPublic }> = [];
  const tirs: string[] = [];
  const deps: DepsCircuitHubspot = {
    envoyer: async (t, corps, _compter, options) => { envois.push({ t, corps, options }); return o.reponse ?? { statut: 201, corps: { sendId: 's1', recipientCount: 1, skipped: [] } }; },
    filiere: async () => o.filiere ?? 'api',
    lectures: {
      workflows: { getById: async (id, t) => (id === 'wf-1' && t === 't1' ? { id, rayon: o.rayon ?? 'hubspot', graph: o.graphe ?? graphe() } as WorkflowRow : null) },
      indices: { get: async () => o.indices ?? [] },
    },
    offres: { offreDe: async () => ({ offre: o.offre ?? 'entreprise', droits: DROITS[o.offre ?? 'entreprise'], retourEnBaseLe: null }) },
    tirs: {
      firedSince: async (id) => { tirs.push(`compte:${id}`); return o.tires ?? 0; },
      markFired: async (id, waId, marqueur) => { tirs.push(`tir:${id}:${waId}:${marqueur ?? ''}`); return o.claim ?? true; },
      clearFired: async (id, waId) => { tirs.push(`efface:${id}:${waId}`); },
    },
    plafondParHeure: 200,
    now: () => Date.parse('2026-11-19T10:00:00Z'),
  };
  return { deps, envois, tirs };
}
const EV: EvenementDeLigne = { ligne: LIGNE, telephone: '+33612345678', waId: '33612345678', origine: ORIGINE };

describe('le circuit d’une ligne HubSpot', () => {
  it('🔴 le premier bloc part par le cœur public : clé = origine, aucun consentement, Service seulement, le pont en evenement_hubspot', async () => {
    const m = monter();
    expect(await servirLigneHubspot(m.deps, 't1', EV)).toBe('envoye');
    expect(m.envois).toEqual([{
      t: 't1',
      corps: { idempotencyKey: ORIGINE, target: { template: { name: 'bienvenue', language: 'fr' } }, params: [], recipients: [{ phone: '+33612345678' }] },
      options: {
        nom: 'HubSpot · étape · Étape Gagné', sansCampagneVide: true, serviceSeulement: true,
        parcoursEvenement: { workflowId: 'wf-1', noeudId: 'depart', type: 'evenement_hubspot', origine: ORIGINE, boutons: [] },
      },
    }]);
    expect(JSON.stringify(m.envois[0]!.corps)).not.toContain('consent');
    // Le tir est marqué avant l'envoi et GARDÉ : il compte au plafond.
    expect(m.tirs).toEqual([`compte:${L1}`, `tir:${L1}:33612345678:`]);
  });

  it('sans suite, ou sur une offre sans `scenarios` : le premier message part seul, aucun parcours ne naît', async () => {
    for (const m of [monter({ graphe: graphe({ suite: false }) }), monter({ offre: 'base' })]) {
      expect(await servirLigneHubspot(m.deps, 't1', EV)).toBe('envoye');
      expect(m.envois[0]!.options).not.toHaveProperty('parcoursEvenement');
    }
  });

  it('🔴 un premier bloc à compléter (scénario d’un autre rayon, sans marque, sans template) : rien ne part, rien n’est compté', async () => {
    for (const m of [monter({ rayon: 'general' }), monter({ graphe: graphe({ sansMarque: true }) }), monter({ graphe: graphe({ data: { templateName: '' } }) })]) {
      expect(await servirLigneHubspot(m.deps, 't1', EV)).toBe('a_completer');
      expect([m.envois, m.tirs]).toEqual([[], []]);
    }
  });

  it('🔴 une source `variable` dans le premier bloc : rien à lire (les données du deal sont sur la fiche), rien ne part', async () => {
    const m = monter({ indices: [{ position: 1, source: { type: 'variable', key: 'montant' } }] });
    expect(await servirLigneHubspot(m.deps, 't1', EV)).toBe('donnee_manquante');
    expect(m.envois).toEqual([]);
  });

  it('🔴 le plafond par ligne atteint (décision 36) : rien ne part, rien n’est marqué', async () => {
    const m = monter({ tires: 200 });
    expect(await servirLigneHubspot(m.deps, 't1', EV)).toBe('plafond');
    expect(m.envois).toEqual([]);
    expect(m.tirs).toEqual([`compte:${L1}`]);
    expect(await servirLigneHubspot(monter({ tires: 199 }).deps, 't1', EV)).toBe('envoye');
  });

  it('🔴 un rendez-vous déjà tiré pour cette date (claim perdu) : rien ne part', async () => {
    const m = monter({ claim: false });
    expect(await servirLigneHubspot(m.deps, 't1', { ...EV, marqueur: '2026-11-20T09:00:00Z' })).toBe('deja_tire');
    expect(m.envois).toEqual([]);
    expect(m.tirs).toEqual([`compte:${L1}`, `tir:${L1}:33612345678:2026-11-20T09:00:00Z`]);
  });

  it('🔴 rien n’est parti (STOP, Marketing refusé, numéro relié par QR code) : le tir est effacé, une tentative suivante le regagne', async () => {
    const cas: Array<[ReturnType<typeof monter>, string]> = [
      [monter({ reponse: { statut: 200, corps: { sendId: '', recipientCount: 0, skipped: [{ index: 0, reason: 'opted_out' }] } } }), 'desabonne'],
      [monter({ reponse: { statut: 422, corps: { code: 'template_rejected', categorie: 'marketing' } } }), 'modele_refuse'],
      [monter({ filiere: 'application' }), 'filiere_differente'],
    ];
    for (const [m, issue] of cas) {
      expect(await servirLigneHubspot(m.deps, 't1', EV), issue).toBe(issue);
      expect(m.tirs.at(-1), issue).toBe(`efface:${L1}:33612345678`);
    }
    // Un envoi en cours (une autre copie) garde le tir.
    const enCours = monter({ reponse: { statut: 409, corps: { code: 'idempotency_in_progress' } } });
    expect(await servirLigneHubspot(enCours.deps, 't1', EV)).toBe('en_cours');
    expect(enCours.tirs.some((t) => t.startsWith('efface'))).toBe(false);
  });

  it('🔴 le nom dans Campagnes ne prend jamais le préfixe des workflows (il déciderait `workflow_hubspot` et les leviers)', () => {
    for (const nom of ['workflow devis', 'Étape Gagné', '']) {
      for (const famille of ['etape', 'rdv'] as const) expect(nomDansCampagnes({ famille, nom }).startsWith(PREFIXE_LIGNE_HUBSPOT)).toBe(false);
    }
  });
});
