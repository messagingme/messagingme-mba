/**
 * Le bloc « Extraire du JSON » (plan `docs/superpowers/plans/2026-11-11-champ-json-lot-2.md`) : lire des valeurs dans
 * un champ `json` et les ranger dans d'autres champs. Module PUR, partagé : le moteur (`walk`, qui répercute les valeurs
 * sur sa copie de travail), l'exécuteur (qui relit la source au moment d'écrire) et la console (l'aperçu d'une ligne sur
 * la réponse d'exemple) calculent la même chose.
 */
import { cheminValide, litChemin } from './chemin-json';

/** Ce qu'une ligne rend : la valeur trouvée, ou le nombre d'éléments de la liste trouvée. */
export type MesureExtraction = 'valeur' | 'nombre';

export interface LigneExtraction {
  /** Un chemin de `chemin-json` (`a.b`, `a[0]`, `a[-1]`), ou VIDE pour la racine (une réponse qui est une liste). */
  chemin: string;
  mesure: MesureExtraction;
  champCible: string;
}

/** Au-delà, les lignes en trop sont ignorées : un bloc n'a pas à ranger une réponse entière champ par champ. */
export const MAX_LIGNES_EXTRACTION = 20;

/**
 * Les lignes d'un bloc, relues depuis son `data` (un graphe vient de la console, de l'API ou du MCP). Une ligne sans
 * champ cible, ou dont le chemin n'est pas lisible, est écartée : elle n'écrirait rien de sensé.
 */
export function lignesDuBloc(data: Record<string, unknown>): LigneExtraction[] {
  const brutes = Array.isArray(data.lignes) ? data.lignes : [];
  const lignes: LigneExtraction[] = [];
  for (const b of brutes) {
    if (lignes.length >= MAX_LIGNES_EXTRACTION) break;
    if (b === null || typeof b !== 'object' || Array.isArray(b)) continue;
    const o = b as Record<string, unknown>;
    const chemin = typeof o.chemin === 'string' ? o.chemin.trim() : '';
    const champCible = typeof o.champCible === 'string' ? o.champCible.trim() : '';
    if (champCible === '' || (chemin !== '' && !cheminValide(chemin))) continue;
    lignes.push({ chemin, mesure: o.mesure === 'nombre' ? 'nombre' : 'valeur', champCible });
  }
  return lignes;
}

/**
 * La valeur d'une ligne sur un JSON déjà lu, en texte, ou `''` quand il n'y a rien à ranger (chemin absent, `null`,
 * « nombre » sur autre chose qu'une liste). Un objet ou une liste sort en JSON compact : c'est ce qu'un champ `json` reçoit.
 */
export function valeurExtraite(racine: unknown, ligne: Pick<LigneExtraction, 'chemin' | 'mesure'>): string {
  const v = ligne.chemin === '' ? racine : litChemin(racine, ligne.chemin);
  if (ligne.mesure === 'nombre') return Array.isArray(v) ? String(v.length) : '';
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  // Un entier au-delà de 2^53 (identifiant de 19 chiffres) a perdu sa précision à la lecture du JSON : le ranger serait
  // ranger un AUTRE nombre, en silence. Rien, plutôt : un tel identifiant doit venir en chaîne (relecture du lot 2).
  if (typeof v === 'number') return Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v)) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return JSON.stringify(v);
}

/**
 * Toutes les lignes, sur la valeur TEXTE du champ source. Une source vide ou qui n'est pas du JSON vide chaque cible :
 * l'appel en amont a échoué, et « le champ est vide » reste le test d'un échec.
 */
export function extraireDuJson(source: string, lignes: readonly LigneExtraction[]): Array<{ champCible: string; valeur: string }> {
  let racine: unknown;
  try {
    racine = source.trim() === '' ? undefined : JSON.parse(source);
  } catch {
    racine = undefined;
  }
  return lignes.map((l) => ({ champCible: l.champCible, valeur: racine === undefined ? '' : valeurExtraite(racine, l) }));
}
