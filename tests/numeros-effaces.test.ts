import { describe, it, expect } from 'vitest';
import { RETENTION_NUMEROS_EFFACES_JOURS } from '../src/crm/refus-effaces';
import { FENETRE_LONGUE_MOIS, FENETRE_REPRISE_JOURS } from '../src/shopify/reprise';

/**
 * 🔴 LA TRACE DES NUMÉROS EFFACÉS DURE PLUS QUE LA FENÊTRE DU RATTRAPAGE (segments Shopify enrichis, lot 5b). Une commande
 * que le rattrapage peut lire a été payée dans sa fenêtre, et un effacement qui la suit est plus récent encore : une trace
 * plus courte que la fenêtre laisserait recréer le contact supprimé d'une commande encore lisible. Les deux constantes
 * vivent dans deux fichiers ; la fenêtre qui s'allonge (24 mois au lot 7) doit allonger la trace.
 */
describe('la durée de la trace des numéros effacés', () => {
  it('reste au-dessus de la fenêtre du rattrapage des commandes, minuit du premier jour compris', () => {
    expect(RETENTION_NUMEROS_EFFACES_JOURS).toBeGreaterThan(FENETRE_REPRISE_JOURS + 1);
  });

  it('🔴 reste au-dessus de la fenêtre LONGUE (24 mois, lot 7a), au plus long des mois', () => {
    expect(RETENTION_NUMEROS_EFFACES_JOURS).toBeGreaterThan(FENETRE_LONGUE_MOIS * 31 + 1);
  });
});
