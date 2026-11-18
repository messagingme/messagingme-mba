/**
 * L'ANALYSE DE FENÊTRE D'UN SCÉNARIO DEPUIS SES DÉPARTS (menu « Scénario », lot 2, spec décisions 11 et 16, § 5.2).
 * Commune au serveur (les départs d'un scénario, l'avertissement d'une automation) et à la console (les bandeaux du
 * builder). Pure : les deux appelants fournissent leur lecture d'un bloc (`ReglesFenetre`), comme pour
 * `ouverture-scenario.ts`.
 *
 * 🔴 ELLE PRÉVIENT, ELLE NE REFUSE RIEN (décision 16). Un message de session (message rapide, formulaire, question,
 * agent) atteint fenêtre FERMÉE serait refusé par Meta (131047) ou retenu par le moteur : le builder le dit, avec la
 * phrase qui dit quoi faire.
 *
 * Les règles du parcours :
 * - un départ porte son état : FERMÉ pour un scénario lancé par un événement (rayon Shopify ou HubSpot, automation qui ne
 *   naît pas d'un message du client), OUVERT pour un mot-clé, un nouveau contact, un clic sur une publicité ;
 * - une réponse ou un clic du contact (toute sortie d'un bloc qui attend une réponse, sauf « pas de réponse » et « puis,
 *   sans attendre ») rouvre la fenêtre et remet le compte à zéro ;
 * - la sortie « pas de réponse » garde l'état et ajoute son délai ; une Attente ajoute sa durée ; 24 h cumulées ferment ;
 * - un « Aller à » interne est suivi ; un « Aller à » vers un autre scénario, atteint fermé, est un constat (son
 *   ouverture ne se juge pas ici).
 * Sans départ fourni : un départ ouvert à l'entrée, le comportement d'aujourd'hui.
 */
import { blocDuCode, cibleDuSaut, entreeDuGraphe, type GrapheOuverture, type NoeudOuverture } from './ouverture-scenario';

/** La fenêtre de service WhatsApp : 24 h depuis le dernier message du contact. */
export const FENETRE_MS = 24 * 3_600_000;
/** Les sorties qui ne sont PAS une réponse du contact : « pas de réponse » et « puis, sans attendre ». */
const SORTIES_SANS_REPONSE: ReadonlySet<string> = new Set(['timeout', 'ensuite']);

export type EtatFenetre = 'ouverte' | 'fermee';

/** D'où part un scénario, et dans quel état de fenêtre. `noeudId` nul : l'entrée du scénario. */
export interface Depart {
  noeudId: string | null;
  fenetre: EtatFenetre;
  /** Ce qui lance le scénario par ce départ, dit à l'écran (« l'automation Rappel », « un événement Shopify »). */
  raison: string;
}

/** Un message de session ou un saut vers un autre scénario, atteint fenêtre fermée depuis ce départ. */
export interface Constat {
  noeudId: string;
  raison: 'session_fenetre_fermee' | 'saut_fenetre_fermee';
  depart: Depart;
}

/** La lecture d'un bloc, fournie par l'appelant (le moteur côté serveur, l'éditeur côté console). */
export interface ReglesFenetre<N extends NoeudOuverture> {
  /** Ce bloc envoie-t-il un message de session configuré (message rapide, formulaire, question, agent) ? */
  envoieSession(node: N): boolean;
  /** Ce bloc attend-il une réponse du contact, si bien que ses sorties (hors « pas de réponse ») sont des réponses ? */
  attendUneReponse(node: N): boolean;
  /** Le délai « pas de réponse » de ce bloc, en millisecondes (0 = aucun). */
  delaiSansReponseMs(node: N): number;
  /** La durée d'un bloc Attente, en millisecondes (0 pour tout autre bloc, ou une durée inconnue). */
  dureeAttenteMs(node: N): number;
}

export function analyserFenetre<N extends NoeudOuverture>(
  graph: GrapheOuverture<N>, departs: readonly Depart[], regles: ReglesFenetre<N>,
): Constat[] {
  const parId = new Map(graph.nodes.map((x) => [x.id, x] as const));
  const constats: Constat[] = [];
  const dejaDits = new Set<string>();
  const effectifs: readonly Depart[] = departs.length > 0 ? departs : [{ noeudId: null, fenetre: 'ouverte', raison: '' }];

  for (const depart of effectifs) {
    const premier = depart.noeudId === null ? entreeDuGraphe(graph) : parId.get(depart.noeudId) ?? null;
    if (!premier) continue;
    const vus = new Set<string>();
    const aExplorer: Array<{ id: string; ouverte: boolean; cumulMs: number }> = [
      { id: premier.id, ouverte: depart.fenetre === 'ouverte', cumulMs: 0 },
    ];
    while (aExplorer.length > 0) {
      const etat = aExplorer.pop()!;
      const cumul = Math.min(etat.cumulMs, FENETRE_MS);
      const ouverte = etat.ouverte && cumul < FENETRE_MS;
      const cle = `${etat.id}|${ouverte ? 1 : 0}|${cumul}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      const noeud = parId.get(etat.id);
      if (!noeud) continue;

      if (!ouverte && regles.envoieSession(noeud)) {
        const dit = `${depart.noeudId ?? ''}|${noeud.id}`;
        if (!dejaDits.has(dit)) { dejaDits.add(dit); constats.push({ noeudId: noeud.id, raison: 'session_fenetre_fermee', depart }); }
        // On ne poursuit pas au-delà : ce message ne partirait pas, la suite dépend de ce que le moteur en ferait.
        continue;
      }

      if (noeud.type === 'aller_a') {
        const vise = blocDuCode(graph, cibleDuSaut(noeud));
        if (vise) { aExplorer.push({ id: vise.id, ouverte, cumulMs: cumul }); continue; }
        if (cibleDuSaut(noeud) !== '' && !ouverte) {
          const dit = `${depart.noeudId ?? ''}|${noeud.id}`;
          if (!dejaDits.has(dit)) { dejaDits.add(dit); constats.push({ noeudId: noeud.id, raison: 'saut_fenetre_fermee', depart }); }
        }
        continue;
      }

      const attend = regles.attendUneReponse(noeud);
      const apresAttente = cumul + regles.dureeAttenteMs(noeud);
      for (const arete of graph.edges) {
        if (arete.source !== noeud.id) continue;
        const poignee = arete.sourceHandle ?? '';
        if (poignee === 'timeout') {
          aExplorer.push({ id: arete.target, ouverte, cumulMs: cumul + regles.delaiSansReponseMs(noeud) });
        } else if (attend && !SORTIES_SANS_REPONSE.has(poignee)) {
          // Une réponse ou un clic du contact : la fenêtre se rouvre, le compte repart de zéro.
          aExplorer.push({ id: arete.target, ouverte: true, cumulMs: 0 });
        } else {
          aExplorer.push({ id: arete.target, ouverte, cumulMs: apresAttente });
        }
      }
    }
  }
  return constats;
}
