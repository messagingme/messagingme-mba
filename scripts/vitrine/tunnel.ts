// scripts/vitrine/tunnel.ts
// Le tunnel du numéro WhatsApp (l'arbre de Julien du 2026-10-30), écrit une fois et posé sur chaque page qui le porte :
// la page « Démarrer » (`pagesDemarrer`, ici), Boutiques Shopify (`boutique.ts`) et SaaS et app builders (`cas.ts`).
// Textes dans `tunnel-textes.ts` ; `site.js` le rend interactif, et il reste lisible sans script (ses issues en liste).
// Plan `docs/superpowers/plans/2026-10-30-tunnel-numero-generique.md`.
import { AUTORISATION_CODEX, COMMANDES_CODEX, COMMANDES_PLUGIN, DEPOT_PLUGIN, SERVEUR_PLUGIN_MCP } from '../../web/lib/demarrer';
import { ACCUEIL, fichierDe, fil, page } from './cas';
import type { Langue } from './cas-textes';
import { echapper, insecables } from './guide-meta';
import { dimensionsWebp, versionnee } from './images';
import { LOGOS_ASSISTANTS } from './logos-assistants';
import {
  lienHtml,
  TEXTES_TUNNEL, demandeDe, type Issue, type IssueBranchement, type Lien, type Mot, type OffreTunnel, type Origine, type Question, type Reponse, type TexteTunnel,
  type Voie,
} from './tunnel-textes';

const CONSOLE = 'https://console.messagingme.app';
const PLUGIN: Readonly<Record<Langue, string>> = { fr: '/developpeurs/installer-le-plugin/', en: '/en/developers/install-the-plugin/' };
/** La page Contact : son formulaire pour la démo (`#formulaire`), la page elle-même pour nous écrire. */
const CONTACT: Readonly<Record<Langue, string>> = { fr: '/contact/', en: '/en/contact/' };
/**
 * Une commande en HTML : échappée, et sécable après un `/`, un `@` ou un `:` qui suit un caractère (`<wbr>`). Un écran
 * étroit la coupe là plutôt qu'au milieu d'un mot, qu'on recopierait de travers ; le texte copié reste la commande exacte,
 * et un `/` de tête (`/mcp`) ne se détache jamais.
 */
export const commandeHtml = (c: string): string => echapper(c).replace(/(\S)([/@:])/g, '$1$2<wbr>');

/** Les assistants des étapes de la Free : leur logo (`LOGOS_ASSISTANTS`, celui des tuiles de la page SaaS) et leur nom. */
const ASSISTANTS = { claude: 'Claude Code', codex: 'Codex' } as const;
type Assistant = keyof typeof ASSISTANTS;
const logo = (cle: Assistant): string =>
  `<span class="bt-assist bt-assist-${cle}"><svg viewBox="${LOGOS_ASSISTANTS[cle].viewBox}" aria-hidden="true">${LOGOS_ASSISTANTS[cle].corps}</svg></span>`;

/** La page qui porte le tunnel seul ; `?offre=` (free, pro, business, entreprise) y répond à la première question (`site.js`). */
export const DEMARRER: Readonly<Record<Langue, string>> = { fr: '/demarrer/', en: '/en/get-started/' };
/**
 * L'inscription qui mène à la souscription du Pro (`?offre=pro`, `arriveeDUnNouvelEspace`, `web/lib/session.ts`), jamais
 * au tunnel de la Free, qui est le chemin d'une inscription sans ce drapeau.
 */
export const inscriptionPro = (langue: Langue): string => `${CONSOLE}/signup?offre=pro${langue === 'en' ? '&amp;lang=en' : ''}`;

const deux = (l: readonly [string, string]) => `${l[0]} <span class="sec-accent">${l[1]}</span>`;

/** La question d'où part le guide du centre d'aide (lot 4a) : « Qui paie vos messages à Meta ? », comme la console. */
export const DEPART_GUIDE = 'paiement';

/** Les questions et les issues qu'on atteint depuis une question, dans l'ordre de l'arbre : le guide en garde ce bout-là. */
export function arbreDepuis(n: TexteTunnel, depart: string): { questions: Question[]; issues: Issue[] } {
  const vues = new Set<string>();
  const aVoir = [depart];
  while (aVoir.length > 0) {
    const id = aVoir.pop()!;
    if (vues.has(id)) continue;
    vues.add(id);
    for (const r of n.questions.find((q) => q.id === id)?.reponses ?? []) if (r.vers) aVoir.push(r.vers);
  }
  const questions = n.questions.filter((q) => vues.has(q.id));
  if (questions[0]?.id !== depart) throw new Error(`tunnel : le guide doit commencer par ${depart}`);
  return { questions, issues: n.issues.filter((x) => vues.has(x.id)) };
}

/** Le titre et la description du guide, son nombre de questions calculé sur l'arbre (`{n}`). */
export const titreGuide = (langue: Langue): { titre: string; description: string } => {
  const n = TEXTES_TUNNEL[langue];
  const max = String(profondeurTunnel(arbreDepuis(n, DEPART_GUIDE).questions));
  return { titre: n.guide.titre.replace('{n}', max), description: n.guide.description.replace('{n}', max) };
};

/**
 * La phrase à dire à Claude au bout du guide : celle du numéro de l'issue, sans son prix (Claude lit l'offre de l'espace,
 * le guide ne la connaît pas).
 */
export const phraseGuide = (n: TexteTunnel, x: IssueBranchement): string => `${n.guide.demande} ${x.numero.pro.replace(n.guide.retirer, '')}`;

/** Le plus long parcours de l'arbre, en questions : la jauge, « Question n sur … » et le chapeau le lisent ici. */
export function profondeurTunnel(questions: readonly Question[]): number {
  const profondeur = (id: string): number => {
    const q = questions.find((x) => x.id === id);
    return q ? 1 + Math.max(...q.reponses.map((r) => (r.vers ? profondeur(r.vers) : 0))) : 0;
  };
  return profondeur(questions[0]!.id);
}

/**
 * Le tunnel : une carte, la question en cours en grand et l'étape au-dessus, puis les mots qu'il emploie, repliés
 * dessous. Une question à cartes (`voies`) porte SOUS chaque carte la réponse de même rang. Sans script, les questions
 * restent cachées et les issues se lisent l'une sous l'autre, chacune précédée de sa situation et suivie des boutons de
 * chaque offre ; avec `site.js`, chaque réponse montre la question suivante (`data-vers`) ou une issue (`data-chemin`)
 * plus bas, la question répondue reste affichée, sa réponse en évidence (Julien, 2026-10-30 : « on garde le carré
 * sélectionné et on passe à la question suivante plus bas »), et une autre réponse cliquée change le chemin ; l'offre
 * choisie (`data-offre`) ne laisse que ses boutons, et un lien d'issue (`data-vers-chemin`) en montre une autre.
 */
export function tunnel(langue: Langue, origine: Origine, mode: 'demarrer' | 'guide' = 'demarrer'): string[] {
  const n = TEXTES_TUNNEL[langue];
  const a = n.appels;
  // Le guide du centre d'aide (lot 4a) ne garde que l'arbre atteint depuis « Qui paie vos messages à Meta ? ».
  const arbre = mode === 'guide' ? arbreDepuis(n, DEPART_GUIDE) : { questions: n.questions, issues: n.issues };
  const max = profondeurTunnel(arbre.questions);
  const progression = n.progression.replace('{max}', String(max));
  // Une réponse grisée (le Crédit WhatsApp, qui se prend dans la console) : un bouton qui ne se choisit pas, et sa carte
  // dit pourquoi ou où.
  const bouton = (q: Question, r: Reponse, k: number) => (r.grisee
    ? `<button type="button" class="bouton bouton-trait" disabled>${r.libelle}</button>`
    : r.vers
    ? `<button type="button" class="bouton bouton-trait" data-vers="${r.vers}"${r.offre ? ` data-offre="${r.offre}"` : ''}${r.note ? ` data-note="note-${q.id}-${k}"` : ''} aria-pressed="false">${r.libelle}</button>`
    : `<button type="button" class="bouton bouton-texte" data-aide aria-expanded="false">${r.libelle}</button>`);
  const ligne = (classe: string, icone: string, sr: string) => (x: string) =>
    `                    <li class="${classe}"><svg class="ic" aria-hidden="true"><use href="#${icone}"/></svg><span class="bt-sr">${sr} </span>${x}</li>`;
  // La raison d'une carte grisée, une par formule : seule celle de la formule choisie plus haut s'affiche (`data-pour`,
  // la règle de `site.css`).
  // Une carte de formule (2026-11-13) : son nom, son prix en grand et son unité, et au pied ce qu'il faut pour s'en servir
  // (`note`, où `{claude}` et `{codex}` deviennent le logo et le nom de l'assistant) ; une carte sans liste n'en a pas.
  const assistant = (cle: Assistant) => `<span class="bt-ide">${logo(cle)}${ASSISTANTS[cle]}</span>`;
  const voie = (v: Voie, r: Reponse) => [
    '                <section class="bt-voie">',
    ...(v.badge ? [`                  <p class="bt-badge">${v.badge}</p>`] : []),
    `                  <h4>${v.titre}</h4>`,
    ...(v.prix ? [`                  <p class="bt-tarif"><strong>${v.prix}</strong>${v.unite ? `<span>${v.unite}</span>` : ''}</p>`] : []),
    ...(v.plus.length + v.moins.length > 0 ? [
      '                  <ul>',
      ...v.plus.map(ligne('bt-plus', 'i-check', n.plus)),
      ...v.moins.map(ligne('bt-moins', 'i-x', n.moins)),
      '                  </ul>',
    ] : []),
    ...(v.note ? [`                  <p class="bt-voie-note">${v.note.replace('{claude}', assistant('claude')).replace('{codex}', assistant('codex'))}</p>`] : []),
    // Un lien à bulle (2026-11-13) : sa réponse s'ouvre sur place (survol, ou clic qui ne quitte pas le tunnel, `site.js`),
    // et la page reste à un clic, dans la bulle.
    ...(v.liens ? [`                  <p class="bt-voie-liens">${v.liens.map((l) => (l.bulle
      ? `<span class="bt-info"><a href="${l.href}" target="_blank" rel="noopener" aria-expanded="false">${l.libelle}</a><span class="bt-bulle" role="tooltip">${l.bulle} <a href="${l.href}" target="_blank" rel="noopener">${n.lireFiche}</a></span></span>`
      : `<a href="${l.href}" target="_blank" rel="noopener">${l.libelle}</a>`)).join('')}</p>`] : []),
    ...Object.entries(r.grisee ?? {}).map(([offre, raison]) => `                  <p class="bt-grisee" data-pour="${offre}">${raison}</p>`),
    '                </section>',
  ];
  // Une question à cartes : sous chaque carte, la réponse de même rang ; ce qui reste (« Je ne sais pas ») vient dessous.
  const reponses = (q: Question): string[] => {
    const toutes = q.reponses.map((r, k) => ({ r, k }));
    if (!q.voies) return [`            <div class="bt-reponses">${toutes.map(({ r, k }) => bouton(q, r, k)).join('')}</div>`];
    // Une réponse grisée a sa carte, comme une réponse qui mène quelque part.
    const menent = toutes.filter(({ r }) => r.vers || r.grisee);
    const autres = toutes.filter(({ r }) => !r.vers && !r.grisee);
    if (menent.length !== q.voies.length) throw new Error(`tunnel : ${q.id} a ${q.voies.length} cartes et ${menent.length} réponses qui mènent quelque part`);
    // Les cartes sur une rangée (les formules ne disent plus que leur nom et leur prix, 2026-11-13 : le carrousel est parti).
    return [
      `            <div class="bt-voies" id="voies-${q.id}">`,
      ...q.voies.flatMap((v, i) => [
        `              <div class="bt-voie-choix${menent[i]!.r.grisee ? ' bt-voie-grisee' : ''}">`, ...voie(v, menent[i]!.r), `                ${bouton(q, menent[i]!.r, menent[i]!.k)}`, '              </div>',
      ]),
      '            </div>',
      ...(autres.length > 0 ? [`            <div class="bt-reponses">${autres.map(({ r, k }) => bouton(q, r, k)).join('')}</div>`] : []),
    ];
  };
  const question = (q: Question, i: number) => [
    `          <fieldset class="bt-question" data-question="${q.id}"${q.voies ? ` aria-describedby="voies-${q.id}"` : ''}${i > 0 ? ' hidden' : ''}>`,
    `            <legend${q.logo ? ' class="bt-avec-logo"' : ''}>${q.logo ? `<img class="bt-logo" src="${q.logo}" alt="" width="40" height="40">` : ''}${q.texte}${q.precision ? `<span class="bt-precision">${q.precision}</span>` : ''}</legend>`,
    ...reponses(q),
    ...(q.aide ? [`            <p class="bt-aide" hidden>${q.aide}</p>`] : []),
    ...q.reponses.flatMap((r, k) => (r.note ? [`            <p class="bt-note-reponse" id="note-${q.id}-${k}" role="status" hidden>${r.note}</p>`] : [])),
    '          </fieldset>',
  ];
  // Le bout de l'arbre, par offre : trois étapes (installer le plugin, le relier à Messaging Me, coller la demande), en
  // Free comme en Pro par l'assistant (lot 3c) ; le Pro par la console a son issue. La demande reprend les réponses et
  // parle de la page d'origine.
  const boite = (x: IssueBranchement, offre: OffreTunnel, retrait: string) =>
    `${retrait}<div class="bt-demande" data-offre="${offre}"><p id="demande-${x.id}-${offre}">${demandeDe(n, x, offre, origine)}</p><button type="button" class="bouton bouton-trait" data-copier="demande-${x.id}-${offre}" data-copie="${a.copie}" hidden>${a.copier}</button></div>`;
  // Les étapes de la Free (Julien, 2026-11-09 : « faut être visuel, personne ne lit le texte »), leurs commandes celles
  // des manifestes du plugin (`web/lib/demarrer.ts`).
  const ef = a.etapesFree;
  // Une commande par ligne : lisible, et copiable, jusqu'au téléphone. Les retours à la ligne autour de chacune ne se
  // voient pas (la ligne est une colonne flexible) mais la mettent seule sur sa ligne pour qui lit le texte seul (robots,
  // mode lecture, et `tests/vitrine-developpeurs.test.ts`, qui reconnaît ainsi chaque commande du plugin).
  const lignes = (cmds: readonly string[]) => `<p class="bt-cmds">\n${cmds.map((c) => `<code>${commandeHtml(c)}</code>`).join('\n')}\n</p>`;
  // Un assistant par ligne : son logo et son nom, un indice de deux ou trois mots, et en face ce qu'on y tape.
  const outil = (cle: Assistant, indice: string, contenu: string) =>
    `<div class="bt-outil"><div class="bt-outil-tete">${logo(cle)}<span class="bt-outil-nom">${ASSISTANTS[cle]}<small>${indice}</small></span></div>${contenu}</div>`;
  // Dans Claude Code, on TAPE `/mcp`, puis on CHOISIT le serveur et Authenticate dans ses listes : deux choix, pas des
  // commandes, d'où leur forme à part (`.bt-choix`).
  const suite = `<p class="bt-suite"><code>/mcp</code><span class="bt-puis" aria-hidden="true">›</span><span class="bt-choix">${commandeHtml(SERVEUR_PLUGIN_MCP)}</span><span class="bt-puis" aria-hidden="true">›</span><span class="bt-choix">Authenticate</span></p>`;
  // Les écrans de la page d'autorisation qui s'ouvre ensuite, capturés sur la vraie page (`ecrans` des textes) : leur
  // adresse porte l'empreinte du fichier, et leurs dimensions viennent de lui.
  const ecrans = ef.relier.ecrans.map((e, i) => {
    const adresse = `/img/demarrer/autoriser-${i + 1}${langue === 'en' ? '-en' : ''}.webp`;
    const { largeur, hauteur } = dimensionsWebp(adresse);
    return `<li><figure class="bt-ecran"><span class="bt-fenetre"><img src="${versionnee(adresse)}" alt="${echapper(e.alt).replace(/"/g, '&quot;')}" width="${largeur}" height="${hauteur}" loading="lazy" decoding="async"></span><figcaption>${e.legende}</figcaption></figure></li>`;
  }).join('');
  // Le détour par e-mail : la page du lien reçu, où l'on nomme son espace (jaune de 76a0e2b4), capturée comme les autres.
  const detour = (() => {
    const adresse = `/img/demarrer/autoriser-4${langue === 'en' ? '-en' : ''}.webp`;
    const { largeur, hauteur } = dimensionsWebp(adresse);
    const d = ef.relier.detour;
    return `<li><figure class="bt-ecran"><span class="bt-fenetre"><img src="${versionnee(adresse)}" alt="${echapper(d.alt).replace(/"/g, '&quot;')}" width="${largeur}" height="${hauteur}" loading="lazy" decoding="async"></span><figcaption>${d.legende}</figcaption></figure></li>`;
  })();
  // Les trois étapes, en Free comme en Pro par l'assistant (lot 3c) : UNE fois par issue (jaune 7 de la relecture des lots
  // 3b et 3c : deux copies, +54 Ko par page), seule la demande collée à l'étape 3 changeant selon l'offre (`data-offre`,
  // que `site.css` masque pour l'autre offre une fois la formule choisie ; sans script, les deux demandes se lisent).
  const etapes = (x: IssueBranchement) => [
    '            <ol class="bt-etapes bt-etapes-fin">',
    `              <li><span class="bt-num">1</span><div><h4>${ef.installer.titre}</h4><div class="bt-outils">${outil('claude', ef.installer.claude, lignes(COMMANDES_PLUGIN))}${outil('codex', ef.installer.codex, lignes(COMMANDES_CODEX))}</div>`,
    `                <div class="bt-appels-boutons"><a class="bouton bouton-trait" href="${PLUGIN[langue]}">${a.plugin}</a><a class="bouton bouton-trait" href="${DEPOT_PLUGIN}" rel="noopener"><svg class="ic" aria-hidden="true"><use href="#i-github"/></svg>${a.github}</a></div></div></li>`,
    `              <li><span class="bt-num">2</span><div><h4>${ef.relier.titre} <span class="bt-oblig">${ef.relier.obligatoire}</span></h4><div class="bt-outils">${outil('claude', ef.relier.claude, suite)}${outil('codex', ef.relier.codex, `${lignes([AUTORISATION_CODEX])}<p class="bt-outil-note">${ef.relier.codexNote}</p>`)}</div>`,
    `                <p class="bt-ecrans-titre">${ef.relier.navigateur}</p><ol class="bt-ecrans">${ecrans}</ol><p class="bt-ecrans-titre">${ef.relier.detour.titre}</p><ol class="bt-ecrans bt-ecrans-detour">${detour}</ol></div></li>`,
    `              <li><span class="bt-num">3</span><div><h4>${ef.coller}</h4>`,
    boite(x, 'free', '                '),
    boite(x, 'pro', '                '),
    '              </div></li>',
    '            </ol>',
  ];
  const liens = (l: readonly Lien[], retrait: string) =>
    [`${retrait}<p class="bt-liens">${l.map(lienHtml).join('')}</p>`];
  // Business et Entreprise : la démo et le contact, sans demande à coller (Julien, 2026-10-30) ; les autres issues, les
  // boutons de Free et de Pro.
  const finGuide = (x: Issue): string[] => {
    if (!x.numero) throw new Error(`tunnel : l’issue ${x.id} n’a rien à faire dans le guide`);
    const g = n.guide;
    // Chaque chemin porte sa voie (Julien, 2026-11-11) : venu de « Démarrer avec la console », le guide ne pousse pas la
    // phrase à dire à Claude ; venu de « Démarrer avec Claude Code ou Codex », pas le bouton de la console (`data-voie`).
    return [
      '          <div class="bt-appels">',
      `            <div class="bt-appels-boutons"><a class="bouton bouton-plein" href="${x.pasAPas}">${g.fin.pasAPas}</a><a class="bouton bouton-trait" data-voie="console" href="${CONSOLE}/connecter-whatsapp${langue === 'en' ? '?lang=en' : ''}">${g.fin.console}</a></div>`,
      '            <div data-voie="claude">',
      `            <p class="bt-appels-titre bt-guide-claude">${g.fin.claude}</p>`,
      `            <div class="bt-demande"><p id="demande-${x.id}-guide">${phraseGuide(n, x)}</p><button type="button" class="bouton bouton-trait" data-copier="demande-${x.id}-guide" data-copie="${a.copie}" hidden>${a.copier}</button></div>`,
      '            </div>',
      '          </div>',
    ];
  };
  const fin = (x: Issue): string[] => (mode === 'guide' ? finGuide(x) : x.contact
    ? [
      '          <div class="bt-appels">',
      `            <p class="bt-appels-titre">${a.equipe}</p>`,
      `            <div class="bt-appels-boutons"><a class="bouton bouton-plein" href="${CONTACT[langue]}#formulaire">${a.demo}</a><a class="bouton bouton-trait" href="${CONTACT[langue]}">${a.contacter}</a></div>`,
      '          </div>',
    ]
    : x.console
      // Le Pro par la console (lot 3c) : l'espace en Pro, et le pas-à-pas de la console ; la console pose la suite.
      ? [
        '          <div class="bt-appels">',
        `            <p class="bt-appels-titre">${a.pro}</p>`,
        `            <div class="bt-appels-boutons"><a class="bouton bouton-plein" href="${inscriptionPro(langue)}">${a.compte}</a><a class="bouton bouton-trait" href="${x.pasAPas}">${a.pasAPas}</a></div>`,
        '          </div>',
      ]
      : [
        '          <div class="bt-appels">',
        `            <p class="bt-appels-titre" data-offre="free">${a.free}</p>`,
        `            <p class="bt-appels-titre" data-offre="pro">${a.proAssistant}</p>`,
        ...etapes(x),
        '          </div>',
      ]);
  const issue = (x: Issue) => [
    `        <article class="bt-chemin" data-chemin="${x.id}" id="numero-${x.id}">`,
    `          <p class="bt-situation">${x.situation}</p>`,
    // Le titre reçoit le focus en fin de tunnel (`site.js`) : un lecteur d'écran l'annonce et lit l'issue depuis le début.
    `          <h3 tabindex="-1">${x.titre}</h3>`,
    ...x.textes.map((p) => `          <p>${p}</p>`),
    ...(x.liens ? liens(x.liens, '          ') : []),
    ...(x.autre ? [`          <p class="bt-autre">${x.autre.question} <a href="#numero-${x.autre.vers}" data-vers-chemin="${x.autre.vers}">${x.autre.lien}</a></p>`] : []),
    ...fin(x),
    '        </article>',
  ];
  // Un mot par ligne : le mot et sa phrase courte se lisent sans ouvrir, le détail et ses liens au clic.
  const mot = (x: Mot) => [
    '            <li><details class="bt-mot">',
    `              <summary><strong>${x.terme}</strong><span>${x.court}</span><svg class="ic" aria-hidden="true"><use href="#i-caret-down"/></svg></summary>`,
    `              <p>${x.detail}</p>`,
    ...(x.liens ? liens(x.liens, '              ') : []),
    '            </details></li>',
  ];
  const html = [
    // Le guide (lot 4a) ne pose pas la question de l'offre : `data-mode` y laisse lire chaque raison d'une carte grisée.
    `      <div class="bt-guide" data-guide-numero${mode === 'guide' ? ' data-mode="guide"' : ''}>`,
    '        <div class="bt-tunnel">',
    `          <div class="bt-progression" data-progression="${progression}" data-max="${max}" data-fin="${n.fin}" hidden>`,
    `            <p class="bt-etape" data-etape>${progression.replace('{n}', '1')}</p>`,
    '            <div class="bt-piste" aria-hidden="true"><span class="bt-jauge" data-jauge></span></div>',
    '          </div>',
    '          <div class="bt-questions" hidden>',
    ...arbre.questions.flatMap(question),
    `            <button type="button" class="bt-recommencer" data-recommencer hidden>${n.recommencer}</button>`,
    '          </div>',
    // Sans région live : le focus va au titre de l'issue montrée (`site.js`), et une région live la relirait en entier
    // par-dessus, étapes et commandes comprises.
    '          <div class="bt-chemins">',
    ...arbre.issues.flatMap(issue),
    '          </div>',
    '        </div>',
    '        <details class="bt-lexique">',
    `          <summary>${n.lexique.titre}<svg class="ic" aria-hidden="true"><use href="#i-caret-down"/></svg></summary>`,
    '          <ul class="bt-mots">',
    ...n.lexique.termes.flatMap(mot),
    '          </ul>',
    '        </details>',
    '      </div>',
  ];
  // En français, la ponctuation haute et les guillemets gardent leur espace insécable (sans effet sur une page qui le
  // fait déjà pour tout son `<main>`).
  return langue === 'fr' ? html.map(insecables) : html;
}

/** La section qui porte le tunnel sur une page (`#numero`), son titre au-dessus. */
export function sectionTunnel(langue: Langue, origine: Origine, classe = 'f-bloc bt-numero'): string[] {
  const n = TEXTES_TUNNEL[langue];
  const tete = [
    `      <p class="f-surtitre">${n.surtitre}</p>`,
    `      <h2 class="f-titre">${deux(n.titre)}</h2>`,
    `      <p class="f-texte">${n.chapeau}</p>`,
  ];
  return [
    `  <section class="${classe}" id="numero">`,
    '    <div class="cadre">',
    ...(langue === 'fr' ? tete.map(insecables) : tete),
    ...tunnel(langue, origine),
    '    </div>',
    '  </section>',
  ];
}

/**
 * La page « Démarrer » (placement choisi par Julien le 2026-10-30) : le tunnel seul, sous son titre, pour le bouton de
 * l'en-tête, les offres de la page Tarifs (`?offre=`) et l'Accueil. Ses deux langues viennent d'ici, pas de l'outil
 * anglais (`hors`, `anglais.ts`).
 */
export const TEXTES_DEMARRER = {
  fr: {
    titre: 'Démarrer : votre numéro WhatsApp en six questions · Messaging Me',
    description: 'Free ou Pro, qui paie Meta, compte Meta Business, application WhatsApp Business, numéro : six questions au plus, et la demande à coller dans Claude Code.',
    fil: 'Démarrer',
    h1: ['Branchez votre WhatsApp,', 'en six questions.'],
    chapeau: 'Votre offre, qui paie Meta, votre compte Meta Business, votre application WhatsApp Business, votre numéro : à la fin, vous savez quoi faire, et vous avez la demande à coller dans Claude Code ou Codex.',
    appel: { titre: 'Vous préférez qu’on en parle ?', texte: 'Une démo sur votre cas : vos clients, vos conversations, votre numéro.', bouton: 'Demander une démo', contact: '/contact/#formulaire' },
  },
  en: {
    titre: 'Get started: your WhatsApp number in six questions · Messaging Me',
    description: 'Free or Pro, who pays Meta, Meta Business account, WhatsApp Business app, number: six questions at most, then the request to paste into Claude Code.',
    fil: 'Get started',
    h1: ['Connect your WhatsApp,', 'in six questions.'],
    chapeau: 'Your plan, who pays Meta, your Meta Business account, your WhatsApp Business app, your number: at the end, you know what to do, and you have the request to paste into Claude Code or Codex.',
    appel: { titre: 'Would you rather talk it through?', texte: 'A demo on your case: your customers, your conversations, your number.', bouton: 'Request a demo', contact: '/en/contact/#formulaire' },
  },
} as const;

export function pagesDemarrer(): Array<{ chemin: string; contenu: string }> {
  return (['fr', 'en'] as const).map((langue) => {
    const t = TEXTES_DEMARRER[langue];
    const autre = langue === 'fr' ? 'en' : 'fr';
    const tete = [
      `      <h1><span class="f-surtitre"><svg class="ic" aria-hidden="true"><use href="#i-whatsapp"/></svg>${t.fil}</span> ${t.h1[0]} <span class="sec-accent">${t.h1[1]}</span></h1>`,
      `      <p class="chapeau">${t.chapeau}</p>`,
    ];
    const main = [
      '<main>',
      '  <section class="cadre f-une-large demarrer-une" id="numero">',
      '    <div>',
      ...(langue === 'fr' ? tete.map(insecables) : tete),
      '    </div>',
      ...tunnel(langue, 'generique'),
      '  </section>',
      '',
      '  <section class="f-appel">',
      '    <div class="cadre">',
      `      <h2 class="f-titre">${langue === 'fr' ? insecables(t.appel.titre) : t.appel.titre}</h2>`,
      `      <p class="f-texte">${langue === 'fr' ? insecables(t.appel.texte) : t.appel.texte}</p>`,
      '      <div class="appels">',
      `        <a class="bouton bouton-plein" href="${t.appel.contact}">${t.appel.bouton} <svg class="ic" aria-hidden="true"><use href="#i-fleche"/></svg></a>`,
      '      </div>',
      '    </div>',
      '  </section>',
      '</main>',
    ].join('\n');
    const ld = { '@context': 'https://schema.org', '@graph': [fil(langue, [ACCUEIL[langue], [t.fil, DEMARRER[langue]]])] };
    return {
      chemin: fichierDe(DEMARRER[langue]),
      contenu: page(langue, { adresse: DEMARRER[langue], jumelle: DEMARRER[autre], titre: t.titre, description: t.description, ldJson: ld }, main,
        'La page « Démarrer », le tunnel du numéro WhatsApp, GÉNÉRÉE par npm run vitrine:cas depuis scripts/vitrine/tunnel-textes.ts : ne pas modifier à la main.'),
    };
  });
}
