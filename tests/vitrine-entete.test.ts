import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SITE, lire, pagesHtml } from './vitrine-lecture';
import { enteteVitrine, jumelleDe, normaliserGabarit, pageAvecEntete, piedVitrine } from '../scripts/vitrine/entete';
import { ENTREES } from '../web/lib/registre-vitrine';
import { TEXTES_CARREFOUR } from '../scripts/vitrine/cas-textes';
import { SOLUTIONS_CRM } from '../scripts/vitrine/hubspot-textes';

/**
 * L'EN-TÊTE ET LE PIED DE PAGE DE LA VITRINE S'ÉCRIVENT UNE FOIS (lots 6 et 6 bis, tâche 4 du plan
 * `2026-10-16-cas-d-usage-solutions-depot.md`).
 *
 * Ils étaient recopiés à la main dans chaque page : un menu changé se changeait trente fois, et une page oubliée
 * gardait l'ancien. Ils viennent désormais de `scripts/vitrine/` (`npm run vitrine:entete` les réécrit), et chaque page
 * doit être égale, au caractère près, à sa génération. Ce qui varie d'une page à l'autre est calculé : le lien actif
 * (`aria-current`), le groupe du burger qui le contient (ouvert), et le drapeau vers la page jumelle.
 */

const PAGES = pagesHtml();

/** Les adresses des liens d'un fragment, hors logo. */
const adresses = (html: string): string[] =>
  [...html.matchAll(/<a ([^>]*)>/g)].filter((m) => !m[1]!.includes('class="marque"')).map((m) => m[1]!.match(/href="([^"]+)"/)![1]!);

describe('chaque page porte l’en-tête et le pied de page générés', () => {
  it('il y a bien des pages, sinon ce test ne prouve rien', () => expect(PAGES.length).toBeGreaterThan(20));

  for (const page of PAGES) {
    it(page, () => expect(pageAvecEntete(lire(page), page), 'npm run vitrine:entete').toBe(lire(page)));
  }

  it('garde de la garde : un menu retouché à la main dans une page ne passe pas', () => {
    const page = 'fonctionnalites/whatsapp-et-rcs/index.html';
    const retouchee = lire(page).replace('<strong>WhatsApp et RCS</strong>', '<strong>WhatsApp, RCS</strong>');
    expect(retouchee).not.toBe(lire(page));
    expect(pageAvecEntete(retouchee, page)).not.toBe(retouchee);
  });
});

describe('le menu', () => {
  for (const langue of ['fr', 'en'] as const) {
    it(`${langue} : le burger porte les mêmes adresses que le menu de bureau`, () => {
      const entete = enteteVitrine(langue, '/nulle-part/', '/jumelle/');
      const coupe = entete.indexOf('<nav class="nav"');
      expect(coupe).toBeGreaterThan(0);
      expect(new Set(adresses(entete.slice(0, coupe)))).toEqual(new Set(adresses(entete.slice(coupe))));
    });
  }

  it('marque la page active, ouvre son groupe dans le burger, et ne marque jamais le logo ni le drapeau', () => {
    const entete = enteteVitrine('fr', '/fonctionnalites/whatsapp-et-rcs/', '/en/features/whatsapp-and-rcs/');
    expect(entete.match(/href="\/fonctionnalites\/whatsapp-et-rcs\/" aria-current="page"/g)).toHaveLength(2);
    // Solutions, puis son sous-groupe Fonctionnalités : les deux s'ouvrent, et eux seuls.
    expect(entete.match(/<details class="burger-groupe" open>/g)).toHaveLength(1);
    expect(entete.match(/<details class="burger-sous-groupe" open>/g)).toHaveLength(1);
    // Une page rangée directement dans un groupe (Aide, dans Ressources) n'ouvre aucun sous-groupe.
    const aide = enteteVitrine('fr', '/aide/', '/en/help/');
    expect(aide.match(/<details class="burger-groupe" open>/g)).toHaveLength(1);
    expect(aide).not.toContain('<details class="burger-sous-groupe" open>');
    for (const accueil of [enteteVitrine('fr', '/', '/en/'), enteteVitrine('en', '/en/', '/')]) {
      expect(accueil).not.toContain('aria-current="page"');
      expect(accueil).not.toMatch(/<details class="burger-(sous-)?groupe" open>/);
    }
  });

  it('insère la jumelle telle quelle, même avec un `$`', () => {
    expect(enteteVitrine('fr', '/', '/en/$&/')).toContain('href="/en/$&/"');
  });
});

/**
 * LE MENU EN CASCADE (Julien, 2026-11-18, spec `2026-11-18-menu-solutions-et-page-avec-votre-ia-design.md`) :
 * Solutions porte le fonctionnel (Fonctionnalités, Secteurs, Intégrations), Ressources l'aide technique (la
 * documentation développeurs, puis l'aide et les guides). Chaque entrée de cascade déploie sa liste à sa droite.
 */
describe('le menu en cascade', () => {
  const LIBELLES = {
    fr: { solutions: ['Fonctionnalités', 'Secteurs', 'Intégrations'], doc: 'Documentation développeurs', guides: 'Guides d’intégration',
      premier: ['Solutions', 'Ressources', 'Tarifs', 'Avec votre IA'], fonctionnalites: '/fonctionnalites/', ia: '/developpeurs/' },
    en: { solutions: ['Features', 'Industries', 'Integrations'], doc: 'Developer documentation', guides: 'Integration guides',
      premier: ['Solutions', 'Resources', 'Pricing', 'With your AI'], fonctionnalites: '/en/features/', ia: '/en/developers/' },
  } as const;
  const PAGE_IA = { fr: 'developpeurs/index.html', en: 'en/developers/index.html' } as const;

  /** La partie bureau de l'en-tête, et l'un de ses menus déroulants par son libellé. */
  const bureau = (entete: string): string => entete.slice(entete.indexOf('<nav class="nav"'));
  const menu = (entete: string, libelle: string): string =>
    (bureau(entete).split('<details class="menu">').find((m) => m.includes(`<span class="menu-bureau">${libelle}</span>`)) ?? '')
      .split('\n    </details>')[0]!;
  /** Les entrées de cascade d'un menu : leur libellé et ce qu'elles déploient. */
  const cascades = (html: string): { libelle: string; contenu: string }[] =>
    [...html.matchAll(/<details class="menu-cascade"[^>]*>\s*<summary>[\s\S]*?<strong>([^<]+)<\/strong>[\s\S]*?<\/summary>([\s\S]*?)<\/details>/g)]
      .map((m) => ({ libelle: m[1]!, contenu: m[2]! }));

  for (const langue of ['fr', 'en'] as const) {
    const L = LIBELLES[langue];
    const entete = enteteVitrine(langue, '/nulle-part/', '/jumelle/');

    it(`${langue} : le premier niveau est ${L.premier.join(', ')}, sans aucun cas d’usage`, () => {
      const nav = bureau(entete);
      const premier = [...nav.matchAll(/<span class="menu-bureau">([^<]+)<\/span>|<a class="lien[^"]*" href="[^"]+">([^<]+)<\/a>/g)].map((m) => m[1] ?? m[2]);
      expect(premier).toEqual(L.premier);
      expect(nav).toContain(`<a class="lien nav-dev" href="${L.ia}">${L.premier[3]}</a>`);
      expect(entete).not.toContain('/cas-d-usage/');
    });

    it(`${langue} : Solutions déploie ${L.solutions.join(', ')}, chacune avec ses pages`, () => {
      const liste = cascades(menu(entete, 'Solutions'));
      expect(liste.map((c) => c.libelle)).toEqual(L.solutions);
      const [fonctionnalites, secteurs, integrations] = liste.map((c) => adresses(c.contenu));
      expect(fonctionnalites).toHaveLength(6);
      for (const a of fonctionnalites!) {
        expect(a.startsWith(L.fonctionnalites), a).toBe(true);
        expect(existsSync(join(SITE, a, 'index.html')), a).toBe(true);
      }
      const enLigne = (nature: string) => ENTREES.filter((e) => e.enLigne && e.nature === nature).map((e) => e[langue].adresse);
      expect(secteurs).toEqual([...enLigne('secteur'), TEXTES_CARREFOUR[langue].adresse]);
      expect(integrations).toEqual([...enLigne('boutique'), ...SOLUTIONS_CRM.map((s) => s[langue].adresse)]);
    });

    it(`${langue} : Ressources s’ouvre sur la documentation développeurs, aux cinq briques de la page « ${L.premier[3]} »`, () => {
      const ressources = menu(entete, L.premier[1]);
      const [doc, ...autres] = cascades(ressources);
      expect(doc?.libelle).toBe(L.doc);
      expect(autres).toEqual([]);
      const portes = lire(PAGE_IA[langue]).split('<nav class="dev-portes"')[1]?.split('</nav>')[0] ?? '';
      expect(adresses(doc!.contenu)).toEqual(adresses(portes));
      expect(adresses(doc!.contenu)).toHaveLength(5);
      // Après la cascade, les liens directs : l'aide, les guides d'intégration, la confiance, le blog.
      const directs = ressources.slice(ressources.indexOf('</details>'));
      expect(directs).toMatch(new RegExp(`href="${langue === 'fr' ? '' : '/en'}/integrations/"[^>]*>.*?<strong>${L.guides}</strong>`));
      expect(adresses(directs)).toHaveLength(4);
    });

    it(`${langue} : le pied de page mène à « ${L.premier[3]} »`, () => {
      expect(piedVitrine(langue)).toContain(`<a href="${L.ia}">${L.premier[3]}</a>`);
    });
  }
});

describe('la ligne de retour vers messagingme.fr (2026-11-06)', () => {
  // Elle doit partir au défilement : posée DANS la barre collante, elle resterait à l'écran. Le contrôle se fait donc
  // sur sa place exacte, juste après la fermeture de la barre, et une seule fois par page.
  const FIN_DE_BARRE = '</header>\n</div>\n';

  it('suit la barre collante sur chaque page, jamais dedans, une seule fois', () => {
    for (const page of PAGES) {
      const h = lire(page).replace(/\r\n/g, '\n');
      const i = h.indexOf('<nav class="cadre retour-site"');
      expect(i, page).toBeGreaterThan(0);
      expect(h.slice(i - FIN_DE_BARRE.length, i), page).toBe(FIN_DE_BARRE);
      expect(h.indexOf('retour-site', i + 'retour-site'.length + 20), page).toBe(-1);
    }
  });

  it('mène au site institutionnel, dans la langue de la page, depuis un repère de navigation', () => {
    const fr = lire('index.html').replace(/\r\n/g, '\n');
    const en = lire('en/index.html').replace(/\r\n/g, '\n');
    expect(fr).toContain('<nav class="cadre retour-site" aria-label="Site institutionnel"><a href="https://www.messagingme.fr/"><svg class="ic" aria-hidden="true"><use href="#i-arrow-left"/></svg>Retour sur messagingme.fr</a></nav>');
    expect(en).toContain('<nav class="cadre retour-site" aria-label="Corporate website"><a href="https://www.messagingme.fr/en/"><svg class="ic" aria-hidden="true"><use href="#i-arrow-left"/></svg>Back to messagingme.fr</a></nav>');
  });

  it('une page dont la barre ne se ferme pas juste après l’en-tête est refusée', () => {
    const page = 'contact/index.html';
    const cassee = lire(page).replace(/\r\n/g, '\n').replace('</header>\n</div>\n', '</header>\n\n</div>\n');
    expect(() => pageAvecEntete(cassee, page)).toThrow(/barre/);
  });
});

describe('la page jumelle', () => {
  it('se lit dans la page ; sans jumelle déclarée, le générateur refuse, sauf pour la page 404', () => {
    const page = '<link rel="alternate" hreflang="en" href="https://app.messagingme.fr/en/contact/">';
    expect(jumelleDe(page, 'contact/index.html')).toBe('/en/contact/');
    expect(() => jumelleDe('<html></html>', 'contact/index.html')).toThrow(/jumelle/);
    expect(jumelleDe('<html></html>', '404.html')).toBe('/en/');
  });

  it('un gabarit enregistré en CRLF est ramené en LF', () => {
    expect(normaliserGabarit('<a>\r\n</a>\r\n')).toBe('<a>\n</a>');
  });
});
