import { config } from '../config';
import { messageDe } from '../lib/erreur';

/**
 * L'issue d'un envoi à Telegram : `recue` sur un 2xx ; `non_recue` sur un refus net (une réponse d'erreur), sans
 * configuration, ou une connexion jamais établie ; `incertaine` sur un délai dépassé ou une coupure en cours, quand
 * l'alerte a pu partir (relecture du lot E7 du Crédit WhatsApp, jaune 7 ; du lot V5, jaune 8).
 */
export type IssueTelegram = 'recue' | 'non_recue' | 'incertaine';

/**
 * Les échecs d'établissement de la connexion (le code de la cause d'un `fetch failed` d'undici) : la requête n'est
 * jamais partie, l'alerte n'a pas pu arriver.
 */
const CONNEXION_JAMAIS_ETABLIE: ReadonlySet<string> = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
]);

/** Le code de la cause d'une erreur de `fetch` (undici la porte en `cause.code`), `null` sans cause codée. */
function codeDeLaCause(err: unknown): string | null {
  const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  const code = typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : null;
}

/**
 * Petit client d'alerte Telegram (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). Il ne bloque ni ne lève jamais :
 * no-op sans configuration, timeout dur. Une panne Telegram ne doit pas pouvoir tuer le worker, le seul process qui
 * envoie les messages. Rend l'issue de l'envoi (`IssueTelegram`).
 */
export async function envoyerTelegram(
  text: string,
  opts: { token?: string; chatId?: string; timeoutMs?: number } = {},
): Promise<IssueTelegram> {
  const token = opts.token ?? config.TELEGRAM_BOT_TOKEN;
  const chatId = opts.chatId ?? config.TELEGRAM_CHAT_ID;
  if (token === '' || chatId === '') return 'non_recue'; // alerting facultatif : non configuré = no-op
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Telegram plafonne un message à 4096 caractères : on tronque (une alerte n'a pas besoin du corps entier).
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error('[telegram] envoi KO:', res.status);
      return 'non_recue';
    }
    return 'recue';
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[telegram] envoi erreur:', messageDe(err));
    const code = codeDeLaCause(err);
    return code !== null && CONNEXION_JAMAIS_ETABLIE.has(code) ? 'non_recue' : 'incertaine';
  }
}

/** `envoyerTelegram`, réduit à « reçue » : `true` seulement sur un 2xx. */
export async function sendTelegram(
  text: string,
  opts: { token?: string; chatId?: string; timeoutMs?: number } = {},
): Promise<boolean> {
  return (await envoyerTelegram(text, opts)) === 'recue';
}
