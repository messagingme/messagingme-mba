import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * La console ne se reconstruit sur Vercel que si `web/` a changé (Build CPU Minutes). Sa commande doit rester celle de
 * la vitrine : jamais d'issue en erreur (clone de profondeur 10, sans remote), et toute issue autre qu'un diff vide
 * construit.
 */
describe('Ignored Build Step de la console', () => {
  const lire = (p: string) => JSON.parse(readFileSync(p, 'utf8')).ignoreCommand as string;

  it('existe et reprend mot pour mot celle de la vitrine', () => {
    expect(lire('web/vercel.json')).toBe(lire('site/vercel.json'));
  });

  it('ne compare que le dossier de la console et retombe sur un build', () => {
    const cmd = lire('web/vercel.json');
    expect(cmd).toContain('git diff --quiet "$P" HEAD -- ./ && exit 0; exit 1');
    expect(cmd).toContain('https://github.com/messagingme/messagingme-mba');
  });
});
