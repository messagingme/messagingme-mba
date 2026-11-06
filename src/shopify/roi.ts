import type { DateRange } from '../stats/range';
import { chiffrer, enumerateDays, round2, type CategoryRates } from '../stats/cost';
import type { GrillePrix } from '../stats/prix';
import type { SourceVente } from './attribution';
import type { ChiffreVentes, LigneSourceVentes, TotalVentes } from './chiffre';
import type { LigneLevier } from './cout-leviers.pg';
import type { SerieChiffre } from './ventes.pg';

/**
 * LE ROI DES MESSAGES (spec docs/superpowers/specs/2026-11-06-roi-shopify-design.md, plan du même jour, tâche 4). Pur.
 *
 * Ce que les leviers de vente ont COÛTÉ, en face de ce qu'ils ont RAMENÉ (le chiffre brut attribué), jour par jour et
 * cumulé, et par source. Le prix d'un message se choisit message par message (spec, choix 2 après relecture) :
 * - la provision du Crédit WhatsApp s'il en a une : le coût RÉEL, en euros, commission comprise ;
 * - sinon l'estimation des autres écrans de coût, dans la devise du compte WhatsApp : un modèle au tarif margé de sa
 *   catégorie (`chiffrer`, la seule définition de « chiffrable »), un message de service au prix effectif de la période
 *   (franchise mensuelle déduite, `prixServiceEffectif` de `src/stats/cout-messages.ts`), un RCS au prix simple de la grille ;
 * - un e-mail n'a pas de prix connu : il rend le coût PARTIEL, jamais nul en silence.
 * L'IA (les tours d'agent, au prix client) s'ajoute en euros, sous la source « agent IA ».
 *
 * 🔴 DEUX DEVISES NE S'ADDITIONNENT JAMAIS. Le ROI ne porte que sur les coûts dans la devise de la boutique ; un coût
 * dans une autre devise est rendu à part (`autresDevises`) et l'écran l'annonce.
 * 🔴 LE CHIFFRE RESTE DU TEXTE : ses cumuls viennent de Postgres. Seul le pourcentage du ROI passe par un nombre, pour
 * une division arrondie à l'entier ; un montant affiché n'en sort jamais.
 * ⚠️ Le RCS est compté au prix SIMPLE : la bascule au tarif conversationnel n'est pas rejouée par jour et par source.
 * Le coût d'un RCS peut donc être sous-estimé, et l'écran dit « estimé » dès qu'une part l'est.
 */

/** Combien de sources le tableau montre au plus, comme la synthèse des campagnes ; le reste est regroupé. */
export const PLAFOND_SOURCES_ROI = 50;

export interface PointRoi { jour: string; chiffreCumule: string; coutCumule: number }

export interface SourceRoi {
  source: SourceVente;
  campaignId: string | null;
  nom: string | null;
  /** Ce qu'elle a coûté dans la devise du ROI ; `null` : rien de chiffrable (l'écran laisse la case vide). */
  cout: number | null;
  /** Ce qu'elle a ramené, décimal en texte, `'0'` pour une source sans vente. */
  brut: string;
  roiPct: number | null;
  partiel: boolean;
}

export interface RoiVentes {
  /** La devise du ROI : celle de la boutique, sinon celle des coûts quand rien n'a été vendu. */
  devise: string | null;
  serie: PointRoi[];
  depense: number;
  ramene: string;
  prouve: string;
  /** (ramené - dépensé) / dépensé, en %, arrondi ; `null` quand rien n'a coûté (« aucun coût sur la période »). */
  roiPct: number | null;
  /** La part de l'IA dans `depense` (même devise), à part sur l'écran. */
  ia: number;
  /** Une part du coût est une estimation (tarifs de Meta, prix de la grille), pas une provision. */
  estime: boolean;
  /** Des messages n'ont pas pu être chiffrés (e-mail, catégorie ou tarif inconnu) : le coût est un plancher. */
  partiel: boolean;
  /** Les coûts dans une autre devise que celle du ROI, jamais additionnés ; `devise: null` = inconnue. */
  autresDevises: Array<{ devise: string | null; cout: number }>;
  sources: SourceRoi[];
  /** Les sources au-delà du plafond, regroupées : leur nombre et leur coût. */
  autres: { sources: number; cout: number } | null;
}

export interface EntreeRoi {
  range: DateRange;
  serieChiffre: SerieChiffre;
  /** Les totaux réels de la période (`chiffreVentes(...).reel.totaux`), par devise. */
  totaux: readonly TotalVentes[];
  /** Les ventes réelles par source (`chiffreVentes(...).reel.sources`). */
  sources: readonly LigneSourceVentes[];
  leviers: readonly LigneLevier[];
  iaParJour: ReadonlyArray<{ jour: string; coutMicroEur: number }>;
  /** Les tarifs margés (`prixFactures`), avec la devise du compte. */
  tarifs: CategoryRates;
  /** Le prix effectif d'un message de service sur la période, dans la devise des tarifs (`prixServiceEffectif`). */
  prixService: number;
  grille: GrillePrix;
}

/** Les prix de la période, venus du chiffrage commun (`getPrixLeviers`, `src/stats/chiffrage.ts`). */
export interface PrixLeviers { tarifs: CategoryRates; prixService: number; grille: GrillePrix }

/** Les lectures du ROI, chacune déjà existante ou dédiée (plan 2026-11-06, tâche 5). */
export interface DepsRoi {
  chiffre(tenantId: string, range: DateRange): Promise<ChiffreVentes>;
  serie(tenantId: string, range: DateRange): Promise<SerieChiffre>;
  volumes(tenantId: string, range: DateRange): Promise<LigneLevier[]>;
  ia(tenantId: string, range: DateRange): Promise<Array<{ jour: string; coutMicroEur: number }>>;
  prix(tenantId: string, range: DateRange): Promise<PrixLeviers>;
}

/** Le ROI d'une période : les cinq lectures en parallèle, puis le calcul pur. */
export async function roiVentes(d: DepsRoi, tenantId: string, range: DateRange): Promise<RoiVentes> {
  const [chiffre, serie, volumes, ia, prix] = await Promise.all([
    d.chiffre(tenantId, range), d.serie(tenantId, range), d.volumes(tenantId, range), d.ia(tenantId, range), d.prix(tenantId, range),
  ]);
  return calculerRoi({
    range, serieChiffre: serie, totaux: chiffre.reel.totaux, sources: chiffre.reel.sources, leviers: volumes, iaParJour: ia,
    tarifs: prix.tarifs, prixService: prix.prixService, grille: prix.grille,
  });
}

const EUR = 'EUR';
const cle = (source: SourceVente, campaignId: string | null): string => `${source}|${campaignId ?? ''}`;

/** Le coût d'une ligne de volumes, éclaté par devise, et ce qu'elle dit d'estimé ou de partiel. */
function coutDeLigne(l: LigneLevier, e: EntreeRoi): { parDevise: Map<string | null, number>; estime: boolean; partiel: boolean } {
  const parDevise = new Map<string | null, number>();
  const ajouter = (devise: string | null, x: number): void => { if (x > 0) parDevise.set(devise, (parDevise.get(devise) ?? 0) + x); };
  ajouter(EUR, l.provisionMicroEur / 1_000_000);
  const reste = Math.max(0, l.n - l.nProvision);
  if (reste === 0) return { parDevise, estime: false, partiel: false };
  const devise = e.tarifs.currency ?? null;
  if (l.nature === 'email') return { parDevise, estime: false, partiel: true };
  if (l.nature === 'service') { ajouter(devise, e.prixService * reste); return { parDevise, estime: true, partiel: false }; }
  if (l.nature === 'rcs') { ajouter(devise, (e.grille.rcsSimpleCentimes / 100) * reste); return { parDevise, estime: true, partiel: false }; }
  const c = chiffrer(l.categorie, e.tarifs);
  if ('refus' in c) return { parDevise, estime: false, partiel: true };
  ajouter(devise, c.tarif * reste);
  return { parDevise, estime: true, partiel: false };
}

const pct = (ramene: number, cout: number): number | null => (cout > 0 ? Math.round(((ramene - cout) / cout) * 100) : null);

export function calculerRoi(e: EntreeRoi): RoiVentes {
  // La devise du ROI : celle qui a le plus vendu (une boutique n'en a qu'une), sinon celle des coûts.
  const parVente = [...e.totaux].sort((a, b) => Number(b.brut) - Number(a.brut));
  const devise = parVente[0]?.devise ?? (e.leviers.some((l) => l.n > l.nProvision) ? e.tarifs.currency ?? null : EUR);

  const coutJour = new Map<string, number>();
  const autres = new Map<string | null, number>();
  const parSource = new Map<string, { source: SourceVente; campaignId: string | null; nom: string | null; cout: number; chiffre: boolean; partiel: boolean }>();
  let estime = false;
  let partiel = false;

  const imputer = (jour: string, source: SourceVente, campaignId: string | null, nom: string | null,
    parDevise: Map<string | null, number>, p: boolean): void => {
    const s = parSource.get(cle(source, campaignId)) ?? { source, campaignId, nom, cout: 0, chiffre: false, partiel: false };
    if (nom !== null) s.nom = nom;
    s.partiel ||= p;
    for (const [d, x] of parDevise) {
      if (d !== null && d === devise) {
        coutJour.set(jour, (coutJour.get(jour) ?? 0) + x);
        s.cout += x;
        s.chiffre = true;
      } else {
        autres.set(d, (autres.get(d) ?? 0) + x);
      }
    }
    parSource.set(cle(source, campaignId), s);
  };

  for (const l of e.leviers) {
    const c = coutDeLigne(l, e);
    estime ||= c.estime;
    partiel ||= c.partiel;
    imputer(l.jour, l.source, l.campaignId, l.nom, c.parDevise, c.partiel);
  }
  let ia = 0;
  for (const j of e.iaParJour) {
    const x = j.coutMicroEur / 1_000_000;
    if (devise === EUR) ia += x;
    imputer(j.jour, 'agent', null, null, new Map([[EUR, x]]), false);
  }

  // Les ventes par source, dans la devise du ROI : une source qui a vendu sans rien coûter a sa ligne aussi.
  const brutDe = new Map<string, string>();
  for (const v of e.sources) {
    if (v.devise !== devise) continue;
    brutDe.set(cle(v.source, v.campaignId), v.brut);
    if (!parSource.has(cle(v.source, v.campaignId))) {
      parSource.set(cle(v.source, v.campaignId), { source: v.source, campaignId: v.campaignId, nom: v.nom, cout: 0, chiffre: false, partiel: false });
    }
  }

  const toutes: SourceRoi[] = [...parSource.values()].map((s) => {
    const brut = brutDe.get(cle(s.source, s.campaignId)) ?? '0';
    const cout = s.chiffre ? round2(s.cout) : null;
    return { source: s.source, campaignId: s.campaignId, nom: s.nom, cout, brut, roiPct: cout === null ? null : pct(Number(brut), cout), partiel: s.partiel };
  }).sort((a, b) => (b.cout ?? 0) - (a.cout ?? 0) || Number(b.brut) - Number(a.brut));
  const gardees = toutes.slice(0, PLAFOND_SOURCES_ROI);
  const coupees = toutes.slice(PLAFOND_SOURCES_ROI);

  // La série dense : le chiffre cumulé de Postgres porté sur les jours sans vente, le coût cumulé jour par jour.
  const chiffreDe = new Map(e.serieChiffre.filter((p) => p.devise === devise).map((p) => [p.jour, p.brutCumule]));
  let chiffre = '0';
  let cumul = 0;
  const serie: PointRoi[] = enumerateDays(e.range.from, e.range.to).map((jour) => {
    chiffre = chiffreDe.get(jour) ?? chiffre;
    cumul += coutJour.get(jour) ?? 0;
    return { jour, chiffreCumule: chiffre, coutCumule: round2(cumul) };
  });

  const total = e.totaux.find((t) => t.devise === devise);
  const ramene = total?.brut ?? '0';
  const depense = round2(cumul);
  return {
    devise,
    serie,
    depense,
    ramene,
    prouve: total?.prouve ?? '0',
    roiPct: pct(Number(ramene), depense),
    ia: round2(ia),
    estime,
    partiel,
    autresDevises: [...autres].map(([d, c]) => ({ devise: d, cout: round2(c) })).filter((a) => a.cout > 0),
    sources: gardees,
    autres: coupees.length > 0 ? { sources: coupees.length, cout: round2(coupees.reduce((n, s) => n + (s.cout ?? 0), 0)) } : null,
  };
}
