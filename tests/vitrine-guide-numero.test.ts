import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { arbreDepuis, DEPART_GUIDE, phraseGuide, profondeurTunnel, titreGuide } from '../scripts/vitrine/tunnel';
import { TEXTES_TUNNEL, type IssueBranchement } from '../scripts/vitrine/tunnel-textes';
import { GUIDE_NUMERO, jumellesAide } from '../scripts/vitrine/aide-pages';

/**
 * LE GUIDE DU NUMÉRO (lot 4a de l'aide à la connexion, spec `2026-11-08-aide-connexion-numero-design.md`, « Le guide ») :
 * le MÊME arbre que `/demarrer/`, la console et Claude, à partir de « Qui paie vos messages à Meta ? », sur une page du
 * centre d'aide. Sa fin donne le pas-à-pas, la console et la phrase à dire à Claude ; ses cinq points nomment la
 * coexistence une fois, hors du tunnel, qui ne la nomme jamais.
 */
const SITE = join(process.cwd(), 'site');
const lire = (adresse: string): string => readFileSync(join(SITE, adresse, 'index.html'), 'utf8');
const corps = (html: string): string => html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
const tunnelDe = (html: string): string => corps(html).slice(corps(html).indexOf('data-guide-numero'));

describe('le guide du numéro', () => {
  for (const langue of ['fr', 'en'] as const) {
    const n = TEXTES_TUNNEL[langue];
    const html = lire(GUIDE_NUMERO[langue]);
    const arbre = arbreDepuis(n, DEPART_GUIDE);

    it(`🔴 ${langue} : il part de « Qui paie vos messages à Meta ? », sans la formule ni le pilotage`, () => {
      const questions = [...tunnelDe(html).matchAll(/data-question="([a-z-]+)"/g)].map((m) => m[1]);
      expect(questions[0]).toBe('paiement');
      expect(questions).toEqual(arbre.questions.map((q) => q.id));
      expect(questions).not.toContain('offre');
      expect(questions).not.toContain('pilote');
      // Sans script, la première question seule se montre, comme sur `/demarrer/`.
      expect(tunnelDe(html)).toMatch(/<fieldset class="bt-question" data-question="paiement"(?![^>]*hidden)/);
    });

    it(`🔴 ${langue} : son titre dit le nombre de questions de l'arbre, calculé, pas écrit`, () => {
      const max = profondeurTunnel(arbre.questions);
      expect(max).toBeGreaterThan(2);
      expect(titreGuide(langue).titre).toContain(String(max));
      expect(html).toContain(`<title>${titreGuide(langue).titre.replace(/’/g, '’')}`);
    });

    it(`🔴 ${langue} : chaque fin mène au pas-à-pas, à la console, et à une phrase pour Claude sans prix`, () => {
      const t = tunnelDe(html);
      for (const x of arbre.issues as IssueBranchement[]) {
        const fin = t.slice(t.indexOf(`data-chemin="${x.id}"`), t.indexOf('</article>', t.indexOf(`data-chemin="${x.id}"`)));
        expect(fin, x.id).toContain(`href="${x.pasAPas}"`);
        // 🔴 La voie (Julien, 2026-11-11) : le bouton de la console et la phrase à dire à Claude portent chacun la leur,
        // pour qu'une page venue d'un « Démarrer » ne montre que le chemin de cette section.
        expect(fin, x.id).toMatch(/<a class="bouton bouton-trait" data-voie="console" href="[^"]*\/connecter-whatsapp/);
        expect(fin, x.id).toMatch(/<div data-voie="claude">\s*<p class="bt-appels-titre bt-guide-claude">[\s\S]*?<div class="bt-demande">/);
        expect(fin, x.id).toMatch(/href="https:\/\/console\.messagingme\.app\/connecter-whatsapp(\?lang=en)?"/);
        const phrase = phraseGuide(n, x);
        expect(phrase, x.id).not.toMatch(/€|formule Pro|included in Pro|inclus en/);
        expect(fin, x.id).toContain(`id="demande-${x.id}-guide"`);
      }
      // Aucune fin de la console, de Business ou d'Entreprise : elles viennent de questions que le guide ne pose pas.
      expect(t).not.toMatch(/data-chemin="(console|echange)"/);
    });

    it(`🔴 ${langue} : « coexistence » dans les cinq points et dans le tunnel, pour le référencement (Julien, 2026-11-13), jamais « QR »`, () => {
      // Hors du menu du centre (2026-11-11, le guide prend le gabarit commun) : l'entrée du guide y porte les cinq points
      // dans ses mots de recherche, un attribut que le visiteur ne lit pas.
      const lu = corps(html).replace(/<nav class="aide-nav"[\s\S]*?<\/nav>/, '');
      expect(lu).not.toContain('class="aide-nav"');
      expect((lu.match(/coexist/gi) ?? []).length).toBeGreaterThan(1);
      expect(tunnelDe(html)).toMatch(/coexistence/);
      expect(tunnelDe(html)).not.toMatch(/QR/);
      expect(n.guide.points.liste).toHaveLength(5);
    });

    it(`${langue} : l'accueil du centre le range dans les deux rubriques « Démarrer »`, () => {
      const accueil = lire(langue === 'fr' ? 'aide' : 'en/help');
      for (const id of ['demarrer-claude', 'demarrer-console']) {
        const debut = accueil.indexOf(`id="${id}"`);
        const section = accueil.slice(debut, accueil.indexOf('</section>', debut));
        expect(section, id).toContain(`<a class="aide-carte-lien" href="${GUIDE_NUMERO[langue]}?ou=${id === 'demarrer-claude' ? 'claude' : 'console'}">`);
      }
    });
  }

  it('🔴 la voie se pose depuis ?ou= et masque l’autre chemin (Julien, 2026-11-11)', () => {
    const css = readFileSync(join(SITE, 'site.css'), 'utf8');
    const js = readFileSync(join(SITE, 'site.js'), 'utf8');
    expect(css).toContain('html[data-ou="claude"] [data-voie="console"],html[data-ou="console"] [data-voie="claude"]{display:none!important}');
    expect(js).toContain("new URLSearchParams(location.search).get('ou')");
    expect(js).toContain("if (ou !== 'claude' && ou !== 'console') return;");
  });

  it('il entre dans le plan du site et dans llms.txt, et ses deux langues sont jumelles', () => {
    const plan = readFileSync(join(SITE, 'sitemap.xml'), 'utf8');
    const llms = readFileSync(join(SITE, 'llms.txt'), 'utf8');
    for (const langue of ['fr', 'en'] as const) {
      expect(plan).toContain(`<loc>https://app.messagingme.fr${GUIDE_NUMERO[langue]}</loc>`);
      expect(llms).toContain(`(https://app.messagingme.fr${GUIDE_NUMERO[langue]})`);
    }
    expect(jumellesAide()[GUIDE_NUMERO.fr]).toBe(GUIDE_NUMERO.en);
  });
});
