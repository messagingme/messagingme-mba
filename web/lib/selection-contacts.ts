import type { BulkTarget, ContactFilters } from './contact-filters';

/**
 * Une sélection explicite de lignes, ou tous les contacts correspondant aux filtres moins les exclusions.
 * `toutFiltre` exprime une intention serveur : la page affichée peut être plafonnée à 500 lignes. Dans ce
 * mode, seul `exclus` décide des cases décochées ; dans l'autre, seul `selected` décide des cases cochées.
 */
export interface SelectionContacts {
  toutFiltre: boolean;
  selected: Set<string>;
  exclus: Set<string>;
}

export function selectionTout(): SelectionContacts {
  return { toutFiltre: true, selected: new Set(), exclus: new Set() };
}

export function selectionVide(): SelectionContacts {
  return { toutFiltre: false, selected: new Set(), exclus: new Set() };
}

export function estRetenu(selection: SelectionContacts, id: string): boolean {
  return selection.toutFiltre ? !selection.exclus.has(id) : selection.selected.has(id);
}

export function nbRetenus(selection: SelectionContacts, total: number | null): number {
  return selection.toutFiltre ? Math.max(0, (total ?? 0) - selection.exclus.size) : selection.selected.size;
}

/** Bascule la seule case active dans le mode courant, sans muter l'état précédent. */
export function basculerContact(selection: SelectionContacts, id: string): SelectionContacts {
  const ids = new Set(selection.toutFiltre ? selection.exclus : selection.selected);
  if (ids.has(id)) ids.delete(id); else ids.add(id);
  return selection.toutFiltre ? { ...selection, exclus: ids } : { ...selection, selected: ids };
}

/**
 * L'en-tête coche les lignes affichées, ou les décoche si elles le sont déjà. 🔴 Les lignes cochées sur une AUTRE page du
 * mini-CRM restent cochées (2026-11-24, la liste passe par pages) : remplacer la sélection par la page courante faisait
 * exporter ou supprimer un autre jeu que celui que l'opérateur avait coché.
 */
export function basculerLignesAffichees(selection: SelectionContacts, ids: string[]): SelectionContacts {
  if (selection.toutFiltre) return selectionVide();
  const toutesCochees = ids.length > 0 && ids.every((id) => estRetenu(selection, id));
  const selected = new Set(selection.selected);
  for (const id of ids) if (toutesCochees) selected.delete(id); else selected.add(id);
  return { ...selection, selected };
}

/** Contrat commun des actions CRM et de la création de campagne. */
export function cibleContacts(selection: SelectionContacts, filtres: ContactFilters): BulkTarget {
  return selection.toutFiltre
    ? { filters: filtres, excludeIds: [...selection.exclus] }
    : { ids: [...selection.selected] };
}
