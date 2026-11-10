import type { NatureIa } from '../agent/natures-credit';

/**
 * TOUT CE QUE L'IA A COÛTÉ AU CLIENT sur la période (plan `docs/superpowers/plans/2026-11-10-cout-ia-et-mba.md`).
 *
 * - `coutMicroEur` : ce qui a été DÉBITÉ de son crédit, lu au journal (`agent_credit_mouvements`) : tours d'agent,
 *   essais, connaissance, transcription, traduction (`parNature`), débits d'une Entreprise illimitée compris. Ce que
 *   MessagingMe absorbe sur sa propre clé (bot d'aide, assistants de configuration) n'est pas au journal du client.
 * - `mba` : le Meta Business Agent, ESTIMÉ (messages écrits × prix public de Meta, converti en euros). Meta le
 *   facture au client directement ; aucune API ne nous rend son coût tant que la permission `business_management`
 *   n'est pas accordée (lot B). 🔴 Il reste HORS de `coutMicroEur` : un chiffre estimé ne se mêle jamais sans le dire
 *   à un chiffre débité.
 * - `tours`, `sessions`, jetons : le détail des sessions d'agent (`agent_sessions`), comme avant.
 *
 * 🔴 Tout est en micro-euros, sans arrondi : un arrondi côté serveur ferait diverger le total de la somme de ses
 * parts. La conversion en euros est un geste d'affichage.
 */

/** Le MBA estimé : `null` quand l'espace n'a écrit aucun message par le MBA sur la période. */
export interface EstimationMba {
  messages: number;
  estimeMinMicroEur: number;
  estimeMaxMicroEur: number;
}

/** Un tour d'agent, tel que l'accordéon de la carte le montre. */
export interface TourIa {
  id: string;
  agentId: string;
  /** Nombre d'allers-retours avec le modèle dans cette session. */
  tours: number;
  tokensEntree: number;
  tokensSortie: number;
  coutMicroEur: number;
  /** Instant ISO du début de la session. */
  at: string;
}

export interface CoutIa {
  /** Le total débité du crédit sur la période, égal à la somme de `parNature`. */
  coutMicroEur: number;
  /** Le total débité, par nature (`src/agent/natures-credit.ts`). Chaque nature est présente, à zéro au besoin. */
  parNature: Record<NatureIa, number>;
  /** Le MBA, estimé et hors du total débité. */
  mba: EstimationMba | null;
  tokensEntree: number;
  tokensSortie: number;
  /** Nombre de sessions d'agent sur la période. Zéro est un état normal, pas une panne. */
  sessions: number;
  tours: TourIa[];
  /** La liste est plafonnée et le dit : une troncature muette se lit comme un inventaire complet. */
  tronque: boolean;
}

/**
 * Combien de tours l'accordéon montre au plus : la plage va jusqu'à 366 jours, un espace actif y porterait des
 * milliers de tours. Le SQL en demande un de plus pour savoir qu'il tronque.
 */
export const PLAFOND_TOURS_IA = 50;
