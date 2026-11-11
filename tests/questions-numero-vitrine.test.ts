import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OFFRE_CREDIT_WHATSAPP, TEXTES_TUNNEL } from '../scripts/vitrine/tunnel-textes';
import { FAQ } from '../scripts/plugin/faq';
import {
  CARTES_OFFRE, ISSUE_API, ISSUE_AUTRE_NUMERO, ISSUE_FOURNI, ISSUE_TELECHARGER, META_BUSINESS_URL, NOTE_CARTE_APPLICATION, QUESTION_APPLICATION,
  QUESTION_COMPTE, QUESTION_MEME_NUMERO, QUESTION_NUMERO, QUESTION_OFFRE, QUESTION_PAIEMENT, WHATSAPP_ORDINAIRE,
} from '../web/lib/questions-numero';
import { VITRINE_AIDE } from '../web/lib/partage/aide-connexion';
import { AIDE_NUMERO } from '../src/mcp/mise-en-service';

/**
 * LA CONSOLE POSE LES QUESTIONS DE LA VITRINE (2026-10-30, plan `docs/superpowers/plans/2026-10-30-tunnel-numero-console-plugin.md`).
 * L'arbre de Julien vit dans `scripts/vitrine/tunnel-textes.ts` ; la page « Connecter WhatsApp » en reprend les questions 2
 * à 5 (`web/lib/questions-numero.ts`), qui ne peut pas importer la vitrine. Retoucher l'une sans l'autre ferait poser
 * deux arbres différents : ce test compare au mot près, balises et espaces insécables de la vitrine retirés.
 */
const texte = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');

describe('la console pose les questions du tunnel de la vitrine', () => {
  for (const langue of ['fr', 'en'] as const) {
    const v = TEXTES_TUNNEL[langue];
    const question = (id: string) => v.questions.find((q) => q.id === id)!;
    const issue = (id: string) => v.issues.find((x) => x.id === id)!;

    it(`${langue} : la formule au premier écran de la console, la question et ses quatre cartes au mot près (lot 3b)`, () => {
      const q = question('offre');
      expect(QUESTION_OFFRE.texte[langue]).toBe(texte(q.texte));
      expect(QUESTION_OFFRE.precision[langue]).toBe(texte(q.precision!));
      expect(QUESTION_OFFRE.aide[langue]).toBe(texte(q.aide!));
      expect(QUESTION_OFFRE.nsp[langue]).toBe(texte(q.reponses.find((r) => !r.vers)!.libelle));
      // Les quatre cartes, dans l'ordre de la vitrine, chacune sous la réponse de même formule.
      const avecFormule = q.reponses.filter((r) => r.offre);
      expect(CARTES_OFFRE.map((c) => c.offre)).toEqual(avecFormule.map((r) => r.offre));
      CARTES_OFFRE.forEach((c, i) => {
        const v = q.voies![i]!;
        expect(c.libelle[langue], c.offre).toBe(texte(avecFormule[i]!.libelle));
        expect(c.titre[langue], c.offre).toBe(texte(v.titre));
        expect(c.badge?.[langue], c.offre).toBe(v.badge === undefined ? undefined : texte(v.badge));
        expect(c.plus.map((x) => x[langue]), c.offre).toEqual(v.plus.map(texte));
        expect(c.moins.map((x) => x[langue]), c.offre).toEqual(v.moins.map(texte));
      });
    });

    it(`${langue} : « Qui paie vos messages à Meta ? » juste après l’offre ; la carte chez Meta mène à l’arbre, le Crédit WhatsApp à la console`, () => {
      // Révision du Crédit WhatsApp, lot B (Julien, 2026-11-06) : Free y mène ; Pro aussi, par « Claude Code ou Codex » de
      // la question du pilotage (lot 3c) ; Business et Entreprise, comme avant, à l'échange.
      const offre = question('offre');
      expect(offre.reponses.filter((r) => r.offre === 'free' || r.offre === 'pro').map((r) => r.vers)).toEqual(['paiement', 'pilote']);
      expect(question('pilote').reponses.map((r) => r.vers)).toEqual(['console', 'paiement']);
      const q = question('paiement');
      expect(QUESTION_PAIEMENT.texte[langue]).toBe(texte(q.texte));
      expect(QUESTION_PAIEMENT.precision[langue]).toBe(texte(q.precision!));
      const cartes = [QUESTION_PAIEMENT.carte, QUESTION_PAIEMENT.credit];
      expect(q.voies!.map((x) => texte(x.titre))).toEqual(cartes.map((c) => c.titre[langue]));
      expect(q.voies!.map((x) => texte(x.plus[0]!))).toEqual(cartes.map((c) => c.texte[langue]));
      expect(q.reponses.map((r) => r.libelle)).toEqual(cartes.map((c) => c.titre[langue]));
      expect(q.reponses[0]!.vers).toBe('compte');
      // Les deux liens de la carte chez Meta (lot 3a) : les mêmes mots, les mêmes fiches (la console les vise sur la vitrine).
      expect(q.voies![0]!.liens?.map((l) => ({ libelle: texte(l.libelle), href: l.href })))
        .toEqual(QUESTION_PAIEMENT.carte.liens.map((l) => ({ libelle: l.libelle[langue], href: l.href[langue].replace(VITRINE_AIDE, '') })));
      // Le Crédit WhatsApp ne se prend pas sur la vitrine : en Free, il vient avec la formule Pro (les mots de la console) ;
      // en Pro, depuis l'ouverture de la vente (lot 3v-2), la réponse mène à l'onglet de la console, plus à « écrivez-nous ».
      const g = q.reponses[1]!.grisee!;
      expect(texte(g.free!)).toBe(QUESTION_PAIEMENT.grisee.free[langue]);
      expect(g.pro).toContain(`href="${OFFRE_CREDIT_WHATSAPP[langue]}"`);
      expect(g.pro).not.toMatch(/contact\//);
    });

    it(`${langue} : les voies qui gardent l’application disent qu’on y paie Meta avec sa carte`, () => {
      for (const id of ['garder', 'telecharger', 'fourni']) expect(issue(id).textes.map(texte), id).toContain(NOTE_CARTE_APPLICATION[langue]);
      // La FAQ du plugin, sur la même question (lot C du Crédit WhatsApp) : la même phrase.
      expect(FAQ.find((q) => q.id === 'numero-dans-l-application')!.reponse[langue]).toContain(NOTE_CARTE_APPLICATION[langue]);
    });

    it(`${langue} : « Avez-vous un compte Meta Business ? », ses trois réponses et leurs notes`, () => {
      const q = question('compte');
      expect(QUESTION_COMPTE.texte[langue]).toBe(texte(q.texte));
      expect(QUESTION_COMPTE.precision[langue]).toBe(texte(q.precision!));
      expect([QUESTION_COMPTE.oui, QUESTION_COMPTE.non, QUESTION_COMPTE.nsp].map((r) => r[langue])).toEqual(q.reponses.map((r) => r.libelle));
      // Oui mène au numéro API, Non et « Je ne sais pas » à la question de l'application.
      expect(q.reponses.map((r) => r.vers)).toEqual(['api', 'application', 'application']);
      expect(QUESTION_COMPTE.noteNon[langue]).toBe(texte(q.reponses[1]!.note!));
      const n = QUESTION_COMPTE.noteNsp;
      expect(`${n.avant[langue]}business.facebook.com${n.apres[langue]}`).toBe(texte(q.reponses[2]!.note!));
      expect(q.reponses[2]!.note).toContain(`href="${META_BUSINESS_URL}"`);
    });

    it(`${langue} : « Avez-vous déjà l’application WhatsApp Business ? », Oui demande si c’est ce numéro-là, Non la fait télécharger`, () => {
      const q = question('application');
      expect(QUESTION_APPLICATION.texte[langue]).toBe(texte(q.texte));
      expect(QUESTION_APPLICATION.precision[langue]).toBe(texte(q.precision!));
      expect([QUESTION_APPLICATION.oui, QUESTION_APPLICATION.non].map((r) => r[langue])).toEqual(q.reponses.map((r) => r.libelle));
      // Avec l'application, on la garde ; sans elle, la 4e question (Julien, 2026-10-31).
      expect(q.reponses.map((r) => r.vers)).toEqual(['meme-numero', 'numero']);
      // Avant elle, « il faudra la télécharger », avec les deux magasins : le texte au mot près, les liens à l'adresse près.
      const note = q.reponses[1]!.note!;
      expect(QUESTION_APPLICATION.noteNon[langue]).toBe(texte(note.replace(/<span class="bt-liens">[\s\S]*<\/span>$/, '')));
      expect([...note.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(ISSUE_TELECHARGER.magasins.map((m) => m.href));
    });

    it(`${langue} : le cas 4, « Voulez-vous utiliser ce numéro-là ? » : Oui la garde, Non mène à un numéro de chez nous (lot 3a)`, () => {
      const q = question('meme-numero');
      expect(QUESTION_MEME_NUMERO.texte[langue]).toBe(texte(q.texte));
      expect(QUESTION_MEME_NUMERO.precision[langue]).toBe(texte(q.precision!));
      expect([QUESTION_MEME_NUMERO.oui, QUESTION_MEME_NUMERO.non].map((r) => r[langue])).toEqual(q.reponses.map((r) => r.libelle));
      expect(q.reponses.map((r) => r.vers)).toEqual(['garder', 'autre-numero']);
      const x = issue('autre-numero');
      expect(ISSUE_AUTRE_NUMERO.titre[langue]).toBe(texte(x.titre));
      expect(ISSUE_AUTRE_NUMERO.texte[langue]).toBe(texte(x.textes[0]!));
    });

    it(`${langue} : WhatsApp ordinaire, dit au mot près là où le numéro peut servir dans WhatsApp (lot 3a)`, () => {
      for (const id of ['garder', 'telecharger']) expect(issue(id).textes.map(texte), id).toContain(WHATSAPP_ORDINAIRE[langue]);
    });

    it(`${langue} : « Avez-vous déjà un numéro que vous pourriez utiliser ? », Oui le met dans l’application, Non le fait fournir`, () => {
      const q = question('numero');
      expect(QUESTION_NUMERO.texte[langue]).toBe(texte(q.texte));
      expect(QUESTION_NUMERO.precision[langue]).toBe(texte(q.precision!));
      expect([QUESTION_NUMERO.oui, QUESTION_NUMERO.non].map((r) => r[langue])).toEqual(q.reponses.map((r) => r.libelle));
      expect(q.reponses.map((r) => r.vers)).toEqual(['telecharger', 'fourni']);
    });

    it(`${langue} : le numéro fourni mis dans l’application, ses phrases et ses magasins`, () => {
      const x = issue('fourni');
      expect(ISSUE_FOURNI.titre[langue]).toBe(texte(x.titre));
      // Le numéro et son code, répondre dès le premier jour, puis le numéro tout neuf : la 1re, la 2e et la dernière phrase.
      expect(ISSUE_FOURNI.textes.map((p) => p[langue])).toEqual([texte(x.textes[0]!), texte(x.textes[1]!), texte(x.textes[x.textes.length - 1]!)]);
      expect(ISSUE_TELECHARGER.magasins.map((m) => ({ libelle: m.libelle[langue], href: m.href }))).toEqual(x.liens);
    });

    it(`${langue} : les issues que la console reprend`, () => {
      const api = issue('api');
      expect(ISSUE_API.titre[langue]).toBe(texte(api.titre));
      expect(ISSUE_API.garder[langue]).toBe(texte(api.autre!.question));
      expect(ISSUE_API.lien[langue]).toBe(texte(api.autre!.lien));
      const t = issue('telecharger');
      expect(ISSUE_TELECHARGER.titre[langue]).toBe(texte(t.titre));
      // Brancher tout de suite, puis le numéro trop neuf : la première et la dernière phrase de l'issue de la vitrine.
      expect(ISSUE_TELECHARGER.textes.map((x) => x[langue])).toEqual([texte(t.textes[0]!), texte(t.textes[t.textes.length - 1]!)]);
      // Les deux magasins de l'application, mêmes libellés et mêmes adresses.
      expect(ISSUE_TELECHARGER.magasins.map((m) => ({ libelle: m.libelle[langue], href: m.href }))).toEqual(t.liens);
    });
  }

  it('🔴 aucun chiffre de jours pour le numéro trop neuf : Meta n’en publie aucun', () => {
    for (const x of [...ISSUE_TELECHARGER.textes, ...ISSUE_FOURNI.textes.slice(1)]) expect(`${x.fr} ${x.en}`).not.toMatch(/\d/);
  });
});

describe('le plugin pose les mêmes questions, sans QR code', () => {
  const lire = (chemin: string) => readFileSync(join(process.cwd(), chemin), 'utf8');
  const en = TEXTES_TUNNEL.en;
  const q = (id: string) => texte(en.questions.find((x) => x.id === id)!.texte);

  it('🔴 la skill de mise en service : l’offre, le compte Meta Business, l’application, puis ce numéro-là, dans cet ordre', () => {
    const skill = lire('plugin/skills/mise-en-service/SKILL.md');
    const rangs = ['**The plan: Free or Pro?**', `**"${q('paiement')}"**`, `**"${q('compte')}"**`, `**"${q('application')}"**`, `**"${q('meme-numero')}"**`, `**"${q('numero')}"**`].map((m) => skill.indexOf(m));
    expect(rangs.every((r) => r > 0), rangs.join(',')).toBe(true);
    expect([...rangs].sort((a, b) => a - b)).toEqual(rangs);
    // Le numéro trop neuf se dit sans chiffre, et le QR code n'est plus nommé que pour dire qu'il n'est plus proposé.
    expect(skill).toContain('Never give a number of days');
    expect(skill).toContain('**The QR code link is no longer offered**');
    expect(skill).not.toMatch(/On the QR code track|By QR code, to answer/);
  });

  it('🔴 la carte du moyen de paiement, dans la skill : son libellé et ses deux pages (jaune 8 du lot 3a)', () => {
    const skill = lire('plugin/skills/mise-en-service/SKILL.md');
    expect(skill).toContain(QUESTION_PAIEMENT.carte.titre.en);
    // Depuis le lot 4b, la skill ne tape plus les adresses : elle nomme les champs `aide` de get_setup_state, qui portent
    // les mêmes pages que les deux liens de la carte, dans le même ordre.
    expect(skill).toContain('`aide.payer_meta`');
    expect(skill).toContain('`aide.compte_meta_business`');
    expect(QUESTION_PAIEMENT.carte.liens.map((l) => l.href)).toEqual([AIDE_NUMERO.payer_meta, AIDE_NUMERO.compte_meta_business]);
  });

  it('🔴 ni le README ni la FAQ ne proposent le QR code ou l’appareil lié', () => {
    expect(lire('plugin/README.md')).not.toMatch(/QR|linked device/i);
    for (const e of FAQ) {
      expect(`${e.question.fr} ${e.question.en} ${e.reponse.fr} ${e.reponse.en}`, e.id).not.toMatch(/QR|appareil lié|linked device/i);
    }
  });
});
