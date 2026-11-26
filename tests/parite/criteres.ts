import { CONTACT_FILTER_QUERY_KEYS } from '../../web/lib/partage/contact-filters';
import { CLES_SEGMENT, type CleSegment } from '../../web/lib/partage/segments';
import type { Brique } from './adresses';

/**
 * LA PARITÉ DES CRITÈRES D'AUDIENCE : CHAQUE CRITÈRE QUE LA CONSOLE SAIT POSER, ET SON ARGUMENT MCP (lot 1 du CSM
 * virtuel, plan `docs/superpowers/plans/2026-11-26-csm-lot1-parite-criteres-et-offres.md`).
 *
 * 🔴 LA TABLE DES ADRESSES NE VOIT PAS LES CRITÈRES. `GET /contacts` y est servie par `find_contacts`, mais une route
 * de lecture porte ses critères dans sa requête, et la parité des champs ne lit que le corps des routes d'écriture : la
 * console savait exclure une étiquette, écarter les injoignables ou filtrer un champ personnalisé sans qu'aucune liste
 * ne dise que Claude Code ne le savait pas. Cette table le dit, critère par critère, pour les trois portes qui
 * partagent la même cible (`find_contacts`, `prepare_campaign`, et toute route qui reçoit un `BulkTarget`).
 *
 * `tests/parite-criteres.test.ts` DÉRIVE la liste des critères du code (`CONTACT_FILTER_QUERY_KEYS`, `CLES_SEGMENT`, et
 * les deux familles de champs de `fieldFilters`) : un critère ajouté à la console sans décision casse la CI. Chaque
 * argument nommé ici existe dans le schéma des deux outils, et `lireCibleMcp` le traduit vraiment dans ce critère.
 *
 * Trois décisions :
 * - `mcp` : les arguments de la cible commune qui posent ce critère ;
 * - `aFaire` : la brique qui l'exposera, et ce qu'il faut exposer (c'est la liste de travail, avec les `aFaire` des
 *   adresses ; les routes qui reçoivent ces critères portent un `reste` qui renvoie ici) ;
 * - `exclue` : pas d'argument, exprès, et pourquoi.
 */

export type DecisionCritere =
  | { readonly mcp: readonly string[] }
  | { readonly aFaire: Brique; readonly quoi: string }
  | { readonly exclue: string };

const mcp = (...args: string[]): DecisionCritere => ({ mcp: args });
const aFaire = (brique: Brique, quoi: string): DecisionCritere => ({ aFaire: brique, quoi });

/** Les deux familles de `fieldFilters` qui ne sont pas des segments : la dernière analyse, et les champs personnalisés. */
export const FAMILLES_DE_CHAMPS = ['champ:analyse', 'champ:personnalise'] as const;

type CleCritere = Exclude<keyof typeof CONTACT_FILTER_QUERY_KEYS, 'fieldFilters'> | (typeof FAMILLES_DE_CHAMPS)[number] | CleSegment;

export const CRITERES: Readonly<Record<CleCritere, DecisionCritere>> = {
  // Les critères du modèle commun (`ContactFilters`), sauf `fieldFilters`, dont chaque famille a sa ligne.
  tags: mcp('tags'),
  tagMode: mcp('tag_mode'),
  tagsExclude: aFaire('B10', 'exclure les contacts qui portent au moins une de ces étiquettes Messaging Me'),
  optIn: mcp('opt_in'),
  phonePrefix: aFaire('B10', 'un préfixe de numéro quelconque (`countries` ne pose que l’indicatif d’un pays entier)'),
  phoneContains: aFaire('B10', 'des chiffres du numéro COMBINÉS aux autres critères (`search_contacts` les cherche seuls, sans cible)'),
  nameSearch: aFaire('B10', 'un nom COMBINÉ aux autres critères (`search_contacts` le cherche seul, sans cible)'),
  joignabiliteWhatsApp: aFaire('B10', 'écarter les contacts connus comme injoignables sur WhatsApp'),
  risque: aFaire('B10', 'le niveau de risque de départ du contact'),

  // `fieldFilters` hors segments.
  'champ:analyse': mcp('analysis'),
  'champ:personnalise': aFaire('B10', 'un champ personnalisé de la fiche (`user_fields`), avec les opérateurs de la console'),

  // Les critères de segment, sous leur clé réservée (`web/lib/partage/segments.ts`).
  [CLES_SEGMENT.commandes]: mcp('orders'),
  [CLES_SEGMENT.depense]: mcp('spent'),
  [CLES_SEGMENT.derniereCommande]: mcp('days_since_last_order'),
  [CLES_SEGMENT.achete]: mcp('bought'),
  [CLES_SEGMENT.pasAchete]: mcp('not_bought'),
  [CLES_SEGMENT.reassort]: mcp('days_since_product'),
  [CLES_SEGMENT.collection]: mcp('collections'),
  [CLES_SEGMENT.etiquetteShopify]: mcp('shopify_tags'),
  [CLES_SEGMENT.segmentShopify]: mcp('shopify_segments'),
  [CLES_SEGMENT.ecritSansCommande]: mcp('wrote_without_order'),
  [CLES_SEGMENT.clicSansCommande]: mcp('clicked_without_order'),
  [CLES_SEGMENT.actif]: mcp('active_within_days'),
  [CLES_SEGMENT.inactif]: mcp('inactive_for_days'),
  [CLES_SEGMENT.pays]: mcp('countries'),
  [CLES_SEGMENT.commandeVsAnalyse]: mcp('order_vs_analysis'),
};

/**
 * Une valeur valide de chaque argument MCP nommé, pour prouver sa traduction. Le test refuse un exemple mort et un
 * argument sans exemple.
 */
export const EXEMPLES_MCP: Readonly<Record<string, unknown>> = {
  tags: ['vip'],
  tag_mode: 'any',
  opt_in: 'opted_in',
  analysis: [{ field: 'analyse_sentiment', op: 'in', value: 'negatif' }],
  orders: { min: 1 },
  spent: { min: 10 },
  days_since_last_order: { min: 30 },
  bought: { products: [{ sku: 'SER-30' }] },
  not_bought: { products: [{ sku: 'SER-30' }] },
  days_since_product: { sku: 'SER-30', min: 30 },
  collections: { ids: ['4401'] },
  shopify_tags: { tags: ['VIP'] },
  shopify_segments: { ids: ['5501'] },
  wrote_without_order: true,
  clicked_without_order: true,
  active_within_days: 30,
  inactive_for_days: 90,
  countries: ['FR'],
  order_vs_analysis: 'aucune_apres',
};
