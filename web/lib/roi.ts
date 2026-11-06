import { SOURCES_VENTES, type SourceVente } from './ventes';

/**
 * Quantitatif > Shopify, le ROI des messages (plan `docs/superpowers/plans/2026-11-06-roi-shopify.md`, tâche 6) : la
 * réponse de `/stats/roi` (`RoiVentes`, `src/shopify/roi.ts`), lue défensivement.
 *
 * 🔴 LE CHIFFRE RESTE DU TEXTE, le coût est un nombre au centime : l'écran n'additionne ni l'un ni l'autre, il affiche ce
 * que le serveur a calculé. `null` pour une réponse illisible : la carte disparaît plutôt que d'afficher un zéro faux.
 */

export interface PointRoiVue { jour: string; chiffreCumule: string; coutCumule: number }
export interface SourceRoiVue {
  source: SourceVente;
  campaignId: string | null;
  nom: string | null;
  cout: number | null;
  brut: string;
  roiPct: number | null;
  partiel: boolean;
}
export interface RoiVue {
  devise: string | null;
  serie: PointRoiVue[];
  depense: number;
  ramene: string;
  prouve: string;
  roiPct: number | null;
  ia: number;
  estime: boolean;
  partiel: boolean;
  autresDevises: Array<{ devise: string | null; cout: number }>;
  sources: SourceRoiVue[];
  autres: { sources: number; cout: number } | null;
}

type Objet = Record<string, unknown>;
const estObjet = (v: unknown): v is Objet => typeof v === 'object' && v !== null && !Array.isArray(v);
const decimal = (v: unknown): v is string => typeof v === 'string' && /^\d+(\.\d+)?$/.test(v);
const codeDevise = (v: unknown): string | null => (typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : null);
const montant = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const pct = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const jour = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const texteOuNul = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function lireSource(v: unknown): SourceRoiVue | null {
  if (!estObjet(v) || !(SOURCES_VENTES as readonly unknown[]).includes(v.source) || !decimal(v.brut)) return null;
  return {
    source: v.source as SourceVente, campaignId: texteOuNul(v.campaignId), nom: texteOuNul(v.nom),
    cout: montant(v.cout), brut: v.brut, roiPct: pct(v.roiPct), partiel: v.partiel === true,
  };
}

export function lireRoi(brut: unknown): RoiVue | null {
  if (!estObjet(brut) || !Array.isArray(brut.serie) || montant(brut.depense) === null || !decimal(brut.ramene)) return null;
  const serie = brut.serie.flatMap((p: unknown) =>
    (estObjet(p) && jour(p.jour) && decimal(p.chiffreCumule) && montant(p.coutCumule) !== null
      ? [{ jour: p.jour, chiffreCumule: p.chiffreCumule, coutCumule: p.coutCumule as number }] : []));
  const autres = estObjet(brut.autres) && montant(brut.autres.cout) !== null && typeof brut.autres.sources === 'number'
    ? { sources: brut.autres.sources, cout: brut.autres.cout as number } : null;
  return {
    devise: codeDevise(brut.devise),
    serie,
    depense: brut.depense as number,
    ramene: brut.ramene,
    prouve: decimal(brut.prouve) ? brut.prouve : '0',
    roiPct: pct(brut.roiPct),
    ia: montant(brut.ia) ?? 0,
    estime: brut.estime === true,
    partiel: brut.partiel === true,
    autresDevises: (Array.isArray(brut.autresDevises) ? brut.autresDevises : []).flatMap((a: unknown) =>
      (estObjet(a) && montant(a.cout) !== null ? [{ devise: codeDevise(a.devise), cout: a.cout as number }] : [])),
    sources: (Array.isArray(brut.sources) ? brut.sources : []).map(lireSource).filter((s): s is SourceRoiVue => s !== null),
    autres,
  };
}

/** Le ROI en pourcentage, signé : « +2 200 % », « -100 % ». */
export function fmtRoi(p: number, locale: string): string {
  return `${p > 0 ? '+' : ''}${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(p)} %`;
}
