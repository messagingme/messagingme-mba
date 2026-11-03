import type { CampaignCategory, QualityRating, GuardrailThresholds } from './types';

export interface OptInContact {
  optInStatus: 'opted_in' | 'opted_out' | 'unknown';
}

/**
 * Un opt-out explicite bloque tout (marketing comme utility). Sinon : marketing exige un
 * opt-in explicite ; utility passe (fenêtre de service).
 */
export function optInAllows(category: CampaignCategory, contact: OptInContact): boolean {
  if (contact.optInStatus === 'opted_out') return false;
  if (category === 'utility') return true;
  return contact.optInStatus === 'opted_in';
}

/**
 * Le motif d'un envoi automatique refusé à quelqu'un qui a dit STOP : un seul texte pour le scénario et la
 * campagne, l'opérateur lit le même refus d'où qu'il vienne.
 */
export const MOTIF_DESABONNE = 'contact désabonné : il a demandé à ne plus recevoir de messages';

/**
 * Le motif d'un modèle Marketing que la garde d'un parcours d'automation n'envoie pas (décision A du cadrage mm-hubspot du
 * 2026-11-02, `PolitiqueDeLancement.marketing`) : le modèle est Marketing (ou sa catégorie illisible) et la fiche n'a pas
 * l'accord marketing (`opted_in`). Lu par l'opérateur et par le journal du runner d'automation.
 */
export const MOTIF_SANS_ACCORD_MARKETING = 'sans accord marketing : ce contact n’a pas donné son accord, le modèle Marketing ne part pas';

/**
 * Décide de mettre la campagne en pause selon la santé du numéro :
 * quality rating RED, ou taux d'échec au-delà du seuil (après un minimum d'envois).
 */
export function qualityGate(
  state: { rating: QualityRating; sent: number; failed: number },
  t: GuardrailThresholds,
): { pause: boolean; reason?: string } {
  if (state.rating === 'RED') return { pause: true, reason: 'quality rating RED' };
  const total = state.sent + state.failed;
  if (total >= t.minSendsForFailureCheck) {
    const rate = state.failed / total;
    if (rate > t.maxFailureRate) {
      return { pause: true, reason: `taux d'échec ${Math.round(rate * 100)}% > seuil` };
    }
  }
  return { pause: false };
}
