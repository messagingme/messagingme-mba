import { randomUUID } from 'node:crypto';
import type { DepsCollections, JobCollections } from '../src/shopify/collections';
import {
  BAIL_LOT_SECONDES, DEMANDE_PERIMEE_MINUTES, FRAICHEUR_COLLECTIONS_HEURES, RELANCE_APRES_ISSUE_SECONDES,
  type EtatLectureCollections, type IssueLecture, type MagasinCollections, type ProduitLu,
} from '../src/shopify/collections.pg';
import { produitDuNoeud, type LotCollections } from '../src/shopify/collections-lues';
import type { IssueJeton } from '../src/shopify/connexion';

/**
 * UN FAUX DE LA LECTURE DES COLLECTIONS (segments Shopify enrichis, lot 6a) : le cache en mémoire, avec les MÊMES règles
 * que `PgCollectionsStore` (réservation par bail et jeton, les jamais lus d'abord, l'écriture refusée à un jeton périmé,
 * la demande qui ne repart pas tant qu'une autre attend son issue, l'issue qui ne crée pas l'état), et une boutique dont
 * le catalogue est donné d'avance. L'horloge est celle du faux : un test l'avance, ou la fait avancer à chaque lot lu
 * (`msParLot`). Le vrai magasin est éprouvé sur PGlite (`tests/integration/shopify-collections.integration.test.ts`).
 */

export const T_COLLECTIONS = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
export const BOUTIQUE_COLLECTIONS = { domaine: 'b.myshopify.com', clientId: 'cid', secret: 'shpss_x', etat: 'connectee' };
/** Les droits d'une app à jour (2026-11-24). */
export const DROITS_COLLECTIONS = ['read_customers', 'read_orders', 'read_checkouts', 'read_fulfillments', 'read_products'];
export const MIDI_COLLECTIONS = Date.UTC(2026, 10, 24, 12);

/** Un produit du catalogue de la boutique : son titre, ses collections, et s'il en a d'autres au-delà de 50. */
export interface ProduitCatalogue { titre: string; collections: Array<{ id: string; titre: string }>; plus?: boolean }

/** Le nœud GraphQL d'un produit du catalogue, tel que `nodes(ids:)` le rend. */
export const noeudDe = (id: string, p: ProduitCatalogue): unknown => ({
  legacyResourceId: id, title: p.titre,
  collections: { pageInfo: { hasNextPage: p.plus === true }, nodes: p.collections.map((c) => ({ legacyResourceId: c.id, title: c.titre })) },
});

interface ProduitFaux { titre: string | null; luesLe: number | null; incompletes: boolean; bail: number | null; jeton: string | null }

export function monterCollections(o: {
  /** Les produits des lignes des commandes payées (hors cartes cadeaux), dans l'ordre où le cache les découvre. */
  lignes?: string[];
  /** Le catalogue de la boutique ; un produit absent est supprimé chez Shopify (nœud nul). */
  catalogue?: Record<string, ProduitCatalogue>;
  /** Des nœuds forcés (illisibles), par produit. */
  noeuds?: Record<string, unknown>;
  boutique?: typeof BOUTIQUE_COLLECTIONS | null;
  /** Ce que rend la boutique au fil des relectures, après la première (coupée, remplacée...). */
  boutiquesSuivantes?: Array<typeof BOUTIQUE_COLLECTIONS | null>;
  jeton?: IssueJeton;
  droits?: string[] | { ok: false; code: 'acces_refuse' | 'passager'; message: string };
  /** Les issues forcées des lots, servies dans l'ordre avant le catalogue. */
  echecs?: LotCollections[];
  msParLot?: number;
  /** L'état de la lecture au départ ; absent : aucune ligne (rien de demandé). */
  etat?: Partial<EtatLectureCollections> | null;
} = {}) {
  const horloge = { t: MIDI_COLLECTIONS };
  const produits = new Map<string, ProduitFaux>();
  const collections = new Map<string, Array<{ collectionId: string; titre: string | null }>>();
  let etat: Omit<EtatLectureCollections, 'incompletes'> | null = o.etat === undefined || o.etat === null ? null : {
    lueLe: null, demandeeLe: null, issue: null, issueLe: null, message: null, ...o.etat,
  };
  const trace = {
    lots: [] as string[][],
    jobs: [] as Array<{ job: JobCollections; dansSecondes: number }>,
    issues: [] as Array<{ issue: IssueLecture; message: string | null }>,
    ecritures: [] as Array<{ jeton: string; produits: string[] }>,
    liberes: [] as string[],
    recherches: [] as Array<string | undefined>,
    droits: 0,
  };
  const perime = (p: ProduitFaux) => p.luesLe === null || p.luesLe < horloge.t - FRAICHEUR_COLLECTIONS_HEURES * 3_600_000;
  const tenu = (p: ProduitFaux) => p.bail !== null && p.bail > horloge.t;
  const lisible = (id: string) => /^\d{1,19}$/.test(id);

  const magasin: MagasinCollections = {
    async synchroniser() {
      let n = 0;
      for (const id of o.lignes ?? []) {
        if (!lisible(id) || produits.has(id)) continue;
        produits.set(id, { titre: null, luesLe: null, incompletes: false, bail: null, jeton: null });
        n += 1;
      }
      return n;
    },
    async reserver(_t, n) {
      const jeton = randomUUID();
      const choisis = [...produits.entries()]
        .filter(([, p]) => perime(p) && !tenu(p))
        .sort(([ia, a], [ib, b]) => (a.luesLe ?? -Infinity) - (b.luesLe ?? -Infinity) || ia.localeCompare(ib))
        .slice(0, n);
      for (const [, p] of choisis) { p.bail = horloge.t + BAIL_LOT_SECONDES * 1000; p.jeton = jeton; }
      return { jeton, produits: choisis.map(([id]) => id) };
    },
    async liberer(_t, jeton) {
      trace.liberes.push(jeton);
      for (const p of produits.values()) if (p.jeton === jeton) { p.bail = null; p.jeton = null; }
    },
    async ecrire(_t, jeton, lus: readonly ProduitLu[]) {
      const ecrits: string[] = [];
      for (const l of lus) {
        const p = produits.get(l.produitId);
        if (!p || p.jeton !== jeton) continue;
        Object.assign(p, { titre: l.titre ?? p.titre, luesLe: horloge.t, incompletes: l.incompletes, bail: null, jeton: null });
        collections.set(l.produitId, l.collections.map((c) => ({ ...c })));
        ecrits.push(l.produitId);
      }
      trace.ecritures.push({ jeton, produits: ecrits });
      return ecrits.length;
    },
    async resteALire() { return [...produits.values()].some(perime); },
    async aLire() {
      return (o.lignes ?? []).some((id) => {
        if (!lisible(id)) return false;
        const p = produits.get(id);
        return !p || perime(p);
      });
    },
    async demander() {
      const maintenant = horloge.t;
      const libre = etat === null || etat.demandeeLe === null
        || etat.demandeeLe.getTime() < maintenant - DEMANDE_PERIMEE_MINUTES * 60_000
        || (etat.issueLe !== null && etat.issueLe.getTime() >= etat.demandeeLe.getTime()
          && etat.issueLe.getTime() < maintenant - RELANCE_APRES_ISSUE_SECONDES * 1000);
      if (!libre) return null;
      const le = new Date(maintenant);
      etat = etat === null ? { lueLe: null, demandeeLe: le, issue: null, issueLe: null, message: null } : { ...etat, demandeeLe: le };
      return le;
    },
    async annulerDemande(_t, le) {
      if (etat && etat.demandeeLe?.getTime() === le.getTime()) etat = { ...etat, demandeeLe: null };
    },
    async noterIssue(_t, issue, message) {
      trace.issues.push({ issue, message });
      if (etat === null) return;
      const le = new Date(horloge.t);
      etat = { ...etat, issue, issueLe: le, message: message === null ? null : message.slice(0, 500), ...(issue === 'lue' ? { lueLe: le } : {}) };
    },
    async etat() {
      return etat === null ? null : { ...etat, incompletes: [...produits.values()].some((p) => p.incompletes) };
    },
    async collections(_t, recherche, limite) {
      trace.recherches.push(recherche);
      const parCollection = new Map<string, { titre: string | null; produits: number }>();
      for (const [, liste] of collections) {
        for (const c of liste) {
          const v = parCollection.get(c.collectionId) ?? { titre: null, produits: 0 };
          parCollection.set(c.collectionId, { titre: v.titre ?? c.titre, produits: v.produits + 1 });
        }
      }
      const q = recherche?.trim().toLowerCase() ?? '';
      return [...parCollection.entries()]
        .filter(([id, v]) => q === '' || id === q || (v.titre ?? '').toLowerCase().includes(q))
        .sort(([ia, a], [ib, b]) => b.produits - a.produits || (a.titre ?? '').localeCompare(b.titre ?? '') || ia.localeCompare(ib))
        .slice(0, limite)
        .map(([collectionId, v]) => ({ collectionId, titre: v.titre, produits: v.produits }));
    },
  };

  const echecs = [...(o.echecs ?? [])];
  const suivantes = [...(o.boutiquesSuivantes ?? [])];
  let premiereBoutique = true;
  const boutiqueCourante = () => {
    if (premiereBoutique) { premiereBoutique = false; return o.boutique === undefined ? BOUTIQUE_COLLECTIONS : o.boutique; }
    if (suivantes.length > 1) return suivantes.shift()!;
    if (suivantes.length === 1) return suivantes[0]!;
    return o.boutique === undefined ? BOUTIQUE_COLLECTIONS : o.boutique;
  };
  const deps: DepsCollections = {
    magasin,
    boutique: async () => boutiqueCourante(),
    etatBoutique: async () => {
      const b = o.boutique === undefined ? BOUTIQUE_COLLECTIONS : o.boutique;
      return b?.etat ?? null;
    },
    jeton: async () => o.jeton ?? { ok: true, jeton: 'jeton-de-test' },
    droits: async () => {
      trace.droits += 1;
      if (o.droits !== undefined && !Array.isArray(o.droits)) return o.droits;
      return { ok: true, droits: o.droits ?? DROITS_COLLECTIONS };
    },
    lireLot: async (_acces, p) => {
      trace.lots.push([...p.produits]);
      horloge.t += o.msParLot ?? 0;
      const force = echecs.shift();
      if (force) return force;
      return {
        ok: true,
        cout: { demande: 53 * p.produits.length, reel: 12 * p.produits.length },
        produits: p.produits.map((id) => {
          if (o.noeuds && id in o.noeuds) return produitDuNoeud(id, o.noeuds[id]);
          const c = o.catalogue?.[id];
          return produitDuNoeud(id, c === undefined ? null : noeudDe(id, c));
        }),
      };
    },
    enfiler: async (job, dansSecondes) => { trace.jobs.push({ job, dansSecondes }); },
    maintenant: () => horloge.t,
  };
  return { deps, trace, horloge, produits, collections, etat: () => etat };
}
