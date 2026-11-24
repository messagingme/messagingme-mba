import { request } from './http';
import {
  BORNES_SEGMENTS, type BoutonsSansCommandeVue, type CollectionLueVue, type CollectionsLuesVue, type EtiquetteShopifyVue,
  type EtiquettesShopifyLuesVue, type LectureCollectionsVue, type PlageSurJours, type ProduitVuVue, type SuiviSegmentsVue,
  type SynchroEtiquettesVue,
} from './partage/segments';

/**
 * Ce que l'API sait cibler en segments (`GET /tenants/:id/contacts/segments`, spec du 2026-10-31). 🔴 `null` quand la
 * route ne répond pas, ou répond quelque chose d'illisible : le panneau ne propose alors AUCUN critère de segment. Une
 * API plus ancienne les jetterait sans rien dire, et « au moins deux commandes » rendrait tout l'espace.
 */
export function suiviSegmentsDe(v: unknown): SuiviSegmentsVue | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.activiteCompleteDepuis !== 'string') return null;
  // Les critères produit (lot 3), de collection (lot 6a) et d'étiquette Shopify (lot 6b) : seulement si l'API le dit, en
  // toutes lettres.
  const annonces = {
    ...(o.produits === true ? { produits: true } : {}),
    ...(o.collections === true ? { collections: true } : {}),
    ...(o.etiquettesShopify === true ? { etiquettesShopify: true } : {}),
  };
  if (o.boutique === null) return { boutique: null, activiteCompleteDepuis: o.activiteCompleteDepuis, ...annonces };
  const b = o.boutique as Record<string, unknown> | undefined;
  if (!b || typeof b !== 'object' || typeof b.commandesDepuis !== 'string') return null;
  const boutons = boutonsDe(o.boutons);
  return {
    boutique: {
      devise: typeof b.devise === 'string' ? b.devise : null,
      commandesDepuis: b.commandesDepuis,
      coupeeLe: typeof b.coupeeLe === 'string' ? b.coupeeLe : null,
      ...(typeof b.rattrapeesDepuis === 'string' ? { rattrapeesDepuis: b.rattrapeesDepuis } : {}),
    },
    activiteCompleteDepuis: o.activiteCompleteDepuis,
    ...annonces,
    ...(boutons ? { boutons } : {}),
  };
}

/**
 * Le compte des deux boutons prêts (lot 4), lu défensivement : les DEUX entiers positifs ou nuls, sinon rien. Absent ou
 * illisible, la console ne montre aucun bouton, plutôt qu'un nombre faux en pastille.
 */
function boutonsDe(v: unknown): BoutonsSansCommandeVue | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const entier = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
  return entier(o.ecritSansCommande) && entier(o.clicSansCommande)
    ? { ecritSansCommande: o.ecritSansCommande, clicSansCommande: o.clicSansCommande }
    : null;
}

/** Les produits vus rendus par l'API (lot 3), lus défensivement : une entrée qui ne se lit pas est écartée seule. */
export function produitsVusDe(v: unknown): ProduitVuVue[] | null {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !Array.isArray((v as Record<string, unknown>).produits)) return null;
  const texte = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);
  return ((v as { produits: unknown[] }).produits).flatMap((p): ProduitVuVue[] => {
    if (!p || typeof p !== 'object') return [];
    const o = p as Record<string, unknown>;
    const produitId = texte(o.produitId);
    const sku = texte(o.sku);
    const titre = texte(o.titre);
    if (titre === null || (produitId === null && sku === null)) return [];
    const commandes = typeof o.commandes === 'number' && Number.isInteger(o.commandes) && o.commandes >= 0 ? o.commandes : 0;
    return [{ produitId, sku, titre, varianteTitre: texte(o.varianteTitre), commandes }];
  });
}

/** Cherche parmi les produits déjà vus dans les commandes de l'espace ; `null` si la route ne répond pas. */
export async function chercherProduitsVus(tenantId: string, recherche: string): Promise<ProduitVuVue[] | null> {
  try {
    const q = recherche.trim() === '' ? '' : `?q=${encodeURIComponent(recherche.trim().slice(0, 80))}`;
    return produitsVusDe(await request<unknown>(`/tenants/${tenantId}/contacts/segments/produits${q}`));
  } catch {
    return null;
  }
}

/**
 * Les collections lues et l'état de leur lecture (lot 6a), lus défensivement : une collection qui ne se lit pas est
 * écartée seule ; un état illisible rend `null` (la route ne répond pas comme elle le doit : rien n'est proposé).
 */
export function collectionsLuesDe(v: unknown): CollectionsLuesVue | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.collections) || !o.lecture || typeof o.lecture !== 'object') return null;
  const l = o.lecture as Record<string, unknown>;
  const codes: ReadonlyArray<string> = ['sans_droit', 'refusee', 'erreur'];
  const refus = l.refus && typeof l.refus === 'object' ? l.refus as Record<string, unknown> : null;
  const lecture: LectureCollectionsVue = {
    lueLe: typeof l.lueLe === 'string' ? l.lueLe : null,
    enCours: l.enCours === true,
    refus: refus && typeof refus.code === 'string' && codes.includes(refus.code) && typeof refus.message === 'string'
      ? { code: refus.code as 'sans_droit' | 'refusee' | 'erreur', message: refus.message }
      : null,
    incompletes: l.incompletes === true,
  };
  const collections = o.collections.flatMap((c): CollectionLueVue[] => {
    if (!c || typeof c !== 'object') return [];
    const x = c as Record<string, unknown>;
    if (typeof x.collectionId !== 'string' || x.collectionId === '') return [];
    const produits = typeof x.produits === 'number' && Number.isInteger(x.produits) && x.produits >= 0 ? x.produits : 0;
    return [{ collectionId: x.collectionId, titre: typeof x.titre === 'string' && x.titre !== '' ? x.titre : null, produits }];
  });
  return { collections, lecture };
}

/** Cherche parmi les collections lues ; `null` si la route ne répond pas. La lecture demande aussi une relecture si besoin. */
export async function chercherCollections(tenantId: string, recherche: string): Promise<CollectionsLuesVue | null> {
  try {
    const q = recherche.trim() === '' ? '' : `?q=${encodeURIComponent(recherche.trim().slice(0, 80))}`;
    return collectionsLuesDe(await request<unknown>(`/tenants/${tenantId}/contacts/segments/collections${q}`));
  } catch {
    return null;
  }
}

/**
 * L'état de la synchronisation des étiquettes Shopify (lot 6b), lu défensivement : `null` s'il ne se lit pas (la route ne
 * répond pas comme elle le doit : rien n'est proposé). Un compte illisible vaut zéro.
 */
export function synchroEtiquettesDe(v: unknown): SynchroEtiquettesVue | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  if (typeof s.allumee !== 'boolean' || typeof s.enCours !== 'boolean') return null;
  const codes: ReadonlyArray<string> = ['sans_droit', 'refusee', 'erreur'];
  const refus = s.refus && typeof s.refus === 'object' ? s.refus as Record<string, unknown> : null;
  const c = s.comptes && typeof s.comptes === 'object' ? s.comptes as Record<string, unknown> : {};
  const entier = (x: unknown): number => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : 0);
  return {
    allumee: s.allumee,
    synchroLe: typeof s.synchroLe === 'string' ? s.synchroLe : null,
    enCours: s.enCours,
    refus: refus && typeof refus.code === 'string' && codes.includes(refus.code) && typeof refus.message === 'string'
      ? { code: refus.code as 'sans_droit' | 'refusee' | 'erreur', message: refus.message }
      : null,
    comptes: {
      clientsLus: entier(c.clientsLus), trouvesParTelephone: entier(c.trouvesParTelephone), sansFiche: entier(c.sansFiche),
      fichesEtiquetees: entier(c.fichesEtiquetees),
    },
  };
}

/**
 * Les étiquettes Shopify lues et l'état de leur synchronisation (lot 6b), lus défensivement : une étiquette qui ne se lit
 * pas est écartée seule ; un état illisible rend `null`.
 */
export function etiquettesShopifyLuesDe(v: unknown): EtiquettesShopifyLuesVue | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const synchro = synchroEtiquettesDe(o.synchro);
  if (!Array.isArray(o.etiquettes) || synchro === null) return null;
  const etiquettes = o.etiquettes.flatMap((e): EtiquetteShopifyVue[] => {
    if (!e || typeof e !== 'object') return [];
    const x = e as Record<string, unknown>;
    if (typeof x.etiquette !== 'string' || x.etiquette === '') return [];
    const fiches = typeof x.fiches === 'number' && Number.isInteger(x.fiches) && x.fiches >= 0 ? x.fiches : 0;
    return [{ etiquette: x.etiquette, fiches }];
  });
  return { etiquettes, synchro };
}

/** Cherche parmi les étiquettes Shopify lues ; `null` si la route ne répond pas. Une lecture seule, qui ne lance rien. */
export async function chercherEtiquettesShopify(tenantId: string, recherche: string): Promise<EtiquettesShopifyLuesVue | null> {
  try {
    const q = recherche.trim() === '' ? '' : `?q=${encodeURIComponent(recherche.trim().slice(0, 80))}`;
    return etiquettesShopifyLuesDe(await request<unknown>(`/tenants/${tenantId}/contacts/segments/etiquettes-shopify${q}`));
  } catch {
    return null;
  }
}

const enCours = new Map<string, Promise<SuiviSegmentsVue | null>>();

/** Une lecture par espace et par chargement de la console ; une panne se relit à la prochaine demande. */
export function chargerSegments(tenantId: string): Promise<SuiviSegmentsVue | null> {
  const deja = enCours.get(tenantId);
  if (deja) return deja;
  const p = request<unknown>(`/tenants/${tenantId}/contacts/segments`)
    .then(suiviSegmentsDe)
    .catch(() => { enCours.delete(tenantId); return null; });
  enCours.set(tenantId, p);
  return p;
}

/** Ce que l'écran a saisi pour une plage : des textes, vides tant que rien n'est tapé. */
export interface SaisiePlage { min: string; max: string; jours: string }

export type LecturePlage = { plage: PlageSurJours | undefined } | { erreur: 'nombre' | 'ordre' | 'zero' };

/**
 * Une saisie de plage, lue comme le serveur la lira. Rien de posé (ou « au moins 0 » sans maximum, qui ne restreint
 * rien) : pas de critère. 🔴 Une saisie invalide n'envoie RIEN au serveur (il la refuserait en 400) : l'écran dit
 * pourquoi, et la liste reste celle des autres critères.
 */
export function lirePlageSaisie(s: SaisiePlage, o: { max: number; entier: boolean; avecJours: boolean; restreint: boolean }): LecturePlage {
  const nombre = (t: string, max: number, entier: boolean): number | undefined | null => {
    if (t.trim() === '') return undefined;
    const n = Number(t.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 && n <= max && (!entier || Number.isInteger(n)) ? n : null;
  };
  const min = nombre(s.min, o.max, o.entier);
  const max = nombre(s.max, o.max, o.entier);
  const jours = o.avecJours ? nombre(s.jours, BORNES_SEGMENTS.joursMax, true) : undefined;
  if (min === null || max === null || jours === null || jours === 0) return { erreur: 'nombre' };
  if (min === undefined && max === undefined) return { plage: undefined };
  if (min !== undefined && max !== undefined && min > max) return { erreur: 'ordre' };
  if (o.restreint && (min ?? 0) === 0 && max === undefined) return { erreur: 'zero' };
  return { plage: { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(jours !== undefined ? { jours } : {}) } };
}

/** La saisie qui affiche une plage déjà posée (reprise d'un brouillon, retour sur l'écran). */
export function saisieDePlage(p: PlageSurJours | undefined): SaisiePlage {
  const t = (n: number | undefined): string => (n === undefined ? '' : String(n));
  return { min: t(p?.min), max: t(p?.max), jours: t(p?.jours) };
}
