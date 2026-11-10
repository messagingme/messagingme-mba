/**
 * La sortie « Puis, sans attendre » d'un message rapide à boutons (Julien, 2026-11-10) : la suite qui part juste après
 * le message, pendant que ses boutons restent proposés. Le moteur la parcourt (`walk`, `src/workflow/engine.ts`) et le
 * canevas la dessine sur CETTE valeur : un littéral qui divergerait d'une lettre ne correspondrait à aucune arête, et la
 * suite ne partirait jamais, sans erreur nulle part.
 */
export const SORTIE_ENSUITE = 'ensuite';
