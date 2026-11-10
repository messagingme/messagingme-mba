// scripts/vitrine/aide-sources-textes.ts
// LES PAGES DU CENTRE COMPOSÉES DE SOURCES (lot 4a-2 de l'aide à la connexion, spec `2026-11-08-aide-connexion-numero-
// design.md`, « Démarrer avec Claude Code ou Codex », 6 et 7) : « Payer Meta » et « Les modèles WhatsApp ». Comme le
// dépannage, aucune phrase n'y est recopiée : chaque section cite une réponse de la FAQ du plugin
// (`scripts/plugin/faq.ts`), les étapes de la carte chez Meta et ce que Meta facture selon le chemin
// (`web/lib/partage/etapes-meta.ts`), ou la carte du Crédit WhatsApp (`web/lib/questions-numero.ts`). Seuls les titres
// des sections et les chapeaux sont écrits ici. `tests/vitrine-aide-sources.test.ts` tient chaque citation égale à sa
// source.
//
// 🔴 QUI FACTURE QUOI SE DIT PAR `CE_QUI_EST_FACTURE`, JAMAIS PAR LA RÉPONSE « que facture Meta » DE LA FAQ (rouge de la
// relecture du lot, 2026-11-10). Celle-ci dit que Meta facture toujours l'entreprise et que Messaging Me ne touche pas à
// ces frais : c'est faux avec le Crédit WhatsApp, que « Payer Meta » propose, et elle fait payer toutes les réponses quand
// la console dit « au-delà de la franchise ». On n'en garde que ce qui reste vrai, le tarif que donne Claude.
import type { Rubrique } from '../../src/aide/fiches';
import { CE_QUI_EST_FACTURE, ETAPES_CARTE_META } from '../../web/lib/partage/etapes-meta';
import { NOTE_CARTE_APPLICATION, QUESTION_PAIEMENT } from '../../web/lib/questions-numero';
import { FAQ, GRILLE_META } from '../plugin/faq';
import type { Bilingue } from './aide-claude-textes';

/**
 * Le lien qui finit une section : une fiche du centre ou une autre de ces pages, dont le titre et l'adresse se lisent
 * chez elles (précédés de « Pour aller plus loin »), ou une adresse donnée, avec son libellé.
 */
export type LienSource =
  | { readonly fiche: string }
  | { readonly page: string }
  | { readonly libelle: Bilingue; readonly href: Bilingue };

/** Une section : son titre, ses paragraphes, une liste numérotée quand elle donne des étapes, et un lien pour finir. */
export interface SectionSource {
  readonly titre: Bilingue;
  readonly textes: readonly Bilingue[];
  readonly etapes?: readonly Bilingue[];
  readonly lien?: LienSource;
}

export interface PageSource {
  readonly cle: string;
  readonly adresse: Bilingue;
  readonly titre: Bilingue;
  readonly chapeau: Bilingue;
  readonly places: ReadonlyArray<{ readonly rubrique: Rubrique; readonly rang: number }>;
  readonly sections: readonly SectionSource[];
  readonly lien?: { readonly libelle: Bilingue; readonly href: Bilingue };
}

const b = (x: { readonly fr: string; readonly en: string }): Bilingue => ({ fr: x.fr, en: x.en });

/** Une réponse de la FAQ du plugin, telle quelle, sous sa question ou sous le titre que la page lui donne. */
const faq = (id: string, titre?: Bilingue): SectionSource => {
  const q = FAQ.find((x) => x.id === id);
  if (!q) throw new Error(`aide-sources : la FAQ du plugin n'a pas de question « ${id} »`);
  return { titre: titre ?? b(q.question), textes: [b(q.reponse)] };
};

/**
 * Un passage d'une réponse de la FAQ, de `depuis` (compris) jusqu'à `avant` (exclu), quand la page n'en garde qu'une
 * partie (le tarif que donne Claude, sans ce qui précède ni les étapes de la carte, données sur « Payer Meta »). La
 * coupe échoue bruyamment si la réponse ne contient plus l'une ou l'autre borne.
 */
const faqPassage = (id: string, bornes: { readonly depuis: Bilingue; readonly avant: Bilingue }, titre: Bilingue): SectionSource => {
  const s = faq(id, titre);
  const couper = (t: string, depuis: string, avant: string): string => {
    const debut = t.indexOf(depuis);
    const fin = t.indexOf(avant, debut);
    if (debut < 0 || fin <= debut) throw new Error(`aide-sources : la réponse « ${id} » ne va plus de « ${depuis} » à « ${avant} »`);
    return t.slice(debut, fin).trimEnd();
  };
  const t = s.textes[0]!;
  return { ...s, textes: [{ fr: couper(t.fr, bornes.depuis.fr, bornes.avant.fr), en: couper(t.en, bornes.depuis.en, bornes.avant.en) }] };
};

/** Le tarif que donne Claude, dans la réponse « que facture Meta » : de sa première phrase à l'annonce des étapes de la carte. */
const TARIF_DE_CLAUDE = {
  depuis: { fr: 'Claude vous donne', en: 'Claude gives you' },
  avant: { fr: 'Pour ajouter la carte', en: 'To add the card' },
};

const GRILLE = {
  libelle: { fr: 'La grille de Meta', en: 'Meta’s rate card' },
  href: { fr: GRILLE_META, en: GRILLE_META },
};

export const PAGES_SOURCES: readonly PageSource[] = [
  {
    cle: 'payer-meta',
    adresse: { fr: '/aide/payer-meta-poser-votre-carte/', en: '/en/help/pay-meta-add-your-card/' },
    titre: { fr: 'Payer Meta : poser votre carte', en: 'Pay Meta: add your card' },
    chapeau: {
      fr: 'Ce que Meta facture selon votre numéro, et où poser votre carte chez Meta. Ou, sans carte, le Crédit WhatsApp.',
      en: 'What Meta bills depending on your number, and where to add your card at Meta. Or, with no card, WhatsApp credit.',
    },
    // Dans les deux rubriques de démarrage : la page sert la console comme Claude, d'où aucun outil de Claude ici.
    places: [{ rubrique: 'demarrer-claude', rang: 6 }, { rubrique: 'demarrer-console', rang: 9 }],
    sections: [
      {
        titre: { fr: 'Si votre numéro passe entièrement par Messaging Me', en: 'If your number goes entirely through Messaging Me' },
        textes: [b(CE_QUI_EST_FACTURE.api)],
      },
      {
        titre: { fr: 'Si vous gardez l’application WhatsApp Business', en: 'If you keep the WhatsApp Business app' },
        textes: [b(CE_QUI_EST_FACTURE.application), b(NOTE_CARTE_APPLICATION)],
        lien: { fiche: 'garder-mon-application-whatsapp-business' },
      },
      {
        titre: { fr: 'Poser votre carte chez Meta', en: 'Add your card at Meta' },
        textes: [],
        etapes: ETAPES_CARTE_META.map(b),
      },
      {
        titre: b(QUESTION_PAIEMENT.credit.titre),
        textes: [b(QUESTION_PAIEMENT.credit.texte)],
        lien: { libelle: b(QUESTION_PAIEMENT.grisee.pro), href: { fr: '/contact/', en: '/en/contact/' } },
      },
    ],
    lien: GRILLE,
  },
  {
    cle: 'modeles-whatsapp',
    adresse: { fr: '/aide/les-modeles-whatsapp/', en: '/en/help/whatsapp-templates/' },
    titre: { fr: 'Les modèles WhatsApp : pourquoi, quelle catégorie, combien', en: 'WhatsApp templates: why, which category, how much' },
    chapeau: {
      fr: 'Pour écrire en premier, WhatsApp exige un modèle approuvé par Meta. Ce qui décide de sa catégorie, ce qu’il coûte, et que faire s’il est refusé.',
      en: 'To write first to someone, WhatsApp requires a template approved by Meta. What decides its category, what it costs, and what to do if it is rejected.',
    },
    // Dans « Démarrer avec Claude Code ou Codex » seulement : ses réponses nomment les outils de Claude.
    places: [{ rubrique: 'demarrer-claude', rang: 7 }],
    sections: [
      { ...faq('fenetre-24-heures', { fr: 'Pourquoi un modèle', en: 'Why a template' }), lien: { fiche: 'la-fenetre-de-24-heures' } },
      faq('utility-ou-marketing', { fr: 'Quelle catégorie : utility ou marketing', en: 'Which category: utility or marketing' }),
      // Qui paie se lit sur « Payer Meta », par `CE_QUI_EST_FACTURE` : ici, le prix seul.
      { ...faqPassage('ce-que-meta-facture', TARIF_DE_CLAUDE, { fr: 'Combien coûte un modèle', en: 'How much a template costs' }), lien: { page: 'payer-meta' } },
      { ...faq('modele-refuse', { fr: 'S’il est refusé', en: 'If it is rejected' }), lien: { fiche: 'faire-approuver-un-modele' } },
    ],
    lien: GRILLE,
  },
];
