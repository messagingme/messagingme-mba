/**
 * Qui invite, tel que l'e-mail d'invitation (serveur) et la page `/invite` (console) le disent, par UN seul texte (lot
 * identité C) : le nom, puis l'adresse entre parenthèses ; l'adresse seule sans nom ou quand le nom la répète ; vide
 * sans l'un ni l'autre. Un nom se choisit librement : l'adresse montrée à côté fait voir une usurpation.
 * Texte brut : l'appelant l'échappe s'il l'insère dans du HTML.
 */
export function libelleInvitant(nom: string | null | undefined, adresse: string | null | undefined): string {
  const n = (nom ?? '').trim();
  const a = (adresse ?? '').trim();
  if (n && a && n.toLowerCase() !== a.toLowerCase()) return `${n} (${a})`;
  return a || n;
}
