import type { Offre } from './offres';
import type { ResumePro } from './abonnements-offre.pg';

/**
 * LA FORMULE EST-ELLE PAYÉE ? Ce qui ouvre l'option du Crédit WhatsApp (révision du 2026-11-04, décisions 1 et 7) : pas
 * pendant un essai, Pro comme Business, parce que la ligne du partenaire paie Meta dès le premier message.
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
 * L'OPTION SE REPRENDRAIT-ELLE MAINTENANT ? Ce que l'e-mail de l'arrêt lit avant de dire « reprenez l'option » (relecture du
 * lot C, jaune 5) : la règle de la prise (`formulePayee`), et un Pro dont la fin programmée n'est pas passée. Pro et option
 * résiliés pour la même fin de période, l'avis de l'option peut passer le premier : le Pro vit encore chez nous, et la
 * reprise serait refusée une fois son propre avis traité.
 */
export function repriseOuverte(
  e: { offre: Offre; pro: Pick<ResumePro, 'statut' | 'essaiFinLe' | 'finiLe' | 'finPrevueLe'> | null; businessEssaiFinLe: Date | null },
  maintenant: number,
): boolean {
  if (!formulePayee(e, maintenant)) return false;
  return e.pro === null || e.offre !== 'pro' || e.pro.finPrevueLe === null || e.pro.finPrevueLe.getTime() > maintenant;
}
