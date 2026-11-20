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
import { FENETRE_AU_DEPART, type AutomationTriggerKind } from './automations';

/** La fenêtre de service WhatsApp : 24 h depuis le dernier message du contact. */
export const FENETRE_MS = 24 * 3_600_000;
/**
 * Le pas du balayage des réveils : un délai ou une attente plus courts comptent pour lui. C'est ce qui borne l'analyse
 * d'un cycle d'attentes minuscules (un délai fractionnaire posé par l'API, 60 ms) : sans plancher, le cumul y croîtrait par
 * pas de 60 ms jusqu'à 24 h, soit 1,4 million d'états par bloc, et `GET /automations` analyse chaque automation. Même
 * plancher que l'ancien avertissement de la console (`waitBeforeSessionMessage`).
 */
const PAS_MIN_MS = 60_000;
const compte = (ms: number): number => (ms > 0 ? Math.max(ms, PAS_MIN_MS) : 0);

/** Les sorties qui ne sont PAS une réponse du contact : « pas de réponse » et « puis, sans attendre ». */
// `non_livre` : Meta n'a pas livré le template (sortie « En cas d'échec », 2026-11-20), le contact n'a rien dit.
const SORTIES_SANS_REPONSE: ReadonlySet<string> = new Set(['timeout', 'ensuite', 'non_livre']);

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
  // Les arêtes sortantes de chaque bloc, lues une fois : sans cet index, chaque état parcourait toutes les arêtes.
  const sortantes = new Map<string, Array<(typeof graph.edges)[number]>>();
  for (const a of graph.edges) {
    const liste = sortantes.get(a.source);
    if (liste) liste.push(a);
    else sortantes.set(a.source, [a]);
  }
  const constats: Constat[] = [];
  const dejaDits = new Set<string>();
  const effectifs: readonly Depart[] = departs.length > 0 ? departs : [{ noeudId: null, fenetre: 'ouverte', raison: '' }];

  for (const depart of effectifs) {
    const premier = depart.noeudId === null ? entreeDuGraphe(graph) : parId.get(depart.noeudId) ?? null;
    if (!premier) continue;
    // 🔴 UNE SEULE VALEUR PAR BLOC, PAR DOMINANCE (relecture de 2b-1, rouge). Un état exact (bloc, ouverte, cumul) se
    // multipliait par combinaison de durées : trois boucles d'attentes fractionnaires sur un même bloc faisaient 46 s et
    // 1,4 Go. Or tout constat atteignable depuis un cumul ouvert l'est aussi depuis un cumul plus grand, et depuis une
    // fenêtre fermée : on ne repart d'un bloc que si l'on y arrive « pire » qu'avant (comme `explorerLesAttentes`).
    const meilleur = new Map<string, number>();
    const aExplorer: Array<{ id: string; ouverte: boolean; cumulMs: number }> = [
      { id: premier.id, ouverte: depart.fenetre === 'ouverte', cumulMs: 0 },
    ];
    while (aExplorer.length > 0) {
      const etat = aExplorer.pop()!;
      const cumul = Math.min(etat.cumulMs, FENETRE_MS);
      const ouverte = etat.ouverte && cumul < FENETRE_MS;
      const rang = ouverte ? cumul : Number.POSITIVE_INFINITY;
      const deja = meilleur.get(etat.id);
      if (deja !== undefined && deja >= rang) continue;
      meilleur.set(etat.id, rang);
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
      const apresAttente = cumul + compte(regles.dureeAttenteMs(noeud));
      for (const arete of sortantes.get(noeud.id) ?? []) {
        const poignee = arete.sourceHandle ?? '';
        if (poignee === 'timeout') {
          aExplorer.push({ id: arete.target, ouverte, cumulMs: cumul + compte(regles.delaiSansReponseMs(noeud)) });
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

/** Ce qui lance un scénario, relu en base (`PgWorkflowStore.lanceursDuScenario`) : une automation allumée ou une campagne
 *  active. `declencheur` : celui de l'automation (`null` pour une campagne). */
export interface Lanceur {
  type: 'automation' | 'campagne';
  nom: string;
  declencheur: AutomationTriggerKind | null;
  blocDeDepart: string | null;
}

/**
 * Les départs d'un scénario (`GET /workflows/:id`) : un scénario Shopify ou HubSpot part FERMÉ, lancé par un événement ;
 * un scénario du Builder part ouvert à l'entrée (mot-clé, Inbox, réponse d'un client), plus un départ FERMÉ par lanceur
 * qui ne naît pas d'un message du client (une campagne, une automation dont le déclencheur est fermé), à son bloc de départ.
 */
export function departsDuScenario(rayon: string, lanceurs: readonly Lanceur[]): Depart[] {
  if (rayon === 'shopify') return [{ noeudId: null, fenetre: 'fermee', raison: 'un événement Shopify' }];
  if (rayon === 'hubspot') return [{ noeudId: null, fenetre: 'fermee', raison: 'un événement HubSpot' }];
  const departs: Depart[] = [{ noeudId: null, fenetre: 'ouverte', raison: '' }];
  for (const l of lanceurs) {
    if (l.type === 'campagne') departs.push({ noeudId: null, fenetre: 'fermee', raison: `la campagne « ${l.nom} »` });
    else if (l.declencheur !== null && FENETRE_AU_DEPART[l.declencheur] === 'fermee') {
      departs.push({ noeudId: l.blocDeDepart, fenetre: 'fermee', raison: `l’automation « ${l.nom} »` });
    }
  }
  return departs;
}
