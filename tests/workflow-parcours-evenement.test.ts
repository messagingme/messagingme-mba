import { describe, it, expect, vi } from 'vitest';
import { jamaisDesabonne, toujoursDAccord } from './consentement';
import { avecGardesDEtatInertes, depsInertes } from './executeur-inerte';
import { bancDuFil, ESPACE } from './banc-du-fil';
import { WorkflowExecutor } from '../src/workflow/executor';
import type { WorkflowExecutorDeps } from '../src/workflow/executor';
import {
  creerLancements, REFUS_DEJA_NE, REFUS_EVENEMENT_EN_COURS, REFUS_EVENEMENT_INVALIDE, REFUS_SCENARIOS_HORS_OFFRE, type DemandeDeLancement,
} from '../src/workflow/lancements';
import type { WorkflowGraph, WorkflowNodeType } from '../src/workflow/graph';
import type { WorkflowRow } from '../src/workflow/store.pg';
import type { ControlOwner } from '../src/inbox/store.pg';
import type { RunState, WorkflowRunRow } from '../src/workflow/run-store.pg';
import { ORIGINE_MAX, PLAFOND_ATTENTE_EVENEMENT_MS, variablesDuTexte, type EvenementDuParcours } from '../src/workflow/evenement';
import { walk } from '../src/workflow/engine';
import { DROITS, type Offre } from '../src/offres/offres';
import { origineHubspot } from '../src/hubspot/origine';

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
const naissance = (o: Partial<{ workflowId: string; noeudId: string; nom: string; langue: string; evenement: EvenementDuParcours }> = {}): DemandeDeLancement => ({
  type: 'evenement_shopify', tenantId: ESPACE, workflowId: o.workflowId ?? 'wf-panier', waId: WA, contactId: 'c1',
  noeudId: o.noeudId ?? 'tpl', modele: { nom: o.nom ?? 'panier_relance', langue: o.langue ?? 'fr' }, evenement: o.evenement ?? EVENEMENT,
});

interface Options {
  detenteur?: ControlOwner;
  /** Le parcours d'événement déjà actif pour ce contact (`parcoursDEvenementActif`). */
  dejaActif?: boolean;
  /** `start` rend le refus de l'index unique (un autre événement a gagné la course). */
  courseperdue?: boolean;
  /** `start` rend le refus de la naissance idempotente (lot 5 : un parcours de la même origine existe déjà). */
  dejaNe?: boolean;
  /** La LECTURE de la garde rend « déjà né » (relecture de 5a, jaune 5 : refusé avant la reprise du fil et la suite). */
  origineDejaNee?: boolean;
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
  /** Les escalades vers l’équipe, avec leur marque collante (`escalade`). */
  const escalades: boolean[] = [];
  const deps: WorkflowExecutorDeps = {
    ...depsInertes,
    estDesabonne: jamaisDesabonne,
    aAccordMarketing: toujoursDAccord,
    escalateToHuman: async (_t, _w, _a, escalade) => { escalades.push(escalade); },
    runs: avecGardesDEtatInertes({
      // Les deux surcharges du contrat : seul un parcours d'événement peut être refusé par l'index unique.
      start: (async (_t: string, _w: string, _wa: string, _c: string | null, state: RunState, _g: unknown, _e: boolean, _m: boolean, evenement: EvenementDuParcours | null) => {
        if (o.courseperdue && evenement !== null) return { refus: 'evenement_actif' as const };
        if (o.dejaNe && evenement !== null) return { refus: 'deja_ne' as const };
        crees.push({ state, evenement });
        return { id: 'r-neuf' };
      }) as WorkflowExecutorDeps['runs']['start'],
      findWaitingByWaId: async () => null,
      setState: async () => {},
      closeActiveByWaId: async () => { clotures.push('tous'); return ['r-avant']; },
      closeOrdinairesByWaId: async () => { clotures.push('ordinaires'); return ['r-avant']; },
      parcoursDEvenementActif: async () => (o.dejaActif ? { id: 'r-evenement' } : null),
      evenementDejaNe: async () => o.origineDejaNee === true,
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
  return { b, lancements, envois, crees, clotures, escalades };
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
    // Lot 5 : le bloc de départ est gardé avec l'événement (le clic d'un événement frère s'y reconnaît).
    expect(m.crees[0]!.evenement).toEqual({ ...EVENEMENT, noeudDepart: 'tpl' });
  });

  it('🔴 lot 5 : la même origine déjà née (la relance automatique d’un envoi) : aucun parcours, et la raison le dit', async () => {
    silence();
    const m = banc({ dejaNe: true });
    expect(await m.lancements.lancer(naissance())).toBe(REFUS_DEJA_NE);
    expect(m.crees).toEqual([]);
  });

  /** Un premier template sans bouton ni délai, suivi d'un template : la suite part dans la naissance même (décision 29). */
  const SUITE_SYNCHRONE: WorkflowGraph = {
    nodes: [n('tpl', 'template', { templateName: 'panier_relance', language: 'fr' }), n('t2', 'template', { templateName: 'avis_produit', language: 'fr' })],
    edges: [{ id: 'e1', source: 'tpl', target: 't2' }],
  };

  it('🔴 relecture de 5a (jaune 5) : une origine déjà née se refuse AVANT la reprise du fil et la suite : rien ne repart', async () => {
    silence();
    const m = banc({ origineDejaNee: true, scenario: { graph: SUITE_SYNCHRONE, draftGraph: null, rayon: 'shopify' } });
    expect(await m.lancements.lancer(naissance())).toBe(REFUS_DEJA_NE);
    expect(m.envois, 'la suite ne part pas une seconde fois').toEqual([]);
    expect(m.crees).toEqual([]);
    expect(m.b.etat(WA)?.owner, 'le fil n’est pas repris à l’agent de Meta').toBe('mba');
  });

  it('🔴 relecture de 5a (jaune 5) : un événement illisible se refuse avant la reprise du fil et la suite', async () => {
    silence();
    const m = banc({ scenario: { graph: SUITE_SYNCHRONE, draftGraph: null, rayon: 'shopify' } });
    const illisible: EvenementDuParcours = { ...EVENEMENT, origine: 'x'.repeat(ORIGINE_MAX + 1) };
    expect(await m.lancements.lancer(naissance({ evenement: illisible }))).toBe(REFUS_EVENEMENT_INVALIDE);
    expect([m.envois, m.crees]).toEqual([[], []]);
    expect(m.b.etat(WA)?.owner).toBe('mba');
  });

  it('🔴 lot 5 (jaune de 4a) : une suite qui mène tout de suite à « Passer à un humain » escalade en COLLANT : le premier template est parti', async () => {
    silence();
    const HUMAIN: WorkflowGraph = {
      nodes: [n('tpl', 'template', { templateName: 'panier_relance', language: 'fr' }), n('h', 'inbox', {})],
      edges: [{ id: 'e1', source: 'tpl', target: 'h' }],
    };
    const m = banc({ scenario: { graph: HUMAIN, draftGraph: null, rayon: 'shopify' } });
    expect(await m.lancements.lancer(naissance())).toBe(true);
    expect(m.escalades).toEqual([true]);
  });

  it('🔴 la naissance garde l’identifiant Meta du premier message et son bloc de départ (lot 5)', async () => {
    silence();
    const m = banc();
    expect(await m.lancements.lancer(naissance({ evenement: { ...EVENEMENT, messageId: 'wamid.premier' } }))).toBe(true);
    expect(m.crees[0]!.evenement).toEqual({ ...EVENEMENT, messageId: 'wamid.premier', noeudDepart: 'tpl' });
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

  it('🔴 le bloc se lit comme le moteur l’envoie : nom sans ses espaces, langue absente lue « fr » (relecture de 4a, point 2)', async () => {
    silence();
    const bloc = { ...PANIER.nodes[0]!, data: { templateName: '  panier_relance ', templateButtons: [{ type: 'QUICK_REPLY', text: 'Reprendre' }] } };
    const m = banc({ scenario: { graph: { nodes: [bloc, ...PANIER.nodes.slice(1)], edges: PANIER.edges }, draftGraph: null, rayon: 'shopify' } });
    expect(await m.lancements.lancer(naissance())).toBe(true);
    expect(m.crees).toHaveLength(1);
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

/**
 * LOT 6 : LE PARCOURS D'UN ÉVÉNEMENT HUBSPOT, PAR LE MÊME PONT (décisions 2, 3 et 36). Sur le premier bloc d'un scénario du
 * rayon `hubspot`, avec l'origine de la décision 37 ; les mêmes priorités que Shopify : il ne prend jamais le fil à un
 * opérateur, il cède devant un parcours d'événement en cours, et ne ferme que les parcours ordinaires.
 */
describe('lot 6 : la naissance d’un parcours d’événement HubSpot', () => {
  const HUBSPOT = { graph: PANIER, draftGraph: null, rayon: 'hubspot' as const };
  const EVENEMENT_HUBSPOT: EvenementDuParcours = {
    origine: origineHubspot({ famille: 'etape', ligne: 'ligne-1', deal: '9001', etape: 'closedwon', le: new Date('2026-11-19T09:30:00Z') })!,
    variables: {},
  };
  const naissanceHubspot = (): DemandeDeLancement => ({
    type: 'evenement_hubspot', tenantId: ESPACE, workflowId: 'wf-panier', waId: WA, contactId: 'c1',
    noeudId: 'tpl', modele: { nom: 'panier_relance', langue: 'fr' }, evenement: EVENEMENT_HUBSPOT,
  });

  it('🔴 il naît sur le premier bloc d’un scénario HubSpot, sans le renvoyer, et ne ferme que les parcours ordinaires', async () => {
    silence();
    const m = banc({ scenario: HUBSPOT });
    expect(await m.lancements.lancer(naissanceHubspot())).toBe(true);
    expect(m.envois).toEqual([]);
    expect(m.crees[0]!.evenement).toEqual({ ...EVENEMENT_HUBSPOT, noeudDepart: 'tpl' });
    expect(m.clotures).toEqual(['ordinaires']);
  });

  it('🔴 un scénario Shopify est inconnu pour lui, comme un scénario HubSpot pour un événement Shopify', async () => {
    expect(await banc().lancements.lancer(naissanceHubspot())).toBeNull();
    expect(await banc({ scenario: HUBSPOT }).lancements.lancer(naissance())).toBeNull();
  });

  it('🔴 un parcours d’événement occupe déjà la place : il cède, sans rien écrire (décision 3)', async () => {
    silence();
    const m = banc({ scenario: HUBSPOT, dejaActif: true });
    expect(await m.lancements.lancer(naissanceHubspot())).toBe(REFUS_EVENEMENT_EN_COURS);
    expect([m.crees, m.clotures, m.envois, m.b.appels]).toEqual([[], [], [], []]);
  });

  it('🔴 un opérateur tient le fil : aucun parcours, et rien n’est demandé à Meta (décision 2)', async () => {
    silence();
    const m = banc({ scenario: HUBSPOT, detenteur: 'app_human' });
    expect(await m.lancements.lancer(naissanceHubspot())).toContain('tenue par un opérateur');
    expect([m.crees, m.b.appels]).toEqual([[], []]);
    expect(m.b.etat(WA)?.owner).toBe('app_human');
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
  /** Les champs de la fiche que lit le texte d'un message (`varsFor`). */
  varsFiche?: Record<string, string>;
  /** L'événement du parcours qui attend (lot 5 : il garde l'identifiant de son premier message et son bloc de départ). */
  evenement?: EvenementDuParcours;
  /** La fenêtre de service est-elle ouverte (défaut : oui) ? */
  fenetre?: boolean;
  /** Décision 34 : le répondeur de la voie de ce message coexiste-t-il avec le parcours (défaut : non) ? */
  horsParcours?: 'confie' | 'ne_coexiste_pas';
  /** Décision 35 : aucun parcours n'attend le contact ; celui de l'événement DORT dans une Attente, ou un ordinaire. */
  endormi?: 'evenement' | 'ordinaire';
}

/** Le premier message d'un parcours d'événement, tel que la naissance du lot 5 le garde. */
const SIEN: EvenementDuParcours = { ...EVENEMENT, messageId: 'wamid.tpl', noeudDepart: 'tpl' };
/** Les messages connus des mesures des blocs : le sien, celui d'un événement frère (même bloc), celui d'un autre scénario. */
const BLOCS_DES_MESSAGES: Record<string, { workflowId: string; nodeId: string }> = {
  'wamid.tpl': { workflowId: 'wf-panier', nodeId: 'tpl' },
  'wamid.frere': { workflowId: 'wf-panier', nodeId: 'tpl' },
  'wamid.exp': { workflowId: 'wf-expediee', nodeId: 'tpl-e' },
};

function bancReprise(o: OptionsReprise = {}) {
  const b = bancDuFil({ surLaListe: [WA], conversations: { [WA]: { owner: o.detenteur ?? 'app_workflow' } } });
  const modeles: Array<{ nom: string; sources: unknown; variables: unknown }> = [];
  const champs: string[] = [];
  const envois: string[] = [];
  const ecritures: string[] = [];
  const priseDeMain: string[] = [];
  const auRepondeur: string[] = [];
  const horsParcours: string[] = [];
  /** L'entrée réelle transmise à la remise hors parcours, par appel (décisions 34 et 35). */
  const entrees: unknown[] = [];
  const arrets: string[] = [];
  const escalades: boolean[] = [];
  const deps: WorkflowExecutorDeps = {
    ...depsInertes,
    estDesabonne: jamaisDesabonne,
    aAccordMarketing: toujoursDAccord,
    isWindowOpen: async () => o.fenetre ?? true,
    parcoursEncoreVoulu: async () => o.voulu ?? true,
    escalateToHuman: async (_t, _w, _a, escalade) => { escalades.push(escalade); },
    blocDuMessage: async (_t, wamid) => BLOCS_DES_MESSAGES[wamid] ?? null,
    confierAuRepondeur: async (_t, _w, messageId) => { auRepondeur.push(messageId); },
    remettreLeClicHorsParcours: async (_t, _w, messageId, entree) => {
      entrees.push(entree);
      const issue = o.horsParcours ?? 'ne_coexiste_pas';
      if (issue === 'confie') horsParcours.push(messageId);
      return issue;
    },
    resoudreBloc: async (_t, cible) => (cible === 'code-autre' ? { workflowId: 'wf-autre', nodeId: 'x', graph: AUTRE } : null),
    runs: avecGardesDEtatInertes({
      start: async () => ({ id: 'r-saut' }),
      findWaitingByWaId: async () => (o.endormi !== undefined ? null : o.dernier ?? runEvenement(o.evenement ? { evenement: o.evenement } : {})),
      parcoursDEvenementEndormi: async () => (o.endormi === 'evenement' ? { id: 'r-evt', origine: (o.evenement ?? EVENEMENT).origine } : null),
      findWaitingSurBloc: async (_t: string, _w: string, wf: string, noeud: string) =>
        (wf === 'wf-panier' && noeud === 'tpl' ? runEvenement(o.evenement ? { evenement: o.evenement } : {}) : null),
      setState: async (id: string, s: RunState) => { ecritures.push(`${id}:${s.status}`); },
      setStateSiEncoreSur: async (_t: string, id: string, _n: string | null, s: RunState) => { ecritures.push(`${id}:${s.status}`); return true; },
      closeActiveByWaId: async () => [],
      cloreAutresActifs: async (_t: string, _w: string, saufId: string) => { priseDeMain.push(saufId); return []; },
      cloreParOrigine: async (_t: string, origine: string) => { arrets.push(origine); return ['r-evt']; },
    }),
    getGraph: async (wf) => (wf === 'wf-panier' ? (o.graphe ?? PANIER_DELAI) : wf === 'wf-repondeur' ? REPONDEUR : null),
    applyTag: async () => true,
    setField: async () => {},
    removeTag: async () => {},
    clearField: async () => {},
    sendTemplate: async (_t, _w, nom, _l, _b, _p, sources, variables) => {
      envois.push(`tpl:${nom}`);
      modeles.push({ nom, sources, variables });
    },
    sendQuickMessage: async (_t, _w, texte) => { envois.push(`qm:${texte}`); },
    sendFlow: async () => {},
    sendQuestion: async () => {},
    mayAct: b.fil.peutAgir,
    reclaimControl: b.fil.reprendrePourLApp,
    varsFor: async () => o.varsFiche ?? {},
  };
  deps.setField = async (_t, _w, cle, valeur) => { champs.push(`${cle}=${String(valeur)}`); };
  return { b, executor: new WorkflowExecutor(deps), envois, ecritures, priseDeMain, auRepondeur, horsParcours, entrees, arrets, modeles, champs, escalades };
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

  it('🔴 décision 34 : un clic qui n’est pas pour le parcours (événement frère, autre scénario), robot qui coexiste : confié, le parcours attend', async () => {
    silence();
    for (const cite of ['wamid.frere', 'wamid.exp']) {
      const m = bancReprise({ evenement: SIEN, horsParcours: 'confie' });
      const pris = await m.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', { ...clic('btn:0'), messageCite: cite });
      expect(pris, cite).toBe(true);
      expect(m.horsParcours, cite).toEqual(['m1']);
      expect([m.envois, m.ecritures, m.arrets], `${cite} : aucun ancien lien, le parcours attend toujours`).toEqual([[], [], []]);
    }
  });

  it('🔴 décision 34 : l’agent de Meta ou l’équipe répond : le parcours s’arrête par son origine, puis le clic revient à la remise', async () => {
    silence();
    for (const cite of ['wamid.frere', 'wamid.exp']) {
      const m = bancReprise({ evenement: SIEN, horsParcours: 'ne_coexiste_pas' });
      const pris = await m.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', { ...clic('btn:0'), messageCite: cite });
      expect(pris, cite).toBe(false);
      expect(m.arrets, cite).toEqual([SIEN.origine]);
      expect([m.envois, m.auRepondeur], cite).toEqual([[], []]);
    }
  });

  /** Décision 35 : ce que le contact envoie pendant l'Attente, un texte ou un clic. */
  const pendantLAttente = [
    { nom: 'texte', bouton: null, entrant: { reaction: false, type: 'text', texte: 'Merci !' } },
    { nom: 'clic', bouton: 'btn:0', entrant: clic('btn:0') },
  ];

  it('🔴 décision 35 : un message pendant l’Attente d’un parcours d’événement, robot qui coexiste : confié, le parcours dort toujours', async () => {
    silence();
    for (const c of pendantLAttente) {
      const m = bancReprise({ evenement: SIEN, endormi: 'evenement', horsParcours: 'confie' });
      expect(await m.executor.advance(ESPACE, WA, 'm1', c.bouton, 'whatsapp', c.entrant), c.nom).toBe(true);
      expect(m.horsParcours, c.nom).toEqual(['m1']);
      expect([m.envois, m.ecritures, m.arrets], `${c.nom} : rien ne part, le parcours reprendra à son réveil`).toEqual([[], [], []]);
    }
  });

  it('🔴 décision 35 : l’agent de Meta ou l’équipe : le parcours s’arrête par son origine, puis le message revient à la remise', async () => {
    silence();
    for (const c of pendantLAttente) {
      const m = bancReprise({ evenement: SIEN, endormi: 'evenement', horsParcours: 'ne_coexiste_pas' });
      expect(await m.executor.advance(ESPACE, WA, 'm1', c.bouton, 'whatsapp', c.entrant), c.nom).toBe(false);
      expect(m.arrets, c.nom).toEqual([SIEN.origine]);
      expect([m.envois, m.auRepondeur, m.horsParcours], c.nom).toEqual([[], [], []]);
    }
  });

  it('🔴 décisions 34 et 35 : l’entrée réelle du message (réouverture, redélivrance) va à la remise hors parcours', async () => {
    silence();
    const entree = { rouverte: true, redelivre: true };
    // Décision 34 : un clic sur le premier message d'un événement frère, pendant que le parcours attend.
    const attend = bancReprise({ evenement: SIEN, horsParcours: 'confie' });
    await attend.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', { ...clic('btn:0'), messageCite: 'wamid.frere', ...entree });
    // Décision 35 : un texte pendant l'Attente.
    const dort = bancReprise({ evenement: SIEN, endormi: 'evenement', horsParcours: 'confie' });
    await dort.executor.advance(ESPACE, WA, 'm2', null, 'whatsapp', { reaction: false, type: 'text', texte: 'Merci !', ...entree });
    // Une entrée qui ne dit rien : ni réouverture ni redélivrance.
    const simple = bancReprise({ evenement: SIEN, endormi: 'evenement', horsParcours: 'confie' });
    await simple.executor.advance(ESPACE, WA, 'm3', null, 'whatsapp', { reaction: false, type: 'text', texte: 'Merci !' });
    expect([attend.entrees, dort.entrees, simple.entrees]).toEqual([[entree], [entree], [{ rouverte: false, redelivre: false }]]);
  });

  it('🔴 décision 35 : rien pour une réaction, un message RCS, un fil qui n’est pas à nous, ni un parcours ORDINAIRE qui dort (son silence)', async () => {
    silence();
    const texte = { reaction: false, type: 'text', texte: 'Merci !' };
    const cas = [
      { nom: 'réaction', o: { endormi: 'evenement' as const }, canal: 'whatsapp' as const, entrant: { reaction: true, type: 'reaction' } },
      { nom: 'RCS', o: { endormi: 'evenement' as const }, canal: 'rcs' as const, entrant: texte },
      { nom: 'opérateur', o: { endormi: 'evenement' as const, detenteur: 'app_human' as const }, canal: 'whatsapp' as const, entrant: texte },
      { nom: 'agent de Meta', o: { endormi: 'evenement' as const, detenteur: 'mba' as const }, canal: 'whatsapp' as const, entrant: texte },
      { nom: 'ordinaire', o: { endormi: 'ordinaire' as const }, canal: 'whatsapp' as const, entrant: texte },
    ];
    for (const c of cas) {
      for (const horsParcours of ['confie', 'ne_coexiste_pas'] as const) {
        const m = bancReprise({ evenement: SIEN, horsParcours, ...c.o });
        expect(await m.executor.advance(ESPACE, WA, 'm1', null, c.canal, c.entrant), `${c.nom}, ${horsParcours}`).toBeUndefined();
        expect([m.horsParcours, m.arrets, m.envois], `${c.nom}, ${horsParcours}`).toEqual([[], [], []]);
      }
    }
  });

  it('🔴 lot 5 (jaune de 4a) : un parcours repris à l’agent de Meta qui se TERMINE pendant l’avance dit qu’il a pris le message (pas deux voix)', async () => {
    silence();
    const m = bancReprise({ detenteur: 'mba' });
    expect(await m.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', clic('btn:0'))).toBe(true);
    expect(m.envois).toEqual(['qm:Voici votre panier']);
  });

  it('🔴 lot 5 (jaune de 4a) : un opérateur tient le fil : le parcours se clôt et le message va à la remise (false)', async () => {
    silence();
    const m = bancReprise({ detenteur: 'app_human' });
    expect(await m.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', clic('btn:0'))).toBe(false);
  });

  it('🔴 lot 5 (jaune de 4a) : plus voulu, un CLIC va à la remise (false) ; un texte, transmis à l’agent, est pris (true)', async () => {
    silence();
    const clicMort = bancReprise({ voulu: false });
    expect(await clicMort.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', clic('btn:0'))).toBe(false);
    const texte = bancReprise({ voulu: false });
    expect(await texte.executor.advance(ESPACE, WA, 'm2', null, 'whatsapp', { reaction: false, type: 'text', texte: 'bonjour' })).toBe(true);
  });

  it('le clic sur SON premier message (l’identifiant gardé) prend sa branche', async () => {
    silence();
    const m = bancReprise({ evenement: SIEN });
    const pris = await m.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', clic('btn:0'));
    expect(pris).not.toBe(false);
    expect(m.envois).toEqual(['qm:Voici votre panier']);
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

  it('🔴 lot 5 (appel A4) : la relance mène à un message de session, fenêtre fermée : clos sans passer à l’équipe ; un ordinaire, lui, y passe', async () => {
    silence();
    const RELANCE_EN_SESSION: WorkflowGraph = {
      nodes: [
        n('tpl', 'template', { templateName: 'panier_relance', language: 'fr', timeoutValue: 30, timeoutUnit: 'minutes' }),
        n('qm', 'quick_message', { body: 'Toujours là ?' }),
      ],
      edges: [{ id: 'e1', source: 'tpl', target: 'qm', sourceHandle: 'timeout' }],
    };
    const evt = bancReprise({ graphe: RELANCE_EN_SESSION, fenetre: false });
    await evt.executor.resume({ ...runEvenement(), status: 'waiting' });
    expect(evt.envois).toEqual([]);
    expect(evt.ecritures).toEqual(['r-evt:done']);
    expect(evt.escalades, 'aucun client par panier dans « À traiter »').toEqual([]);
  });

  it('🔴 lot 5 (jaune de 4a) : clos au plafond SANS reprendre le fil à l’agent de Meta (le contact reste sur sa liste)', async () => {
    silence();
    const m = bancReprise({ detenteur: 'mba', graphe: PANIER });
    expect(await m.executor.resume({ ...runEvenement(), status: 'waiting' })).toBe(false);
    expect(m.ecritures).toEqual(['r-evt:done']);
    expect(m.b.appels, 'aucun appel à Meta pour un parcours qui se clôt').toEqual([]);
    expect(m.b.etat(WA)?.owner).toBe('mba');
  });

  it('🔴 lot 5 (jaune de 4a) : un graphe absent clôt aussi SANS reprendre le fil à l’agent de Meta', async () => {
    silence();
    const m = bancReprise({ detenteur: 'mba', graphe: { nodes: [], edges: [] } });
    expect(await m.executor.resume({ ...runEvenement(), status: 'waiting' })).toBe(false);
    expect(m.b.appels).toEqual([]);
  });
});

/**
 * LES VARIABLES DU PARCOURS DANS LES ENVOIS DE L'EXÉCUTEUR (lot 4, décision 28) : un template de la suite reçoit les
 * variables de l'événement (sa source `variable`), le texte d'un message lit `{{shopify.checkout_url}}` dans le parcours et
 * un nom nu sur la fiche. Les liens à clé d'accès ne vont jamais sur la fiche.
 */
describe('les variables d’un parcours d’événement dans ses envois (décision 28)', () => {
  it('🔴 le texte d’un message lit {{shopify.checkout_url}} dans le parcours, et un nom nu sur la fiche', async () => {
    silence();
    const texte: WorkflowGraph = {
      nodes: [
        PANIER_DELAI.nodes[0]!,
        n('qm', 'quick_message', { body: 'Bonjour {{prenom}}, votre panier : {{shopify.checkout_url}}' }),
      ],
      edges: [{ id: 'e1', source: 'tpl', target: 'qm', sourceHandle: 'btn:0' }],
    };
    const m = bancReprise({ graphe: texte, varsFiche: { prenom: 'Camille' } });
    await m.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', clic('btn:0'));
    expect(m.envois).toEqual(['qm:Bonjour Camille, votre panier : https://x/c/42']);
  });

  it('🔴 un template de la suite reçoit les variables de l’événement pour sa source « variable »', async () => {
    silence();
    const suite: WorkflowGraph = {
      nodes: [
        PANIER_DELAI.nodes[0]!,
        n('t3', 'template', { templateName: 'panier_lien', language: 'fr', variables: [{ position: 1, source: { type: 'variable', key: 'checkout_url' } }] }),
      ],
      edges: [{ id: 'e1', source: 'tpl', target: 't3', sourceHandle: 'btn:0' }],
    };
    const m = bancReprise({ graphe: suite });
    await m.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', clic('btn:0'));
    expect(m.modeles).toEqual([{ nom: 'panier_lien', sources: [{ position: 1, source: { type: 'variable', key: 'checkout_url' } }], variables: EVENEMENT.variables }]);
  });

  it('🔴 une variable du parcours n’atteint jamais la fiche : le champ posé garde le texte tel quel', async () => {
    silence();
    const action: WorkflowGraph = {
      nodes: [PANIER_DELAI.nodes[0]!, n('a', 'action', { actionKind: 'set_field', fieldKey: 'lien', value: '{{shopify.checkout_url}}' })],
      edges: [{ id: 'e1', source: 'tpl', target: 'a', sourceHandle: 'btn:0' }],
    };
    const m = bancReprise({ graphe: action });
    await m.executor.advance(ESPACE, WA, 'm1', 'btn:0', 'whatsapp', clic('btn:0'));
    expect(m.champs.join(' ')).not.toContain('https://x/c/42');
  });

  it('variablesDuTexte : rien pour un parcours ordinaire, le préfixe de l’origine sinon', () => {
    expect(variablesDuTexte(null)).toEqual({});
    expect(variablesDuTexte(EVENEMENT)).toEqual({ 'shopify.checkout_url': 'https://x/c/42' });
  });
});

/**
 * L'ARRÊT COMMANDÉ (lot 4, appelé au lot 5, décisions 4 et 15) : par origine ou par scénarios, les parcours d'événement et
 * leurs sessions d'agent se closent, sans rien envoyer. Le filtre d'espace est éprouvé par le test d'intégration du
 * magasin (`run-evenement.integration.test.ts`).
 */
describe('l’arrêt commandé des parcours d’événement', () => {
  function bancArret() {
    const appels: string[] = [];
    const sessionsCloses: string[] = [];
    const deps: WorkflowExecutorDeps = {
      ...depsInertes,
      estDesabonne: jamaisDesabonne,
      aAccordMarketing: toujoursDAccord,
      runs: avecGardesDEtatInertes({
        start: async () => ({ id: 'r' }),
        findWaitingByWaId: async () => null,
        setState: async () => {},
        closeActiveByWaId: async () => [],
        cloreParOrigine: async (t: string, origine: string) => { appels.push(`origine:${t}:${origine}`); return ['r1', 'r2']; },
        cloreParScenarios: async (t: string, ids: readonly string[]) => { appels.push(`scenarios:${t}:${ids.join(',')}`); return ['r3']; },
        cloreParPrefixe: async (t: string, prefixe: string, waId?: string) => { appels.push(`prefixe:${t}:${prefixe}:${waId ?? 'tous'}`); return ['r4']; },
      }),
      agentSessions: {
        byRun: async (_t: string, runId: string) => ({ id: `s-${runId}` }),
        clore: async (_t: string, sessionId: string) => { sessionsCloses.push(sessionId); },
      } as unknown as WorkflowExecutorDeps['agentSessions'],
      getGraph: async () => null,
      applyTag: async () => true,
      setField: async () => {},
      removeTag: async () => {},
      clearField: async () => {},
      sendTemplate: async () => {},
      sendQuickMessage: async () => {},
      sendFlow: async () => {},
      sendQuestion: async () => {},
    };
    return { executor: new WorkflowExecutor(deps), appels, sessionsCloses };
  }

  it('🔴 par origine : les parcours de cette origine et leurs sessions d’agent', async () => {
    silence();
    const m = bancArret();
    expect(await m.executor.arreterParcours(ESPACE, { origine: EVENEMENT.origine }, 'commande passée')).toBe(2);
    expect(m.appels).toEqual([`origine:${ESPACE}:${EVENEMENT.origine}`]);
    expect(m.sessionsCloses).toEqual(['s-r1', 's-r2']);
  });

  it('🔴 par scénarios : les parcours de ces scénarios et leurs sessions d’agent', async () => {
    silence();
    const m = bancArret();
    expect(await m.executor.arreterParcours(ESPACE, { workflowIds: ['wf-panier', 'wf-commande'] }, 'boutique en pause')).toBe(1);
    expect(m.appels).toEqual([`scenarios:${ESPACE}:wf-panier,wf-commande`]);
    expect(m.sessionsCloses).toEqual(['s-r3']);
  });

  it('🔴 lot 5 : par préfixe d’origine (une ligne éteinte, la boutique en pause, les autres paniers d’un contact), avec leurs sessions', async () => {
    silence();
    const m = bancArret();
    expect(await m.executor.arreterParcours(ESPACE, { prefixe: 'shopify:b.myshopify.com:checkouts/abandoned:', waId: WA }, 'panier plus récent')).toBe(1);
    expect(await m.executor.arreterParcours(ESPACE, { prefixe: 'shopify:b.myshopify.com:' }, 'boutique en pause')).toBe(1);
    expect(m.appels).toEqual([`prefixe:${ESPACE}:shopify:b.myshopify.com:checkouts/abandoned::${WA}`, `prefixe:${ESPACE}:shopify:b.myshopify.com::tous`]);
    expect(m.sessionsCloses).toEqual(['s-r4', 's-r4']);
  });
});
