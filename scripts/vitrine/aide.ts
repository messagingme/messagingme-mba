// scripts/vitrine/aide.ts
// Le CENTRE D'AIDE de la vitrine (plan docs/superpowers/plans/2026-10-20-centre-d-aide.md, tâche 5), GÉNÉRÉ depuis les
// fiches publiques de `docs/aide/fiches/` et leur version anglaise : la fiche est la seule source, le bot d'aide de la
// console lit la même. Le gabarit est celui de la maquette validée par Julien le 2026-10-20 (fil d'Ariane, chapeau,
// boutons, menu à gauche, film, étapes avec leur capture et leur détail replié, encadrés, précédente et suivante).
//
// `npm run vitrine:aide` écrit l'accueil du centre et chaque page, dans les deux langues, les pages « Depuis Claude
// Code » de la doc développeurs (`aide-claude-textes.ts`), la section « ## Aide » de
// `llms.txt`, les adresses d'aide de `sitemap.xml`, et la correspondance écran vers page que la console importe
// (`web/lib/aide-pages.ts`). `tests/vitrine-aide.test.ts` exige chaque sortie égale à sa génération.
//
// 🔴 Une fiche publique retouchée se régénère ici, puis `aide:charger` en production pour le bot (`DEPLOY.md`).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CARTE_CONSOLE } from '../../src/aide/carte-console';
import { RUBRIQUES, type OffreFiche, type Rubrique } from '../../src/aide/fiches';
import { structureFiche, type BlocFiche } from '../../src/aide/structure';
import { ESSAI_PRO_JOURS } from '../../src/offres/offres';
import { DEPOT_PLUGIN } from '../../web/lib/demarrer';
import { ACCUEIL, fichierDe, fil, page } from './cas';
import { insecables } from './guide-meta';
import { versionnee } from './images';
import { FAQ } from '../plugin/faq';
import { PAGES_CLAUDE, type PageClaude } from './aide-claude-textes';
import { FILMS_AIDE, type FilmAide } from './aide-films';
import { ACCUEIL_AIDE, GUIDE_NUMERO, NOMS_RUBRIQUES, PLACES_DEPANNAGE, PLACES_GUIDE, pagesDeLaRubrique, pagesDuCentre, type Langue, type PageAide } from './aide-pages';
import { PAGES_SOURCES, type LienSource, type PageSource } from './aide-sources-textes';
import { DEPANNAGE, type Symptome } from './depannage-textes';
import { titreGuide, tunnel } from './tunnel';
import { TEXTES_TUNNEL } from './tunnel-textes';

const ORIGINE = 'https://app.messagingme.fr';
const CONSOLE = 'https://console.messagingme.app';
/** La page qui installe le plugin et relie l'espace : là où mène le premier bouton d'une fiche `claude_code: oui`. */
const PLUGIN: Readonly<Record<Langue, string>> = { fr: '/developpeurs/installer-le-plugin/', en: '/en/developers/install-the-plugin/' };
const SITE = (p: string) => fileURLToPath(new URL(`../../site/${p}`, import.meta.url));
const WEB = (p: string) => fileURLToPath(new URL(`../../web/${p}`, import.meta.url));
const ORGANISATION = { '@id': 'https://www.messagingme.fr/#organisation' };

/** Les textes de la page, par langue. Aucun ne cite un écran : ceux-là viennent de la carte de la console. */
const T = {
  fr: {
    aide: 'Aide',
    centre: 'Centre d’aide',
    recherche: 'Rechercher dans l’aide',
    detail: 'En détail',
    bonASavoir: 'Bon à savoir',
    // L'offre minimale de la fiche (spec Business) : le Pro s'essaie en ligne, le Business sur demande, l'Entreprise sur devis.
    offre: (o: OffreFiche) => (o === 'pro' ? `Avec l’offre Pro, ou pendant l’essai Pro de ${ESSAI_PRO_JOURS} jours.`
      : o === 'business' ? 'Avec l’offre Business, essayable sur demande.' : 'Avec l’offre Entreprise.'),
    offreClaude: (o: OffreFiche) => `Gratuit depuis Claude Code, avec l’offre Free. Dans la console, ${o === 'pro'
      ? `avec l’offre Pro ou pendant l’essai Pro de ${ESSAI_PRO_JOURS} jours.` : o === 'business' ? 'avec l’offre Business.' : 'avec l’offre Entreprise.'}`,
    claudeCode: 'Le faire depuis Claude Code, gratuitement',
    ouvrir: (ecran: string) => `Ouvrir « ${ecran} » dans la console`,
    ouvrirConsole: 'Ouvrir la console',
    avant: 'D’abord :',
    precedent: 'Précédent :',
    suivant: 'Suivant :',
    question: 'Une question sans réponse ? Écrivez-nous',
    contact: '/contact/',
    legendeFilm: (duree: string) => `Vidéo de ${duree}, sous-titrée, sans son.`,
    duree: (m: number, s: number) => (m === 0 ? `${s} secondes` : s === 0 ? `${m} minute${m > 1 ? 's' : ''}` : `${m} min ${String(s).padStart(2, '0')}`),
    etape: 'Étape',
    agrandir: 'Voir la capture en grand',
    titreSite: 'Aide Messaging Me',
    accueilChapeau: 'Les modes opératoires de la console Messaging Me, pas à pas : démarrer, puis parler à vos clients.',
    accueilOffre: `Les écrans de la console demandent l’offre Pro, essayable ${ESSAI_PRO_JOURS} jours.`,
    developpeurs: 'Depuis Claude Code',
    developpeursTexte: 'Une partie de ces gestes se fait aussi en le demandant à Claude, depuis Claude Code.',
    developpeursLien: 'Les pages développeurs',
    developpeursAdresse: '/developpeurs/',
    videos: 'Les guides en vidéo',
    groupeClaude: 'Claude Code / Codex',
    groupeConsole: 'Console',
    parlerClaude: 'Parler aux clients depuis Claude Code',
    parlerConsole: 'Parler aux clients via la console',
    filmPrecedent: 'Film précédent',
    filmSuivant: 'Film suivant',
    etapes: (n: number) => `Les ${n} étapes`,
    lireGuide: 'Lire le guide',
    aucun: 'Aucun guide ne correspond à cette recherche.',
  },
  en: {
    aide: 'Help',
    centre: 'Help center',
    recherche: 'Search the help',
    detail: 'In detail',
    bonASavoir: 'Good to know',
    offre: (o: OffreFiche) => (o === 'pro' ? `With the Pro plan, or during the ${ESSAI_PRO_JOURS}-day Pro trial.`
      : o === 'business' ? 'With the Business plan, trial on request.' : 'With the Enterprise plan.'),
    offreClaude: (o: OffreFiche) => `Free from Claude Code, with the Free plan. In the console, ${o === 'pro'
      ? `with the Pro plan or during the ${ESSAI_PRO_JOURS}-day Pro trial.` : o === 'business' ? 'with the Business plan.' : 'with the Enterprise plan.'}`,
    claudeCode: 'Do it from Claude Code, for free',
    ouvrir: (ecran: string) => `Open “${ecran}” in the console`,
    ouvrirConsole: 'Open the console',
    avant: 'First:',
    precedent: 'Previous:',
    suivant: 'Next:',
    question: 'A question this page does not answer? Write to us',
    contact: '/en/contact/',
    legendeFilm: (duree: string) => `${duree} video, subtitled, no sound.`,
    duree: (m: number, s: number) => (m === 0 ? `${s}-second` : s === 0 ? `${m}-minute` : `${m} min ${String(s).padStart(2, '0')}`),
    etape: 'Step',
    agrandir: 'View the screenshot full size',
    titreSite: 'Messaging Me Help',
    accueilChapeau: 'How-to guides for the Messaging Me console, step by step: get started, then talk to your customers.',
    accueilOffre: `The console screens require the Pro plan, with a ${ESSAI_PRO_JOURS}-day trial.`,
    developpeurs: 'From Claude Code',
    developpeursTexte: 'Some of these actions can also be done by asking Claude, from Claude Code.',
    developpeursLien: 'The developer pages',
    developpeursAdresse: '/en/developers/',
    videos: 'Video guides',
    groupeClaude: 'Claude Code / Codex',
    groupeConsole: 'Console',
    parlerClaude: 'Talk to customers from Claude Code',
    parlerConsole: 'Talk to customers in the console',
    filmPrecedent: 'Previous video',
    filmSuivant: 'Next video',
    etapes: (n: number) => `The ${n} steps`,
    lireGuide: 'Read the guide',
    aucun: 'No guide matches this search.',
  },
} as const;

const echapper = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attribut = (t: string): string => echapper(t).replace(/"/g, '&quot;');
/** Le texte brut d'une ligne de fiche : sans le gras, pour une méta, un JSON-LD ou une recherche. */
const brut = (t: string): string => t.replace(/\*\*/g, '');

/** Un texte sans balisage (titre, libellé) : échappé, et en français les espaces insécables de la ponctuation. */
const texte = (t: string, langue: Langue): string => (langue === 'fr' ? insecables(echapper(t)) : echapper(t));

/** Une ligne de fiche en HTML : échappée, le gras rendu, et en français les espaces insécables de la ponctuation. */
function enLigne(t: string, langue: Langue): string {
  const h = echapper(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return langue === 'fr' ? insecables(h) : h;
}

/**
 * Les mots qu'un visiteur peut taper pour trouver une page : minuscules, sans accents, sans ponctuation. Le filtre du menu
 * (`site.js`) normalise ce qu'on tape de la même façon : « modele » trouve « Faire approuver un modèle ».
 */
export function motsDeRecherche(texte: string): string {
  return brut(texte).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

const bloc = (b: BlocFiche, langue: Langue): string => (b.type === 'paragraphe'
  ? `<p>${enLigne(b.texte, langue)}</p>`
  : `<ul>${b.items.map((i) => `<li>${enLigne(i, langue)}</li>`).join('')}</ul>`);

/** La capture d'une étape, si elle existe : `site/img/aide/<clé>/etape-<n>.webp`, et `-en` pour l'anglais. */
export const adresseCapture = (cle: string, numero: number, langue: Langue): string =>
  `/img/aide/${cle}/etape-${numero}${langue === 'en' ? '-en' : ''}.webp`;
const captureExiste = (adresse: string): boolean => existsSync(SITE(adresse.slice(1)));

/** Le film d'une page, livré dans `site/films/` (tâche 11) : `aide-<clé>` et `-en`. */
const adresseFilm = (cle: string, langue: Langue, extension: 'mp4' | 'webp'): string =>
  `/films/aide-${cle}${langue === 'en' ? '-en' : ''}.${extension}`;

function corps(p: PageAide, langue: Langue): string {
  const v = p[langue];
  return structureFiche(v.corps, langue).sections.map((s) => {
    if (s.type === 'etape') {
      const capture = adresseCapture(p.cle, s.numero, langue);
      // Dans la page, la capture fait un tiers de sa taille : un clic ouvre l'image entière, sans script.
      const image = p.publication.captures && captureExiste(capture)
        ? `<a class="aide-capture" href="${versionnee(capture)}" title="${T[langue].agrandir}"><img src="${versionnee(capture)}" alt="${attribut(`${T[langue].etape} ${s.numero}${langue === 'fr' ? ' :' : ':'} ${brut(s.titre)}`)}" width="1280" height="800" loading="lazy"></a>`
        : '';
      const detail = s.detail.length > 0
        ? `<details class="aide-detail"><summary>${T[langue].detail}</summary>${s.detail.map((b) => bloc(b, langue)).join('')}</details>`
        : '';
      return `      <div class="aide-etape${image === '' ? ' sans-capture' : ''}" id="etape-${s.numero}"><div><h3>${s.numero}. ${enLigne(s.titre, langue)}</h3><p>${enLigne(s.tete, langue)}</p>${detail}</div>${image}</div>`;
    }
    if (s.type === 'encadre') return `      <div class="aide-encadre"><strong>${T[langue].bonASavoir}</strong> ${enLigne(s.texte, langue)}</div>`;
    return `      <div class="aide-prose">${s.titre === null ? '' : `<h2>${enLigne(s.titre, langue)}</h2>`}${s.blocs.map((b) => bloc(b, langue)).join('')}</div>`;
  }).join('\n');
}

/** Le rang d'une fiche dans une rubrique où elle paraît (`places`, lot 4a). */
const rangDans = (p: PageAide, r: Rubrique): number => p.publication.places.find((x) => x.rubrique === r)?.rang ?? 0;
/**
 * Les pages du centre qui ne sont pas des fiches (lot 4a) : le guide du numéro, le dépannage et les pages composées de
 * sources (4a-2), chacune à sa place dans les rubriques, avec ce que la recherche du menu lit d'elle.
 */
interface Extra { places: ReadonlyArray<{ rubrique: Rubrique; rang: number }>; adresse: string; titre: string; chapeau: string; mots: string }
function extras(langue: Langue): Extra[] {
  const g = TEXTES_TUNNEL[langue].guide;
  const tg = titreGuide(langue).titre;
  return [
    { places: PLACES_GUIDE, adresse: GUIDE_NUMERO[langue], titre: tg, chapeau: g.chapeau, mots: `${tg} ${g.chapeau} ${g.points.liste.join(' ')}` },
    {
      places: PLACES_DEPANNAGE, adresse: DEPANNAGE.adresse[langue], titre: DEPANNAGE.titre[langue], chapeau: DEPANNAGE.chapeau[langue],
      mots: `${DEPANNAGE.titre[langue]} ${DEPANNAGE.chapeau[langue]} ${DEPANNAGE.symptomes.map((s) => s.titre[langue]).join(' ')}`,
    },
    ...PAGES_SOURCES.map((s) => ({
      places: s.places, adresse: s.adresse[langue], titre: s.titre[langue], chapeau: s.chapeau[langue],
      mots: `${s.titre[langue]} ${s.chapeau[langue]} ${s.sections.map((x) => x.titre[langue]).join(' ')}`,
    })),
  ];
}
/** Les pages Claude Code rangées dans une rubrique de démarrage (`demarrer`, lot 4a). */
const claudeDeLaRubrique = (r: Rubrique): PageClaude[] => (r === 'demarrer-claude' ? PAGES_CLAUDE.filter((p) => p.demarrer !== undefined) : []);

/** Le menu du centre, à gauche de chaque page : la recherche, puis les rubriques et leurs pages. */
function menu(pages: PageAide[], courante: PageAide | null, langue: Langue, ici?: string): string {
  const lignes = [
    `    <nav class="aide-nav" aria-label="${T[langue].centre}">`,
    `      <input class="aide-recherche" type="search" placeholder="${T[langue].recherche}" aria-label="${T[langue].recherche}">`,
  ];
  for (const r of RUBRIQUES) {
    lignes.push(`      <div class="aide-rubrique"><p class="aide-nav-titre">${NOMS_RUBRIQUES[r][langue]}</p>`);
    const liens = pagesDeLaRubrique(pages, r).map((p) => {
      const v = p[langue];
      const mots = motsDeRecherche(`${v.titre} ${structureFiche(v.corps, langue).chapeau}`);
      const actif = p === courante ? ' class="actif" aria-current="page"' : '';
      return { rang: rangDans(p, r), ligne: `        <a href="${v.adresse}" data-mots="${mots}"${actif}>${texte(v.titre, langue)}</a>` };
    });
    for (const p of claudeDeLaRubrique(r)) {
      const mots = motsDeRecherche(`${p.titre[langue]} ${p.chapeau[langue]}`);
      liens.push({ rang: p.demarrer!, ligne: `        <a href="${p.adresse[langue]}" data-mots="${mots}">${texte(p.titre[langue], langue)}</a>` });
    }
    for (const x of extras(langue)) {
      const place = x.places.find((y) => y.rubrique === r);
      const actif = x.adresse === ici ? ' class="actif" aria-current="page"' : '';
      if (place) liens.push({ rang: place.rang, ligne: `        <a href="${x.adresse}" data-mots="${motsDeRecherche(x.mots)}"${actif}>${texte(x.titre, langue)}</a>` });
    }
    lignes.push(...liens.sort((x, y) => x.rang - y.rang).map((x) => x.ligne), '      </div>');
  }
  lignes.push('    </nav>');
  return lignes.join('\n');
}

/** Le film d'une page, s'il est annoncé (`video: oui`) : il doit alors être décrit dans `FILMS_AIDE`. */
function filmDe(p: PageAide): FilmAide | null {
  if (!p.publication.video) return null;
  const f = FILMS_AIDE[p.cle];
  if (!f) throw new Error(`${p.cle} : video: oui sans son entrée dans scripts/vitrine/aide-films.ts`);
  return f;
}
const minSec = (s: number): [number, number] => [Math.floor(s / 60), s % 60];

function film(p: PageAide, langue: Langue): string {
  const f = filmDe(p);
  if (!f) return '';
  return [
    '      <figure class="aide-video">',
    `        <video class="f-video aide-film" src="${versionnee(adresseFilm(p.cle, langue, 'mp4'))}" poster="${versionnee(adresseFilm(p.cle, langue, 'webp'))}" width="1280" height="720" controls muted playsinline preload="none" aria-label="${attribut(p[langue].titre)}"></video>`,
      `        <figcaption>${texte(T[langue].legendeFilm(T[langue].duree(...minSec(f.secondes[langue]))), langue)}</figcaption>`,
    '      </figure>',
  ].join('\n');
}

function pageAide(pages: PageAide[], p: PageAide, langue: Langue): { chemin: string; contenu: string } {
  const v = p[langue];
  const autre = p[langue === 'fr' ? 'en' : 'fr'];
  const s = structureFiche(v.corps, langue);
  const i = pages.indexOf(p);
  const [avant, apres] = [pages[i - 1], pages[i + 1]];
  const rubrique = NOMS_RUBRIQUES[p.publication.rubrique][langue];
  const ecran = CARTE_CONSOLE.find((e) => e.cle === p.ecran);
  const suffixeConsole = langue === 'en' ? '?lang=en' : '';
  const prerequis = pages.find((x) => x.cle === p.publication.prerequis);
  const etapes = s.sections.filter((x) => x.type === 'etape');

  const main = [
    '<main>',
    '<section class="cadre f-une guide-une aide-une">',
    '  <div>',
    `    <p class="aide-fil"><a href="${ACCUEIL_AIDE[langue]}">${T[langue].aide}</a> › <a href="${ACCUEIL_AIDE[langue]}#${p.publication.rubrique}">${rubrique}</a> › ${texte(v.titre, langue)}</p>`,
    `    <h1><span class="f-surtitre"><svg class="ic" aria-hidden="true"><use href="#i-file-text"/></svg>${T[langue].aide}</span> ${texte(v.titre, langue)}</h1>`,
    `    <p class="chapeau">${enLigne(s.chapeau, langue)}</p>`,
    ...(p.publication.offre ? [`    <p class="aide-offre">${texte(p.publication.claudeCode ? T[langue].offreClaude(p.publication.offre) : T[langue].offre(p.publication.offre), langue)}</p>`] : []),
    '    <div class="appels">',
    // Un geste qui se fait aussi depuis Claude Code mène d'abord au plugin, gratuit ; la console vient en second.
    ...(p.publication.claudeCode
      ? [`      <a class="bouton bouton-plein" href="${PLUGIN[langue]}">${texte(v.boutonClaude ?? T[langue].claudeCode, langue)}</a>`] : []),
    `      <a class="bouton ${p.publication.claudeCode ? 'bouton-trait' : 'bouton-plein'}" href="${CONSOLE}${ecran?.href ?? '/'}${suffixeConsole}${p.ancreConsole ? `#${p.ancreConsole}` : ''}">${v.boutonConsole ? texte(v.boutonConsole, langue) : ecran ? texte(T[langue].ouvrir(ecran[langue]), langue) : T[langue].ouvrirConsole}</a>`,
    ...(prerequis ? [`      <a class="bouton bouton-texte" href="${prerequis[langue].adresse}">${texte(`${T[langue].avant} ${prerequis[langue].titre}`, langue)} <svg class="ic" aria-hidden="true"><use href="#i-fleche"/></svg></a>`] : []),
    '    </div>',
    '  </div>',
    '</section>',
    '',
    '<section class="f-bloc bande-claire">',
    '  <div class="cadre aide-grille">',
    menu(pages, p, langue),
    '    <article class="aide-article">',
    film(p, langue),
    corps(p, langue),
    '      <div class="aide-pied-page">',
    ...(avant ? [`        <a class="aide-precedente" href="${avant[langue].adresse}">${texte(`${T[langue].precedent} ${avant[langue].titre}`, langue)}</a>`] : []),
    ...(apres ? [`        <a class="aide-suivante" href="${apres[langue].adresse}">${texte(`${T[langue].suivant} ${apres[langue].titre}`, langue)}</a>`] : []),
    `        <a class="aide-question" href="${T[langue].contact}?aide=${v.adresse.split("/").filter(Boolean).pop()}">${langue === 'fr' ? insecables(T.fr.question) : T.en.question}</a>`,
    '      </div>',
    '    </article>',
    '  </div>',
    '</section>',
    '</main>',
  ].filter((l) => l !== '').join('\n');

  const langueLd = langue === 'fr' ? 'fr-FR' : 'en-US';
  // Le chapeau sert de description, sauf quand la fiche en donne une plus courte : au-delà de 160 caractères, les
  // moteurs la coupent (plan docs/superpowers/plans/2026-10-26-seo-geo-vitrine.md, A5).
  const description = v.description ?? brut(s.chapeau);
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      fil(langue, [ACCUEIL[langue], [T[langue].centre, ACCUEIL_AIDE[langue]], [v.titre, v.adresse]]),
      etapes.length > 0
        ? {
          '@type': 'HowTo', name: v.titre, description, inLanguage: langueLd, url: ORIGINE + v.adresse,
          step: etapes.map((e) => ({
            '@type': 'HowToStep', position: e.numero, name: brut(e.titre), text: brut(e.tete), url: `${ORIGINE}${v.adresse}#etape-${e.numero}`,
          })),
        }
        : { '@type': 'TechArticle', headline: v.titre, description, inLanguage: langueLd, url: ORIGINE + v.adresse, publisher: ORGANISATION },
      ...(filmDe(p) ? [{
        '@type': 'VideoObject', name: v.titre, description,
        thumbnailUrl: ORIGINE + adresseFilm(p.cle, langue, 'webp'), contentUrl: ORIGINE + adresseFilm(p.cle, langue, 'mp4'),
        uploadDate: filmDe(p)!.publie, duration: `PT${minSec(filmDe(p)!.secondes[langue]).join('M')}S`,
        inLanguage: langueLd, publisher: ORGANISATION,
      }] : []),
    ],
  };
  const contenu = page(langue, {
    adresse: v.adresse, jumelle: autre.adresse, titre: `${v.titre} | ${T[langue].titreSite}`, description, ldJson: ld,
    ...(p.publication.video ? { affiche: versionnee(adresseFilm(p.cle, langue, 'webp')) } : {}),
  }, main, `Centre d’aide, « ${p.fr.titre} », GÉNÉRÉ par npm run vitrine:aide depuis docs/aide/fiches/ : ne pas modifier à la main.`);
  return { chemin: fichierDe(v.adresse), contenu };
}

/** Une section de l'accueil : une rubrique, ou les pages « Depuis Claude Code » (`claude-code`). */
type SectionAccueil = Rubrique | 'claude-code';
/** Une carte de l'accueil, avec ce que la barre latérale en reprend (l'adresse et le titre déjà échappé). */
interface CarteAccueil { rang: number; adresse: string; titre: string; ligne: string }

/**
 * Les sections de l'accueil en deux groupes, Claude Code ou Codex puis la console (Julien, 2026-11-11) : la barre
 * latérale les sépare, et la page les range dans le même ordre, pour que le défilement suive la barre.
 */
const GROUPES_ACCUEIL = (langue: Langue): ReadonlyArray<{ nom: string; sections: ReadonlyArray<{ id: SectionAccueil; nom: string }> }> => [
  {
    nom: T[langue].groupeClaude,
    sections: [{ id: 'demarrer-claude', nom: NOMS_RUBRIQUES['demarrer-claude'][langue] }, { id: 'claude-code', nom: T[langue].parlerClaude }],
  },
  {
    nom: T[langue].groupeConsole,
    sections: [{ id: 'demarrer-console', nom: NOMS_RUBRIQUES['demarrer-console'][langue] }, { id: 'parler-aux-clients', nom: T[langue].parlerConsole }],
  },
];

/**
 * La barre latérale de l'accueil : la recherche, qui filtre les cartes, puis les sections par groupe. Chaque section
 * porte la liste de ses guides ; un clic sur la section la fait défiler ET déplie sa liste (`site.js`). Sans script,
 * toutes les listes restent ouvertes.
 */
function menuAccueil(cartes: ReadonlyMap<SectionAccueil, CarteAccueil[]>, langue: Langue): string {
  const lignes = [
    `    <nav class="aide-nav aide-nav-accueil" aria-label="${T[langue].centre}">`,
    `      <input class="aide-recherche" type="search" placeholder="${T[langue].recherche}" aria-label="${T[langue].recherche}">`,
    '      <div class="aide-sections">',
    `        <a class="aide-section-lien" href="#videos">${T[langue].videos}</a>`,
  ];
  for (const g of GROUPES_ACCUEIL(langue)) {
    lignes.push(`        <p class="aide-nav-groupe">${g.nom}</p>`);
    for (const s of g.sections) {
      lignes.push(
        `        <div class="aide-section"><a class="aide-section-lien" href="#${s.id}" aria-controls="menu-${s.id}">${texte(s.nom, langue)}</a>`,
        `          <ul class="aide-section-liste" id="menu-${s.id}">${(cartes.get(s.id) ?? []).map((c) => `<li><a href="${c.adresse}">${c.titre}</a></li>`).join('')}</ul></div>`,
      );
    }
  }
  lignes.push('      </div>', '    </nav>');
  return lignes.join('\n');
}

/**
 * Le carrousel de l'accueil : les films des guides, puis ceux des pages « Depuis Claude Code ». Tous en 16:9 (aucun
 * n'existe en 9:16) ; au téléphone, un film par écran qu'on fait glisser (`site.css`). Sans script, la piste défile
 * au doigt ou à la molette ; les boutons n'apparaissent qu'avec lui (`site.js`).
 */
function carrousel(pages: PageAide[], langue: Langue): string {
  const suffixe = langue === 'en' ? '-en' : '';
  const films = [
    ...pages.filter((p) => filmDe(p) !== null).map((p) => ({
      mp4: adresseFilm(p.cle, langue, 'mp4'), webp: adresseFilm(p.cle, langue, 'webp'),
      adresse: p[langue].adresse, titre: p[langue].titre, rubrique: NOMS_RUBRIQUES[p.publication.rubrique][langue],
    })),
    ...PAGES_CLAUDE.filter((p) => p.film).map((p) => ({
      mp4: `/films/${p.film}${suffixe}.mp4`, webp: `/films/${p.film}${suffixe}.webp`,
      adresse: p.adresse[langue], titre: p.titre[langue], rubrique: T[langue].developpeurs,
    })),
  ];
  const bouton = (sens: -1 | 1) => `<button class="aide-carrousel-bouton" type="button" data-sens="${sens}" aria-label="${sens < 0 ? T[langue].filmPrecedent : T[langue].filmSuivant}"><svg class="ic" aria-hidden="true"><use href="#${sens < 0 ? 'i-arrow-left' : 'i-fleche'}"/></svg></button>`;
  return [
    '      <section class="aide-videos" id="videos">',
    `        <div class="aide-videos-tete"><h2>${T[langue].videos}</h2><div class="aide-carrousel-boutons">${bouton(-1)}${bouton(1)}</div></div>`,
    '        <ul class="aide-carrousel">',
    ...films.map((f) => `          <li class="aide-diapo"><video class="f-video aide-film" src="${versionnee(f.mp4)}" poster="${versionnee(f.webp)}" width="1280" height="720" controls muted playsinline preload="none" aria-label="${attribut(f.titre)}"></video><p><small>${f.rubrique}</small><a href="${f.adresse}">${texte(f.titre, langue)}</a></p></li>`),
    '        </ul>',
    '      </section>',
  ].join('\n');
}

/**
 * Une carte de l'accueil : le titre et le chapeau mènent au guide ; l'accordéon déplie ses étapes, chacune vers son
 * ancre (`#etape-<n>`). Un guide sans étape n'a pas d'accordéon. `data-mots` nourrit la recherche de la barre latérale.
 */
function carte(adresse: string, titre: string, chapeau: string, offre: string, mots: string,
  etapes: ReadonlyArray<{ numero: number; titre: string }>, langue: Langue): string {
  const accordeon = etapes.length === 0 ? ''
    : `<details class="aide-carte-etapes"><summary>${T[langue].etapes(etapes.length)}<svg class="ic" aria-hidden="true"><use href="#i-caret-down"/></svg></summary>`
      + `<ol>${etapes.map((e) => `<li><a href="${adresse}#etape-${e.numero}">${e.titre}</a></li>`).join('')}</ol>`
      + `<a class="aide-carte-guide" href="${adresse}">${T[langue].lireGuide} <svg class="ic" aria-hidden="true"><use href="#i-fleche"/></svg></a></details>`;
  return `          <li class="aide-carte" data-mots="${mots}"><a class="aide-carte-lien" href="${adresse}"><strong>${titre}</strong><small>${chapeau}</small>${offre}</a>${accordeon}</li>`;
}

/** La carte d'une page Claude Code, et l'offre quand ses outils la demandent. */
function carteClaude(p: PageClaude, langue: Langue): string {
  return carte(p.adresse[langue], texte(p.titre[langue], langue), enLigne(p.chapeau[langue], langue),
    p.offrePro ? `<small class="aide-carte-offre">${langue === 'fr' ? insecables(T.fr.offre('pro')) : T.en.offre('pro')}</small>` : '',
    motsDeRecherche(`${p.titre[langue]} ${p.chapeau[langue]} ${p.etapes.map((e) => e.titre[langue]).join(' ')}`),
    p.etapes.map((e, n) => ({ numero: n + 1, titre: enLigne(e.titre[langue], langue) })), langue);
}

/** Les cartes d'une section de l'accueil, dans leur ordre. */
function cartesDeLaSection(pages: PageAide[], r: SectionAccueil, langue: Langue): CarteAccueil[] {
  if (r === 'claude-code') {
    return PAGES_CLAUDE.filter((p) => p.demarrer === undefined)
      .map((p, i) => ({ rang: i, adresse: p.adresse[langue], titre: texte(p.titre[langue], langue), ligne: carteClaude(p, langue) }));
  }
  const cartes: CarteAccueil[] = pagesDeLaRubrique(pages, r).map((p) => {
    const v = p[langue];
    const s = structureFiche(v.corps, langue);
    const etapes = s.sections.flatMap((x) => (x.type === 'etape' ? [{ numero: x.numero, titre: x.titre }] : []));
    return { rang: rangDans(p, r), adresse: v.adresse, titre: texte(v.titre, langue), ligne: carte(v.adresse, texte(v.titre, langue), enLigne(s.chapeau, langue), '',
      motsDeRecherche(`${v.titre} ${s.chapeau} ${etapes.map((e) => e.titre).join(' ')}`),
      etapes.map((e) => ({ ...e, titre: enLigne(e.titre, langue) })), langue) };
  });
  cartes.push(...claudeDeLaRubrique(r).map((p) => ({ rang: p.demarrer!, adresse: p.adresse[langue], titre: texte(p.titre[langue], langue), ligne: carteClaude(p, langue) })));
  for (const x of extras(langue)) {
    const place = x.places.find((y) => y.rubrique === r);
    if (place) cartes.push({ rang: place.rang, adresse: x.adresse, titre: texte(x.titre, langue), ligne: carte(x.adresse, texte(x.titre, langue), texte(x.chapeau, langue), '', motsDeRecherche(x.mots), [], langue) });
  }
  return cartes.sort((x, y) => x.rang - y.rang);
}

function accueilAide(pages: PageAide[], langue: Langue): { chemin: string; contenu: string } {
  const adresse = ACCUEIL_AIDE[langue];
  const groupes = GROUPES_ACCUEIL(langue);
  const cartes = new Map(groupes.flatMap((g) => g.sections).map((s) => [s.id, cartesDeLaSection(pages, s.id, langue)] as const));
  const lignes = [
    '<main>',
    '<section class="cadre f-une guide-une aide-une">',
    '  <div>',
    `    <h1><span class="f-surtitre"><svg class="ic" aria-hidden="true"><use href="#i-file-text"/></svg>${T[langue].aide}</span> ${T[langue].centre}</h1>`,
    `    <p class="chapeau">${langue === 'fr' ? insecables(T.fr.accueilChapeau) : T.en.accueilChapeau}</p>`,
    `    <p class="aide-offre">${langue === 'fr' ? insecables(T.fr.accueilOffre) : T.en.accueilOffre}</p>`,
    '  </div>',
    '</section>',
    '',
    '<section class="f-bloc bande-claire">',
    '  <div class="cadre aide-grille">',
    menuAccueil(cartes, langue),
    '    <div class="aide-accueil">',
    carrousel(pages, langue),
  ];
  for (const s of groupes.flatMap((g) => g.sections)) {
    lignes.push(`      <section class="aide-rubrique" id="${s.id}">`, `        <h2>${texte(s.nom, langue)}</h2>`);
    // Les pages Claude Code disent l'offre quand leurs outils la demandent (relecture du lot 3 : l'accueil promettait
    // « tout en Free » alors que les outils de campagne sont fermés en Free ; `tests/vitrine-aide.test.ts` tient les deux).
    if (s.id === 'claude-code') lignes.push(`        <p>${langue === 'fr' ? insecables(T.fr.developpeursTexte) : T.en.developpeursTexte}</p>`);
    lignes.push('        <ul class="aide-cartes">', ...cartes.get(s.id)!.map((x) => x.ligne), '        </ul>');
    if (s.id === 'claude-code') lignes.push(`        <p><a href="${T[langue].developpeursAdresse}">${T[langue].developpeursLien}</a></p>`);
    lignes.push('      </section>');
  }
  lignes.push(
    `      <p class="aide-aucun" hidden>${langue === 'fr' ? insecables(T.fr.aucun) : T.en.aucun}</p>`,
    '    </div>',
    '  </div>',
    '</section>',
    '</main>',
  );
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      fil(langue, [ACCUEIL[langue], [T[langue].centre, adresse]]),
      {
        '@type': 'CollectionPage', name: T[langue].centre, description: T[langue].accueilChapeau, url: ORIGINE + adresse,
        inLanguage: langue === 'fr' ? 'fr-FR' : 'en-US', publisher: ORGANISATION,
        // Toutes les pages que l'accueil range : les fiches, les pages Claude Code de démarrage, et celles qui ne sont pas
        // des fiches (le guide, le dépannage, les pages composées de sources ; jaune 9 de la relecture du lot 4a-2).
        hasPart: [
          ...pages.map((p) => ({ '@type': 'WebPage', name: p[langue].titre, url: ORIGINE + p[langue].adresse })),
          ...claudeDeLaRubrique('demarrer-claude').map((p) => ({ '@type': 'WebPage', name: p.titre[langue], url: ORIGINE + p.adresse[langue] })),
          ...extras(langue).map((x) => ({ '@type': 'WebPage', name: x.titre, url: ORIGINE + x.adresse })),
        ],
      },
    ],
  };
  const contenu = page(langue, {
    adresse, jumelle: ACCUEIL_AIDE[langue === 'fr' ? 'en' : 'fr'], titre: `${T[langue].centre} | Messaging Me`,
    description: T[langue].accueilChapeau, ldJson: ld,
  }, lignes.join('\n'), 'Accueil du centre d’aide, GÉNÉRÉ par npm run vitrine:aide depuis docs/aide/fiches/ : ne pas modifier à la main.');
  return { chemin: fichierDe(adresse), contenu };
}

/** Les textes propres aux pages « Depuis Claude Code ». */
const TC = {
  fr: {
    surtitre: 'Depuis Claude Code',
    developpeurs: 'Développeurs',
    guideMeta: 'Votre compte Meta Business',
    vous: 'Vous',
    codex: 'Avec Codex',
    appelle: 'Claude appelle',
    claude: 'Claude',
    plugin: 'Voir le plugin sur GitHub',
    titreSite: 'Développeurs Messaging Me',
  },
  en: {
    surtitre: 'From Claude Code',
    developpeurs: 'Developers',
    guideMeta: 'Your Meta Business account',
    vous: 'You',
    codex: 'With Codex',
    appelle: 'Claude calls',
    claude: 'Claude',
    plugin: 'See the plugin on GitHub',
    titreSite: 'Messaging Me Developers',
  },
} as const;
const DEVELOPPEURS: Readonly<Record<Langue, string>> = { fr: '/developpeurs/', en: '/en/developers/' };
const GUIDE_META: Readonly<Record<Langue, string>> = { fr: '/developpeurs/compte-meta-business/', en: '/en/developers/meta-business-account/' };

/** Ce que la personne dit ou tape : un texte entre accents graves est une commande, rendue telle quelle. */
function dire(t: string, langue: Langue): string {
  return t.split('`').map((morceau, i) => (i % 2 === 1 ? `<code>${echapper(morceau)}</code>` : enLigne(morceau, langue))).join('');
}

function menuDeveloppeurs(courante: PageClaude, langue: Langue): string {
  return [
    `    <nav class="aide-nav" aria-label="${TC[langue].developpeurs}">`,
    `      <div class="aide-rubrique"><p class="aide-nav-titre">${TC[langue].developpeurs}</p>`,
    `        <a href="${DEVELOPPEURS[langue]}">${TC[langue].developpeurs}</a>`,
    `        <a href="${GUIDE_META[langue]}">${TC[langue].guideMeta}</a>`,
    '      </div>',
    `      <div class="aide-rubrique"><p class="aide-nav-titre">${TC[langue].surtitre}</p>`,
    ...PAGES_CLAUDE.map((p) => `        <a href="${p.adresse[langue]}"${p === courante ? ' class="actif" aria-current="page"' : ''}>${texte(p.titre[langue], langue)}</a>`),
    '      </div>',
    '    </nav>',
  ].join('\n');
}

function pageClaude(p: PageClaude, langue: Langue): { chemin: string; contenu: string } {
  const i = PAGES_CLAUDE.indexOf(p);
  const [avant, apres] = [PAGES_CLAUDE[i - 1], PAGES_CLAUDE[i + 1]];
  const suffixe = langue === 'en' ? '-en' : '';
  const etapes = p.etapes.map((e, n) => {
    const outils = e.outils.length === 0 ? ''
      : `<p class="aide-outils"><span>${TC[langue].appelle}</span> ${e.outils.map((o) => `<code data-outil="${o}">${o}</code>`).join(', ')}</p>`;
    return `      <div class="aide-etape sans-capture" id="etape-${n + 1}"><div><h3>${n + 1}. ${enLigne(e.titre[langue], langue)}</h3>`
      + `<div class="aide-echange"><p class="aide-vous"><span>${TC[langue].vous}</span> ${dire(e.dire[langue], langue)}</p>`
      + (e.codex ? `<p class="aide-vous aide-codex"><span>${TC[langue].codex}</span> ${dire(e.codex[langue], langue)}</p>` : '')
      + outils
      + `<p class="aide-claude"><span>${TC[langue].claude}</span> ${enLigne(e.reponse[langue], langue)}</p></div></div></div>`;
  });
  const main = [
    '<main>',
    '<section class="cadre f-une guide-une aide-une">',
    '  <div>',
    `    <p class="aide-fil"><a href="${DEVELOPPEURS[langue]}">${TC[langue].developpeurs}</a> › ${texte(p.titre[langue], langue)}</p>`,
    `    <h1><span class="f-surtitre"><svg class="ic" aria-hidden="true"><use href="#i-code"/></svg>${TC[langue].surtitre}</span> ${texte(p.titre[langue], langue)}</h1>`,
    `    <p class="chapeau">${enLigne(p.chapeau[langue], langue)}</p>`,
    ...(p.offrePro ? [`    <p class="aide-offre">${langue === 'fr' ? insecables(T.fr.offre('pro')) : T.en.offre('pro')}</p>`] : []),
    '    <div class="appels">',
    `      <a class="bouton bouton-plein" href="${DEPOT_PLUGIN}">${TC[langue].plugin}</a>`,
    '    </div>',
    '  </div>',
    '</section>',
    '',
    '<section class="f-bloc bande-claire">',
    '  <div class="cadre aide-grille">',
    menuDeveloppeurs(p, langue),
    '    <article class="aide-article">',
    ...(p.film ? [
      '      <figure class="aide-video">',
      `        <video class="f-video aide-film" src="${versionnee(`/films/${p.film}${suffixe}.mp4`)}" poster="${versionnee(`/films/${p.film}${suffixe}.webp`)}" width="1280" height="720" controls muted playsinline preload="none" aria-label="${attribut(p.titre[langue])}"></video>`,
      '      </figure>',
    ] : []),
    ...etapes,
    // Les questions de la FAQ du plugin que la page reprend (la mise à jour, sur « Installer le plugin ») : telles quelles.
    ...(p.faq ?? []).map((id) => {
      const q = FAQ.find((x) => x.id === id);
      if (!q) throw new Error(`${p.cle} : la FAQ du plugin n'a pas de question « ${id} »`);
      return `      <div class="aide-prose" id="${id}"><h2>${texte(q.question[langue], langue)}</h2><p>${texte(q.reponse[langue], langue)}</p></div>`;
    }),
    ...(p.bonASavoir ? [`      <div class="aide-encadre"><strong>${T[langue].bonASavoir}</strong> ${enLigne(p.bonASavoir[langue], langue)}</div>`] : []),
    '      <div class="aide-pied-page">',
    ...(avant ? [`        <a class="aide-precedente" href="${avant.adresse[langue]}">${texte(`${T[langue].precedent} ${avant.titre[langue]}`, langue)}</a>`] : []),
    ...(apres ? [`        <a class="aide-suivante" href="${apres.adresse[langue]}">${texte(`${T[langue].suivant} ${apres.titre[langue]}`, langue)}</a>`] : []),
    `        <a class="aide-question" href="${T[langue].contact}">${langue === 'fr' ? insecables(T.fr.question) : T.en.question}</a>`,
    '      </div>',
    '    </article>',
    '  </div>',
    '</section>',
    '</main>',
  ].join('\n');
  const langueLd = langue === 'fr' ? 'fr-FR' : 'en-US';
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      fil(langue, [ACCUEIL[langue], [TC[langue].developpeurs, DEVELOPPEURS[langue]], [p.titre[langue], p.adresse[langue]]]),
      {
        '@type': 'HowTo', name: p.titre[langue], description: p.chapeau[langue], inLanguage: langueLd, url: ORIGINE + p.adresse[langue],
        step: p.etapes.map((e, n) => ({
          '@type': 'HowToStep', position: n + 1, name: e.titre[langue], text: e.reponse[langue], url: `${ORIGINE}${p.adresse[langue]}#etape-${n + 1}`,
        })),
      },
    ],
  };
  const contenu = page(langue, {
    adresse: p.adresse[langue], jumelle: p.adresse[langue === 'fr' ? 'en' : 'fr'], titre: `${p.titre[langue]} | ${TC[langue].titreSite}`,
    description: p.chapeau[langue], ldJson: ld, ...(p.film ? { affiche: versionnee(`/films/${p.film}${suffixe}.webp`) } : {}),
  }, main, `Page « ${p.titre.fr} », GÉNÉRÉE par npm run vitrine:aide depuis scripts/vitrine/aide-claude-textes.ts : ne pas modifier à la main.`);
  return { chemin: fichierDe(p.adresse[langue]), contenu };
}

/** La tête d'une page du centre qui n'est pas une fiche : le fil d'Ariane, le titre et le chapeau, en pleine largeur. */
function teteAide(langue: Langue, rubrique: Rubrique, titre: string, chapeau: string): string[] {
  return [
    '<section class="cadre f-une guide-une aide-une">',
    '  <div>',
    `    <p class="aide-fil"><a href="${ACCUEIL_AIDE[langue]}">${T[langue].aide}</a> › <a href="${ACCUEIL_AIDE[langue]}#${rubrique}">${NOMS_RUBRIQUES[rubrique][langue]}</a> › ${texte(titre, langue)}</p>`,
    `    <h1><span class="f-surtitre"><svg class="ic" aria-hidden="true"><use href="#i-file-text"/></svg>${T[langue].aide}</span> ${texte(titre, langue)}</h1>`,
    `    <p class="chapeau">${texte(chapeau, langue)}</p>`,
    '  </div>',
    '</section>',
    '',
  ];
}

/**
 * LE GUIDE DU NUMÉRO (lot 4a) : le menu du centre, les cinq points à vérifier (le seul endroit qui nomme la coexistence),
 * puis le tunnel à partir de « Qui paie vos messages à Meta ? », dont chaque fin mène au pas-à-pas, à la console, et à la
 * phrase à dire à Claude. Sans script, toutes les fins se lisent l'une sous l'autre, comme sur `/demarrer/`.
 */
function pageGuide(pages: PageAide[], langue: Langue): { chemin: string; contenu: string } {
  const g = TEXTES_TUNNEL[langue].guide;
  const { titre, description } = titreGuide(langue);
  const principale = PLACES_GUIDE[0]!.rubrique;
  // Le gabarit de toutes les pages du centre (Julien, 2026-11-11 : toutes les pages d'aide ont la même forme) : la tête,
  // puis la bande claire avec le menu à gauche ; les cinq points, puis le tunnel, dans l'article.
  const main = [
    '<main>',
    ...teteAide(langue, principale, titre, g.chapeau),
    '<section class="f-bloc bande-claire">',
    '  <div class="cadre aide-grille">',
    menu(pages, null, langue, GUIDE_NUMERO[langue]),
    '    <article class="aide-article" id="numero">',
    `      <div class="guide-points"><p><strong>${texte(g.points.titre, langue)}</strong></p><ol>${g.points.liste.map((x) => `<li>${texte(x, langue)}</li>`).join('')}</ol></div>`,
    ...tunnel(langue, 'generique', 'guide'),
    '    </article>',
    '  </div>',
    '</section>',
    '</main>',
  ].join('\n');
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      fil(langue, [ACCUEIL[langue], [T[langue].centre, ACCUEIL_AIDE[langue]], [titre, GUIDE_NUMERO[langue]]]),
      { '@type': 'WebPage', name: titre, description, inLanguage: langue === 'fr' ? 'fr-FR' : 'en-US', url: ORIGINE + GUIDE_NUMERO[langue] },
    ],
  };
  const contenu = page(langue, {
    adresse: GUIDE_NUMERO[langue], jumelle: GUIDE_NUMERO[langue === 'fr' ? 'en' : 'fr'], titre: `${titre} | ${T[langue].titreSite}`, description, ldJson: ld,
  }, main, 'Centre d’aide, le guide du numéro, GÉNÉRÉ par npm run vitrine:aide depuis scripts/vitrine/tunnel-textes.ts : ne pas modifier à la main.');
  return { chemin: fichierDe(GUIDE_NUMERO[langue]), contenu };
}

/**
 * LE DÉPANNAGE (lot 4a) : « Claude Code ou Codex, ou la console ? », l'entrée « Je n'arrive pas à connecter mon numéro »,
 * puis les symptômes de chaque lieu en cartes dépliables (la cause se lit sans ouvrir, le remède et la page au clic), et
 * leurs questions-réponses en `FAQPage`. Sans script, tout se lit ; les deux réponses de la première question mènent à
 * leur section par une ancre.
 */
function pageDepannage(pages: PageAide[], langue: Langue): { chemin: string; contenu: string } {
  const d = DEPANNAGE;
  const principale = PLACES_DEPANNAGE[0]!.rubrique;
  // La réponse d'un symptôme, telle qu'elle s'affiche ET telle que la balise le dit (`tests/vitrine-seo.test.ts`).
  const reponse = (s: Symptome): string[] => [s.cause[langue], ...s.remede.map((x) => x[langue]), `${d.voir[langue]} ${s.lien.libelle[langue]}`];
  const symptome = (s: Symptome): string[] => [
    `        <details id="${s.id}" data-ou-pour="${s.ou.join(' ')}"><summary>${texte(s.titre[langue], langue)}</summary>`,
    `          <p>${texte(s.cause[langue], langue)}</p>`,
    ...s.remede.map((x) => `          <p>${texte(x[langue], langue)}</p>`),
    `          <p>${texte(d.voir[langue], langue)} <a href="${s.lien.href[langue]}">${texte(s.lien.libelle[langue], langue)}</a></p>`,
    '        </details>',
  ];
  const main = [
    '<main>',
    ...teteAide(langue, principale, d.titre[langue], d.chapeau[langue]),
    '<section class="f-bloc bande-claire">',
    '  <div class="cadre aide-grille">',
    menu(pages, null, langue, d.adresse[langue]),
    '    <article class="aide-article" id="depannage">',
    `      <h2 class="depannage-titre">${texte(d.macro.titre[langue], langue)}</h2>`,
    `      <p class="bt-liens">${d.macro.choix.map((c) => `<a class="bouton bouton-trait" href="${c.href[langue]}">${texte(c.libelle[langue], langue)}</a>`).join('')}</p>`,
    '      <div id="symptomes" data-depannage>',
    `      <h2 class="depannage-titre">${texte(d.liste[langue], langue)}</h2>`,
    // La première question : un filtre, que `site.js` branche ; sans script, chaque bouton mène à la liste entière.
    '      <div class="depannage-filtre" data-filtre hidden>',
    `        <p class="depannage-question"><strong>${texte(d.ou.question[langue], langue)}</strong></p>`,
    `        <p class="bt-liens">${(['claude', 'console', ''] as const).map((ou) => `<button type="button" class="bouton bouton-trait" data-ou-choix="${ou}" aria-pressed="false">${texte(ou === '' ? d.ou.tout[langue] : d.ou[ou][langue], langue)}</button>`).join('')}</p>`,
    `        <p class="depannage-compte" role="status" data-compte="${attribut(d.ou.compte[langue])}"></p>`,
    '      </div>',
    '      <div class="dev-faq">',
    ...d.symptomes.flatMap(symptome),
    '      </div>',
    '      </div>',
    '    </article>',
    '  </div>',
    '</section>',
    '</main>',
  ].join('\n');
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      fil(langue, [ACCUEIL[langue], [T[langue].centre, ACCUEIL_AIDE[langue]], [d.titre[langue], d.adresse[langue]]]),
      {
        '@type': 'FAQPage', inLanguage: langue === 'fr' ? 'fr-FR' : 'en-US', url: ORIGINE + d.adresse[langue],
        mainEntity: d.symptomes.map((s) => ({
          '@type': 'Question', name: s.titre[langue], acceptedAnswer: { '@type': 'Answer', text: reponse(s).join(' ') },
        })),
      },
    ],
  };
  const contenu = page(langue, {
    adresse: d.adresse[langue], jumelle: d.adresse[langue === 'fr' ? 'en' : 'fr'], titre: `${d.titre[langue]} | ${T[langue].titreSite}`,
    description: d.description[langue], ldJson: ld,
  }, main, 'Centre d’aide, le dépannage du numéro, GÉNÉRÉ par npm run vitrine:aide depuis scripts/vitrine/depannage-textes.ts : ne pas modifier à la main.');
  return { chemin: fichierDe(d.adresse[langue]), contenu };
}

/**
 * UNE PAGE COMPOSÉE DE SOURCES (lot 4a-2) : le gabarit d'une fiche, le menu du centre à gauche, chaque section numérotée
 * comme une étape, ses textes tirés tels quels de la FAQ du plugin et des textes du produit (`aide-sources-textes.ts`).
 */
function pageSource(pages: PageAide[], s: PageSource, langue: Langue): { chemin: string; contenu: string } {
  const principale = s.places[0]!.rubrique;
  // Une adresse citée par une réponse (la grille de Meta) devient un lien, sans sa ponctuation finale. Le découpage se
  // fait sur le texte BRUT, avant les espaces insécables du français : après eux, un « ; » ou un « : » qui suit
  // l'adresse ferait entrer `&nbsp` dans le lien (jaune 3 de la relecture du lot).
  const cite = (t: { fr: string; en: string }): string => t[langue].split(/(https:\/\/[^\s<]*[^\s<.,;:!?)»])/)
    .map((morceau, i) => (i % 2 === 1 ? `<a href="${echapper(morceau)}" rel="noopener">${echapper(morceau)}</a>` : texte(morceau, langue)))
    .join('');
  const voir = (adresse: string, titre: string): string => `<p>${texte(DEPANNAGE.voir[langue], langue)} <a href="${adresse}">${texte(titre, langue)}</a></p>`;
  const lien = (l: LienSource): string => {
    if ('fiche' in l) {
      const f = pages.find((p) => p.cle === l.fiche);
      if (!f) throw new Error(`${s.cle} : la fiche « ${l.fiche} » n'est pas une page du centre`);
      return voir(f[langue].adresse, f[langue].titre);
    }
    if ('page' in l) {
      const autre = PAGES_SOURCES.find((p) => p.cle === l.page);
      if (!autre) throw new Error(`${s.cle} : aucune page « ${l.page} » dans aide-sources-textes.ts`);
      return voir(autre.adresse[langue], autre.titre[langue]);
    }
    return `<p><a href="${l.href[langue]}">${texte(l.libelle[langue], langue)}</a></p>`;
  };
  const sections = s.sections.map((x, i) => `      <div class="aide-etape sans-capture" id="etape-${i + 1}"><div><h3>${i + 1}. ${texte(x.titre[langue], langue)}</h3>`
    + x.textes.map((t) => `<p>${cite(t)}</p>`).join('')
    + (x.etapes ? `<ol>${x.etapes.map((e) => `<li>${cite(e)}</li>`).join('')}</ol>` : '')
    + (x.lien ? lien(x.lien) : '')
    + '</div></div>');
  const main = [
    '<main>',
    '<section class="cadre f-une guide-une aide-une">',
    '  <div>',
    `    <p class="aide-fil"><a href="${ACCUEIL_AIDE[langue]}">${T[langue].aide}</a> › <a href="${ACCUEIL_AIDE[langue]}#${principale}">${NOMS_RUBRIQUES[principale][langue]}</a> › ${texte(s.titre[langue], langue)}</p>`,
    `    <h1><span class="f-surtitre"><svg class="ic" aria-hidden="true"><use href="#i-file-text"/></svg>${T[langue].aide}</span> ${texte(s.titre[langue], langue)}</h1>`,
    `    <p class="chapeau">${texte(s.chapeau[langue], langue)}</p>`,
    ...(s.lien ? ['    <div class="appels">', `      <a class="bouton bouton-trait" href="${s.lien.href[langue]}" rel="noopener">${texte(s.lien.libelle[langue], langue)}</a>`, '    </div>'] : []),
    '  </div>',
    '</section>',
    '',
    '<section class="f-bloc bande-claire">',
    '  <div class="cadre aide-grille">',
    menu(pages, null, langue, s.adresse[langue]),
    '    <article class="aide-article">',
    ...sections,
    '    </article>',
    '  </div>',
    '</section>',
    '</main>',
  ].join('\n');
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      fil(langue, [ACCUEIL[langue], [T[langue].centre, ACCUEIL_AIDE[langue]], [s.titre[langue], s.adresse[langue]]]),
      { '@type': 'TechArticle', headline: s.titre[langue], description: s.chapeau[langue], inLanguage: langue === 'fr' ? 'fr-FR' : 'en-US', url: ORIGINE + s.adresse[langue], publisher: ORGANISATION },
    ],
  };
  const contenu = page(langue, {
    adresse: s.adresse[langue], jumelle: s.adresse[langue === 'fr' ? 'en' : 'fr'], titre: `${s.titre[langue]} | ${T[langue].titreSite}`,
    description: s.chapeau[langue], ldJson: ld,
  }, main, `Centre d’aide, « ${s.titre.fr} », GÉNÉRÉ par npm run vitrine:aide depuis scripts/vitrine/aide-sources-textes.ts : ne pas modifier à la main.`);
  return { chemin: fichierDe(s.adresse[langue]), contenu };
}

/**
 * Toutes les pages générées ici, dans les deux langues : l'accueil du centre d'aide, une page par fiche publique, et les
 * pages « Depuis Claude Code » de la doc développeurs.
 */
export function pagesAide(): Array<{ chemin: string; contenu: string }> {
  const pages = pagesDuCentre();
  return (['fr', 'en'] as const).flatMap((langue) => [
    accueilAide(pages, langue),
    pageGuide(pages, langue),
    pageDepannage(pages, langue),
    ...PAGES_SOURCES.map((s) => pageSource(pages, s, langue)),
    ...pages.map((p) => pageAide(pages, p, langue)),
    ...PAGES_CLAUDE.map((p) => pageClaude(p, langue)),
  ]);
}

/** Les adresses absolues des pages générées ici, telles que le plan du site et `llms.txt` les citent. */
export function adressesAide(): string[] {
  const pages = pagesDuCentre();
  return (['fr', 'en'] as const)
    .flatMap((l) => [ACCUEIL_AIDE[l], GUIDE_NUMERO[l], DEPANNAGE.adresse[l], ...PAGES_SOURCES.map((s) => s.adresse[l]), ...pages.map((p) => p[l].adresse), ...PAGES_CLAUDE.map((p) => p.adresse[l])])
    .map((a) => ORIGINE + a);
}

/** Le plan du site avec les adresses du centre d'aide à jour : les anciennes retirées, les actuelles avant la fin. */
export function sitemapAvecAide(xml: string): string {
  const nos = adressesAide();
  const sans = xml.split('\n').filter((l) => !/<loc>https:\/\/app\.messagingme\.fr\/(aide|en\/help)\//.test(l)
    && !nos.some((a) => l.includes(`<loc>${a}</loc>`)));
  const fin = sans.findIndex((l) => l.trim() === '</urlset>');
  if (fin < 0) throw new Error('sitemap.xml : </urlset> introuvable');
  return [...sans.slice(0, fin), ...adressesAide().map((a) => `  <url><loc>${a}</loc></url>`), ...sans.slice(fin)].join('\n');
}

/** La section « ## Aide » de `llms.txt`, posée avant « ## Tarifs ». */
export function llmsAvecAide(contenu: string): string {
  const pages = pagesDuCentre();
  const section = [
    '## Aide',
    '',
    `- [Centre d’aide](${ORIGINE}${ACCUEIL_AIDE.fr}) : les modes opératoires de la console, pas à pas.`,
    `- [Help center](${ORIGINE}${ACCUEIL_AIDE.en}) : the same pages in English.`,
    ...(['fr', 'en'] as const).map((l) => `- [${titreGuide(l).titre}](${ORIGINE}${GUIDE_NUMERO[l]}) : ${TEXTES_TUNNEL[l].guide.chapeau}`),
    ...(['fr', 'en'] as const).map((l) => `- [${DEPANNAGE.titre[l]}](${ORIGINE}${DEPANNAGE.adresse[l]}) : ${DEPANNAGE.chapeau[l]}`),
    ...PAGES_SOURCES.flatMap((s) => (['fr', 'en'] as const).map((l) => `- [${s.titre[l]}](${ORIGINE}${s.adresse[l]}) : ${s.chapeau[l]}`)),
    ...pages.flatMap((p) => (['fr', 'en'] as const).map((l) =>
      `- [${p[l].titre}](${ORIGINE}${p[l].adresse}) : ${brut(structureFiche(p[l].corps, l).chapeau)}`)),
    ...PAGES_CLAUDE.flatMap((p) => (['fr', 'en'] as const).map((l) => `- [${p.titre[l]}](${ORIGINE}${p.adresse[l]}) : ${p.chapeau[l]}`)),
    '',
  ].join('\n');
  const debut = contenu.indexOf('## Aide\n');
  if (debut >= 0) {
    const fin = contenu.indexOf('\n## ', debut + 3);
    if (fin < 0) throw new Error('llms.txt : la section Aide doit être suivie d’une autre');
    return contenu.slice(0, debut) + section + '\n' + contenu.slice(fin + 1);
  }
  const tarifs = contenu.indexOf('## Tarifs');
  if (tarifs < 0) throw new Error('llms.txt : section Tarifs introuvable');
  return contenu.slice(0, tarifs) + section + '\n' + contenu.slice(tarifs);
}

/** La correspondance écran vers page « Comment faire », pour la console (`web/lib/aide-pages.ts`). */
export function fichierCommentFaire(): string {
  const entrees = pagesDuCentre().filter((p) => p.publication.commentFaire && p.ecran !== null)
    .map((p) => `  ${JSON.stringify(p.ecran)}: { fr: ${JSON.stringify(ORIGINE + p.fr.adresse)}, en: ${JSON.stringify(ORIGINE + p.en.adresse)} },`);
  return [
    '/**',
    ' * LES PAGES « COMMENT FAIRE » DE LA CONSOLE, ÉMISES par `npm run vitrine:aide` depuis les fiches publiques',
    ' * (`docs/aide/fiches/`, champ `comment_faire`). Ne pas éditer à la main : `tests/vitrine-aide.test.ts` compare ce',
    ' * fichier à sa génération. La clé est l’écran de la console (`web/lib/nav.ts`), la valeur la page du centre d’aide.',
    ' */',
    'export const PAGES_COMMENT_FAIRE: Readonly<Record<string, { fr: string; en: string }>> = {',
    ...entrees,
    '};',
    '',
  ].join('\n');
}

function main(): void {
  const pages = pagesAide();
  for (const { chemin, contenu } of pages) {
    mkdirSync(dirname(SITE(chemin)), { recursive: true });
    writeFileSync(SITE(chemin), contenu);
  }
  writeFileSync(SITE('sitemap.xml'), sitemapAvecAide(readFileSync(SITE('sitemap.xml'), 'utf8')));
  writeFileSync(SITE('llms.txt'), llmsAvecAide(readFileSync(SITE('llms.txt'), 'utf8')));
  writeFileSync(WEB('lib/aide-pages.ts'), fichierCommentFaire());
  console.log(`${pages.length} pages du centre d’aide écrites, le plan du site, llms.txt et web/lib/aide-pages.ts`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
