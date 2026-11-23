import { describe, it, expect, vi, afterEach } from 'vitest';
import { envoyerTelegram, envoyerTelegramDetaille, sendTelegram, brancherLibelleur } from '../src/ops/telegram';

afterEach(() => {
  vi.unstubAllGlobals();
  brancherLibelleur(null);
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

describe('🔴 le motif d’un échec (incident 1, 2026-11-23 : refusé sans motif lisible)', () => {
  it('un refus de Telegram rend son statut et sa description', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ ok: false, description: 'Bad Request: chat not found' }) })));
    expect(await envoyerTelegramDetaille('x', { token: 'T', chatId: 'C', timeoutMs: 100 })).toEqual({ issue: 'non_recue', detail: '400 Bad Request: chat not found' });
  });

  it('🔴 une erreur réseau rend son motif, JAMAIS le jeton du bot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed https://api.telegram.org/botJETON-SECRET-123/sendMessage'); }));
    const r = await envoyerTelegramDetaille('x', { token: 'JETON-SECRET-123', chatId: 'C', timeoutMs: 100 });
    expect(r.issue).toBe('incertaine');
    expect(r.detail).not.toContain('JETON-SECRET-123');
    expect(r.detail).toContain('<bot>');
  });
});

/**
 * LE LIBELLEUR (code d'espace visible, 2026-11-19) : branché au démarrage, il ajoute nom et code aux UUID d'espace.
 * Il ne coûte rien quand Telegram n'est pas configuré, et une panne de sa part n'empêche jamais l'alerte de partir.
 */
describe('brancherLibelleur', () => {
  const okFetch = () => vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200, text: async () => '' }));
  const texteEnvoye = (spy: ReturnType<typeof okFetch>): string =>
    (JSON.parse((spy.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { text: string }).text;

  it('configuré : le texte posté est celui du libelleur', async () => {
    const spy = okFetch();
    vi.stubGlobal('fetch', spy);
    brancherLibelleur(async (t) => `${t} [L]`);
    expect(await envoyerTelegram('alerte', { token: 'T', chatId: 'C', timeoutMs: 100 })).toBe('recue');
    expect(texteEnvoye(spy)).toBe('alerte [L]');
  });

  it('non configuré : le libelleur n\'est pas appelé (aucune lecture en base pour rien)', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const libelleur = vi.fn(async (t: string) => t);
    brancherLibelleur(libelleur);
    expect(await envoyerTelegram('alerte')).toBe('non_recue');
    expect(libelleur).not.toHaveBeenCalled();
  });

  it('🔴 un libelleur qui lève : le texte d\'origine part, l\'alerte est reçue', async () => {
    const spy = okFetch();
    vi.stubGlobal('fetch', spy);
    brancherLibelleur(async () => { throw new Error('base en panne'); });
    expect(await envoyerTelegram('alerte', { token: 'T', chatId: 'C', timeoutMs: 100 })).toBe('recue');
    expect(texteEnvoye(spy)).toBe('alerte');
  });
});

/**
 * L'ISSUE D'UN ENVOI (relecture du lot E7 du Crédit WhatsApp, jaune 7) : un délai dépassé, une coupure en cours ou une
 * erreur sans cause connue ne disent pas que l'alerte n'est pas arrivée, elle a pu partir. Un refus net (une réponse
 * d'erreur, ou Telegram non configuré) et une connexion jamais établie (relecture du lot V5, jaune 8) disent « non reçue ».
 */
describe('envoyerTelegram', () => {
  it('🔴 reçue sur une réponse 2xx ; non reçue sur un refus net ou sans configuration ; incertaine sur un délai dépassé ou une erreur sans cause connue', async () => {
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

  it('🔴 une connexion jamais établie (adresse introuvable, refusée, injoignable) : non reçue ; une coupure en cours : incertaine (relecture du lot V5, jaune 8)', async () => {
    // undici : `TypeError('fetch failed')`, sa cause porte le code de l'échec.
    const echec = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
    for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']) {
      vi.stubGlobal('fetch', vi.fn(async () => { throw echec(code); }));
      expect(await envoyerTelegram('x', { token: 'T', chatId: 'C', timeoutMs: 100 }), code).toBe('non_recue');
    }
    for (const code of ['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE']) {
      vi.stubGlobal('fetch', vi.fn(async () => { throw echec(code); }));
      expect(await envoyerTelegram('x', { token: 'T', chatId: 'C', timeoutMs: 100 }), code).toBe('incertaine');
    }
  });
});
