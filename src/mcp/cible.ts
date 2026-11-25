import type { BulkTarget } from '../crm/contact-store.pg';
import { filtersActive } from '../../web/lib/partage/contact-filters';
import { parseBulkTarget } from '../http/contacts';
import { estUuid } from '../http/scope';
import { CLES_FILTRABLES, estCleFiltrable, operateursDuChamp } from '../crm/filtre-fiche';
import { champFiche } from '../crm/champs-fiche';
import { FiltreContactInvalide, MAX_FIELD_FILTERS, MAX_TAGS } from '../crm/contact-filters';
import { LONGUEUR_MAX_ETIQUETTE } from '../crm/poser-etiquette';
import { OPERATEURS_FICHE_SEULS } from '../../web/lib/partage/contact-filters';
import { corpsRefusFonction } from '../offres/refus';
import type { Fonction } from '../offres/offres';
import type { ProprieteEntree } from './outils';
import { RefusOutil } from './saisie';
import { BORNES_SEGMENTS, CLES_SEGMENT, MOTIF_ID_COLLECTION, OP_SEGMENT, type CleSegment } from '../../web/lib/partage/segments';
import type { SuiviSegments } from '../crm/segments';

/**
 * LA CIBLE D'UN OUTIL DE CAMPAGNE (plan « Campagnes depuis Claude », tâche 4) : les contacts que l'assistant désigne,
 * par étiquettes, consentement, critères de segment (commandes Shopify, dépense, dernière commande, activité, pays :
 * `lireSegmentsMcp`, spec du 2026-10-31) et, en Entreprise, champs de la dernière analyse ; ou par identifiants de
 * contacts ou de conversations. 🔴 Elle passe par `parseBulkTarget`, l'analyseur du mini-CRM et de la création de campagne : un second
 * analyseur ferait viser à l'assistant autre chose que ce que la console montre. Ce module n'ajoute que ce qui précède
 * cet analyseur, et le durcit sur trois points qu'un modèle rencontre et pas un écran :
 * - une cible sans critère est REFUSÉE (la console appelle « tous les contacts » une cible vide, et une campagne
 *   construite dessus partirait à tout l'espace) ;
 * - ce qui dépasse un plafond est refusé, jamais tronqué (un filtre jeté élargit l'audience) ;
 * - l'analyse exige la fonction `analyse` (l'Entreprise), avec le lien de l'offre.
 */

/** Identifiants par appel : de quoi étiqueter les contacts de quelques centaines de conversations par passage (spec, choix 7). */
export const MAX_IDENTIFIANTS_CIBLE = 500;

export interface DepsCibleMcp {
  inbox: {
    /** Les fiches des conversations désignées, DANS l'espace : une conversation d'un autre espace ne rend rien. */
    contactIdsDesConversations(tenantId: string, conversationIds: string[]): Promise<string[]>;
  };
  contacts: {
    /** Les identifiants d'une cible, DANS l'espace : un contact d'un autre espace ne rend rien. */
    contactIdsForTarget(tenantId: string, target: BulkTarget, limite?: number): Promise<string[]>;
    /** La boutique de l'espace : sans elle, un critère de commande est refusé. */
    suiviSegments(tenantId: string): Promise<SuiviSegments>;
  };
}

const OPERATEURS_ANALYSE = [...OPERATEURS_FICHE_SEULS, 'empty', 'not_empty'];

/** Ce que chaque champ d'analyse accepte, DÉRIVÉ des champs de la fiche : jamais une liste recopiée. */
const AIDE_ANALYSE = CLES_FILTRABLES.map((cle) => {
  const champ = champFiche(cle)!;
  const valeurs = champ.type.nature === 'choix' ? ` (values: ${champ.type.valeurs.join(', ')})` : champ.type.nature === 'note' ? ' (value 0 to 10)' : champ.type.nature === 'date' ? ' (value: a number of days)' : '';
  return `${cle}: ${operateursDuChamp(champ).join('/')}${valeurs}`;
}).join('; ');

const {
  joursMax, commandesMax, depenseMax, paysMax, produitsMax, skuMax, collectionsMax, etiquettesShopifyMax, etiquetteShopifyMax, segmentsShopifyMax,
} = BORNES_SEGMENTS;
const JOURS = { type: 'integer', minimum: 1, maximum: joursMax } as const;

/** Un produit visé (lot 3) : son identifiant Shopify OU un SKU, jamais les deux (refusé par `lireSegment`). */
const PRODUIT_ANNONCE = {
  product_id: { type: 'string', pattern: '^\\d{1,30}$', description: 'The Shopify product id, in digits: every variant of the product.' },
  sku: { type: 'string', minLength: 1, maxLength: skuMax, description: `One variant, by its SKU (1 to ${skuMax} characters).` },
} as const;

/** « A acheté » ou « n'a pas acheté » : 1 à `produitsMax` produits et, au choix, une fenêtre en jours. */
function achatsAnnonces(description: string): ProprieteEntree {
  return {
    type: 'object',
    properties: {
      products: {
        type: 'array', minItems: 1, maxItems: produitsMax,
        items: { type: 'object', properties: PRODUIT_ANNONCE, additionalProperties: false },
        description: `1 to ${produitsMax} products, each {"product_id"} or {"sku"}, never both.`,
      },
      within_days: { ...JOURS, description: `Bought over the last N days (1 to ${joursMax}); without it, every recorded order (orders_recorded_since, and orders_backfilled_since after a catch-up).` },
    },
    required: ['products'],
    additionalProperties: false,
    description,
  };
}

/** Une plage `{ min, max }`, et `within_days` pour le nombre et la somme des commandes. */
function plageAnnoncee(o: { borne: 'integer' | 'number'; max: number; avecJours: boolean; unite: string; description: string }): ProprieteEntree {
  return {
    type: 'object',
    properties: {
      min: { type: o.borne, minimum: 0, maximum: o.max, description: `At least this ${o.unite}.` },
      max: { type: o.borne, minimum: 0, maximum: o.max, description: `At most this ${o.unite}.` },
      ...(o.avecJours ? { within_days: { ...JOURS, description: `Counted over the last N days (1 to ${joursMax}); without it, every recorded order (orders_recorded_since, and orders_backfilled_since after a catch-up).` } } : {}),
    },
    additionalProperties: false,
    description: o.description,
  };
}

/**
 * Les critères de segment (spec du 2026-10-31), annoncés avec chacune des bornes que `buildContactFilters` applique.
 * Pro et au-dessus, comme les autres filtres : aucune fonction de plus.
 */
export const CHAMPS_CIBLE_SEGMENTS: Record<string, ProprieteEntree> = {
  orders: plageAnnoncee({
    borne: 'integer', max: commandesMax, avecJours: true, unite: 'number of orders',
    description: 'Shopify paid orders (test orders included, refunds not deducted), e.g. {"min":2,"within_days":90} for two '
      + 'orders in 90 days, {"max":0} for no order. Needs the workspace Shopify store. "min":0 alone restricts nothing '
      + 'and is refused.',
  }),
  spent: plageAnnoncee({
    borne: 'number', max: depenseMax, avecJours: true, unite: 'amount',
    description: 'Total of those paid orders, in the store currency (orders in another currency are left out), e.g. '
      + '{"min":200,"within_days":365}. Needs the Shopify store. "min":0 alone is refused.',
  }),
  days_since_last_order: plageAnnoncee({
    borne: 'integer', max: joursMax, avecJours: false, unite: 'number of days',
    description: 'Days since the last paid order; requires at least one order. {"min":180} for "nothing for 6 months", '
      + '{"max":30} for "ordered this month". Needs the Shopify store.',
  }),
  bought: achatsAnnonces('Contacts whose paid orders include ALL these products, e.g. {"products":[{"product_id":"8801"}],'
    + '"within_days":90}. Gift cards never match. Product ids and SKUs come from get_shopify_state (products_seen). Needs '
    + 'the Shopify store.'),
  not_bought: achatsAnnonces('Contacts whose paid orders include NONE of these products. Only together with "bought": '
    + 'alone it would target almost the whole workspace, and it is refused.'),
  days_since_product: {
    type: 'object',
    properties: {
      ...PRODUIT_ANNONCE,
      min: { type: 'integer', minimum: 0, maximum: joursMax, description: 'Last purchase of this product at least N days ago.' },
      max: { type: 'integer', minimum: 0, maximum: joursMax, description: 'Last purchase of this product at most N days ago.' },
    },
    additionalProperties: false,
    description: 'Restock: the last paid purchase of ONE product ({"product_id"} or {"sku"}) between min and max days ago, '
      + 'e.g. {"sku":"SER-30","min":60,"max":120}; requires a known purchase of it, at least one bound. Needs the Shopify store.',
  },
  collections: {
    type: 'object',
    properties: {
      ids: {
        type: 'array', minItems: 1, maxItems: collectionsMax, items: { type: 'string', pattern: MOTIF_ID_COLLECTION },
        description: `1 to ${collectionsMax} Shopify collection ids, in digits (collection_id in get_shopify_state collections.list).`,
      },
      within_days: { ...JOURS, description: `Bought over the last N days (1 to ${joursMax}); without it, every recorded order.` },
    },
    required: ['ids'],
    additionalProperties: false,
    description: 'Contacts whose paid orders include at least one product of EACH of these Shopify collections, e.g. '
      + '{"ids":["4401"],"within_days":90}. The collections are as they are in the store at the last reading (its date: '
      + 'collections.read_at in get_shopify_state, and collections_read_at in the answer of find_contacts; wait until '
      + 'get_shopify_state says reading: false before targeting), not as they were on the day of the '
      + 'order: an automated collection moves without any order changing. Gift cards never match. Refused until a reading '
      + 'of the store collections has succeeded (get_shopify_state starts it; it needs the read_products scope on the '
      + 'store app), and for a collection not known at the last reading. Needs the Shopify store.',
  },
  shopify_tags: {
    type: 'object',
    properties: {
      tags: {
        type: 'array', minItems: 1, maxItems: etiquettesShopifyMax,
        items: { type: 'string', minLength: 1, maxLength: etiquetteShopifyMax, pattern: '\\S' },
        description: `1 to ${etiquettesShopifyMax} Shopify customer tags (tag in get_shopify_state shopify_tags.list), compared `
          + `without case, each 1 to ${etiquetteShopifyMax} characters (the Shopify limit).`,
      },
      mode: { type: 'string', enum: ['all', 'any'], description: '"all" (default): every tag; "any": at least one.' },
    },
    required: ['tags'],
    additionalProperties: false,
    description: 'Contacts one of whose Shopify customers carries these tags (a record carries the tags of every Shopify '
      + 'customer who has its number; with "all", the tags may come from different customers of the record), as read by the '
      + 'last sync of the Shopify tags (its date: '
      + 'shopify_tags.synced_at in get_shopify_state, and shopify_tags_synced_at in the answer of find_contacts). These are '
      + 'the tags put on customers IN SHOPIFY, NOT the Messaging Me tags of the tags parameter: the same word on both sides '
      + 'is two different criteria. Refused until a sync of the Shopify tags has succeeded (sync_shopify_customer_tags '
      + 'turns it on); after that it applies, even to a tag no record carries. To freeze the target of a campaign, tag its '
      + 'contacts first (tag_contacts with this criterion), then target that Messaging Me tag. Needs the Shopify store.',
  },
  shopify_segments: {
    type: 'object',
    properties: {
      ids: {
        type: 'array', minItems: 1, maxItems: segmentsShopifyMax, items: { type: 'string', pattern: MOTIF_ID_COLLECTION },
        description: `1 to ${segmentsShopifyMax} Shopify segment ids, in digits (id in get_shopify_state shopify_segments.list).`,
      },
      mode: { type: 'string', enum: ['all', 'any'], description: '"all" (default): in every segment; "any": in at least one.' },
    },
    required: ['ids'],
    additionalProperties: false,
    description: 'Contacts in these customer segments built by the merchant IN SHOPIFY (e.g. "Customers who have purchased '
      + 'at least once"), with the members Shopify gave at the last reading of each segment (its date: read_at in '
      + 'get_shopify_state shopify_segments.list); a Shopify customer in the segment brings every record that has one of its '
      + 'numbers. Not the Messaging Me tags, nor the Shopify tags. Refused for a segment that is not followed '
      + `(sync_shopify_customer_tags with segments follows up to ${segmentsShopifyMax}), not read yet, or gone from the store. `
      + 'To freeze the target of a campaign, tag its contacts first (tag_contacts with this criterion), then target that '
      + 'Messaging Me tag. Needs the Shopify store.',
  },
  wrote_without_order: {
    type: 'boolean', enum: [true],
    description: 'One-click segment, the console button "Wrote without ordering": contacts who sent at least one message '
      + 'still known (a reaction or a button tap counts) and have no order recorded (live, or by a catch-up). true '
      + 'only, no period; omit it otherwise. Needs the Shopify store.',
  },
  clicked_without_order: {
    type: 'boolean', enum: [true],
    description: 'One-click segment, the console button "Clicked without ordering": contacts who clicked a tracked link at '
      + 'least once and have no order recorded. Both buttons can match the same contact. true only, no period; omit it '
      + 'otherwise. Needs the Shopify store.',
  },
  active_within_days: {
    ...JOURS,
    description: `Contacts who wrote to the workspace or clicked a tracked link in the last N days (1 to ${joursMax}).`,
  },
  inactive_for_days: {
    ...JOURS,
    description: `No message and no click for N days (1 to ${joursMax}), contacts never active included.`,
  },
  countries: {
    type: 'array', minItems: 1, maxItems: paysMax, items: { type: 'string', pattern: '^[A-Za-z]{2}$' },
    description: `Countries by ISO code (FR, BE, GB...), ${paysMax} at most, matched by the phone number calling code. A `
      + 'calling code shared by several countries is targeted only by its main country, which matches them all: US for +1 '
      + '(the United States, Canada and about twenty Caribbean and Pacific countries), GB for +44, RU for +7; CA, PR, KZ '
      + 'or JE are refused.',
  },
};

/** Les paramètres de cible, annoncés par chaque outil qui en prend une. Toute borne appliquée ici y figure. */
export const CHAMPS_CIBLE_FILTRES: Record<string, ProprieteEntree> = {
  tags: {
    type: 'array', minItems: 1, maxItems: MAX_TAGS, items: { type: 'string', minLength: 1, maxLength: LONGUEUR_MAX_ETIQUETTE },
    description: 'Contacts carrying these tags. A segment IS a tag: tag the contacts first (tag_contacts), then target the tag.',
  },
  tag_mode: { type: 'string', enum: ['all', 'any'], description: '"all" (default): every tag; "any": at least one.' },
  opt_in: {
    type: 'string', enum: ['opted_in', 'opted_out', 'unknown'],
    description: 'Marketing consent. A marketing template only ever reaches opted_in contacts, whatever the target.',
  },
  analysis: {
    type: 'array', minItems: 1, maxItems: MAX_FIELD_FILTERS,
    items: {
      type: 'object',
      properties: {
        field: { type: 'string', enum: [...CLES_FILTRABLES], description: 'A field of the latest conversation analysis.' },
        op: { type: 'string', enum: OPERATEURS_ANALYSE, description: 'The operator, among those of the field.' },
        value: { type: 'string', maxLength: 500, description: 'Comma-separated values for "in"; empty for empty, not_empty, is_true, is_false.' },
      },
      required: ['field', 'op'],
      additionalProperties: false,
    },
    description: `Enterprise plan only. Filters on each contact's latest conversation analysis: ${AIDE_ANALYSE}. `
      + `${MAX_FIELD_FILTERS} filters at most in all, the orders, spent, days_since_last_order, bought, not_bought, `
      + 'days_since_product, collections, shopify_tags, shopify_segments, wrote_without_order, clicked_without_order, active_within_days, '
      + 'inactive_for_days and countries criteria included.',
  },
  ...CHAMPS_CIBLE_SEGMENTS,
};
export const CHAMPS_CIBLE_IDENTIFIANTS: Record<string, ProprieteEntree> = {
  contact_ids: {
    type: 'array', minItems: 1, maxItems: MAX_IDENTIFIANTS_CIBLE, items: { type: 'string', format: 'uuid' },
    description: `Contacts by id (contact_id of list_conversations or find_contacts), ${MAX_IDENTIFIANTS_CIBLE} at most. Not combined with filters.`,
  },
  conversation_ids: {
    type: 'array', minItems: 1, maxItems: MAX_IDENTIFIANTS_CIBLE, items: { type: 'string', format: 'uuid' },
    description: `The contacts of these conversations, ${MAX_IDENTIFIANTS_CIBLE} at most. Not combined with filters.`,
  },
};

const present = (v: unknown): boolean => v !== undefined && v !== null;

function identifiants(v: unknown, cle: string): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new RefusOutil(`paramètre « ${cle} » : une liste d'identifiants non vide est attendue`, 'invalid_args');
  if (v.length > MAX_IDENTIFIANTS_CIBLE) throw new RefusOutil(`paramètre « ${cle} » : ${MAX_IDENTIFIANTS_CIBLE} identifiants au plus par appel`, 'invalid_args');
  if (!v.every(estUuid)) throw new RefusOutil(`paramètre « ${cle} » : identifiant mal formé`, 'invalid_args');
  return [...new Set(v)];
}

/**
 * Lit la cible d'un outil. `identifiants` : l'outil accepte-t-il une liste d'identifiants (`tag_contacts`, la cible
 * d'une campagne) ou seulement des filtres (`find_contacts`, qui les compte) ? Lève `RefusOutil` sur tout ce qui ne se
 * lit pas, AVANT toute lecture en base.
 */
export async function lireCibleMcp(
  args: Record<string, unknown>, fonctions: ReadonlySet<Fonction>, deps: DepsCibleMcp, tenantId: string, opts: { identifiants: boolean },
): Promise<BulkTarget> {
  const parContacts = present(args.contact_ids);
  const parConversations = present(args.conversation_ids);
  const parFiltres = ['tags', 'tag_mode', 'opt_in', 'analysis', ...CLES_SEGMENTS].some((k) => present(args[k]));

  if (parContacts || parConversations) {
    if (!opts.identifiants) throw new RefusOutil('cet outil cible par étiquettes, consentement ou analyse, pas par identifiants', 'invalid_args');
    if (parContacts && parConversations) throw new RefusOutil('contact_ids ou conversation_ids, pas les deux', 'invalid_args');
    if (parFiltres) throw new RefusOutil('une liste d’identifiants ne se combine pas avec des filtres : l’un ou l’autre', 'invalid_args');
    // Résolus DANS l'espace, aux deux portes : un identifiant d'ailleurs ne désigne personne, et une liste qui ne désigne
    // personne est refusée plutôt que de répondre « 0 » (relecture du lot des campagnes, constat 2).
    const ids = parContacts
      ? await deps.contacts.contactIdsForTarget(tenantId, { ids: identifiants(args.contact_ids, 'contact_ids') })
      : await deps.inbox.contactIdsDesConversations(tenantId, identifiants(args.conversation_ids, 'conversation_ids'));
    const cible = parseBulkTarget({ ids });
    if (cible === null) {
      throw new RefusOutil(parContacts
        ? 'aucun de ces contacts n’existe dans cet espace'
        : 'aucune de ces conversations n’a de contact dans cet espace', 'not_found');
    }
    return cible;
  }

  const tags = args.tags;
  if (present(tags) && (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string'))) throw new RefusOutil('paramètre « tags » : une liste de textes est attendue', 'invalid_args');
  if (Array.isArray(tags) && tags.length > MAX_TAGS) throw new RefusOutil(`paramètre « tags » : ${MAX_TAGS} étiquettes au plus`, 'invalid_args');
  if (present(args.tag_mode) && args.tag_mode !== 'all' && args.tag_mode !== 'any') throw new RefusOutil('paramètre « tag_mode » : "all" ou "any"', 'invalid_args');
  if (present(args.opt_in) && !['opted_in', 'opted_out', 'unknown'].includes(args.opt_in as string)) {
    throw new RefusOutil('paramètre « opt_in » : opted_in, opted_out ou unknown', 'invalid_args');
  }
  const analyse = args.analysis;
  if (present(analyse) && !Array.isArray(analyse)) throw new RefusOutil('paramètre « analysis » : une liste de filtres est attendue', 'invalid_args');
  const filtresAnalyse = Array.isArray(analyse) ? analyse : [];
  if (filtresAnalyse.length > MAX_FIELD_FILTERS) throw new RefusOutil(`paramètre « analysis » : ${MAX_FIELD_FILTERS} filtres au plus`, 'invalid_args');
  if (filtresAnalyse.length > 0 && !fonctions.has('analyse')) throw new RefusOutil(corpsRefusFonction('analyse').error, 'plan_required', { cause: 'plan_feature_unavailable', action: corpsRefusFonction('analyse').upgradeUrl });
  const fieldFilters = filtresAnalyse.map((f: unknown) => {
    const { field, op, value } = (f !== null && typeof f === 'object' ? f : {}) as { field?: unknown; op?: unknown; value?: unknown };
    // Seuls les champs de la dernière analyse : un champ personnalisé n'est pas annoncé, donc pas accepté.
    if (!estCleFiltrable(field)) throw new RefusOutil(`filtre d’analyse : champ inconnu (${CLES_FILTRABLES.join(', ')})`, 'invalid_args');
    return { key: field, op, value: typeof value === 'string' ? value : '' };
  });

  const segments = await lireSegmentsMcp(args, deps, tenantId);
  // Jamais tronqué : un filtre jeté élargirait l'audience.
  if (fieldFilters.length + segments.length > MAX_FIELD_FILTERS) {
    throw new RefusOutil(`${MAX_FIELD_FILTERS} filtres au plus, analyse et critères d’achats, d’activité et de pays compris`, 'invalid_args');
  }
  let cible: BulkTarget | null;
  try {
    cible = parseBulkTarget({
      filters: {
        tags: Array.isArray(tags) ? tags : [], tagMode: args.tag_mode === 'any' ? 'or' : 'and', optIn: args.opt_in,
        fieldFilters: [...fieldFilters, ...segments],
      },
    });
  } catch (e) {
    // Un opérateur ou une valeur que le champ ne connaît pas : la phrase du mini-CRM, telle quelle.
    if (e instanceof FiltreContactInvalide) throw new RefusOutil(e.message, 'invalid_args');
    throw e;
  }
  // 🔴 Une cible sans critère n'est JAMAIS « tout le monde » ici, contrairement au « tout sélectionner » de la console.
  if (cible === null || !('filters' in cible) || !filtersActive(cible.filters)) {
    throw new RefusOutil(`précisez au moins un critère : tags, opt_in, analysis, ${CLES_SEGMENTS.join(', ')}, ou une liste de contact_ids ou de conversation_ids`, 'invalid_args');
  }
  return cible;
}

const CLES_SEGMENTS = [
  'orders', 'spent', 'days_since_last_order', 'bought', 'not_bought', 'days_since_product', 'collections', 'shopify_tags', 'shopify_segments',
  'wrote_without_order', 'clicked_without_order', 'active_within_days', 'inactive_for_days', 'countries',
] as const;
/** Les critères qui demandent une boutique : ceux des commandes, les étiquettes Shopify (lot 6b) et ses segments (lot 6c). */
const CLES_COMMANDES_MCP = [
  'orders', 'spent', 'days_since_last_order', 'bought', 'not_bought', 'days_since_product', 'collections', 'shopify_tags', 'shopify_segments',
  'wrote_without_order', 'clicked_without_order',
] as const;

/**
 * Les critères de segment de l'outil, dans la forme du fil : des `fieldFilters` sous clé réservée, opérateur `segment`
 * (`web/lib/partage/segments.ts` dit pourquoi). Seule la FORME se lit ici (les clés d'une plage) ; les bornes, les pays
 * et la plage vide sont refusés par `lireSegment`, la règle de la console. 🔴 Un critère de commande sans boutique est
 * refusé : « au plus 0 commande » y viserait tout l'espace.
 */
async function lireSegmentsMcp(
  args: Record<string, unknown>, deps: DepsCibleMcp, tenantId: string,
): Promise<Array<{ key: CleSegment; op: typeof OP_SEGMENT; value: string }>> {
  const entree = (key: CleSegment, valeur: unknown) => ({ key, op: OP_SEGMENT, value: JSON.stringify(valeur) });
  const plage = (cle: string, avecJours: boolean): unknown => {
    const v = args[cle];
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
    const brut = v as Record<string, unknown>;
    const permises = avecJours ? ['min', 'max', 'within_days'] : ['min', 'max'];
    const inconnues = Object.keys(brut).filter((k) => !permises.includes(k));
    if (inconnues.length > 0) throw new RefusOutil(`paramètre « ${cle} » : clé inconnue (${inconnues.join(', ')}) ; seules ${permises.join(', ')}`, 'invalid_args');
    return { min: brut.min, max: brut.max, ...(avecJours ? { jours: brut.within_days } : {}) };
  };
  /** Les clés annoncées d'un objet, et elles seules : une clé inconnue est refusée en la nommant. */
  const seules = (cle: string, brut: Record<string, unknown>, permises: readonly string[]): void => {
    const inconnues = Object.keys(brut).filter((k) => !permises.includes(k));
    if (inconnues.length > 0) throw new RefusOutil(`paramètre « ${cle} » : clé inconnue (${inconnues.join(', ')}) ; seules ${permises.join(', ')}`, 'invalid_args');
  };
  /** Un produit de l'outil (`product_id` ou `sku`) dans la forme de la console (`produit` ou `sku`) ; les deux restent les deux. */
  const produit = (cle: string, p: unknown): unknown => {
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return p;
    const brut = p as Record<string, unknown>;
    seules(cle, brut, ['product_id', 'sku', 'min', 'max']);
    return { ...('product_id' in brut ? { produit: brut.product_id } : {}), ...('sku' in brut ? { sku: brut.sku } : {}) };
  };
  const achats = (cle: string): unknown => {
    const v = args[cle];
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
    const brut = v as Record<string, unknown>;
    seules(cle, brut, ['products', 'within_days']);
    if (Array.isArray(brut.products)) {
      for (const p of brut.products) if (typeof p === 'object' && p !== null) seules(cle, p as Record<string, unknown>, ['product_id', 'sku']);
    }
    return { produits: Array.isArray(brut.products) ? brut.products.map((p) => produit(cle, p)) : brut.products, jours: brut.within_days };
  };
  const reassort = (): unknown => {
    const v = args.days_since_product;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
    const brut = v as Record<string, unknown>;
    return { ...(produit('days_since_product', brut) as object), min: brut.min, max: brut.max };
  };
  /**
   * « A acheté dans la collection » (lot 6a) : `ids` et `within_days` dans la forme de la console (`collections`, `jours`).
   * Qu'une lecture ait abouti et que chaque collection soit connue se juge en base, à la lecture des contacts
   * (`PgContactStore`), dont le refus devient celui de l'outil (`src/mcp/serveur.ts`).
   */
  const collections = (): unknown => {
    const v = args.collections;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
    const brut = v as Record<string, unknown>;
    seules('collections', brut, ['ids', 'within_days']);
    return { collections: brut.ids, jours: brut.within_days };
  };
  /**
   * « A l'étiquette Shopify » (lot 6b) : `tags` et `mode` dans la forme de la console (`etiquettes`, `mode` : `toutes` ou
   * `une`). Qu'une synchronisation ait abouti se juge en base, à la lecture des contacts (`PgContactStore`), dont le refus
   * devient celui de l'outil.
   */
  const etiquettesShopify = (): unknown => {
    const v = args.shopify_tags;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
    const brut = v as Record<string, unknown>;
    seules('shopify_tags', brut, ['tags', 'mode']);
    if (present(brut.mode) && brut.mode !== 'all' && brut.mode !== 'any') throw new RefusOutil('paramètre « shopify_tags » : mode "all" ou "any"', 'invalid_args');
    return { etiquettes: brut.tags, mode: brut.mode === 'any' ? 'une' : 'toutes' };
  };
  /**
   * « Est dans le segment Shopify » (lot 6c) : `ids` et `mode` dans la forme de la console (`segments`, `mode`). Que
   * chaque segment soit suivi, lu et encore chez Shopify se juge en base, à la lecture des contacts (`PgContactStore`).
   */
  const segmentsShopify = (): unknown => {
    const v = args.shopify_segments;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
    const brut = v as Record<string, unknown>;
    seules('shopify_segments', brut, ['ids', 'mode']);
    if (present(brut.mode) && brut.mode !== 'all' && brut.mode !== 'any') throw new RefusOutil('paramètre « shopify_segments » : mode "all" ou "any"', 'invalid_args');
    return { segments: brut.ids, mode: brut.mode === 'any' ? 'une' : 'toutes' };
  };
  if (CLES_COMMANDES_MCP.some((k) => present(args[k])) && (await deps.contacts.suiviSegments(tenantId)).boutique === null) {
    throw new RefusOutil('aucune boutique Shopify dans cet espace : les critères de commande (orders, spent, days_since_last_order, '
      + 'bought, not_bought, days_since_product, collections, wrote_without_order, clicked_without_order) et les étiquettes '
      + 'Shopify (shopify_tags) et ses segments (shopify_segments) n’ont rien à lire. get_shopify_state dit comment la brancher', 'conflict');
  }
  const pays = args.countries;
  if (present(pays) && (!Array.isArray(pays) || pays.length === 0)) throw new RefusOutil('paramètre « countries » : une liste non vide de codes ISO est attendue', 'invalid_args');
  return [
    ...(present(args.orders) ? [entree(CLES_SEGMENT.commandes, plage('orders', true))] : []),
    ...(present(args.spent) ? [entree(CLES_SEGMENT.depense, plage('spent', true))] : []),
    ...(present(args.days_since_last_order) ? [entree(CLES_SEGMENT.derniereCommande, plage('days_since_last_order', false))] : []),
    ...(present(args.bought) ? [entree(CLES_SEGMENT.achete, achats('bought'))] : []),
    ...(present(args.not_bought) ? [entree(CLES_SEGMENT.pasAchete, achats('not_bought'))] : []),
    ...(present(args.days_since_product) ? [entree(CLES_SEGMENT.reassort, reassort())] : []),
    ...(present(args.collections) ? [entree(CLES_SEGMENT.collection, collections())] : []),
    ...(present(args.shopify_tags) ? [entree(CLES_SEGMENT.etiquetteShopify, etiquettesShopify())] : []),
    ...(present(args.shopify_segments) ? [entree(CLES_SEGMENT.segmentShopify, segmentsShopify())] : []),
    // Les boutons prêts passent tels quels : `lireSegment` refuse tout ce qui n'est pas `true`, en le nommant.
    ...(present(args.wrote_without_order) ? [entree(CLES_SEGMENT.ecritSansCommande, args.wrote_without_order)] : []),
    ...(present(args.clicked_without_order) ? [entree(CLES_SEGMENT.clicSansCommande, args.clicked_without_order)] : []),
    ...(present(args.active_within_days) ? [entree(CLES_SEGMENT.actif, args.active_within_days)] : []),
    ...(present(args.inactive_for_days) ? [entree(CLES_SEGMENT.inactif, args.inactive_for_days)] : []),
    ...(present(pays) ? [entree(CLES_SEGMENT.pays, pays)] : []),
  ];
}
