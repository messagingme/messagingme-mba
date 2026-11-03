import { jamaisDesabonne, toujoursDAccord } from './consentement';
import { avecGardesDEtatInertes, depsInertes } from './executeur-inerte';
import { describe, it, expect, vi } from 'vitest';
import { WorkflowExecutor } from '../src/workflow/executor';
import type { WorkflowExecutorDeps } from '../src/workflow/executor';
import type { WorkflowGraph, WorkflowNodeType } from '../src/workflow/graph';
import type { WorkflowRunRow, RunState } from '../src/workflow/run-store.pg';
import { runWorkflowWakeSweep } from '../src/workflow/wake-sweep';
import type { DueRun } from '../src/workflow/wake-sweep';

/**
 * Bloc QUESTION : l'EXÉCUTION. Le contrat pur est dans `workflow-question-node`, ici on vérifie ce que
 * l'executor en fait vraiment.
 *
 * Ce que ce fichier verrouille, et pourquoi chaque cas coûterait cher s'il lâchait :
 *  - l'échéance est POSÉE sur un run `waiting` (et pas `sleeping`) : c'est ce qui permet à la fois de
 *    recevoir la réponse et d'être réveillé par le balayeur ;
 *  - une ligne du menu route vers SA branche, et une ligne branchée sur rien ESCALADE au lieu de rendre la
 *    main en silence (le contact a fait un choix qu'on lui a proposé) ;
 *  - une réponse écrite prend la sortie libre, même quand le menu existe ;
 *  - à l'échéance, on sort par `timeout` et JAMAIS par le successeur.
 */
const n = (id: string, type: WorkflowNodeType, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const e = (id: string, source: string, target: string, sourceHandle?: string) =>
  ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) });

/** Question à deux lignes, avec une branche par ligne, une sortie libre et une sortie « pas de réponse ». */
const GRAPHE: WorkflowGraph = {
  nodes: [
    n('q', 'question', { body: 'Ça vous convient ?', buttonLabel: 'Répondre', rows: [{ title: 'Oui' }, { title: 'Non' }], timeoutValue: 30, timeoutUnit: 'minutes' }),
    n('oui', 'tag', { tag: 'ok' }),
    n('non', 'tag', { tag: 'refus' }),
    n('libre', 'tag', { tag: 'ecrit' }),
    n('muet', 'tag', { tag: 'sans-reponse' }),
  ],
  edges: [
    e('e1', 'q', 'oui', 'row:0'),
    e('e2', 'q', 'non', 'row:1'),
    e('e3', 'q', 'libre'), // sortie LIBRE : aucune poignée, donc aucun sourceHandle
    e('e4', 'q', 'muet', 'timeout'),
  ],
};

interface Capture {
  envois: string[];
  tags: string[];
  etats: Array<{ id: string; state: RunState }>;
  escalades: string[];
}

function monter(graph: WorkflowGraph, run: WorkflowRunRow | null, cap: Capture, over: Partial<WorkflowExecutorDeps> = {}) {
  const deps: WorkflowExecutorDeps = {
    ...depsInertes,
    estDesabonne: jamaisDesabonne,
    aAccordMarketing: toujoursDAccord,
    runs: avecGardesDEtatInertes({
      start: async (_t: string, _w: string, _wa: string, _c: string | null, state: RunState) => { cap.etats.push({ id: 'r1', state }); return { id: 'r1' }; },
      findWaitingByWaId: async () => run,
      setState: async (id: string, state: RunState) => { cap.etats.push({ id, state }); },
      // Ferme le parcours precedent : requis par le contrat depuis que « lancer un scenario remplace
      // celui en cours ». Le compteur sert aux tests qui verifient QUE la fermeture a bien eu lieu.
      closeActiveByWaId: async () => [],
    }),
    getGraph: async () => graph,
    applyTag: async (_t, _w, tag) => { cap.tags.push(tag); },
    setField: async () => {},
    removeTag: async () => {},
    clearField: async () => {},
    sendTemplate: async () => {},
    sendQuickMessage: async () => {},
    sendFlow: async () => {},
    sendQuestion: async (_t, _w, body, bouton, rows) => {
      cap.envois.push(`${body}|${bouton}|${rows.map((r) => r.title).join(',')}`);
    },
    isWindowOpen: async () => true,
    escalateToHuman: async (_t, waId) => { cap.escalades.push(waId); },
    now: () => 1_000_000,
    ...over,
  };
  return { ex: new WorkflowExecutor(deps), deps };
}

const capture = (): Capture => ({ envois: [], tags: [], etats: [], escalades: [] });
const runQ = (): WorkflowRunRow => ({
  id: 'r1', workflowId: 'wf1', tenantId: 't1', waId: '33600', contactId: 'c1',
  currentNode: 'q', status: 'waiting', lastMessageId: null, channel: 'whatsapp', grapheFige: null, exigeAccordMarketing: false,
});

describe('bloc Question : l’envoi et l’échéance', () => {
  it('🔴 envoie la question et pose l’échéance sur un run WAITING, pas SLEEPING', async () => {
    // C'est LE point d'architecture du bloc : `findWaitingByWaId` ne voit que les runs `waiting`, donc un run
    // `sleeping` ne pourrait jamais recevoir la réponse du contact. L'échéance doit donc cohabiter avec
    // `waiting`, ce qu'aucun autre bloc ne fait.
    const cap = capture();
    const { ex } = monter(GRAPHE, null, cap);
    await ex.demarrer('automatisme_ordinaire', 't1', 'wf1', GRAPHE, { waId: '33600', contactId: 'c1' }, { depuis: 'entree', fenetreOuverte: true });
    expect(cap.envois).toEqual(['Ça vous convient ?|Répondre|Oui,Non']);
    const etat = cap.etats.at(-1)?.state;
    expect(etat?.status).toBe('waiting');
    expect(etat?.currentNode).toBe('q');
    expect(etat?.resumeAt?.getTime()).toBe(1_000_000 + 30 * 60_000);
  });

  it('sans délai, aucune échéance n’est posée : la question attend sans limite', async () => {
    const g: WorkflowGraph = { ...GRAPHE, nodes: GRAPHE.nodes.map((x) => (x.id === 'q' ? n('q', 'question', { body: 'Q', rows: [{ title: 'Oui' }] }) : x)) };
    const cap = capture();
    const { ex } = monter(g, null, cap);
    await ex.demarrer('automatisme_ordinaire', 't1', 'wf1', g, { waId: '33600', contactId: 'c1' }, { depuis: 'entree', fenetreOuverte: true });
    expect(cap.etats.at(-1)?.state.resumeAt).toBeUndefined();
  });

  it('🔴 hors fenêtre de 24 h, la question ne part PAS (c’est un message de session)', async () => {
    const cap = capture();
    const { ex } = monter(GRAPHE, null, cap, { isWindowOpen: async () => false });
    // La campagne à scénario garde la fenêtre : c'est le chemin qui part à froid.
    const refus = await ex.demarrer('campagne_scenario', 't1', 'wf1', GRAPHE, { waId: '33600', contactId: 'c1' });
    expect(cap.envois).toEqual([]);
    expect(String(refus)).toContain('question');
  });
});

describe('bloc Question : le routage de la réponse', () => {
  it('🔴 une ligne du menu part sur SA branche', async () => {
    const cap = capture();
    const { ex } = monter(GRAPHE, runQ(), cap);
    await ex.advance('t1', '33600', 'm1', 'row:1');
    expect(cap.tags).toEqual(['refus']);
  });

  it('🔴 une réponse ÉCRITE prend la sortie libre, même quand le menu existe', async () => {
    // C'est la demande explicite : un menu n'empêche pas d'écrire, et ce cas doit pouvoir être prévu.
    const cap = capture();
    const { ex } = monter(GRAPHE, runQ(), cap);
    await ex.advance('t1', '33600', 'm1', null);
    expect(cap.tags).toEqual(['ecrit']);
  });

  it('🔴 une ligne branchée sur RIEN escalade vers un humain', async () => {
    // Le contact a fait un choix qu'on lui a proposé et n'a rien reçu : c'est un trou de MONTAGE, pas une
    // sortie de script. Sans le préfixe `row:` dans la règle, ce cas retomberait en silence sur « il a écrit ».
    // On retire la branche de `row:1` ET la sortie libre : sans elle, la réponse retomberait sur
    // « il a écrit » et le test passerait pour la mauvaise raison.
    const g: WorkflowGraph = { ...GRAPHE, edges: GRAPHE.edges.filter((x) => x.sourceHandle !== undefined && x.sourceHandle !== 'row:1') };
    const cap = capture();
    const { ex } = monter(g, runQ(), cap);
    await ex.advance('t1', '33600', 'm1', 'row:1');
    expect(cap.escalades).toEqual(['33600']);
    expect(cap.etats.at(-1)?.state.status).toBe('done');
  });

  it('répondre efface l’échéance : le balayeur ne réveillera pas un parcours déjà reparti', async () => {
    const cap = capture();
    const { ex } = monter(GRAPHE, runQ(), cap);
    await ex.advance('t1', '33600', 'm1', 'row:0');
    // Le parcours se termine sur le tag : l'état écrit ne porte plus d'échéance.
    expect(cap.etats.every((x) => x.state.resumeAt === undefined)).toBe(true);
  });
});

describe('bloc Question : le réveil « pas de réponse »', () => {
  it('🔴 à l’échéance, on sort par `timeout`, JAMAIS par le successeur', async () => {
    const cap = capture();
    const { ex } = monter(GRAPHE, null, cap);
    const repris = await ex.resume({ id: 'r1', workflowId: 'wf1', tenantId: 't1', waId: '33600', contactId: 'c1', currentNode: 'q', status: 'waiting', grapheFige: null, exigeAccordMarketing: false });
    expect(repris).toBe(true);
    expect(cap.tags).toEqual(['sans-reponse']);
  });

  it('🔴 sortie « pas de réponse » NON câblée -> le parcours se clôt et rend la main', async () => {
    // Sans la remise de main, le fil resterait tenu par un parcours mort et l'agent ne reprendrait jamais la
    // parole : la conversation deviendrait muette sans que personne ne le voie.
    const g: WorkflowGraph = { ...GRAPHE, edges: GRAPHE.edges.filter((x) => x.sourceHandle !== 'timeout') };
    const cap = capture();
    const rendus: string[] = [];
    const { ex } = monter(g, null, cap, {
      mbaActifPour: async () => true,
      releaseToMba: async (_t: string, waId: string) => { rendus.push(waId); },
    });
    const repris = await ex.resume({ id: 'r1', workflowId: 'wf1', tenantId: 't1', waId: '33600', contactId: 'c1', currentNode: 'q', status: 'waiting', grapheFige: null, exigeAccordMarketing: false });
    expect(repris).toBe(false);
    expect(cap.etats.at(-1)?.state.status).toBe('done');
    expect(rendus).toEqual(['33600']);
  });

  it('contrôle : un bloc ATTENTE garde son comportement, il reprend au SUCCESSEUR', async () => {
    // La règle ne doit pas déborder sur le bloc Attente, dont le réveil repart du bloc suivant.
    const g: WorkflowGraph = {
      nodes: [n('w', 'wait', { delay: 1, unit: 'hours' }), n('apres', 'tag', { tag: 'apres-attente' })],
      edges: [e('e1', 'w', 'apres')],
    };
    const cap = capture();
    const { ex } = monter(g, null, cap);
    await ex.resume({ id: 'r1', workflowId: 'wf1', tenantId: 't1', waId: '33600', contactId: 'c1', currentNode: 'w', status: 'sleeping', grapheFige: null, exigeAccordMarketing: false });
    expect(cap.tags).toEqual(['apres-attente']);
  });
});

/**
 * Le BALAYEUR sert desormais DEUX familles d'echeance : le sommeil d'un bloc Attente, et le delai « pas de
 * reponse » d'un bloc Question. Elles ne se reclament pas pareil, et la confusion se paierait cher : une
 * question jamais reveillee, ou un dormant reveille par la mauvaise sortie.
 */
describe('balayeur : les deux familles d echeance', () => {
  const dormant = (id: string): DueRun => ({ id, workflowId: 'wf', tenantId: 't1', waId: '33600', currentNode: 'w', grapheFige: null, exigeAccordMarketing: false, lastMessageId: null });
  const question = (id: string): DueRun => ({ id, workflowId: 'wf', tenantId: 't1', waId: '33601', currentNode: 'q', status: 'waiting', grapheFige: null, exigeAccordMarketing: false, lastMessageId: null });

  it('reprend les dormants ET les questions sans reponse, en portant leur statut', async () => {
    const vus: Array<{ id: string; status?: string }> = [];
    const n = await runWorkflowWakeSweep({
      runs: {
        claimDueSleeping: async () => [dormant('a')],
        claimDueQuestions: async () => [question('b')],
      },
      executor: {
        resume: async (r) => { vus.push({ id: r.id, ...(r.status ? { status: r.status } : {}) }); return true; },
      },
    });
    expect(n).toBe(2);
    expect(vus).toEqual([{ id: 'a' }, { id: 'b', status: 'waiting' }]);
  });

  it('sans la reclamation des questions, le comportement d avant est inchange', async () => {
    const vus: string[] = [];
    const n = await runWorkflowWakeSweep({
      runs: {
        claimDueSleeping: async () => [dormant('a')],
      },
      executor: {
        resume: async (r) => { vus.push(r.id); return true; },
      },
    });
    expect(n).toBe(1);
    expect(vus).toEqual(['a']);
  });

  it('UNE reclamation des questions en echec n empeche pas les dormants de repartir', async () => {
    // Le sommeil est le chemin historique : une nouveaute qui casse ne doit pas l emporter avec elle.
    const vus: string[] = [];
    const n = await runWorkflowWakeSweep({
      runs: {
        claimDueSleeping: async () => [dormant('a')],
        claimDueQuestions: async () => { throw new Error('base indisponible'); },
      },
      executor: {
        resume: async (r) => { vus.push(r.id); return true; },
      },
    });
    expect(n).toBe(1);
    expect(vus).toEqual(['a']);
  });
});

/**
 * Bloc QUESTION qui RANGE sa réponse (spec du 2026-11-02) : la pièce jointe reconnue par son type réel, la mention
 * écrite dans le champ, le texte et la ligne choisie. Ce que chaque cas protège :
 *  - une pièce acceptée part sur « Fichier reçu », jamais sur la branche prévue pour le texte ;
 *  - le champ ne reçoit QUE la mention, et la pièce est notée (le lien se fabriquera à l'appel, sur cette note) ;
 *  - un fichier refusé, ou un bloc qui n'attend rien, ne touche pas au champ ;
 *  - un bloc enregistré avant ce lot ne range rien, et une fin silencieuse transmet le message comme avant.
 */
describe('bloc Question : la réponse rangée, pièce jointe comprise', () => {
  const MAINTENANT = Date.parse('2026-11-02T13:32:00Z');
  const MENTION = 'Pièce reçue le 02/11/2026 à 14 h 32 (photo)';
  const reglages = { champReponse: 'piece_identite', attendreFichier: true };
  const graphePiece = (data: Record<string, unknown> = reglages, avecFichier = true): WorkflowGraph => ({
    nodes: [
      n('q', 'question', { body: 'Votre pièce d’identité ?', buttonLabel: 'Choisir', rows: [{ title: 'Oui' }, { title: 'Non' }], ...data }),
      n('recu', 'tag', { tag: 'piece' }),
      n('oui', 'tag', { tag: 'ok' }),
      n('non', 'tag', { tag: 'refus' }),
      n('libre', 'tag', { tag: 'ecrit' }),
    ],
    edges: [
      ...(avecFichier ? [e('e0', 'q', 'recu', 'fichier')] : []),
      e('e1', 'q', 'oui', 'row:0'),
      e('e2', 'q', 'non', 'row:1'),
      e('e3', 'q', 'libre'),
    ],
  });
  const fichier = (type: string, mime: string | null) => ({ reaction: false, type, media: { mime } });

  function monterAvecChamps(graph: WorkflowGraph, run: WorkflowRunRow | null, over: Partial<WorkflowExecutorDeps> = {}) {
    const cap = capture();
    const champs: Array<[string, string]> = [];
    const notes: Array<[string, string, string, string, string]> = [];
    const confies: string[] = [];
    const { ex } = monter(graph, run, cap, {
      now: () => MAINTENANT,
      fuseau: async () => 'Europe/Paris',
      setField: async (_t, _w, cle, valeur) => { champs.push([cle, valeur]); },
      piecesQuestion: { noter: async (t, w, cle, wamid, mention) => { notes.push([t, w, cle, wamid, mention]); } },
      confierAuRepondeur: async (_t, _w, messageId) => { confies.push(messageId); },
      ...over,
    });
    return { ex, cap, champs, notes, confies };
  }

  it('🔴 une photo acceptée part sur « Fichier reçu », le champ reçoit la mention, la pièce est notée', async () => {
    const { ex, cap, champs, notes } = monterAvecChamps(graphePiece(), runQ());
    await ex.advance('t1', '33600', 'wamid.P1', null, 'whatsapp', fichier('image', 'image/jpeg'));
    expect(cap.tags).toEqual(['piece']);
    expect(champs).toEqual([['piece_identite', MENTION]]);
    expect(notes).toEqual([['t1', '33600', 'piece_identite', 'wamid.P1', MENTION]]);
  });

  it('🔴 une photo envoyée « en fichier » (document JPEG) est une photo', async () => {
    const { ex, cap, champs } = monterAvecChamps(graphePiece(), runQ());
    await ex.advance('t1', '33600', 'wamid.P1', null, 'whatsapp', fichier('document', 'image/jpeg'));
    expect(cap.tags).toEqual(['piece']);
    expect(champs).toEqual([['piece_identite', MENTION]]);
  });

  it('une vidéo, avec les types par défaut : sortie libre, champ intact', async () => {
    const { ex, cap, champs, notes } = monterAvecChamps(graphePiece(), runQ());
    await ex.advance('t1', '33600', 'wamid.V1', null, 'whatsapp', fichier('video', 'video/mp4'));
    expect(cap.tags).toEqual(['ecrit']);
    expect(champs).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('un sticker n’est jamais une pièce : sortie libre, rien rangé', async () => {
    const { ex, cap, champs } = monterAvecChamps(graphePiece(), runQ());
    await ex.advance('t1', '33600', 'wamid.S1', null, 'whatsapp', fichier('sticker', 'image/webp'));
    expect(cap.tags).toEqual(['ecrit']);
    expect(champs).toEqual([]);
  });

  it('un texte écrit : sortie libre, le champ reçoit le texte', async () => {
    const { ex, cap, champs, notes } = monterAvecChamps(graphePiece(), runQ());
    await ex.advance('t1', '33600', 'wamid.T1', null, 'whatsapp', { reaction: false, type: 'text', texte: 'Je n’ai pas ma carte' });
    expect(cap.tags).toEqual(['ecrit']);
    expect(champs).toEqual([['piece_identite', 'Je n’ai pas ma carte']]);
    expect(notes).toEqual([]);
  });

  it('une ligne du menu : son titre seulement si la case est cochée', async () => {
    const sans = monterAvecChamps(graphePiece(), runQ());
    await sans.ex.advance('t1', '33600', 'wamid.R1', 'row:1');
    expect(sans.cap.tags).toEqual(['refus']);
    expect(sans.champs).toEqual([]);

    const avec = monterAvecChamps(graphePiece({ ...reglages, rangerLigne: true }), runQ());
    await avec.ex.advance('t1', '33600', 'wamid.R1', 'row:1');
    expect(avec.cap.tags).toEqual(['refus']);
    expect(avec.champs).toEqual([['piece_identite', 'Non']]);
  });

  it('attente de fichier décochée : une photo prend la sortie libre et le champ reste intact', async () => {
    const { ex, cap, champs } = monterAvecChamps(graphePiece({ champReponse: 'piece_identite' }), runQ());
    await ex.advance('t1', '33600', 'wamid.P1', null, 'whatsapp', fichier('image', 'image/jpeg'));
    expect(cap.tags).toEqual(['ecrit']);
    expect(champs).toEqual([]);
  });

  it('🔴 un bloc enregistré avant ce lot ne range rien, texte ou photo', async () => {
    const { ex, cap, champs, notes } = monterAvecChamps(GRAPHE, runQ());
    await ex.advance('t1', '33600', 'wamid.T1', null, 'whatsapp', { reaction: false, type: 'text', texte: 'bonjour' });
    expect(cap.tags).toEqual(['ecrit']);
    expect(champs).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('🔴 le fil tenu par un humain ou l’agent de Meta : l’avance est gelée, rien n’est rangé', async () => {
    const { ex, cap, champs, notes } = monterAvecChamps(graphePiece(), runQ(), { mayAct: async () => false });
    await ex.advance('t1', '33600', 'wamid.P1', null, 'whatsapp', fichier('image', 'image/jpeg'));
    expect(cap.tags).toEqual([]);
    expect(champs).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('🔴 Meta redélivre le même message : rien n’est rangé une seconde fois', async () => {
    const { ex, champs, notes } = monterAvecChamps(graphePiece(), { ...runQ(), lastMessageId: 'wamid.P1' });
    await ex.advance('t1', '33600', 'wamid.P1', null, 'whatsapp', fichier('image', 'image/jpeg'));
    expect(champs).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('la pièce arrive quand aucun parcours n’attend (après le délai) : rien n’est rangé', async () => {
    const { ex, champs, notes } = monterAvecChamps(graphePiece(), null);
    await ex.advance('t1', '33600', 'wamid.P1', null, 'whatsapp', fichier('image', 'image/jpeg'));
    expect(champs).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('🔴 une pièce acceptée sans arête « Fichier reçu » (brouillon) remonte à un humain, jamais sur la sortie libre', async () => {
    const { ex, cap } = monterAvecChamps(graphePiece(reglages, false), runQ());
    await ex.advance('t1', '33600', 'wamid.P1', null, 'whatsapp', fichier('image', 'image/jpeg'));
    expect(cap.tags).toEqual([]);
    expect(cap.escalades).toEqual(['33600']);
  });

  it('🔴 la note de la pièce échoue : le champ reçoit QUAND MÊME la mention neuve, pour qu’aucun lien ne parte vers la pièce précédente', async () => {
    // Relecture du lot : sans cette écriture, le champ gardait la mention d'une pièce plus ancienne, encore notée, et
    // l'Appel API derrière « Fichier reçu » envoyait au stockage le lien de l'ANCIENNE pièce comme celui de la nouvelle.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ex, cap, champs } = monterAvecChamps(graphePiece(), runQ(), {
      piecesQuestion: { noter: async () => { throw new Error('base indisponible'); } },
    });
    await ex.advance('t1', '33600', 'wamid.P2', null, 'whatsapp', fichier('image', 'image/jpeg'));
    vi.restoreAllMocks();
    expect(champs).toEqual([['piece_identite', MENTION]]);
    expect(cap.tags).toEqual(['piece']);
  });

  it('🔴 le fuseau de l’espace est illisible : la mention est datée en UTC, et la pièce est notée', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ex, champs, notes } = monterAvecChamps(graphePiece(), runQ(), { fuseau: async () => { throw new Error('base indisponible'); } });
    await ex.advance('t1', '33600', 'wamid.P2', null, 'whatsapp', fichier('image', 'image/jpeg'));
    vi.restoreAllMocks();
    const utc = 'Pièce reçue le 02/11/2026 à 13 h 32 (photo)';
    expect(notes).toEqual([['t1', '33600', 'piece_identite', 'wamid.P2', utc]]);
    expect(champs).toEqual([['piece_identite', utc]]);
  });

  it('« Fichier reçu » puis fin sans envoi : le message part chez le répondeur, comme aujourd’hui (décision de Julien)', async () => {
    const { ex, confies } = monterAvecChamps(graphePiece(), runQ());
    await ex.advance('t1', '33600', 'wamid.P1', null, 'whatsapp', fichier('image', 'image/jpeg'));
    expect(confies).toEqual(['wamid.P1']);
  });
});
