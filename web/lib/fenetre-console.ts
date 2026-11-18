/**
 * LA LECTURE DES BLOCS PAR LA CONSOLE, POUR L'ANALYSE DE FENÊTRE PARTAGÉE (menu « Scénario », lot 2, décisions 11 et 16,
 * § 5.2). Le parcours vit dans `./partage/fenetre-scenario.ts`, commun avec le serveur ; ce module dit seulement ce
 * qu'est, pour l'éditeur, un message de session, un bloc qui attend une réponse, un délai et une attente. Miroir de
 * `REGLES_FENETRE_MOTEUR` (`src/workflow/fenetre-moteur.ts`) : `tests/fenetre-parite.test.ts` compare les deux sur les
 * mêmes graphes, sinon le builder annoncerait un message refusé que le moteur enverrait, ou l'inverse.
 */
import { analyserFenetre, type Constat, type Depart, type ReglesFenetre } from './partage/fenetre-scenario';
import { delaiSansReponseMs, dureeAttenteMs, envoieVraiment, messageNonBloquant, type GraphLike, type GraphNodeLike } from './campaign-eligibility';

/** Les blocs qui envoient un message de SESSION quand ils sont configurés (`envoieVraiment`). */
const TYPES_DE_SESSION: ReadonlySet<string> = new Set(['quick_message', 'flow', 'question', 'agent']);

export const REGLES_FENETRE_CONSOLE: ReglesFenetre<GraphNodeLike> = {
  envoieSession: (node) => TYPES_DE_SESSION.has(node.type) && envoieVraiment(node),
  attendUneReponse: (node) => {
    if (node.type === 'question' || node.type === 'agent') return true;
    if (node.type === 'template') return String(node.data.templateName ?? '').trim() !== '';
    if (node.type === 'flow') return envoieVraiment(node);
    if (node.type === 'quick_message') return envoieVraiment(node) && !messageNonBloquant(node);
    return false;
  },
  delaiSansReponseMs,
  dureeAttenteMs: (node) => (node.type === 'wait' ? dureeAttenteMs(node) : 0),
};

/** Les constats du graphe édité, depuis les départs que le serveur a donnés (absents : un départ ouvert à l'entrée). */
export function analyserFenetreConsole(graph: GraphLike, departs: readonly Depart[]): Constat[] {
  return analyserFenetre(graph, departs, REGLES_FENETRE_CONSOLE);
}
