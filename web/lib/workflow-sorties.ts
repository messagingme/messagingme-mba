/**
 * La SORTIE LIBRE d'un bloc (« Toute autre réponse »), et la règle qui la nomme.
 *
 * 🔴 CE QU'ELLE RÉPARE, ET C'EST MESURÉ. Dans le graphe enregistré, la sortie libre est une arête SANS
 * `sourceHandle` : c'est le contrat du moteur (`nextNodeSansHandle`), et il ne bouge pas. Mais React Flow, lui,
 * a besoin d'un identifiant pour savoir DE QUEL POINT partir. Sans identifiant, il ancre la flèche sur la
 * PREMIÈRE poignée de sortie du bloc. Sur un bloc à réponses rapides, la flèche de « Toute autre réponse »
 * était donc dessinée sur la ligne de la PREMIÈRE réponse, où une autre flèche part déjà : d'où les « deux
 * flèches qui partent d'une même réponse » signalées par Julien le 2026-08-28, et l'impression que la sortie
 * libre ne se reliait pas alors qu'elle se reliait ailleurs.
 *
 * La règle : le CANEVAS nomme cette poignée `libre`, le GRAPHE ENREGISTRÉ continue de ne rien porter. La
 * traduction se fait aux deux bords, ici, et nulle part ailleurs. Le format en base, le moteur, l'écran
 * d'Analytics et les scénarios déjà enregistrés ne changent pas d'un octet.
 */

import { SORTIE_FICHIER } from './partage/question-piece';
import { SORTIE_ENSUITE } from './partage/sortie-ensuite';

/** Le nom de la poignée de sortie libre, CÔTÉ CANEVAS uniquement. Jamais enregistré. */
export const SORTIE_LIBRE = 'libre';

/** Graphe enregistré -> canevas : une arête sans poignée part de la sortie libre. */
export function poigneeCanevas(sourceHandle?: string | null): string {
  return sourceHandle && sourceHandle !== '' ? sourceHandle : SORTIE_LIBRE;
}

/** Canevas -> graphe enregistré : la sortie libre redevient une arête sans poignée. */
export function poigneeGraphe(sourceHandle?: string | null): string | undefined {
  if (!sourceHandle || sourceHandle === '' || sourceHandle === SORTIE_LIBRE) return undefined;
  return sourceHandle;
}

/**
 * Décocher « Attendre un fichier » sur un bloc Question emporte son arête « Fichier reçu », et aucune autre. Sans ça,
 * l'arête resterait en base alors que sa poignée a disparu : invisible, mais suivie par le moteur.
 */
export function sansSortieFichier<E extends { source: string; sourceHandle?: string | null }>(edges: E[], nodeId: string): E[] {
  return edges.filter((e) => !(e.source === nodeId && e.sourceHandle === SORTIE_FICHIER));
}

/**
 * Un message rapide qui perd son dernier bouton (retiré, ou remplacé par le bouton de lien) perd sa sortie « Puis, sans
 * attendre » : sa poignée n'est dessinée que sur un bloc à boutons. Sans ça, l'arête resterait en base, invisible, et le
 * moteur la suivrait comme la suite d'un message sans bouton (`nextNode` prend la première arête venue).
 */
export function sansSortieEnsuite<E extends { source: string; sourceHandle?: string | null }>(edges: E[], nodeId: string): E[] {
  return edges.filter((e) => !(e.source === nodeId && e.sourceHandle === SORTIE_ENSUITE));
}

/** La sortie « Pas de réponse » d'un template ou d'une Question : la poignée que suit l'échéance (`timeout`). */
export const SORTIE_PAS_DE_REPONSE = 'timeout';

/** Une sortie reliable d'un bloc template : le nom de sa poignée, et le texte de son bouton. */
export interface SortieDeBouton {
  poignee: string;
  texte: string;
}

/**
 * Les sorties reliables d'un bloc template, telles que le canevas les dessine (`WorkflowNode.tsx`) : les réponses
 * rapides d'un carousel sous la poignée de leur carte, sinon celles du template à leur rang parmi TOUS ses boutons
 * (`btn:<i>`, le payload posé à l'envoi). Lecture défensive : `data` est du JSON libre.
 */
export function sortiesDeBoutons(data: { templateButtons?: unknown; templateCards?: unknown }): SortieDeBouton[] {
  const cartes = Array.isArray(data.templateCards) ? (data.templateCards as Array<{ type?: unknown; text?: unknown; handle?: unknown }>) : [];
  if (cartes.length > 0) {
    return cartes.flatMap((c) => (c?.type === 'QUICK_REPLY' && typeof c.handle === 'string' ? [{ poignee: c.handle, texte: String(c.text ?? '') }] : []));
  }
  const boutons = Array.isArray(data.templateButtons) ? (data.templateButtons as Array<{ type?: unknown; text?: unknown }>) : [];
  return boutons.flatMap((b, i) => (b?.type === 'QUICK_REPLY' ? [{ poignee: `btn:${i}`, texte: String(b.text ?? '') }] : []));
}

/**
 * Les flèches des boutons d'un bloc template quand son template change (menu « Scénario », lot 3 : écrit depuis le
 * bloc, ou choisi dans la liste). Une flèche suit le bouton du nouveau template qui porte le MÊME texte (le premier
 * libre, dans l'ordre) ; sans lui, elle disparaît. Jamais une branche devinée : retirer un bouton du milieu décalait les
 * suivants, et leurs flèches menaient à la mauvaise branche sans aucun signal. Les autres poignées (« Pas de réponse »,
 * la sortie libre) et les flèches des autres blocs ne bougent pas ; une flèche inchangée est rendue telle quelle.
 */
export function flechesSuivantLesBoutons<E extends { source: string; sourceHandle?: string | null }>(
  edges: E[], nodeId: string, avant: readonly SortieDeBouton[], apres: readonly SortieDeBouton[],
): E[] {
  // La correspondance se calcule dans l'ORDRE DES BOUTONS, jamais dans celui des flèches du graphe : deux boutons au même
  // texte gardent ainsi leur ordre, quel que soit l'ordre dans lequel leurs flèches ont été tirées.
  const correspondance = new Map<string, string>();
  const prises = new Set<string>();
  for (const s of avant) {
    const cible = apres.find((x) => x.texte === s.texte && !prises.has(x.poignee));
    if (!cible) continue;
    prises.add(cible.poignee);
    correspondance.set(s.poignee, cible.poignee);
  }
  const deCeBloc = new Set(avant.map((s) => s.poignee));
  return edges.flatMap((e) => {
    if (e.source !== nodeId || !e.sourceHandle || !deCeBloc.has(e.sourceHandle)) return [e];
    const nouvelle = correspondance.get(e.sourceHandle);
    if (!nouvelle) return [];
    return [nouvelle === e.sourceHandle ? e : { ...e, sourceHandle: nouvelle }];
  });
}

/**
 * Un délai « pas de réponse » validé à 0 (le champ quitté, template ou Question) emporte l'arête « Pas de réponse » de ce
 * bloc : sa poignée
 * n'est dessinée qu'avec un délai. Restée en base, l'arête serait invisible ; elle repartirait le jour où un délai serait
 * reposé, vers une suite que personne ne voit plus, et l'analyse de fenêtre la suivrait en attendant.
 */
export function sansSortiePasDeReponse<E extends { source: string; sourceHandle?: string | null }>(edges: E[], nodeId: string): E[] {
  return edges.filter((e) => !(e.source === nodeId && e.sourceHandle === SORTIE_PAS_DE_REPONSE));
}

/**
 * UNE arête par sortie, appliquée au CHARGEMENT et pas seulement à la connexion.
 *
 * 🔴 POURQUOI AU CHARGEMENT AUSSI. Le moteur prend la PREMIÈRE arête qui part d'une sortie
 * (`nextNodeByHandle`, `nextNodeSansHandle`) : une seconde arête sur la même sortie est inatteignable par
 * construction. La dessiner ferait promettre au canevas une branche que le parcours n'empruntera jamais, et
 * c'est le pire cas d'un éditeur visuel : montrer autre chose que ce qui va se passer. On garde donc la
 * première, celle que le moteur suit.
 *
 * La garde de connexion (`onConnect`) empêche d'en créer une seconde depuis le 2026-07-13 ; celle-ci couvre
 * les graphes plus anciens et tout ce qui pourrait écrire dans la table sans passer par l'éditeur.
 */
export function uneAreteParSortie<E extends { source: string; sourceHandle?: string | null }>(edges: E[]): E[] {
  const vues = new Set<string>();
  return edges.filter((e) => {
    const cle = `${e.source}|${poigneeCanevas(e.sourceHandle)}`;
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });
}
