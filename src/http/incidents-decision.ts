import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { journaliser } from '../lib/journal';

/**
 * LA DÉCISION DE JULIEN SUR UN INCIDENT, PRISE DANS TELEGRAM (plan 2026-11-21, lot 4).
 *
 * Le rapport d'une issue 2 part avec trois boutons (`incidents-rapport.ts`). Un clic arrive ici comme une mise à jour
 * Telegram (`callback_query`), poussée par le webhook du bot. La route inscrit la décision sur l'incident, puis
 * réveille la tâche cloud, qui l'exécute (approuver va jusqu'au déploiement, que GitHub fait encore approuver).
 *
 * 🔴 DEUX VERROUS, DANS CET ORDRE, AVANT TOUTE LECTURE. Le jeton secret que Telegram renvoie dans
 * `X-Telegram-Bot-Api-Secret-Token` (posé à la déclaration du webhook) : sans lui, n'importe qui posterait une fausse
 * mise à jour. Puis l'AUTEUR du clic : seul l'utilisateur de `TELEGRAM_CHAT_ID` décide ; un clic d'ailleurs (le bot
 * transféré dans un groupe, par exemple) est ignoré. Une décision ne s'inscrit qu'une fois : un double clic ne réveille
 * pas deux fois la tâche.
 *
 * Telegram attend un 200 rapide et rejoue sinon : toute mise à jour reconnue ou non rend 200, seul un jeton faux rend
 * 401.
 */

export const CHEMIN_TELEGRAM = '/internes/telegram/webhook';

export type Decision = 'approuve' | 'refuse' | 'plus_tard';

const MiseAJour = z.object({
  callback_query: z.object({
    id: z.string().max(200),
    from: z.object({ id: z.number().int() }),
    data: z.string().max(64).optional(),
  }).optional(),
});

const DONNEE = /^incident:(\d{1,15}):(approuve|refuse|plus_tard)$/;

export interface IncidentsDecisionRouteDeps {
  /** `TELEGRAM_WEBHOOK_SECRET`. Vide : la route n'est pas montée. */
  secret: string;
  /** L'utilisateur qui décide : `TELEGRAM_CHAT_ID` (dans une conversation privée, c'est son identifiant). */
  auteur: string;
  incidents: {
    /** Inscrit la décision si l'incident attend la sienne ; `false` s'il est inconnu ou déjà décidé. */
    decider(id: number, decision: Decision): Promise<boolean>;
  };
  /** Réveille la tâche cloud (`incidents-declencheur.ts`). */
  declencher(charge: Record<string, unknown>): void;
  /** Répond au clic (le bouton cesse de tourner) et confirme dans la conversation. Ne lève jamais. */
  accuser(callbackId: string, texte: string): Promise<void>;
}

function secretValide(entete: string | string[] | undefined, attendu: string): boolean {
  const valeur = Array.isArray(entete) ? entete[0] : entete;
  if (!valeur || attendu === '') return false;
  const a = Buffer.from(valeur);
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LIBELLES: Record<Decision, string> = { approuve: 'approuvé', refuse: 'refusé', plus_tard: 'remis à plus tard' };

export function registerIncidentsDecision(app: FastifyInstance, deps: IncidentsDecisionRouteDeps): void {
  app.post(CHEMIN_TELEGRAM, {
    preHandler: async (req, reply) => {
      if (!secretValide(req.headers['x-telegram-bot-api-secret-token'], deps.secret)) return reply.code(401).send({ error: 'jeton invalide' });
    },
  }, async (req, reply) => {
    const lu = MiseAJour.safeParse(req.body);
    const clic = lu.success ? lu.data.callback_query : undefined;
    if (!clic) return reply.code(200).send({ ok: true });
    if (String(clic.from.id) !== deps.auteur) {
      journaliser('warn', 'incident_decision_auteur_refuse', { auteur: clic.from.id });
      return reply.code(200).send({ ok: true });
    }
    const m = DONNEE.exec(clic.data ?? '');
    if (!m) return reply.code(200).send({ ok: true });
    const id = Number(m[1]);
    const decision = m[2] as Decision;
    const inscrite = await deps.incidents.decider(id, decision);
    if (inscrite) deps.declencher({ type: 'decision', id, decision });
    await deps.accuser(clic.id, inscrite ? `Incident ${id} : ${LIBELLES[decision]}.` : `Incident ${id} : déjà décidé, rien de plus.`);
    return reply.code(200).send({ ok: true });
  });
}
