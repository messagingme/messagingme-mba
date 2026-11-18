import type { WorkflowGraph, WorkflowNode } from './graph';
import { actionOf, delaiSansReponseMs, etapeOffreUnChoix, waitEstimationMs } from './engine';
import { nomDuBloc } from './aller-a';
import { analyserFenetre, type Constat, type Depart, type ReglesFenetre } from '../../web/lib/partage/fenetre-scenario';
import { FENETRE_AU_DEPART, type AutomationTriggerKind } from '../../web/lib/partage/automations';

/**
 * LA LECTURE DES BLOCS PAR LE MOTEUR, POUR L'ANALYSE DE FENÊTRE PARTAGÉE (menu « Scénario », lot 2, décisions 11, 16,
 * 17). Le parcours vit dans `web/lib/partage/fenetre-scenario.ts`, commun avec la console ; ce module dit seulement ce
 * qu'est, pour le moteur, un message de session, un bloc qui attend une réponse, un délai et une attente. Les mêmes
 * définitions que le moteur : `actionOf` (un bloc non configuré n'envoie rien), `etapeOffreUnChoix` (un message
 * rapide à boutons attend), `delaiSansReponseMs`, `waitEstimationMs` (une attente datée compte pour la fenêtre entière).
 */
const TYPES_DE_SESSION: ReadonlySet<string> = new Set(['quick_message', 'flow', 'question']);

export const REGLES_FENETRE_MOTEUR: ReglesFenetre<WorkflowNode> = {
  envoieSession: (node) => (node.type === 'agent'
    ? String(node.data.agentId ?? '').trim() !== ''
    : TYPES_DE_SESSION.has(node.type) && actionOf(node) !== null),
  attendUneReponse: (node) => {
    if (node.type === 'question' || node.type === 'agent') return true;
    if (node.type === 'template' || node.type === 'flow') return actionOf(node) !== null;
    if (node.type === 'quick_message') return etapeOffreUnChoix(actionOf(node));
    return false;
  },
  delaiSansReponseMs,
  dureeAttenteMs: (node) => (node.type === 'wait' ? waitEstimationMs(node) : 0),
};

export function analyserFenetreDuMoteur(graph: WorkflowGraph, departs: readonly Depart[]): Constat[] {
  return analyserFenetre(graph, departs, REGLES_FENETRE_MOTEUR);
}

/**
 * L'avertissement d'une automation (décision 17 : l'écran Automation PRÉVIENT, l'enregistrement passe toujours) : son
 * déclencheur ne naît pas d'un message du client, et son scénario PUBLIÉ envoie, depuis son bloc de départ, un message de
 * session sans réponse du client. `null` : rien à dire.
 */
export function avertissementDeLAutomation(
  declencheur: AutomationTriggerKind, blocDeDepart: string | null, graph: WorkflowGraph,
): string | null {
  if (FENETRE_AU_DEPART[declencheur] !== 'fermee') return null;
  const [premier] = analyserFenetreDuMoteur(graph, [{ noeudId: blocDeDepart, fenetre: 'fermee', raison: '' }]);
  if (!premier) return null;
  const bloc = graph.nodes.find((x) => x.id === premier.noeudId);
  const nom = bloc ? nomDuBloc(bloc) : premier.noeudId;
  return premier.raison === 'saut_fenetre_fermee'
    ? `Ce déclencheur lance le scénario sans que le client ait écrit, et le bloc « ${nom} » saute vers un autre scénario fenêtre fermée : son premier message doit être un template.`
    : `Ce déclencheur lance le scénario sans que le client ait écrit : le bloc « ${nom} » partirait hors de la fenêtre de 24 h et Meta le refuserait. Faites-le précéder d’un template.`;
}
