import type { FastifyInstance } from 'fastify';
import type { Guard } from '../auth/middleware';
import { espaceVerifie } from './scope';

export interface MediaRouteDeps {
  /** Dépose un en-tête de modèle pour CET espace et rend son `header_handle` (voir `deposerEntete`, `src/api/creer-modele.ts`). */
  uploadImage(bytes: Buffer, mime: string, tenantId: string): Promise<string>;
}

// Média accepté pour un en-tête (carousel = image ; en-tête simple = image, vidéo ou document PDF, ce dernier pour le
// modèle dont l'en-tête vient de la fiche, plan du 2026-11-12, lot B3b). Data URL base64.
const DATA_URL_RE = /^data:(image\/(?:png|jpeg)|video\/mp4|application\/pdf);base64,([A-Za-z0-9+/=]+)$/;
const IMG_MAX = 5 * 1024 * 1024; // 5 Mo (limite en-tête image Meta ; le front redimensionne avant)
const VIDEO_MAX = 16 * 1024 * 1024; // 16 Mo (limite en-tête vidéo Meta)
const DOCUMENT_MAX = 16 * 1024 * 1024; // 16 Mo (notre plafond, celui des documents de `PLAFONDS_ENTETE`)

/**
 * Upload média (admin) : image (carousel, en-tête simple) ou vidéo mp4 (en-tête simple), reçue en data URL
 * base64, validée (type, poids), rend le handle Meta. bodyLimit élevé : le base64 ajoute 33 % (~22 Mo pour 16 Mo).
 */
export function registerMedia(app: FastifyInstance, deps: MediaRouteDeps, garde: Guard): void {
  const opts = { preHandler: garde, bodyLimit: 24 * 1024 * 1024 };

  app.post('/tenants/:tenantId/media', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);

    const dataUrl = (req.body as { dataUrl?: unknown } | null)?.dataUrl;
    if (typeof dataUrl !== 'string') return reply.code(400).send({ error: 'dataUrl requis' });
    const m = DATA_URL_RE.exec(dataUrl);
    if (!m) return reply.code(400).send({ error: 'média invalide (data URL base64 image/png, image/jpeg, video/mp4 ou application/pdf attendu)' });

    const mime = m[1]!;
    const bytes = Buffer.from(m[2]!, 'base64');
    if (bytes.length === 0) return reply.code(400).send({ error: 'média vide' });
    const max = mime.startsWith('video/') ? VIDEO_MAX : mime === 'application/pdf' ? DOCUMENT_MAX : IMG_MAX;
    if (bytes.length > max) return reply.code(400).send({ error: `média trop lourd (max ${Math.round(max / 1024 / 1024)} Mo)` });
    // Un PDF se juge sur ses OCTETS, jamais sur le type annoncé : c'est un fichier déposé chez Meta sous l'identité du client.
    if (mime === 'application/pdf' && bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return reply.code(400).send({ error: 'le fichier n’est pas un document PDF' });
    }

    const handle = await deps.uploadImage(bytes, mime, tenant);
    return reply.code(200).send({ handle });
  });
}
