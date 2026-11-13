/**
 * Le seuil du Crédit WhatsApp bas : 10 €. Sous lui, les administrateurs reçoivent un e-mail, une fois par crédit reçu
 * (`creerAlertesCreditWhatsapp`, `src/emails-produit/alertes.ts`), et l'onglet Crédit WhatsApp de la console le dit
 * (`web/components/OngletCreditWhatsapp.tsx`). Un seul chiffre pour les deux : un écran qui préviendrait à un autre
 * seuil que l'e-mail se contredirait.
 */
export const SEUIL_CREDIT_WHATSAPP_BAS_MICRO_EUR = 10_000_000;

/**
 * Un euro : très au-dessus du prix d'un message de la grille de Meta, qui se compte en centimes. Sous lui, une campagne
 * en pause faute de crédit ne repart pas (`leverPausesCreditWhatsapp`, `src/account/numero-delie.pg.ts` : un simple
 * « solde positif » la relançait au balayage horaire sur un reste qui ne couvre plus un message), l'onglet de la console
 * dit le crédit presque épuisé, et `get_setup_state` le signale (`credit_whatsapp_epuise`).
 */
export const SOLDE_REPRISE_CREDIT_MICRO_EUR = 1_000_000;

/**
 * LE CRÉDIT WHATSAPP PAIE-T-IL META POUR LE NUMÉRO DE L'ESPACE ? (jaunes 2 et 3 de la relecture du lot B) Oui quand la
 * ligne est active, ou quand l'option payée attend sa ligne, et jamais pour un numéro qui garde l'application WhatsApp
 * Business : il reste sur sa carte chez Meta (décision 8). Alors seulement, « Ajoutez votre carte chez Meta » se tait :
 * `get_setup_state` (`carte_meta_a_regler`), la suite de `watch_whatsapp_connection` et le bandeau de l'Accueil lisent
 * cette règle-ci. `avecApplication` : tous les numéros vivants de l'espace gardent l'application
 * (`tousGardentLApplication`) ; un espace pilote un seul numéro. `numeroAvecCarte` : un numéro connecté avec sa carte chez
 * Meta (`numeroAvecCarte`, décision de Julien du 2026-11-13), que la ligne ne prendra jamais : l'option payée ne
 * l'attend pas. Une ligne active paie quand même, comme sur la carte de Connecter WhatsApp, qui ne dit le texte (1)
 * qu'hors ligne active. Requis : facultatif, un lecteur qui l'oublierait tairait la carte à ce numéro en silence.
 */
export function creditPaieMeta(etat: string | null | undefined, avecApplication: boolean, numeroAvecCarte: boolean): boolean {
  return !avecApplication && (etat === 'active' || (etat === 'en_attente' && !numeroAvecCarte));
}
