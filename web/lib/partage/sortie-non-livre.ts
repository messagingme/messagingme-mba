/**
 * La sortie « En cas d'échec » d'un bloc template (Julien, 2026-11-20) : Meta n'a pas pu livrer le message (statut
 * `failed`). Le moteur la prend sur l'accusé (`WorkflowExecutor.templateNonLivre`) et le canevas la dessine sur CETTE valeur.
 * 🔴 Aucune suite libre ne la prend jamais (`nextNode`, `nextNodeHorsTimeout`) : sinon un contact bien servi partirait dans
 * la branche d'échec.
 */
export const SORTIE_NON_LIVRE = 'non_livre';
