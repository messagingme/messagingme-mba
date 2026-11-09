import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONSTRUIRE } from '../scripts/plugin/construire';
import { FAMILLES_OUTILS } from '../web/lib/partage/familles-outils';
import { PAGES_FAQ, blocAccueil, blocConstruireVitrine, commandesPubliees, hrefCapacite, pageAvecConstruire, readmeAJour, skillAvecAccueil } from '../scripts/plugin/generer';
import { DROITS } from '../src/offres/offres';
import { AUTORISATION_CODEX, SERVEUR_PLUGIN_MCP } from '../web/lib/demarrer';
import { CATALOGUE_MCP } from '../web/lib/partage/catalogue-mcp';
import { PAGES_DOC } from '../web/lib/doc-api-pages';
import { ENTREES } from '../web/lib/registre-vitrine';

/**
 * CE QUE VOUS POUVEZ CONSTRUIRE, ET LE README DU PLUGIN (Julien, 2026-10-21). Une source par bloc
 * (`scripts/plugin/construire.ts`, `web/lib/partage/familles-outils.ts`, les constantes de l'offre), des copies générées par
 * `npm run plugin:generer` : la page développeurs en français et en anglais, et `plugin/README.md`.
 */
const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

describe('la source', () => {
  it('chaque cas d’usage en ligne du registre a sa ligne, et chaque ligne de cas mène à un cas en ligne', () => {
    const cites = CONSTRUIRE.flatMap((f) => f.capacites.flatMap((c) => ('cas' in c.lien ? [c.lien.cas] : [])));
    const enLigne = ENTREES.filter((e) => e.nature === 'cas' && e.enLigne && !e.attente).map((e) => e.cle);
    expect(new Set(cites)).toEqual(new Set(enLigne));
  });

  it('chaque lien mène à une page qui existe : la vitrine dans les deux langues, la documentation de la console', () => {
    for (const langue of ['fr', 'en'] as const) {
      for (const c of CONSTRUIRE.flatMap((f) => f.capacites)) {
        const href = hrefCapacite(c.lien, langue);
        if (href.startsWith('/')) expect(existsSync(join(RACINE, 'site', href, 'index.html')), href).toBe(true);
        else {
          const url = new URL(href);
          expect(url.origin).toBe('https://console.messagingme.app');
          expect(PAGES_DOC.map((p) => p.href)).toContain(url.pathname);
          expect(url.searchParams.get('lang')).toBe(langue === 'en' ? 'en' : null);
          // Une ancre visée est déclarée par sa page, que l'e2e de la console ouvre et vérifie.
          if (url.hash) expect(PAGES_DOC.find((p) => p.href === url.pathname)!.ancres as readonly string[], href).toContain(url.hash.slice(1));
        }
      }
    }
  });

  it('chaque famille d’outils du serveur MCP a au moins une ligne qui en cite un (Julien, 2026-10-30)', () => {
    // La section avait vieilli en silence : ni l'agent qui déclenche votre code, ni les heures d'ouverture, ni les
    // chiffres n'y étaient. Une famille d'outils ajoutée sans ligne rend désormais la CI rouge.
    const cites = new Set(CONSTRUIRE.flatMap((f) => f.capacites.flatMap((c) => c.outils ?? [])));
    for (const f of FAMILLES_OUTILS) expect(f.outils.some((o) => cites.has(o)), f.titre).toBe(true);
  });

  it('une ligne qui mène à un outil le cite parmi les siens', () => {
    for (const c of CONSTRUIRE.flatMap((f) => f.capacites)) {
      if ('outil' in c.lien) expect(c.outils ?? [], c.texte.fr).toContain(c.lien.outil);
    }
  });

  it('chaque outil du catalogue est rangé dans une famille, et une seule', () => {
    const ranges = FAMILLES_OUTILS.flatMap((f) => f.outils);
    expect(ranges.length).toBe(new Set(ranges).size);
    expect(new Set(ranges)).toEqual(new Set(Object.keys(CATALOGUE_MCP)));
  });
});

describe('les copies sont à jour (sinon : npm run plugin:generer)', () => {
  it('les deux pages développeurs portent la section, à jour', () => {
    for (const { chemin, langue } of PAGES_FAQ) {
      const html = lire(chemin);
      expect(html, chemin).toContain(blocConstruireVitrine(langue));
      expect(pageAvecConstruire(html, langue)).toBe(html);
    }
  });

  it('le README du plugin porte ses blocs générés, à jour, et le film en tête', () => {
    const md = lire('plugin/README.md');
    expect(readmeAJour(md)).toBe(md);
    for (const nom of ['construire', 'prix', 'contenu', 'outils']) expect(md, nom).toContain(`<!-- ${nom}:debut`);
    // « What's inside » cite chaque commande de cas publiée, que `plugin/skills/` porte vraiment.
    for (const nom of commandesPubliees()) expect(md).toContain(`\`/messagingme:${nom}\``);
    expect(md).toContain('https://app.messagingme.fr/img/plugin-demo.gif');
    expect(existsSync(join(RACINE, 'site/img/plugin-demo.gif'))).toBe(true);
  });
});

/**
 * L'ACCUEIL DU PLUGIN (aide à la connexion, lot 1). À l'onboarding du 2026-11-07, Claude a présenté la formule Free avec
 * « 1 000 contacts » (c'est 100), en improvisant son intro, et n'a pas dit pourquoi la connexion MCP vient d'abord. Un
 * accueil écrit par nous, chiffres tirés de la grille, que Claude recopie : dans les deux skills qui démarrent, et le README.
 */
describe('l’accueil du plugin (sinon : npm run plugin:generer)', () => {
  const PORTEURS = ['plugin/skills/demarrer/SKILL.md', 'plugin/skills/mise-en-service/SKILL.md', 'plugin/README.md'];

  it('les deux skills qui démarrent et le README le portent, à jour', () => {
    for (const p of PORTEURS) {
      const md = lire(p);
      expect(md, p).toContain('<!-- accueil:debut');
      expect(md, p).toContain(blocAccueil());
      expect(skillAvecAccueil(md), p).toBe(md);
    }
  });

  it('🔴 la ligne Free dit les contacts et les modèles de la grille, et aucun autre nombre de contacts', () => {
    const base = DROITS.base.limites;
    const free = /^- \*\*Free\*\*:(.*)$/m.exec(blocAccueil())?.[1] ?? '';
    expect(free).toContain(`${base.contacts} contacts`);
    expect(free).toContain(`${base.envoisModelesMois!.toLocaleString('en-US')} templates`);
    const contacts = [...free.matchAll(/([\d,]+) contacts/g)].map((m) => Number(m[1]!.replace(/,/g, '')));
    expect(contacts).toEqual([base.contacts]);
  });

  it('🔴 la connexion MCP est l’étape 1, avec son pourquoi, Claude Code et Codex, Google ou l’adresse e-mail', () => {
    const b = blocAccueil();
    expect(b).toMatch(/Step 1/);
    expect(b).toContain('`/mcp`');
    expect(b).toContain(`\`${SERVEUR_PLUGIN_MCP}\``);
    expect(b).toContain(`\`${AUTORISATION_CODEX}\``);
    expect(b).toMatch(/Google/);
    expect(b).toMatch(/email address/);
    expect(b).toMatch(/workspace is\s+created/);
    // Les trois voies de `/autoriser` (jaune 6) : sans formulaire par Google seulement ; et la console avec Pro seulement.
    expect(b).toMatch(/Continue with Google: with no account yet, your workspace is created right then, with no\s+form/);
    expect(b).toMatch(/email address \(a short form\)/);
    expect(b).toMatch(/sign in with your password/);
    expect(b).toMatch(/with Pro, it also signs you in to the console/);
    expect(b).not.toMatch(/\) and signs you in to the console/);
  });
});
