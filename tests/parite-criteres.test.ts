import { describe, it, expect } from 'vitest';
import { OUTILS, type DepsMcp } from '../src/mcp/outils';
import { lireCibleMcp } from '../src/mcp/cible';
import { DROITS } from '../src/offres/offres';
import { CLES_FILTRABLES } from '../src/crm/filtre-fiche';
import type { SuiviSegments } from '../src/crm/segments';
import { CONTACT_FILTER_QUERY_KEYS, type ContactFilters } from '../web/lib/partage/contact-filters';
import { CLES_SEGMENT, estCleSegment } from '../web/lib/partage/segments';
import { CRITERES, EXEMPLES_MCP, FAMILLES_DE_CHAMPS } from './parite/criteres';

/**
 * LA PARITÉ DES CRITÈRES D'AUDIENCE (lot 1 du CSM virtuel) : la table `tests/parite/criteres.ts` couvre EXACTEMENT les
 * critères que la console sait poser, chaque argument nommé existe dans les deux outils qui ciblent, et la cible commune
 * le traduit dans ce critère. La liste attendue se DÉRIVE du code, jamais d'une copie.
 */
const T = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const LU = new Date('2026-11-20T08:00:00Z');
const BOUTIQUE: NonNullable<SuiviSegments['boutique']> = {
  devise: 'EUR', commandesDepuis: new Date('2026-10-01T00:00:00Z'), coupeeLe: null, collectionsLuesLe: LU, etiquettesSynchroLe: LU,
};
const deps = {
  contacts: { suiviSegments: async () => ({ boutique: BOUTIQUE }) },
} as unknown as DepsMcp;

const attendus = (): string[] => [
  ...Object.keys(CONTACT_FILTER_QUERY_KEYS).filter((k) => k !== 'fieldFilters'),
  ...FAMILLES_DE_CHAMPS,
  ...Object.values(CLES_SEGMENT),
];
const argumentsNommes = (): string[] => Object.values(CRITERES).flatMap((d) => ('mcp' in d ? d.mcp : []));

/** Deux arguments qui ne ciblent personne seuls : le mode accompagne des étiquettes, « n'a pas acheté » un « a acheté ». */
const ACCOMPAGNEMENT: Readonly<Record<string, Record<string, unknown>>> = {
  tag_mode: { tags: ['vip'] },
  not_bought: { bought: { products: [{ sku: 'SER-60' }] } },
};

/** Ce que la cible pose pour les critères du modèle commun quand leur exemple est donné. */
const ATTENDU_DU_MODELE: Partial<Record<keyof ContactFilters, unknown>> = { tags: ['vip'], tagMode: 'or', optIn: 'opted_in' };

describe('la parité des critères d’audience', () => {
  it('🔴 chaque critère de la console a sa décision, et aucune décision n’est morte', () => {
    expect(Object.keys(CRITERES).sort()).toEqual(attendus().sort());
  });

  it('chaque `aFaire` et chaque exclusion dit ce qu’il faut faire, ou pourquoi', () => {
    for (const [cle, d] of Object.entries(CRITERES)) {
      if ('aFaire' in d) expect(d.quoi.trim().length, cle).toBeGreaterThan(10);
      if ('exclue' in d) expect(d.exclue.trim().length, cle).toBeGreaterThan(10);
      if ('mcp' in d) expect(d.mcp.length, cle).toBeGreaterThan(0);
    }
  });

  it('chaque argument nommé existe dans `find_contacts` ET `prepare_campaign`, et a son exemple', () => {
    for (const nom of ['find_contacts', 'prepare_campaign']) {
      const proprietes = Object.keys(OUTILS.find((o) => o.nom === nom)!.entree.properties ?? {});
      for (const arg of argumentsNommes()) expect(proprietes, `${nom} : ${arg}`).toContain(arg);
    }
    expect(Object.keys(EXEMPLES_MCP).sort()).toEqual([...new Set(argumentsNommes())].sort());
  });

  it('🔴 la cible commune traduit chaque argument dans le critère qu’il couvre', async () => {
    for (const [cle, d] of Object.entries(CRITERES)) {
      if (!('mcp' in d)) continue;
      for (const arg of d.mcp) {
        const args = { ...ACCOMPAGNEMENT[arg], [arg]: EXEMPLES_MCP[arg] };
        const cible = await lireCibleMcp(args, DROITS.entreprise.fonctions, deps, T, { identifiants: false });
        if (!('filters' in cible)) throw new Error(`${arg} : la cible n'est pas un jeu de filtres`);
        const f = cible.filters;
        if (estCleSegment(cle)) {
          expect(f.fieldFilters?.map((x) => x.key), `${arg} -> ${cle}`).toContain(cle);
        } else if (cle === 'champ:analyse') {
          expect(f.fieldFilters?.some((x) => (CLES_FILTRABLES as readonly string[]).includes(x.key)), arg).toBe(true);
        } else {
          const k = cle as keyof ContactFilters;
          expect(ATTENDU_DU_MODELE[k], `${cle} : son attendu manque à ATTENDU_DU_MODELE`).toBeDefined();
          expect(f[k], `${arg} -> ${cle}`).toEqual(ATTENDU_DU_MODELE[k]);
        }
      }
    }
  });
});
