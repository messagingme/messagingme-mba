import { z } from 'zod';
import { API_VERSION_SHOPIFY } from './connexion';
import type { CoutRequete } from './reprise';
import type { ProduitLu } from './collections.pg';
import { fetchPublic } from '../lib/connexion-publique';
import { lireCorpsBorne } from '../lib/corps-borne';
import { texteDe } from '../lib/erreur';
import { journaliser } from '../lib/journal';

/**
 * LES COLLECTIONS D'UN LOT DE PRODUITS, par l'API Admin GraphQL (segments Shopify enrichis, lot 6a) : `nodes(ids:)` sur
 * les GID des produits (reconstruits sur leur identifiant numérique), et pour chacun ses collections, 50 au plus. Le droit
 * `read_products` est exigé (`Product.collections`) ; le job le vérifie avant (`lireDroitsDeLApp`).
 *
 * Ce que chaque nœud rend : un produit connu (son titre, ses collections ; `hasNextPage` le dit incomplet), ou `null` pour
 * un produit supprimé chez Shopify depuis la commande, LU SANS COLLECTION. Un nœud qui ne se lit pas est gardé lu et dit
 * incomplet, jamais exhaustif. 🔴 Une réponse dont la liste n'a pas un nœud par identifiant demandé ne s'écrit pas : elle
 * dirait supprimés des produits qui ne le sont pas.
 *
 * Le frein `THROTTLED` attend que le seau se recharge, dans le délai de l'appel (`delaiMs` borne l'appel ENTIER, attentes
 * comprises), comme la page des commandes (`./commandes-lues.ts`). Un accès refusé se dit avec le message de Shopify ; un
 * lot trop lourd (5xx, `INTERNAL_SERVER_ERROR`, `MAX_COST_EXCEEDED`) rend `trop_lourd`, que le job redemande plus petit.
 * Le coût compté par Shopify revient avec le lot. Passe par `fetchPublic` (inventaire de `tests/lib-adresse-privee.test.ts`).
 */

/** Les collections lues par produit ; au-delà, le produit se dit incomplet (un plafond à nous, pas à Shopify). */
export const COLLECTIONS_PAR_PRODUIT = 50;
const CORPS_MAX = 2_000_000;
const ESSAIS_FREIN = 5;
const BORNE_TITRE = 200;
const ID = /^\d{1,19}$/;

const REQUETE = `query($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      legacyResourceId title
      collections(first: ${COLLECTIONS_PAR_PRODUIT}) { pageInfo { hasNextPage } nodes { legacyResourceId title } }
    }
  }
}`;

const schemaReponse = z.object({
  data: z.object({ nodes: z.array(z.unknown()) }).nullish(),
  errors: z.array(z.object({ message: z.string().catch(''), extensions: z.object({ code: z.string().nullish() }).nullish() })).nullish(),
  extensions: z.object({
    cost: z.object({
      requestedQueryCost: z.number().nullish(),
      actualQueryCost: z.number().nullish(),
      throttleStatus: z.object({ currentlyAvailable: z.number(), restoreRate: z.number() }).nullish(),
    }).nullish(),
  }).nullish(),
});
const schemaProduit = z.object({
  legacyResourceId: z.string().regex(ID),
  title: z.string().nullish().catch(null),
  collections: z.object({ pageInfo: z.object({ hasNextPage: z.boolean() }), nodes: z.array(z.unknown()) }),
});
const schemaCollection = z.object({ legacyResourceId: z.string().regex(ID), title: z.string().nullish().catch(null) });

/** Un lot lu, ou la raison de son refus. */
export type LotCollections =
  | { ok: true; produits: ProduitLu[]; cout: CoutRequete }
  | { ok: false; code: 'acces_refuse' | 'passager' | 'trop_lourd'; message: string };

/**
 * Un titre utile : coupé à sa borne en POINTS DE CODE, vide ramené à nul. 🔴 Jamais en unités UTF-16 : une coupe au
 * milieu d'un emoji laisserait une moitié de paire, que le `jsonb` de l'écriture refuse, et le lot entier échouerait à
 * chaque passage. Une moitié déjà présente dans le texte reçu devient le caractère de remplacement.
 */
function titreUtile(v: string | null | undefined): string | null {
  const t = (v ?? '').replace(/[\uD800-\uDFFF]/gu, '�').trim();
  return t === '' ? null : Array.from(t).slice(0, BORNE_TITRE).join('');
}

/** Le nœud d'un produit demandé, dans la forme du cache. */
export function produitDuNoeud(produitId: string, noeud: unknown): ProduitLu {
  // Supprimé chez Shopify depuis la commande : lu, sans collection (spec, chantier 1).
  if (noeud === null) return { produitId, titre: null, collections: [], incompletes: false };
  const p = schemaProduit.safeParse(noeud);
  if (!p.success || p.data.legacyResourceId !== produitId) {
    journaliser('warn', 'shopify_collections_produit_illisible', { erreur: p.success ? 'identifiant différent' : p.error.issues[0]?.message ?? 'invalide' });
    return { produitId, titre: null, collections: [], incompletes: true };
  }
  const vues = new Set<string>();
  const collections: Array<{ collectionId: string; titre: string | null }> = [];
  let illisibles = 0;
  for (const brute of p.data.collections.nodes) {
    const c = schemaCollection.safeParse(brute);
    if (!c.success) { illisibles += 1; continue; }
    if (vues.has(c.data.legacyResourceId)) continue;
    vues.add(c.data.legacyResourceId);
    collections.push({ collectionId: c.data.legacyResourceId, titre: titreUtile(c.data.title) });
  }
  return { produitId, titre: titreUtile(p.data.title), collections, incompletes: p.data.collections.pageInfo.hasNextPage || illisibles > 0 };
}

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function lireCollectionsDesProduits(
  acces: { domaine: string; jeton: string },
  p: { produits: readonly string[]; delaiMs: number },
  /** `fetchPublic`, une vraie attente et la vraie heure en production ; injectables pour éprouver la lecture. */
  appeler: typeof fetch = fetchPublic,
  attendre: (ms: number) => Promise<void> = pause,
  maintenant: () => number = Date.now,
): Promise<LotCollections> {
  const ids = p.produits.filter((id) => ID.test(id));
  if (ids.length !== p.produits.length) return { ok: false, code: 'passager', message: 'Un identifiant de produit illisible : lot ignoré.' };
  const fin = maintenant() + p.delaiMs;
  for (let freins = 0; ; freins += 1) {
    const reste = fin - maintenant();
    if (reste <= 0) return { ok: false, code: 'passager', message: 'Shopify n’a pas rendu les collections à temps : réessayez dans un instant.' };
    let reponse: z.infer<typeof schemaReponse>;
    try {
      const res = await appeler(`https://${acces.domaine}/admin/api/${API_VERSION_SHOPIFY}/graphql.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-shopify-access-token': acces.jeton },
        body: JSON.stringify({ query: REQUETE, variables: { ids: ids.map((id) => `gid://shopify/Product/${id}`) } }),
        redirect: 'manual',
        signal: AbortSignal.timeout(reste),
      });
      const statut = res.status;
      if (statut === 401 || statut === 403) {
        return { ok: false, code: 'acces_refuse', message: `Shopify refuse la lecture des collections (statut ${statut}) : l’app doit avoir le droit read_products.` };
      }
      if (statut >= 500) return { ok: false, code: 'trop_lourd', message: `Shopify n’a pas rendu les collections (statut ${statut}).` };
      const corps = await lireCorpsBorne(res, CORPS_MAX);
      if (corps.trop_gros) return { ok: false, code: 'trop_lourd', message: 'Shopify a rendu des collections trop lourdes.' };
      if (corps.casse) return { ok: false, code: 'passager', message: 'Shopify a rendu des collections illisibles : réessayez dans un instant.' };
      const lu = schemaReponse.safeParse(JSON.parse(corps.texte));
      if (statut !== 200 || !lu.success) {
        return { ok: false, code: 'passager', message: `Shopify n’a pas rendu les collections (statut ${statut}) : réessayez dans un instant.` };
      }
      reponse = lu.data;
    } catch (err) {
      return { ok: false, code: 'passager', message: `Shopify n’a pas répondu (${texteDe(err)}) : réessayez dans un instant.` };
    }

    const codes = (reponse.errors ?? []).map((e) => e.extensions?.code ?? '');
    if (codes.includes('THROTTLED')) {
      const seau = reponse.extensions?.cost?.throttleStatus;
      const cout = reponse.extensions?.cost?.requestedQueryCost ?? 0;
      const attenteMs = seau && seau.restoreRate > 0 ? Math.ceil(Math.max(0, cout - seau.currentlyAvailable) / seau.restoreRate) * 1000 : 1000;
      const attente = Math.max(1000, attenteMs);
      if (freins >= ESSAIS_FREIN || maintenant() + attente >= fin) return { ok: false, code: 'passager', message: 'Shopify freine la lecture des collections : réessayez dans une minute.' };
      await attendre(attente);
      continue;
    }
    if (codes.length > 0) {
      // Le message de Shopify dit le champ et le droit qui manquent : il est rendu tel quel, jamais deviné.
      const refus = (reponse.errors ?? []).find((e) => e.extensions?.code === 'ACCESS_DENIED' || /access denied/i.test(e.message));
      if (refus) return { ok: false, code: 'acces_refuse', message: `Shopify refuse la lecture des collections (${refus.message.slice(0, 300)}).` };
      if (codes.includes('MAX_COST_EXCEEDED') || codes.includes('INTERNAL_SERVER_ERROR')) {
        return { ok: false, code: 'trop_lourd', message: `Shopify trouve le lot de produits trop lourd (${codes.join(', ')}).` };
      }
      return { ok: false, code: 'passager', message: `Shopify refuse la requête des collections (${(reponse.errors ?? [])[0]?.message.slice(0, 200) ?? 'erreur'}).` };
    }
    const noeuds = reponse.data?.nodes;
    if (!noeuds || noeuds.length !== ids.length) {
      return { ok: false, code: 'passager', message: 'Shopify n’a pas rendu un nœud par produit demandé : réessayez dans un instant.' };
    }
    const cout = { demande: reponse.extensions?.cost?.requestedQueryCost ?? null, reel: reponse.extensions?.cost?.actualQueryCost ?? null };
    return { ok: true, produits: ids.map((id, i) => produitDuNoeud(id, noeuds[i])), cout };
  }
}
