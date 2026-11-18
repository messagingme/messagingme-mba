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
import type { RunState, WorkflowRunRow } from '../src/workflow/run-store.pg';
import { PLAFOND_ATTENTE_EVENEMENT_MS, type EvenementDuParcours } from '../src/workflow/evenement';
import { walk } from '../src/workflow/engine';
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
    n('tpl', 'template', { templateName: 'panier_relance', language: 'fr', templateButtons: [{ type: 'QUICK_REPLY', text: 'Reprendre' }, { type: 'QUICK_REPLY', text: 'Plus tard' }] }),
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
  /** L'horloge de l'exécuteur (`now`), pour lire une échéance. */
  maintenant?: number;
  /** Le scénario du panier, remplacé. */
  scenario?: Pick<WorkflowRow, 'graph' | 'draftGraph' | 'rayon'>;
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
    ...(o.maintenant !== undefined ? { now: () => o.maintenant as number } : {}),
  };
  const executor = new WorkflowExecutor(deps);
  const offre = o.offre ?? 'entreprise';
  const lancements = creerLancements({
    executor,
    scenarios: { getById: async (id) => (id === 'wf-panier' && o.scenario ? o.scenario : SCENARIOS[id] ?? null) },
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

/**
 * LES REPRISES D'UN PARCOURS D'ÉVÉNEMENT (lot 4, décisions 20, 21 et 31) : la réponse du contact (`advance`) et le réveil
 * d'une échéance (`resume`), sur le vrai exécuteur et le vrai contrôle du fil. Un parcours ordinaire ne change pas : ses
 * suites existantes (`workflow-advance-gele`, `scenario-fil-non-repris`, ...) restent vertes sans toucher leurs attentes.
 */
const PANIER_DELAI: WorkflowGraph = {
  nodes: [
    n('tpl', 'template', { templateName: 'panier_relance', language: 'fr', templateButtons: [{ type: 'QUICK_REPLY', text: 'Reprendre' }, { type: 'QUICK_REPLY', text: 'Plus tard' }], timeoutValue: 30, timeoutUnit: 'minutes' }),
    n('qm1', 'quick_message', { body: 'Voici votre panier' }),
    n('qm2', 'quick_message', { body: 'À bientôt' }),
    n('tpl2', 'template', { templateName: 'panier_rappel', language: 'fr' }),
    n('j', 'aller_a', { cible: 'code-autre' }),
  ],
  edges: [
    { id: 'e1', source: 'tpl', target: 'qm1', sourceHandle: 'btn:0' },
    { id: 'e2', source: 'tpl', target: 'j', sourceHandle: 'btn:1' },
    { id: 'e3', source: 'tpl', target: 'tpl2', sourceHandle: 'timeout' },
  ],
};
/** Le scénario du répondeur qui coexiste : une question, et une relance à son échéance. */
const REPONDEUR: WorkflowGraph = {
  nodes: [
    n('q', 'question', { body: 'Une question ?', rows: [{ title: 'Oui' }], timeoutValue: 1, timeoutUnit: 'hours' }),
    n('tpl-r', 'template', { templateName: 'repondeur_relance', language: 'fr' }),
  ],
  edges: [{ id: 'r1', source: 'q', target: 'tpl-r', sourceHandle: 'timeout' }],
};
/** Le bloc d'arrivée d'un « Aller à » vers un autre scénario. */
const AUTRE: WorkflowGraph = { nodes: [n('x', 'quick_message', { body: 'Ailleurs' })], edges: [] };

const runEvenement = (o: Partial<WorkflowRunRow> = {}): WorkflowRunRow => ({
  id: 'r-evt', workflowId: 'wf-panier', tenantId: ESPACE, waId: WA, contactId: 'c1', currentNode: 'tpl', status: 'waiting',
  lastMessageId: null, channel: 'whatsapp', grapheFige: null, exigeAccordMarketing: true, neEnMasse: false, evenement: EVENEMENT, ...o,
});
const runOrdinaire = (o: Partial<WorkflowRunRow> = {}): WorkflowRunRow => ({
  id: 'r-ord', workflowId: 'wf-repondeur', tenantId: ESPACE, waId: WA, contactId: 'c1', currentNode: 'q', status: 'waiting',
  lastMessageId: null, channel: 'whatsapp', grapheFige: null, exigeAccordMarketing: false, neEnMasse: false, evenement: null, ...o,
});

interface OptionsReprise {
  detenteur?: ControlOwner;
  /** Le parcours d'événement a-t-il encore lieu d'être (lot 5) ? */
  voulu?: boolean;
  /** Le parcours le plus récent en attente (le défaut : celui de l'événement). */
  dernier?: WorkflowRunRow;
  /** Le graphe du panier lu au réveil (le défaut : le panier à délai). */
  graphe?: WorkflowGraph;
}

function bancReprise(o: OptionsReprise = {}) {
  const b = bancDuFil({ surLaListe: [WA], conversations: { [WA]: { owner: o.detenteur ?? 'app_workflow' } } });
  const envois: string[] = [];
  const ecritures: string[] = [];
  const priseDeMain: string[] = [];
  const auRepondeur: string[] = [];
  const deps: WorkflowExecutorDeps = {
    ...depsInertes,
    estDesabonne: jamaisDesabonne,
    aAccordMarketing: toujoursDAccord,
    isWindowOpen: async () => true,
    parcoursEncoreVoulu: async () => o.voulu ?? true,
    blocDuMessage: async (_t, wamid) => (wamid === 'wamid.tpl' ? { workflowId: 'wf-panier', nodeId: 'tpl' } : null),
    confierAuRepondeur: async (_t, _w, messageId) => { auRepondeur.push(messageId); },
    resoudreBloc: async (_t, cible) => (cible === 'code-autre' ? { workflowId: 'wf-autre', nodeId: 'x', graph: AUTRE } : null),
    runs: avecGardesDEtatInertes({
      start: async () => ({ id: 'r-saut' }),
      findWaitingByWaId: async () => o.dernier ?? runEvenement(),
      findWaitingSurBloc: async (_t: string, _w: string, wf: string, noeud: string) => (wf === 'wf-panier' && noeud === 'tpl' ? runEvenement() : null),
      setState: async (id: string, s: RunState) => { ecritures.push(`${id}:${s.status}`); },
      setStateSiEncoreSur: async (_t: string, id: string, _n: string | null, s: RunState) => { ecritures.push(`${id}:${s.status}`); return true; },
      closeActiveByWaId: async () => [],
      cloreAutresActifs: async (_t: string, _w: string, saufId: string) => { priseDeMain.push(saufId); return []; },
    }),
    getGraph: async (wf) => (wf === 'wf-panier' ? (o.graphe ?? PANIER_DELAI) : wf === 'wf-repondeur' ? REPONDEUR : null),
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
  return { b, executor: new WorkflowExecutor(deps), envois, ecritures, priseDeMain, auRepondeur };
}

const clic = (bouton: string) => ({ reaction: false, messageCite: 'wamid.tpl', type: 'button' as const, bouton });

describe('la réponse du contact à un parcours d’événement (advance)', () => {
  it('🔴 un clic sur un bouton du premier template prend SA branche, et le parcours reprend la main', async () => {
    silence();
    const m = bancReprise();
    await m.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', clic('btn:0'));
    expect(m.envois).toEqual(['qm:Voici votre panier']);
    expect(m.priseDeMain).toEqual(['r-evt']);
  });

  it('🔴 le fil à l’agent de Meta : repris pour l’app, puis la branche part', async () => {
    silence();
    const m = bancReprise({ detenteur: 'mba' });
    await m.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', clic('btn:0'));
    expect(m.b.etat(WA)?.owner).toBe('app_workflow');
    expect(m.envois).toEqual(['qm:Voici votre panier']);
  });

  it('🔴 un opérateur tient le fil : le parcours se CLÔT (un gel garderait la place), rien ne part (décision 20)', async () => {
    silence();
    const m = bancReprise({ detenteur: 'app_human' });
    await m.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', clic('btn:0'));
    expect(m.envois).toEqual([]);
    expect(m.ecritures).toEqual(['r-evt:done']);
    expect(m.b.appels).toEqual([]);
  });

  it('🔴 plus voulu : un clic ne prend plus sa branche, le parcours se clôt sans passer à l’équipe', async () => {
    silence();
    const m = bancReprise({ voulu: false });
    await m.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', clic('btn:0'));
    expect(m.envois).toEqual([]);
    expect(m.ecritures).toEqual(['r-evt:done']);
  });

  it('plus voulu : un message écrit va au répondeur, comme un texte que le scénario n’avait pas prévu', async () => {
    silence();
    const m = bancReprise({ voulu: false });
    await m.executor.advance(ESPACE, WA, 'm1', null, 'whatsapp', { reaction: false, type: 'text', texte: 'bonjour' });
    expect(m.envois).toEqual([]);
    expect(m.ecritures).toEqual(['r-evt:done']);
    expect(m.auRepondeur).toEqual(['m1']);
  });

  it('🔴 deux parcours attendent : le clic sur le template de l’événement va au parcours d’événement, pas au plus récent', async () => {
    silence();
    const m = bancReprise({ dernier: runOrdinaire() });
    await m.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', clic('btn:0'));
    expect(m.envois).toEqual(['qm:Voici votre panier']);
    expect(m.ecritures.every((e) => e.startsWith('r-evt:'))).toBe(true);
  });

  it('🔴 un « Aller à » transmet l’événement au parcours d’arrivée (décision 28)', async () => {
    silence();
    const m = bancReprise();
    const demarrer = vi.spyOn(m.executor, 'demarrer');
    await m.executor.advance(ESPACE, WA, 'm1', 'btn:1', 'whatsapp', clic('btn:1'));
    expect(demarrer).toHaveBeenCalledTimes(1);
    expect(demarrer.mock.calls[0]![5]).toMatchObject({ depuis: 'saut', noeudId: 'x', evenement: EVENEMENT });
  });
});

describe('le réveil d’un parcours d’événement (resume)', () => {
  const echeance = (o: Partial<WorkflowRunRow> = {}) => {
    const r = runEvenement(o);
    return { ...r, status: 'waiting' as const };
  };

  it('🔴 fil à nous : la relance part, et le parcours reprend la main sur ceux qui coexistaient', async () => {
    silence();
    const m = bancReprise();
    expect(await m.executor.resume(echeance())).toBe(true);
    expect(m.envois).toEqual(['tpl:panier_rappel']);
    expect(m.priseDeMain).toEqual(['r-evt']);
  });

  it('🔴 l’agent de Meta tient le fil : repris, puis la relance', async () => {
    silence();
    const m = bancReprise({ detenteur: 'mba' });
    expect(await m.executor.resume(echeance())).toBe(true);
    expect(m.b.etat(WA)?.owner).toBe('app_workflow');
    expect(m.envois).toEqual(['tpl:panier_rappel']);
  });

  it('🔴 un opérateur tient le fil : clos, rien ne part (décision 20)', async () => {
    silence();
    const m = bancReprise({ detenteur: 'app_human' });
    expect(await m.executor.resume(echeance())).toBe(false);
    expect(m.envois).toEqual([]);
    expect(m.ecritures).toEqual(['r-evt:done']);
  });

  it('🔴 plus voulu : clos, rien ne part', async () => {
    silence();
    const m = bancReprise({ voulu: false });
    expect(await m.executor.resume(echeance())).toBe(false);
    expect(m.envois).toEqual([]);
    expect(m.ecritures).toEqual(['r-evt:done']);
  });

  it('décision 31 : un parcours ORDINAIRE qui se réveille pendant un parcours d’événement continue, sans rien clore', async () => {
    silence();
    const m = bancReprise({ dernier: runOrdinaire() });
    expect(await m.executor.resume({ ...runOrdinaire(), status: 'waiting' })).toBe(true);
    expect(m.envois).toEqual(['tpl:repondeur_relance']);
    expect(m.priseDeMain).toEqual([]);
  });
});

/**
 * L'ATTENTE BORNÉE D'UN PARCOURS D'ÉVÉNEMENT (lot 4, décision 29). Sans elle, un template à boutons sans délai (ou un
 * message à boutons, un formulaire, une question sans délai) garderait à vie la place unique du contact, et chaque
 * événement suivant de ce client n'enverrait plus que son premier message.
 */
const MAINTENANT = 1_000_000_000;
const PLAFOND_72_H = 72 * 3600 * 1000;

describe('l’attente bornée d’un parcours d’événement (décision 29)', () => {
  it('🔴 la marche d’un parcours d’événement ne s’arrête pas sur un template sans bouton ni délai ; celle d’un ordinaire, si', () => {
    const g: WorkflowGraph = {
      nodes: [n('a', 'template', { templateName: 'confirmation', language: 'fr' }), n('b', 'template', { templateName: 'merci', language: 'fr' })],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    };
    const evenement = walk(g, 'a', undefined, { evenement: true });
    expect(evenement.actions.map((s) => s.nodeId)).toEqual(['a', 'b']);
    const ordinaire = walk(g, 'a', undefined, {});
    expect(ordinaire.actions.map((s) => s.nodeId)).toEqual(['a']);
    expect(ordinaire.rest).toEqual({ status: 'waiting', nodeId: 'a' });
  });

  it('🔴 à la naissance, une attente sans échéance (boutons, sans délai) reçoit le plafond de 72 h', async () => {
    silence();
    const m = banc({ maintenant: MAINTENANT });
    expect(await m.lancements.lancer(naissance())).toBe(true);
    expect(m.crees[0]!.state.resumeAt).toEqual(new Date(MAINTENANT + PLAFOND_72_H));
    expect(PLAFOND_ATTENTE_EVENEMENT_MS).toBe(PLAFOND_72_H);
  });

  it('un template à délai garde SON délai, pas le plafond', async () => {
    silence();
    const m = banc({ maintenant: MAINTENANT, scenario: { graph: PANIER_DELAI, draftGraph: null, rayon: 'shopify' } });
    expect(await m.lancements.lancer(naissance())).toBe(true);
    expect(m.crees[0]!.state.resumeAt).toEqual(new Date(MAINTENANT + 30 * 60_000));
  });

  it('🔴 une confirmation sans bouton ni délai ne retient pas : la suite part aussitôt, et rien n’attend', async () => {
    silence();
    const confirmation: WorkflowGraph = {
      nodes: [n('tpl', 'template', { templateName: 'panier_relance', language: 'fr' }), n('t2', 'template', { templateName: 'merci', language: 'fr' })],
      edges: [{ id: 'e', source: 'tpl', target: 't2' }],
    };
    const m = banc({ scenario: { graph: confirmation, draftGraph: null, rayon: 'shopify' } });
    expect(await m.lancements.lancer(naissance())).toBe(true);
    expect(m.envois).toEqual(['tpl:merci']);
    expect(m.crees).toEqual([]);
  });

  it('🔴 un parcours ORDINAIRE n’a pas de plafond : son attente sans délai reste sans échéance', async () => {
    silence();
    const m = banc({ detenteur: 'app_workflow', maintenant: MAINTENANT });
    const issue = await m.lancements.lancer({ type: 'campagne_scenario', tenantId: ESPACE, workflowId: 'wf-builder', waId: WA, contactId: 'c1' });
    expect(issue).toBe(true);
    expect(m.crees[0]!.state.resumeAt).toBeUndefined();
  });

  it('🔴 au réveil par le plafond : clos, rien ne part, et la flèche « pas de réponse » laissée sur un template SANS délai n’est pas suivie', async () => {
    silence();
    const residuel: WorkflowGraph = {
      nodes: [...PANIER.nodes, n('tpl2', 'template', { templateName: 'panier_rappel', language: 'fr' })],
      edges: [...PANIER.edges, { id: 'e9', source: 'tpl', target: 'tpl2', sourceHandle: 'timeout' }],
    };
    const m = bancReprise({ graphe: residuel });
    expect(await m.executor.resume({ ...runEvenement(), status: 'waiting' })).toBe(false);
    expect(m.envois).toEqual([]);
    expect(m.ecritures).toEqual(['r-evt:done']);
  });
});
