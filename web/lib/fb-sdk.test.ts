import { afterEach, describe, expect, it, vi } from 'vitest';
import { ouvrirFenetreMeta } from './fb-sdk';

/**
 * Safari n'ouvre une fenêtre qu'immédiatement après un clic (2026-11-08) : SDK déjà chargé, la fenêtre de Meta doit
 * s'ouvrir PENDANT l'appel, sans attendre la moindre promesse.
 */
const t = (fr: string) => fr;
const g = globalThis as unknown as { window?: unknown; document?: unknown };

afterEach(() => { delete g.window; delete g.document; });

describe('ouvrirFenetreMeta', () => {
  it('SDK déjà là : ouvre la fenêtre pendant l’appel, avant toute attente', () => {
    g.window = { FB: { init: vi.fn(), login: vi.fn() } };
    const ouvrir = vi.fn();
    void ouvrirFenetreMeta('app', 'v23.0', t, ouvrir);
    expect(ouvrir).toHaveBeenCalledTimes(1);
  });

  it('SDK absent : charge d’abord, puis ouvre', async () => {
    const scripts: Array<{ onload?: () => void }> = [];
    const fenetre: { FB?: unknown } = {};
    g.window = fenetre;
    g.document = {
      createElement: () => { const s: { onload?: () => void } = {}; scripts.push(s); return s; },
      head: { appendChild: () => {} },
    };
    const ouvrir = vi.fn();
    const p = ouvrirFenetreMeta('app', 'v23.0', t, ouvrir);
    expect(ouvrir).not.toHaveBeenCalled();
    fenetre.FB = { init: vi.fn(), login: vi.fn() };
    scripts[0]!.onload!();
    await p;
    expect(ouvrir).toHaveBeenCalledTimes(1);
  });
});
