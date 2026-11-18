// scripts/vitrine/entete.ts
// L'en-tête et le pied de page de la vitrine, écrits UNE fois (lots 6 et 6 bis, plan
// docs/superpowers/plans/2026-10-16-cas-d-usage-solutions-depot.md, tâche 4).
//
// Les gabarits sont à côté de ce fichier (`entete.<langue>.html`, `pied.<langue>.html`) : un menu se change là, puis
// `npm run vitrine:entete` réécrit chaque page de `site/`. `tests/vitrine-entete.test.ts` exige que chaque page soit
// égale à sa génération. Ce qui varie d'une page à l'autre est calculé ici : le lien actif (`aria-current`), le groupe
// et le sous-groupe du burger qui le contiennent (ouverts), et le drapeau vers la page jumelle, lue dans son
// `<link rel="alternate">`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENTREES } from '../../web/lib/registre-vitrine';
import { TEXTES_CARREFOUR } from './cas-textes';
import { TEXTES_ATTENTE, TEXTES_SECTEURS } from './secteurs-textes';
import { TEXTES_BOUTIQUES } from './boutique-textes';
import { SOLUTIONS_CRM } from './hubspot-textes';

export type Langue = 'fr' | 'en';

const ORIGINE = 'https://app.messagingme.fr';
const ENTETE = /<header class="cadre entete">[\s\S]*?<\/header>/;
const PIED = /<footer class="pied">[\s\S]*?<\/footer>/;
/** La fin de la barre collante, et la ligne de retour qui la suit quand elle est déjà posée. */
const APRES_BARRE = /<\/header>\n<\/div>\n(?:<nav class="cadre retour-site".*\n)?/;

/**
 * La ligne « Retour sur messagingme.fr » (demande de Julien du 2026-11-06) : le site institutionnel, d'un clic. Elle
 * se pose APRÈS la barre collante (`.barre`), jamais dedans : on la voit en arrivant, et elle part dès qu'on défile.
 * La vitrine anglaise mène à la version anglaise du site institutionnel (`/en/`). Un repère `nav` : un lecteur d'écran
 * la trouve parmi les zones de la page.
 */
const RETOUR: Record<Langue, string> = {
  fr: '<nav class="cadre retour-site" aria-label="Site institutionnel"><a href="https://www.messagingme.fr/"><svg class="ic" aria-hidden="true"><use href="#i-arrow-left"/></svg>Retour sur messagingme.fr</a></nav>',
  en: '<nav class="cadre retour-site" aria-label="Corporate website"><a href="https://www.messagingme.fr/en/"><svg class="ic" aria-hidden="true"><use href="#i-arrow-left"/></svg>Back to messagingme.fr</a></nav>',
};

/** Un gabarit tel qu'il s'insère : en LF même si le dépôt l'a extrait en CRLF, sans son saut de ligne final. */
export const normaliserGabarit = (texte: string): string => texte.replace(/\r\n/g, '\n').replace(/\n$/, '');

const gabarit = (nom: string): string => normaliserGabarit(readFileSync(fileURLToPath(new URL(nom, import.meta.url)), 'utf8'));
const ENTETES: Record<Langue, string> = { fr: gabarit('entete.fr.html'), en: gabarit('entete.en.html') };
const PIEDS: Record<Langue, string> = { fr: gabarit('pied.fr.html'), en: gabarit('pied.en.html') };

/** L'en-tête d'une page : `adresse` est la sienne (`/developpeurs/`), `jumelle` celle de sa page dans l'autre langue. */
export function enteteVitrine(langue: Langue, adresse: string, jumelle: string): string {
  return ouvrirGroupesActifs(ENTETES[langue]
    .replaceAll('{{jumelle}}', () => jumelle)
    .replace('{{secteurs}}', () => liensSecteurs(langue, '            '))
    .replace('{{secteurs-burger}}', () => liensSecteurs(langue, '              '))
    .replace('{{integrations}}', () => liensIntegrations(langue, '            '))
    .replace('{{integrations-burger}}', () => liensIntegrations(langue, '              '))
    // Le logo et le drapeau ne sont jamais « la page actuelle », même quand ils y mènent.
    .replace(/<a ([^>]*?)href="([^"]+)"/g, (tout: string, attributs: string, href: string) =>
      href === adresse && !/class="(marque|langue)"/.test(attributs) ? `${tout} aria-current="page"` : tout));
}

export const piedVitrine = (langue: Langue): string => PIEDS[langue];

/**
 * Dans le burger, le groupe (Solutions, Ressources) et le sous-groupe (Fonctionnalités, Secteurs…) qui contiennent la
 * page active s'ouvrent. Les `details` s'imbriquent : la fin d'un groupe se trouve en comptant les `details` ouverts et
 * fermés depuis le sien, jamais par une recherche non gourmande, qui s'arrêterait à la fin du premier sous-groupe.
 */
export function ouvrirGroupesActifs(entete: string): string {
  const aOuvrir: number[] = [];
  for (const m of entete.matchAll(/<details class="burger-(?:sous-)?groupe">/g)) {
    const balises = /<details\b|<\/details>/g;
    balises.lastIndex = m.index;
    let profondeur = 0;
    let fin = entete.length;
    for (let b = balises.exec(entete); b; b = balises.exec(entete)) {
      profondeur += b[0] === '</details>' ? -1 : 1;
      if (profondeur === 0) { fin = b.index; break; }
    }
    if (entete.slice(m.index, fin).includes('aria-current="page"')) aOuvrir.push(m.index + m[0].length - 1);
  }
  return aOuvrir.reverse().reduce((html, i) => `${html.slice(0, i)} open${html.slice(i)}`, entete);
}

/** Une ligne de menu : son icône, son titre, sa phrase courte. Même forme sur le bureau et dans le burger. */
const ligne = (retrait: string, adresse: string, icone: string, titre: string, phrase: string): string =>
  `${retrait}<a href="${adresse}"><span class="menu-ic"><svg class="ic" aria-hidden="true"><use href="#${icone}"/></svg></span><span><strong>${titre}</strong><small>${phrase}</small></span></a>`;

/**
 * Solutions > Secteurs (Julien, 2026-11-18) : les secteurs EN LIGNE au registre, puis la page chapeau « SaaS et app
 * builders », en ligne ordinaire. Ses sept cas sont sortis du menu (un quatrième niveau) : sa page les liste.
 */
export function liensSecteurs(langue: Langue, retrait: string): string {
  const lignes = ENTREES.filter((e) => e.enLigne && e.nature === 'secteur').map((e) => {
    const t = e.attente ? TEXTES_ATTENTE[e.cle]?.[langue] : TEXTES_SECTEURS[e.cle]?.[langue];
    if (!t) throw new Error(`${e.cle} : secteur en ligne sans ses textes (scripts/vitrine/secteurs-textes.ts)`);
    return ligne(retrait, e[langue].adresse, t.icone, e[langue].titre, t.menu);
  });
  const c = TEXTES_CARREFOUR[langue];
  return [...lignes, ligne(retrait, c.adresse, 'i-code', c.fil, c.menu)].join('\n');
}

/** Solutions > Intégrations : les pages boutique EN LIGNE au registre (Boutiques Shopify), puis les pages CRM (`SOLUTIONS_CRM`). */
export function liensIntegrations(langue: Langue, retrait: string): string {
  const lignes = ENTREES.filter((e) => e.enLigne && e.nature === 'boutique').map((e) => {
    const t = TEXTES_BOUTIQUES[e.cle]?.[langue];
    if (!t) throw new Error(`${e.cle} : boutique en ligne sans ses textes (scripts/vitrine/boutique-textes.ts)`);
    return ligne(retrait, e[langue].adresse, t.icone, e[langue].titre, t.menu);
  });
  const crm = SOLUTIONS_CRM.map((s) => ligne(retrait, s[langue].adresse, s.icone, s[langue].titre, s[langue].menu));
  return [...lignes, ...crm].join('\n');
}

/** L'adresse publique d'une page, depuis son chemin dans `site/` : `contact/index.html` -> `/contact/`. */
export const adressePage = (chemin: string): string =>
  chemin.endsWith('index.html') ? `/${chemin.slice(0, -'index.html'.length)}` : `/${chemin}`;

const langueDe = (chemin: string): Langue => (chemin.startsWith('en/') ? 'en' : 'fr');

/**
 * La page jumelle que la page déclare dans son `<link rel="alternate">`. Seule la page 404, qui n'en a pas, renvoie à
 * l'accueil de l'autre langue : toute autre page sans jumelle déclarée est refusée, sinon son drapeau partirait vers
 * l'accueil en silence.
 */
export function jumelleDe(html: string, chemin: string): string {
  const autre: Langue = langueDe(chemin) === 'fr' ? 'en' : 'fr';
  const declaree = html.match(new RegExp(`<link rel="alternate" hreflang="${autre}" href="${ORIGINE.replace(/\./g, '\\.')}(/[^"]*)"`));
  if (declaree) return declaree[1]!;
  if (chemin === '404.html') return autre === 'en' ? '/en/' : '/';
  throw new Error(`${chemin} : aucune jumelle déclarée (<link rel="alternate" hreflang="${autre}">), à poser avant la génération`);
}

/** La page avec son en-tête et son pied de page régénérés ; `chemin` est relatif à `site/`. */
export function pageAvecEntete(html: string, chemin: string): string {
  if (!ENTETE.test(html) || !PIED.test(html)) throw new Error(`${chemin} : en-tête ou pied de page introuvable`);
  // Sans la barre fermée juste après l'en-tête, la ligne de retour ne saurait pas où se poser : refusé, plutôt qu'une
  // page qui la perdrait en silence.
  if (!APRES_BARRE.test(html)) throw new Error(`${chemin} : la barre (<div class="barre">) ne se ferme pas juste après l'en-tête (ou la page est en CRLF)`);
  const langue = langueDe(chemin);
  return html
    .replace(ENTETE, () => enteteVitrine(langue, adressePage(chemin), jumelleDe(html, chemin)))
    .replace(APRES_BARRE, () => `</header>\n</div>\n${RETOUR[langue]}\n`)
    .replace(PIED, () => piedVitrine(langue));
}

function main(): void {
  const site = fileURLToPath(new URL('../../site/', import.meta.url));
  const pages = readdirSync(site, { recursive: true, encoding: 'utf8' })
    .map((p) => p.split('\\').join('/'))
    .filter((p) => p.endsWith('.html'));
  let reecrites = 0;
  for (const chemin of pages) {
    const avant = readFileSync(site + chemin, 'utf8');
    const apres = pageAvecEntete(avant, chemin);
    if (apres !== avant) { writeFileSync(site + chemin, apres); reecrites++; }
  }
  console.log(`${pages.length} pages lues, ${reecrites} réécrites`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
