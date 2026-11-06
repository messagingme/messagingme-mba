import { journaliser } from '../lib/journal';
import type { EmetteurEmails } from '../emails-produit/emission';
import type { Offre } from '../offres/offres';
import type { EtatLigne } from './etat-ligne';

/**
 * LA CONVERSION DITE AU CLIENT (révision du Crédit WhatsApp du 2026-11-04, lot C, moment 2) : sa formule devient payée,
 * l'essai de la formule Pro fini et payé ou écourté, un Business confirmé dans `/ops`. Ses admins apprennent qu'ils peuvent
 * payer leurs messages chez Messaging Me, sans carte chez Meta. Une fois par espace (l'occasion `conversion`), quel que
 * soit le nombre d'appels : le webhook l'appelle à chaque facture de période payée, le démarrage de la formule Pro et
 * `/ops` aussi, et la réservation de l'occasion ne laisse partir que le premier.
 *
 * Hors vente (décision de Julien du 2026-11-06, « dès maintenant, sur demande »), le même moment dit que l'option se
 * demande au Support : jamais « prenez l'option » pour une option qui ne se prend pas.
 *
 * 🔴 Relue au moment de l'appel, sur l'état des cartes (`a_prendre`) : jamais pour une formule pas encore payée (un
 * essai), ni pour un espace qui a déjà son option ou une ligne (posée à la main, sur demande : « vous pouvez maintenant »
 * y serait faux), ni pour une Free ou une Entreprise, qui n'ont pas d'option. Ne lève jamais : un e-mail qui tombe ne
 * fait pas tomber le webhook ni `/ops`.
 */
export interface DepsConversion {
  /** L'offre de l'espace, relue sans cache : elle vient peut-être de changer. */
  offre(tenantId: string): Promise<Offre>;
  /** L'état des cartes « Qui règle Meta ? » (`lireEtatLigne`), qui porte la règle de la formule payée. */
  etat(tenantId: string): Promise<EtatLigne>;
  /** L'option se prend en ligne : son prix posé chez Stripe. */
  enVente: boolean;
  emettre: EmetteurEmails['emettre'];
  /** La page « Connecter WhatsApp » de la console, où l'option se prend. */
  pageNumero: string;
  /** La page Support de la console, où l'option se demande hors vente. */
  pageSupport: string;
}

export async function signalerConversion(d: DepsConversion, tenantId: string): Promise<void> {
  try {
    const offre = await d.offre(tenantId);
    if (offre !== 'pro' && offre !== 'business') return;
    if ((await d.etat(tenantId)) !== 'a_prendre') return;
    await d.emettre(d.enVente
      ? { cle: 'ligne_credit_disponible', tenantId, occasion: 'conversion', a: 'admins', valeurs: { lien_numero: d.pageNumero } }
      : { cle: 'ligne_credit_sur_demande', tenantId, occasion: 'conversion', a: 'admins', valeurs: { lien_support: d.pageSupport } });
  } catch (err) {
    journaliser('error', 'conversion_ligne_credit_impossible', { err, tenantId });
  }
}
