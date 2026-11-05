import type { PoolConfig } from 'pg';

/**
 * LA SONDE TCP DE CHAQUE CONNEXION À LA BASE : toutes les 60 s de silence, le noyau vérifie que l'autre bout répond.
 * Une connexion coupée d'un seul côté se voit alors en erreur, et son propriétaire la rouvre ; sans sonde, une connexion
 * qui ne fait qu'attendre reste « établie » côté client pour toujours. Vécu le 2026-11-05 : l'écouteur LISTEN du
 * worker principal avait disparu de la base pendant la nuit, le worker le croyait ouvert, et chaque message entrant
 * attendait le filet de 5 s au lieu de son réveil (`FILETS_NOTIFIES`, `src/queue/names.ts`). pg-boss ne rouvre son
 * écouteur que sur une erreur ; c'est la sonde qui la produit.
 *
 * Posée sur les pools de l'application (`src/db/pool.ts`) et sur les connexions propres de pg-boss, écouteur compris
 * (`src/queue/pgboss.ts`). Module sans effet de bord : `pool.ts` ouvre des pools à son chargement.
 */
export const SONDE_TCP = {
  keepAlive: true,
  keepAliveInitialDelayMillis: 60_000,
} satisfies PoolConfig;
