/**
 * Le filtre de la liste des espaces de `/ops` (2026-11-19) : sur le nom ou le code d'espace, sans casse, côté client
 * sur la liste déjà chargée. 🔴 Le code reste un repère : aucune route ne le reçoit en paramètre.
 */
export function filtrerEspaces<T extends { name: string; code?: string }>(lignes: T[], q: string): T[] {
  const cherche = q.trim().toLowerCase();
  if (cherche === '') return lignes;
  return lignes.filter((l) => l.name.toLowerCase().includes(cherche) || (l.code ?? '').toLowerCase().includes(cherche));
}
