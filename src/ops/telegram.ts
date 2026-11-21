import { config } from '../config';
import { messageDe } from '../lib/erreur';

/**
 * L'issue d'un envoi à Telegram : `recue` sur un 2xx ; `non_recue` sur un refus net (une réponse d'erreur), sans
 * configuration, ou une connexion jamais établie ; `incertaine` sur un délai dépassé ou une coupure en cours, quand
 * l'alerte a pu partir (relecture du lot E7 du Crédit WhatsApp, jaune 7 ; du lot V5, jaune 8).
 */
export type IssueTelegram = 'recue' | 'non_recue' | 'incertaine';

export interface OptionsTelegram {
  token?: string;
  chatId?: string;
  timeoutMs?: number;
  /** Des boutons sous le message ; `donnee` (64 octets au plus chez Telegram) revient au clic. */
  boutons?: ReadonlyArray<{ texte: string; donnee: string }>;
}

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
 * Le libelleur branché au démarrage (`src/index.ts`, `src/worker.ts`) : il ajoute nom et code aux UUID d'espace d'une
 * alerte (`creerLibelleurEspaces`). `null` (défaut, et tests) : le texte part tel quel.
 */
let libelleur: ((texte: string) => Promise<string>) | null = null;

export function brancherLibelleur(f: ((texte: string) => Promise<string>) | null): void {
  libelleur = f;
}

/** Le texte libellé, ou le texte d'origine si le libelleur manque ou lève : une alerte ne se perd jamais pour lui. */
async function libeller(texte: string): Promise<string> {
  if (libelleur === null) return texte;
  try {
    return await libelleur(texte);
  } catch {
    return texte;
  }
}

/**
 * Petit client d'alerte Telegram (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). Il ne bloque ni ne lève jamais :
 * no-op sans configuration, timeout dur. Une panne Telegram ne doit pas pouvoir tuer le worker, le seul process qui
 * envoie les messages. Rend l'issue de l'envoi (`IssueTelegram`).
 */
export async function envoyerTelegram(
  text: string,
  opts: OptionsTelegram = {},
): Promise<IssueTelegram> {
  const token = opts.token ?? config.TELEGRAM_BOT_TOKEN;
  const chatId = opts.chatId ?? config.TELEGRAM_CHAT_ID;
  if (token === '' || chatId === '') return 'non_recue'; // alerting facultatif : non configuré = no-op
  // Après le test de configuration : sans Telegram, aucune lecture en base pour rien.
  const corps = await libeller(text);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Telegram plafonne un message à 4096 caractères : on tronque (une alerte n'a pas besoin du corps entier).
      body: JSON.stringify({
        chat_id: chatId,
        text: corps.slice(0, 4000),
        // Une rangée de boutons (décision d'un incident, plan 2026-11-21) : chaque clic revient en `callback_query`.
        ...(opts.boutons?.length ? { reply_markup: { inline_keyboard: [opts.boutons.map((b) => ({ text: b.texte, callback_data: b.donnee }))] } } : {}),
      }),
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

/**
 * Répond au clic d'un bouton (`answerCallbackQuery` : le bouton cesse de tourner, une bulle affiche le texte), puis
 * confirme dans la conversation. Ne lève jamais.
 */
export async function repondreClic(callbackId: string, texte: string): Promise<void> {
  const token = config.TELEGRAM_BOT_TOKEN;
  if (token === '') return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text: texte.slice(0, 200) }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[telegram] réponse au clic en erreur:', messageDe(err));
  }
  await envoyerTelegram(texte);
}

/** `envoyerTelegram`, réduit à « reçue » : `true` seulement sur un 2xx. */
export async function sendTelegram(
  text: string,
  opts: OptionsTelegram = {},
): Promise<boolean> {
  return (await envoyerTelegram(text, opts)) === 'recue';
}
