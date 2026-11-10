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
 * 🔴 Relue au moment de l'appel, sur l'état des cartes (`a_prendre`) : jamais pour un espace qui a déjà son option ou une
 * ligne (posée à la main, sur demande : « vous pouvez maintenant » y serait faux), ni pour une Free ou une Entreprise, qui
 * n'ont pas d'option. Un espace Pro en essai sans option lit aussi `a_prendre` (il prend l'option, V1 du 2026-11-10) :
 * c'est le moment de l'appel qui l'écarte, la fin de l'essai pour le webhook (`signalerConversionDuPro`), le démarrage de
 * la formule Pro et la confirmation dans `/ops` étant la conversion elle-même. Ne lève jamais : un e-mail qui tombe ne
 * fait pas tomber le webhook ni `/ops`.
 */
/**
 * La fenêtre de la conversion dite par le webhook (jaune 1 de la relecture du lot C) : la formule Pro devenue payée depuis
 * moins de 25 jours (la fin de son essai, sinon sa souscription). Le premier paiement que Stripe relance quelques semaines
 * y tient ; le renouvellement suivant, un mois plus tard, n'y est plus, ni treize mois plus tard, quand le journal des
 * e-mails a purgé la réservation de l'occasion.
 */
export const FENETRE_CONVERSION_JOURS = 25;
const JOUR_MS = 86_400_000;

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
  /** Quand la formule Pro est devenue payée : la fin de son essai, sinon sa souscription ; `null` sans Pro. */
  proPayeDepuis(tenantId: string): Promise<Date | null>;
  maintenant?: () => number;
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

/**
 * Le chemin du webhook (une facture de période payée, la mise à jour d'un Pro actif) : la conversion n'y est dite qu'à son
 * moment, dans les `FENETRE_CONVERSION_JOURS` qui suivent la formule devenue payée. Sinon un admin arrivé depuis
 * l'apprendrait à l'échéance suivante, et tous les admins treize mois plus tard (jaune 1 de la relecture du lot C). Jamais
 * avant : un essai qui court (sa fin à venir) n'a rien payé, et l'état des cartes ne l'écarte plus (relecture de V1,
 * jaune 1). Le démarrage de la formule Pro et `/ops` sont le moment lui-même : ils appellent `signalerConversion`. Ne lève
 * jamais.
 */
export async function signalerConversionDuPro(d: DepsConversion, tenantId: string): Promise<void> {
  try {
    const depuis = await d.proPayeDepuis(tenantId);
    if (depuis === null) return;
    const ecoule = (d.maintenant ?? Date.now)() - depuis.getTime();
    if (ecoule < 0 || ecoule > FENETRE_CONVERSION_JOURS * JOUR_MS) return;
  } catch (err) {
    journaliser('error', 'conversion_ligne_credit_impossible', { err, tenantId });
    return;
  }
  await signalerConversion(d, tenantId);
}
