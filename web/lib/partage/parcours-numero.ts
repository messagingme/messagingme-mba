/**
 * LE VOCABULAIRE DU PARCOURS NUMÉRO, partagé par le jeton, la console et les outils MCP.
 *
 * Ce module ne rend aucun texte et ne fait aucun appel : il ne possède que les décisions qui ont exactement le même
 * sens sur les trois surfaces. Les présentations restent dans leurs adaptateurs respectifs.
 */

export const MODES_NUMERO = ['fourni', 'apporte', 'coexistence', 'fourni_application'] as const;
export type ModeNumero = (typeof MODES_NUMERO)[number];

export const FILIERES_NUMERO = ['api', 'application'] as const;
export type FiliereNumero = (typeof FILIERES_NUMERO)[number];

export type DestinationNumeroFourni = 'api' | 'application';
export type PrixNumero = 'inclus' | 'essai' | 'payant';

export function estModeNumero(x: unknown): x is ModeNumero {
  return typeof x === 'string' && (MODES_NUMERO as readonly string[]).includes(x);
}

export function estFiliereNumero(x: unknown): x is FiliereNumero {
  return typeof x === 'string' && (FILIERES_NUMERO as readonly string[]).includes(x);
}

/** Le prix effectivement demandé par le parcours, dans le même ordre de priorité que l'offre. */
export function prixDuNumero(e: { inclusDansLePro?: boolean; essaiPro?: boolean }): PrixNumero {
  return e.inclusDansLePro === true ? 'inclus' : e.essaiPro === true ? 'essai' : 'payant';
}

/** Seuls les deux modes d'un numéro fourni retiennent une destination. */
export function destinationDuNumeroFourni(mode: ModeNumero): DestinationNumeroFourni | null {
  return mode === 'fourni' ? 'api' : mode === 'fourni_application' ? 'application' : null;
}
