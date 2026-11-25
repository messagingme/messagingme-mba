import type { EvalContext } from './conditions';
import type { WorkflowGraph, WorkflowNode } from './graph';
import {
  applyToWork, delaiSansReponseMs, entryNode, FENETRE_SERVICE_MS, nextNode, nextNodeByHandle, nextNodeSansHandle, questionRows, walk,
  type WorkflowAction,
} from './engine';
import { reglagesQuestion } from './question-piece';
import { SORTIE_TIMEOUT } from '../../web/lib/partage/sorties-agent';

/**
 * SIMULER UN PARCOURS (lot 1 du CSM virtuel, B6, plan `docs/superpowers/plans/2026-11-25-csm-lot1-f-simulation-deroule.md`).
 *
 * Joue un graphe pour un contact FICTIF dont l'appelant écrit les réponses, et rend ce qui se passerait : les effets
 * prévus, chaque attente, la sortie prise par chaque réponse, l'état final.
 *
 * 🔴 PUR : la fonction ne reçoit aucune dépendance, donc elle ne PEUT ni envoyer, ni appeler un connecteur, ni écrire
 * sur un contact. La marche est celle de la production (`walk`) ; l'aiguillage d'une réponse reprend celui de
 * `WorkflowExecutor.advance` (un choix suit sa sortie, sinon la sortie libre ; une réponse écrite suit la sortie libre ;
 * un choix sans suite passe à l'équipe ; un texte sans suite rend la main au répondeur) et la reprise à l'échéance
 * (`reprendre` : la sortie `timeout`, sinon le répondeur). La parité de `tests/workflow-simulation.test.ts` joue
 * l'exécuteur réel sur les mêmes réponses et exige les mêmes effets : c'est elle qui tient l'égalité, pas cette phrase.
 */

/** Une réponse du contact fictif : un choix (bouton, réponse rapide, ligne de menu) par son texte, un texte écrit, ou rien. */
export type ReponseSimulee = { choix: string } | { texte: string } | { sans_reponse: true };

/** Un effet que le parcours produirait. Ce qui sort de l'espace (e-mail, appel API) est nommé, jamais joué. */
export type EffetSimule =
  | { envoi: 'template'; nom: string; langue: string; boutons: string[] }
  | { envoi: 'message'; texte: string; reponses: string[]; fichier?: string }
  | { envoi: 'question'; texte: string; lignes: string[] }
  | { envoi: 'formulaire'; nom: string }
  | { etiquette: string }
  | { etiquette_retiree: string }
  | { champ: string; valeur: string }
  | { champ_vide: string }
  | { non_joue: string };

/** Ce que le parcours attend après ses effets : une réponse (et son échéance), ou le temps d'un bloc Attente. */
export type AttenteSimulee =
  | { reponse: { bloc: string; type: string; choix: string[]; echeance_minutes: number | null } }
  | { sommeil_minutes: number };

export interface EtapeSimulee {
  /** La réponse fictive qui a fait repartir le parcours, la sortie qu'elle a prise, et ce que la Question en a rangé. */
  reponse?: { recue: ReponseSimulee; sortie: string; champ_range?: { champ: string; valeur: string } };
  effets: EffetSimule[];
  attente: AttenteSimulee | null;
}

export type FinSimulee =
  /** Plus rien à jouer : au message suivant, le répondeur de l'espace reprend. */
  | { etat: 'termine' }
  /** La conversation passe à l'équipe (À traiter) ; `raison` quand ce n'est pas le scénario qui l'y envoie. */
  | { etat: 'equipe'; raison?: string }
  | { etat: 'agent_ia' }
  | { etat: 'agent_de_meta' }
  /** Un « Aller à » vers un autre scénario : la simulation s'arrête au seuil. */
  | { etat: 'autre_scenario'; code: string }
  /** Une réponse que rien ne suit (une réponse écrite sans sortie libre, ou « pas de réponse » sans sa sortie) : le
   *  répondeur de l'espace reprend la main, comme en production. */
  | { etat: 'repondeur' }
  /** Les réponses fictives sont épuisées : le parcours attendrait le contact. */
  | { etat: 'attend_une_reponse' }
  /** Une réponse fictive que ce bloc ne peut pas recevoir : la simulation le dit au lieu d'inventer une branche. */
  | { etat: 'reponse_impossible'; raison: string }
  | { etat: 'non_simule'; raison: string };

export interface Simulation {
  etapes: EtapeSimulee[];
  fin: FinSimulee;
  /** Les réponses fictives que le parcours n'a pas lues (il s'est terminé avant). */
  reponses_non_utilisees: number;
}

export interface ContactFictif {
  champs?: Record<string, string>;
  etiquettes?: string[];
}

/** Au-delà, un parcours qui boucle (un « Aller à » vers un bloc déjà passé) est arrêté et dit. */
const MARCHES_MAX = 60;
/**
 * 🔴 LE BUDGET DE LA SORTIE, en caractères (effets et réponses de toutes les étapes) : au-delà, la simulation s'arrête et
 * le dit. Un parcours du pilote en produit quelques milliers ; un brouillon de blocs « Extraire du JSON » qui recopient
 * de longues valeurs, ou qui boucle, en produirait des centaines de millions et figerait la copie de l'API qui le joue
 * (relecture du lot F). Les entrées sont bornées comme une vraie fiche (`src/mcp/outils-scenarios.ts`).
 */
export const SORTIE_MAX = 100_000;

/** Les envois qui exigent la fenêtre (comme `besoinsFenetre` de `reprendre`, sur WhatsApp) ; un template, non. */
const exigeLaFenetre = (a: WorkflowAction): boolean => a.kind === 'sendQuickMessage' || a.kind === 'sendQuestion' || a.kind === 'sendFlow';

const norme = (s: string): string => s.trim().toLocaleLowerCase('fr');

/** Une durée en minutes, au dixième : une pause de quelques secondes ne s'affiche pas « 0 minute ». */
const enMinutes = (ms: number): number => (ms > 0 ? Math.max(0.1, Math.round(ms / 6_000) / 10) : 0);

type Choix = { texte: string; complet?: string; sortie: string };

/**
 * Les réponses rapides d'un message telles que Meta les montre (`sendInteractive`, `src/meta/client.ts`) : les titres
 * vides retirés en gardant l'index d'origine (`btn:<i>`), trois au plus, coupés à 20 caractères. `complet` garde le
 * texte entier, qu'un appelant peut aussi donner.
 */
function reponsesRapides(textes: readonly string[]): Choix[] {
  return textes.map((t, i) => ({ texte: t.trim().slice(0, 20), complet: t.trim(), sortie: `btn:${i}` })).filter((c) => c.texte !== '').slice(0, 3);
}

/** Les choix qu'un bloc en attente propose, et la sortie que chacun prend (la même que le clic de Meta renvoie). */
function choixDu(n: WorkflowNode): Choix[] {
  if (n.type === 'question') return questionRows(n).map((r, i) => ({ texte: r.title, sortie: `row:${i}` })).filter((c) => c.texte !== '');
  if (n.type === 'template') {
    const boutons = Array.isArray(n.data.templateButtons) ? (n.data.templateButtons as Array<{ type?: unknown; text?: unknown }>) : [];
    return boutons.map((b, i) => ({ texte: String(b.text ?? ''), sortie: `btn:${i}`, rapide: b.type === 'QUICK_REPLY' }))
      .filter((c) => c.rapide && c.texte !== '').map(({ texte, sortie }) => ({ texte, sortie }));
  }
  if (n.type === 'quick_message') {
    return reponsesRapides(Array.isArray(n.data.quickReplies) ? (n.data.quickReplies as unknown[]).map((q) => String(q ?? '')) : []);
  }
  return [];
}

/** Le nom d'un envoi de session, pour dire qu'il a été retenu. */
function libelleDe(a: WorkflowAction): string {
  if (a.kind === 'sendQuestion') return `la question « ${a.body} »`;
  if (a.kind === 'sendQuickMessage') return `le message « ${a.body} »`;
  if (a.kind === 'sendFlow') return `le formulaire « ${a.flowName} »`;
  return `une action « ${a.kind} »`;
}

function effetDe(a: WorkflowAction): EffetSimule {
  switch (a.kind) {
    case 'sendTemplate': return { envoi: 'template', nom: a.templateName, langue: a.language, boutons: a.buttons.map((b) => b.text) };
    case 'sendQuickMessage':
      return { envoi: 'message', texte: a.body, reponses: reponsesRapides(a.buttons.map((b) => b.text)).map((c) => c.texte), ...(a.mediaUrl ? { fichier: a.mediaUrl } : {}) };
    case 'sendQuestion': return { envoi: 'question', texte: a.body, lignes: a.rows.map((r) => r.title) };
    case 'sendFlow': return { envoi: 'formulaire', nom: a.flowName };
    case 'tag': return { etiquette: a.tag };
    case 'removeTag': return { etiquette_retiree: a.tag };
    case 'field': return { champ: a.key, valeur: a.value };
    case 'clearField': return { champ_vide: a.key };
    case 'appelHttp': return { non_joue: `appel API (réponse rangée dans « ${a.champCible || 'aucun champ'} »)` };
    case 'fonctionJs': return { non_joue: `fonction JS (de « ${a.champSource} » vers « ${a.champCible} »)` };
    case 'optIn': return { non_joue: `consentement : ${a.value}` };
    default: return { non_joue: `une action « ${(a as { kind: string }).kind} »` };
  }
}

/**
 * Joue `graphe` depuis son entrée pour un contact fictif, en consommant `reponses` dans l'ordre à chaque attente.
 * `maintenant` et `fuseau` servent aux Conditions de date ; les heures ouvrées sont vides (une Condition sur elles
 * prend sa branche « fermé », la simulation ne connaît pas celles de l'espace) et le contact n'a jamais été analysé.
 * Le contact vient d'écrire au départ, et chaque réponse fictive rouvre la fenêtre de 24 h ; une Attente ou une
 * échéance la fait courir : à la reprise, si elle est close, les messages de session sont retenus et la conversation
 * passe à l'équipe, comme `reprendre` le fait. Une Attente ou une échéance fait aussi avancer l'horloge : une
 * Condition de date ou un champ « maintenant » placés après lisent l'heure de la reprise.
 */
export function simulerParcours(
  graphe: WorkflowGraph, reponses: readonly ReponseSimulee[], contact: ContactFictif = {},
  maintenant: Date = new Date(), fuseau = 'Europe/Paris',
): Simulation {
  const ctx: EvalContext = {
    fields: { ...(contact.champs ?? {}) }, tags: [...(contact.etiquettes ?? [])], optIn: 'opted_in', name: null, phone: null,
    bsuid: null, now: maintenant, timeZone: fuseau, businessHours: {}, derniereSaisie: null, analyse: null,
  };
  const parId = new Map(graphe.nodes.map((n) => [n.id, n]));
  const etapes: EtapeSimulee[] = [];
  let lues = 0;
  const finir = (fin: FinSimulee): Simulation => ({ etapes, fin, reponses_non_utilisees: reponses.length - lues });

  let courant = entryNode(graphe);
  if (courant === null) return finir({ etat: 'non_simule', raison: 'le scénario est vide' });
  let entree: EtapeSimulee['reponse'] | undefined;
  /** Le temps écoulé depuis le dernier message du contact, et si la marche qui vient est une reprise (Attente, échéance). */
  let ecoule = 0;
  let reprise = false;
  /** Le temps simulé depuis le départ (Attentes, échéances), et la taille de la sortie déjà produite. */
  let horloge = 0;
  let poids = 0;
  for (let marche = 0; marche < MARCHES_MAX; marche += 1) {
    ctx.now = new Date(maintenant.getTime() + horloge);
    const r = walk(graphe, courant, ctx);
    const horsFenetre = reprise && ecoule >= FENETRE_SERVICE_MS
      && (r.actions.some((s) => exigeLaFenetre(s.action)) || r.rest.status === 'agent_turn');
    const effets: EffetSimule[] = [];
    for (const s of r.actions) {
      if (horsFenetre && exigeLaFenetre(s.action)) {
        effets.push({ non_joue: `${libelleDe(s.action)} hors de la fenêtre de 24 h : non envoyé` });
        continue;
      }
      applyToWork(ctx, s.action);
      // Une extraction se joue comme le moteur la joue sur sa copie de travail : depuis la valeur du champ source sur la
      // fiche fictive (une réponse d'appel API n'existe pas ici), chaque ligne rangeant sa valeur, vide comprise.
      if (s.action.kind === 'extraireJson') effets.push(...s.action.lignes.map((l) => ({ champ: l.champCible, valeur: String(ctx.fields[l.champCible] ?? '') })));
      else effets.push(effetDe(s.action));
    }
    // Le budget, avant d'ajouter l'étape : la sortie rendue ne le dépasse jamais, quelle que soit la forme du graphe.
    poids += JSON.stringify(effets).length + (entree ? JSON.stringify(entree).length : 0);
    if (poids > SORTIE_MAX) {
      return finir({ etat: 'non_simule', raison: `la sortie dépasse ${SORTIE_MAX} caractères : le parcours produit trop (une boucle, ou de très longues valeurs)` });
    }
    const etape: EtapeSimulee = { ...(entree ? { reponse: entree } : {}), effets, attente: null };
    etapes.push(etape);
    entree = undefined;
    reprise = false;
    // Fenêtre close à la reprise : ce qui pouvait partir est parti, le parcours est clos et passe à l'équipe.
    if (horsFenetre) return finir({ etat: 'equipe', raison: 'la fenêtre de 24 h était close à la reprise' });
    const rest = r.rest;
    if (rest.status === 'done') return finir({ etat: 'termine' });
    if (rest.status === 'inbox') return finir({ etat: 'equipe' });
    if (rest.status === 'agent_turn') return finir({ etat: 'agent_ia' });
    if (rest.status === 'vers_mba') return finir({ etat: 'agent_de_meta' });
    if (rest.status === 'aller_a') return finir({ etat: 'autre_scenario', code: rest.cible });
    if (rest.status === 'rcs_send') return finir({ etat: 'non_simule', raison: 'un message RCS : sa suite dépend de la joignabilité du numéro' });
    if (rest.status === 'sleeping') {
      etape.attente = { sommeil_minutes: enMinutes(rest.resumeInMs) };
      // Au réveil, l'exécuteur repart du bloc d'après l'Attente (`reprendre`, hors échéance).
      const suite = nextNode(graphe, rest.nodeId);
      if (suite === null) return finir({ etat: 'termine' });
      ecoule += rest.resumeInMs;
      horloge += rest.resumeInMs;
      reprise = true;
      courant = suite;
      continue;
    }
    // En attente d'une réponse sur `rest.nodeId`.
    const bloc = parId.get(rest.nodeId);
    if (!bloc) return finir({ etat: 'non_simule', raison: 'un bloc absent du graphe' });
    // Un bloc qui attend sans avoir rien envoyé (un message sans texte, un template sans nom : un brouillon en cours) :
    // le contact n'a vu aucun choix, seule une réponse écrite peut arriver.
    const envoye = r.actions.some((s) => s.nodeId === rest.nodeId);
    const choix = envoye ? choixDu(bloc) : [];
    etape.attente = {
      reponse: {
        bloc: typeof bloc.data.code === 'string' && bloc.data.code !== '' ? bloc.data.code : bloc.id, type: bloc.type,
        choix: choix.map((c) => c.texte), echeance_minutes: rest.timeoutInMs ? enMinutes(rest.timeoutInMs) : null,
      },
    };
    const reponse = reponses[lues];
    if (reponse === undefined) return finir({ etat: 'attend_une_reponse' });
    lues += 1;
    if (!envoye && 'choix' in reponse) {
      return finir({ etat: 'reponse_impossible', raison: 'ce bloc n’a rien envoyé (son texte ou son modèle manque) : aucun choix n’a été proposé au contact' });
    }
    const a = aiguiller(graphe, bloc, choix, reponse, ctx);
    const recue = { recue: reponse, sortie: a.sortie, ...(a.champ_range ? { champ_range: a.champ_range } : {}) };
    if ('fin' in a) {
      // La réponse a été lue (et rangée) même quand rien ne la suit : l'étape la montre. Une réponse impossible, non.
      if (a.fin.etat !== 'reponse_impossible') etapes.push({ reponse: recue, effets: [], attente: null });
      return finir(a.fin);
    }
    entree = recue;
    courant = a.suite;
    // Une réponse du contact rouvre la fenêtre ; une échéance la fait courir de son délai.
    if ('sans_reponse' in reponse) {
      ecoule += rest.timeoutInMs ?? 0;
      horloge += rest.timeoutInMs ?? 0;
      reprise = true;
    } else {
      ecoule = 0;
    }
  }
  return finir({ etat: 'non_simule', raison: `plus de ${MARCHES_MAX} reprises : le parcours boucle` });
}

type Aiguillage =
  | { suite: string; sortie: string; champ_range?: { champ: string; valeur: string } }
  | { fin: FinSimulee; sortie: string; champ_range?: { champ: string; valeur: string } };

/**
 * La sortie que prend une réponse sur un bloc qui l'attend, comme l'exécuteur la prend. La réponse rangée par une
 * Question l'est AVANT l'aiguillage (`rangerLaReponse`), donc une Condition qui suit la voit.
 */
function aiguiller(graphe: WorkflowGraph, bloc: WorkflowNode, choix: Choix[], reponse: ReponseSimulee, ctx: EvalContext): Aiguillage {
  if ('sans_reponse' in reponse) {
    if (delaiSansReponseMs(bloc) <= 0) {
      return { fin: { etat: 'reponse_impossible', raison: 'ce bloc attend sans échéance : « pas de réponse » n’arrive jamais' }, sortie: SORTIE_TIMEOUT };
    }
    const suite = nextNodeByHandle(graphe, bloc.id, SORTIE_TIMEOUT);
    return suite ? { suite, sortie: SORTIE_TIMEOUT } : { fin: { etat: 'repondeur' }, sortie: SORTIE_TIMEOUT };
  }
  const question = bloc.type === 'question' ? reglagesQuestion(bloc) : null;
  if ('choix' in reponse) {
    const c = choix.find((x) => norme(x.texte) === norme(reponse.choix) || (x.complet !== undefined && norme(x.complet) === norme(reponse.choix)));
    if (!c) {
      const raison = choix.length === 0
        ? 'ce bloc ne propose aucun choix : la réponse se donne par écrit ({ "texte": … })'
        : `« ${reponse.choix} » n’est pas un choix de ce bloc (${choix.map((x) => `« ${x.texte} »`).join(', ')})`;
      return { fin: { etat: 'reponse_impossible', raison }, sortie: '' };
    }
    const range = question?.champ && question.rangerLigne && c.sortie.startsWith('row:') ? { champ: question.champ, valeur: c.texte } : undefined;
    if (range) ctx.fields[range.champ] = range.valeur;
    const suite = nextNodeByHandle(graphe, bloc.id, c.sortie) ?? nextNodeSansHandle(graphe, bloc.id);
    // Un choix proposé qui ne mène nulle part est un trou de montage : l'exécuteur passe la conversation à l'équipe.
    return suite ? { suite, sortie: c.sortie, ...(range ? { champ_range: range } : {}) } : { fin: { etat: 'equipe' }, sortie: c.sortie, ...(range ? { champ_range: range } : {}) };
  }
  const texte = reponse.texte;
  ctx.derniereSaisie = texte;
  const range = question?.champ && texte.trim() !== '' ? { champ: question.champ, valeur: texte } : undefined;
  if (range) ctx.fields[range.champ] = range.valeur;
  const suite = nextNodeSansHandle(graphe, bloc.id);
  // Une réponse écrite que le scénario n'a pas prévue : l'exécuteur clôt le parcours et rend la main au répondeur.
  return suite ? { suite, sortie: 'libre', ...(range ? { champ_range: range } : {}) } : { fin: { etat: 'repondeur' }, sortie: 'libre', ...(range ? { champ_range: range } : {}) };
}
