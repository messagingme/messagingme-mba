import type { Issue, StatutRefus } from '../lib/issue';
import { MESSAGE_OPERATIONS_LOURDES } from '../auth/plafond-partage';

/**
 * CE QU'UN OUTIL MCP LIT DE SES ARGUMENTS, ET COMMENT IL REFUSE.
 *
 * Sorti de `src/mcp/outils.ts` quand les outils de l'agent IA ont pris leur fichier (`src/mcp/outils-agent.ts`, lot
 * 8a) : les deux catalogues s'en servent, et le catalogue de l'agent ne peut pas importer `outils.ts`, qui l'importe
 * (une boucle d'imports laisse une constante non initialisée au chargement). Aucune logique métier ici.
 */

/**
 * LA CAUSE D'UN REFUS D'OUTIL, DANS UN VOCABULAIRE FERMÉ (lot 1 du CSM virtuel, B0a, plan
 * `docs/superpowers/plans/2026-11-24-csm-lot1-b0-contrats.md`). Un agent qui pilote par outils choisit quoi faire selon
 * la cause, pas selon une phrase : corriger ses arguments (`invalid_args`), lister avant de désigner (`not_found`), relire
 * l'état (`conflict`), proposer l'offre (`plan_required`, `plan_limit`), recharger (`credit_required`), passer par une
 * personne connectée (`forbidden`), attendre (`rate_limited`, `quota_exceeded`, `unavailable`), passer par un modèle
 * (`window_closed`), renoncer pour ce contact (`opted_out`), changer de forme (`too_large`, `unsupported`).
 * 🔴 La liste est FERMÉE : une famille de plus se décide ici et se documente, jamais à un site de refus.
 */
export const CODES_REFUS = [
  'invalid_args', 'not_found', 'conflict', 'plan_required', 'plan_limit', 'credit_required', 'forbidden', 'rate_limited',
  'quota_exceeded', 'window_closed', 'opted_out', 'too_large', 'unsupported', 'unavailable',
] as const;
export type CodeRefus = (typeof CODES_REFUS)[number];

/** Ce qu'un refus peut dire de plus que sa phrase : le délai avant de réessayer, le geste à proposer, la cause fine. */
export interface PrecisionsRefus {
  /** Les secondes à attendre avant de réessayer, quand le refus est passager. */
  readonly reessayerDansS?: number;
  /** Le geste à proposer au client, le plus souvent une adresse (la page de l'offre). */
  readonly action?: string;
  /** La cause précise, dans le vocabulaire de l'API publique (`src/api/erreurs.ts`), quand la fonction partagée la donne. */
  readonly cause?: string;
}

/**
 * Refus métier d'un outil (fenêtre fermée, conversation inconnue), par opposition à une panne. MCP le veut dans le
 * résultat avec `isError: true` : le modèle lit la raison et change de stratégie au lieu de croire l'outil cassé.
 * 🔴 Le code est OBLIGATOIRE : le type force chaque site à dire sa cause, et un refus ajouté demain ne part pas sans.
 */
export class RefusOutil extends Error {
  constructor(message: string, readonly code: CodeRefus, readonly precisions: PrecisionsRefus = {}) {
    super(message);
    this.name = 'RefusOutil';
  }
}

/** La famille d'un refus venu d'une fonction partagée : sa cause fine d'abord, quand elle la dit, sinon son statut HTTP. */
const FAMILLE_DE_LA_CAUSE: Readonly<Record<string, CodeRefus>> = {
  plan_feature_unavailable: 'plan_required',
  plan_limit_reached: 'plan_limit',
  quota_exceeded: 'quota_exceeded',
  rate_limited: 'rate_limited',
  opted_out: 'opted_out',
  contact_desabonne: 'opted_out',
  window_closed: 'window_closed',
};
const FAMILLE_DU_STATUT: Readonly<Record<StatutRefus | 429, CodeRefus>> = {
  400: 'invalid_args', 402: 'plan_required', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 413: 'too_large',
  415: 'unsupported', 422: 'invalid_args', 429: 'rate_limited', 503: 'unavailable',
};

export function familleDuRefus(statut: number, cause?: string): CodeRefus {
  const parCause = cause === undefined ? undefined : FAMILLE_DE_LA_CAUSE[cause];
  if (parCause !== undefined) return parCause;
  if (Object.hasOwn(FAMILLE_DU_STATUT, statut)) return FAMILLE_DU_STATUT[statut as StatutRefus | 429];
  return statut >= 500 ? 'unavailable' : 'invalid_args';
}

/**
 * Un refus d'une fonction partagée avec l'API publique (`{ statut, code, message, reessayerDansS }`, celui d'un modèle,
 * d'un envoi, de Meta) devient un refus d'outil, avec sa phrase, sa famille, sa cause et son délai.
 */
export function refusDuCoeur(r: { readonly statut: number; readonly code?: string; readonly message: string; readonly reessayerDansS?: number }): RefusOutil {
  return new RefusOutil(r.message, familleDuRefus(r.statut, r.code), {
    ...(r.code === undefined ? {} : { cause: r.code }),
    ...(r.reessayerDansS === undefined ? {} : { reessayerDansS: r.reessayerDansS }),
  });
}

/** Le refus du plafond des opérations lourdes, avec son délai : la phrase de la console, et le chiffre pour l'agent. */
export function refusDuPlafond(attenteMs: number): RefusOutil {
  const s = Math.max(1, Math.ceil(attenteMs / 1000));
  return new RefusOutil(`${MESSAGE_OPERATIONS_LOURDES} (réessayer dans ${s} s)`, 'rate_limited', { reessayerDansS: s });
}

/**
 * Lit une chaîne obligatoire. Les entrées viennent d'un modèle : on ne suppose rien de leur forme. Le plafond est
 * toujours écrit à l'appel, jamais par défaut : `tests/mcp-serveur.test.ts` le lit là et exige que le schéma de
 * l'outil l'annonce (`minLength: 1`, `maxLength: maxi`).
 */
export function texteObligatoire(args: Record<string, unknown>, cle: string, maxi: number): string {
  const v = args[cle];
  if (typeof v !== 'string' || v.trim() === '') throw new RefusOutil(`paramètre « ${cle} » requis (texte non vide)`, 'invalid_args');
  if (v.length > maxi) throw new RefusOutil(`paramètre « ${cle} » trop long (${maxi} caractères au plus)`, 'invalid_args');
  return v.trim();
}

/**
 * Lit un entier borné. Absent : défaut. Hors bornes : ramené dedans, jamais refusé. Le schéma de l'outil annonce
 * `minimum: mini` et `maximum: maxi` (même test que `texteObligatoire`).
 */
export function entierBorne(args: Record<string, unknown>, cle: string, defaut: number, mini: number, maxi: number): number {
  const v = args[cle];
  if (v === undefined || v === null) return defaut;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return defaut;
  return Math.min(Math.max(Math.trunc(n), mini), maxi);
}

/**
 * Un entier dans ses bornes, ou un refus qui les dit : jamais ramené en silence, contrairement à `entierBorne`. Pour une
 * valeur que Claude annoncerait (une limite d'agent), ou qui désigne ce qu'on efface (une sélection de contacts).
 */
export function limiteEntiere(v: unknown, cle: string, mini: number, maxi: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < mini || v > maxi) {
    throw new RefusOutil(`${cle} : un nombre entier entre ${mini} et ${maxi}`, 'invalid_args');
  }
  return v;
}

/** Une date ISO 8601 qui DIT son fuseau (`Z` ou `+02:00`), à la seconde ou plus fin. */
const ISO_AVEC_FUSEAU = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Lit une date facultative. 🔴 Sans fuseau, elle est REFUSÉE, jamais supposée : « lundi 10 h » lu en UTC part deux
 * heures trop tôt à Paris, et une campagne programmée ne se rattrape pas. Absente : `undefined`.
 */
export function dateAvecFuseau(args: Record<string, unknown>, cle: string): Date | undefined {
  const v = args[cle];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !ISO_AVEC_FUSEAU.test(v)) {
    throw new RefusOutil(`paramètre « ${cle} » : une date ISO 8601 avec son fuseau est attendue (ex. 2026-10-21T10:00:00+02:00)`, 'invalid_args');
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new RefusOutil(`paramètre « ${cle} » : date invalide`, 'invalid_args');
  return d;
}

/**
 * Un refus d'une fonction partagée avec la console devient un refus d'OUTIL, avec sa phrase telle que l'écran la
 * montre : le modèle lit pourquoi et corrige, au lieu de croire l'outil cassé. Le statut HTTP ne sert qu'à la route.
 * 🔴 Les détails partent avec la phrase (la liste des manques d'un agent qu'on active, le code d'un refus de
 * paiement) : la route les met dans son corps à côté de `error`, et sans eux le modèle saurait qu'il est refusé sans
 * savoir quoi corriger.
 */
export function valeurOuRefus<T>(r: Issue<T>): T {
  if (!r.ok) {
    const cause = typeof r.details?.code === 'string' ? r.details.code : undefined;
    const action = typeof r.details?.upgradeUrl === 'string' ? r.details.upgradeUrl : undefined;
    throw new RefusOutil(r.details ? `${r.erreur}\n${JSON.stringify(r.details)}` : r.erreur, familleDuRefus(r.statut, cause), {
      ...(cause === undefined ? {} : { cause }),
      ...(action === undefined ? {} : { action }),
    });
  }
  return r.valeur;
}
