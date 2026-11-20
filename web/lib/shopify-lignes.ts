import type { LigneShopifyVue } from './api-shopify';
import { DONNEES_PAR_EVENEMENT, DONNEES_SHOPIFY, LIBELLES_DONNEES, type DonneeShopify } from './partage/shopify-messages';

/**
 * LES AUTOMATIONS SHOPIFY DE LA CONSOLE, LEUR PARTIE SANS ÉCRAN (menu « Scénario », lot 5) : l'état d'une ligne tel que la
 * section Shopify de l'écran Automation le dit, et le délai du panier en clair. Le message lui-même se règle dans son
 * scénario (le premier bloc, verrouillé), jamais ici.
 */

export type EtatAutomation =
  | 'a_creer'
  | 'eteinte'
  | 'prete'
  | 'eteinte_en_validation'
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
 *
 * Le message standard posé au branchement (spec 2026-11-20) attend Meta dans une version PROGRAMMÉE, la publiée restant
 * sans template : éteinte, la ligne dit alors qu'il est en validation, puis qu'elle est prête dès qu'un template publié
 * est approuvé (allumer suffit) ; allumée, elle est en validation plutôt qu'« à compléter ». Propre à Shopify : une ligne
 * HubSpot éteinte se dit toujours « éteinte » (`etatDeLaLigne`, `hubspot-lignes.ts`).
 */
export function etatDeLAutomation(l: LigneShopifyVue | undefined): EtatAutomation {
  if (l === undefined) return 'a_creer';
  if (!l.actif) {
    if (l.modele !== null && l.etatChezMeta === 'APPROVED') return 'prete';
    if (l.versionProgrammee || l.etatChezMeta === 'PENDING' || l.etatChezMeta === 'IN_APPEAL') return 'eteinte_en_validation';
    return 'eteinte';
  }
  if (l.modele === null && l.versionProgrammee) return 'en_validation';
  return etatDUneLigne(l);
}

/**
 * L'état d'une ligne qui existe, la règle ci-dessus sans le cas « à créer ». Partagée avec les automations HubSpot
 * (`hubspot-lignes.ts`, lot 6c), dont la ligne porte les mêmes champs : une seule lecture des statuts de Meta.
 */
export function etatDUneLigne(l: Pick<LigneShopifyVue, 'actif' | 'modele' | 'etatChezMeta' | 'versionProgrammee'>): Exclude<EtatAutomation, 'a_creer'> {
  if (!l.actif) return 'eteinte';
  if (l.modele === null) return 'a_completer';
  if (l.etatChezMeta === null) return 'meta_non_lu';
  if (l.etatChezMeta === 'PENDING' || l.etatChezMeta === 'IN_APPEAL') return 'en_validation';
  if (l.etatChezMeta !== 'APPROVED') return 'refuse';
  return l.versionProgrammee ? 'active_nouvelle_version' : 'active';
}

/** Une donnée de l'événement qu'un scénario Shopify lit : sa clé, et son libellé dans les deux langues. */
export interface DonneeEvenement {
  cle: DonneeShopify;
  libelle: readonly [string, string];
}

/**
 * Les données qu'un scénario Shopify peut lire, dans le builder (les variables d'un template, `{{shopify.<clé>}}` dans un
 * texte) : celles de l'événement de sa ligne ; toutes, pour une copie qu'aucune ligne n'envoie, atteinte par un « Aller
 * à » (elle reçoit les données de l'événement d'où l'on vient).
 */
export function donneesDuScenario(lignes: readonly LigneShopifyVue[], workflowId: string): DonneeEvenement[] {
  const ligne = lignes.find((l) => l.workflowId === workflowId);
  const cles = ligne ? DONNEES_PAR_EVENEMENT[ligne.evenement] : DONNEES_SHOPIFY;
  return cles.map((cle) => ({ cle, libelle: LIBELLES_DONNEES[cle] }));
}

/** Le délai en clair : « 15 min », « 1 h », « 1 h 30 », « 24 h ». */
export function delaiEnClair(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}
