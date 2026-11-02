import { typeNu } from '../inbox/media-entrant';
import { GENRES_PAR_DEFAUT, GENRES_PIECE, SORTIE_FICHIER, type GenrePiece } from '../../web/lib/partage/question-piece';
import type { WorkflowGraph, WorkflowNode } from './graph';

/**
 * LA PIÈCE REÇUE PAR UN BLOC QUESTION (spec `docs/superpowers/specs/2026-11-02-question-fichier-champ-design.md`) :
 * le classement d'un fichier, la mention rangée dans le champ, les réglages du bloc et le refus de publier. Pur.
 */

/** Les catégories de WhatsApp qui portent un fichier. Un sticker n'en est pas une : ce n'est jamais une pièce. */
const CATEGORIES_FICHIER: ReadonlySet<string> = new Set(['image', 'document', 'video', 'audio']);

/**
 * Le genre d'un fichier reçu, par son type RÉEL (décision de Julien) : une photo envoyée « en fichier » arrive dans la
 * catégorie `document` et reste une photo. `null` = aucune case : pas un fichier, un sticker, ou un type illisible.
 */
export function classerPiece(typeMeta: string, mime: string | null): GenrePiece | null {
  if (!CATEGORIES_FICHIER.has(typeMeta)) return null;
  const t = typeNu(mime);
  if (t === null) return null;
  if (t.startsWith('image/')) return 'photo';
  if (t === 'application/pdf') return 'pdf';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'vocal';
  return typeMeta === 'document' ? 'document' : null;
}

const LIBELLE_GENRE: Readonly<Record<GenrePiece, string>> = {
  photo: 'photo', pdf: 'PDF', document: 'document', video: 'vidéo', vocal: 'vocal',
};

/** Jour et heure d'un instant dans un fuseau ; un fuseau illisible retombe sur UTC plutôt que de lever. */
function partiesDate(instant: Date, fuseau: string): Record<string, string> {
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  };
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: fuseau });
  } catch {
    format = new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'UTC' });
  }
  return Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]));
}

/** Le début de toute mention : l'Appel API ne lit les pièces notées que si un champ commence ainsi. */
const DEBUT_MENTION = 'Pièce reçue le ';

/**
 * Ce que le champ reçoit pour une pièce acceptée : un texte lisible, qui ne contient AUCUN moyen d'accéder au fichier.
 * Le lien ne se fabrique qu'à l'appel, et seulement si le champ porte encore exactement cette mention.
 */
export function mentionDePiece(recuLe: Date, fuseau: string, genre: GenrePiece): string {
  const p = partiesDate(recuLe, fuseau);
  return `${DEBUT_MENTION}${p.day}/${p.month}/${p.year} à ${p.hour} h ${p.minute} (${LIBELLE_GENRE[genre]})`;
}

/** Cette valeur de champ a-t-elle la forme d'une mention ? Un tri préalable, jamais une preuve : la note en est une. */
export function ressembleAUneMention(valeur: unknown): boolean {
  return typeof valeur === 'string' && valeur.startsWith(DEBUT_MENTION);
}

export interface ReglagesQuestion {
  /** La clé du champ personnalisé qui range la réponse, ou `null` : le bloc ne range rien, comme avant ce lot. */
  champ: string | null;
  /** Le titre d'une ligne choisie dans le menu est rangé seulement si cette case est cochée. */
  rangerLigne: boolean;
  /** Les genres acceptés par la sortie « Fichier reçu », ou `null` quand le bloc n'attend pas de fichier. */
  genres: GenrePiece[] | null;
}

/**
 * Les réglages nouveaux d'un bloc Question, lus défensivement dans `node.data` (JSON libre) : une valeur d'une autre
 * forme vaut « non réglé ». Une attente cochée sans genre lisible attend photo et PDF.
 */
export function reglagesQuestion(node: WorkflowNode): ReglagesQuestion {
  const d = node.data;
  const champ = typeof d.champReponse === 'string' && d.champReponse.trim() !== '' ? d.champReponse.trim() : null;
  let genres: GenrePiece[] | null = null;
  if (d.attendreFichier === true) {
    const lus = Array.isArray(d.genresFichier)
      ? GENRES_PIECE.filter((g) => (d.genresFichier as unknown[]).includes(g))
      : [];
    genres = lus.length > 0 ? lus : [...GENRES_PAR_DEFAUT];
  }
  return { champ, rangerLigne: d.rangerLigne === true, genres };
}

/**
 * La raison de refuser la publication, ou `null`. Un bloc Question qui attend un fichier sans arête « Fichier reçu »
 * ne peut pas être publié (décision de Julien) : la pièce n'aurait aucune suite, et la retomber sur « Toute autre
 * réponse » l'enverrait sur la branche prévue pour le texte. Une Question sans texte est un passe-plat, elle n'attend
 * rien.
 */
export function refusFichierSansSuite(graph: WorkflowGraph): string | null {
  for (const n of graph.nodes) {
    if (n.type !== 'question') continue;
    const corps = String(n.data.body ?? '').trim();
    if (corps === '' || reglagesQuestion(n).genres === null) continue;
    if (graph.edges.some((e) => e.source === n.id && e.sourceHandle === SORTIE_FICHIER)) continue;
    const nom = corps.length > 60 ? `${corps.slice(0, 60)}…` : corps;
    return `le bloc Question « ${nom} » attend un fichier, mais sa sortie « Fichier reçu » n’est reliée à aucun bloc`;
  }
  return null;
}
