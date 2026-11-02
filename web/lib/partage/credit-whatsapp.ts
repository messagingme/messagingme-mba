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
