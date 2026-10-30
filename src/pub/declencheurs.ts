/**
 * BRANCHER UNE CONVERSION APRÈS UN GESTE QUI EXISTE (lot 2 du plan pixel). `NumeroConnecte` se signale autour des trois
 * gestes de la connexion d'un numéro, sans qu'aucune interface de connexion ne change : l'offre de bienvenue des
 * filières Cloud et application (appelée seulement sur un signal de Meta), et le rattachement 360dialog.
 *
 * Le geste d'abord, le signal ensuite, et seulement si le geste a réussi : un geste qui lève relève tel quel, sans
 * signal. 🔴 Le signal ne dépend pas de ce que le geste a offert : `CREDIT_OFFERT_MICRO_EUR=0` éteint l'offre, pas
 * l'activation. Il ne lève jamais (`EmetteurConversions`), et la réservation en base fait d'un geste répété un seul fait.
 */
export function puisSignaler<A extends unknown[], R>(
  geste: (...a: A) => Promise<R>,
  signaler: (...a: A) => Promise<void>,
): (...a: A) => Promise<R> {
  return async (...a) => {
    const r = await geste(...a);
    await signaler(...a);
    return r;
  };
}
