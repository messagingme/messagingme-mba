import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ADRESSES_AIDE_CONNEXION, AIDE_DEPANNAGE, AIDE_GUIDE, AIDE_POURQUOI_PAIEMENT, VITRINE_AIDE,
} from '../web/lib/partage/aide-connexion';
import { GUIDE_NUMERO } from '../scripts/vitrine/aide-pages';
import { DEPANNAGE } from '../scripts/vitrine/depannage-textes';
import { PAGES_SOURCES } from '../scripts/vitrine/aide-sources-textes';

/**
 * LES PAGES D'AIDE QUE CLAUDE DONNE PENDANT LA CONNEXION EXISTENT (aide à la connexion, lot 1). Une adresse citée par un
 * outil MCP part dans une conversation et ne se rattrape pas : une fiche renommée la ferait tomber en 404 sans autre bruit.
 */
const RACINE = resolve(__dirname, '..');
const SITE = join(RACINE, 'site');

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

  /**
   * CHACUNE EST LA PAGE QU'ELLE NOMME (lot 4b), lue dans le registre de la vitrine : une page qui existe ne suffit pas,
   * « Pourquoi un moyen de paiement ? » qui mènerait encore à la fenêtre de 24 heures passerait le contrôle ci-dessus.
   */
  it('🔴 le guide, le dépannage et « Payer Meta » sont les pages du registre de la vitrine', () => {
    const payerMeta = PAGES_SOURCES.find((p) => p.cle === 'payer-meta')!;
    for (const langue of ['fr', 'en'] as const) {
      expect(AIDE_GUIDE[langue], langue).toBe(`${VITRINE_AIDE}${GUIDE_NUMERO[langue]}`);
      expect(AIDE_DEPANNAGE[langue], langue).toBe(`${VITRINE_AIDE}${DEPANNAGE.adresse[langue]}`);
      expect(AIDE_POURQUOI_PAIEMENT[langue], langue).toBe(`${VITRINE_AIDE}${payerMeta.adresse[langue]}`);
    }
  });

  /**
   * ET AUCUNE N'EST TAPÉE À LA MAIN (lot 4b) : le serveur MCP les importe de la constante, la skill les nomme par les
   * champs `aide` de `get_setup_state`. Une copie tapée échapperait au contrôle ci-dessus, et une skill déjà publiée la
   * garderait après le renommage de sa page.
   */
  it('🔴 aucune adresse du centre d’aide n’est tapée à la main dans le plugin ni dans le serveur MCP', () => {
    const lister = (dossier: string, extension: RegExp): string[] =>
      readdirSync(join(RACINE, dossier), { recursive: true, encoding: 'utf8' })
        .filter((f) => extension.test(f)).map((f) => join(RACINE, dossier, f));
    const fichiers = [...lister('plugin', /\.(md|json)$/), ...lister(join('src', 'mcp'), /\.ts$/)];
    expect(fichiers.length).toBeGreaterThan(10);
    // Avec ou sans barre finale : « …/aide » est l'accueil du centre, tapé lui aussi (jaune 1 de la relecture du lot).
    const tapees = fichiers.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\/(?:aide|en\/help)(?![a-z0-9-])[^\s)'"`]*/g)]
      .map((m) => `${f.slice(RACINE.length + 1)} : ${m[0]}`));
    expect(tapees).toEqual([]);
  });
});
