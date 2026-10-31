import { describe, it, expect } from 'vitest';
import { jamaisDesabonne } from './consentement';
import { avecGardesDEtatInertes, depsInertes } from './executeur-inerte';
import { WorkflowExecutor } from '../src/workflow/executor';
import type { WorkflowExecutorDeps } from '../src/workflow/executor';
import type { WorkflowGraph, WorkflowNodeType } from '../src/workflow/graph';
import type { WorkflowRunRow, RunState } from '../src/workflow/run-store.pg';
import { CreditWhatsappRefus } from '../src/credit-whatsapp/refus';

/**
 * 🔴 LE CRÉDIT WHATSAPP À SEC AU MILIEU D'UN BLOC (écart 10 du plan du Crédit WhatsApp, relecture du lot 1), avec le VRAI
 * `WorkflowExecutor`.
 *
 * La garde du crédit vit dans la fabrique d'envoi et LÈVE son refus. Un bloc qui fait partir deux messages (un message
 * rapide sans bouton, puis un modèle) dont le solde ne couvre que le premier : l'exception sortait d'`apply` après le
 * premier envoi, rien n'était écrit, et la reprise (bail, message suivant du contact, reprise de la campagne après un
 * achat) renvoyait le premier message, payé deux fois. Désormais, un refus du crédit APRÈS un effet de la liste devient un
 * refus d'étape ; AVANT tout effet, il remonte tel quel et le bloc repartira entier après un crédit.
 */

const n = (id: string, type: WorkflowNodeType, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const EMAIL = { emailAccountId: 'a1', templateId: 't1', to: { kind: 'literal', value: 'client@exemple.fr' } };

/** « Attente, message rapide sans bouton, modèle » : à la reprise, deux envois dans la même liste. */
const RAPIDE_PUIS_MODELE: WorkflowGraph = {
  nodes: [n('w', 'wait', { delay: 1, unit: 'days' }), n('q', 'quick_message', { body: 'Bonjour' }), n('tpl', 'template', { templateName: 'rappel' })],
  edges: [{ id: 'e1', source: 'w', target: 'q' }, { id: 'e2', source: 'q', target: 'tpl' }],
};
/** « Attente, e-mail, modèle » : un effet qui n'est pas un message WhatsApp, avant le modèle. */
const EMAIL_PUIS_MODELE: WorkflowGraph = {
  nodes: [n('w', 'wait', { delay: 1, unit: 'days' }), n('em', 'email', EMAIL), n('tpl', 'template', { templateName: 'rappel' })],
  edges: [{ id: 'e1', source: 'w', target: 'em' }, { id: 'e2', source: 'em', target: 'tpl' }],
};
/** « Attente, modèle » : rien avant l'envoi refusé. */
const MODELE_SEUL: WorkflowGraph = {
  nodes: [n('w', 'wait', { delay: 1, unit: 'days' }), n('tpl', 'template', { templateName: 'rappel' })],
  edges: [{ id: 'e1', source: 'w', target: 'tpl' }],
};

const RUN: WorkflowRunRow = {
  id: 'run-1', workflowId: 'wf1', tenantId: 't1', waId: '33611', contactId: 'c1',
  currentNode: 'w', status: 'sleeping', lastMessageId: null, grapheFige: null,
};

/**
 * Le monde : un solde qui couvre `messages` messages WhatsApp. `aSec` = le solde est nul, la vérification préalable le
 * voit (`verifierNumeroWhatsApp` lève, comme `MetaClientFactory.verifierAvantEffets`). Sans `aSec`, un solde positif mais
 * sous le prix passe la vérification et n'est refusé qu'à l'envoi, comme dans la vraie garde.
 */
function monde(graph: WorkflowGraph, credit: { messages: number; aSec?: boolean }, run: WorkflowRunRow = RUN) {
  const effets: string[] = [];
  const etats: RunState[] = [];
  const mesures: string[] = [];
  const escalades: string[] = [];
  const envoyer = (quoi: string): void => {
    if (credit.messages <= 0) throw new CreditWhatsappRefus('solde', 10_000, 74_760);
    credit.messages -= 1;
    effets.push(quoi);
  };
  const runs = {
    closeActiveByWaId: async (): Promise<string[]> => [],
    start: async (): Promise<{ id: string }> => ({ id: 'run-2' }),
    findWaitingByWaId: async (): Promise<WorkflowRunRow | null> => ({ ...run, status: 'waiting' }),
    setState: async (_id: string, s: RunState): Promise<void> => { etats.push(s); },
  };
  const deps: WorkflowExecutorDeps = {
    ...depsInertes,
    estDesabonne: jamaisDesabonne,
    runs: avecGardesDEtatInertes(runs),
    getGraph: async () => graph,
    isWindowOpen: async () => true,
    applyTag: async () => {},
    setField: async () => {},
    removeTag: async () => {},
    clearField: async () => {},
    sendTemplate: async (_t, waId, nom) => { envoyer(`modèle ${nom} ${waId}`); },
    sendQuickMessage: async (_t, waId) => { envoyer(`message ${waId}`); },
    sendFlow: async (_t, waId) => { envoyer(`formulaire ${waId}`); },
    sendQuestion: async (_t, waId) => { envoyer(`question ${waId}`); },
    sendEmail: async (_t, waId) => { effets.push(`e-mail ${waId}`); },
    verifierNumeroWhatsApp: async () => { if (credit.aSec) throw new CreditWhatsappRefus('solde', 1); },
    recordNodeEvent: async (e) => { mesures.push(`${e.nodeId} ${e.kind}`); },
    escalateToHuman: async (_t, waId) => { escalades.push(waId); },
  };
  return { executor: new WorkflowExecutor(deps), deps, credit, effets, etats, mesures, escalades };
}

describe('🔴 le Crédit WhatsApp à sec au MILIEU d’un bloc ne rejoue rien', () => {
  it('le réveil (`resume`) : le message parti n’est jamais renvoyé, le modèle refusé ne part pas, le parcours avance', async () => {
    const m = monde(RAPIDE_PUIS_MODELE, { messages: 1 });
    expect(await m.executor.resume(RUN)).toBe(true);
    expect(m.effets).toEqual(['message 33611']);
    expect(m.mesures).toEqual(['q sent', 'tpl failed']);
    // Un état est ÉCRIT au-delà de l'attente et du message : aucune reprise ne rejouera le message, comme pour tout
    // refus d'un bloc dont un envoi est parti (le parcours attend sur le modèle, qui fait attendre une réponse).
    expect(m.etats).toHaveLength(1);
    expect(m.etats[0]).toMatchObject({ currentNode: 'tpl', status: 'waiting' });
  });

  it('la réponse du contact (`advance`) : même chose, et le message suivant ne renvoie rien', async () => {
    const m = monde(RAPIDE_PUIS_MODELE, { messages: 1 });
    await m.executor.advance('t1', '33611', 'wamid.1');
    expect(m.effets).toEqual(['message 33611']);
    expect(m.etats.at(-1)).toMatchObject({ currentNode: 'tpl', status: 'waiting', lastMessageId: 'wamid.1' });
  });

  it('le bloc poussé par un agent (`envoyerBlocDepuisAgent`) : partiellement parti, donc réussi, sans exception', async () => {
    const graphe: WorkflowGraph = {
      nodes: [n('a', 'agent', { agentId: 'ag1' }), n('q', 'quick_message', { body: 'Bonjour', code: 'nod_t1_BLOC' }), n('tpl', 'template', { templateName: 'rappel' })],
      edges: [{ id: 'e1', source: 'q', target: 'tpl' }],
    };
    const m = monde(graphe, { messages: 1 }, { ...RUN, currentNode: 'a' });
    expect(await m.executor.envoyerBlocDepuisAgent('t1', '33611', { runId: 'run-1', workflowId: 'wf1', graphe, noeudId: 'q' })).toEqual({ ok: true });
    expect(m.effets).toEqual(['message 33611']);
  });

  it('un e-mail parti avant le modèle refusé : refus d’étape, le parcours est clos et remonté, l’e-mail ne repart pas', async () => {
    const m = monde(EMAIL_PUIS_MODELE, { messages: 0 });
    expect(await m.executor.resume(RUN)).toBe(false);
    expect(m.effets).toEqual(['e-mail 33611']);
    expect(m.etats).toEqual([{ currentNode: null, status: 'inbox' }]);
    expect(m.escalades).toEqual(['33611']);
  });

  it('rien avant l’envoi refusé : le refus remonte tel quel, rien n’est écrit, et le bloc repart entier au crédit', async () => {
    const m = monde(MODELE_SEUL, { messages: 0 });
    await expect(m.executor.resume(RUN)).rejects.toBeInstanceOf(CreditWhatsappRefus);
    expect(m.effets).toEqual([]);
    expect(m.etats).toEqual([]);
    m.credit.messages = 1;
    expect(await m.executor.resume(RUN)).toBe(true);
    expect(m.effets).toEqual(['modèle rappel 33611']);
  });

  it('un solde NUL est vu avant tout effet : l’e-mail ne part pas, rien n’est écrit', async () => {
    const m = monde(EMAIL_PUIS_MODELE, { messages: 0, aSec: true });
    await expect(m.executor.resume(RUN)).rejects.toBeInstanceOf(CreditWhatsappRefus);
    await expect(m.executor.advance('t1', '33611', 'wamid.2')).rejects.toBeInstanceOf(CreditWhatsappRefus);
    expect(m.effets).toEqual([]);
    expect(m.etats).toEqual([]);
  });

  it('une autre exception au milieu d’un bloc remonte toujours telle quelle', async () => {
    const m = monde(RAPIDE_PUIS_MODELE, { messages: 1 });
    m.deps.sendTemplate = async () => { throw new Error('panne réseau'); };
    await expect(m.executor.resume(RUN)).rejects.toThrow('panne réseau');
  });
});
