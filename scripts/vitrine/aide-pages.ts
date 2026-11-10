// scripts/vitrine/aide-pages.ts
// Le REGISTRE du centre d'aide de la vitrine (plan docs/superpowers/plans/2026-10-20-centre-d-aide.md, tâche 5) : les
// fiches publiques de `docs/aide/fiches/`, leur version anglaise (`docs/aide/fiches/en/`) et leurs adresses. Le
// générateur (`aide.ts`) écrit les pages ; `anglais.ts` en lit les jumelles. Ce fichier n'importe ni l'un ni l'autre :
// `anglais.ts` le lit à l'import, et une boucle d'imports le laisserait à moitié chargé.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { champDeFiche, lireFicheDuDepot, publicationDe, RUBRIQUES, type PublicationFiche, type Rubrique } from '../../src/aide/fiches';
import { PAGES_CLAUDE } from './aide-claude-textes';
import { PAGES_SOURCES } from './aide-sources-textes';
import { DEPANNAGE } from './depannage-textes';
import { TEXTES_TUNNEL } from './tunnel-textes';

export type Langue = 'fr' | 'en';

const DOSSIER = fileURLToPath(new URL('../../docs/aide/fiches/', import.meta.url));

/** L'accueil du centre d'aide, par langue. */
export const ACCUEIL_AIDE: Readonly<Record<Langue, string>> = { fr: '/aide/', en: '/en/help/' };

/**
 * LE GUIDE DU NUMÉRO (lot 4a de l'aide à la connexion) : le tunnel de `/demarrer/` à partir de « Qui paie vos messages
 * à Meta ? », sur le gabarit du centre (`aide.ts`). Il paraît dans les deux rubriques « Démarrer », au rang que la spec
 * lui donne ; ses textes et son adresse vivent avec ceux de l'arbre (`tunnel-textes.ts`, `guide`).
 */
export const GUIDE_NUMERO: Readonly<Record<Langue, string>> = { fr: TEXTES_TUNNEL.fr.guide.adresse, en: TEXTES_TUNNEL.en.guide.adresse };
export const PLACES_GUIDE: ReadonlyArray<{ rubrique: Rubrique; rang: number }> = [
  { rubrique: 'demarrer-claude', rang: 4 }, { rubrique: 'demarrer-console', rang: 4 },
];

/** Le dépannage (lot 4a) : en dernier de chaque rubrique « Démarrer », comme la spec le range. */
export const PLACES_DEPANNAGE: ReadonlyArray<{ rubrique: Rubrique; rang: number }> = [
  { rubrique: 'demarrer-claude', rang: 8 }, { rubrique: 'demarrer-console', rang: 10 },
];

/** Le nom de chaque rubrique, dans l'ordre du menu (`RUBRIQUES`). */
export const NOMS_RUBRIQUES: Readonly<Record<Rubrique, Readonly<Record<Langue, string>>>> = {
  'demarrer-claude': { fr: 'Démarrer avec Claude Code ou Codex', en: 'Get started with Claude Code or Codex' },
  'demarrer-console': { fr: 'Démarrer avec la console', en: 'Get started with the console' },
  'parler-aux-clients': { fr: 'Parler aux clients', en: 'Talk to customers' },
};

/**
 * Les pages d'une rubrique, dans l'ordre de leur rang DANS cette rubrique : une fiche placée dans deux rubriques
 * (`places`, lot 4a) paraît dans les deux, chacune à son rang.
 */
export function pagesDeLaRubrique<P extends { publication: PublicationFiche }>(pages: readonly P[], r: Rubrique): P[] {
  const rang = (p: P): number => p.publication.places.find((x) => x.rubrique === r)?.rang ?? 0;
  return pages.filter((p) => p.publication.places.some((x) => x.rubrique === r)).sort((a, b) => rang(a) - rang(b));
}

export interface VersionPage {
  adresse: string;
  titre: string;
  corps: string;
  /** Le libellé du bouton de la console (`bouton_console` de l'en-tête), à la place de « Ouvrir « <écran> » ». */
  boutonConsole: string | null;
  /** Le libellé du bouton vers le plugin d'une fiche `claude_code: oui` (`bouton_claude`), à la place du libellé commun. */
  boutonClaude: string | null;
  /** La description de la page pour les moteurs (`description` de l'en-tête), quand le chapeau dépasse 160 caractères. */
  description: string | null;
}

/** Une page du centre d'aide : sa fiche, sa publication, et ses deux langues. */
export interface PageAide {
  cle: string;
  ecran: string | null;
  /** L'ancre de l'écran où mène le bouton de la console (`ancre_console`), une carte de Paramètres par exemple. */
  ancreConsole: string | null;
  publication: PublicationFiche;
  fr: VersionPage;
  en: VersionPage;
}

/** Les pages du centre, dans l'ordre du menu : rubrique, puis rang. */
export function pagesDuCentre(dossier: string = DOSSIER): PageAide[] {
  return readdirSync(dossier)
    .filter((n) => n.endsWith('.md'))
    .flatMap((nom): PageAide[] => {
      const texte = readFileSync(join(dossier, nom), 'utf8');
      const publication = publicationDe(texte);
      if (publication === null) return [];
      const fr = lireFicheDuDepot(nom, texte);
      // Un message qui dit quoi faire, plutôt qu'un ENOENT à l'import des tests de la vitrine (relecture du lot 3).
      if (!existsSync(join(dossier, 'en', nom))) {
        throw new Error(`docs/aide/fiches/en/${nom} manquante : une fiche publique a sa version anglaise (la traduire, avec slug et traduit_de)`);
      }
      const texteEn = readFileSync(join(dossier, 'en', nom), 'utf8');
      const en = lireFicheDuDepot(nom, texteEn);
      const slug = champDeFiche(texteEn, 'slug');
      if (slug === null) throw new Error(`docs/aide/fiches/en/${nom} : sans slug`);
      const ancreConsole = champDeFiche(texte, 'ancre_console');
      if (ancreConsole !== null && !/^[a-z0-9-]+$/.test(ancreConsole)) throw new Error(`${nom} : ancre_console « ${ancreConsole} »`);
      return [{
        cle: fr.cle,
        ecran: fr.ecran,
        ancreConsole,
        publication,
        fr: {
          adresse: `${ACCUEIL_AIDE.fr}${fr.cle}/`, titre: fr.titre, corps: fr.corps,
          boutonConsole: champDeFiche(texte, 'bouton_console'), boutonClaude: champDeFiche(texte, 'bouton_claude'),
          description: champDeFiche(texte, 'description'),
        },
        en: {
          adresse: `${ACCUEIL_AIDE.en}${slug}/`, titre: en.titre, corps: en.corps,
          boutonConsole: champDeFiche(texteEn, 'bouton_console'), boutonClaude: champDeFiche(texteEn, 'bouton_claude'),
          description: champDeFiche(texteEn, 'description'),
        },
      }];
    })
    .sort((a, b) => RUBRIQUES.indexOf(a.publication.rubrique) - RUBRIQUES.indexOf(b.publication.rubrique)
      || a.publication.rang - b.publication.rang);
}

/**
 * Chaque page française du centre et sa jumelle anglaise, l'accueil compris, plus les pages « Depuis Claude Code » de
 * la doc développeurs (lu par `anglais.ts`).
 */
export function jumellesAide(): Record<string, string> {
  return Object.fromEntries([
    [ACCUEIL_AIDE.fr, ACCUEIL_AIDE.en],
    [GUIDE_NUMERO.fr, GUIDE_NUMERO.en],
    [DEPANNAGE.adresse.fr, DEPANNAGE.adresse.en],
    ...PAGES_SOURCES.map((s) => [s.adresse.fr, s.adresse.en]),
    ...pagesDuCentre().map((p) => [p.fr.adresse, p.en.adresse]),
    ...PAGES_CLAUDE.map((p) => [p.adresse.fr, p.adresse.en]),
  ]);
}

/** Les pages françaises « Depuis Claude Code » : générées ici, donc hors de la traduction par dictionnaires. */
export const ADRESSES_CLAUDE_FR: ReadonlySet<string> = new Set(PAGES_CLAUDE.map((p) => p.adresse.fr));
