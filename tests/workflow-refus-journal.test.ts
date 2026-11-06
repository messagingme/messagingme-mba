import { describe, it, expect, vi, afterEach } from 'vitest';
import { jamaisDesabonne, toujoursDesabonne, toujoursDAccord, jamaisDAccord } from './consentement';
import { avecGardesDEtatInertes, depsInertes, rcsSansAgent } from './executeur-inerte';
import { WorkflowExecutor } from '../src/workflow/executor';
import type { WorkflowExecutorDeps } from '../src/workflow/executor';
import type { WorkflowGraph, WorkflowNodeType } from '../src/workflow/graph';
import type { RunState, WorkflowRunRow } from '../src/workflow/run-store.pg';
import { RcsSender } from '../src/rcs/sender';
import { Reachability, type ReachabilityStore } from '../src/rcs/reachability';
import { FakeRcsProvider } from '../src/rcs/fake';

/**
 * 🔴 LA RAISON D'UN ENVOI REFUSÉ EN COURS DE PARCOURS S'ÉCRIT AU JOURNAL DES ÉCHECS DE SCÉNARIO (2026-11-06), celui que
 * l'écran Sécurité > Journal des erreurs montre sous « échec de scénario ». Avant, elle ne partait que dans le journal du
 * serveur : le parcours s'arrêtait, la conversation passait à l'équipe avec pour seule cause le nom du scénario, et
 * personne ne pouvait dire pourquoi (vécu à la relecture de 60b4812b : un champ vide dans l'adresse d'un bouton de lien).
 *
 * Décisions de Julien du 2026-11-06 : tous les refus d'une RÉPONSE et d'un RÉVEIL, que le parcours s'arrête ou continue,
 * fenêtre de 24 h fermée au réveil comprise ; une ligne par contact et par bloc refusé ; le STOP (WhatsApp ou RCS) et
 * l'absence d'accord marketing restent hors du journal, des règles et pas des pannes. La ligne ne s'écrit qu'une fois
 * l'état du parcours écrit : perdue, l'écriture dit qu'un autre traitement tient le parcours.
 */

const n = (id: string, type: WorkflowNodeType, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const e = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
const WA = '33611';
/** La raison que rend l'envoi, inventée par le test : la ligne doit la porter telle quelle. */
const RAISON = 'la variable {{lien_devis}} n’a pas de valeur sur la fiche du contact';

/** Le bloc qui attend la réponse : un message rapide à bouton, dont le clic mène à `suite`. */
const question = n('q', 'quick_message', { body: 'Votre devis ?', quickReplies: ['Oui'] });
/** « Question, puis le message rapide du devis » : la réponse fait partir le bloc refusé. */
const REPONSE_PUIS_DEVIS: WorkflowGraph = {
  nodes: [question, n('devis', 'quick_message', { name: 'Relance devis', body: 'DEVIS' })],
  edges: [e('q', 'devis', 'btn:0')],
};
/** « Attendre, puis le message rapide du devis » : le réveil fait partir le bloc refusé. */
const ATTENTE_PUIS_DEVIS: WorkflowGraph = {
  nodes: [n('w', 'wait', { delay: 2, unit: 'days' }), n('devis', 'quick_message', { name: 'Relance devis', body: 'DEVIS' })],
  edges: [e('w', 'devis')],
};
/** « Question, merci, relance du devis » : un message part, le suivant est refusé. */
const MERCI_PUIS_DEVIS: WorkflowGraph = {
  nodes: [question, n('a', 'quick_message', { body: 'MERCI' }), n('devis', 'quick_message', { name: 'Relance devis', body: 'DEVIS' })],
  edges: [e('q', 'a', 'btn:0'), e('a', 'devis')],
};

const PARCOURS = (currentNode: string, status: WorkflowRunRow['status'], exige = false): WorkflowRunRow => ({
  id: 'run-1', workflowId: 'wf1', tenantId: 't1', waId: WA, contactId: 'c1',
  currentNode, status, lastMessageId: null, grapheFige: null, exigeAccordMarketing: exige,
});

type Ligne = Parameters<WorkflowExecutorDeps['journaliserEchec']>[0];

/**
 * Le monde : `refuses` = les corps de message rapide que l'envoi refuse (avec `RAISON`), tout autre corps part.
 * `ecritureRefusee` : les écritures gardées de l'état rendent `false`, comme quand un autre traitement tient le parcours.
 * Ce que l'exécuteur a fait : les envois, les états écrits, les passages à l'équipe, et les lignes du journal.
 */
function monde(
  graph: WorkflowGraph, run: WorkflowRunRow, surcharges: Partial<WorkflowExecutorDeps> = {}, refuses: string[] = ['DEVIS'],
  options: { ecritureRefusee?: boolean } = {},
) {
  const envois: string[] = [];
  const etats: RunState[] = [];
  const escalades: string[] = [];
  const journal: Ligne[] = [];
  const deps: WorkflowExecutorDeps = {
    ...depsInertes,
    estDesabonne: jamaisDesabonne,
    aAccordMarketing: toujoursDAccord,
    runs: avecGardesDEtatInertes({
      start: async () => ({ id: 'run-2' }),
      findWaitingByWaId: async () => (run.status === 'waiting' ? run : null),
      setState: async (_id: string, s: RunState) => { etats.push(s); },
      closeActiveByWaId: async () => [],
      ...(options.ecritureRefusee ? { setStateSiEncoreSur: async () => false, setStateSiVivant: async () => false } : {}),
    }),
    getGraph: async () => graph,
    applyTag: async () => true,
    setField: async () => {},
    removeTag: async () => {},
    clearField: async () => {},
    sendTemplate: async (_t, _w, nom) => { envois.push(`modèle ${nom}`); },
    sendQuickMessage: async (_t, _w, texte) => {
      if (refuses.includes(texte)) return RAISON;
      envois.push(texte);
    },
    sendFlow: async () => {},
    sendQuestion: async () => {},
    escalateToHuman: async (_t, w) => { escalades.push(w); },
    isWindowOpen: async () => true,
    journaliserEchec: async (ligne) => { journal.push(ligne); },
    ...surcharges,
  };
  return { executor: new WorkflowExecutor(deps), envois, etats, escalades, journal };
}

function silence(): void {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
}
afterEach(() => { vi.restoreAllMocks(); });

describe('la réponse d’un contact fait partir un envoi refusé', () => {
  it('🔴 rien n’est parti : une ligne nomme le bloc et la raison, le parcours s’arrête et passe à l’équipe', async () => {
    silence();
    const m = monde(REPONSE_PUIS_DEVIS, PARCOURS('q', 'waiting'));
    await m.executor.advance('t1', WA, 'wamid.1', 'btn:0');
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox', lastMessageId: 'wamid.1' }]);
    expect(m.escalades).toEqual([WA]);
    expect(m.journal).toHaveLength(1);
    const [ligne] = m.journal;
    expect(ligne).toMatchObject({ tenantId: 't1', waId: WA, workflowId: 'wf1', runId: 'run-1', messageId: 'wamid.1' });
    expect(ligne!.erreur).toContain('« Relance devis »');
    expect(ligne!.erreur).toContain(RAISON);
    expect(ligne!.erreur).toMatch(/s’arrête.*équipe/);
  });

  it('un autre message de l’étape est parti : la ligne le dit, sans rien promettre de la suite', async () => {
    silence();
    const m = monde(MERCI_PUIS_DEVIS, PARCOURS('q', 'waiting'));
    await m.executor.advance('t1', WA, 'wamid.1', 'btn:0');
    expect(m.envois).toEqual(['MERCI']);
    expect(m.escalades).toEqual([]);
    // Le refus touchait le dernier bloc : le parcours est FINI, la ligne ne doit pas dire qu'il continue.
    expect(m.etats).toEqual([{ currentNode: null, status: 'done', lastMessageId: 'wamid.1', channel: 'whatsapp' }]);
    expect(m.journal).toHaveLength(1);
    expect(m.journal[0]!.erreur).toContain('« Relance devis »');
    expect(m.journal[0]!.erreur).toContain(RAISON);
    expect(m.journal[0]!.erreur).toMatch(/autres messages de cette étape sont partis\.$/);
    expect(m.journal[0]!.erreur).not.toMatch(/continue|équipe/);
  });

  it('deux blocs refusés dans la même étape : une ligne chacun', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [question, n('a', 'quick_message', { name: 'Premier', body: 'UN' }), n('b', 'quick_message', { name: 'Second', body: 'DEUX' })],
      edges: [e('q', 'a', 'btn:0'), e('a', 'b')],
    };
    const m = monde(g, PARCOURS('q', 'waiting'), {}, ['UN', 'DEUX']);
    await m.executor.advance('t1', WA, 'wamid.1', 'btn:0');
    expect(m.journal.map((l) => l.erreur.match(/« (.+?) »/)?.[1])).toEqual(['Premier', 'Second']);
  });

  it('🔴 l’écriture d’état perdue (un autre traitement tient le parcours) : aucune ligne, ni à l’arrêt ni après un envoi parti', async () => {
    silence();
    const arret = monde(REPONSE_PUIS_DEVIS, PARCOURS('q', 'waiting'), {}, ['DEVIS'], { ecritureRefusee: true });
    await arret.executor.advance('t1', WA, 'wamid.1', 'btn:0');
    // La preuve que la branche de l'arrêt a tourné : le passage à l'équipe a lieu quand même, comme avant ce lot.
    expect(arret.escalades).toEqual([WA]);
    expect(arret.journal).toEqual([]);

    const partiel = monde(MERCI_PUIS_DEVIS, PARCOURS('q', 'waiting'), {}, ['DEVIS'], { ecritureRefusee: true });
    await partiel.executor.advance('t1', WA, 'wamid.1', 'btn:0');
    expect(partiel.envois).toEqual(['MERCI']);
    expect(partiel.journal).toEqual([]);
  });

  it('🔴 le contact a dit STOP : aucune ligne (une règle), même si la conversation passe à l’équipe', async () => {
    silence();
    const m = monde(REPONSE_PUIS_DEVIS, PARCOURS('q', 'waiting'), { estDesabonne: toujoursDesabonne }, []);
    await m.executor.advance('t1', WA, 'wamid.1', 'btn:0');
    // La preuve que le chemin du refus a tourné : le parcours est clos et passé à l'équipe, comme avant ce lot.
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox', lastMessageId: 'wamid.1' }]);
    expect(m.escalades).toEqual([WA]);
    expect(m.journal).toEqual([]);
  });

  it('🔴 le contact a dit STOP en RCS : aucune ligne non plus', async () => {
    silence();
    const sansCache: ReachabilityStore = { get: async () => null, put: async () => {} };
    const fournisseur = new FakeRcsProvider();
    const rcs: WorkflowExecutorDeps['rcs'] = {
      ...rcsSansAgent,
      agentIdFor: async () => 'agent-1',
      sender: new RcsSender(fournisseur, new Reachability(fournisseur, sansCache), { isOptedOut: async () => true }),
    };
    const m = monde(REPONSE_PUIS_DEVIS, { ...PARCOURS('q', 'waiting'), channel: 'rcs' }, { rcs }, []);
    await m.executor.advance('t1', WA, 'msg-rcs-1', 'btn:0', 'rcs');
    // La preuve que l'envoi RCS a été tenté puis refusé : le parcours est clos et passé à l'équipe, comme avant ce lot.
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox', lastMessageId: 'msg-rcs-1' }]);
    expect(m.escalades).toEqual([WA]);
    expect(m.journal).toEqual([]);
  });

  it('🔴 sans accord marketing : aucune ligne (une règle), le parcours se clôt sans passer à l’équipe', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [question, n('promo', 'template', { name: 'Promo', templateName: 'promo', language: 'fr' })],
      edges: [e('q', 'promo', 'btn:0')],
    };
    const m = monde(g, PARCOURS('q', 'waiting', true), { aAccordMarketing: jamaisDAccord, categorieDuModele: async () => 'marketing' });
    await m.executor.advance('t1', WA, 'wamid.1', 'btn:0');
    expect(m.etats).toEqual([{ currentNode: null, status: 'done', lastMessageId: 'wamid.1' }]);
    expect(m.envois).toEqual([]);
    expect(m.journal).toEqual([]);
  });

  it('🔴 un message parti, puis un modèle Marketing refusé faute d’accord : aucune ligne', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [question, n('a', 'quick_message', { body: 'MERCI' }), n('promo', 'template', { name: 'Promo', templateName: 'promo', language: 'fr' })],
      edges: [e('q', 'a', 'btn:0'), e('a', 'promo')],
    };
    const m = monde(g, PARCOURS('q', 'waiting', true), { aAccordMarketing: jamaisDAccord, categorieDuModele: async () => 'marketing' });
    await m.executor.advance('t1', WA, 'wamid.1', 'btn:0');
    // La preuve que le chemin « un message parti » a tourné : le merci est parti, le parcours a avancé jusqu'au modèle
    // (agent de Meta éteint : un modèle, même sans bouton, attend la réponse du contact).
    expect(m.envois).toEqual(['MERCI']);
    expect(m.etats).toEqual([{ currentNode: 'promo', status: 'waiting', lastMessageId: 'wamid.1', channel: 'whatsapp' }]);
    expect(m.journal).toEqual([]);
  });

  it('le journal en panne n’empêche ni l’arrêt du parcours ni le passage à l’équipe', async () => {
    silence();
    const m = monde(REPONSE_PUIS_DEVIS, PARCOURS('q', 'waiting'), {
      journaliserEchec: async () => { throw new Error('base indisponible'); },
    });
    await expect(m.executor.advance('t1', WA, 'wamid.1', 'btn:0')).resolves.toBeUndefined();
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox', lastMessageId: 'wamid.1' }]);
    expect(m.escalades).toEqual([WA]);
  });
});

describe('le réveil d’un parcours fait partir un envoi refusé', () => {
  it('🔴 rien n’est parti : une ligne nomme le bloc et la raison, sans message reçu, et le parcours passe à l’équipe', async () => {
    silence();
    const m = monde(ATTENTE_PUIS_DEVIS, PARCOURS('w', 'sleeping'));
    expect(await m.executor.resume(PARCOURS('w', 'sleeping'))).toBe(false);
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox' }]);
    expect(m.escalades).toEqual([WA]);
    expect(m.journal).toHaveLength(1);
    expect(m.journal[0]).toMatchObject({ tenantId: 't1', waId: WA, workflowId: 'wf1', runId: 'run-1', messageId: null });
    expect(m.journal[0]!.erreur).toContain('« Relance devis »');
    expect(m.journal[0]!.erreur).toContain(RAISON);
    expect(m.journal[0]!.erreur).toMatch(/s’arrête.*équipe/);
  });

  it('un autre message de l’étape est parti : la ligne le dit', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [n('w', 'wait', { delay: 2, unit: 'days' }), n('a', 'quick_message', { body: 'MERCI' }),
        n('devis', 'quick_message', { name: 'Relance devis', body: 'DEVIS' })],
      edges: [e('w', 'a'), e('a', 'devis')],
    };
    const m = monde(g, PARCOURS('w', 'sleeping'));
    expect(await m.executor.resume(PARCOURS('w', 'sleeping'))).toBe(true);
    expect(m.envois).toEqual(['MERCI']);
    expect(m.escalades).toEqual([]);
    expect(m.journal).toHaveLength(1);
    expect(m.journal[0]!.erreur).toContain('« Relance devis »');
    expect(m.journal[0]!.erreur).toMatch(/autres messages de cette étape sont partis\.$/);
  });

  it('🔴 le parcours remplacé pendant le réveil (écriture refusée) : aucune ligne, ni passage à l’équipe', async () => {
    silence();
    const m = monde(ATTENTE_PUIS_DEVIS, PARCOURS('w', 'sleeping'), {}, ['DEVIS'], { ecritureRefusee: true });
    expect(await m.executor.resume(PARCOURS('w', 'sleeping'))).toBe(false);
    expect(m.escalades).toEqual([]);
    expect(m.journal).toEqual([]);
  });

  it('🔴 fenêtre de 24 h fermée au réveil : une ligne nomme le bloc non envoyé et la fenêtre, le parcours passe à l’équipe', async () => {
    silence();
    const m = monde(ATTENTE_PUIS_DEVIS, PARCOURS('w', 'sleeping'), { isWindowOpen: async () => false }, []);
    expect(await m.executor.resume(PARCOURS('w', 'sleeping'))).toBe(false);
    expect(m.envois).toEqual([]);
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox' }]);
    expect(m.escalades).toEqual([WA]);
    expect(m.journal).toHaveLength(1);
    expect(m.journal[0]).toMatchObject({ workflowId: 'wf1', runId: 'run-1', messageId: null });
    expect(m.journal[0]!.erreur).toContain('« Relance devis »');
    expect(m.journal[0]!.erreur).toMatch(/fenêtre de 24 h/);
    expect(m.journal[0]!.erreur).toMatch(/modèle/);
  });

  it('fenêtre fermée, et un modèle de la partie exécutée refusé : deux lignes, la fenêtre puis le modèle', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [n('w', 'wait', { delay: 2, unit: 'days' }), n('tpl', 'template', { name: 'Rappel', templateName: 'rappel', language: 'fr' }),
        n('devis', 'quick_message', { name: 'Relance devis', body: 'DEVIS' })],
      edges: [e('w', 'tpl'), e('tpl', 'devis')],
    };
    const m = monde(g, PARCOURS('w', 'sleeping'), {
      isWindowOpen: async () => false,
      // Le modèle sans bouton ne fait pas attendre le parcours quand l'agent de Meta répond : le message rapide suit.
      mbaActifPour: async () => true,
      sendTemplate: async () => 'template « rappel » : valeur manquante pour la ou les variables {{1}}',
    }, []);
    expect(await m.executor.resume(PARCOURS('w', 'sleeping'))).toBe(false);
    expect(m.escalades).toEqual([WA]);
    expect(m.journal.map((l) => l.erreur.match(/« (.+?) »/)?.[1])).toEqual(['Relance devis', 'Rappel']);
    expect(m.journal[0]!.erreur).toMatch(/fenêtre de 24 h/);
    expect(m.journal[1]!.erreur).toMatch(/valeur manquante/);
  });

  it('fenêtre fermée devant un agent IA : la ligne nomme le bloc agent, sans conseiller un modèle', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [n('w', 'wait', { delay: 2, unit: 'days' }), n('ag', 'agent', { name: 'Conseiller', agentId: 'agent-1' })],
      edges: [e('w', 'ag')],
    };
    const m = monde(g, PARCOURS('w', 'sleeping'), { isWindowOpen: async () => false }, []);
    expect(await m.executor.resume(PARCOURS('w', 'sleeping'))).toBe(false);
    expect(m.escalades).toEqual([WA]);
    expect(m.journal).toHaveLength(1);
    expect(m.journal[0]!.erreur).toContain('« Conseiller »');
    expect(m.journal[0]!.erreur).toMatch(/fenêtre de 24 h/);
    expect(m.journal[0]!.erreur).toMatch(/agent IA/);
    expect(m.journal[0]!.erreur).not.toMatch(/modèle/);
  });

  it('🔴 STOP et fenêtre fermée au réveil : aucune ligne (un modèle aurait été refusé lui aussi)', async () => {
    silence();
    const m = monde(ATTENTE_PUIS_DEVIS, PARCOURS('w', 'sleeping'), { isWindowOpen: async () => false, estDesabonne: toujoursDesabonne }, []);
    expect(await m.executor.resume(PARCOURS('w', 'sleeping'))).toBe(false);
    // La preuve que la branche de la fenêtre fermée a tourné : clos et passé à l'équipe, comme avant ce lot.
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox' }]);
    expect(m.escalades).toEqual([WA]);
    expect(m.journal).toEqual([]);
  });

  it('🔴 sans accord marketing au réveil : aucune ligne (une règle)', async () => {
    silence();
    const g: WorkflowGraph = {
      nodes: [n('w', 'wait', { delay: 2, unit: 'days' }), n('promo', 'template', { name: 'Promo', templateName: 'promo', language: 'fr' })],
      edges: [e('w', 'promo')],
    };
    const m = monde(g, PARCOURS('w', 'sleeping', true), { aAccordMarketing: jamaisDAccord, categorieDuModele: async () => 'marketing' });
    expect(await m.executor.resume(PARCOURS('w', 'sleeping', true))).toBe(false);
    expect(m.etats).toEqual([{ currentNode: null, status: 'done' }]);
    expect(m.journal).toEqual([]);
  });

  it('le journal en panne au réveil n’empêche ni l’arrêt ni le passage à l’équipe', async () => {
    silence();
    const m = monde(ATTENTE_PUIS_DEVIS, PARCOURS('w', 'sleeping'), {
      journaliserEchec: async () => { throw new Error('base indisponible'); },
    });
    await expect(m.executor.resume(PARCOURS('w', 'sleeping'))).resolves.toBe(false);
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox' }]);
    expect(m.escalades).toEqual([WA]);
  });
});
