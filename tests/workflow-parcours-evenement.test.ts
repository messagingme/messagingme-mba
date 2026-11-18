import { describe, it, expect, vi } from 'vitest';
import { jamaisDesabonne, toujoursDAccord } from './consentement';
import { avecGardesDEtatInertes, depsInertes } from './executeur-inerte';
import { bancDuFil, ESPACE } from './banc-du-fil';
import { WorkflowExecutor } from '../src/workflow/executor';
import type { WorkflowExecutorDeps } from '../src/workflow/executor';
import {
  creerLancements, REFUS_EVENEMENT_EN_COURS, REFUS_SCENARIOS_HORS_OFFRE, type DemandeDeLancement,
} from '../src/workflow/lancements';
import type { WorkflowGraph, WorkflowNodeType } from '../src/workflow/graph';
import type { WorkflowRow } from '../src/workflow/store.pg';
import type { ControlOwner } from '../src/inbox/store.pg';
import type { RunState } from '../src/workflow/run-store.pg';
import type { EvenementDuParcours } from '../src/workflow/evenement';
import { DROITS, type Offre } from '../src/offres/offres';

/**
 * LE PARCOURS D'UN ÉVÉNEMENT SHOPIFY (menu « Scénario », lot 4, décisions 2, 3, 20, 21, 28 à 31), sur le VRAI exécuteur,
 * la VRAIE entrée de lancement (`creerLancements`) et le VRAI contrôle du fil (`bancDuFil`).
 *
 * Il naît quand le moteur de campagne a vu Meta ACCEPTER le premier template : posé sur ce bloc, sans le renvoyer, avec
 * les données de l'événement. Une seule place d'événement par contact ; devant lui, une automation « Autres » cède, un
 * répondeur coexiste, une campagne le remplace.
 */

const n = (id: string, type: WorkflowNodeType, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data });

/** Le panier abandonné : un template à deux boutons, chacun relié à sa suite. */
const PANIER: WorkflowGraph = {
  nodes: [
    n('tpl', 'template', { templateName: 'panier_relance', language: 'fr', templateButtons: ['Reprendre', 'Plus tard'] }),
    n('qm1', 'quick_message', { body: 'Voici votre panier' }),
    n('qm2', 'quick_message', { body: 'À bientôt' }),
  ],
  edges: [
    { id: 'e1', source: 'tpl', target: 'qm1', sourceHandle: 'btn:0' },
    { id: 'e2', source: 'tpl', target: 'qm2', sourceHandle: 'btn:1' },
  ],
};
/** Le même premier bloc, sans aucune suite : rien à poursuivre, donc aucun parcours. */
const SANS_SUITE: WorkflowGraph = { nodes: [PANIER.nodes[0]!], edges: [] };
/** Un scénario du Builder qui ouvre sur un modèle, pour les autres lancements. */
const BUILDER: WorkflowGraph = { nodes: [n('b', 'template', { templateName: 'bienvenue', language: 'fr' })], edges: [] };

const SCENARIOS: Record<string, Pick<WorkflowRow, 'graph' | 'draftGraph' | 'rayon'>> = {
  'wf-panier': { graph: PANIER, draftGraph: null, rayon: 'shopify' },
  'wf-sans-suite': { graph: SANS_SUITE, draftGraph: null, rayon: 'shopify' },
  'wf-builder': { graph: BUILDER, draftGraph: null, rayon: 'general' },
};

const WA = '33611223344';
const EVENEMENT: EvenementDuParcours = { origine: 'shopify:boutique.myshopify.com:checkouts/create:42', variables: { checkout_url: 'https://x/c/42' } };

/** La demande que le pont du moteur de campagne enverra, après l'acceptation de Meta. */
const naissance = (o: Partial<{ workflowId: string; noeudId: string; nom: string; langue: string }> = {}): DemandeDeLancement => ({
  type: 'evenement_shopify', tenantId: ESPACE, workflowId: o.workflowId ?? 'wf-panier', waId: WA, contactId: 'c1',
  noeudId: o.noeudId ?? 'tpl', modele: { nom: o.nom ?? 'panier_relance', langue: o.langue ?? 'fr' }, evenement: EVENEMENT,
});

interface Options {
  detenteur?: ControlOwner;
  /** Le parcours d'événement déjà actif pour ce contact (`parcoursDEvenementActif`). */
  dejaActif?: boolean;
  /** `start` rend le refus de l'index unique (un autre événement a gagné la course). */
  courseperdue?: boolean;
  offre?: Offre;
}

/** Le vrai exécuteur sur le vrai contrôle du fil ; le faux magasin note ce qu'on lui demande. */
function banc(o: Options = {}) {
  const b = bancDuFil({ surLaListe: [WA], conversations: { [WA]: { owner: o.detenteur ?? 'mba' } } });
  const envois: string[] = [];
  const crees: Array<{ state: RunState; evenement: EvenementDuParcours | null }> = [];
  const clotures: string[] = [];
  const deps: WorkflowExecutorDeps = {
    ...depsInertes,
    estDesabonne: jamaisDesabonne,
    aAccordMarketing: toujoursDAccord,
    runs: avecGardesDEtatInertes({
      // Les deux surcharges du contrat : seul un parcours d'événement peut être refusé par l'index unique.
      start: (async (_t: string, _w: string, _wa: string, _c: string | null, state: RunState, _g: unknown, _e: boolean, _m: boolean, evenement: EvenementDuParcours | null) => {
        if (o.courseperdue && evenement !== null) return { refus: 'evenement_actif' as const };
        crees.push({ state, evenement });
        return { id: 'r-neuf' };
      }) as WorkflowExecutorDeps['runs']['start'],
      findWaitingByWaId: async () => null,
      setState: async () => {},
      closeActiveByWaId: async () => { clotures.push('tous'); return ['r-avant']; },
      closeOrdinairesByWaId: async () => { clotures.push('ordinaires'); return ['r-avant']; },
      parcoursDEvenementActif: async () => (o.dejaActif ? { id: 'r-evenement' } : null),
    }),
    getGraph: async () => null,
    applyTag: async () => true,
    setField: async () => {},
    removeTag: async () => {},
    clearField: async () => {},
    sendTemplate: async (_t, _w, nom) => { envois.push(`tpl:${nom}`); },
    sendQuickMessage: async (_t, _w, texte) => { envois.push(`qm:${texte}`); },
    sendFlow: async () => {},
    sendQuestion: async () => {},
    mayAct: b.fil.peutAgir,
    reclaimControl: b.fil.reprendrePourLApp,
  };
  const executor = new WorkflowExecutor(deps);
  const offre = o.offre ?? 'entreprise';
  const lancements = creerLancements({
    executor,
    scenarios: { getById: async (id) => SCENARIOS[id] ?? null },
    contacts: { findIdByWaId: async () => 'c-fiche' },
    offres: { offreDe: async () => ({ offre, droits: DROITS[offre], retourEnBaseLe: null }) },
  });
  return { b, lancements, envois, crees, clotures };
}

function silence(): void {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('la naissance d’un parcours d’événement, sur le bloc déjà envoyé', () => {
  it('🔴 posé sur le template SANS le renvoyer, il attend ses boutons et porte l’événement', async () => {
    silence();
    const m = banc();
    expect(await m.lancements.lancer(naissance())).toBe(true);
    expect(m.envois, 'le template est déjà parti par le moteur de campagne').toEqual([]);
    expect(m.crees).toHaveLength(1);
    expect(m.crees[0]!.state).toMatchObject({ currentNode: 'tpl', status: 'waiting' });
    expect(m.crees[0]!.evenement).toEqual(EVENEMENT);
  });

  it('🔴 fil tenu par l’agent de Meta : repris pour l’app (le clic sur le premier template ne sera pas gelé)', async () => {
    silence();
    const m = banc({ detenteur: 'mba' });
    expect(await m.lancements.lancer(naissance())).toBe(true);
    expect(m.b.etat(WA)?.owner).toBe('app_workflow');
  });

  it('🔴 un opérateur tient le fil : aucun parcours, et rien n’est demandé à Meta (décision 20)', async () => {
    silence();
    const m = banc({ detenteur: 'app_human' });
    const issue = await m.lancements.lancer(naissance());
    expect(issue).toContain('tenue par un opérateur');
    expect(m.crees).toEqual([]);
    expect(m.b.appels).toEqual([]);
    expect(m.b.etat(WA)?.owner).toBe('app_human');
  });

  it('🔴 un parcours d’événement occupe déjà la place : aucun second, sans rien écrire (décisions 3 et 21)', async () => {
    silence();
    const m = banc({ dejaActif: true });
    expect(await m.lancements.lancer(naissance())).toBe(REFUS_EVENEMENT_EN_COURS);
    expect([m.crees, m.clotures, m.envois, m.b.appels]).toEqual([[], [], [], []]);
    expect(m.b.etat(WA)?.owner).toBe('mba');
  });

  it('🔴 la course perdue à la création (l’index unique) : aucun parcours, et ce n’est pas une exception', async () => {
    silence();
    const m = banc({ courseperdue: true });
    expect(await m.lancements.lancer(naissance())).toBe(REFUS_EVENEMENT_EN_COURS);
    expect(m.crees).toEqual([]);
  });

  it('il ne ferme que les parcours ORDINAIRES du contact (un autre événement, l’index en décide)', async () => {
    silence();
    const m = banc();
    await m.lancements.lancer(naissance());
    expect(m.clotures).toEqual(['ordinaires']);
  });

  it.each([
    ['un bloc qui n’existe plus', { noeudId: 'disparu' }, 'n’est plus un bloc template'],
    ['un bloc qui n’est pas un template', { noeudId: 'qm1' }, 'n’est plus un bloc template'],
    ['le bloc envoie un AUTRE template', { nom: 'autre_modele' }, 'n’envoie plus le template parti'],
    ['le bloc envoie le template dans une autre langue', { langue: 'en' }, 'n’envoie plus le template parti'],
    ['le premier bloc n’a aucune suite', { workflowId: 'wf-sans-suite' }, 'pas de suite'],
  ] as const)('🔴 %s : aucun parcours, rien d’écrit', async (_cas, o, raison) => {
    silence();
    const m = banc();
    const issue = await m.lancements.lancer(naissance(o));
    expect(issue).toContain(raison);
    expect([m.crees, m.clotures, m.b.appels]).toEqual([[], [], []]);
  });

  it('un scénario du Builder n’est pas un scénario d’événement : inconnu pour ce type', async () => {
    const m = banc();
    expect(await m.lancements.lancer(naissance({ workflowId: 'wf-builder', noeudId: 'b', nom: 'bienvenue' }))).toBeNull();
  });

  it('🔴 en Free : aucun parcours, seul le premier message est parti (§ 5.6)', async () => {
    const m = banc({ offre: 'base' });
    expect(await m.lancements.lancer(naissance())).toBe(REFUS_SCENARIOS_HORS_OFFRE);
    expect(m.crees).toEqual([]);
  });
});

describe('devant un parcours d’événement actif : qui cède, qui coexiste, qui remplace (décision 28)', () => {
  it('🔴 une automation « Autres » CÈDE : rien n’est démarré ni écrit', async () => {
    silence();
    const m = banc({ detenteur: 'app_workflow', dejaActif: true });
    const issue = await m.lancements.lancer({
      type: 'automatisme_ordinaire', tenantId: ESPACE, workflowId: 'wf-builder', waId: WA, blocDeDepart: null,
      fenetreOuverte: true, messageDeclencheur: null,
    });
    expect(issue).toBe(REFUS_EVENEMENT_EN_COURS);
    expect([m.crees, m.clotures, m.envois]).toEqual([[], [], []]);
  });

  it('🔴 le scénario répondeur COEXISTE : il démarre et ne ferme que les parcours ordinaires', async () => {
    silence();
    const m = banc({ detenteur: 'app_workflow', dejaActif: true });
    const issue = await m.lancements.lancer({
      type: 'repondeur_scenario', tenantId: ESPACE, workflowId: 'wf-builder', waId: WA, fenetreOuverte: true, messageDeclencheur: null,
    });
    expect(issue).toBe(true);
    expect(m.clotures).toEqual(['ordinaires']);
  });

  it.each([
    ['l’Inbox', { type: 'inbox' as const, fenetreOuverte: true }],
    ['une campagne à scénario', { type: 'campagne_scenario' as const, contactId: 'c1' }],
    ['le lien de test', { type: 'lien_de_test' as const, blocDuJeton: null }],
  ])('🔴 %s REMPLACE : tout parcours en cours est clos, le parcours d’événement compris', async (_cas, d) => {
    silence();
    const m = banc({ detenteur: 'app_workflow', dejaActif: true });
    const issue = await m.lancements.lancer({ tenantId: ESPACE, workflowId: 'wf-builder', waId: WA, ...d } as DemandeDeLancement);
    expect(issue).toBe(true);
    expect(m.clotures).toEqual(['tous']);
  });
});
