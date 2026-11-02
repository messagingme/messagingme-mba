/**
 * LA COURBE DE 90 JOURS D'UN CRÉDIT (Entreprise illimitée, lot C ; décision de Julien du 2026-11-02 : « un endroit où
 * suivre l'évolution du crédit »), commune au Crédit IA et au Crédit WhatsApp. Un point par jour de Paris : le solde à la
 * fin du jour (ce que montre la courbe d'un prépayé) et ce qui a été consommé ce jour-là (celle d'une Entreprise, dont le
 * solde ne bouge pas, et qui n'aurait sinon qu'une ligne plate).
 *
 * 🔴 LE SOLDE SE RECONSTRUIT À REBOURS DEPUIS LE SOLDE COURANT, jamais en cumulant depuis le premier jour : la fenêtre ne
 * voit pas ce qui précède son premier jour, et un cumul partirait de zéro. La fin d'aujourd'hui est le solde courant ; la
 * fin de la veille est la fin du lendemain moins ce qui a bougé le lendemain. Un jour sans mouvement garde donc le solde
 * de la veille. La précision est celle du jour : un débit rendu un autre jour que sa prise (un message que Meta refuse
 * tard) compte pour rien des deux côtés.
 */

/** Ce qu'un jour a fait au crédit, tel que la requête de chaque store le rend. */
export interface JourDeCredit {
  /** AAAA-MM-JJ, jour de Paris. */
  jour: string;
  /** Ce qui a fait bouger le SOLDE ce jour-là (crédits positifs, débits négatifs) ; un débit illimité n'y entre pas. */
  mouvementSoldeMicroEur: number;
  /** Ce qui a été consommé ce jour-là, en positif, illimité compris. */
  consommationMicroEur: number;
}

/** Un point de la courbe. */
export interface PointDeCredit {
  /** AAAA-MM-JJ, jour de Paris. */
  jour: string;
  /** Le solde à la fin du jour. */
  soldeMicroEur: number;
  /** Ce qui a été consommé ce jour-là, en positif. */
  consommationMicroEur: number;
}

/** Combien de jours la courbe montre : la même fenêtre que l'historique des deux onglets. */
export const JOURS_SERIE = 90;

/**
 * Les points, du plus ancien au plus récent, depuis les jours de la requête (dans l'ordre, sans trou : chaque store les
 * tire d'un `generate_series`) et le solde courant.
 */
export function serieDeCredit(jours: readonly JourDeCredit[], soldeCourantMicroEur: number): PointDeCredit[] {
  const points: PointDeCredit[] = new Array<PointDeCredit>(jours.length);
  let fin = soldeCourantMicroEur;
  for (let i = jours.length - 1; i >= 0; i -= 1) {
    const j = jours[i]!;
    points[i] = { jour: j.jour, soldeMicroEur: fin, consommationMicroEur: j.consommationMicroEur };
    fin -= j.mouvementSoldeMicroEur;
  }
  return points;
}
