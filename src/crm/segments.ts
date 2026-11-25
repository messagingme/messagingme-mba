import { getCountryCallingCode, isSupportedCountry, parsePhoneNumberFromString } from 'libphonenumber-js';
import metadonnees from 'libphonenumber-js/min/metadata';
import {
  CLES_SEGMENT, MOTIF_ID_COLLECTION, OP_SEGMENT, plagePosee, type AchatsVises, type CleSegment, type CollectionsVisees,
  type EtiquettesShopifyVisees, type Plage, type PlageSurJours, type ProduitVise, type Reassort, type SegmentsShopifyVises,
} from '../../web/lib/partage/segments';
import type { ContactFieldFilter } from '../../web/lib/partage/contact-filters';

/**
 * LES CRITÈRES DE SEGMENT EN SQL (spec docs/superpowers/specs/2026-10-31-segments-commandes-pays-activite-design.md) :
 * commandes Shopify, dépense, dernière commande, activité, pays. Ils arrivent dans `fieldFilters` (clé réservée,
 * opérateur `segment`, valeur JSON : `web/lib/partage/segments.ts` dit pourquoi), validés par `lireSegment`
 * (`src/crm/contact-filters.ts`) ; ce module ne fait que les traduire, pour `buildContactWhere`.
 *
 * 🔴 CHAQUE SOUS-REQUÊTE NOMME `o.tenant_id = $1` : le rôle de l'application contourne la RLS, ce filtre est le seul
 * contrôle d'isolation. Les sous-requêtes sont non corrélées (`id in (...)`), donc indifférentes à l'alias de la requête
 * qui les reçoit.
 */

/**
 * Depuis quand l'activité est complète : le déploiement de la colonne `derniere_activite_le` (migration 0273). Avant, la
 * migration n'a pu lire que les messages encore conservés par l'espace et les clics : un « inactif depuis 180 jours » lu
 * avant cette date n'est pas une certitude, et l'outil le dit.
 */
export const ACTIVITE_COMPLETE_DEPUIS = '2026-11-03';

/**
 * Ce qu'un espace permet de cibler en commandes : sa boutique (branchée ou coupée), sa devise, la date depuis laquelle
 * TOUTES ses commandes payées sont suivies, et sa coupure. `null` sans boutique : un critère de commande y est refusé.
 * `rattrapage` (segments Shopify enrichis, lot 5) : le dernier rattrapage terminé, les commandes créées depuis `depuis`
 * relues le `le` pour les fiches qui existaient alors ; absent sans rattrapage, ou quand sa lecture a échoué.
 */
export interface SuiviSegments {
  boutique: {
    devise: string | null; commandesDepuis: Date; coupeeLe: Date | null; rattrapage?: { depuis: Date; le: Date };
    /**
     * La dernière lecture ABOUTIE des collections des produits achetés (lot 6a, migration 0314) ; absente sans lecture
     * aboutie (le critère de collection est alors refusé), ou quand sa lecture a échoué.
     */
    collectionsLuesLe?: Date;
    /**
     * La dernière synchronisation ABOUTIE des étiquettes Shopify (lot 6b, migration 0319) ; absente sans synchronisation
     * aboutie (le critère d'étiquette Shopify est alors refusé), ou quand sa lecture a échoué.
     */
    etiquettesSynchroLe?: Date;
  } | null;
}

/** Un code pays connu (ISO alpha-2, capitales) : seul ce qui a un indicatif se cible. */
export function paysConnu(code: string): boolean {
  return /^[A-Z]{2}$/.test(code) && isSupportedCountry(code);
}

type CodePays = Parameters<typeof getCountryCallingCode>[0];

/**
 * Le pays principal de l'indicatif d'un pays (US pour +1, GB pour +44, RU pour +7), ou `null` pour un code inconnu. 🔴 Un
 * indicatif partagé ne se cible que par son pays principal, qui les vise TOUS : cibler PR viserait aussi les États-Unis
 * et le Canada, qu'on n'a pas demandés. `lireSegment` refuse donc un pays qui n'est pas le principal, en nommant celui-ci.
 */
export function paysPrincipalDe(code: string): string | null {
  if (!paysConnu(code)) return null;
  // La table des indicatifs de la bibliothèque met le pays principal en tête de chaque indicatif.
  return metadonnees.country_calling_codes[getCountryCallingCode(code as CodePays)]?.[0] ?? code;
}

/** Les indicatifs des pays, dédupliqués : le pays principal d'un indicatif partagé (+1, +7, +44) les vise tous. */
export function prefixesDesPays(pays: readonly string[]): string[] {
  return [...new Set(pays.filter(paysConnu).map((p) => `+${getCountryCallingCode(p as CodePays)}`))];
}

/** Le pays d'un numéro E.164, lu sur son numéro (un +1 du Canada rend CA) ; `null` s'il ne se lit pas. */
export function paysDuNumero(e164: string | null): string | null {
  if (!e164) return null;
  return parsePhoneNumberFromString(e164)?.country ?? null;
}

const ilYA = (jours: string): string => `now() - ${jours}::int * interval '1 day'`;

/**
 * Le nombre ou la somme des commandes d'une plage. 🔴 Un minimum qui exige au moins une commande passe par `id in`, un
 * maximum seul par `id not in` (un contact sans aucune commande a 0 commande et 0 de dépense : il doit être rendu).
 * `contact_id` n'est jamais nul dans `shopify_commandes`, donc le `not in` ne bute pas sur un nul.
 */
function clausePlageCommandes(mesure: string, p: PlageSurJours, add: (v: unknown) => string, deviseSeule: boolean, type: string): string {
  const periode = p.jours !== undefined ? ` and o.payee_le >= ${ilYA(add(p.jours))}` : '';
  // La dépense ne somme que la devise de la boutique actuelle (une boutique remplacée peut en avoir eu une autre).
  const devise = deviseSeule
    ? ' and o.devise = coalesce((select b.devise from shopify_boutiques b where b.tenant_id = $1), o.devise)'
    : '';
  const de = `select o.contact_id from shopify_commandes o where o.tenant_id = $1${periode}${devise} group by o.contact_id`;
  if ((p.min ?? 0) > 0) {
    const min = `${mesure} >= ${add(p.min)}::${type}`;
    const max = p.max !== undefined ? ` and ${mesure} <= ${add(p.max)}::${type}` : '';
    return `id in (${de} having ${min}${max})`;
  }
  // « Au moins 0 » sans maximum ne restreint rien ; la validation le refuse. S'il arrive quand même : personne, jamais
  // l'espace entier (la règle de `clauseSegment`).
  if (p.max === undefined) return 'false';
  return `id not in (${de} having ${mesure} > ${add(p.max)}::${type})`;
}

/**
 * Ce qu'une ligne doit porter pour viser un produit (lot 3) : son identifiant, ou son SKU. 🔴 Le prédicat de l'index
 * partiel de la migration 0311 est repris MOT POUR MOT (`produit_id is not null and not carte_cadeau`, `sku is not null
 * and not carte_cadeau`) : un `where` qui s'en écarte ne produit qu'un balayage, sans erreur. Il écarte aussi les cartes
 * cadeaux (décision de Julien du 2026-11-23). Exporté pour le test qui tient ce contrat.
 */
export function ligneVisee(p: ProduitVise, add: (v: unknown) => string): string {
  return 'produit' in p
    ? `(l.produit_id = ${add(p.produit)} and l.produit_id is not null and not l.carte_cadeau)`
    : `(l.sku = ${add(p.sku)} and l.sku is not null and not l.carte_cadeau)`;
}

/**
 * Ce qu'une ligne doit porter pour être dans une collection (lot 6a) : un produit (hors carte cadeau, 🔴 le prédicat de
 * l'index partiel `shopify_commande_lignes_produit` repris mot pour mot) que la dernière lecture a vu dans la collection.
 * La sous-requête nomme l'espace et passe par l'index `(tenant_id, collection_id)` de la migration 0314. Exporté pour le
 * test qui tient ce contrat.
 */
export function ligneDansLaCollection(collectionId: string, add: (v: unknown) => string): string {
  return `(l.produit_id is not null and not l.carte_cadeau and l.produit_id in (select pc.produit_id from shopify_produit_collections pc `
    + `where pc.tenant_id = $1 and pc.collection_id = ${add(collectionId)}))`;
}

/** Les fiches dont une commande porte une ligne qui répond à `lignes`, sur les `jours` derniers jours si posés. */
function fichesAyantAchete(lignes: string, jours: number | undefined, add: (v: unknown) => string): string {
  const periode = jours !== undefined ? ` and o.payee_le >= ${ilYA(add(jours))}` : '';
  return `select o.contact_id from shopify_commande_lignes l
            join shopify_commandes o on o.tenant_id = l.tenant_id and o.commande_id = l.commande_id
           where l.tenant_id = $1 and o.tenant_id = $1 and ${lignes}${periode}`;
}

/** Une valeur « a acheté » ou « n'a pas acheté » déjà validée, ou `null` (qui vise PERSONNE). */
function achatsLus(v: unknown): AchatsVises | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const a = v as Partial<AchatsVises>;
  return Array.isArray(a.produits) && a.produits.length > 0 && a.produits.every(estProduitVise) ? a as AchatsVises : null;
}
function estProduitVise(p: unknown): p is ProduitVise {
  if (p === null || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return typeof o.produit === 'string' || typeof o.sku === 'string';
}

/** Une valeur « a acheté dans la collection » déjà validée, ou `null` (qui vise PERSONNE). */
function collectionsLues(v: unknown): CollectionsVisees | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const c = v as Partial<CollectionsVisees>;
  const motif = new RegExp(MOTIF_ID_COLLECTION);
  return Array.isArray(c.collections) && c.collections.length > 0 && c.collections.every((x) => typeof x === 'string' && motif.test(x))
    ? c as CollectionsVisees : null;
}

/**
 * Les collections que des filtres visent (lot 6a), dédupliquées : `PgContactStore` exige, avant toute lecture, qu'une
 * lecture des collections ait abouti et que chacune soit connue. Une valeur illisible n'en vise aucune (elle vise
 * personne, `clauseSegment`).
 */
export function collectionsDesFiltres(fieldFilters: readonly ContactFieldFilter[] | undefined): string[] {
  const ids = (fieldFilters ?? []).filter((f) => f.key === CLES_SEGMENT.collection && f.op === OP_SEGMENT).flatMap((f) => {
    let v: unknown;
    try { v = JSON.parse(f.value) as unknown; } catch { return []; }
    return collectionsLues(v)?.collections ?? [];
  });
  return [...new Set(ids)];
}

/**
 * Les fiches qui portent l'une de ces étiquettes Shopify (lot 6b), comparées sans la casse. 🔴 L'expression de l'index
 * `shopify_etiquettes_etiquette` (migration 0319, `(tenant_id, lower(etiquette))`) est reprise mot pour mot, et la
 * sous-requête nomme l'espace. Jamais `contacts.tags` : ce sont les étiquettes de Shopify, pas celles de Messaging Me.
 * Exporté pour le test qui tient ce contrat.
 */
export function ficheAvecEtiquetteShopify(etiquettes: readonly string[], add: (v: unknown) => string): string {
  return `id in (select e.contact_id from shopify_etiquettes e where e.tenant_id = $1 `
    + `and lower(e.etiquette) in (${etiquettes.map((x) => `lower(${add(x)})`).join(', ')}))`;
}

/** Une valeur « a l'étiquette Shopify » déjà validée, ou `null` (qui vise PERSONNE). */
function etiquettesShopifyLues(v: unknown): EtiquettesShopifyVisees | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const e = v as Partial<EtiquettesShopifyVisees>;
  return Array.isArray(e.etiquettes) && e.etiquettes.length > 0 && e.etiquettes.every((x) => typeof x === 'string' && x !== '')
    && (e.mode === 'toutes' || e.mode === 'une')
    ? e as EtiquettesShopifyVisees : null;
}

/**
 * Les étiquettes Shopify que des filtres visent (lot 6b) : `PgContactStore` exige, avant toute lecture, qu'une
 * synchronisation des étiquettes ait abouti dès qu'il y en a une. Une valeur illisible n'en vise aucune (elle vise
 * personne, `clauseSegment`).
 */
export function etiquettesShopifyDesFiltres(fieldFilters: readonly ContactFieldFilter[] | undefined): string[] {
  const etiquettes = (fieldFilters ?? []).filter((f) => f.key === CLES_SEGMENT.etiquetteShopify && f.op === OP_SEGMENT).flatMap((f) => {
    let v: unknown;
    try { v = JSON.parse(f.value) as unknown; } catch { return []; }
    return etiquettesShopifyLues(v)?.etiquettes ?? [];
  });
  return [...new Set(etiquettes)];
}

/**
 * Les fiches membres de l'un de ces segments Shopify (lot 6c), telles que la dernière lecture complète de chacun les a
 * rendues. La sous-requête nomme l'espace ; la clé primaire de `shopify_segment_membres` (migration 0327,
 * `(tenant_id, segment_id, contact_id)`) la sert. Exporté pour le test qui tient ce contrat.
 */
export function ficheDansLeSegmentShopify(segments: readonly string[], add: (v: unknown) => string): string {
  return `id in (select m.contact_id from shopify_segment_membres m where m.tenant_id = $1 `
    + `and m.segment_id in (${segments.map((x) => add(x)).join(', ')}))`;
}

/** Une valeur « membre du segment Shopify » déjà validée, ou `null` (qui vise PERSONNE). */
function segmentsShopifyLus(v: unknown): SegmentsShopifyVises | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const e = v as Partial<SegmentsShopifyVises>;
  const motif = new RegExp(MOTIF_ID_COLLECTION);
  return Array.isArray(e.segments) && e.segments.length > 0 && e.segments.every((x) => typeof x === 'string' && motif.test(x))
    && (e.mode === 'toutes' || e.mode === 'une')
    ? e as SegmentsShopifyVises : null;
}

/**
 * Les segments Shopify que des filtres visent (lot 6c) : `PgContactStore` exige, avant toute lecture, que chacun soit
 * suivi, encore chez Shopify et lu au moins une fois. Une valeur illisible n'en vise aucun (elle vise personne).
 */
export function segmentsShopifyDesFiltres(fieldFilters: readonly ContactFieldFilter[] | undefined): string[] {
  const ids = (fieldFilters ?? []).filter((f) => f.key === CLES_SEGMENT.segmentShopify && f.op === OP_SEGMENT).flatMap((f) => {
    let v: unknown;
    try { v = JSON.parse(f.value) as unknown; } catch { return []; }
    return segmentsShopifyLus(v)?.segments ?? [];
  });
  return [...new Set(ids)];
}

/** Les jours depuis la dernière commande : exige une commande connue. */
function clauseDerniereCommande(p: Plage, add: (v: unknown) => string): string {
  const bornes = [
    ...(p.min !== undefined ? [`max(o.payee_le) <= ${ilYA(add(p.min))}`] : []),
    ...(p.max !== undefined ? [`max(o.payee_le) >= ${ilYA(add(p.max))}`] : []),
  ];
  return `id in (select o.contact_id from shopify_commandes o where o.tenant_id = $1 group by o.contact_id having ${bornes.join(' and ')})`;
}

/**
 * La clause d'un critère de segment, à joindre par `and` au `WHERE` de `buildContactWhere`. La valeur a été validée par
 * `lireSegment` ; 🔴 une valeur qui ne se lit pas ou qui ne pose rien vise PERSONNE (`false`), jamais l'espace entier.
 */
export function clauseSegment(cle: CleSegment, valeur: string, add: (v: unknown) => string): string {
  let v: unknown;
  try { v = JSON.parse(valeur) as unknown; } catch { return 'false'; }
  const plage = (x: unknown): PlageSurJours | null => (x !== null && typeof x === 'object' && !Array.isArray(x) ? x as PlageSurJours : null);
  const jours = (x: unknown): number | null => (typeof x === 'number' && Number.isInteger(x) && x > 0 ? x : null);
  switch (cle) {
    case CLES_SEGMENT.commandes: {
      const p = plage(v);
      return p && plagePosee(p) ? clausePlageCommandes('count(*)', p, add, false, 'int') : 'false';
    }
    case CLES_SEGMENT.depense: {
      const p = plage(v);
      return p && plagePosee(p) ? clausePlageCommandes('coalesce(sum(o.montant), 0)', p, add, true, 'numeric') : 'false';
    }
    case CLES_SEGMENT.derniereCommande: {
      const p = plage(v);
      return p && plagePosee(p) ? clauseDerniereCommande(p, add) : 'false';
    }
    case CLES_SEGMENT.achete: {
      // TOUS les produits : une sous-requête par produit, jointes par `and`.
      const a = achatsLus(v);
      return a ? `(${a.produits.map((p) => `id in (${fichesAyantAchete(ligneVisee(p, add), a.jours, add)})`).join(' and ')})` : 'false';
    }
    case CLES_SEGMENT.pasAchete: {
      // AUCUN des produits. `contact_id` n'est jamais nul dans `shopify_commandes` : le `not in` ne bute pas sur un nul.
      const a = achatsLus(v);
      return a ? `id not in (${fichesAyantAchete(`(${a.produits.map((p) => ligneVisee(p, add)).join(' or ')})`, a.jours, add)})` : 'false';
    }
    case CLES_SEGMENT.collection: {
      // CHACUNE des collections : une sous-requête par collection, jointes par `and`. Qu'une lecture ait abouti et que
      // chaque collection soit encore connue est exigé AVANT (`PgContactStore`, refus) : ici, une collection inconnue ne
      // trouverait personne.
      const c = collectionsLues(v);
      return c
        ? `(${c.collections.map((id) => `id in (${fichesAyantAchete(ligneDansLaCollection(id, add), c.jours, add)})`).join(' and ')})`
        : 'false';
    }
    case CLES_SEGMENT.etiquetteShopify: {
      // TOUTES les étiquettes (une sous-requête par étiquette, jointes par `and`) ou l'une d'elles (une sous-requête). Qu'une
      // synchronisation ait abouti est exigé AVANT (`PgContactStore`, refus) : ici, une étiquette que personne ne porte ne
      // trouve personne, et c'est juste (la synchronisation l'a lue, même à zéro fiche).
      const e = etiquettesShopifyLues(v);
      if (!e) return 'false';
      return e.mode === 'une'
        ? ficheAvecEtiquetteShopify(e.etiquettes, add)
        : `(${e.etiquettes.map((x) => ficheAvecEtiquetteShopify([x], add)).join(' and ')})`;
    }
    case CLES_SEGMENT.segmentShopify: {
      // Membre de CHACUN des segments (une sous-requête par segment, jointes par `and`) ou de l'un d'eux. Que chacun soit
      // suivi et lu est exigé AVANT (`PgContactStore`, refus) : ici, un segment lu à zéro fiche ne trouve personne.
      const g = segmentsShopifyLus(v);
      if (!g) return 'false';
      return g.mode === 'une'
        ? ficheDansLeSegmentShopify(g.segments, add)
        : `(${g.segments.map((x) => ficheDansLeSegmentShopify([x], add)).join(' and ')})`;
    }
    case CLES_SEGMENT.reassort: {
      // Le DERNIER achat de ce produit dans la plage : exige un achat connu (« il y a au moins 180 jours » ne retient pas
      // qui n'en a jamais acheté).
      const r = v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Reassort : null;
      if (!r || !estProduitVise(r) || !plagePosee(r)) return 'false';
      const lignes = ligneVisee(r, add);
      const bornes = [
        ...(r.min !== undefined ? [`max(o.payee_le) <= ${ilYA(add(r.min))}`] : []),
        ...(r.max !== undefined ? [`max(o.payee_le) >= ${ilYA(add(r.max))}`] : []),
      ];
      return `id in (${fichesAyantAchete(lignes, undefined, add)} group by o.contact_id having ${bornes.join(' and ')})`;
    }
    case CLES_SEGMENT.ecritSansCommande:
    case CLES_SEGMENT.clicSansCommande: {
      // Un bouton prêt (lot 4) : un message reçu (ou un clic attribué) connu, et AUCUNE commande enregistrée pour la
      // fiche dans l'espace, sans fenêtre de jours. Une commande de test ou remboursée compte (décisions déjà prises).
      // `contact_id` n'est jamais nul dans `shopify_commandes` : le `not in` ne bute pas sur un nul.
      if (v !== true) return 'false';
      const date = cle === CLES_SEGMENT.ecritSansCommande ? 'derniere_reponse_le' : 'dernier_clic_le';
      return `(${date} is not null and id not in (select o.contact_id from shopify_commandes o where o.tenant_id = $1))`;
    }
    case CLES_SEGMENT.actif: {
      const n = jours(v);
      return n === null ? 'false' : `derniere_activite_le >= ${ilYA(add(n))}`;
    }
    case CLES_SEGMENT.inactif: {
      // Jamais actif = inactif : une fiche importée qui n'a jamais rien fait est bien dans « inactif depuis 90 jours ».
      const n = jours(v);
      return n === null ? 'false' : `(derniere_activite_le is null or derniere_activite_le < ${ilYA(add(n))})`;
    }
    case CLES_SEGMENT.pays: {
      // Préfixe ancré, comme « Téléphone commence par » (index `text_pattern_ops`). Un `or` de `like`, jamais
      // `like any` : l'index ne sert pas un tableau. Aucun indicatif connu : personne.
      const prefixes = Array.isArray(v) ? prefixesDesPays(v.filter((x): x is string => typeof x === 'string')) : [];
      return prefixes.length === 0 ? 'false' : `(${prefixes.map((p) => `phone_e164 like ${add(`${p}%`)}`).join(' or ')})`;
    }
  }
}
