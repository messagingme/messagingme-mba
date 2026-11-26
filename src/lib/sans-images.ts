/**
 * UNE IMAGE N'ENTRE JAMAIS DANS UNE FICHE CONTACT (plan 2026-11-26, essai Everial).
 *
 * Une réponse d'API rangée dans un champ `json` se lit dans la console, part dans les exports et sort par l'API. Celle
 * d'une analyse de pièce porte la photo et la signature du titulaire en base64 (133 Ko sur 440 pour un recto de CNI,
 * mesuré le 2026-11-26) : les garder ferait d'une fiche un coffre de pièces d'identité. On les retire avant l'écriture,
 * et le reste de la réponse (statuts, champs lus, règles) suffit à la suite : `/consolidate` de Wizidee rend le même
 * résultat avec ou sans elles (mesuré le même jour).
 *
 * Une image, c'est une data URI d'image, ou une chaîne d'au moins `MIN_BASE64` caractères faite uniquement de base64.
 * Une clé qui la porte disparaît de son objet ; un élément de liste qui en est une disparaît de sa liste.
 */

export const MIN_BASE64 = 1000;

const DATA_URI_IMAGE = /^data:image\//i;
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

export function estUneImage(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  if (DATA_URI_IMAGE.test(v.trimStart())) return true;
  if (v.length < MIN_BASE64) return false;
  // Les retours à la ligne d'un base64 découpé sont tolérés, pas les espaces : un long texte fait de mots n'est pas une
  // image.
  return BASE64.test(v.replace(/[\r\n]+/g, ''));
}

/** Une copie de la valeur, images retirées. La valeur reçue n'est pas modifiée. */
export function sansImages(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter((x) => !estUneImage(x)).map(sansImages);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!estUneImage(x)) out[k] = sansImages(x);
    }
    return out;
  }
  return v;
}
