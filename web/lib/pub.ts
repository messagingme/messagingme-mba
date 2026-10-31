/**
 * L'ACCORD PUBLICITAIRE DONNÉ À LA CRÉATION D'UN COMPTE (pixel Meta, lot 3 du plan
 * docs/superpowers/plans/2026-10-30-pixel-meta.md). La case non cochée de `/signup` et de `/autoriser` ; cochée, le
 * corps de la création porte `pub`, que les trois routes du serveur lisent (`lireChampPub`, `src/pub/inscription.ts`).
 *
 * `fbc` et `fbp` arrivent de la vitrine dans l'adresse (le clic sur une publicité, le navigateur), seulement si le
 * visiteur y a accepté le pixel. Ils sont lus AU MOMENT D'ENVOYER, jamais gardés : une navigation qui les perd les perd.
 * Le serveur les revalide ; ici, une valeur hors format est simplement omise.
 */
export interface ChampPub {
  accord: true;
  fbc?: string;
  fbp?: string;
}

/** Le format des identifiants de Meta (`fb.<version>.<horodatage>.<valeur>`), le même que le serveur. */
const IDENTIFIANT_META = /^fb\.[0-9]+\.[0-9]+\.[A-Za-z0-9_.-]+$/;

const identifiant = (v: string | null): string | undefined =>
  v !== null && v.length <= 500 && IDENTIFIANT_META.test(v) ? v : undefined;

/** Le champ `pub` du corps : `undefined` sans la case cochée, rien ne part alors. */
export function champPub(accord: boolean, recherche: string): ChampPub | undefined {
  if (!accord) return undefined;
  const p = new URLSearchParams(recherche);
  const fbc = identifiant(p.get('fbc'));
  const fbp = identifiant(p.get('fbp'));
  return { accord: true, ...(fbc ? { fbc } : {}), ...(fbp ? { fbp } : {}) };
}
