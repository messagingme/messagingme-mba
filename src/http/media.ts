import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Guard } from '../auth/middleware';
import { codeDeMediatheque } from '../meta/template-media';
import { espaceVerifie } from './scope';

export interface MediaRouteDeps {
  /** Dépose un en-tête de modèle pour CET espace et rend son `header_handle` (voir `deposerEntete`, `src/api/creer-modele.ts`). */
  uploadImage(bytes: Buffer, mime: string, tenantId: string): Promise<string>;
  /**
   * Un fichier de la médiathèque DE CET ESPACE par son code (`PgRcsMediaStore.lireDeLEspace`) : `null` pour un code
   * inconnu ou d'un autre espace. L'en-tête d'un modèle choisi dans la médiathèque (2026-11-13) se lit ici, jamais par
   * un téléchargement de son adresse.
   */
  lireMediatheque(tenantId: string, code: string): Promise<{ bytes: Buffer; mime: string; nom: string | null } | null>;
}

// Média accepté pour un en-tête (carousel = image ; en-tête simple = image, vidéo ou document PDF, ce dernier pour le
// modèle dont l'en-tête vient de la fiche, plan du 2026-11-12, lot B3b). Data URL base64.
const DATA_URL_RE = /^data:(image\/(?:png|jpeg)|video\/mp4|application\/pdf);base64,([A-Za-z0-9+/=]+)$/;
const IMG_MAX = 5 * 1024 * 1024; // 5 Mo (limite en-tête image Meta ; le front redimensionne avant)
const VIDEO_MAX = 16 * 1024 * 1024; // 16 Mo (limite en-tête vidéo Meta)
const DOCUMENT_MAX = 16 * 1024 * 1024; // 16 Mo (notre plafond, celui des documents de `PLAFONDS_ENTETE`)

/** Les types qu'un format d'en-tête accepte chez Meta : un GIF de la médiathèque n'est pas une image d'en-tête. */
const TYPES_DU_FORMAT = {
  IMAGE: ['image/jpeg', 'image/png'],
  VIDEO: ['video/mp4'],
  DOCUMENT: ['application/pdf'],
} as const satisfies Record<string, readonly string[]>;
const ATTENDU_DU_FORMAT: Record<keyof typeof TYPES_DU_FORMAT, string> = {
  IMAGE: 'une image JPEG ou PNG',
  VIDEO: 'une vidéo MP4',
  DOCUMENT: 'un document PDF',
};

/** L'en-tête choisi dans la médiathèque : son adresse (celle que la liste de la médiathèque rend) et le format visé. */
const saisieMediatheque = z.object({
  mediatheque: z.string().trim().min(1).max(2000),
  format: z.enum(['IMAGE', 'VIDEO', 'DOCUMENT']),
}).strict();

/** Ce qui se juge sur les octets, quelle que soit leur provenance : le poids, et la signature d'un PDF. */
function refusDesOctets(bytes: Buffer, mime: string): string | null {
  if (bytes.length === 0) return 'média vide';
  const max = mime.startsWith('video/') ? VIDEO_MAX : mime === 'application/pdf' ? DOCUMENT_MAX : IMG_MAX;
  if (bytes.length > max) return `média trop lourd (max ${Math.round(max / 1024 / 1024)} Mo)`;
  // Un PDF se juge sur ses OCTETS, jamais sur le type annoncé : c'est un fichier déposé chez Meta sous l'identité du client.
  if (mime === 'application/pdf' && bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return 'le fichier n’est pas un document PDF';
  return null;
}

/**
 * Upload média (admin) : image (carousel, en-tête simple) ou vidéo mp4 (en-tête simple), reçue en data URL
 * base64, validée (type, poids), rend le handle Meta. bodyLimit élevé : le base64 ajoute 33 % (~22 Mo pour 16 Mo).
 *
 * Ou un fichier DÉJÀ dans la médiathèque de l'espace (`{ mediatheque, format }`, demande de Julien du 2026-11-13) : lu
 * dans CET espace par son code (une adresse d'un autre espace, ou qui n'est pas de la médiathèque, est refusée), son type
 * confronté au format de l'en-tête, puis déposé chez Meta comme un fichier du poste.
 */
export function registerMedia(app: FastifyInstance, deps: MediaRouteDeps, garde: Guard): void {
  const opts = { preHandler: garde, bodyLimit: 24 * 1024 * 1024 };

  app.post('/tenants/:tenantId/media', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    // Le corps vient d'un navigateur : lu par Zod, jamais par un `as`. Seule la PRÉSENCE de `mediatheque` choisit la voie.
    const corps = z.record(z.string(), z.unknown()).safeParse(req.body);
    if (!corps.success) return reply.code(400).send({ error: 'dataUrl requis' });

    if ('mediatheque' in corps.data) {
      const lu = saisieMediatheque.safeParse(corps.data);
      if (!lu.success) return reply.code(400).send({ error: 'mediatheque (adresse) et format (IMAGE, VIDEO ou DOCUMENT) requis' });
      const code = codeDeMediatheque(lu.data.mediatheque);
      if (code === null) return reply.code(400).send({ error: 'cette adresse n’est pas celle d’un fichier de la médiathèque' });
      const fichier = await deps.lireMediatheque(tenant, code);
      if (fichier === null) return reply.code(404).send({ error: 'ce fichier n’est pas dans la médiathèque de cet espace' });
      const { format } = lu.data;
      if (!(TYPES_DU_FORMAT[format] as readonly string[]).includes(fichier.mime)) {
        return reply.code(400).send({ error: `cet en-tête attend ${ATTENDU_DU_FORMAT[format]}` });
      }
      const refus = refusDesOctets(fichier.bytes, fichier.mime);
      if (refus) return reply.code(400).send({ error: refus });
      const handle = await deps.uploadImage(fichier.bytes, fichier.mime, tenant);
      return reply.code(200).send({ handle, nom: fichier.nom });
    }

    const dataUrl = corps.data.dataUrl;
    if (typeof dataUrl !== 'string') return reply.code(400).send({ error: 'dataUrl requis' });
    const m = DATA_URL_RE.exec(dataUrl);
    if (!m) return reply.code(400).send({ error: 'média invalide (data URL base64 image/png, image/jpeg, video/mp4 ou application/pdf attendu)' });

    const mime = m[1]!;
    const bytes = Buffer.from(m[2]!, 'base64');
    const refus = refusDesOctets(bytes, mime);
    if (refus) return reply.code(400).send({ error: refus });

    const handle = await deps.uploadImage(bytes, mime, tenant);
    return reply.code(200).send({ handle });
  });
}
