/**
 * L'APERÇU D'UN MESSAGE SUR LE CANEVAS (Julien, 2026-11-20 : « voir l'intégralité du message », et les variables par leur
 * nom) : le texte d'un template découpé en morceaux, chaque `{{n}}` à part pour être montré par le nom de ce qu'il envoie.
 */

export type Morceau = { texte: string } | { position: number };

/** Le texte en morceaux : le texte brut, et chaque variable numérotée `{{n}}` à part, dans l'ordre. */
export function morceauxDuMessage(texte: string): Morceau[] {
  const morceaux: Morceau[] = [];
  let depuis = 0;
  for (const m of texte.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    if (m.index > depuis) morceaux.push({ texte: texte.slice(depuis, m.index) });
    morceaux.push({ position: Number(m[1]) });
    depuis = m.index + m[0].length;
  }
  if (depuis < texte.length) morceaux.push({ texte: texte.slice(depuis) });
  return morceaux;
}
