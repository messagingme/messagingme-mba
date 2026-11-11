import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEPANNAGE } from '../scripts/vitrine/depannage-textes';
import { jumellesAide } from '../scripts/vitrine/aide-pages';
import { FENETRE_BLOQUEE } from '../web/lib/fenetre-meta';
import { ETAPES_CARTE_META, WHATSAPP_ORDINAIRE } from '../web/lib/partage/etapes-meta';
import { ETAPES_NUMERO_FOURNI, SI_SEUL_TEXT_MESSAGE } from '../web/lib/partage/etapes-numero-fourni';

/**
 * LE DÉPANNAGE DE LA CONNEXION DU NUMÉRO (lot 4a de l'aide à la connexion, spec « Le dépannage ») : aucune cause ni aucun
 * remède ne s'invente. Chaque remède tiré du produit se lit sur la page MOT POUR MOT comme sa source (les étapes du numéro
 * fourni, la fenêtre bloquée, WhatsApp ordinaire, la carte chez Meta), et chaque lien mène à une page
 * qui existe.
 */
const SITE = join(process.cwd(), 'site');
const fichier = (adresse: string): string => join(SITE, adresse.replace(/#.*$/, ''), 'index.html');
const lire = (adresse: string): string => readFileSync(fichier(adresse), 'utf8');
/** Le texte lu de la page : sans balises ni entités, les espaces insécables ramenés à des espaces. */
const texteDe = (html: string): string => html.slice(html.indexOf('<main>'), html.indexOf('</main>'))
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;| | /g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const plat = (t: string): string => t.replace(/ | /g, ' ').replace(/\s+/g, ' ');

describe('le dépannage de la connexion du numéro', () => {
  for (const langue of ['fr', 'en'] as const) {
    const html = lire(DEPANNAGE.adresse[langue]);
    const page = texteDe(html);

    it(`🔴 ${langue} : chaque remède tiré du produit se lit mot pour mot comme sa source`, () => {
      const sources = [
        ...ETAPES_NUMERO_FOURNI.filter((e) => /GB \(\+44\)|45/.test(e.fr)).map((e) => e[langue]),
        SI_SEUL_TEXT_MESSAGE[langue], FENETRE_BLOQUEE[langue], WHATSAPP_ORDINAIRE[langue],
        ...ETAPES_CARTE_META.map((e) => e[langue]),
      ];
      expect(sources.length).toBeGreaterThan(6);
      for (const s of sources) expect(page, s).toContain(plat(s));
    });

    it(`🔴 ${langue} : la première question filtre par lieu, chaque symptôme une fois, marqué de ses lieux`, () => {
      for (const ou of ['claude', 'console'] as const) expect(html).toContain(`data-ou-choix="${ou}"`);
      expect(html).toContain('data-depannage');
      for (const s of DEPANNAGE.symptomes) {
        expect(html.split(`<details id="${s.id}"`).length - 1, s.id).toBe(1);
        expect(html, s.id).toContain(`<details id="${s.id}" data-ou-pour="${s.ou.join(' ')}">`);
      }
      // « Claude attend un lien » ne se vit que dans Claude, « à activer » que dans la console.
      expect(html).toContain('<details id="pas-de-lien" data-ou-pour="claude">');
      expect(html).toContain('<details id="a-activer" data-ou-pour="console">');
    });

    it(`🔴 ${langue} : chaque lien mène à une page qui existe`, () => {
      const liens = [...DEPANNAGE.symptomes.map((s) => s.lien.href[langue]), ...DEPANNAGE.macro.choix.map((c) => c.href[langue])];
      for (const l of liens) {
        expect(html, l).toContain(`href="${l}"`);
        expect(existsSync(fichier(l)), l).toBe(true);
      }
    });

    it(`${langue} : ses questions-réponses en FAQPage, une par symptôme`, () => {
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!);
      const faq = (ld['@graph'] as Array<Record<string, unknown>>).find((x) => x['@type'] === 'FAQPage') as { mainEntity: Array<{ name: string }> };
      expect(faq.mainEntity.map((q) => q.name)).toEqual(DEPANNAGE.symptomes.map((s) => s.titre[langue]));
    });

    it(`${langue} : l'accueil du centre le range en dernier dans les deux rubriques « Démarrer »`, () => {
      const accueil = lire(langue === 'fr' ? '/aide/' : '/en/help/');
      for (const id of ['demarrer-claude', 'demarrer-console']) {
        const debut = accueil.indexOf(`id="${id}"`);
        const section = accueil.slice(debut, accueil.indexOf('</section>', debut));
        const cartes = [...section.matchAll(/<a class="aide-carte-lien" href="([^"]+)">/g)].map((m) => m[1]);
        expect(cartes.at(-1), id).toBe(`${DEPANNAGE.adresse[langue]}?ou=${id === 'demarrer-claude' ? 'claude' : 'console'}`);
      }
    });
  }

  it('il entre dans le plan du site et dans llms.txt, et ses deux langues sont jumelles', () => {
    const plan = readFileSync(join(SITE, 'sitemap.xml'), 'utf8');
    const llms = readFileSync(join(SITE, 'llms.txt'), 'utf8');
    for (const langue of ['fr', 'en'] as const) {
      expect(plan).toContain(`<loc>https://app.messagingme.fr${DEPANNAGE.adresse[langue]}</loc>`);
      expect(llms).toContain(`(https://app.messagingme.fr${DEPANNAGE.adresse[langue]})`);
    }
    expect(jumellesAide()[DEPANNAGE.adresse.fr]).toBe(DEPANNAGE.adresse.en);
  });
});
