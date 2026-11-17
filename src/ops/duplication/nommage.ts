/**
 * LES NOMS DES COPIES D'UNE DUPLICATION ENTRE ESPACES (lot 2 ; spec
 * `docs/superpowers/specs/2026-11-16-duplication-scenario-entre-espaces-design.md`, « Les dépendances, à la demande »).
 * Pur.
 *
 * Le même nom s'il est libre dans la destination, sinon « X (copie) », puis « X (copie 2) ». La comparaison suit
 * l'unicité de la table visée : insensible à la casse pour les agents, les requêtes et les sources (`lower(label)`),
 * sensible pour les modèles d'e-mail (`unique (tenant_id, name)`). Un outil, dont le nom doit suivre
 * `^[a-z0-9_]{1,64}$`, ne peut pas porter « (copie) » : il prend `nom_copie`, puis `nom_copie_2`.
 */

const NOM_OUTIL_MAX = 64;

export function nomLibre(nom: string, pris: Iterable<string>, casse: 'sensible' | 'insensible'): string {
  const cle = (s: string): string => (casse === 'insensible' ? s.trim().toLowerCase() : s.trim());
  const occupes = new Set([...pris].map(cle));
  if (!occupes.has(cle(nom))) return nom;
  let candidat = `${nom} (copie)`;
  for (let n = 2; occupes.has(cle(candidat)); n += 1) candidat = `${nom} (copie ${n})`;
  return candidat;
}

export function nomOutilLibre(nom: string, pris: Iterable<string>): string {
  const occupes = new Set(pris);
  if (!occupes.has(nom)) return nom;
  const avec = (suffixe: string): string => `${nom.slice(0, NOM_OUTIL_MAX - suffixe.length)}${suffixe}`;
  let candidat = avec('_copie');
  for (let n = 2; occupes.has(candidat); n += 1) candidat = avec(`_copie_${n}`);
  return candidat;
}
