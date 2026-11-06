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

export async function etatLigneCredit(d: DepsEtatLigne, tenantId: string): Promise<EtatLigne> {
  const offre = await d.offre(tenantId);
  if (offre === 'base') return 'free';
  // Une ligne posée dit l'état, quelle que soit la formule : une Entreprise ou un espace dont l'option a fini y restent.
  const lignes = await d.lignes(tenantId);
  if (lignes.length > 0) return lignes.some((l) => l.arreteeLe === null) ? 'active' : 'arretee';
  if (offre === 'entreprise') return 'a_prendre';
  if (!(await d.formulePayee(tenantId))) return 'essai';
  const option = await d.option(tenantId);
  return option !== null && option.places > 0 && option.statut !== 'resilie' ? 'en_attente' : 'a_prendre';
}
