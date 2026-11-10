import { config } from '../config';
import { messageDe } from '../lib/erreur';

/**
 * L'issue d'un envoi à Telegram : `recue` sur un 2xx ; `non_recue` sur un refus net (une réponse d'erreur) ou sans
 * configuration ; `incertaine` sur un délai dépassé ou une panne réseau, quand l'alerte a pu partir (relecture du lot E7
 * du Crédit WhatsApp, jaune 7).
 */
export type IssueTelegram = 'recue' | 'non_recue' | 'incertaine';

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
    return 'incertaine';
  }
}

/** `envoyerTelegram`, réduit à « reçue » : `true` seulement sur un 2xx. */
export async function sendTelegram(
  text: string,
  opts: { token?: string; chatId?: string; timeoutMs?: number } = {},
): Promise<boolean> {
  return (await envoyerTelegram(text, opts)) === 'recue';
}
