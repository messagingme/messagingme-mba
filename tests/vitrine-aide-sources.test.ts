import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGES_SOURCES } from '../scripts/vitrine/aide-sources-textes';
import { PAGES_CLAUDE } from '../scripts/vitrine/aide-claude-textes';
import { jumellesAide } from '../scripts/vitrine/aide-pages';
import { TEXTES_TUNNEL } from '../scripts/vitrine/tunnel-textes';
import { FAQ } from '../scripts/plugin/faq';
import { AUTORISATION_CODEX, COMMANDES_CODEX } from '../web/lib/demarrer';
import { CE_QUI_EST_FACTURE, ETAPES_CARTE_META } from '../web/lib/partage/etapes-meta';
import { NOTE_CARTE_APPLICATION, QUESTION_PAIEMENT } from '../web/lib/questions-numero';

/**
 * LES PAGES DU CENTRE COMPOSÉES DE SOURCES (lot 4a-2 de l'aide à la connexion) : « Payer Meta » et « Les modèles
 * WhatsApp ». Aucune phrase ne s'y invente : chaque texte tiré de la FAQ du plugin ou du produit se lit sur la page MOT
 * POUR MOT comme sa source, les étapes de la carte une seule fois, et chaque lien mène à une page qui existe. Le même
 * lot ajoute Codex et la mise à jour à « Installer le plugin », aux mêmes conditions.
 */
const SITE = join(process.cwd(), 'site');
const fichier = (adresse: string): string => join(SITE, adresse.replace(/#.*$/, ''), 'index.html');
const lire = (adresse: string): string => readFileSync(fichier(adresse), 'utf8');
/** Les espaces insécables, écrits ou en entité, ramenés à des espaces ; les blancs, à un seul. */
const plat = (t: string): string => t.replace(/&nbsp;| | /g, ' ').replace(/\s+/g, ' ');
/**
 * Le texte lu de la page : sans balises ni entités. Un lien se retire sans espace (il est DANS la phrase, sa ponctuation
 * le suit), les autres balises séparent des blocs.
 */
const texteDe = (html: string): string => plat(html.slice(html.indexOf('<main>'), html.indexOf('</main>'))
  .replace(/<\/?a\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&'));
const reponse = (id: string, l: 'fr' | 'en'): string => {
  const q = FAQ.find((x) => x.id === id);
  if (!q) throw new Error(`la FAQ du plugin n'a plus de question « ${id} »`);
  return q.reponse[l];
};
/** Un passage d'une réponse, de `depuis` compris à `avant` exclu : les deux bornes doivent s'y trouver. */
const passage = (t: string, depuis: string, avant: string): string => {
  expect(t, depuis).toContain(depuis);
  expect(t, avant).toContain(avant);
  return t.slice(t.indexOf(depuis), t.indexOf(avant, t.indexOf(depuis))).trim();
};
const page = (cle: string) => {
  const p = PAGES_SOURCES.find((x) => x.cle === cle);
  if (!p) throw new Error(`aucune page « ${cle} »`);
  return p;
};

describe('les pages du centre composées de sources', () => {
  for (const langue of ['fr', 'en'] as const) {
    it(`🔴 ${langue} : « Payer Meta » cite ses sources mot pour mot, et les étapes de la carte une seule fois`, () => {
      const t = texteDe(lire(page('payer-meta').adresse[langue]));
      const sources = [
        CE_QUI_EST_FACTURE.api[langue], CE_QUI_EST_FACTURE.application[langue], NOTE_CARTE_APPLICATION[langue],
        QUESTION_PAIEMENT.credit.titre[langue], QUESTION_PAIEMENT.credit.texte[langue], QUESTION_PAIEMENT.grisee.pro[langue],
        ...ETAPES_CARTE_META.map((e) => e[langue]),
      ];
      for (const s of sources) expect(t, s).toContain(plat(s));
      for (const e of ETAPES_CARTE_META) expect(t.split(plat(e[langue])).length - 1, e[langue]).toBe(1);
      // La page sert la console comme Claude : ni outil de Claude, ni adresse affichée en clair.
      expect(t).not.toMatch(/list_templates|https:\/\//);
    });

    it(`🔴 ${langue} : qui paie Meta ne se dit jamais sans le Crédit WhatsApp, sur ces pages qui le proposent ou y mènent`, () => {
      // Rouge de la relecture du lot 4a-2 : « Meta facture toujours l'entreprise » est faux avec le Crédit WhatsApp, que
      // « Payer Meta » propose. Ni dans le texte, ni dans la description que lisent les moteurs.
      const toujoursLEntreprise = /ne touche pas à ces frais|never touches these fees|Meta facture directement votre entreprise|Meta bills your business directly|Meta facture vos messages à votre entreprise|Meta bills your messages to your business/;
      for (const p of PAGES_SOURCES) expect(plat(lire(p.adresse[langue])), p.cle).not.toMatch(toujoursLEntreprise);
      // Et « Payer Meta » dit l'exception là où elle dit qui paie : la source la porte, la page la reprend.
      const exception = langue === 'fr' ? 'sauf avec le Crédit WhatsApp' : 'except with WhatsApp credit';
      expect(CE_QUI_EST_FACTURE.api[langue]).toContain(exception);
      expect(texteDe(lire(page('payer-meta').adresse[langue]))).toContain(exception);
    });

    it(`🔴 ${langue} : « Les modèles WhatsApp » cite ses sources mot pour mot, et renvoie la carte à « Payer Meta »`, () => {
      const html = lire(page('modeles-whatsapp').adresse[langue]);
      const t = texteDe(html);
      const sources = [
        reponse('fenetre-24-heures', langue), reponse('utility-ou-marketing', langue),
        passage(reponse('ce-que-meta-facture', langue), langue === 'fr' ? 'Claude vous donne' : 'Claude gives you',
          langue === 'fr' ? 'Pour ajouter la carte' : 'To add the card'),
        reponse('modele-refuse', langue),
      ];
      for (const s of sources) expect(t, s).toContain(plat(s));
      // La grille de Meta, que cite la réponse, est un lien ; les étapes de la carte vivent sur « Payer Meta ».
      expect(html).toContain('<a href="https://developers.facebook.com/docs/whatsapp/pricing" rel="noopener">');
      expect(t).not.toContain(plat(ETAPES_CARTE_META[0]![langue]));
      expect(html).toContain(`<a href="${page('payer-meta').adresse[langue]}">`);
    });

    it(`🔴 ${langue} : « Installer le plugin » donne les commandes de Codex et la mise à jour, mot pour mot`, () => {
      const installer = PAGES_CLAUDE.find((p) => p.cle === 'installer-le-plugin');
      if (!installer) throw new Error('plus de page « installer-le-plugin »');
      const html = lire(installer.adresse[langue]);
      // Les commandes de `web/lib/demarrer.ts`, celles que `tests/plugin.test.ts` tient égales aux manifestes.
      for (const c of [...COMMANDES_CODEX, AUTORISATION_CODEX]) expect(html, c).toContain(`<code>${c}</code>`);
      const t = texteDe(html);
      // Les mots de la fin du tunnel, et la question de la FAQ, telle quelle.
      const tunnel = TEXTES_TUNNEL[langue].appels.etapesFree;
      for (const x of [tunnel.relier.codexNote, FAQ.find((q) => q.id === 'mettre-a-jour-le-plugin')!.question[langue], reponse('mettre-a-jour-le-plugin', langue)]) {
        expect(t, x).toContain(plat(x));
      }
    });

    it(`🔴 ${langue} : chaque lien de leur contenu mène à une page qui existe`, () => {
      for (const p of PAGES_SOURCES) {
        const html = lire(p.adresse[langue]);
        const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
        const liens = [...main.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]!);
        expect(liens.length, p.cle).toBeGreaterThan(10);
        for (const l of liens) expect(existsSync(fichier(l)), `${p.cle} : ${l}`).toBe(true);
      }
    });

    it(`${langue} : l'accueil du centre range chaque page dans ses rubriques, et son menu la marque courante`, () => {
      const accueil = lire(langue === 'fr' ? '/aide/' : '/en/help/');
      for (const p of PAGES_SOURCES) {
        for (const { rubrique } of p.places) {
          const debut = accueil.indexOf(`id="${rubrique}"`);
          const section = accueil.slice(debut, accueil.indexOf('</section>', debut));
          expect(section, `${p.cle} dans ${rubrique}`).toContain(`<a class="aide-carte-lien" href="${p.adresse[langue]}">`);
        }
        const courants = [...lire(p.adresse[langue]).matchAll(/<a href="([^"]+)"[^>]*aria-current="page"/g)].map((m) => m[1]);
        expect(courants, p.cle).toEqual(p.places.map(() => p.adresse[langue]));
      }
    });
  }

  it('elles entrent dans le plan du site et dans llms.txt, et leurs deux langues sont jumelles', () => {
    const plan = readFileSync(join(SITE, 'sitemap.xml'), 'utf8');
    const llms = readFileSync(join(SITE, 'llms.txt'), 'utf8');
    for (const p of PAGES_SOURCES) {
      for (const langue of ['fr', 'en'] as const) {
        expect(plan).toContain(`<loc>https://app.messagingme.fr${p.adresse[langue]}</loc>`);
        expect(llms).toContain(`(https://app.messagingme.fr${p.adresse[langue]})`);
      }
      expect(jumellesAide()[p.adresse.fr]).toBe(p.adresse.en);
    }
  });
});
