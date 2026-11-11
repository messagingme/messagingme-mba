import { describe, it, expect } from 'vitest';
import { GUIDE_NUMERO } from '../scripts/vitrine/aide-pages';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRIX_NUMERO_HT_CENTIMES } from '../src/stripe/abonnement';
import { DROITS, PRIX_BUSINESS_HT_CENTIMES } from '../src/offres/offres';
import { MAGASINS, PRIX_NUMERO_AFFICHE_HT_CENTIMES, TEXTES_TUNNEL, demandeDe, type Origine } from '../scripts/vitrine/tunnel-textes';
import { DEMARRER, TEXTES_DEMARRER, profondeurTunnel } from '../scripts/vitrine/tunnel';
import { TEXTES_CARREFOUR, type Langue } from '../scripts/vitrine/cas-textes';
import { JUMELLES } from '../scripts/vitrine/anglais';
import { ENTREES } from '../web/lib/registre-vitrine';
import { fichierDe } from '../scripts/vitrine/cas';
import { AUTORISATION_CODEX, COMMANDES_CODEX, COMMANDES_PLUGIN, DEPOT_PLUGIN, SERVEUR_PLUGIN_MCP } from '../web/lib/demarrer';
import { commandeHtml } from '../scripts/vitrine/tunnel';
import { FAQ } from '../scripts/plugin/faq';
import { ETAPES_NUMERO_FOURNI } from '../web/lib/partage/etapes-numero-fourni';
import { lire, pagesHtml, texte } from './vitrine-lecture';

/**
 * LE TUNNEL DU NUMÉRO WHATSAPP (l'arbre de Julien du 2026-10-30, plan `docs/superpowers/plans/2026-10-30-tunnel-numero-generique.md`) :
 * le même sur la page « Démarrer », Boutiques Shopify et SaaS et app builders. Que chaque page soit égale à sa génération,
 * `tests/vitrine-cas.test.ts` le tient ; ici, ce que le tunnel PROMET et ce qu'il ne dit plus.
 *
 * 🔴 Plus aucune voie qui ne fait que répondre (le numéro relié par code) : Julien, 2026-10-30, « on supprime une bonne
 * fois pour toutes l'option QR code ». Chaque issue mène à un numéro de l'API officielle.
 */
const shopify = ENTREES.find((e) => e.cle === 'shopify')!;
/** Chaque page qui porte le tunnel, sa langue et la page d'origine que sa demande à coller reprend. */
const PAGES: ReadonlyArray<{ adresse: string; langue: Langue; origine: Origine }> = [
  { adresse: DEMARRER.fr, langue: 'fr', origine: 'generique' },
  { adresse: DEMARRER.en, langue: 'en', origine: 'generique' },
  { adresse: shopify.fr.adresse, langue: 'fr', origine: 'shopify' },
  { adresse: shopify.en.adresse, langue: 'en', origine: 'shopify' },
  { adresse: TEXTES_CARREFOUR.fr.adresse, langue: 'fr', origine: 'saas' },
  { adresse: TEXTES_CARREFOUR.en.adresse, langue: 'en', origine: 'saas' },
];
const corps = (html: string): string => texte(html
  .replace(/<header class="cadre entete">[\s\S]*?<\/header>/, '')
  .replace(/<footer class="pied">[\s\S]*?<\/footer>/, '')
  .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, ''));
const guide = (html: string): string => html.match(/<div class="bt-guide" data-guide-numero>[\s\S]*?<\/details>\n {6}<\/div>/)?.[0] ?? '';
/** Les commandes d'un morceau de HTML, dans l'ordre, telles qu'on les copie : balises (`<wbr>`) retirées, entités décodées. */
const codes = (h: string): string[] => [...h.matchAll(/<code>([\s\S]*?)<\/code>/g)].map((m) => texte(m[1]!));
/** Ce qu'on choisit dans une liste plutôt qu'on ne le tape (`.bt-choix`), dans l'ordre et tel qu'on le lit. */
const choix = (h: string): string[] => [...h.matchAll(/<span class="bt-choix">([\s\S]*?)<\/span>/g)].map((m) => texte(m[1]!));
/** Le texte que le HTML affiche, entités décodées : une demande se compare à ce que « Copier » met dans le presse-papiers. */
const affiche = (h: string): string => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

describe('le tunnel du numéro WhatsApp', () => {
  it('le numéro fourni cite le prix du code', () => {
    expect(PRIX_NUMERO_AFFICHE_HT_CENTIMES).toBe(PRIX_NUMERO_HT_CENTIMES);
    expect(corps(lire(fichierDe(DEMARRER.fr)))).toContain('3,50 € HT par mois en formule Free, inclus en formule Pro');
    expect(corps(lire(fichierDe(DEMARRER.en)))).toContain('€3.50 excl. VAT a month with the Free plan, included in Pro');
  });

  it('est posé, une seule fois, sur chaque page qui le porte, et nulle part ailleurs', () => {
    for (const p of PAGES) expect(lire(fichierDe(p.adresse)).split('data-guide-numero').length - 1, p.adresse).toBe(1);
    const avec = pagesHtml().filter((x) => lire(x).includes('data-guide-numero')).sort();
    // Le guide du centre d'aide (lot 4a) le porte aussi, à partir de « Qui paie vos messages à Meta ? », dans ses deux langues.
    const guide = (['fr', 'en'] as const).map((l) => fichierDe(GUIDE_NUMERO[l]));
    for (const g of guide) expect(lire(g).split('data-guide-numero').length - 1, g).toBe(1);
    expect(avec).toEqual([...PAGES.map((p) => fichierDe(p.adresse)), ...guide].sort());
  });

  it('est un arbre : chaque réponse mène quelque part, tout se rejoint, rien ne boucle, et les deux langues ont le même', () => {
    for (const langue of ['fr', 'en'] as const) {
      const { questions, issues } = TEXTES_TUNNEL[langue];
      const qIds = questions.map((q) => q.id);
      const iIds = issues.map((x) => x.id);
      expect(new Set([...qIds, ...iIds]).size, `${langue} : identifiants uniques`).toBe(qIds.length + iIds.length);
      const atteints = new Set<string>();
      const parcourir = (id: string, chemin: readonly string[]): void => {
        expect(chemin, `${langue} : boucle sur ${id}`).not.toContain(id);
        atteints.add(id);
        const q = questions.find((x) => x.id === id);
        if (!q) {
          expect(iIds, `${langue} : ${id} n'est ni une question ni une issue`).toContain(id);
          return;
        }
        // Une seule réponse sans destination, et seulement si la question a une aide à déplier ; une réponse grisée n'en
        // a pas encore, et dit pourquoi pour chaque formule qui mène à sa question (Free et Pro).
        expect(q.reponses.filter((r) => !r.vers && !r.grisee).length, `${langue} : ${id}`).toBeLessThanOrEqual(q.aide ? 1 : 0);
        for (const r of q.reponses.filter((x) => x.grisee)) {
          expect(r.vers, `${langue} : ${id}`).toBeUndefined();
          expect(Object.keys(r.grisee!).sort(), `${langue} : ${id}`).toEqual(['free', 'pro']);
        }
        for (const r of q.reponses) if (r.vers) parcourir(r.vers, [...chemin, id]);
      };
      parcourir(qIds[0]!, []);
      expect([...atteints].sort(), `${langue} : une question ou une issue que rien n'atteint`).toEqual([...qIds, ...iIds].sort());
      // Le lien d'une issue vers une autre mène à une issue.
      for (const x of issues) if (x.autre) expect(iIds, `${langue} : ${x.id}`).toContain(x.autre.vers);
    }
    const forme = (l: Langue) => TEXTES_TUNNEL[l].questions.map((q) => `${q.id}:${q.reponses.map((r) => `${r.vers ?? '?'}${r.offre ?? ''}${r.note ? '+' : ''}${r.grisee ? '~' : ''}`).join(',')}`);
    expect(forme('en')).toEqual(forme('fr'));
    expect(TEXTES_TUNNEL.en.issues.map((x) => `${x.id}>${x.autre?.vers ?? ''}`)).toEqual(TEXTES_TUNNEL.fr.issues.map((x) => `${x.id}>${x.autre?.vers ?? ''}`));
  });

  it('🔴 suit l’arbre de Julien : l’offre, en Pro la console ou Claude Code, qui paie Meta, le compte Meta Business, l’application WhatsApp Business, puis le numéro', () => {
    for (const langue of ['fr', 'en'] as const) {
      const { questions } = TEXTES_TUNNEL[langue];
      const q = (id: string) => questions.find((x) => x.id === id)!;
      expect(questions.map((x) => x.id), langue).toEqual(['offre', 'pilote', 'paiement', 'compte', 'application', 'meme-numero', 'numero']);
      // Free mène à « Qui paie vos messages à Meta ? » ; Pro d'abord à « Console ou Claude Code ? » (lot 3c), dont la
      // console finit sur son issue et Claude Code rejoint la même question. Business et Entreprise mènent à la démo et au
      // contact, jamais aux questions du numéro (Julien, 2026-10-30).
      expect(q('offre').reponses.filter((r) => r.vers).map((r) => `${r.offre}>${r.vers}`), langue)
        .toEqual(['free>paiement', 'pro>pilote', 'business>echange', 'entreprise>echange']);
      expect(q('pilote').reponses.map((r) => r.vers), langue).toEqual(['console', 'paiement']);
      // Qui paie Meta (2026-11-06) : la carte chez Meta mène au compte Meta Business ; le Crédit WhatsApp, grisé tant
      // qu'il n'est pas en vente en ligne, ne mène nulle part.
      expect(q('paiement').reponses.map((r) => r.vers ?? (r.grisee ? 'grisee' : '?')), langue).toEqual(['compte', 'grisee']);
      // Oui : le numéro API ; Non et « Je ne sais pas » : l'application, et « Je ne sais pas » dit où vérifier.
      expect(q('compte').reponses.map((r) => r.vers), langue).toEqual(['api', 'application', 'application']);
      expect(q('compte').reponses[2]!.note, langue).toContain('business.facebook.com');
      expect(q('compte').reponses[2]!.note, langue).toMatch(/Facebook ou Instagram|Facebook or Instagram/);
      // Avec l'application, ce numéro-là ? (le cas 4, lot 3a) Oui, on la garde ; Non, un numéro de chez nous par la
      // fenêtre de Meta. Sans elle, la question du numéro (Julien, 2026-10-31).
      expect(q('application').reponses.map((r) => r.vers), langue).toEqual(['meme-numero', 'numero']);
      expect(q('meme-numero').reponses.map((r) => r.vers), langue).toEqual(['garder', 'autre-numero']);
      // Un numéro : l'application à télécharger ; aucun : le numéro fourni, qui va dans l'application.
      expect(q('numero').reponses.map((r) => r.vers), langue).toEqual(['telecharger', 'fourni']);
    }
  });

  it('🔴 le cas 4, WhatsApp ordinaire et la carte chez Meta (aide à la connexion, lot 3a)', () => {
    for (const langue of ['fr', 'en'] as const) {
      const { questions, issues } = TEXTES_TUNNEL[langue];
      const issue = (id: string) => issues.find((x) => x.id === id)!;
      // Le cas 4 : un numéro de chez nous relié par la fenêtre de Meta, son code par l'appel (la source du lot 2c).
      const autre = issue('autre-numero');
      const appel = ETAPES_NUMERO_FOURNI.find((e) => e.insiste)!;
      expect(autre.textes.join(' '), langue).toContain(appel[langue]);
      expect(autre.pasAPas, langue).toBe(langue === 'fr' ? '/aide/connecter-mon-numero-whatsapp/' : '/en/help/connect-my-whatsapp-number/');
      expect(Object.values(autre.numero ?? {}).join(' '), langue).toMatch(/fournis-m’en un|provide one/);
      // WhatsApp ordinaire : plus aucun texte n'envoie un numéro qui sert dans WhatsApp vers un autre numéro ; il passe
      // dans WhatsApp Business, gardée, que disent l'issue de l'application et celle du téléchargement.
      const api = issue('api');
      expect(api.textes.join(' '), langue).not.toMatch(/Sans numéro libre|Without an available number/);
      expect(api.autre!.question, langue).toMatch(/WhatsApp ou dans l’application|WhatsApp or in the WhatsApp Business app/);
      // Sa demande à coller aussi : le numéro fourni ne vaut que sans numéro (jaune 2 de la relecture).
      expect(Object.values(api.numero ?? {}).join(' '), langue).toMatch(/si je n’ai aucun numéro|if I have no number at all/);
      expect(Object.values(api.numero ?? {}).join(' '), langue).not.toMatch(/si je n’en ai pas|if I have none/);
      for (const id of ['garder', 'telecharger']) {
        expect(issue(id).textes.join(' '), `${langue} ${id}`).toMatch(/reprendre ce numéro, avec vos conversations|take over that number, with your chats/);
      }
      // La carte chez Meta (Julien, 2026-11-09) : son libellé, et ses deux liens vers des fiches publiées.
      const carte = questions.find((x) => x.id === 'paiement')!.voies![0]!;
      expect(carte.titre, langue).toMatch(/Visa \/ Mastercard/);
      for (const l of carte.liens ?? []) expect(existsSync(join('site', l.href, 'index.html')), `${langue} ${l.href}`).toBe(true);
      expect(carte.liens?.length, langue).toBe(2);
      // Un compte de l'application tout juste repris de WhatsApp peut être trop neuf pour Meta (jaune 5).
      expect(issue('garder').textes.join(' '), langue).toMatch(/Meta refuse parfois un numéro trop neuf|Meta sometimes refuses a number that is too new/);
    }
    // Un lien de la carte s'ouvre dans un autre onglet sans la choisir (jaune 1) : le clic ne vaut pas choix.
    expect(lire('site.js')).toContain("closest('.bt-voie-liens a[href]')");
    for (const adresse of [DEMARRER.fr, DEMARRER.en]) {
      expect(lire(fichierDe(adresse)), adresse).toMatch(/<p class="bt-voie-liens"><a href="[^"]+" target="_blank" rel="noopener">/);
    }
  });

  it('🔴 avec l’application et ce numéro-là, on la garde, et le numéro fourni n’y est jamais proposé (Julien, 2026-10-31)', () => {
    for (const langue of ['fr', 'en'] as const) {
      const garder = TEXTES_TUNNEL[langue].issues.find((x) => x.id === 'garder')!;
      expect([...garder.textes, ...Object.values(garder.numero ?? {})].join(' '), langue).not.toMatch(/fourni|provide|\d+[,.]\d+/i);
    }
  });

  it('🔴 sans numéro, le numéro fourni va dans l’application : on répond dès le premier jour, l’envoi attend que Meta accepte (Julien, 2026-10-31)', () => {
    for (const [langue, application, jour, attend] of [
      ['fr', /créez-y votre compte avec le numéro que nous vous fournissons/, /Dès le premier jour, vous répondez à vos clients depuis l’application/, /l’envoi de vos messages depuis Messaging Me attend alors quelques jours/],
      ['en', /create your account there with the number we provide/, /From day one, you reply to your customers from the app/, /sending your messages from Messaging Me then waits a few days/],
    ] as const) {
      const fourni = TEXTES_TUNNEL[langue].issues.find((x) => x.id === 'fourni')!;
      const tout = fourni.textes.join(' ');
      expect(tout, langue).toMatch(application);
      expect(tout, langue).toMatch(jour);
      expect(tout, langue).toMatch(attend);
      expect(fourni.liens?.map((l) => l.href), langue).toEqual([MAGASINS.appStore, MAGASINS.googlePlay]);
      // La demande à coller demande le numéro, pour l'application, et le code qui va avec.
      for (const d of Object.values(fourni.numero ?? {})) expect(d, langue).toMatch(langue === 'fr' ? /fournis-m’en un .* l’application WhatsApp Business, et montre-moi son code/ : /provide one .* the WhatsApp Business app, and show me its verification code/);
    }
  });

  it('🔴 « Je ne sais pas » à la question de l’offre dit que Free ne marche qu’avec un agent IA, et sinon Pro (Julien, 2026-10-30)', () => {
    for (const [langue, agent, sans] of [
      ['fr', /uniquement depuis un agent IA comme Claude Code ou Codex/, /Sans agent IA, choisissez Pro/],
      ['en', /only from an AI agent such as Claude Code or Codex/, /Without an AI agent, choose Pro/],
    ] as const) {
      const offre = TEXTES_TUNNEL[langue].questions.find((x) => x.id === 'offre')!;
      expect(offre.reponses.some((r) => !r.vers), langue).toBe(true);
      expect(offre.aide, langue).toMatch(agent);
      expect(offre.aide, langue).toMatch(sans);
    }
  });

  it('une question répondue reste affichée, sa réponse en évidence, et une autre réponse change le chemin (Julien, 2026-10-30)', () => {
    const js = lire('site.js');
    const css = lire('site.css');
    // Plus de repli en une ligne ni de « Modifier » : on change d'avis en recliquant.
    expect(js).not.toMatch(/data-modifier|data-resume/);
    for (const p of PAGES) expect(lire(fichierDe(p.adresse)), p.adresse).not.toMatch(/data-modifier|data-resume/);
    expect(js).toContain("b.getAttribute('aria-pressed') !== 'true'");
    expect(css).toContain('.bt-voie-choix:has([aria-pressed="true"]) .bt-voie{');
    // Les cartes et les réponses d'une question répondue ne se cachent plus.
    expect(css).not.toMatch(/\.bt-question\.repondue :is\([^)]*\.bt-(voies|reponses)\b[^)]*\)\{display:none/);
  });

  it('🔴 la carte Pro dit son essai en tête, avant son titre (lot 3b)', () => {
    for (const [langue, essai] of [['fr', /^14&nbsp;jours d’essai gratuit$/], ['en', /^14-day free trial$/]] as const) {
      const cartes = TEXTES_TUNNEL[langue].questions.find((x) => x.id === 'offre')!.voies!;
      expect(cartes.map((c) => Boolean(c.badge)), langue).toEqual([false, true, false, false]);
      expect(cartes[1]!.badge, langue).toMatch(essai);
    }
    for (const p of PAGES) {
      const html = lire(fichierDe(p.adresse));
      expect(html, p.adresse).toMatch(/<p class="bt-badge">[^<]+<\/p>\s*<h4>Pro, /);
    }
  });

  it('🔴 le plus long parcours fait six questions (Pro par Claude Code), et le chapeau, l’étape et la page « Démarrer » le disent', () => {
    for (const [langue, trois] of [['fr', 'six question'], ['en', 'six question']] as const) {
      const max = profondeurTunnel(TEXTES_TUNNEL[langue].questions);
      expect(max).toBe(6);
      expect(TEXTES_TUNNEL[langue].chapeau, langue).toContain(trois);
      expect(TEXTES_DEMARRER[langue].h1.join(' '), langue).toContain(trois);
      expect(TEXTES_DEMARRER[langue].titre, langue).toContain(trois);
      for (const p of PAGES.filter((x) => x.langue === langue)) {
        const html = lire(fichierDe(p.adresse));
        expect(html, p.adresse).toContain(`data-max="${max}"`);
        expect(html, p.adresse).toContain(langue === 'fr' ? `Question 1 sur ${max} au plus` : `Question 1 of ${max} at most`);
      }
    }
  });

  it('🔴 ne dit ni « QR code », ni « coexistence », ni « appareils liés », et aucune voie ne fait seulement répondre', () => {
    for (const p of PAGES) {
      const g = texte(guide(lire(fichierDe(p.adresse))));
      expect(g.length, p.adresse).toBeGreaterThan(1000);
      expect(g, p.adresse).not.toMatch(/QR|coexist|appareils? liés?|linked devices?|scann|code à scanner|pour répondre\b|to answer\b|rien ne part en premier|nothing goes out first/i);
    }
    // Ni la page Shopify entière (sa FAQ comprise), ni la FAQ du plugin, ni son README ne parlent de coexistence.
    for (const a of [shopify.fr.adresse, shopify.en.adresse]) expect(corps(lire(fichierDe(a))), a).not.toMatch(/QR|coexist/i);
    expect(readFileSync(join(process.cwd(), 'plugin/README.md'), 'utf8')).not.toMatch(/coexist/i);
    for (const q of FAQ) expect(`${q.question.fr} ${q.question.en} ${q.reponse.fr} ${q.reponse.en}`, q.id).not.toMatch(/coexist/i);
  });

  it('🔴 les questions et les cartes ne parlent jamais de boutique : elles servent à tous les métiers', () => {
    for (const langue of ['fr', 'en'] as const) {
      const t = TEXTES_TUNNEL[langue];
      // Les liens d'une note sont des noms propres (l'« App Store » d'Apple), pas une boutique : on lit le texte autour.
      const sansLiens = (h: string) => h.replace(/<a\b[\s\S]*?<\/a>/g, '');
      const tout = [
        t.chapeau, ...t.questions.flatMap((q) => [q.texte, q.precision ?? '', q.aide ?? '', ...q.reponses.map((r) => `${r.libelle} ${sansLiens(r.note ?? '')}`),
          ...(q.voies ?? []).flatMap((v) => [v.titre, ...v.plus, ...v.moins])]),
        ...t.issues.flatMap((x) => [x.titre, x.situation, ...x.textes, ...Object.values(x.numero ?? {})]),
        ...t.lexique.termes.flatMap((x) => [x.terme, x.court, x.detail]),
      ].join(' ');
      expect(tout, langue).not.toMatch(/boutique|shopify|\bstore\b|checkout/i);
    }
  });

  it('🔴 la voie de l’application dit que le compte Meta Business se crée en chemin, et le numéro neuf, sans aucun chiffre', () => {
    for (const [langue, enChemin, neuf] of [
      ['fr', /Pas de compte Meta Business \? La fenêtre de Meta le crée en chemin/, /Meta refuse parfois un numéro trop neuf/],
      ['en', /No Meta Business account\? Meta’s window creates it along the way/, /Meta sometimes refuses a number that is too new/],
    ] as const) {
      const { issues } = TEXTES_TUNNEL[langue];
      for (const id of ['garder', 'telecharger', 'fourni']) expect(issues.find((x) => x.id === id)!.textes.join(' '), `${langue} : ${id}`).toMatch(enChemin);
      const telecharger = issues.find((x) => x.id === 'telecharger')!;
      expect(telecharger.textes.join(' '), langue).toMatch(neuf);
      // Meta ne publie aucun seuil : jamais un nombre de jours ni d'heures.
      for (const x of issues.filter((y) => y.id === 'telecharger' || y.id === 'fourni')) {
        expect([...x.textes, ...Object.values(x.numero ?? {})].join(' '), `${langue} : ${x.id}`).not.toMatch(/\d+\s*(jours?|days?|heures?|hours?|semaines?|weeks?)/i);
      }
      // Le numéro API rappelle qu'on peut garder son application.
      expect(issues.find((x) => x.id === 'api')!.autre?.vers, langue).toBe('garder');
    }
  });

  it('chaque note de réponse est reliée à son bouton, et seulement sur une réponse qui mène quelque part', () => {
    for (const p of PAGES) {
      const html = lire(fichierDe(p.adresse));
      for (const q of TEXTES_TUNNEL[p.langue].questions) {
        q.reponses.forEach((r, k) => {
          if (!r.note) return;
          expect(r.vers, `${p.adresse} : ${q.id}`).toBeTruthy();
          expect(html, p.adresse).toContain(`data-note="note-${q.id}-${k}"`);
          expect(html, p.adresse).toContain(`<p class="bt-note-reponse" id="note-${q.id}-${k}" role="status" hidden>`);
        });
      }
    }
  });

  it('se lit sans script : les questions cachées, chaque issue avec sa situation, le lexique replié', () => {
    for (const p of PAGES) {
      const html = lire(fichierDe(p.adresse));
      expect(html, p.adresse).toContain('<details class="bt-lexique">');
      expect(html, p.adresse).toMatch(/<div class="bt-questions" hidden>/);
      expect(html, p.adresse).toMatch(/<div class="bt-progression"[^>]*\shidden>/);
      for (const x of TEXTES_TUNNEL[p.langue].issues) {
        expect(html, p.adresse).toMatch(new RegExp(`data-chemin="${x.id}" id="numero-${x.id}">\\s*<p class="bt-situation">`));
        // Le lien vers une autre issue est une ancre qui marche aussi sans script.
        if (x.autre) expect(html, p.adresse).toContain(`<a href="#numero-${x.autre.vers}" data-vers-chemin="${x.autre.vers}">`);
      }
    }
    expect(lire('site.js')).toContain("querySelectorAll('[data-guide-numero]')");
    expect(lire('site.js')).toContain('[data-vers-chemin]');
    expect(lire('site.css')).toContain('.bt-guide [hidden]{display:none}');
  });

  it('une question à cartes porte, sous chaque carte, le bouton de même rang (Julien, 2026-10-27)', () => {
    for (const p of PAGES) {
      const html = lire(fichierDe(p.adresse));
      const aCartes = TEXTES_TUNNEL[p.langue].questions.filter((q) => q.voies);
      expect(aCartes.map((q) => q.id), p.adresse).toEqual(['offre', 'paiement']);
      for (const q of aCartes) {
        const menent = q.reponses.filter((r) => r.vers || r.grisee);
        const fieldset = html.match(new RegExp(`<fieldset class="bt-question" data-question="${q.id}"[\\s\\S]*?</fieldset>`))?.[0] ?? '';
        const cartes = fieldset.split('<div class="bt-voie-choix').slice(1);
        expect(cartes.length, p.adresse).toBe(q.voies!.length);
        cartes.forEach((c, i) => {
          const r = menent[i]!;
          const ou = `${p.adresse}, ${q.id}, carte ${i + 1}`;
          if (r.grisee) {
            // Grisée : un bouton qui ne se choisit pas, et la raison de chaque formule dans la carte.
            expect(c, ou).toMatch(/^ bt-voie-grisee">/);
            expect(c, ou).toContain('<button type="button" class="bouton bouton-trait" disabled>');
            expect(c, ou).not.toContain('data-vers=');
            for (const offre of Object.keys(r.grisee)) expect(c, ou).toContain(`<p class="bt-grisee" data-pour="${offre}">`);
            return;
          }
          expect(c.match(/data-vers="([^"]+)"(?: data-offre="([^"]+)")?/)?.slice(1), ou).toEqual([r.vers, r.offre]);
        });
      }
    }
    // La raison d'une carte grisée ne s'affiche que pour la formule choisie, et la carte ne se choisit pas.
    expect(lire('site.css')).toContain('.js .bt-guide:not([data-offre="free"]) .bt-grisee[data-pour="free"],.js .bt-guide:not([data-offre="pro"]) .bt-grisee[data-pour="pro"]{display:none}');
    expect(lire('site.js')).toContain("carte && carte.querySelector('[data-vers]')");
    // La formule choisie ne laisse dans une issue que son titre et sa demande : la règle qui masque l'autre offre, que le
    // bloc d'étapes unique suppose (jaune 7 des lots 3b et 3c).
    expect(lire('site.css')).toContain('.js .bt-guide[data-offre="free"] .bt-chemin [data-offre="pro"],.js .bt-guide[data-offre="pro"] .bt-chemin [data-offre="free"]{display:none}');
  });

  it('🔴 chaque issue finit sur les boutons de chaque offre, et sa demande reprend l’offre, les réponses et la page d’origine', () => {
    for (const p of PAGES) {
      const html = lire(fichierDe(p.adresse));
      const t = TEXTES_TUNNEL[p.langue];
      const plugin = p.langue === 'fr' ? '/developpeurs/installer-le-plugin/' : '/en/developers/install-the-plugin/';
      for (const x of t.issues) {
        if (x.contact) continue;
        const article = html.match(new RegExp(`<article class="bt-chemin" data-chemin="${x.id}"[\\s\\S]*?</article>`))?.[0] ?? '';
        if (x.console) {
          // Le Pro par la console (lot 3c) : l'inscription qui mène à la souscription du Pro, et le pas-à-pas de la
          // console ; ni demande à coller, ni bloc par offre.
          expect(article, `${p.adresse} : ${x.id}`).toContain(`href="https://console.messagingme.app/signup?offre=pro${p.langue === 'en' ? '&amp;lang=en' : ''}"`);
          expect(article, `${p.adresse} : ${x.id}`).toContain(`href="${x.pasAPas}"`);
          expect(article, `${p.adresse} : ${x.id}`).not.toContain('data-copier');
          expect(article, `${p.adresse} : ${x.id}`).not.toContain('data-offre=');
          expect(existsSync(join(process.cwd(), 'site', x.pasAPas, 'index.html')), x.pasAPas).toBe(true);
          continue;
        }
        // UN bloc d'étapes par issue (jaune 7 de la relecture des lots 3b et 3c) : le titre et la demande de chaque offre y
        // sont marqués (`data-offre`), les étapes communes n'y figurent qu'une fois.
        expect(article.split('<div class="bt-appels"').length - 1, `${p.adresse} : ${x.id}`).toBe(1);
        expect(article.split('class="bt-etapes bt-etapes-fin"').length - 1, `${p.adresse} : ${x.id}`).toBe(1);
        const bloc = article.slice(article.indexOf('<div class="bt-appels">'));
        expect(bloc, `${p.adresse} : ${x.id}`).toContain('<p class="bt-appels-titre" data-offre="free">');
        expect(bloc, `${p.adresse} : ${x.id}`).toContain('<p class="bt-appels-titre" data-offre="pro">');
        // En Free comme en Pro par l'assistant (lot 3c) : le plugin et son dépôt, à l'étape 1 ; l'inscription à la console
        // n'est plus ici, elle est l'issue de la console.
        expect(bloc, `${p.adresse} : ${x.id}`).toContain(`href="${plugin}"`);
        expect(bloc, `${p.adresse} : ${x.id}`).toContain(`href="${DEPOT_PLUGIN}"`);
        expect(bloc, `${p.adresse} : ${x.id}`).not.toContain('signup?offre=pro');
        expect(existsSync(join(process.cwd(), 'site', x.pasAPas, 'index.html')), x.pasAPas).toBe(true);
        for (const offre of ['free', 'pro'] as const) {
          const id = `demande-${x.id}-${offre}`;
          expect(bloc, `${p.adresse} : ${id}`).toContain(`<div class="bt-demande" data-offre="${offre}"><p id="${id}">`);
          expect(bloc, `${p.adresse} : ${id}`).toContain(`data-copier="${id}"`);
          const demande = affiche(bloc.match(new RegExp(`<p id="${id}">([^]*?)</p>`))?.[1] ?? '');
          expect(demande, `${p.adresse} : ${id}`).toBe(affiche(demandeDe(t, x, offre, p.origine)).replace(/ ([:;?!])/g, p.langue === 'fr' ? ' $1' : ' $1'));
          // L'offre la première, la page d'origine ensuite.
          expect(demande, `${p.adresse} : ${id}`).toMatch(offre === 'free' ? /(formule|the Messaging Me) Free/ : /(formule|the Messaging Me) Pro/);
          if (p.origine === 'shopify') expect(demande, `${p.adresse} : ${id}`).toMatch(/Shopify/);
          if (p.origine === 'saas') expect(demande, `${p.adresse} : ${id}`).toMatch(/mon app|my app/);
          if (p.origine === 'generique') expect(demande, `${p.adresse} : ${id}`).not.toMatch(/Shopify|boutique|store|mon app\b|my app\b/);
        }
      }
    }
  });

  /**
   * Julien, 2026-11-09 : « quand le mec choisit la Free (et va être dans Claude Code), tout à la fin, avant de lui filer le
   * texte à copier coller dans Claude Code, il faut lui (re)donner les étapes : 1) télécharger le plugin 2) MCP à
   * connecter 3) texte en copié collé ». Les commandes sont celles des manifestes du plugin, pour Claude Code et Codex.
   */
  it('🔴 en Free comme en Pro par l’assistant, trois étapes avant la demande : installer le plugin, le relier à Messaging Me, coller la demande', () => {
    for (const p of PAGES) {
      const html = lire(fichierDe(p.adresse));
      const plugin = p.langue === 'fr' ? '/developpeurs/installer-le-plugin/' : '/en/developers/install-the-plugin/';
      for (const x of TEXTES_TUNNEL[p.langue].issues) {
        if (x.contact || x.console) continue;
        const article = html.match(new RegExp(`<article class="bt-chemin" data-chemin="${x.id}"[\\s\\S]*?</article>`))?.[0] ?? '';
        {
        // Le bloc unique de l'issue (les étapes communes aux deux offres) ; chaque offre a sa demande à l'étape 3.
        const free = article.slice(article.indexOf('<div class="bt-appels">'));
        const etapes = free.split('<li><span class="bt-num">').slice(1);
        const ou = `${p.adresse} : ${x.id}`;
        expect(etapes.map((e) => e.slice(0, 1)), ou).toEqual(['1', '2', '3']);
        // Julien, 2026-11-09 : « des logos Claude Code ou Codex avec la commande en face ». Aux étapes 1 et 2, le logo de
        // Claude Code puis celui de Codex, chacun devant ce qu'on y tape.
        for (const e of etapes.slice(0, 2)) expect(e.match(/bt-assist-(claude|codex)"/g), ou).toEqual(['bt-assist-claude"', 'bt-assist-codex"']);
        // 1 : le plugin, dans Claude Code puis dans Codex, avec son pas-à-pas et son dépôt. Une commande se lit telle quelle,
        // ses coupures permises (`<wbr>`) retirées.
        expect(codes(etapes[0]!), ou).toEqual([...COMMANDES_PLUGIN, ...COMMANDES_CODEX]);
        expect(etapes[0], ou).toContain(`href="${plugin}"`);
        expect(etapes[0], ou).toContain(`href="${DEPOT_PLUGIN}"`);
        // 2 : la connexion MCP, obligatoire avant toute demande (jamais « la première étape », juste sous l'étape 1) : dans
        // Claude Code, `/mcp` puis deux CHOIX (le serveur, Authenticate) ; dans Codex, sa commande.
        expect(codes(etapes[1]!), ou).toEqual(['/mcp', AUTORISATION_CODEX]);
        expect(choix(etapes[1]!), ou).toEqual([SERVEUR_PLUGIN_MCP, 'Authenticate']);
        const relier = affiche(etapes[1]!);
        expect(relier, ou).toMatch(p.langue === 'fr' ? /obligatoire/ : /required/);
        expect(relier, ou).not.toMatch(/première étape|first step/i);
        // Puis les écrans de la page d'autorisation, dans l'ordre, chacun présent sur disque, avec ses dimensions et son
        // texte ; le premier montre Google ET l'adresse e-mail, et sa légende le dit.
        const ecrans = [...etapes[1]!.matchAll(/<img src="([^"?]+)\?v=[0-9a-f]+" alt="([^"]+)" width="(\d+)" height="(\d+)"/g)];
        // Les trois écrans de Google, puis le détour par e-mail (jaune de 76a0e2b4) : la page du lien reçu.
        expect(ecrans.map((m) => m[1]), ou).toEqual([1, 2, 3, 4].map((n) => `/img/demarrer/autoriser-${n}${p.langue === 'en' ? '-en' : ''}.webp`));
        expect(relier, ou).toMatch(p.langue === 'fr' ? /Sans Google\s:\s*Le lien de l’e-mail/ : /Without Google:\s*The email link/);
        // Codex voit « non vérifié » sur la page d'autorisation : le tunnel l'annonce sous sa ligne (jaune de 76a0e2b4).
        expect(relier, ou).toMatch(p.langue === 'fr' ? /«\snon vérifié\s»\s:\sc’est normal/ : /“unverified”: that is expected/);
        for (const m of ecrans) expect(existsSync(join(process.cwd(), 'site', m[1]!)), m[1]).toBe(true);
        expect(ecrans[0]![2], ou).toMatch(p.langue === 'fr' ? /Google[^]*adresse e-mail/ : /Google[^]*email address/);
        expect(relier, ou).toMatch(p.langue === 'fr' ? /Google, ou votre adresse e-mail/ : /Google, or your email address/);
        // 3 : la demande à coller, celle de chaque offre, et elle seule ; aucune marque restée dans les étapes.
        for (const offre of ['free', 'pro'] as const) expect(etapes[2], ou).toContain(`data-copier="demande-${x.id}-${offre}"`);
        for (const e of etapes.slice(0, 2)) expect(e, ou).not.toContain('data-copier');
        expect(free, ou).not.toMatch(/\{[^{}\s]+\}/);
        }
      }
    }
  });

  /**
   * La fin du tunnel donne le focus au titre de l'issue, quelle que soit l'offre : un lecteur d'écran l'annonce et lit
   * l'issue depuis le début, et aucune région live ne la relit en entier par-dessus. Le comportement se mesure au
   * navigateur ; ici, ce qui le porte : le titre focalisable de chaque issue, et `site.js` qui le vise aux deux endroits
   * où une issue se montre, sans plus viser un bouton.
   */
  it('la fin du tunnel donne le focus au titre de l’issue, sans région live', () => {
    for (const p of PAGES) {
      const html = lire(fichierDe(p.adresse));
      for (const x of TEXTES_TUNNEL[p.langue].issues) {
        const article = html.match(new RegExp(`<article class="bt-chemin" data-chemin="${x.id}"[\\s\\S]*?</article>`))?.[0] ?? '';
        expect(article.match(/<h3 tabindex="-1">/g), `${p.adresse} : ${x.id}`).toHaveLength(1);
      }
      expect(guide(html), p.adresse).not.toContain('aria-live');
    }
    const js = lire('site.js');
    expect(js).toContain("var premierArret = function (issue) { return issue && issue.querySelector('h3[tabindex]'); };");
    expect(js.match(/premierArret\(\w+\)/g)).toEqual(['premierArret(issue)', 'premierArret(autre)']);
    expect(js).not.toContain('"] a\')');
  });

  it('une commande est échappée, et sécable après un « / », un « @ » ou un « : » qui suit un caractère', () => {
    // Jamais après le « / » de tête.
    expect(commandeHtml('/mcp')).toBe('/mcp');
    expect(commandeHtml('/plugin install messagingme@messagingme')).toBe('/plugin install messagingme@<wbr>messagingme');
    expect(commandeHtml('plugin:messagingme:messagingme')).toBe('plugin:<wbr>messagingme:<wbr>messagingme');
    expect(commandeHtml('a<b & c')).toBe('a&lt;b &amp; c');
  });

  it('la page « Démarrer » existe dans les deux langues, déclarée, au plan du site et dans llms.txt', () => {
    expect(JUMELLES[DEMARRER.fr]).toBe(DEMARRER.en);
    expect(lire(fichierDe(DEMARRER.fr))).toContain('<html lang="fr"');
    expect(lire(fichierDe(DEMARRER.en))).toContain('<html lang="en"');
    for (const a of Object.values(DEMARRER)) {
      expect(lire('sitemap.xml'), a).toContain(`<loc>https://app.messagingme.fr${a}</loc>`);
      expect(lire('llms.txt'), a).toContain(`(https://app.messagingme.fr${a})`);
    }
  });

  it('🔴 l’en-tête de chaque page mène à « Démarrer », et les offres de la page Tarifs ouvrent le tunnel, l’offre choisie', () => {
    for (const p of pagesHtml().filter((x) => lire(x).includes('<header class="cadre entete">'))) {
      const entete = lire(p).match(/<header class="cadre entete">[\s\S]*?<\/header>/)![0];
      const adresse = p.startsWith('en/') ? DEMARRER.en : DEMARRER.fr;
      // Une fois dans la barre du téléphone, une fois à droite sur le bureau.
      expect(entete.split(`href="${adresse}"`).length - 1, p).toBe(2);
    }
    for (const [fichier, demarrer] of [['tarifs/index.html', DEMARRER.fr], ['en/pricing/index.html', DEMARRER.en]] as const) {
      const html = lire(fichier);
      const offres = html.match(/<ul class="cadre tarifs-grille">[\s\S]*?<\/ul>\n {2}<\/section>/)?.[0] ?? '';
      const boutons = [...offres.matchAll(/<h2 class="tarif-nom">([^<]+)<\/h2>[\s\S]*?<a class="bouton [^"]+" href="([^"]+)">/g)].map((m) => [m[1], m[2]]);
      expect(boutons.slice(0, 2), fichier).toEqual([['Free', `${demarrer}?offre=free`], ['Pro', `${demarrer}?offre=pro`]]);
      // L'appel du bas de page aussi, pour la Free.
      expect(html.match(/<section class="f-appel">[\s\S]*?<\/section>/)?.[0], fichier).toContain(`href="${demarrer}?offre=free"`);
    }
    // Et l'accueil y mène depuis sa une.
    expect(lire('index.html').match(/<section class="cadre une">[\s\S]*?<div class="scene-cadre">/)?.[0]).toContain(`href="${DEMARRER.fr}"`);
    expect(lire('en/index.html').match(/<section class="cadre une">[\s\S]*?<div class="scene-cadre">/)?.[0]).toContain(`href="${DEMARRER.en}"`);
    // `site.js` ne répond qu'à `?offre=free` ou `?offre=pro`, les valeurs que les réponses portent.
    expect(lire('site.js')).toContain('offre=(free|pro|business|entreprise)');
  });
});

/**
 * FREE ET PRO SANS ARTICLE (Julien, 2026-10-30 : « on arrête de dire en français la Free ou le Pro, c'est Free ou Pro, ou
 * formule Free ou formule Pro »). Toute la vitrine française, tournures dérivées comprises, FAQ du plugin comprise (« oui,
 * partout »). Seuls restent les libellés de la console cités entre guillemets, comme le bouton « Passer en Pro », que Julien
 * a gardé.
 */
describe('Free et Pro, sans article, sur la vitrine française', () => {
  const ARTICLE = /(?<![\p{L}’'])(?:la|le|au|du|en)\s+(?:Free|Pro)\b/iu;
  it('aucune page française ne dit « la Free », « le Pro », « en Free », « au Pro »', () => {
    const francaises = pagesHtml().filter((p) => !p.startsWith('en/') && p !== '404.html');
    expect(francaises.length).toBeGreaterThan(40);
    for (const p of francaises) {
      // Le texte affiché, sans les libellés cités entre guillemets français.
      const lu = corps(lire(p)).replace(/«[^»]*»/g, '');
      const m = lu.match(new RegExp(`.{0,40}${ARTICLE.source}.{0,40}`, 'iu'));
      expect(m?.[0], p).toBeUndefined();
    }
  });

  it('llms.txt non plus, dans sa partie française', () => {
    const francais = lire('llms.txt').split('## In English')[0]!.replace(/«[^»]*»/g, '');
    expect(francais.match(new RegExp(`.{0,40}${ARTICLE.source}.{0,40}`, 'iu'))?.[0]).toBeUndefined();
  });
});

describe('Business et Entreprise, et les mots du guide (Julien, 2026-10-30)', () => {
  it('🔴 Business et Entreprise ont leur carte, aux chiffres du code, et finissent sur la démo et le contact, sans demande', () => {
    for (const [langue, business, utilisateurs, entreprise, contact] of [
      ['fr', `Business, ${PRIX_BUSINESS_HT_CENTIMES.mois / 100}&nbsp;€ HT par mois`, `${DROITS.business.limites.utilisateurs}&nbsp;utilisateurs`, 'Entreprise, sur devis', '/contact/'],
      ['en', `Business, €${PRIX_BUSINESS_HT_CENTIMES.mois / 100} excl. VAT a month`, `${DROITS.business.limites.utilisateurs} users`, 'Enterprise, on quote', '/en/contact/'],
    ] as const) {
      const offre = TEXTES_TUNNEL[langue].questions.find((x) => x.id === 'offre')!;
      expect(offre.voies!.map((v) => v.titre.split(',')[0]), langue).toEqual(['Free', 'Pro', 'Business', langue === 'fr' ? 'Entreprise' : 'Enterprise']);
      expect(offre.voies![2]!.titre, langue).toBe(business);
      expect(offre.voies![2]!.plus.join(' '), langue).toContain(utilisateurs);
      expect(offre.voies![3]!.titre, langue).toBe(entreprise);
      const echange = TEXTES_TUNNEL[langue].issues.find((x) => x.id === 'echange')!;
      expect(echange.contact, langue).toBe(true);
      for (const p of PAGES.filter((x) => x.langue === langue)) {
        const article = lire(fichierDe(p.adresse)).match(/<article class="bt-chemin" data-chemin="echange"[\s\S]*?<\/article>/)?.[0] ?? '';
        expect(article, p.adresse).toContain(`href="${contact}#formulaire"`);
        expect(article, p.adresse).toContain(`href="${contact}"`);
        expect(article, p.adresse).not.toMatch(/data-copier|installer-le-plugin|install-the-plugin|signup/);
        expect(article, p.adresse).not.toContain('data-offre=');
      }
    }
  });

  it('les formules forment un carrousel sur le bureau, avec ses flèches (Julien, 2026-10-30 : « pas 2 rangées »)', () => {
    for (const p of PAGES) {
      const html = lire(fichierDe(p.adresse));
      expect(html, p.adresse).toContain('<div class="bt-voies bt-carrousel" id="voies-offre">');
      expect(html.match(/<button type="button" class="bt-fleche" data-defiler="(-1|1)"/g)?.length, p.adresse).toBe(2);
    }
    expect(lire('site.js')).toContain("closest('[data-defiler]')");
    expect(lire('site.css')).toMatch(/\.bt-voies\.bt-carrousel\{[^}]*grid-auto-flow:column[^}]*overflow-x:auto/);
  });

  it('les mots du guide se déplient un à un, sans nombre au titre, avec les liens de Meta et des magasins', () => {
    for (const langue of ['fr', 'en'] as const) {
      const { lexique, issues } = TEXTES_TUNNEL[langue];
      expect(lexique.titre, langue).not.toMatch(/\d|\b(deux|trois|quatre|cinq|two|three|four|five)\b/i);
      const liens = lexique.termes.flatMap((x) => x.liens ?? []).map((l) => l.href);
      expect(liens, langue).toEqual(expect.arrayContaining([MAGASINS.metaBusiness, MAGASINS.appStore, MAGASINS.googlePlay]));
      // La voie « je n'ai pas l'application » porte les mêmes magasins.
      expect(issues.find((x) => x.id === 'telecharger')!.liens?.map((l) => l.href), langue).toEqual([MAGASINS.appStore, MAGASINS.googlePlay]);
    }
    for (const p of PAGES) {
      const html = lire(fichierDe(p.adresse));
      expect(html.match(/<details class="bt-mot">/g)?.length, p.adresse).toBe(TEXTES_TUNNEL[p.langue].lexique.termes.length);
      for (const href of Object.values(MAGASINS)) expect(html, p.adresse).toContain(`href="${href}" rel="noopener"`);
    }
  });
});
