import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * LE LIEN VERS UNE PIÈCE REÇUE PAR UN BLOC QUESTION (spec `docs/superpowers/specs/2026-11-02-question-fichier-champ-design.md`).
 * Il ouvre le fichier (une pièce d'identité, par exemple) à quiconque le tient : il n'est fabriqué qu'au moment où un
 * bloc Appel API de scénario part, n'existe que dans cet appel, et ne vaut que quinze minutes.
 *
 * Le jeton : `<espace>.<message de Meta en base64url>.<échéance en millisecondes, base 36>.<signature>`, la signature
 * étant un HMAC SHA-256 des trois premiers morceaux avec un secret dérivé de `AUTH_SECRET` pour ce seul usage (un
 * jeton de pièce ne vaut jamais une session, ni un lien de désinscription, ni l'inverse). Modèle :
 * `src/emails-produit/desinscription.ts`.
 */

const USAGE = 'question:piece:v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Un identifiant de message de Meta tient en 200 caractères (borne de `pieces_question`) : 270 en base64url. */
const MESSAGE_B64 = /^[A-Za-z0-9_-]{1,270}$/;
const ECHEANCE_B36 = /^[0-9a-z]{1,12}$/;

/** Quinze minutes (décision de Julien) : le stockage télécharge dans la foulée de l'appel, au-delà le lien n'expose rien. */
export const DUREE_LIEN_PIECE_MS = 15 * 60_000;

function cleDerivee(secret: string): Buffer {
  return createHmac('sha256', secret).update(USAGE, 'utf8').digest();
}

function signature(charge: string, secret: string): Buffer {
  return createHmac('sha256', cleDerivee(secret)).update(charge, 'utf8').digest();
}

/** Le jeton d'une pièce jusqu'à `expireLe`. Un secret vide est refusé : il signerait avec une clé connue de tous. */
export function jetonPiece(tenantId: string, metaMessageId: string, expireLe: Date, secret: string): string {
  if (!secret) throw new Error('piece : secret absent');
  const charge = `${tenantId.toLowerCase()}.${Buffer.from(metaMessageId, 'utf8').toString('base64url')}.${expireLe.getTime().toString(36)}`;
  return `${charge}.${signature(charge, secret).toString('base64url')}`;
}

/**
 * Ce qu'un jeton désigne, ou `null` : mal formé, mal signé, échu, ou secret absent. Temps constant sur la signature ;
 * l'échéance se lit APRÈS elle, pour qu'un jeton forgé ne dise même pas s'il serait échu.
 */
export function lireJetonPiece(jeton: string, secret: string, maintenant: Date): { tenantId: string; metaMessageId: string } | null {
  if (!secret || typeof jeton !== 'string' || jeton.length > 400) return null;
  const morceaux = jeton.split('.');
  if (morceaux.length !== 4) return null;
  const [tenantId, message, echeance, sig] = morceaux as [string, string, string, string];
  if (!UUID.test(tenantId) || !MESSAGE_B64.test(message) || !ECHEANCE_B36.test(echeance)) return null;
  const attendue = signature(`${tenantId}.${message}.${echeance}`, secret);
  const recue = Buffer.from(sig, 'base64url');
  if (recue.length !== attendue.length || !timingSafeEqual(recue, attendue)) return null;
  if (!(maintenant.getTime() < parseInt(echeance, 36))) return null;
  const metaMessageId = Buffer.from(message, 'base64url').toString('utf8');
  return metaMessageId === '' ? null : { tenantId: tenantId.toLowerCase(), metaMessageId };
}

/** L'adresse publique du lien, servie par l'API (`/f/:jeton`). */
export function lienPiece(baseApi: string, jeton: string): string {
  return `${baseApi.trim().replace(/\/+$/, '')}/f/${encodeURIComponent(jeton)}`;
}
