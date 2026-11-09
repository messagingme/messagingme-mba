import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ADRESSES_AIDE_CONNEXION, VITRINE_AIDE } from '../web/lib/partage/aide-connexion';

/**
 * LES PAGES D'AIDE QUE CLAUDE DONNE PENDANT LA CONNEXION EXISTENT (aide à la connexion, lot 1). Une adresse citée par un
 * outil MCP part dans une conversation et ne se rattrape pas : une fiche renommée la ferait tomber en 404 sans autre bruit.
 */
const SITE = resolve(__dirname, '..', 'site');

describe('les pages d’aide citées pendant la connexion du numéro', () => {
  it('il y en a, sinon ce test ne prouve rien', () => {
    expect(ADRESSES_AIDE_CONNEXION.length).toBeGreaterThan(0);
  });

  const plan = readFileSync(join(SITE, 'sitemap.xml'), 'utf8');
  for (const adresse of ADRESSES_AIDE_CONNEXION) {
    it(adresse, () => {
      expect(adresse.startsWith(`${VITRINE_AIDE}/`)).toBe(true);
      const chemin = new URL(adresse).pathname;
      expect(chemin.endsWith('/')).toBe(true);
      expect(existsSync(join(SITE, chemin, 'index.html')), `site${chemin}index.html`).toBe(true);
      expect(plan).toContain(`<loc>${adresse}</loc>`);
    });
  }
});
