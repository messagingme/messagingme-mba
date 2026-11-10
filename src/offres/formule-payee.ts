import type { Offre } from './offres';
import type { ResumePro } from './abonnements-offre.pg';

/**
 * LA FORMULE EST-ELLE PAYÉE ? Ce qu'en dit l'onglet du Crédit WhatsApp (`option.formulePayee`). Elle a ouvert l'option
 * jusqu'au 2026-11-10 ; depuis, c'est `optionPrenable` qui l'ouvre, essai Pro compris.
 *
 * - Un Pro a payé quand son abonnement vit au statut `actif` hors essai : payé dès le départ, ou son essai fini (Stripe
 *   prélève alors la carte prise au début de l'essai ; un échec le fait passer `en_retard`) ou écourté par le client. Une
 *   résiliation programmée pendant l'essai reste un essai : elle ne sera suivie d'aucun paiement.
 * - Un Business a payé quand Julien l'a confirmé : sa date d'essai effacée. Une date passée sans confirmation reste un
 *   essai, seule la confirmation ouvre l'option.
 * - Free et Entreprise n'ont jamais l'option (l'Entreprise est illimitée, sans option).
 */
export function formulePayee(
  e: { offre: Offre; pro: Pick<ResumePro, 'statut' | 'essaiFinLe' | 'finiLe'> | null; businessEssaiFinLe: Date | null },
  maintenant: number,
): boolean {
  if (e.offre === 'business') return e.businessEssaiFinLe === null;
  if (e.offre !== 'pro' || e.pro === null) return false;
  if (e.pro.finiLe !== null || e.pro.statut !== 'actif') return false;
  return e.pro.essaiFinLe === null || e.pro.essaiFinLe.getTime() <= maintenant;
}

/**
 * L'OPTION SE PREND-ELLE MAINTENANT ? La règle de la prise du Crédit WhatsApp (décisions de Julien du 2026-11-10, plan
 * `2026-11-10-credit-whatsapp-vente-libre-service.md`, V1), lue par la prise, l'état des cartes, l'onglet et la reprise :
 * une seule règle, sinon un écran vend ce que la prise refuse.
 *
 * - Un Pro la prend dès le début de son essai de 14 jours, et la paie : son abonnement vivant au statut `actif`, essai en
 *   cours ou fini, même quand l'arrêt de la formule est déjà programmé (AskUserQuestion du 2026-11-10). Un essai non payé
 *   l'arrête à la clôture de la formule par Stripe, sans remboursement : la fin de droit, inchangée.
 * - Un Pro en retard de prélèvement, jamais (`formuleEnRetard` dit la raison du refus).
 * - Un Business attend la confirmation de Julien, comme avant (`formulePayee`) : la décision ne vise que l'essai Pro.
 * - Free et Entreprise, jamais (l'Entreprise est illimitée, sans option).
 */
export function optionPrenable(
  e: { offre: Offre; pro: Pick<ResumePro, 'statut' | 'essaiFinLe' | 'finiLe'> | null; businessEssaiFinLe: Date | null },
  maintenant: number,
): boolean {
  if (e.offre === 'pro') return e.pro !== null && e.pro.finiLe === null && e.pro.statut === 'actif';
  return formulePayee(e, maintenant);
}

/**
 * L'OPTION SE REPRENDRAIT-ELLE MAINTENANT ? Ce que l'e-mail de l'arrêt lit avant de dire « reprenez l'option » (relecture du
 * lot C, jaune 5) : la règle de la prise (`optionPrenable`), et un Pro dont la fin programmée n'est pas passée. Pro et
 * option résiliés pour la même fin de période, l'avis de l'option peut passer le premier : le Pro vit encore chez nous, et
 * la reprise serait refusée une fois son propre avis traité.
 */
export function repriseOuverte(
  e: { offre: Offre; pro: Pick<ResumePro, 'statut' | 'essaiFinLe' | 'finiLe' | 'finPrevueLe'> | null; businessEssaiFinLe: Date | null },
  maintenant: number,
): boolean {
  if (!optionPrenable(e, maintenant)) return false;
  return e.pro === null || e.offre !== 'pro' || e.pro.finPrevueLe === null || e.pro.finPrevueLe.getTime() > maintenant;
}

/**
 * LA FORMULE PRO EST-ELLE EN RETARD DE PAIEMENT ? Un Pro vivant dont Stripe relance un prélèvement échoué : sa formule
 * n'est pas payée (`formulePayee`), sans être un essai. Le refus de la prise de l'option le dit (relecture du lot C5,
 * jaune 7) ; un Business n'est jamais « en retard », Julien le confirme ou non.
 */
export function formuleEnRetard(
  e: { offre: Offre; pro: Pick<ResumePro, 'statut' | 'essaiFinLe' | 'finiLe'> | null; businessEssaiFinLe: Date | null },
): boolean {
  return e.offre === 'pro' && e.pro !== null && e.pro.finiLe === null && e.pro.statut === 'en_retard';
}
