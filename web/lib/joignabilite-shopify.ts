import type { JoignabiliteShopify } from './partage/joignabilite-shopify';

/**
 * Quantitatif > Shopify, la carte « Joignabilité WhatsApp » (segments Shopify enrichis, lot 2b) : la réponse de
 * `/stats/joignabilite` lue défensivement, puis le taux et les parts. Module PUR : la suite de `web/lib` le teste.
 *
 * 🔴 `null` POUR UNE RÉPONSE ILLISIBLE, et la carte disparaît : un zéro affiché à tort se lirait « personne n'est sur
 * WhatsApp ». Une réponse dont les parts ne font pas le total est illisible aussi : l'écran n'affiche jamais une
 * répartition qui ne tombe pas juste.
 */
export type JoignabiliteVue = JoignabiliteShopify;

const entier = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export function lireJoignabilite(brut: unknown): JoignabiliteVue | null {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return null;
  const o = brut as Record<string, unknown>;
  const cles = ['expediees', 'messagesLivres', 'livrees', 'supprimees', 'sansNumero', 'invalides', 'enAttente', 'testExpediees'] as const;
  if (!cles.every((k) => entier(o[k]))) return null;
  const v = Object.fromEntries(cles.map((k) => [k, o[k] as number])) as unknown as JoignabiliteVue;
  if (v.livrees + v.supprimees + v.sansNumero + v.invalides + v.enAttente !== v.expediees) return null;
  return v;
}

/**
 * Un pourcentage à afficher, sans « % » : `null` sur un total nul ; « 0 » et « 100 » seulement quand c'est vrai. Entre
 * les deux, l'arrondi ne les produit jamais : « < 1 » et « > 99 », car 0,3 % arrondi à « 0 % » se lirait « personne n'est
 * sur WhatsApp » (relecture du lot 2b).
 */
function pourcentLisible(n: number, total: number): string | null {
  if (total === 0) return null;
  if (n === 0) return '0';
  if (n === total) return '100';
  const p = Math.round((100 * n) / total);
  return p < 1 ? '< 1' : p > 99 ? '> 99' : String(p);
}

/**
 * Le taux de joignabilité : commandes expédiées qui ont reçu au moins un WhatsApp livré, sur les commandes expédiées.
 * 🔴 `null` sans expédition : jamais « 0 % », qui se lirait « personne n'est sur WhatsApp ».
 */
export function tauxJoignabilite(v: JoignabiliteVue): string | null {
  return pourcentLisible(v.livrees, v.expediees);
}

/** La part d'un compte dans les commandes expédiées ; `null` sans expédition. */
export function partDesExpediees(n: number, v: JoignabiliteVue): string | null {
  return pourcentLisible(n, v.expediees);
}
