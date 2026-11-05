import { z } from 'zod';
import { journaliser } from '../lib/journal';

/**
 * LE DÉFI ANTI-ROBOT DE CLOUDFLARE (Turnstile), vérifié par l'API avant qu'une demande d'inscription n'écrive en base
 * ou n'envoie un e-mail (lot identité B, décision de Julien du 2026-11-05). La console pose le widget et envoie son
 * jeton ; seul ce serveur, avec la clé secrète, sait s'il est valable.
 *
 * 🔴 ÉCHEC FERMÉ : un jeton absent, refusé, une réponse illisible, une panne ou un délai dépassé de Cloudflare rendent
 * `false`. L'inscription par e-mail se ferme alors le temps de la panne, Google reste ouvert. Le jeton ne sert qu'une
 * fois, chez Cloudflare.
 *
 * Clé secrète absente (`TURNSTILE_SECRET_KEY` vide) : pas de vérificateur du tout, donc pas de défi, ce que le
 * démarrage dit dans le journal. L'ordre de pose est dans `DEPLOY.md` : la clé du site dans la console d'abord, la clé
 * secrète ensuite, sinon chaque demande arriverait sans jeton et serait refusée.
 */
export interface VerificateurTurnstile {
  verifier(jeton: string, ip: string | null): Promise<boolean>;
}

export const URL_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Un jeton Turnstile fait au plus 2 048 caractères (documentation de Cloudflare). */
export const LONGUEUR_MAX_JETON_TURNSTILE = 2048;
const DELAI_MS = 3_000;

const reponseSchema = z.object({ success: z.boolean() }).loose();

type FetchTurnstile = (url: string, init: { method: 'POST'; body: URLSearchParams; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function creerVerificateurTurnstile(secret: string, fetchImpl: FetchTurnstile = fetch as unknown as FetchTurnstile): VerificateurTurnstile {
  return {
    async verifier(jeton, ip) {
      if (jeton === '' || jeton.length > LONGUEUR_MAX_JETON_TURNSTILE) return false;
      const corps = new URLSearchParams({ secret, response: jeton });
      if (ip) corps.set('remoteip', ip);
      try {
        const res = await fetchImpl(URL_TURNSTILE, { method: 'POST', body: corps, signal: AbortSignal.timeout(DELAI_MS) });
        if (!res.ok) {
          journaliser('warn', 'turnstile_indisponible', { statut: 'http' });
          return false;
        }
        const lu = reponseSchema.safeParse(await res.json());
        return lu.success && lu.data.success;
      } catch (err) {
        journaliser('warn', 'turnstile_indisponible', { err });
        return false;
      }
    },
  };
}
