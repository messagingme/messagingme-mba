import type { WorkflowGraph, WorkflowNode, WorkflowNodeType } from './graph';
import { parseInstant, sortieDeCondition, sortiesDeCondition, SORTIE_SINON } from './conditions';
import type { EvalContext } from './conditions';
// « Quand est le prochain créneau ouvert ? » vit à un seul endroit : le bloc Attente, l'envoi de campagne et
// sa reprise après la fermeture doivent avoir la même réponse.
import { prochaineOuverture } from '../lib/heures-ouvrees';
// Le format de « maintenant » vit dans `src/agent/variables.ts` : un connecteur et un bloc de scénario doivent
// poser la même valeur.
import { formatMaintenant } from '../agent/variables';
// La normalisation d'une étiquette vit dans le geste de pose (`src/crm/poser-etiquette.ts`) : la copie de travail doit
// voir la même valeur que celle que l'exécuteur écrira sur le contact.
import { normaliserEtiquette } from '../crm/poser-etiquette';
import { parseParamHints, type ParamSource } from '../crm/template';
import { renderText } from '../crm/render';
import { encoder } from '../links/champs-url';
import { MAX_DESTINATAIRES_EMAIL } from '../../web/lib/partage/blocs';
import { blocDuCode as blocDuCodePartage, cibleDuSaut as cibleDuSautPartage, entreeDuGraphe, scannerOuverture } from '../../web/lib/partage/ouverture-scenario';
import type { AnalyseOuverture } from '../../web/lib/partage/ouverture-scenario';
import { SORTIE_ENSUITE } from '../../web/lib/partage/sortie-ensuite';
import { champsAVider, etiquettesARetirer, sousActions, type SousAction } from '../../web/lib/partage/actions-bloc';

/**
 * Moteur d'exécution d'un workflow, pur (aucune IO). Un run avance de bloc en bloc : les blocs synchrones
 * (tag/field) produisent une action et on continue ; un bloc qui offre un choix produit son action puis attend
 * une réponse du contact ; `inbox` est terminal (remontée humaine).
 */

/** Bouton d'un template (dénormalisé sur le node à la sélection) : sert à envoyer un payload contrôlé par
 *  bouton quick-reply (branche déterministe) et à afficher les sorties dans l'éditeur. */
export interface WorkflowButton { type: string; text: string }

/** Destinataire du node « Envoi de mail » : adresse en dur, ou variable résolue depuis un champ du contact
 *  (même identité déjà résolue pour l'envoi de template : téléphone ou BSUID, pas un nouveau chemin). */
export type EmailRecipient =
  | { kind: 'literal'; value: string }
  | { kind: 'field'; field: string };

/** Action « Envoi de mail » : boîte SMTP + modèle + destinataires (ids/valeurs opaques), consommée par
 *  l'executor. `to` est une liste (1 à 3) jamais vide : le premier part en « À », les suivants en copie
 *  cachée, car des clients ne doivent pas voir les adresses les uns des autres. */
export interface SendEmailAction {
  kind: 'sendEmail';
  emailAccountId: string;
  templateId: string;
  to: EmailRecipient[];
}

export type WorkflowAction =
  | { kind: 'tag'; tag: string }
  | { kind: 'removeTag'; tag: string }
  | { kind: 'field'; key: string; value: string }
  | { kind: 'clearField'; key: string }
  /**
   * Bloc « Appel HTTP » : joue la requête `requestId` de la bibliothèque et range sa réponse dans `champCible`.
   * `champCible` vide = un appel qui POUSSE (envoyer un message, poser une étiquette chez le client) : rien à
   * ranger, seul le succès compte. L'action porte de quoi aller chercher la réponse, pas la réponse : le walk
   * est pur, l'exécuteur fait l'appel.
   */
  | { kind: 'appelHttp'; requestId: string; champCible: string }
  /**
   * Bloc « Fonction JS » : transforme `champSource` par `code` et range le résultat dans `champCible`. La
   * valeur est relue au moment d'exécuter, pas au walk : un bloc précédent vient peut-être d'écrire ce champ.
   */
  | { kind: 'fonctionJs'; code: string; champSource: string; champCible: string }
  /** Consentement marketing posé par un scénario. Les deux sens, comme depuis la fiche et l'action en masse. */
  | { kind: 'optIn'; value: 'opted_in' | 'opted_out' }
  /** `sources` = champ choisi dans le bloc pour certaines variables, par-dessus ceux du template. Absent = ceux du
   *  template seuls. */
  | { kind: 'sendTemplate'; templateName: string; language: string; buttons: WorkflowButton[]; sources?: Array<{ position: number; source: ParamSource }> }
  /** `mediaUrl` = visuel du bloc, hébergé chez nous (`/m/<code>.<ext>`), le même champ que le bloc RCS.
   *  Absent = message texte.
   *
   *  `lien` = un bouton de lien (WhatsApp `cta_url`, RCS `openUrl`) au lieu de réponses rapides. Les deux
   *  s'excluent chez Meta (deux types de messages interactifs) : quand `lien` est présent, `buttons` est vidé
   *  à la construction de l'action, pour que la couche d'envoi n'ait pas à choisir. `etapeOffreUnChoix` rend
   *  alors `false` et le parcours continue, puisque Meta ne renvoie rien au clic sur un lien. */
  | { kind: 'sendQuickMessage'; body: string; buttons: WorkflowButton[]; mediaUrl?: string; lien?: LienBouton }
  | { kind: 'sendFlow'; flowId: string; flowName: string; body: string; cta: string }
  /**
   * Bloc Question : une question au contact, avec un menu de réponses (liste interactive WhatsApp) ou sans
   * menu. Il attend toujours une réponse, et peut porter une échéance « pas de réponse ».
   *
   * `rows` est transmis entier, lignes au libellé vide comprises : l'index d'une ligne est sa sortie
   * (`row:<i>`), et filtrer en amont renumérote et envoie le contact sur la mauvaise branche. Le filtrage se
   * fait à l'envoi, en préservant l'index.
   */
  | { kind: 'sendQuestion'; body: string; buttonLabel: string; rows: QuestionRow[] }
  | SendEmailAction;

/** Une ligne du menu d'un bloc Question. `title` est ce que le contact lit, `description` est facultative. */
export interface QuestionRow {
  title: string;
  description?: string;
}

/** Ce que l'ouverture d'un scénario contient, en un seul parcours (séparer les deux questions posées sur
 *  l'ouverture dupliquerait la traversée et ses règles). */
export type OpeningScan = AnalyseOuverture<WorkflowNode>;

/** Le code visé par un bloc « Aller à » (`data.cible`), ou `''` s'il n'en vise aucun. */
export function cibleDuSaut(node: WorkflowNode): string {
  return cibleDuSautPartage(node);
}

/** Le bloc de ce graphe qui porte un code public, ou `null` : le graphe joué fait foi. */
export function blocDuCode(graph: WorkflowGraph, code: string): WorkflowNode | null {
  return blocDuCodePartage(graph, code);
}

/**
 * Explore en largeur depuis l'entrée, ou depuis un bloc choisi par l'API publique (`depuis`).
 * Le parcours est commun avec la console ; le moteur garde la définition d'un envoi effectif.
 */
export function scanOpening(graph: WorkflowGraph, depuis?: string): OpeningScan {
  return scannerOuverture<WorkflowNode>(graph, {
    depuis,
    envoieSession: (node) => node.type === 'agent'
      ? String(node.data.agentId ?? '').trim() !== ''
      : actionOf(node) !== null,
    sortiesDeCondition,
    sortieSinon: SORTIE_SINON,
  });
}

/**
 * Ce message rapide laisse-t-il le parcours continuer ? Oui quand il n'a aucune réponse rapide libellée :
 * c'est un simple texte, rien ne viendra en retour, et bloquer là empêcherait les blocs suivants de
 * s'exécuter. Source unique de la règle pour `walk` et `waitBeforeSessionMessage`, qui doivent répondre
 * pareil.
 */
function quickMessageNonBloquant(a: WorkflowAction | null): boolean {
  return a?.kind === 'sendQuickMessage' && !etapeOffreUnChoix(a);
}

/**
 * Les blocs que `walk` traverse sans jamais s'arrêter : ils agissent (ou ne font rien) et le parcours continue. Les
 * blocs MBA retirés sont des passe-plats. Tout autre type attend, rend la main ou clôt le parcours.
 */
const BLOCS_SANS_ATTENTE: ReadonlySet<WorkflowNodeType> = new Set<WorkflowNodeType>([
  'tag', 'field', 'action', 'condition', 'email', 'http', 'js', 'mba_handoff', 'mba_disable',
]);

/**
 * Ce bloc peut-il suivre la sortie « Puis, sans attendre » (`SORTIE_ENSUITE`) d'un message rapide à boutons ?
 *
 * 🔴 POURQUOI SEULEMENT LES BLOCS QUI N'ATTENDENT RIEN (décision de Julien, 2026-11-10). Un parcours n'a qu'UN curseur
 * (`run.currentNode`), et un tap revient en `btn:<i>`, sans dire de quel message il vient. La suite part pendant que le
 * curseur reste sur le message : un bloc qui attendrait à son tour prendrait ce curseur, et un tap sur l'ancien bouton
 * serait lu comme une réponse au nouveau bloc, par position. Un message rapide sans choix passe, comme dans `walk` ; un
 * message rapide sans texte attend (historique de `walk`), il ne passe donc pas.
 */
export function passeSansAttente(node: WorkflowNode, ctx?: EvalContext): boolean {
  if (node.type === 'quick_message') return quickMessageNonBloquant(actionOf(node, ctx));
  return BLOCS_SANS_ATTENTE.has(node.type);
}

/** Le nom d'un bloc qui attend, dans le refus de publication. Les libellés de la console (`web/lib/nodeMeta.ts`). */
const NOM_DU_BLOC: Partial<Record<WorkflowNodeType, string>> = {
  template: 'Envoi template', quick_message: 'Message rapide', inbox: 'Assigner à un agent', flow: 'Formulaire',
  question: 'Question', wait: 'Attente', rcs_message: 'Message RCS', agent: 'Agent IA', aller_a: 'Aller à',
  vers_mba: 'Envoyer au MBA',
};

/**
 * La raison de refuser la publication, ou `null` : la sortie « Puis, sans attendre » d'un message rapide à boutons mène
 * à un bloc qui attend (`passeSansAttente`). Suit les arêtes que `walk` suivrait : toutes les sorties d'une condition
 * (et sa première arête si aucune n'est typée), la première arête des autres. `walk` s'arrête AVANT un tel bloc, sans
 * l'envoyer : ce refus dit le montage au lieu de le laisser se taire en production.
 */
export function refusSuiteQuiAttend(graph: WorkflowGraph): string | null {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const message of graph.nodes) {
    if (message.type !== 'quick_message' || !etapeOffreUnChoix(actionOf(message))) continue;
    const depart = nextNodeByHandle(graph, message.id, SORTIE_ENSUITE);
    const vus = new Set<string>();
    const pile = depart ? [depart] : [];
    while (pile.length > 0) {
      const id = pile.pop()!;
      if (vus.has(id)) continue;
      vus.add(id);
      const n = byId.get(id);
      if (!n) continue;
      if (!passeSansAttente(n)) {
        const corps = String(message.data.body ?? '').trim();
        const nom = corps.length > 60 ? `${corps.slice(0, 60)}…` : corps;
        const sansTexte = n.type === 'quick_message' && String(n.data.body ?? '').trim() === '';
        const bloc = sansTexte ? 'un Message rapide sans texte' : `un bloc ${NOM_DU_BLOC[n.type] ?? n.type}`;
        return `la sortie « Puis, sans attendre » du message « ${nom} » mène à ${bloc}, qui attend. Seuls des blocs qui n’attendent rien peuvent la suivre : message sans bouton, action, condition, envoi de mail, appel API, fonction JS`;
      }
      if (n.type === 'condition') {
        const sorties = sortiesDeCondition(n);
        for (const h of sorties) {
          const cible = nextNodeByHandle(graph, id, h);
          if (cible) pile.push(cible);
        }
        const repli = nextNode(graph, id);
        if (repli && !graph.edges.some((e) => e.source === id && e.sourceHandle !== undefined && sorties.includes(e.sourceHandle))) pile.push(repli);
        continue;
      }
      const suivant = nextNode(graph, id);
      if (suivant) pile.push(suivant);
    }
  }
  return null;
}

/** Le bouton de lien d'un message rapide : un libellé, une adresse. */
export interface LienBouton { texte: string; url: string }

/**
 * Ce bouton de lien peut-il partir TEL QUEL ? Rend la raison du refus, ou `null` quand il est bon. Juge l'adresse
 * finale : celle d'un contact passe d'abord par `lienPourLeContact`, qui remplace ses variables.
 *
 * Un refus explicite, jamais un envoi sans le bouton que le client a coché. Une accolade restée dans l'adresse est
 * une variable que rien n'a remplacée (mal écrite, ou parcours RCS) : Meta refuserait le message entier. On ne
 * vérifie pas que l'adresse est publiquement joignable (`urlRecuperable`) : ces gardes protègent nos requêtes
 * sortantes, et ici c'est le contact qui ouvre la page, dans son navigateur.
 *
 * ⚠️ Volontairement PAS `isSendableButtonUrl` (espace, nom de site sans point) : la règle date de 2026-09-11, des
 * blocs publiés depuis peuvent porter une telle adresse, et personne n'a mesuré que Meta les refuse. Les durcir
 * couperait leurs envois au déploiement (relecture du 2026-11-06).
 */
export function problemeLienBouton(lien: LienBouton): string | null {
  if (lien.texte.trim() === '') return 'le bouton de lien du bloc « message rapide » n’a pas de libellé';
  const url = lien.url.trim();
  if (url === '') return 'le bouton de lien du bloc « message rapide » n’a pas d’adresse';
  if (url.includes('{{')) return 'l’adresse du bouton de lien porte une variable qui n’a pas été remplacée';
  let parsee: URL;
  try { parsee = new URL(url); } catch { return 'l’adresse du bouton de lien n’est pas une adresse valide'; }
  if (parsee.protocol !== 'http:' && parsee.protocol !== 'https:') {
    return 'l’adresse du bouton de lien doit commencer par http:// ou https://';
  }
  return null;
}

/** Une variable `{{champ}}` de la fiche : la grammaire de `renderText`, la même que le corps du message. */
const VARIABLE_DE_FICHE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * Le bouton de lien tel qu'il part chez CE contact : les variables `{{champ}}` de l'adresse prennent la valeur de
 * sa fiche (même grammaire et même table que le corps, `contactVars`), puis l'adresse obtenue passe par
 * `problemeLienBouton`. Rend le lien prêt à partir, ou la raison du refus. Né pour le lien d'un devis HubSpot
 * (`hs_calc_lien_devis`), un champ qui porte l'adresse ENTIÈRE.
 *
 * - Un champ qui OUVRE l'adresse y entre tel quel : c'est elle qu'il porte. Placé plus loin, sa valeur est ENCODÉE
 *   comme dans un lien de modèle (`encoder`, `src/links/champs-url.ts`) : « Martin & Fils » dans `?nom=` part en
 *   `Martin%20%26%20Fils` au lieu de couper la requête, et `../admin` ne remonte pas le chemin.
 * - L'adresse remplie passe ensuite par l'analyseur d'URL (une espace d'un champ d'ouverture devient `%20`). Une
 *   adresse SANS variable part octet pour octet comme saisie.
 * - 🔴 UNE VARIABLE SANS VALEUR FAIT REFUSER L'ENVOI, même au milieu de l'adresse : `https://site.fr/devis/{{id}}`
 *   vide donnerait `https://site.fr/devis/`, une adresse valide qui ouvre la mauvaise page sans que rien ne le dise.
 *   Même règle qu'un modèle dont une variable manque : un refus nommé, jamais un bouton faux. `.` et `..` seuls
 *   comptent pour vides, comme dans un lien de modèle.
 * - `vars` absent (aucune table câblée) : l'adresse garde ses accolades, et `problemeLienBouton` la refuse.
 *
 * WhatsApp seulement : en RCS, le lien passe par notre redirection de suivi, et un champ que le contact écrit
 * lui-même ferait de notre domaine un redirecteur ouvert (`envoyerQuickEnRcs`).
 */
export function lienPourLeContact(
  lien: LienBouton,
  vars: Record<string, string | null | undefined> | undefined,
): { lien: LienBouton } | { refus: string } {
  const saisie = lien.url.trim();
  if (vars === undefined || !saisie.includes('{{')) {
    const probleme = problemeLienBouton(lien);
    return probleme ? { refus: probleme } : { lien };
  }
  const vides: string[] = [];
  const remplie = saisie.replace(VARIABLE_DE_FICHE, (_jeton: string, nom: string, position: number) => {
    const brute = renderText(`{{${nom}}}`, vars, { html: false }).trim();
    const valeur = position === 0 ? brute : encoder(brute);
    if (valeur === '' && !vides.includes(nom)) vides.push(nom);
    return valeur;
  }).trim();
  if (vides.length > 0) {
    return { refus: `le bouton de lien n’est pas parti : ce contact n’a pas de valeur pour ${vides.map((n) => `{{${n}}}`).join(', ')}` };
  }
  let url = remplie;
  try { url = new URL(remplie).href; } catch { /* `problemeLienBouton` nomme l'adresse invalide */ }
  const probleme = problemeLienBouton({ ...lien, url });
  return probleme ? { refus: probleme } : { lien: { ...lien, url } };
}

/**
 * L'étape présente-t-elle un choix au client (un bouton ou une réponse rapide réellement libellé) ?
 *
 * C'est le prédicat du contrôle du fil : « le scénario attend-il une réponse ? » et « gardons-nous la main
 * face à l'agent de Meta ? » sont la même question. Une étape qui offre un choix garde la main (la réponse
 * doit nous revenir pour être appariée au bouton) ; une étape qui n'offre rien la relâche. Un formulaire
 * attend forcément une saisie : il offre donc un choix, sans bouton.
 */
export function etapeOffreUnChoix(a: WorkflowAction | null): boolean {
  if (a === null) return false;
  if (a.kind === 'sendFlow') return true;
  // Un bloc Question attend toujours, menu ou pas : sans menu, on attend la réponse libre du contact.
  // Dépendre de `rows` ferait enchaîner le bloc suivant sans jamais lire la réponse.
  if (a.kind === 'sendQuestion') return true;
  if (a.kind === 'sendTemplate' || a.kind === 'sendQuickMessage') return a.buttons.some((b) => b.text.trim() !== '');
  return false;
}

/**
 * La fenêtre de service WhatsApp : 24 h depuis le dernier message du contact. Au-delà, Meta refuse tout ce
 * qui n'est pas un template (131047). Partagée par l'analyse de montage et `waitEstimationMs`.
 */
export const FENETRE_SERVICE_MS = 24 * 3_600_000;

/** Un montage impossible : une attente qui ferme forcément la fenêtre, suivie d'un message de session. */
export interface WaitThenSession {
  /** Le dernier bloc Attente traversé sur ce chemin (celui qu'on montre à l'utilisateur). */
  waitNodeId: string;
  /** Le bloc message rapide / formulaire qui ne partira jamais. */
  messageNodeId: string;
}

/**
 * Cherche un chemin « attente cumulée >= 24 h, puis message rapide ou formulaire ». Ce montage ne peut
 * jamais marcher : après 24 h d'attente la fenêtre de service est fermée à coup sûr (131047). Le runtime le
 * bloque (`executor.resume` teste la fenêtre réelle au réveil) ; cette fonction sert à le dire dans le
 * builder. Sous 24 h on ne dit rien : le contact a pu écrire entre-temps, c'est au runtime de trancher.
 *
 * Termine sur les graphes cycliques : le cumul est plafonné à 24 h, et un bloc n'est ré-exploré qu'avec un
 * cumul strictement plus grand.
 */
export function waitBeforeSessionMessage(graph: WorkflowGraph): WaitThenSession | null {
  return explorerLesAttentes(graph).premierMontage;
}

/** Un « Aller à » vers un AUTRE scénario (ou vers rien), atteint après une attente qui ferme forcément la fenêtre. */
export interface SautApresAttente {
  /** Le dernier bloc Attente traversé avant lui. */
  waitNodeId: string;
  /** Le bloc « Aller à ». */
  sautNodeId: string;
  /** Le code qu'il vise (`''` = aucun). */
  cible: string;
}

/**
 * Les « Aller à » qui quittent ce graphe après 24 h d'attente cumulée ou plus (RC5). `waitBeforeSessionMessage` ne
 * peut pas dire ce qu'ils envoient : le message se trouve dans un autre scénario, que cette analyse pure ne lit pas.
 * C'est la publication qui va voir (`refusDePublication`, `src/workflow/aller-a.ts`). Un saut vers un bloc de CE
 * graphe, lui, est suivi par `waitBeforeSessionMessage` comme une flèche.
 */
export function sautsApresAttenteLongue(graph: WorkflowGraph): SautApresAttente[] {
  return explorerLesAttentes(graph).sautsLongs;
}

/**
 * Le parcours commun de `waitBeforeSessionMessage` et `sautsApresAttenteLongue` : une seule définition de « ce qui
 * suit une attente », sinon les deux analyses divergeraient sur un bloc ajouté demain. Il explore TOUT le graphe
 * (au lieu de s'arrêter au premier montage) pour relever aussi les sauts ; le premier montage relevé est le même
 * qu'avant, puisque l'ordre de la pile ne change pas.
 */
function explorerLesAttentes(graph: WorkflowGraph): { premierMontage: WaitThenSession | null; sautsLongs: SautApresAttente[] } {
  let premierMontage: WaitThenSession | null = null;
  const sautsLongs: SautApresAttente[] = [];
  const signaler = (m: WaitThenSession): void => { premierMontage ??= m; };
  // Chaque attente compte pour au moins un pas de balayage (60 s), la granularité réelle d'un réveil : sinon un
  // délai fractionnaire (`{delay: 0.001}`) dans un cycle demanderait des millions d'itérations.
  const PAS_MIN_MS = 60_000;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const entry = entryNode(graph);
  if (!entry) return { premierMontage, sautsLongs };
  const meilleur = new Map<string, number>();
  // pile de { bloc, attente cumulée jusqu'ici, dernier bloc Attente franchi }
  const pile: Array<{ id: string; cumul: number; dernierWait: string | null }> = [{ id: entry, cumul: 0, dernierWait: null }];
  while (pile.length > 0) {
    const { id, cumul, dernierWait } = pile.pop()!;
    const vu = meilleur.get(id);
    if (vu !== undefined && vu >= cumul) continue;
    meilleur.set(id, cumul);
    const node = byId.get(id);
    if (!node) continue;
    if (node.type === 'inbox' || node.type === 'vers_mba') continue;
    if (node.type === 'aller_a') {
      // Un saut vers un bloc de CE graphe se suit comme une flèche, attente cumulée comprise : « attente de deux jours,
      // Aller à la question du menu » est le même montage mort-né qu'une flèche vers elle. Ailleurs, il est relevé.
      const cible = cibleDuSaut(node);
      const ici = blocDuCode(graph, cible);
      if (ici) pile.push({ id: ici.id, cumul, dernierWait });
      else if (cumul >= FENETRE_SERVICE_MS && dernierWait) sautsLongs.push({ waitNodeId: dernierWait, sautNodeId: id, cible });
      continue;
    }
    if (node.type === 'question') {
      // Une question est un message de session : même signalement que pour un message rapide ou un formulaire.
      const a = actionOf(node);
      if (a && cumul >= FENETRE_SERVICE_MS && dernierWait) signaler({ waitNodeId: dernierWait, messageNodeId: id });
      // Configurée, elle bloque (elle attend une réponse) : l'analyse s'arrête là. Non configurée, elle est un
      // passe-plat : on explore au-delà.
      if (a) continue;
      const apres = nextNode(graph, id);
      if (apres) pile.push({ id: apres, cumul, dernierWait });
      continue;
    }
    if (node.type === 'agent') {
      // Le premier message de l'agent est un message de session : même signalement que pour un message rapide.
      const configure = String(node.data.agentId ?? '').trim() !== '';
      if (configure && cumul >= FENETRE_SERVICE_MS && dernierWait) signaler({ waitNodeId: dernierWait, messageNodeId: id });
      // Configuré, il bloque (il tient la conversation) : l'analyse s'arrête là. Non configuré, il est un
      // passe-plat, comme dans `walk` : on explore au-delà.
      if (configure) continue;
      const apres = nextNode(graph, id);
      if (apres) pile.push({ id: apres, cumul, dernierWait });
      continue;
    }
    if (node.type === 'flow' || node.type === 'quick_message') {
      const a = actionOf(node);
      if (a && (a.kind === 'sendFlow' || a.kind === 'sendQuickMessage') && cumul >= FENETRE_SERVICE_MS && dernierWait) {
        signaler({ waitNodeId: dernierWait, messageNodeId: id });
      }
      // Un message rapide sans bouton ne bloque pas le parcours (cf. `walk`) : on explore au-delà, sinon un
      // montage « attente, message sans bouton, attente, message rapide » ne serait jamais signalé. Un bloc
      // réellement bloquant arrête l'analyse.
      if (!quickMessageNonBloquant(a)) continue;
      const nx = nextNode(graph, id);
      if (nx) pile.push({ id: nx, cumul, dernierWait });
      continue;
    }
    // Un template remet le compteur à zéro. Il n'ouvre pas la fenêtre (seul un message du contact l'ouvre),
    // mais le parcours s'arrête au template jusqu'à la réponse, et c'est cette réponse qui rouvre la fenêtre.
    const suivant = node.type === 'template'
      ? { cumul: 0, dernierWait: null }
      : node.type === 'wait'
        ? { cumul: Math.min(cumul + Math.max(PAS_MIN_MS, waitEstimationMs(node)), FENETRE_SERVICE_MS), dernierWait: waitEstimationMs(node) > 0 ? id : dernierWait }
        : { cumul, dernierWait };
    if (node.type === 'condition') {
      // Toutes les sorties (familles puis « Sinon »), et la 1re arête seulement si aucune n'est reliée.
      const sorties = sortiesDeCondition(node);
      for (const h of sorties) {
        const cible = nextNodeByHandle(graph, id, h);
        if (cible) pile.push({ id: cible, ...suivant });
      }
      const repli = nextNode(graph, id);
      if (repli && !graph.edges.some((e) => e.source === id && e.sourceHandle !== undefined && sorties.includes(e.sourceHandle))) {
        pile.push({ id: repli, ...suivant });
      }
      continue;
    }
    const nx = nextNode(graph, id);
    if (nx) pile.push({ id: nx, ...suivant });
  }
  return { premierMontage, sautsLongs };
}

export type WalkRest =
  /**
   * En attente d'une réponse du contact (après un template, un formulaire, une question). `timeoutInMs` est
   * l'échéance « pas de réponse » d'un bloc Question. Absent = attente sans limite.
   */
  | { status: 'waiting'; nodeId: string; timeoutInMs?: number }
  | { status: 'sleeping'; nodeId: string; resumeInMs: number } // en attente du temps qui passe (bloc Attente)
  // Bloc RCS : pas un état de repos, une main rendue. Le walk est pur et ne sait pas si le numéro est
  // joignable : l'executor fait l'IO puis reprend par 'sent' ou 'unreachable'. Toujours résolu par
  // `walkResolved`, ce statut n'atteint jamais `restToState`.
  | { status: 'rcs_send'; nodeId: string }
  // Bloc agent : une main rendue aussi. L'executor persiste, ouvre la session et enfile un tour ; le parcours
  // reprendra par un handle de sortie. Contrairement à rcs_send, il atteint réellement `restToState`, qui a
  // donc un cas explicite pour ne pas clore le parcours en `done` au moment où l'agent prend la main.
  | { status: 'agent_turn'; nodeId: string }
  /**
   * Conversation remontée à l'humain (terminal). `assigneA` voyage avec le statut : l'exécuteur n'a pas le
   * nœud sous la main quand il escalade, et une seconde lecture du graphe pourrait diverger.
   */
  | { status: 'inbox'; assigneA?: string | null }
  /**
   * Bloc « Aller à » dont la cible n'est PAS dans ce graphe (un autre scénario, un bloc disparu, ou aucune : `''`).
   * Une main rendue, comme `agent_turn` : le walk est pur et ne lit qu'un graphe. L'exécuteur clôt le parcours et en
   * démarre un sur la cible (`WorkflowExecutor.sauter`). Une cible de ce graphe ne produit jamais ce repos : `walk`
   * la suit dans le même enchaînement.
   */
  | { status: 'aller_a'; nodeId: string; cible: string }
  /**
   * Bloc « Envoyer au MBA » (RC6) : terminal, comme `done`, mais l'exécuteur confie le contact à l'agent de Meta au lieu
   * de rendre la main au répondeur du mode (`WorkflowExecutorDeps.confierAuMbaParLeBloc`). Les actions accumulées
   * partent d'abord.
   */
  | { status: 'vers_mba'; nodeId: string }
  | { status: 'done' }; // fin de chaîne (plus d'arête sortante)

/** Unités proposées par le bloc Attente. `seconds` : la pause courte entre deux messages, réveillée à la seconde
 *  par le réveil court (`reveil-court.ts`) et non par le balayage, qui ne passe qu'une fois par minute. */
export const WAIT_UNITS = ['seconds', 'minutes', 'hours', 'days'] as const;
export type WaitUnit = (typeof WAIT_UNITS)[number];
const UNIT_MS: Record<WaitUnit, number> = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
/** Unités de l'échéance « pas de réponse » d'un bloc Question : sans les secondes, que l'écran ne propose pas et
 *  qu'une échéance à la seconde n'aurait aucun sens à tenir (le balayage des questions passe une fois par minute). */
export const QUESTION_UNITS = ['minutes', 'hours', 'days'] as const;
/** Plafond : 30 jours. Au-delà, un parcours dormant n'a plus de sens métier ; borner évite aussi une
 *  échéance absurde posée par une saisie erronée. */
export const WAIT_MAX_MS = 30 * 86_400_000;

/**
 * Les trois façons de dire quand un bloc Attente reprend. `delai` est le défaut : un scénario ancien n'a pas
 * ce champ et doit se comporter exactement comme avant.
 */
export const WAIT_MODES = ['delai', 'date', 'heures_ouvrees'] as const;
export type WaitMode = (typeof WAIT_MODES)[number];

/** Le mode d'un bloc Attente, lu défensivement (`data` est du JSON libre venu du client). Inconnu -> `delai`,
 *  jamais une erreur : un scénario enregistré par une version ultérieure ne doit pas devenir illisible. */
export function waitMode(node: WorkflowNode): WaitMode {
  const brut = String(node.data.waitMode ?? 'delai');
  return (WAIT_MODES as readonly string[]).includes(brut) ? (brut as WaitMode) : 'delai';
}

/** Une pause en secondes : le seul bloc Attente qui affiche « en train d'écrire… » (et marque le message lu). */
export function pauseEnSecondes(node: WorkflowNode): boolean {
  return node.type === 'wait' && waitMode(node) === 'delai' && String(node.data.unit ?? '') === 'seconds';
}

/**
 * Durée d'un bloc Attente en mode délai, en millisecondes. 0 = bloc non configuré (durée absente, nulle,
 * négative ou unité inconnue) : passe-plat, on ne bloque pas un parcours sur une saisie oubliée.
 *
 * Rend 0 pour les deux modes datés, dont l'échéance ne se calcule qu'à l'exécution (un `delay` resté dans
 * `data` annoncerait une durée que le bloc ne tiendra pas). Voir `waitResumeInMs` pour l'exécution et
 * `waitEstimationMs` pour l'analyse de graphe.
 */
export function waitDurationMs(node: WorkflowNode): number {
  if (waitMode(node) !== 'delai') return 0;
  const brut = Number(node.data.delay ?? node.data.value ?? 0);
  if (!Number.isFinite(brut) || brut <= 0) return 0;
  const unit = String(node.data.unit ?? 'hours') as WaitUnit;
  const ms = UNIT_MS[unit];
  if (!ms) return 0;
  return Math.min(Math.round(brut * ms), WAIT_MAX_MS);
}

/**
 * La durée qu'une analyse de graphe doit prêter à un bloc Attente, en millisecondes. Ce n'est pas
 * `waitDurationMs` : `waitBeforeSessionMessage` tourne à la publication, sans connaître l'instant
 * d'exécution. Une attente « jusqu'à une date » ou « jusqu'aux heures ouvrées » compte donc pour la fenêtre
 * entière, ce que le panneau du bloc annonce déjà au client. Rendre 0 laisserait publier « attendre jusqu'à
 * demain 9 h, puis message rapide », dont le message ne partira jamais.
 */
export function waitEstimationMs(node: WorkflowNode): number {
  return waitMode(node) === 'delai' ? waitDurationMs(node) : FENETRE_SERVICE_MS;
}

/**
 * L'instant visé par un bloc Attente en mode « date fixe ». Saisie vide ou illisible -> `null`.
 *
 * La date est saisie dans le bloc, pas prise dans un champ du contact (ce cas est couvert par l'automation
 * « un délai avant ou après une date enregistrée »). Elle est lue comme une heure murale dans le fuseau de
 * l'espace : « le 24 à 9 h » veut dire 9 h chez le client, pas 9 h UTC.
 */
function cibleDeDate(node: WorkflowNode, ctx: EvalContext): Date | null {
  const brut = String(node.data.waitDate ?? '').trim();
  if (brut === '') return null;
  const d = parseInstant(brut, ctx.timeZone);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Dans combien de temps un bloc Attente doit reprendre, en millisecondes. C'est ce que l'exécution lit.
 *
 * 0 = passe-plat, la doctrine de ce moteur pour tout bloc qu'on ne peut pas exécuter : un parcours figé n'a
 * ni signal ni recours, un parcours qui continue se voit.
 *
 * Les deux modes datés exigent `ctx` (instant, fuseau, horaires) : c'est `buildCtx` qui doit savoir le
 * construire pour eux, sinon « attendre les heures ouvrées » deviendrait un passe-plat et enverrait à 1 h du
 * matin. Tenu par un test.
 *
 * L'échéance est calculée une fois, ici, et le réveil repart au bloc suivant : si le balayage prend du retard
 * (worker arrêté), un « jusqu'aux heures ouvrées » repart à l'heure du réveil et non à l'ouverture.
 */
export function waitResumeInMs(node: WorkflowNode, ctx?: EvalContext): number {
  const mode = waitMode(node);
  if (mode === 'delai') return waitDurationMs(node);
  if (!ctx) return 0;
  const cible = mode === 'date'
    ? cibleDeDate(node, ctx)
    : prochaineOuverture(ctx.now, ctx.timeZone, ctx.businessHours);
  // `null` = rien à viser : une date illisible, ou une semaine entièrement fermée (`prochaineOuverture` rend
  // `null` plutôt qu'une date lointaine). Ici, passe-plat.
  if (cible === null) return 0;
  // Une échéance déjà passée (une date d'hier, ou déjà dans les heures ouvertes) : rien à attendre.
  return Math.min(Math.max(0, cible.getTime() - ctx.now.getTime()), WAIT_MAX_MS);
}

/** Nombre maximal de lignes d'un menu. Plafond WhatsApp : « up to 10 rows for all sections combined ». */
export const QUESTION_MAX_ROWS = 10;
/** Plafonds de caractères d'une liste interactive WhatsApp (référence Cloud API). */
export const QUESTION_LIMITES = { body: 4096, bouton: 20, titre: 24, description: 72 } as const;

/**
 * Échéance « pas de réponse » d'un bloc Question, en millisecondes. 0 = aucune échéance : le parcours attend
 * indéfiniment. Mêmes unités et même plafond que le bloc Attente : c'est la même notion de délai pour
 * l'utilisateur.
 */
export function questionTimeoutMs(node: WorkflowNode): number {
  const brut = Number(node.data.timeoutValue ?? 0);
  if (!Number.isFinite(brut) || brut <= 0) return 0;
  const unit = String(node.data.timeoutUnit ?? 'hours');
  if (!(QUESTION_UNITS as readonly string[]).includes(unit)) return 0;
  const ms = UNIT_MS[unit as WaitUnit];
  return Math.min(Math.round(brut * ms), WAIT_MAX_MS);
}

/**
 * Les lignes du menu d'un bloc Question, lues défensivement depuis `node.data.rows` (JSON libre). Rend le
 * tableau entier, lignes vides comprises (l'index est la sortie, voir `sendQuestion`). Une forme inattendue
 * donne une ligne vide plutôt qu'un crash.
 */
export function questionRows(node: WorkflowNode): QuestionRow[] {
  const brut = node.data.rows;
  if (!Array.isArray(brut)) return [];
  return brut.slice(0, QUESTION_MAX_ROWS).map((r) => {
    const o = (r ?? {}) as { title?: unknown; description?: unknown };
    const title = String(o.title ?? '').trim().slice(0, QUESTION_LIMITES.titre);
    const description = String(o.description ?? '').trim().slice(0, QUESTION_LIMITES.description);
    return description === '' ? { title } : { title, description };
  });
}

/**
 * Une action et le bloc qui l'a produite. Le bloc d'origine est porté ici plutôt que dans un tableau
 * parallèle (« même longueur, même ordre » finit par se casser en silence) : c'est ce lien qui rend un
 * scénario mesurable bloc par bloc (Analytics > Mes tableaux).
 */
export interface WalkStep {
  nodeId: string;
  action: WorkflowAction;
}

export interface WalkResult {
  actions: WalkStep[];
  rest: WalkRest;
}

/** Bloc d'entrée d'un workflow = un bloc sans arête entrante (racine). Défaut : le 1er bloc. null si vide. */
export function entryNode(graph: WorkflowGraph): string | null {
  return entreeDuGraphe(graph)?.id ?? null;
}

/** Le bloc suivant (cible de la 1re arête sortante). null s'il n'y en a pas. */
export function nextNode(graph: WorkflowGraph, nodeId: string): string | null {
  return graph.edges.find((e) => e.source === nodeId)?.target ?? null;
}

/** Le bloc suivant pour un handle de sortie donné (branche par bouton : sourceHandle = `btn:<index>`).
 *  null si aucune arête ne part de ce handle. */
export function nextNodeByHandle(graph: WorkflowGraph, nodeId: string, handle: string): string | null {
  return graph.edges.find((e) => e.source === nodeId && e.sourceHandle === handle)?.target ?? null;
}

/** Le bloc suivant par une arête libre (qui ne part d'aucun handle) : la chaîne linéaire, ou la sortie
 *  « toute autre réponse ». null si toutes les arêtes sortantes partent d'un bouton.
 *
 *  Sert à router une réponse qui ne correspond à aucun bouton. `nextNode` prendrait la 1re arête venue,
 *  donc la branche du 1er bouton : un contact qui écrit « non merci » à un bloc Oui/Non se ferait taguer
 *  « oui ». Sans arête libre, s'arrêter vaut mieux qu'inventer une branche. */
export function nextNodeSansHandle(graph: WorkflowGraph, nodeId: string): string | null {
  return graph.edges.find((e) => e.source === nodeId && !e.sourceHandle)?.target ?? null;
}

/** Destinataire valide : littéral non vide, ou champ non vide à résoudre à l'envoi (executor). Toute autre
 *  forme (kind absent/inconnu, valeur/champ vide) -> null, comme un bloc non configuré. */
function emailRecipientOf(raw: unknown): EmailRecipient | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'literal' && typeof r.value === 'string' && r.value.trim() !== '') return { kind: 'literal', value: r.value };
  if (r.kind === 'field' && typeof r.field === 'string' && r.field.trim() !== '') return { kind: 'field', field: r.field };
  return null;
}

/**
 * `emailRecipientsOf` : les destinataires d'un bloc email, lus depuis `data.to` opaque. Accepte les deux
 * formes : un objet unique (scénarios anciens, jamais renormalisés puisque `parseGraph` laisse `data`
 * opaque) ou une liste. Ne lire que la liste ferait de ces blocs des no-op silencieux. Les entrées invalides
 * sont écartées une à une (une 3e adresse vide n'empêche pas les deux premières). Liste vide -> null.
 */
/**
 * La valeur qu'un bloc « poser un champ » écrit. Un seul endroit pour le bloc `field` et l'action
 * `set_field`, deux façons de décrire le même geste, qui doivent poser la même valeur.
 *
 * `now` : ISO 8601 avec le décalage du fuseau de l'espace (`formatMaintenant`), pour qu'un système qui
 * affiche la valeur telle quelle montre l'heure locale ; l'instant reste le même pour les conditions.
 * `derniere_saisie` : le dernier message écrit par le contact ; absent du contexte -> vide, jamais inventé.
 * Sans contexte (analyse de graphe pure), tout ce qui est dynamique vaut vide.
 */
function valeurDuChamp(data: Record<string, unknown>, ctx?: EvalContext): string {
  const kind = String(data.valueKind ?? '');
  if (kind === 'now') return ctx ? formatMaintenant(ctx.now, ctx.timeZone) : '';
  if (kind === 'derniere_saisie') return ctx ? (ctx.derniereSaisie ?? '') : '';
  return String(data.value ?? '');
}

function emailRecipientsOf(raw: unknown): EmailRecipient[] | null {
  const bruts = Array.isArray(raw) ? raw : [raw];
  const out: EmailRecipient[] = [];
  for (const b of bruts) {
    const r = emailRecipientOf(b);
    if (r) out.push(r);
    if (out.length === MAX_DESTINATAIRES_EMAIL) break;
  }
  return out.length > 0 ? out : null;
}

/**
 * Adresses réellement joignables d'un bloc email, résolues contre les variables du contact. Pure.
 *
 * Chaque destinataire est résolu indépendamment : une adresse en mode variable lit `contacts.fields`, libre,
 * et une 3e ligne vide ne doit pas priver les deux premières de leur mail. Les doublons sont écartés (deux
 * exemplaires à la même personne). L'ordre est conservé : l'appelant met la première en « À » et les
 * suivantes en copie cachée.
 */
export function adressesDestinataires(to: EmailRecipient[], vars: Record<string, string | null>): string[] {
  return [...new Set(
    to
      .map((r) => (r.kind === 'literal' ? r.value : (vars[r.field] ?? '')))
      .map((a) => a.trim())
      .filter((a) => a !== ''),
  )];
}

/**
 * Ce que produit UNE action d'un bloc « Action » (`sousActions`). Unifiée : add_tag/set_field produisent les mêmes
 * actions que les blocs legacy tag/field. Retirer des étiquettes ou vider des champs en donne une par élément de la
 * liste. Action incomplète (étiquette ou champ vide) -> aucune (no-op), comme un bloc non configuré.
 */
function actionsDeLaSousAction(sa: SousAction, ctx?: EvalContext): WorkflowAction[] {
  const kind = String(sa.actionKind ?? '');
  if (kind === 'add_tag') {
    const tag = String(sa.tag ?? '').trim();
    return tag ? [{ kind: 'tag', tag }] : [];
  }
  if (kind === 'remove_tag') return etiquettesARetirer(sa).map((tag) => ({ kind: 'removeTag', tag }));
  if (kind === 'set_field') {
    const key = String(sa.fieldKey ?? sa.key ?? '').trim();
    return key ? [{ kind: 'field', key, value: valeurDuChamp(sa, ctx) }] : [];
  }
  if (kind === 'clear_field') return champsAVider(sa).map(({ key }) => ({ kind: 'clearField', key }));
  // Consentement : rien à saisir, donc jamais incomplet. Seul chemin qui pose un opt-out automatiquement
  // (l'upsert d'import ne fait jamais régresser un statut), typiquement derrière un mot-clé « STOP ».
  if (kind === 'set_optin') return [{ kind: 'optIn', value: 'opted_in' }];
  if (kind === 'set_optout') return [{ kind: 'optIn', value: 'opted_out' }];
  return [];
}

/** Exportée pour le test unitaire du node email (`actionOf` en isolation). */
export function actionOf(node: WorkflowNode, ctx?: EvalContext): WorkflowAction | null {
  if (node.type === 'question') {
    // Le corps fait foi pour « configuré » : sans question écrite, rien à envoyer ni à attendre. Le menu est
    // facultatif (une question sans menu attend une réponse libre).
    const body = String(node.data.body ?? '').trim();
    if (body === '') return null;
    const buttonLabel = String(node.data.buttonLabel ?? '').trim().slice(0, QUESTION_LIMITES.bouton);
    return {
      kind: 'sendQuestion',
      body: body.slice(0, QUESTION_LIMITES.body),
      // Meta exige un libellé de bouton dès qu'il y a une liste : repli sur « Choisir » plutôt qu'un échec.
      buttonLabel: buttonLabel === '' ? 'Choisir' : buttonLabel,
      rows: questionRows(node),
    };
  }
  if (node.type === 'tag') {
    const tag = String(node.data.tag ?? '').trim();
    return tag ? { kind: 'tag', tag } : null;
  }
  if (node.type === 'field') {
    const key = String(node.data.fieldKey ?? node.data.key ?? '').trim();
    if (!key) return null;
    return { kind: 'field', key, value: valeurDuChamp(node.data, ctx) };
  }
  if (node.type === 'http') {
    // Aucun appel choisi -> `null`, un no-op qui laisse le parcours continuer : un bloc à moitié réglé ne doit
    // pas casser un scénario en production. Le champ cible, lui, est facultatif : sans lui, l'appel POUSSE
    // (Brevo répond 204 à un événement, il n'y a rien à ranger).
    const requestId = String(node.data.requestId ?? '').trim();
    const champCible = String(node.data.champCible ?? '').trim();
    return requestId !== '' ? { kind: 'appelHttp', requestId, champCible } : null;
  }
  if (node.type === 'js') {
    /**
     * La source vit dans `data.js`, pas dans `data.code` : `data.code` porte le code public du bloc
     * (`nod_<client>_<ULID>`), que `mintNodeCodes` refait à chaque enregistrement dès que la valeur ne
     * ressemble pas à un code valide, ce qui écrasait le JavaScript. Le repli sur `data.code` récupère les
     * graphes pas encore réécrits, sans risque : un code minté est reconnaissable.
     */
    const brutJs = typeof node.data.js === 'string' ? node.data.js : '';
    const ancien = String(node.data.code ?? '');
    const code = brutJs !== '' ? brutJs : (/^nod_[a-z0-9]+_[0-9A-HJKMNP-TV-Z]{26}$/.test(ancien) ? '' : ancien);
    const champSource = String(node.data.champSource ?? '').trim();
    const champCible = String(node.data.champCible ?? '').trim();
    // Bloc à moitié réglé -> no-op. Le code vide compte comme non réglé : l'exécuter écrirait une valeur vide,
    // qui ressemblerait à un échec de la fonction.
    return code.trim() !== '' && champSource !== '' && champCible !== ''
      ? { kind: 'fonctionJs', code, champSource, champCible }
      : null;
  }
  if (node.type === 'action') {
    // Le bloc peut porter plusieurs actions (`sousActions`) : `walk` les joue toutes, une à une. Ici, la première
    // qui produit quelque chose, pour les lecteurs qui ne demandent que « ce bloc fait-il quelque chose ? ».
    for (const sa of sousActions(node.data)) {
      const [premiere] = actionsDeLaSousAction(sa, ctx);
      if (premiere) return premiere;
    }
    return null;
  }
  if (node.type === 'template') {
    const templateName = String(node.data.templateName ?? '').trim();
    if (!templateName) return null;
    const raw = Array.isArray(node.data.templateButtons) ? node.data.templateButtons : [];
    const buttons: WorkflowButton[] = raw.map((b) => ({
      type: String((b as { type?: unknown }).type ?? ''),
      text: String((b as { text?: unknown }).text ?? ''),
    }));
    // Les choix du bloc (`variables`), jugés un par un : un choix malformé est ignoré, sa position garde la source
    // du template, et il n'emporte pas les autres.
    const brut: unknown[] = Array.isArray(node.data.variables) ? node.data.variables : [];
    const sources = brut.flatMap((v) => parseParamHints([v]) ?? []);
    return {
      kind: 'sendTemplate', templateName, language: String(node.data.language ?? 'fr'), buttons,
      ...(sources.length > 0 ? { sources } : {}),
    };
  }
  if (node.type === 'flow') {
    // Node « formulaire » : envoie le flow en message interactif (hors template). Sans flowId -> null, comme un
    // template sans templateName. `body` = accroche, `cta` = libellé du bouton d'ouverture.
    const flowId = String(node.data.flowId ?? '').trim();
    if (!flowId) return null;
    const flowName = String(node.data.flowName ?? '').trim();
    const body = String(node.data.body ?? '').trim() || (flowName ? `Formulaire : ${flowName}` : 'Formulaire à remplir');
    const cta = String(node.data.cta ?? '').trim().slice(0, 30) || 'Envoyer';
    return { kind: 'sendFlow', flowId, flowName, body, cta };
  }
  if (node.type === 'quick_message') {
    const body = String(node.data.body ?? '').trim();
    // Les réponses rapides gardent leur ordre (index = handle btn:<i>) : pas de filtre ici, la couche d'envoi
    // filtre les vides en préservant l'index.
    const raw = Array.isArray(node.data.quickReplies) ? node.data.quickReplies : [];
    const buttons: WorkflowButton[] = raw.map((q) => ({ type: 'QUICK_REPLY', text: String(q ?? '') }));
    // Un bloc sans aucune réponse rapide envoie quand même son texte (message simple, ou `cta_url` s'il porte
    // un bouton de lien). Sans corps -> null.
    if (!body) return null;
    // Visuel facultatif. Même champ que le bloc RCS (`imageUrl`) : le même visuel sert aux deux canaux
    // (en-tête WhatsApp, carte RCS).
    const mediaUrl = String(node.data.imageUrl ?? '').trim();
    // Bouton de lien. L'écran vide déjà `quickReplies` quand on coche la case, on revide ici quand même : un
    // graphe ancien ou posé par l'API peut porter les deux.
    //
    // Le lien est transporté tel que saisi, même incomplet : c'est le câblage qui refuse, avec la raison
    // (`problemeLienBouton`), au lieu d'envoyer un message nu alors que le client a demandé un bouton.
    const lien: LienBouton | null = node.data.lienActif === true
      ? { texte: String(node.data.lienTexte ?? '').trim(), url: String(node.data.lienUrl ?? '').trim() }
      : null;
    return {
      kind: 'sendQuickMessage',
      body,
      buttons: lien ? [] : buttons,
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(lien ? { lien } : {}),
    };
  }
  if (node.type === 'email') {
    // Lecture défensive : `data` est opaque (parseGraph ne le valide pas). Compte, modèle ou destinataire
    // manquant/invalide -> null.
    const emailAccountId = String(node.data.emailAccountId ?? '').trim();
    const templateId = String(node.data.templateId ?? '').trim();
    const to = emailRecipientsOf(node.data.to);
    if (!emailAccountId || !templateId || !to) return null;
    return { kind: 'sendEmail', emailAccountId, templateId, to };
  }
  return null;
}

/**
 * `walk` : parcourt le graphe depuis `startNodeId`, accumule les actions des blocs synchrones, s'arrête au 1er
 * bloc bloquant ou en fin de chaîne (done). Anti-cycle : un bloc déjà visité arrête le parcours (done). Un
 * `startNodeId` inconnu -> done sans action.
 */
/** Répercute une action synchrone (tag/field, ajout ou retrait) sur la copie de travail du contexte, pour
 *  qu'une condition plus loin dans le même walk la voie (l'écriture en base n'a lieu qu'après, via
 *  executor.apply). Même normalisation d'étiquette que la pose (`normaliserEtiquette`, dédup). `clearField`
 *  retire la clé, comme le SQL `fields - key`. */
function applyToWork(work: EvalContext, a: WorkflowAction): void {
  if (a.kind === 'tag') {
    const t = normaliserEtiquette(a.tag);
    if (t !== '' && !work.tags.includes(t)) work.tags.push(t);
  } else if (a.kind === 'removeTag') {
    const t = normaliserEtiquette(a.tag);
    work.tags = work.tags.filter((x) => x !== t);
  } else if (a.kind === 'field') {
    work.fields[a.key] = a.value;
  } else if (a.kind === 'clearField') {
    delete work.fields[a.key];
  }
}

export interface WalkOptions {
  /**
   * L'agent de Meta est-il le RÉPONDEUR de ce tenant (mode `mba`, RC6 ; allumé en veille, non) ? Avec lui, une étape
   * qui n'offre aucun choix cesse de bloquer le parcours : l'agent reprend la parole et les actions du scénario
   * continuent. Sans lui, un template attend la réponse, comme toujours.
   */
  mbaActif?: boolean;
  /**
   * La suite « Puis, sans attendre » d'un message rapide à boutons : le parcours s'arrête AVANT le premier bloc qui
   * attendrait (`passeSansAttente`), sans l'envoyer, et son repos est alors `done`. Posée par `walk` lui-même, jamais
   * par un appelant : le curseur reste sur le message, c'est lui qui attend la réponse.
   */
  sansAttente?: boolean;
  /**
   * 🔴 S'ARRÊTER APRÈS UN APPEL QUI RANGE UN CHAMP (2026-11-11, plan `2026-11-11-appel-api-puis-condition.md`). Un Appel API
   * ou une Fonction JS ne peut pas se répercuter sur la copie de travail : sa valeur n'existe qu'une fois l'appel parti,
   * APRÈS la marche. Sans arrêt, une Condition qui le suit lit la valeur d'avant. Avec l'option, la marche s'endort sur ce
   * bloc (`REPRISE_APRES_APPEL_MS`) ; l'exécuteur fait l'appel, et le réveil court reprend au bloc suivant sur un contexte
   * relu. Posée par `walkResolved` seul : les autres appelants ne savent pas reprendre un parcours endormi.
   */
  attendreLesAppels?: boolean;
}

/** Le sommeil d'un parcours arrêté après un appel : le plus court possible, le réveil court le reprend aussitôt. */
export const REPRISE_APRES_APPEL_MS = 1;

/**
 * 🔴 La suite d'un appel revient-elle sur lui SANS traverser un bloc qui attend ? Alors s'y endormir ferait une boucle sans
 * fin : chaque reprise est une marche neuve (la garde `visited` repart à zéro) et l'appel repartirait toutes les
 * millisecondes chez le client. Dans ce cas la marche ne s'arrête pas (comportement d'avant : un passage, puis la garde
 * `visited`). Bloquent : une Attente au DÉLAI positif (une Attente vide, datée ou aux heures ouvrées peut passer sans
 * attendre), Question, Modèle, Formulaire, message à boutons, Agent configuré, Inbox, RCS, Envoyer au
 * MBA, un saut hors du graphe. Un « Aller à » interne se suit, comme `walk` le suit.
 */
export function revientSansAttente(graph: WorkflowGraph, depart: string, cible: string): boolean {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const vus = new Set<string>();
  const pile = [depart];
  while (pile.length > 0) {
    const id = pile.pop()!;
    if (id === cible) return true;
    if (vus.has(id)) continue;
    vus.add(id);
    const node = byId.get(id);
    if (!node) continue;
    if (
      (node.type === 'wait' && waitDurationMs(node) > 0) || node.type === 'question' || node.type === 'template' || node.type === 'flow'
      || node.type === 'inbox' || node.type === 'rcs_message' || node.type === 'vers_mba'
      || (node.type === 'agent' && String(node.data.agentId ?? '').trim() !== '')
      || (node.type === 'quick_message' && etapeOffreUnChoix(actionOf(node)))
    ) continue;
    if (node.type === 'aller_a') {
      const ici = blocDuCode(graph, cibleDuSaut(node));
      if (ici) pile.push(ici.id);
      continue;
    }
    for (const e of graph.edges) if (e.source === id) pile.push(e.target);
  }
  return false;
}

export function walk(graph: WorkflowGraph, startNodeId: string, ctx?: EvalContext, opts?: WalkOptions): WalkResult {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const actions: WalkStep[] = [];
  const visited = new Set<string>();
  // Copie de travail mutable du contexte : une action tag/field décidée dans ce walk (appliquée en base
  // seulement après) doit être visible par une condition plus loin dans la même chaîne synchrone.
  const work: EvalContext | undefined = ctx ? { ...ctx, tags: [...ctx.tags], fields: { ...ctx.fields } } : undefined;
  let current: string | null = startNodeId;

  while (current) {
    if (visited.has(current)) return { actions, rest: { status: 'done' } };
    visited.add(current);
    const node = byId.get(current);
    if (!node) return { actions, rest: { status: 'done' } };
    // La publication refuse ce montage (`refusSuiteQuiAttend`) ; ceci tient le moteur sur un graphe qui y aurait échappé.
    if (opts?.sansAttente === true && !passeSansAttente(node, work)) return { actions, rest: { status: 'done' } };

    if (node.type === 'inbox') {
      const a = typeof node.data.assigneA === 'string' ? node.data.assigneA.trim() : '';
      return { actions, rest: { status: 'inbox', assigneA: a === '' ? null : a } };
    }
    // « Envoyer au MBA » (RC6) : terminal, l'exécuteur fait l'IO (la liste de l'agent de Meta, `release`, l'événement).
    if (node.type === 'vers_mba') return { actions, rest: { status: 'vers_mba', nodeId: current } };
    if (node.type === 'condition') {
      // Bloc synchrone sans action : évalue ses familles dans l'ordre (copie de travail) et suit la PREMIÈRE vraie,
      // sinon « Sinon » (`false`). Un bloc d'avant les familles en a une seule, de poignée `true` (« Si réunie »).
      // Sans contexte (analyse de graphe pure) -> « Sinon », déterministe.
      const here: string = current;
      const sorties = sortiesDeCondition(node);
      const choisie = work ? sortieDeCondition(node.data, work) : SORTIE_SINON;
      // Sorties typées : si la branche choisie n'est pas câblée alors qu'une sortie typée existe -> cul-de-sac
      // (done), jamais l'arête d'une autre branche. Repli sur la 1re arête seulement pour un node sans sortie typée.
      const hasTypedEdge = graph.edges.some((e) => e.source === here && e.sourceHandle !== undefined && sorties.includes(e.sourceHandle));
      current = nextNodeByHandle(graph, here, choisie) ?? (hasTypedEdge ? null : nextNode(graph, here));
      continue;
    }
    if (node.type === 'rcs_message') {
      // Le walk est pur : il ne sait pas si le numéro est joignable en RCS. Il rend la main à l'executor, qui
      // fera l'IO et reprendra par 'sent' ou 'unreachable'. Les actions accumulées partent maintenant.
      return { actions, rest: { status: 'rcs_send', nodeId: current } };
    }
    if (node.type === 'aller_a') {
      // « Aller à » (RC5). Une cible de CE graphe : le parcours continue sur elle, dans le même enchaînement. Un retour
      // sur un bloc déjà visité est arrêté par la garde ci-dessus (`visited`), et c'est la bonne réponse à une boucle
      // sans pause. Ailleurs : la main est rendue à l'exécuteur, avec les actions accumulées.
      const cible = cibleDuSaut(node);
      const ici = blocDuCode(graph, cible);
      if (ici) {
        current = ici.id;
        continue;
      }
      return { actions, rest: { status: 'aller_a', nodeId: current, cible } };
    }
    if (node.type === 'agent') {
      // Le walk est pur : il rend la main à l'executor, qui ouvrira la session et enfilera un tour. Les actions
      // accumulées partent maintenant. Non configuré = passe-plat : rendre la main à un agent qui n'existe pas
      // figerait le parcours pour toujours, sans signal.
      const agentId = String(node.data.agentId ?? '').trim();
      if (!agentId) {
        // Le passe-plat suit une arête libre, jamais une sortie typée : les sorties d'un bloc agent
        // (`sortie:<code>`, `timeout`) sont des issues précises, et `nextNode` enverrait typiquement tous les
        // contacts sur la branche « échec technique ». Aucune arête libre -> le parcours s'arrête ici.
        current = nextNodeSansHandle(graph, current);
        continue;
      }
      return { actions, rest: { status: 'agent_turn', nodeId: current } };
    }
    if (node.type === 'question') {
      const a = actionOf(node, work);
      if (!a) {
        // Question sans texte : attendre une réponse à une question jamais posée figerait le parcours. Passe-plat,
        // comme un bloc Attente sans durée (alors que `quick_message` non configuré bloque, par historique).
        current = nextNode(graph, current);
        continue;
      }
      actions.push({ nodeId: current, action: a });
      // Il attend toujours, menu ou pas. L'échéance voyage avec le repos : l'executor la traduit en `resume_at`.
      const ms = questionTimeoutMs(node);
      return { actions, rest: { status: 'waiting', nodeId: current, ...(ms > 0 ? { timeoutInMs: ms } : {}) } };
    }
    if (node.type === 'template' || node.type === 'flow' || node.type === 'quick_message') {
      const a = actionOf(node, work);
      if (a) actions.push({ nodeId: current, action: a });
      // Sans MBA : seul un message rapide sans bouton continue. Avec MBA : toute étape qui n'offre pas de choix
      // continue, l'agent de Meta répondant à sa place.
      const continuer = !etapeOffreUnChoix(a) && (opts?.mbaActif === true || a?.kind === 'sendQuickMessage');
      if (continuer) {
        // Un formulaire traversé n'a rien envoyé, donc rien n'a pu être rempli : « Toute autre réponse » (l'arête
        // libre), jamais la 1re arête venue, qui peut être « Formulaire rempli ».
        current = node.type === 'flow' ? nextNodeSansHandle(graph, current) : nextNode(graph, current);
        continue;
      }
      // « Puis, sans attendre » (2026-11-10) : la suite d'un message rapide à boutons part avec lui, ses actions à la
      // suite des siennes, et le parcours attend sur LE MESSAGE, dont les boutons restent la seule réponse attendue.
      // La suite voit la copie de travail telle que les blocs d'avant l'ont laissée.
      // Un message sans texte n'est pas parti : sa suite non plus (`refusSuiteQuiAttend` ne la regarde pas davantage).
      const ensuite = node.type === 'quick_message' && etapeOffreUnChoix(a) ? nextNodeByHandle(graph, current, SORTIE_ENSUITE) : null;
      if (ensuite) actions.push(...walk(graph, ensuite, work, { ...opts, sansAttente: true }).actions);
      return { actions, rest: { status: 'waiting', nodeId: current } };
    }
    if (node.type === 'wait') {
      // Bloc Attente : met le parcours en sommeil jusqu'à l'échéance. Les actions accumulées partent maintenant ;
      // le sweeper repart du successeur. `waitResumeInMs`, jamais `waitDurationMs` : c'est ici que les modes datés
      // calculent leur échéance.
      const ms = waitResumeInMs(node, work);
      if (ms > 0) return { actions, rest: { status: 'sleeping', nodeId: current, resumeInMs: ms } };
      current = nextNode(graph, current); // rien à attendre (durée non configurée, échéance passée) -> passe-plat
      continue;
    }
    if (node.type === 'action') {
      // Ses actions dans l'ordre, chacune répercutée sur la copie de travail AVANT la suivante : une valeur
      // « dernier message » ou une condition plus loin voit le bloc comme une suite de blocs d'une action chacun.
      for (const sa of sousActions(node.data)) {
        for (const a of actionsDeLaSousAction(sa, work)) {
          actions.push({ nodeId: current, action: a });
          if (work) applyToWork(work, a);
        }
      }
      current = nextNode(graph, current);
      continue;
    }
    // tag / field / email : bloc synchrone -> action + on continue, effet répercuté dans la copie de travail
    // (applyToWork ignore email et optIn).
    const a = actionOf(node, work);
    if (a) {
      actions.push({ nodeId: current, action: a });
      if (work) applyToWork(work, a);
    }
    const suivant = nextNode(graph, current);
    // Un appel qui range un champ, avec une suite : s'endormir ici pour que la suite lise la valeur rangée (`attendreLesAppels`).
    // Jamais dans une suite « sans attendre », dont le repos est ignoré : s'y arrêter perdrait le reste en silence.
    if (
      opts?.attendreLesAppels === true && opts.sansAttente !== true && suivant !== null && a
      && (a.kind === 'appelHttp' || a.kind === 'fonctionJs') && a.champCible !== ''
      && !revientSansAttente(graph, suivant, current)
    ) {
      return { actions, rest: { status: 'sleeping', nodeId: current, resumeInMs: REPRISE_APRES_APPEL_MS } };
    }
    current = suivant;
  }
  return { actions, rest: { status: 'done' } };
}
