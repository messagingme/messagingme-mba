/**
 * « CE QUE VOUS POUVEZ CONSTRUIRE », EN MOTS DE MÉTIER, ÉCRIT UNE SEULE FOIS (Julien, 2026-10-21 : la page développeurs
 * et le README du plugin disaient comment brancher, jamais ce qu'on en fait). `npm run plugin:generer` le publie dans
 * les deux pages développeurs de la vitrine, entre leurs marques, et dans `plugin/README.md` ; `tests/plugin-readme.test.ts`
 * exige les copies identiques, chaque cas en ligne du registre cité, chaque lien vers une page qui existe, et chaque
 * famille d'outils du serveur MCP citée par au moins une ligne.
 *
 * Une ligne par capacité, qui mène à sa page : le cas d'usage du registre (son adresse suit le registre), une page de
 * la vitrine, ou une page de la documentation de la console (`PAGES_DOC`). Une ligne que Claude fait seul cite ses
 * outils (Julien, 2026-10-30 : la section ne montrait rien des outils ajoutés depuis) ; son offre s'en DÉRIVE
 * (`scripts/vitrine/offres-outils.ts`), jamais écrite à la main. Une ligne que seul le code de votre app réalise (l'API,
 * le SDK, un webhook reçu) n'en cite aucun. ⚠️ L'offre dérivée lit la `fonction` de l'outil, pas ce qu'il rend selon
 * l'offre : `get_message_stats` est ouvert en Free mais n'y donne ni coût ni détail, donc sa ligne n'en promet pas.
 */
import type { CleDePage } from '../../web/lib/doc-api-pages';
import type { NomOutilMcp } from '../../web/lib/partage/catalogue-mcp';

type Bilingue = { readonly fr: string; readonly en: string };

export type LienCapacite =
  | { readonly cas: string }
  | { readonly page: Bilingue }
  | { readonly doc: CleDePage }
  /** L'outil lui-même, à son ancre dans la doc MCP de la console (une ancre par outil, `PAGES_DOC`). */
  | { readonly outil: NomOutilMcp };

export interface Capacite {
  readonly texte: Bilingue;
  readonly lien: LienCapacite;
  readonly outils?: readonly NomOutilMcp[];
  /** L'icône posée devant la ligne, sur la vitrine seulement. */
  readonly icone: IconeCapacite;
}

/** L'icône d'une famille, sur la vitrine seulement (le README n'en porte pas). */
export type IconeFamille = 'chats' | 'cloche' | 'prises' | 'graphique';

export interface FamilleCapacites {
  readonly titre: Bilingue;
  readonly icone: IconeFamille;
  readonly capacites: readonly Capacite[];
}

/**
 * Les icônes (Phosphor, graisse duotone, viewBox 256) : `fond` est la forme pleine à 20 %, `trait` le dessin.
 * Recopiées ici une fois, pour que le bloc généré ne dépende ni d'un paquet ni du jeu d'icônes de la page.
 */
export const ICONES_FAMILLES: Readonly<Record<IconeFamille, { readonly fond: string; readonly trait: string }>> = {
  chats: {
    fond: 'M231.66,213.73a8,8,0,0,1-9.93,9.93L194,215.5A72.05,72.05,0,0,1,92.06,175.89h0c1.31.07,2.62.11,3.94.11a72,72,0,0,0,67.93-95.88h0A72,72,0,0,1,223.5,186Z',
    trait: 'M232.07,186.76a80,80,0,0,0-62.5-114.17A80,80,0,1,0,23.93,138.76l-7.27,24.71a16,16,0,0,0,19.87,19.87l24.71-7.27a80.39,80.39,0,0,0,25.18,7.35,80,80,0,0,0,108.34,40.65l24.71,7.27a16,16,0,0,0,19.87-19.86ZM62,159.5a8.28,8.28,0,0,0-2.26.32L32,168l8.17-27.76a8,8,0,0,0-.63-6,64,64,0,1,1,26.26,26.26A8,8,0,0,0,62,159.5Zm153.79,28.73L224,216l-27.76-8.17a8,8,0,0,0-6,.63,64.05,64.05,0,0,1-85.87-24.88A79.93,79.93,0,0,0,174.7,89.71a64,64,0,0,1,41.75,92.48A8,8,0,0,0,215.82,188.23Z',
  },
  cloche: {
    fond: 'M208,192H48a8,8,0,0,1-6.88-12C47.71,168.6,56,147.81,56,112a72,72,0,0,1,144,0c0,35.82,8.3,56.6,14.9,68A8,8,0,0,1,208,192Z',
    trait: 'M224,71.1a8,8,0,0,1-10.78-3.42,94.13,94.13,0,0,0-33.46-36.91,8,8,0,1,1,8.54-13.54,111.46,111.46,0,0,1,39.12,43.09A8,8,0,0,1,224,71.1ZM35.71,72a8,8,0,0,0,7.1-4.32A94.13,94.13,0,0,1,76.27,30.77a8,8,0,1,0-8.54-13.54A111.46,111.46,0,0,0,28.61,60.32,8,8,0,0,0,35.71,72Zm186.1,103.94A16,16,0,0,1,208,200H167.2a40,40,0,0,1-78.4,0H48a16,16,0,0,1-13.79-24.06C43.22,160.39,48,138.28,48,112a80,80,0,0,1,160,0C208,138.27,212.78,160.38,221.81,175.94ZM150.62,200H105.38a24,24,0,0,0,45.24,0ZM208,184c-10.64-18.27-16-42.49-16-72a64,64,0,0,0-128,0c0,29.52-5.38,53.74-16,72Z',
  },
  prises: {
    fond: 'M185,127,127,185a24,24,0,0,1-33.94,0L71,162.91A24,24,0,0,1,71,129L129,71a24,24,0,0,1,33.94,0L185,93.09A24,24,0,0,1,185,127Z',
    trait: 'M237.66,18.34a8,8,0,0,0-11.32,0l-52.4,52.41-5.37-5.38a32.05,32.05,0,0,0-45.26,0L100,88.69l-6.34-6.35A8,8,0,0,0,82.34,93.66L88.69,100,65.37,123.31a32,32,0,0,0,0,45.26l5.38,5.37-52.41,52.4a8,8,0,0,0,11.32,11.32l52.4-52.41,5.37,5.38a32.06,32.06,0,0,0,45.26,0L156,167.31l6.34,6.35a8,8,0,0,0,11.32-11.32L167.31,156l23.32-23.31a32,32,0,0,0,0-45.26l-5.38-5.37,52.41-52.4A8,8,0,0,0,237.66,18.34Zm-116.29,161a16,16,0,0,1-22.62,0L76.69,157.25a16,16,0,0,1,0-22.62L100,111.31,144.69,156Zm57.94-57.94h0L156,144.69,111.31,100l23.32-23.31a16,16,0,0,1,22.62,0l22.06,22a16,16,0,0,1,0,22.63ZM88.57,35A8,8,0,0,1,103.43,29l8,20A8,8,0,0,1,96.57,55ZM24.57,93A8,8,0,0,1,35,88.57l20,8A8,8,0,0,1,49,111.43l-20-8A8,8,0,0,1,24.57,93ZM231.43,163a8,8,0,0,1-10.4,4.46l-20-8A8,8,0,1,1,207,144.57l20,8A8,8,0,0,1,231.43,163Zm-64,58.06A8,8,0,0,1,152.57,227l-8-20A8,8,0,0,1,159.43,201Z',
  },
  graphique: {
    fond: 'M224,64V208H32V48H208A16,16,0,0,1,224,64Z',
    trait: 'M232,208a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V48a8,8,0,0,1,16,0V156.69l50.34-50.35a8,8,0,0,1,11.32,0L128,132.69,180.69,80H160a8,8,0,0,1,0-16h40a8,8,0,0,1,8,8v40a8,8,0,0,1-16,0V91.31l-58.34,58.35a8,8,0,0,1-11.32,0L96,123.31l-56,56V200H224A8,8,0,0,1,232,208Z',
  },
};

/**
 * L'icône de chaque ligne (Phosphor 2.1, graisse duotone, viewBox 256), recopiée de `@phosphor-icons/react` comme celles
 * des familles : la lecture d'une carte passe par elle avant le texte (Julien, 2026-11-16 : la section était illisible).
 */
export const ICONES_CAPACITES = {
  robot: {
    fond: 'M200,56H56A24,24,0,0,0,32,80V192a24,24,0,0,0,24,24H200a24,24,0,0,0,24-24V80A24,24,0,0,0,200,56ZM164,184H92a20,20,0,0,1,0-40h72a20,20,0,0,1,0,40Z',
    trait: 'M200,48H136V16a8,8,0,0,0-16,0V48H56A32,32,0,0,0,24,80V192a32,32,0,0,0,32,32H200a32,32,0,0,0,32-32V80A32,32,0,0,0,200,48Zm16,144a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V80A16,16,0,0,1,56,64H200a16,16,0,0,1,16,16ZM72,108a12,12,0,1,1,12,12A12,12,0,0,1,72,108Zm88,0a12,12,0,1,1,12,12A12,12,0,0,1,160,108Zm4,28H92a28,28,0,0,0,0,56h72a28,28,0,0,0,0-56Zm-24,16v24H116V152ZM80,164a12,12,0,0,1,12-12h8v24H92A12,12,0,0,1,80,164Zm84,12h-8V152h8a12,12,0,0,1,0,24Z',
  },
  chatCircleDots: {
    fond: 'M224,128A96,96,0,0,1,79.93,211.11h0L42.54,223.58a8,8,0,0,1-10.12-10.12l12.47-37.39h0A96,96,0,1,1,224,128Z',
    trait: 'M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-4-1.08,7.85,7.85,0,0,0-2.53.42L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Zm12-88a12,12,0,1,1-12-12A12,12,0,0,1,140,128Zm-44,0a12,12,0,1,1-12-12A12,12,0,0,1,96,128Zm88,0a12,12,0,1,1-12-12A12,12,0,0,1,184,128Z',
  },
  calendarCheck: {
    fond: 'M216,48V88H40V48a8,8,0,0,1,8-8H208A8,8,0,0,1,216,48Z',
    trait: 'M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM72,48v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80H48V48ZM208,208H48V96H208V208Zm-38.34-85.66a8,8,0,0,1,0,11.32l-48,48a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L116,164.69l42.34-42.35A8,8,0,0,1,169.66,122.34Z',
  },
  clock: {
    fond: 'M224,128a96,96,0,1,1-96-96A96,96,0,0,1,224,128Z',
    trait: 'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z',
  },
  flask: {
    fond: 'M208,216H48a8,8,0,0,1-6.86-12.12l30.48-50.8h0c13.23-2.48,32-1.41,56.37,10.92,32.25,16.33,54.75,12.91,67.5,7.65h0l19.34,32.23A8,8,0,0,1,208,216Z',
    trait: 'M221.69,199.77,160,96.92V40h8a8,8,0,0,0,0-16H88a8,8,0,0,0,0,16h8V96.92L34.31,199.77A16,16,0,0,0,48,224H208a16,16,0,0,0,13.72-24.23ZM110.86,103.25A7.93,7.93,0,0,0,112,99.14V40h32V99.14a7.93,7.93,0,0,0,1.14,4.11L183.36,167c-12,2.37-29.07,1.37-51.75-10.11-15.91-8.05-31.05-12.32-45.22-12.81ZM48,208l28.54-47.58c14.25-1.73,30.31,1.85,47.82,10.72,19,9.61,35,12.88,48,12.88a69.89,69.89,0,0,0,19.55-2.7L208,208Z',
  },
  arrowBendUpLeft: {
    fond: 'M80,56v96L32,104Z',
    trait: 'M128,96H88V56a8,8,0,0,0-13.66-5.66l-48,48a8,8,0,0,0,0,11.32l48,48A8,8,0,0,0,88,152V112h40a88.1,88.1,0,0,1,88,88,8,8,0,0,0,16,0A104.11,104.11,0,0,0,128,96ZM72,132.69,43.31,104,72,75.31Z',
  },
  usersThree: {
    fond: 'M168,144a40,40,0,1,1-40-40A40,40,0,0,1,168,144ZM64,56A32,32,0,1,0,96,88,32,32,0,0,0,64,56Zm128,0a32,32,0,1,0,32,32A32,32,0,0,0,192,56Z',
    trait: 'M244.8,150.4a8,8,0,0,1-11.2-1.6A51.6,51.6,0,0,0,192,128a8,8,0,0,1,0-16,24,24,0,1,0-23.24-30,8,8,0,1,1-15.5-4A40,40,0,1,1,219,117.51a67.94,67.94,0,0,1,27.43,21.68A8,8,0,0,1,244.8,150.4ZM190.92,212a8,8,0,1,1-13.85,8,57,57,0,0,0-98.15,0,8,8,0,1,1-13.84-8,72.06,72.06,0,0,1,33.74-29.92,48,48,0,1,1,58.36,0A72.06,72.06,0,0,1,190.92,212ZM128,176a32,32,0,1,0-32-32A32,32,0,0,0,128,176ZM72,120a8,8,0,0,0-8-8A24,24,0,1,1,87.24,82a8,8,0,1,0,15.5-4A40,40,0,1,0,37,117.51,67.94,67.94,0,0,0,9.6,139.19a8,8,0,1,0,12.8,9.61A51.6,51.6,0,0,1,64,128,8,8,0,0,0,72,120Z',
  },
  package: {
    fond: 'M128,129.09V232a8,8,0,0,1-3.84-1l-88-48.18a8,8,0,0,1-4.16-7V80.18a8,8,0,0,1,.7-3.25Z',
    trait: 'M223.68,66.15,135.68,18a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32l80.34,44-29.77,16.3-80.35-44ZM128,120,47.66,76l33.9-18.56,80.34,44ZM40,90l80,43.78v85.79L40,175.82Zm176,85.78h0l-80,43.79V133.82l32-17.51V152a8,8,0,0,0,16,0V107.55L216,90v85.77Z',
  },
  shoppingBag: {
    fond: 'M224,56V200a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V56a8,8,0,0,1,8-8H216A8,8,0,0,1,224,56Z',
    trait: 'M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H40V56H216V200ZM176,88a48,48,0,0,1-96,0,8,8,0,0,1,16,0,32,32,0,0,0,64,0,8,8,0,0,1,16,0Z',
  },
  alarm: {
    fond: 'M216,136a88,88,0,1,1-88-88A88,88,0,0,1,216,136Z',
    trait: 'M128,40a96,96,0,1,0,96,96A96.11,96.11,0,0,0,128,40Zm0,176a80,80,0,1,1,80-80A80.09,80.09,0,0,1,128,216ZM61.66,37.66l-32,32A8,8,0,0,1,18.34,58.34l32-32A8,8,0,0,1,61.66,37.66Zm176,32a8,8,0,0,1-11.32,0l-32-32a8,8,0,0,1,11.32-11.32l32,32A8,8,0,0,1,237.66,69.66ZM184,128a8,8,0,0,1,0,16H128a8,8,0,0,1-8-8V80a8,8,0,0,1,16,0v48Z',
  },
  handWaving: {
    fond: 'M184,213.27A80,80,0,0,1,74.7,184l-40-69.32a20,20,0,0,1,34.64-20L55.08,70A20,20,0,0,1,89.73,50l6.92,12h0a20,20,0,0,1,34.64-20l30,52A20,20,0,0,1,196,74l17.31,30A80,80,0,0,1,184,213.27Z',
    trait: 'M220.17,100,202.86,70a28,28,0,0,0-38.24-10.25,27.69,27.69,0,0,0-9,8.34L138.2,38a28,28,0,0,0-48.48,0A28,28,0,0,0,48.15,74l1.59,2.76A27.67,27.67,0,0,0,38,80.41a28,28,0,0,0-10.24,38.25l40,69.32a87.47,87.47,0,0,0,53.43,41,88.56,88.56,0,0,0,22.92,3,88,88,0,0,0,76.06-132Zm-6.66,62.64A72,72,0,0,1,81.62,180l-40-69.32a12,12,0,0,1,20.78-12L81.63,132a8,8,0,1,0,13.85-8L62,66A12,12,0,1,1,82.78,54L114,108a8,8,0,1,0,13.85-8L103.57,58h0a12,12,0,1,1,20.78-12l33.42,57.9a48,48,0,0,0-5.54,60.6,8,8,0,0,0,13.24-9A32,32,0,0,1,172.78,112a8,8,0,0,0,2.13-10.4L168.23,90A12,12,0,1,1,189,78l17.31,30A71.56,71.56,0,0,1,213.51,162.62ZM184.25,31.71A8,8,0,0,1,194,26a59.62,59.62,0,0,1,36.53,28l.33.57a8,8,0,1,1-13.85,8l-.33-.57a43.67,43.67,0,0,0-26.8-20.5A8,8,0,0,1,184.25,31.71ZM80.89,237a8,8,0,0,1-11.23,1.33A119.56,119.56,0,0,1,40.06,204a8,8,0,0,1,13.86-8,103.67,103.67,0,0,0,25.64,29.72A8,8,0,0,1,80.89,237Z',
  },
  creditCard: {
    fond: 'M232,96v96a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V96Z',
    trait: 'M224,48H32A16,16,0,0,0,16,64V192a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V64A16,16,0,0,0,224,48Zm0,16V88H32V64Zm0,128H32V104H224v88Zm-16-24a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h32A8,8,0,0,1,208,168Zm-64,0a8,8,0,0,1-8,8H120a8,8,0,0,1,0-16h16A8,8,0,0,1,144,168Z',
  },
  megaphone: {
    fond: 'M240,120a40,40,0,0,1-40,40H160V80h40A40,40,0,0,1,240,120Z',
    trait: 'M248,120a48.05,48.05,0,0,0-48-48H160.2c-2.91-.17-53.62-3.74-101.91-44.24A16,16,0,0,0,32,40V200a16,16,0,0,0,26.29,12.25c37.77-31.68,77-40.76,93.71-43.3v31.72A16,16,0,0,0,159.12,214l11,7.33A16,16,0,0,0,194.5,212l11.77-44.36A48.07,48.07,0,0,0,248,120ZM48,199.93V40h0c42.81,35.91,86.63,45,104,47.24v65.48C134.65,155,90.84,164.07,48,199.93Zm131,8,0,.11-11-7.33V168h21.6ZM200,152H168V88h32a32,32,0,1,1,0,64Z',
  },
  notePencil: {
    fond: 'M200,88l-72,72H96V128l72-72Z',
    trait: 'M229.66,58.34l-32-32a8,8,0,0,0-11.32,0l-96,96A8,8,0,0,0,88,128v32a8,8,0,0,0,8,8h32a8,8,0,0,0,5.66-2.34l96-96A8,8,0,0,0,229.66,58.34ZM124.69,152H104V131.31l64-64L188.69,88ZM200,76.69,179.31,56,192,43.31,212.69,64ZM224,128v80a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h80a8,8,0,0,1,0,16H48V208H208V128a8,8,0,0,1,16,0Z',
  },
  webhooksLogo: {
    fond: 'M128,104a40,40,0,1,1,40-40A40,40,0,0,1,128,104Zm64,24a40,40,0,1,0,40,40A40,40,0,0,0,192,128ZM64,128a40,40,0,1,0,40,40A40,40,0,0,0,64,128Z',
    trait: 'M178.16,176H111.32A48,48,0,1,1,25.6,139.19a8,8,0,0,1,12.8,9.61A31.69,31.69,0,0,0,32,168a32,32,0,0,0,64,0,8,8,0,0,1,8-8h74.16a16,16,0,1,1,0,16ZM64,184a16,16,0,0,0,14.08-23.61l35.77-58.14a8,8,0,0,0-2.62-11,32,32,0,1,1,46.1-40.06A8,8,0,1,0,172,44.79a48,48,0,1,0-75.62,55.33L64.44,152c-.15,0-.29,0-.44,0a16,16,0,0,0,0,32Zm128-64a48.18,48.18,0,0,0-18,3.49L142.08,71.6A16,16,0,1,0,128,80l.44,0,35.78,58.15a8,8,0,0,0,11,2.61A32,32,0,1,1,192,200a8,8,0,0,0,0,16,48,48,0,0,0,0-96Z',
  },
  arrowsClockwise: {
    fond: 'M216,128a88,88,0,1,1-88-88A88,88,0,0,1,216,128Z',
    trait: 'M224,48V96a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h28.69L182.06,73.37a79.56,79.56,0,0,0-56.13-23.43h-.45A79.52,79.52,0,0,0,69.59,72.71,8,8,0,0,1,58.41,61.27a96,96,0,0,1,135,.79L208,76.69V48a8,8,0,0,1,16,0ZM186.41,183.29a80,80,0,0,1-112.47-.66L59.31,168H88a8,8,0,0,0,0-16H40a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V179.31l14.63,14.63A95.43,95.43,0,0,0,130,222.06h.53a95.36,95.36,0,0,0,67.07-27.33,8,8,0,0,0-11.18-11.44Z',
  },
  lightning: {
    fond: 'M96,240l16-80L48,136,160,16,144,96l64,24Z',
    trait: 'M215.79,118.17a8,8,0,0,0-5-5.66L153.18,90.9l14.66-73.33a8,8,0,0,0-13.69-7l-112,120a8,8,0,0,0,3,13l57.63,21.61L88.16,238.43a8,8,0,0,0,13.69,7l112-120A8,8,0,0,0,215.79,118.17ZM109.37,214l10.47-52.38a8,8,0,0,0-5-9.06L62,132.71l84.62-90.66L136.16,94.43a8,8,0,0,0,5,9.06l52.8,19.8Z',
  },
  key: {
    fond: 'M232,98.36C230.73,136.92,198.67,168,160.09,168a71.68,71.68,0,0,1-26.92-5.17h0L120,176H96v24H72v24H40a8,8,0,0,1-8-8V187.31a8,8,0,0,1,2.34-5.65l58.83-58.83h0A71.68,71.68,0,0,1,88,95.91c0-38.58,31.08-70.64,69.64-71.87A72,72,0,0,1,232,98.36Z',
    trait: 'M216.57,39.43A80,80,0,0,0,83.91,120.78L28.69,176A15.86,15.86,0,0,0,24,187.31V216a16,16,0,0,0,16,16H72a8,8,0,0,0,8-8V208H96a8,8,0,0,0,8-8V184h16a8,8,0,0,0,5.66-2.34l9.56-9.57A79.73,79.73,0,0,0,160,176h.1A80,80,0,0,0,216.57,39.43ZM224,98.1c-1.09,34.09-29.75,61.86-63.89,61.9H160a63.7,63.7,0,0,1-23.65-4.51,8,8,0,0,0-8.84,1.68L116.69,168H96a8,8,0,0,0-8,8v16H72a8,8,0,0,0-8,8v16H40V187.31l58.83-58.82a8,8,0,0,0,1.68-8.84A63.72,63.72,0,0,1,96,95.92c0-34.14,27.81-62.8,61.9-63.89A64,64,0,0,1,224,98.1ZM192,76a12,12,0,1,1-12-12A12,12,0,0,1,192,76Z',
  },
  code: {
    fond: 'M240,128l-48,40H64L16,128,64,88H192Z',
    trait: 'M69.12,94.15,28.5,128l40.62,33.85a8,8,0,1,1-10.24,12.29l-48-40a8,8,0,0,1,0-12.29l48-40a8,8,0,0,1,10.24,12.3Zm176,27.7-48-40a8,8,0,1,0-10.24,12.3L227.5,128l-40.62,33.85a8,8,0,1,0,10.24,12.29l48-40a8,8,0,0,0,0-12.29ZM162.73,32.48a8,8,0,0,0-10.25,4.79l-64,176a8,8,0,0,0,4.79,10.26A8.14,8.14,0,0,0,96,224a8,8,0,0,0,7.52-5.27l64-176A8,8,0,0,0,162.73,32.48Z',
  },
  addressBook: {
    fond: 'M208,32H64a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H208a8,8,0,0,0,8-8V40A8,8,0,0,0,208,32ZM136,144a32,32,0,1,1,32-32A32,32,0,0,1,136,144Z',
    trait: 'M83.19,174.4a8,8,0,0,0,11.21-1.6,52,52,0,0,1,83.2,0,8,8,0,1,0,12.8-9.6A67.88,67.88,0,0,0,163,141.51a40,40,0,1,0-53.94,0A67.88,67.88,0,0,0,81.6,163.2,8,8,0,0,0,83.19,174.4ZM112,112a24,24,0,1,1,24,24A24,24,0,0,1,112,112Zm96-88H64A16,16,0,0,0,48,40V64H32a8,8,0,0,0,0,16H48v40H32a8,8,0,0,0,0,16H48v40H32a8,8,0,0,0,0,16H48v24a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V40A16,16,0,0,0,208,24Zm0,192H64V40H208Z',
  },
  chartBar: {
    fond: 'M208,40V208H152V40Z',
    trait: 'M224,200h-8V40a8,8,0,0,0-8-8H152a8,8,0,0,0-8,8V80H96a8,8,0,0,0-8,8v40H48a8,8,0,0,0-8,8v64H32a8,8,0,0,0,0,16H224a8,8,0,0,0,0-16ZM160,48h40V200H160ZM104,96h40V200H104ZM56,144H88v56H56Z',
  },
  currencyEur: {
    fond: 'M184,58.33V197.67A72,72,0,0,1,64,144V112A72,72,0,0,1,184,58.33Z',
    trait: 'M190,192.33a8,8,0,0,1-.63,11.3A80,80,0,0,1,56.4,152H40a8,8,0,0,1,0-16H56V120H40a8,8,0,0,1,0-16H56.4A80,80,0,0,1,189.34,52.37,8,8,0,0,1,178.66,64.3,64,64,0,0,0,72.52,104H136a8,8,0,0,1,0,16H72v16h48a8,8,0,0,1,0,16H72.52a64,64,0,0,0,106.14,39.71A8,8,0,0,1,190,192.33Z',
  },
  sparkle: {
    fond: 'M194.82,151.43l-55.09,20.3-20.3,55.09a7.92,7.92,0,0,1-14.86,0l-20.3-55.09-55.09-20.3a7.92,7.92,0,0,1,0-14.86l55.09-20.3,20.3-55.09a7.92,7.92,0,0,1,14.86,0l20.3,55.09,55.09,20.3A7.92,7.92,0,0,1,194.82,151.43Z',
    trait: 'M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88ZM137,164.22a8,8,0,0,0-4.74,4.74L112,223.85,91.78,169A8,8,0,0,0,87,164.22L32.15,144,87,123.78A8,8,0,0,0,91.78,119L112,64.15,132.22,119a8,8,0,0,0,4.74,4.74L191.85,144ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z',
  },
  brain: {
    fond: 'M240,124a48,48,0,0,1-32,45.27h0V176a40,40,0,0,1-80,0,40,40,0,0,1-80,0v-6.73h0a48,48,0,0,1,0-90.54V72a40,40,0,0,1,80,0,40,40,0,0,1,80,0v6.73A48,48,0,0,1,240,124Z',
    trait: 'M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.2V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.41A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,50.67,86.27,8,8,0,0,0,56,78.73V72a32,32,0,0,1,64,0v68.26A47.8,47.8,0,0,0,88,128a8,8,0,0,0,0,16,32,32,0,0,1,0,64Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,168,144a8,8,0,0,0,0-16,47.8,47.8,0,0,0-32,12.26V72a32,32,0,0,1,64,0v6.73a8,8,0,0,0,5.33,7.54A40,40,0,0,1,192,164Zm16-52a8,8,0,0,1-8,8h-4a36,36,0,0,1-36-36V80a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4A8,8,0,0,1,208,112ZM60,120H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,84V80a8,8,0,0,1,16,0v4A36,36,0,0,1,60,120Z',
  },
  trash: {
    fond: 'M200,56V208a8,8,0,0,1-8,8H64a8,8,0,0,1-8-8V56Z',
    trait: 'M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z',
  },
  wallet: {
    fond: 'M224,80V192a8,8,0,0,1-8,8H56a16,16,0,0,1-16-16V56A16,16,0,0,0,56,72H216A8,8,0,0,1,224,80Z',
    trait: 'M216,64H56a8,8,0,0,1,0-16H192a8,8,0,0,0,0-16H56A24,24,0,0,0,32,56V184a24,24,0,0,0,24,24H216a16,16,0,0,0,16-16V80A16,16,0,0,0,216,64Zm0,128H56a8,8,0,0,1-8-8V78.63A23.84,23.84,0,0,0,56,80H216Zm-48-60a12,12,0,1,1,12,12A12,12,0,0,1,168,132Z',
  },
} as const satisfies Record<string, { readonly fond: string; readonly trait: string }>;

export type IconeCapacite = keyof typeof ICONES_CAPACITES;

export const CONSTRUIRE: readonly FamilleCapacites[] = [
  {
    titre: { fr: 'Répondre à vos clients', en: 'Answer your customers' },
    icone: 'chats',
    capacites: [
      {
        texte: {
          fr: 'Un agent IA qui répond jour et nuit avec votre site ou votre documentation, et passe la main à votre équipe quand il faut.',
          en: 'An AI agent that answers day and night from your site or your docs, and hands over to your team when needed.',
        },
        icone: 'robot',
        lien: { cas: 'support' },
        outils: ['create_agent', 'import_site', 'import_document_text', 'activate_agent'],
      },
      {
        texte: {
          fr: 'La bulle WhatsApp sur votre site, Lovable compris : le visiteur écrit, l’agent répond.',
          en: 'The WhatsApp bubble on your site, Lovable included: the visitor writes, the agent answers.',
        },
        icone: 'chatCircleDots',
        lien: { cas: 'bulle-lovable' },
        outils: ['create_widget'],
      },
      {
        texte: {
          fr: 'La prise de rendez-vous dans la conversation : l’agent note le motif, votre app propose les créneaux.',
          en: 'Appointment booking in the conversation: the agent notes the reason, your app offers the slots.',
        },
        icone: 'calendarCheck',
        lien: { cas: 'rendez-vous' },
        outils: ['set_agent_action'],
      },
      {
        texte: {
          fr: 'Vos heures d’ouverture, et ce que l’agent promet quand il passe la main à votre équipe.',
          en: 'Your opening hours, and what the agent promises when it hands over to your team.',
        },
        icone: 'clock',
        lien: { outil: 'set_business_hours' },
        outils: ['set_business_hours', 'set_transfer_mode'],
      },
      {
        texte: {
          fr: 'L’agent essayé sur une conversation fictive avant vos clients, et ses limites par conversation : réponses, actions, crédit.',
          en: 'The agent tried on a mock conversation before your customers, and its limits per conversation: answers, actions, credit.',
        },
        icone: 'flask',
        lien: { outil: 'test_agent' },
        outils: ['test_agent', 'set_agent_limits'],
      },
      {
        texte: {
          fr: 'Vos conversations lues et répondues depuis Claude, dans la fenêtre de 24 heures ou par un modèle, puis la main rendue au répondeur automatique.',
          en: 'Your conversations read and answered from Claude, within the 24-hour window or with a template, then handed back to the automatic responder.',
        },
        icone: 'arrowBendUpLeft',
        lien: { page: { fr: '/developpeurs/repondre-a-une-conversation/', en: '/en/developers/reply-to-a-conversation/' } },
        outils: ['get_conversation', 'reply_in_open_window', 'control_conversation'],
      },
      {
        texte: {
          fr: 'Votre équipe dans l’Inbox de la console : Claude lui confie et étiquette les conversations.',
          en: 'Your team in the console Inbox: Claude assigns and tags conversations for it.',
        },
        icone: 'usersThree',
        lien: { outil: 'assign_conversation' },
        outils: ['assign_conversation', 'tag_conversation'],
      },
    ],
  },
  {
    titre: { fr: 'Leur écrire au bon moment', en: 'Message them at the right time' },
    icone: 'cloche',
    capacites: [
      {
        texte: {
          fr: 'Le suivi de commande quand elle part, et l’agent IA si le client répond.',
          en: 'Order tracking when it ships, and the AI agent if the customer replies.',
        },
        icone: 'package',
        lien: { cas: 'notifications' },
      },
      {
        texte: {
          fr: 'Votre boutique Shopify branchée par Claude : confirmation de commande, avis d’expédition, relance de panier, et vos clients abonnés importés.',
          en: 'Your Shopify store connected by Claude: order confirmation, shipping notice, checkout reminder, and your subscribed customers imported.',
        },
        icone: 'shoppingBag',
        lien: { page: { fr: '/solutions/shopify/', en: '/en/solutions/shopify-stores/' } },
        outils: ['connect_shopify', 'set_shopify_message', 'import_shopify_customers'],
      },
      {
        texte: {
          fr: 'Le rappel la veille du rendez-vous : le client confirme ou décale d’un bouton.',
          en: 'The reminder the day before the appointment: the customer confirms or reschedules with one button.',
        },
        icone: 'alarm',
        lien: { cas: 'rappels' },
      },
      {
        texte: {
          fr: 'Le message de bienvenue à l’inscription, avec un bouton vers le premier usage de votre produit.',
          en: 'The welcome message at sign-up, with a button to the first use of your product.',
        },
        icone: 'handWaving',
        lien: { cas: 'accueil' },
      },
      {
        texte: {
          fr: 'La relance d’un paiement échoué, avec le lien pour mettre à jour la carte.',
          en: 'The failed payment reminder, with the link to update the card.',
        },
        icone: 'creditCard',
        lien: { cas: 'relance-paiement' },
      },
      {
        texte: {
          fr: 'Une campagne vers vos contacts, préparée par Claude et lancée avec votre oui.',
          en: 'A campaign to your contacts, prepared by Claude and launched with your yes.',
        },
        icone: 'megaphone',
        lien: { page: { fr: '/developpeurs/preparer-une-campagne/', en: '/en/developers/prepare-a-campaign/' } },
        outils: ['find_contacts', 'prepare_campaign', 'launch_campaign'],
      },
      {
        texte: {
          fr: 'Vos modèles écrits par Claude et soumis à Meta, et le motif d’un refus.',
          en: 'Your templates written by Claude and submitted to Meta, and the reason for a rejection.',
        },
        icone: 'notePencil',
        lien: { doc: 'templates' },
        outils: ['create_template', 'get_template_status'],
      },
    ],
  },
  {
    titre: { fr: 'Brancher à votre app', en: 'Connect it to your app' },
    icone: 'prises',
    capacites: [
      {
        texte: {
          fr: 'Chaque message reçu, livré, lu ou en échec, poussé vers votre app par un webhook signé.',
          en: 'Every message received, delivered, read or failed, pushed to your app by a signed webhook.',
        },
        icone: 'webhooksLogo',
        lien: { doc: 'webhooks' },
      },
      {
        texte: {
          fr: 'Vos webhooks créés, testés et rejoués depuis Claude.',
          en: 'Your webhooks created, tested and replayed from Claude.',
        },
        icone: 'arrowsClockwise',
        lien: { doc: 'webhook-endpoints' },
        outils: ['create_webhook_endpoint', 'send_test_event', 'replay_webhook_delivery'],
      },
      {
        texte: {
          fr: 'Votre agent IA qui déclenche votre code quand un client demande une démo, une résiliation ou un rappel.',
          en: 'Your AI agent triggering your code when a customer asks for a demo, a cancellation or a callback.',
        },
        icone: 'lightning',
        lien: { doc: 'webhooks' },
        outils: ['set_agent_action'],
      },
      {
        texte: {
          fr: 'La clé d’API de votre application, créée par Claude et rangée dans votre .env.',
          en: 'Your application’s API key, created by Claude and put in your .env.',
        },
        icone: 'key',
        lien: { doc: 'reference' },
        outils: ['create_api_key'],
      },
      {
        texte: {
          fr: 'Vos envois par l’API ou le SDK TypeScript, rejouables sans doublon grâce à la clé d’idempotence.',
          en: 'Your sends through the API or the TypeScript SDK, safe to retry without duplicates thanks to the idempotency key.',
        },
        icone: 'code',
        lien: { doc: 'sdk' },
      },
      {
        texte: {
          fr: 'Vos contacts et leur consentement tenus à jour depuis votre app, et les champs de vos fiches créés par Claude.',
          en: 'Your contacts and their consent kept up to date from your app, and your record fields created by Claude.',
        },
        icone: 'addressBook',
        lien: { doc: 'contacts' },
        outils: ['create_field'],
      },
    ],
  },
  {
    titre: { fr: 'Piloter depuis Claude', en: 'Run it from Claude' },
    icone: 'graphique',
    capacites: [
      {
        texte: {
          fr: 'Vos modèles envoyés, livrés, lus ou en échec : il suffit de demander à Claude.',
          en: 'Your templates sent, delivered, read or failed: just ask Claude.',
        },
        icone: 'chartBar',
        lien: { outil: 'get_message_stats' },
        outils: ['get_message_stats'],
      },
      {
        texte: {
          fr: 'Le coût estimé et les clics de vos campagnes, et les erreurs de Meta.',
          en: 'The estimated cost and clicks of your campaigns, and Meta’s errors.',
        },
        icone: 'currencyEur',
        lien: { page: { fr: '/fonctionnalites/pilotage-des-couts/', en: '/en/features/cost-control/' } },
        outils: ['get_campaign_stats'],
      },
      {
        texte: {
          fr: 'Le coût de votre agent IA, ses messages et les demandes ouvertes pour votre équipe.',
          en: 'Your AI agent’s cost, its messages and the requests opened for your team.',
        },
        icone: 'sparkle',
        lien: { outil: 'get_ai_stats' },
        outils: ['get_ai_stats'],
      },
      {
        texte: {
          fr: 'Ce que disent vos conversations : sentiment, intentions, sujets, urgence.',
          en: 'What your conversations say: sentiment, intents, topics, urgency.',
        },
        icone: 'brain',
        lien: { page: { fr: '/fonctionnalites/conversations-en-actions/', en: '/en/features/conversations-into-actions/' } },
        outils: ['get_conversation_insights'],
      },
      {
        texte: {
          fr: 'Vos contacts en trop supprimés en masse avec votre accord, et un contact bloqué d’une phrase.',
          en: 'Your surplus contacts deleted in bulk with your agreement, and a contact blocked in one sentence.',
        },
        icone: 'trash',
        lien: { outil: 'prepare_contacts_deletion' },
        outils: ['prepare_contacts_deletion', 'delete_contacts', 'block_contact'],
      },
      {
        texte: {
          fr: 'La formule Pro, la ligne de crédit, le crédit IA et l’abonnement du numéro fourni, réglés depuis Claude.',
          en: 'The Pro plan, the credit line, AI credit and the provided number’s subscription, handled from Claude.',
        },
        icone: 'wallet',
        lien: { page: { fr: '/tarifs/', en: '/en/pricing/' } },
        outils: ['get_plan', 'buy_credit', 'subscribe_pro', 'take_credit_line', 'manage_number_subscription'],
      },
    ],
  },
];
