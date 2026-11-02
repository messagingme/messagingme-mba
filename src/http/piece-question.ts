import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DepotConversationsV1 } from '../api/conversations-v1';
import type { V1ConversationsRouteDeps } from './v1-conversations';
import type { RateLimiter } from '../auth/rate-limit';
import { MediaExpire, enTetesMedia } from '../inbox/media-entrant';
import { MediaTropGros } from '../meta/media';
import { journaliser } from '../lib/journal';

/**
 * LE FICHIER D'UNE PIÈCE REÇUE PAR UN BLOC QUESTION (spec `docs/superpowers/specs/2026-11-02-question-fichier-champ-design.md`),
 * classe `code-url` : le jeton signé de l'adresse autorise (`src/workflow/piece-lien.ts`), fabriqué par un bloc Appel
 * API de scénario au moment où il part, et il n'ouvre qu'UNE pièce d'UN espace pendant quinze minutes.
 *
 * 🔴 La pièce est souvent une pièce d'identité. Un jeton faux, échu ou d'un autre espace rend le MÊME 404 : la route ne
 * dit pas lequel des trois il est, ne lit rien chez Meta et ne trace rien. Le fichier se relit dans l'espace du jeton,
 * par le même chemin que l'Inbox et l'API (`lireMediaMessage`), avec les mêmes en-têtes (`nosniff`, `no-store`,
 * `attachment` hors des images affichables). Toujours un 4xx, jamais un 5xx : Cloudflare remplacerait le corps.
 */
export interface PieceQuestionRouteDeps {
  /**
   * Ce qu'un jeton désigne, `null` s'il est mal formé, mal signé ou échu : `lireJetonPiece` avec `AUTH_SECRET` en
   * production. Une dépendance et pas un secret : c'est elle que la sonde 11 de l'auto-attaque doit atteindre.
   */
  lire(jeton: string): { tenantId: string; metaMessageId: string } | null | Promise<{ tenantId: string; metaMessageId: string } | null>;
  /** 🔴 Le message, relu dans l'espace du jeton : c'est là que se joue l'isolation entre clients. */
  conversations: Pick<DepotConversationsV1, 'message'>;
  lireMediaMessage: V1ConversationsRouteDeps['lireMediaMessage'];
  /** La trace d'un téléchargement, visible par l'admin de l'espace. Best-effort : elle n'empêche jamais l'envoi. */
  tracer(tenantId: string, idInterne: string): Promise<void>;
  /**
   * Le plafond PAR PIÈCE (l'espace et le message du jeton), compté après la lecture du jeton : un lien valide ne doit
   * pas faire télécharger Meta en boucle. Jamais par `req.ip`, qui désigne le proxy (le serveur n'a pas `trustProxy`) :
   * un tel plafond serait global, et des jetons faux en rafale bloqueraient les liens valides de tous les clients.
   */
  limiteur: RateLimiter;
}

const INVALIDE = { error: 'ce lien n’est pas valide, ou il a expiré', code: 'lien_invalide' } as const;

export function registerPieceQuestion(app: FastifyInstance, deps: PieceQuestionRouteDeps): void {
  const refuser = (reply: FastifyReply, statut: number, code: string, error: string): FastifyReply =>
    reply.code(statut).header('cache-control', 'no-store').send({ error, code });

  app.get('/f/:code', async (req, reply) => {
    const lu = await deps.lire(String((req.params as { code?: unknown }).code ?? ''));
    if (lu === null) return reply.code(404).header('cache-control', 'no-store').send(INVALIDE);
    if (!deps.limiteur.take(`${lu.tenantId}:${lu.metaMessageId}`)) {
      return refuser(reply, 429, 'trop_de_demandes', 'trop de téléchargements de cette pièce : réessayez dans une minute');
    }
    // 🔴 Dans un `try` : une panne ici remonterait au gestionnaire global, qui répond 500 et journalise `req.url`, donc
    // le jeton vivant (relecture du lot). Le journal ne porte que l'espace.
    let m: Awaited<ReturnType<PieceQuestionRouteDeps['conversations']['message']>>;
    try {
      m = await deps.conversations.message(lu.tenantId, lu.metaMessageId);
    } catch (err) {
      journaliser('error', 'piece_question_message_illisible', { err, tenantId: lu.tenantId });
      return refuser(reply, 422, 'media_unavailable', 'ce fichier ne peut pas être lu pour l’instant : réessayez dans un instant');
    }
    if (!m || m.media === null) return reply.code(404).header('cache-control', 'no-store').send(INVALIDE);
    if (m.media.expired) return refuser(reply, 410, 'media_expired', 'Meta ne garde un fichier reçu que 7 jours : celui-ci n’existe plus');
    let fichier: Awaited<ReturnType<PieceQuestionRouteDeps['lireMediaMessage']>>;
    try {
      fichier = await deps.lireMediaMessage(lu.tenantId, m.idInterne, m.conversationId);
    } catch (err) {
      if (err instanceof MediaExpire) return refuser(reply, 410, 'media_expired', err.message);
      if (err instanceof MediaTropGros) {
        return refuser(reply, 422, 'media_unavailable', `fichier trop lourd (${Math.round(err.octets / 1024 / 1024)} Mo, maximum ${Math.round(err.plafond / 1024 / 1024)} Mo)`);
      }
      journaliser('error', 'piece_question_illisible', { err, tenantId: lu.tenantId, messageId: m.idInterne });
      return refuser(reply, 422, 'media_unavailable', 'Meta n’a pas rendu ce fichier : réessayez dans un instant');
    }
    if (!fichier) return reply.code(404).header('cache-control', 'no-store').send(INVALIDE);
    await deps.tracer(lu.tenantId, m.idInterne).catch((err: unknown) => {
      journaliser('error', 'piece_question_trace_impossible', { err, tenantId: lu.tenantId, messageId: m.idInterne });
    });
    return reply.headers(enTetesMedia(fichier.mime, fichier.nom ?? null, `piece-${m.idInterne.slice(0, 8)}`)).send(fichier.bytes);
  });
}
