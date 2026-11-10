import { describe, it, expect, vi, afterEach } from 'vitest';
import { envoyerTelegram, sendTelegram } from '../src/ops/telegram';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendTelegram', () => {
  it('non configuré (env vide, pas d\'opts) -> no-op, ne touche pas fetch', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    // En test, config.TELEGRAM_BOT_TOKEN/CHAT_ID valent '' -> chemin no-op.
    expect(await sendTelegram('coucou')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('configuré -> POST vers l\'URL bot correcte avec chat_id + text', async () => {
    const spy = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200, text: async () => '' }));
    vi.stubGlobal('fetch', spy);
    expect(await sendTelegram('alerte', { token: 'TKN', chatId: 'CHAT', timeoutMs: 100 })).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe('https://api.telegram.org/botTKN/sendMessage');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ chat_id: 'CHAT', text: 'alerte' });
  });

  it('HTTP KO (500) -> false, ne throw jamais', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'err' })));
    await expect(sendTelegram('x', { token: 'T', chatId: 'C', timeoutMs: 100 })).resolves.toBe(false);
  });

  it('réseau KO (fetch rejette) -> false, ne throw jamais', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    await expect(sendTelegram('x', { token: 'T', chatId: 'C', timeoutMs: 100 })).resolves.toBe(false);
  });
});

/**
 * L'ISSUE D'UN ENVOI (relecture du lot E7 du Crédit WhatsApp, jaune 7) : un délai dépassé ou une panne réseau ne disent
 * pas que l'alerte n'est pas arrivée, elle a pu partir. Seul un refus net (une réponse d'erreur, ou Telegram non
 * configuré) dit « non reçue ».
 */
describe('envoyerTelegram', () => {
  it('🔴 reçue sur une réponse 2xx ; non reçue sur un refus net ou sans configuration ; incertaine sur un délai dépassé ou une panne réseau', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '' })));
    expect(await envoyerTelegram('x', { token: 'T', chatId: 'C', timeoutMs: 100 })).toBe('recue');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, text: async () => 'chat not found' })));
    expect(await envoyerTelegram('x', { token: 'T', chatId: 'C', timeoutMs: 100 })).toBe('non_recue');
    expect(await envoyerTelegram('x')).toBe('non_recue');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }));
    expect(await envoyerTelegram('x', { token: 'T', chatId: 'C', timeoutMs: 100 })).toBe('incertaine');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await envoyerTelegram('x', { token: 'T', chatId: 'C', timeoutMs: 100 })).toBe('incertaine');
  });
});
