import type { LigneShopifyVue } from './api-shopify';

/**
 * LES AUTOMATIONS SHOPIFY DE LA CONSOLE, LEUR PARTIE SANS ÉCRAN (menu « Scénario », lot 5) : l'état d'une ligne tel que la
 * section Shopify de l'écran Automation le dit, et le délai du panier en clair. Le message lui-même se règle dans son
 * scénario (le premier bloc, verrouillé), jamais ici.
 */

export type EtatAutomation =
  | 'a_creer'
  | 'eteinte'
  | 'a_completer'
  | 'en_validation'
  | 'refuse'
  | 'active'
  | 'active_nouvelle_version'
  | 'meta_non_lu';

/**
 * L'état d'une automation : sans ligne, à créer ; éteinte ; allumée sans premier template, à compléter dans son
 * scénario ; puis l'état de ce template chez Meta. Une liste de Meta illisible (`etatChezMeta` nul, un template nommé)
 * se dit « non lu », jamais « refusé » : la panne est celle de la lecture, pas du template.
 */
export function etatDeLAutomation(l: LigneShopifyVue | undefined): EtatAutomation {
  if (l === undefined) return 'a_creer';
  if (!l.actif) return 'eteinte';
  if (l.modele === null) return 'a_completer';
  if (l.etatChezMeta === null) return 'meta_non_lu';
  if (l.etatChezMeta === 'PENDING' || l.etatChezMeta === 'IN_APPEAL') return 'en_validation';
  if (l.etatChezMeta !== 'APPROVED') return 'refuse';
  return l.versionProgrammee ? 'active_nouvelle_version' : 'active';
}

/** Le délai en clair : « 15 min », « 1 h », « 1 h 30 », « 24 h ». */
export function delaiEnClair(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}
