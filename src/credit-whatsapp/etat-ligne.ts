import type { Offre } from '../offres/offres';
import type { StatutOption } from './options.pg';

/**
 * L'ÉTAT DU CRÉDIT WHATSAPP D'UN ESPACE, VU DES CARTES « QUI RÈGLE META ? » (révision du 2026-11-04, lot B, B1) :
 * - `free` : jamais de ligne en Free (la carte dit « avec la formule Pro ») ;
 * - `essai` : la formule n'est pas encore payée (`formulePayee`), Pro comme Business : l'option attend ;
 * - `a_prendre` : formule payée, ni option ni ligne (une Entreprise sans ligne aussi : elle se pose sur demande) ;
 * - `en_attente` : l'option est payée, aucune ligne posée encore (« votre ligne s'ouvre sous 24 h ouvrées ») ;
 * - `active` : au moins une ligne de l'espace non arrêtée ;
 * - `arretee` : toutes ses lignes sont arrêtées (la sortie : reprendre l'option, ou sa carte chez Meta).
 * La console (Connecter WhatsApp, l'Accueil) et `get_setup_state` le lisent ici : il ne se recalcule nulle part ailleurs.
 */
export type EtatLigne = 'free' | 'essai' | 'a_prendre' | 'en_attente' | 'active' | 'arretee';

export interface DepsEtatLigne {
  offre(tenantId: string): Promise<Offre>;
  /** La règle de la prise de l'option (`formulePayee`, `src/offres/formule-payee.ts`). */
  formulePayee(tenantId: string): Promise<boolean>;
  /** Les lignes de l'espace (`lignesDeLEspace`), arrêtées comprises : seul compte que `arreteeLe` soit posé ou non. */
  lignes(tenantId: string): Promise<ReadonlyArray<{ arreteeLe: Date | string | null }>>;
  /** L'option vivante de l'espace, ses places payées et son statut ; `null` sans option. */
  option(tenantId: string): Promise<{ places: number; statut: StatutOption } | null>;
}

/**
 * Les lectures de l'état, telles que la route de l'onglet (`CreditWhatsappRouteDeps`) et le serveur MCP (`DepsAgentMcp`)
 * les reçoivent déjà : une seule façon de le lire, pour les cartes de la console comme pour Claude.
 */
export interface SourcesEtatLigne {
  option: {
    offre(tenantId: string): Promise<Offre>;
    formulePayee(tenantId: string): Promise<boolean>;
    options: { vivante(tenantId: string): Promise<{ places: number; statut: StatutOption } | null> };
  };
  vue: { lignes(tenantId: string): Promise<ReadonlyArray<{ arreteeLe: Date | string | null }>> };
}

/** Les méthodes des magasins s'appellent sur leur objet, jamais détachées (`this`). */
export function lireEtatLigne(s: SourcesEtatLigne, tenantId: string): Promise<EtatLigne> {
  return etatLigneCredit({
    offre: (t) => s.option.offre(t), formulePayee: (t) => s.option.formulePayee(t), lignes: (t) => s.vue.lignes(t),
    option: (t) => s.option.options.vivante(t),
  }, tenantId);
}

/**
 * TOUS LES NUMÉROS VIVANTS DE L'ESPACE GARDENT L'APPLICATION WHATSAPP BUSINESS (spec, décision 8) : aucun ne passera sur
 * la ligne, et l'écran de paiement de l'option le dit. Faux sans numéro : l'option sert alors à en connecter un ; un
 * numéro délié ne compte plus.
 */
export function tousGardentLApplication(numeros: ReadonlyArray<{ coexistence: boolean; delie: boolean }>): boolean {
  const vivants = numeros.filter((n) => !n.delie);
  return vivants.length > 0 && vivants.every((n) => n.coexistence);
}

/**
 * L'ARRÊT DES LIGNES DE L'ESPACE (lot C, moment 3) : toutes arrêtées (plus rien ne part, quel que soit le solde, qui reste),
 * et par l'option dès qu'une d'elles en vient (la sortie : reprendre l'option, ou sa carte chez Meta ; des lignes posées
 * à la main seules se redemandent au Support). L'onglet de la console et `get_credit` le lisent ici.
 */
export function arretDesLignes(
  lignes: ReadonlyArray<{ origine: 'ops' | 'option'; arreteeLe: Date | string | null }>,
): { toutes: boolean; parLOption: boolean } {
  const toutes = lignes.length > 0 && lignes.every((l) => l.arreteeLe !== null);
  return { toutes, parLOption: toutes && lignes.some((l) => l.origine === 'option') };
}

export async function etatLigneCredit(d: DepsEtatLigne, tenantId: string): Promise<EtatLigne> {
  const offre = await d.offre(tenantId);
  if (offre === 'base') return 'free';
  // Une ligne posée dit l'état, quelle que soit la formule : une Entreprise ou un espace dont l'option a fini y restent.
  const lignes = await d.lignes(tenantId);
  if (lignes.length > 0) return lignes.some((l) => l.arreteeLe === null) ? 'active' : 'arretee';
  if (offre === 'entreprise') return 'a_prendre';
  // Une option payée attend sa ligne, la formule payée ou non : un Pro passé en retard ne la remet pas à l'essai (jaune 5
  // de la relecture du lot B).
  const option = await d.option(tenantId);
  if (option !== null && option.places > 0 && option.statut !== 'resilie') return 'en_attente';
  return (await d.formulePayee(tenantId)) ? 'a_prendre' : 'essai';
}
