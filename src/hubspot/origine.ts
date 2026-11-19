import { ORIGINE_MAX } from '../workflow/evenement';

/**
 * L'ORIGINE D'UN PARCOURS HUBSPOT (menu « Scénario », lot 6, décision 37), le SEUL endroit où elle s'écrit.
 *
 * Un parcours d'événement ne naît qu'une fois par origine, tous statuts confondus (`evenementDejaNe`, index de 0300) :
 * l'origine porte donc la fenêtre de la décision 37. Un deal à une étape : une naissance par jour (UTC) ; revenu à son étape
 * le lendemain, il repart. Un rendez-vous : une naissance par date ; déplacé, il repart.
 *
 * - `hubspot:etape:<ligne>:<deal>:<étape>:<jour>`
 * - `hubspot:rdv:<ligne>:<contact>:<champ>:<date>`
 *
 * ⚠️ LA LIGNE Y EST (écart au plan du lot 6, accepté) : deux rappels sur le même champ date (la veille et deux heures avant)
 * sont deux lignes ; sans elle, ils auraient la même origine, et le second serait « déjà né » pour toujours. Elle suit la
 * famille, pour qu'éteindre ou supprimer une ligne arrête ses parcours par préfixe (`prefixeHubspot`), comme une ligne
 * Shopify (`prefixeShopify`).
 *
 * ⚠️ LE PORTAIL N'Y EST PAS (lot 6b) : il ne se lit que chez le connecteur, par le réseau. La ligne, une automation de
 * l'espace, rend déjà l'origine propre à l'espace, et une origine se compare toujours dans un espace et pour un contact.
 *
 * ⚠️ LE JOUR EST CELUI DU CALENDRIER UTC : deux changements de part et d'autre de minuit UTC font deux naissances, même à
 * quelques minutes d'écart. C'est la fenêtre de 24 h que peut porter un texte comparé à l'identique.
 *
 * `null` quand l'origine ne serait pas sûre : une partie vide, des deux-points ailleurs que dans la date d'un rendez-vous
 * (sa dernière partie, où l'heure en porte), un instant illisible, ou plus de `ORIGINE_MAX` caractères. L'appelant ne pose
 * alors aucun pont : le premier message part seul, comme pour Shopify.
 */

export type FamilleHubspot = 'etape' | 'rdv';

export type EvenementHubspot =
  /** Un deal passé à une étape. `le` : l'instant du changement, dont le jour UTC porte la fenêtre. */
  | { famille: 'etape'; ligne: string; deal: string; etape: string; le: Date }
  /** Un rendez-vous : le contact, le champ date `hs_*` de sa fiche et sa valeur (celle pour laquelle on tire). */
  | { famille: 'rdv'; ligne: string; contact: string; champ: string; date: string };

/**
 * Le début des origines HubSpot, d'une famille ou d'une ligne : ce que l'arrêt des parcours d'événement compare
 * (`starts_with`). Il finit par `:`, pour qu'une ligne n'en recouvre jamais une autre dont l'identifiant commencerait pareil.
 */
export function prefixeHubspot(famille?: FamilleHubspot, ligne?: string): string {
  if (famille === undefined) return 'hubspot:';
  return ligne === undefined ? `hubspot:${famille}:` : `hubspot:${famille}:${ligne}:`;
}

export function origineHubspot(e: EvenementHubspot): string | null {
  if (e.famille === 'etape' && Number.isNaN(e.le.getTime())) return null;
  // Ce qui suit la ligne, la dernière partie à part : seule la date d'un rendez-vous peut porter des deux-points.
  const [milieu, fin]: [string[], string] = e.famille === 'etape'
    ? [[e.deal, e.etape], e.le.toISOString().slice(0, 10)]
    : [[e.contact, e.champ], e.date];
  if (fin === '' || [e.ligne, ...milieu].some((p) => p === '' || p.includes(':'))) return null;
  const origine = `${prefixeHubspot(e.famille, e.ligne)}${[...milieu, fin].join(':')}`;
  return origine.length <= ORIGINE_MAX ? origine : null;
}
