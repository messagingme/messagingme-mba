/**
 * LES PARCOURS GUIDÉS (plan 2026-11-24-guide-demarrage, lot 3) : la carte qui accompagne la personne de page en page,
 * cadre le bouton à toucher et passe seule à l'étape suivante quand le geste est fait. Logique pure, tenue par
 * `parcours.test.ts` ; l'écran est `components/GuideCompagnon.tsx`, monté par la coquille.
 *
 * 🔴 UNE CIBLE EST UN `data-testid` QUI EXISTE DANS LA CONSOLE : `parcours.test.ts` refuse une cible qui n'apparaît
 * plus nulle part dans `web/`, sans quoi une refonte d'écran ferait pointer la carte dans le vide en silence.
 * Une cible absente de l'écran à un instant donné (un bouton qui n'existe qu'à la fin d'un entretien) laisse la carte
 * sans cadre : elle ne se ferme pas pour autant.
 */

export type CleParcours = 'agent';

/**
 * Quand l'étape est faite. `page` : l'adresse (chemin et requête) répond au motif ; `present` : un élément est apparu ;
 * `clic` : la personne a touché la cible ; `manuel` : seulement par « Suivant » (une étape qui explique).
 */
export type Passage =
  | { type: 'page'; motif: RegExp }
  | { type: 'present'; testid: string }
  | { type: 'clic' }
  | { type: 'manuel' };

export interface EtapeGuide {
  /** L'écran où l'étape se joue (motif sur chemin + requête), et son adresse pour « Y aller ». */
  page: { motif: RegExp; href: string };
  /** Le `data-testid` de l'élément cadré. */
  cible: string;
  titre: { fr: string; en: string };
  texte: { fr: string; en: string };
  passage: Passage;
}

export interface Parcours { cle: CleParcours; nom: { fr: string; en: string }; etapes: readonly EtapeGuide[]; fin: { fr: string; en: string } }

const FICHE_AGENT = /^\/agents\?(.*&)?id=/;

export const PARCOURS: Readonly<Record<CleParcours, Parcours>> = {
  agent: {
    cle: 'agent',
    nom: { fr: 'Votre agent IA', en: 'Your AI agent' },
    fin: {
      // Le clic ne dit pas si l'activation a réussi (relecture du lot 3) : la fin renvoie à l'état affiché, sans l'affirmer.
      fr: 'Vérifiez en haut de la fiche que votre agent est « Actif ». Il répond alors là où vous l’avez choisi : « Qui répond au client », sur l’Accueil.',
      en: 'Check at the top of the page that your agent is “Active”. It then answers where you chose it: “Who answers the customer”, on Home.',
    },
    etapes: [
      {
        page: { motif: /^\/agents(\?(?!(.*&)?id=).*)?$/, href: '/agents' },
        cible: 'agent-nouveau-label',
        titre: { fr: 'Créez votre agent', en: 'Create your agent' },
        texte: {
          fr: 'Donnez-lui un nom interne (« Conseiller boutique », par exemple), puis « Créer ». Vos clients ne le verront pas.',
          en: 'Give it an internal name (“Store advisor”, for example), then “Create”. Your customers will not see it.',
        },
        passage: { type: 'page', motif: FICHE_AGENT },
      },
      {
        page: { motif: FICHE_AGENT, href: '/agents' },
        cible: 'mba-tab-construction',
        titre: { fr: 'Restez dans « Construire en parlant »', en: 'Stay in “Build by talking”' },
        texte: {
          fr: 'C’est ici que votre agent s’écrit : vous discutez avec l’assistant, il rédige l’agent pour vous. Les autres onglets serviront plus tard, pour l’affiner.',
          en: 'This is where your agent gets written: you talk with the assistant, it drafts the agent for you. The other tabs are for refining it later.',
        },
        passage: { type: 'manuel' },
      },
      {
        page: { motif: FICHE_AGENT, href: '/agents' },
        cible: 'setup-saisie',
        titre: { fr: 'Décrivez votre activité', en: 'Describe your business' },
        texte: {
          fr: 'Deux ou trois phrases suffisent : ce que vous vendez, à qui, et les questions qu’on vous pose le plus. L’assistant vous posera ensuite les siennes.',
          en: 'Two or three sentences are enough: what you sell, to whom, and the questions you get most. The assistant will then ask its own.',
        },
        passage: { type: 'present', testid: 'setup-garder-activer' },
      },
      {
        page: { motif: FICHE_AGENT, href: '/agents' },
        cible: 'setup-garder-activer',
        titre: { fr: 'Relisez, puis activez', en: 'Review, then activate' },
        texte: {
          fr: 'L’assistant propose ce que votre agent dira. Gardez ce qui vous va, puis le bouton encadré, « … et activer ».',
          en: 'The assistant proposes what your agent will say. Keep what suits you, then the framed button, “… and activate”.',
        },
        passage: { type: 'clic' },
      },
    ],
  },
};

/** L'état d'un parcours en cours, gardé dans l'onglet (`sessionStorage`) : il survit à la navigation, pas à l'onglet. */
export interface EtatGuide { parcours: CleParcours; etape: number; replie: boolean; fini: boolean }

export const CLE_STOCKAGE = 'mba.guide';
/** L'événement qui lance un parcours (`detail` : sa clé). La coquille l'écoute. */
export const GUIDE_EVENT = 'mba:guide';

export function lireEtat(brut: string | null): EtatGuide | null {
  if (!brut) return null;
  try {
    const v = JSON.parse(brut) as Partial<EtatGuide>;
    if (typeof v.parcours !== 'string' || !(v.parcours in PARCOURS)) return null;
    const p = PARCOURS[v.parcours as CleParcours];
    const etape = typeof v.etape === 'number' && Number.isInteger(v.etape) ? Math.min(Math.max(v.etape, 0), p.etapes.length - 1) : 0;
    return { parcours: p.cle, etape, replie: v.replie === true, fini: v.fini === true };
  } catch {
    return null;
  }
}

/** L'étape se joue-t-elle sur l'adresse courante (chemin + requête) ? */
export function surLaPage(e: EtapeGuide, adresse: string): boolean {
  return e.page.motif.test(adresse);
}

/** L'étape est-elle faite, d'après l'adresse et ce qui est à l'écran ? (`clic` et `manuel` se jugent ailleurs.) */
export function passageAtteint(e: EtapeGuide, adresse: string, present: (testid: string) => boolean): boolean {
  if (e.passage.type === 'page') return e.passage.motif.test(adresse);
  if (e.passage.type === 'present') return present(e.passage.testid);
  return false;
}

/**
 * Avance tant que l'étape courante est déjà faite : une personne qui a créé son agent avant de lancer le guide ne doit
 * pas rester bloquée sur « Créez votre agent ». S'arrête à la dernière étape ; une étape `clic` ou `manuel` n'avance
 * jamais d'ici.
 */
export function avancer(etat: EtatGuide, adresse: string, present: (testid: string) => boolean): EtatGuide {
  const p = PARCOURS[etat.parcours];
  let i = etat.etape;
  while (i < p.etapes.length - 1 && passageAtteint(p.etapes[i]!, adresse, present)) i += 1;
  return i === etat.etape ? etat : { ...etat, etape: i };
}
