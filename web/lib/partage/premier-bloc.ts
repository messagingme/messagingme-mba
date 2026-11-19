/**
 * La marque du premier bloc d'un scénario d'automation (Shopify, HubSpot au lot 6 ; décision 13), posée par le serveur
 * dans `data` à la création du scénario, jamais par la console. Partagée : le serveur la juge (`src/shopify/premier-bloc.ts`),
 * le builder la respecte (ni ✕, ni flèche entrante, toujours un template).
 */
export const MARQUE_PREMIER_BLOC = 'verrouille';

/** La `data` d'un bloc (du JSON libre) porte-t-elle la marque ? */
export function estPremierBlocVerrouille(data: Readonly<Record<string, unknown>>): boolean {
  return data[MARQUE_PREMIER_BLOC] === true;
}
