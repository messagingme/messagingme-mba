import type { Pool } from 'pg';
import { microEurosDepuisDollars } from '../agent/devise';

/**
 * Ce que nous acceptons de dépenser, par espace et par mois, pour les deux assistants de configuration et le bot
 * d'aide : une seule enveloppe pour les trois (décision de Julien du 2026-11-17).
 *
 * 🔴 C'est notre argent, pas le crédit du client : ils passent par la clé maison (facturer l'apprentissage du
 * produit se retournerait contre nous). D'où un plafond par espace. Le plafond d'équipe
 * Vercel n'est pas ce garde-fou : il couperait tous les projets du Gateway, bots clients en production compris.
 * Règle pure, IO seulement dans le store.
 */

/** Le premier jour du mois, en UTC, au format que la colonne `date` accepte. */
export function moisDe(maintenant: Date): string {
  const a = maintenant.getUTCFullYear();
  const m = String(maintenant.getUTCMonth() + 1).padStart(2, '0');
  return `${a}-${m}-01`;
}

/**
 * Ce qui reste, en micro-euros. `Infinity` quand le plafond est désactivé : 0 désactive, levier d'urgence si un
 * mauvais calibrage coupait l'assistant de tous les clients.
 */
export function resteDuBudget(depenseMicroEur: number, plafondEuros: number): number {
  if (!Number.isFinite(plafondEuros) || plafondEuros <= 0) return Infinity;
  return Math.max(0, Math.round(plafondEuros * 1_000_000) - Math.max(0, depenseMicroEur));
}

export interface DepenseStore {
  lire(tenantId: string, mois: string): Promise<number>;
  /** Ajoute au compteur ; un montant négatif rend une réservation trop haute, sans jamais descendre sous zéro. */
  ajouter(tenantId: string, mois: string, microEuros: number): Promise<void>;
  /**
   * Réserve `microEuros` si la dépense du mois, réservations en vol comprises, est encore sous `plafondMicro`.
   * 🔴 Vérifier et inscrire en UNE écriture : lire puis noter après l'appel laissait passer autant de tours
   * simultanés qu'il en arrivait avant la première réponse (mesuré : vingt au lieu d'un, passage 2 de l'audit).
   */
  reserver(tenantId: string, mois: string, microEuros: number, plafondMicro: number): Promise<boolean>;
}

export interface BudgetAssistantDeps {
  depenses: DepenseStore;
  /** 0 désactive le plafond. */
  plafondEuros: number;
  tauxEurParDollar: number;
}

/**
 * Ce qu'un appel réserve avant de partir : une borne haute d'un tour (un tour d'entretien se chiffre en centimes
 * d'euro, une question d'aide en dixièmes de centime). Elle ne change rien pour qui travaille seul, la réservation
 * étant remplacée par le coût réel dès la réponse ; elle borne ce que des appels simultanés peuvent engager.
 */
export const RESERVATION_MICRO_EUR = 50_000;

/** Ce qu'un appel a réservé, à solder après lui sur le même mois, même s'il se termine le mois suivant. */
export interface Reservation {
  mois: string;
  microEuros: number;
}

/**
 * Réserve l'enveloppe mensuelle commune aux appels exécutés sur notre clé pour un espace (les deux assistants de
 * configuration et le bot d'aide). `null` : le plafond est atteint, l'appel ne part pas. Plafond désactivé : une
 * réservation nulle, la dépense réelle reste comptée au solde.
 */
export async function reserverBudget(deps: BudgetAssistantDeps, tenantId: string): Promise<Reservation | null> {
  const mois = moisDe(new Date());
  if (resteDuBudget(0, deps.plafondEuros) === Infinity) return { mois, microEuros: 0 };
  const plafondMicro = Math.round(deps.plafondEuros * 1_000_000);
  return (await deps.depenses.reserver(tenantId, mois, RESERVATION_MICRO_EUR, plafondMicro))
    ? { mois, microEuros: RESERVATION_MICRO_EUR }
    : null;
}

/**
 * Remplace la réservation par le coût réel de l'appel, y compris si sa réponse se révèle inutilisable (l'appel a eu
 * lieu, il est payé). 0 quand l'appel a levé sans rien rendre. 🔴 Toute réservation se solde, sur chaque sortie :
 * oubliée, elle reste comptée jusqu'à la fin du mois et ferme l'enveloppe plus tôt.
 */
export async function solderReservation(
  deps: BudgetAssistantDeps,
  tenantId: string,
  reservation: Reservation,
  coutDollars: number,
): Promise<void> {
  const reel = microEurosDepuisDollars(coutDollars, deps.tauxEurParDollar);
  await deps.depenses.ajouter(tenantId, reservation.mois, reel - reservation.microEuros);
}

export class PgDepenseStore implements DepenseStore {
  constructor(private readonly pool: Pool) {}

  async lire(tenantId: string, mois: string): Promise<number> {
    const r = await this.pool.query<{ micro_euros: string }>(
      `select micro_euros from assistant_depense_mois where tenant_id = $1 and mois = $2::date`,
      [tenantId, mois],
    );
    return r.rows[0] ? Number(r.rows[0].micro_euros) : 0;
  }

  async ajouter(tenantId: string, mois: string, microEuros: number): Promise<void> {
    const montant = Math.round(microEuros);
    if (montant === 0) return;
    // L'upsert rend l'incrément sûr sans verrou applicatif : deux tours simultanés s'additionnent sous le verrou de
    // ligne, là où « lire puis écrire » en perdrait un. `greatest` : un solde négatif ne fait jamais passer le
    // compteur sous zéro. 🔴 La mise à jour ajoute `$3`, jamais `excluded.micro_euros` : `excluded` est la ligne
    // proposée, donc déjà bornée à zéro, et un solde négatif n'aurait jamais rien rendu.
    await this.pool.query(
      `insert into assistant_depense_mois (tenant_id, mois, micro_euros) values ($1, $2::date, greatest(0, $3::bigint))
       on conflict (tenant_id, mois) do update
         set micro_euros = greatest(0, assistant_depense_mois.micro_euros + $3::bigint)`,
      [tenantId, mois, montant],
    );
  }

  async reserver(tenantId: string, mois: string, microEuros: number, plafondMicro: number): Promise<boolean> {
    // Le `where` d'un `on conflict do update` se relit sous le verrou de la ligne, sur sa dernière version : deux
    // réservations simultanées se sérialisent, la seconde voit la première. Sans ligne, l'insertion passe (zéro est
    // sous tout plafond positif).
    const r = await this.pool.query(
      `insert into assistant_depense_mois (tenant_id, mois, micro_euros) values ($1, $2::date, $3)
       on conflict (tenant_id, mois) do update
         set micro_euros = assistant_depense_mois.micro_euros + excluded.micro_euros
         where assistant_depense_mois.micro_euros < $4
       returning micro_euros`,
      [tenantId, mois, Math.round(microEuros), Math.round(plafondMicro)],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

/**
 * Le message rendu quand le plafond est atteint : il dit la vérité (une limite voulue, pas une panne) puis rassure
 * (les onglets restent utilisables).
 */
export const MESSAGE_PLAFOND = 'Je ne peux plus vous répondre jusqu’au mois prochain. '
  + 'Tout reste modifiable dans les onglets, comme d’habitude.';
