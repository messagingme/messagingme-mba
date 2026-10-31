/**
 * Le seuil du Crédit WhatsApp bas : 10 €. Sous lui, les administrateurs reçoivent un e-mail, une fois par crédit reçu
 * (`creerAlertesCreditWhatsapp`, `src/emails-produit/alertes.ts`), et l'onglet Crédit WhatsApp de la console le dit
 * (`web/components/OngletCreditWhatsapp.tsx`). Un seul chiffre pour les deux : un écran qui préviendrait à un autre
 * seuil que l'e-mail se contredirait.
 */
export const SEUIL_CREDIT_WHATSAPP_BAS_MICRO_EUR = 10_000_000;
