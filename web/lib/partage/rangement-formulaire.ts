/**
 * LE RANGEMENT D'UN BLOC FORMULAIRE : quel champ de la fiche reçoit chaque élément que le formulaire renvoie, pour CE
 * scénario (Julien, 2026-11-10). Module pur, partagé par le panneau du bloc et par le moteur.
 *
 * 🔴 POURQUOI SUR LE BLOC ET PAS SUR LE FORMULAIRE. Un formulaire créé en JSON dans le Business Manager n'a aucun
 * rangement (ni `_ref`, ni `mapping`) : ses réponses n'allaient nulle part. Et un formulaire de Messaging Me range déjà,
 * mais le même formulaire peut servir deux scénarios qui veulent deux champs différents.
 *
 * 🔴 UN ÉLÉMENT RANGÉ PAR LE BLOC NE L'EST PLUS PAR LE FORMULAIRE, pour cette réponse-là. Le job du webhook écrit
 * d'abord ce que le bloc en attente range (`rangerParLesParcours`, `src/webhooks/rangement-par-le-parcours.ts`), avant
 * l'avance qui quitte le bloc, puis `processFlowCompletions` saute ces clés. Un élément ne s'écrit donc jamais à deux
 * endroits. Les éléments que le bloc ne cite pas gardent le rangement du formulaire.
 *
 * 🔴 LE BLOC NE RANGE QUE LA RÉPONSE AU FORMULAIRE QU'IL A ENVOYÉ (relecture du 2026-11-10). Les clés des formulaires
 * de Messaging Me sont des mots courants (`email`, `nom`) : un autre formulaire rempli pendant l'attente (celui d'une
 * campagne, d'un ancien message) aurait été rangé selon ce bloc. Le formulaire envoyé par le bloc porte son identifiant
 * dans son `flow_token` (`jetonDeFormulaire`), que Meta renvoie dans la réponse ; sans lui, ou avec un autre, le bloc ne
 * range rien et le réglage du formulaire s'applique seul.
 *
 * Forme : `data.rangement = { <clé de l'élément>: <clé du champ> }`. Une clé de champ VIDE veut dire « ne pas
 * enregistrer » pour ce scénario, ce qui retire aussi l'élément au rangement du formulaire.
 */

/** Plafond du nombre d'éléments rangés par un bloc : `data` est du JSON libre, un graphe fabriqué à la main n'a pas de
 *  borne. Un formulaire de Messaging Me en a au plus quelques dizaines. */
export const MAX_ELEMENTS_RANGES = 100;

/** Les clés que la réponse d'un formulaire porte sans qu'elles soient des réponses : jamais rangées. */
export const CLES_TECHNIQUES_FORMULAIRE: readonly string[] = ['_ref', 'flow_token'];

/**
 * Une clé d'élément ou de champ acceptable : celles que produisent un flow_json et `slugify`, sans espace ni point.
 * 200 caractères : `slugify` ne borne pas, et le libellé d'une case de consentement est souvent une phrase entière. Une
 * borne plus courte faisait revenir le choix du panneau tout seul, sans rien dire (relecture du 2026-11-10).
 */
const CLE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,199}$/;

/** Le `flow_token` d'un formulaire envoyé par un bloc : il nomme le formulaire, et Meta le renvoie avec la réponse.
 *  Jamais vide (Meta refuse un jeton vide, 131009). */
export function jetonDeFormulaire(waId: string, flowId: string, maintenant: number): string {
  return `${waId}-${maintenant}~${flowId}`;
}

/** Le formulaire que nomme un `flow_token` reçu, ou `null` (jeton d'avant le 2026-11-10, d'un bouton de modèle...). */
export function formulaireDuJeton(jeton: unknown): string | null {
  if (typeof jeton !== 'string') return null;
  const i = jeton.lastIndexOf('~');
  const id = i < 0 ? '' : jeton.slice(i + 1);
  return id === '' ? null : id;
}

export type RangementFormulaire = Record<string, string>;

/**
 * Le rangement d'un bloc, lu DÉFENSIVEMENT : `data` vient d'un graphe enregistré, peut-être par une version antérieure
 * ou à la main. Une entrée illisible est écartée, jamais devinée ; une absence rend `{}` (le bloc ne range rien, comme
 * avant le 2026-11-10).
 */
export function rangementDuBloc(data: Record<string, unknown>): RangementFormulaire {
  const brut = data.rangement;
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return {};
  const out: RangementFormulaire = {};
  for (const [cle, champ] of Object.entries(brut as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_ELEMENTS_RANGES) break;
    if (!CLE.test(cle) || CLES_TECHNIQUES_FORMULAIRE.includes(cle)) continue;
    if (typeof champ !== 'string') continue;
    const c = champ.trim();
    if (c !== '' && !CLE.test(c)) continue;
    out[cle] = c;
  }
  return out;
}

/**
 * La valeur d'un élément, telle qu'elle s'écrit dans un champ : un texte. `null` = rien à écrire (élément absent,
 * vide, ou d'une forme qu'aucun champ ne sait porter). Une case à cocher multiple rend ses choix séparés par des
 * virgules ; une case Oui/Non, `true` ou `false`, comme partout ailleurs sur la fiche.
 * ⚠️ Le réglage du formulaire (`processFlowCompletions`) écrit, lui, la valeur BRUTE : une case multiple y reste un
 * tableau. Les deux chemins ne rangent jamais le même élément d'une même réponse, mais un même élément peut donc
 * arriver sous deux formes selon le scénario qui l'a envoyé.
 */
export function valeurEnTexte(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (Array.isArray(v)) {
    const parts = v.map((x) => valeurEnTexte(x)).filter((x): x is string => x !== null);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  return null;
}
