import type { FastifyInstance } from 'fastify';
import { apercuCsvHorsBoucle, parseCsvHorsBoucle } from '../crm/csv';
import { recognizeColumns } from '../crm/recognize';
import { importContacts } from '../crm/import';
import { normalizePhone } from '../crm/phone';
import type { ContactStore, ImportDeps } from '../crm/import';
import type { ColumnMapping, ImportReport } from '../crm/types';
import type { AutoriteImport } from '../crm/transition-consentement';
import type { ContactRow, ContactFilters, ContactFieldFilter } from '../crm/contact-store.pg';
import { CONTACT_FILTER_QUERY_KEYS, filtersActive } from '../../web/lib/partage/contact-filters';
import { gardeEtendue } from '../auth/middleware';
import type { Guard, PreHandler } from '../auth/middleware';
import { espaceVerifie } from './scope';
import { buildContactFilters, normalizeFieldFilters } from '../crm/contact-filters';
import { ACTIVITE_COMPLETE_DEPUIS, type SuiviSegments } from '../crm/segments';
import {
  CLES_SEGMENT, filtreSegment, type BoutonsSansCommandeVue, type ProduitVuVue, type SuiviSegmentsVue,
} from '../../web/lib/partage/segments';
import { journaliser } from '../lib/journal';
import { messageDe } from '../lib/erreur';
import { nettoyerEtiquettes } from '../crm/poser-etiquette';
import { makeJournal, type AuditSink } from '../audit/journal';
import { LimiteOffreError, STATUT_REFUS_OFFRE, corpsRefusLimite } from '../offres/refus';
import type { Fonction } from '../offres/offres';
import { lireCollections, type DepsCollections } from '../shopify/collections';
import { lireEtiquettes, lireSegments, type DepsEtiquettes } from '../shopify/etiquettes';

/** Ce que les routes de liste lisent du dépôt des contacts, en plus de ce que l'import y écrit. */
export interface ContactsListeDep extends ContactStore {
  list(tenantId: string, limit?: number, offset?: number, tag?: string): Promise<ContactRow[]>;
  /** Requête filtrée + paginée (source « Liste de contacts » de campagne). */
  query(tenantId: string, filters: ContactFilters, limit?: number, offset?: number): Promise<ContactRow[]>;
  /** Nombre total correspondant aux filtres (compteur avant de fixer le débit). */
  count(tenantId: string, filters: ContactFilters): Promise<number>;
  /** Ids correspondant aux filtres (résolution serveur de la source de campagne). */
  idsForFilters(tenantId: string, filters: ContactFilters): Promise<string[]>;
  /** La boutique et ses dates de suivi, pour les critères de segment (`GET .../contacts/segments`). */
  suiviSegments(tenantId: string): Promise<SuiviSegments>;
  /** Les produits déjà vus dans les commandes de l'espace, pour choisir un critère produit (lot 3). */
  produitsVus(tenantId: string, recherche: string | undefined, limite: number): Promise<ProduitVuVue[]>;
  /** Les places de l'offre (`PgContactStore.placesContacts`) : l'aperçu annonce les effacements du remplacement (lot 2). */
  placesContacts(tenantId: string, numeros: readonly string[]): Promise<{
    limite: number | null; comptees: number; presents: Set<string>; remplacer: boolean;
  }>;
}

export interface ImportRouteDeps extends ImportDeps {
  contacts: ContactsListeDep;
  /** Les fonctions de l'offre de l'espace : le critère « commande et dernière analyse » (lot 7b) exige `analyse`. */
  fonctions(tenantId: string): Promise<ReadonlySet<Fonction>>;
  /**
   * Les collections lues des produits achetés et l'état de leur lecture (segments Shopify enrichis, lot 6a), pour le
   * volet Shopify : la liste enfile la lecture quand un produit l'attend (`lireCollections`).
   */
  collections: Pick<DepsCollections, 'magasin' | 'etatBoutique' | 'enfiler' | 'maintenant'>;
  /**
   * Les étiquettes Shopify lues et l'état de leur synchronisation (segments Shopify enrichis, lot 6b), pour le volet Shopify
   * et la carte : une LECTURE seule, qui n'enfile rien (la synchronisation s'allume sur la carte).
   */
  etiquettesShopify: Pick<DepsEtiquettes, 'magasin' | 'maintenant'>;
  /**
   * Journal d'audit (les fixtures qui ne l'observent pas passent `journalMuet`). Un import fait entrer des personnes
   * par milliers : sans trace, personne ne peut dire d'où vient un contact ni qui l'a chargé.
   */
  audit: AuditSink;
}

/** Parse les critères de « Liste de contacts » depuis les query params (tous optionnels, valeurs = strings).
*  `tags`/`tagsExclude`=CSV, `fields`=JSON `[{key,op,value}]` (défensif : ignoré si illisible). Bornes anti-abus.
*  Seule exception à « ignoré » : un `risque` hors des quatre niveaux est refusé (400, `FiltreContactInvalide`).
*  Exporté pour le test de round-trip anti-drift (filtersToQuery côté web <-> parseFilters ici). */
export function parseFilters(q: Record<string, unknown>): ContactFilters {
  const k = CONTACT_FILTER_QUERY_KEYS;
  const csv = (v: unknown): string[] =>
    typeof v === 'string' ? v.split(',') : [];
  // Les filtres de champ arrivent ici en JSON dans un query param : illisible -> ignoré (donnée externe).
  let parsed: unknown = null;
  const champs = q[k.fieldFilters];
  if (typeof champs === 'string' && champs.trim() !== '') {
    try { parsed = JSON.parse(champs) as unknown; } catch { /* filtre de champ illisible -> ignoré (donnée externe) */ }
  }
  // 🔴 HORS du `try` : un filtre d'analyse invalide lève `FiltreContactInvalide` (400), qu'un `catch` avalerait en
  // « aucun filtre », donc en tout l'espace.
  const fieldFilters: ContactFieldFilter[] = Array.isArray(parsed) ? normalizeFieldFilters(parsed) : [];
  return buildContactFilters({
    tags: csv(q[k.tags]),
    tagMode: q[k.tagMode],
    tagsExclude: csv(q[k.tagsExclude]),
    optIn: q[k.optIn],
    phonePrefix: q[k.phonePrefix],
    phoneContains: q[k.phoneContains],
    nameSearch: q[k.nameSearch],
    joignabilite: q[k.joignabiliteWhatsApp],
    // Une valeur hors des quatre niveaux lève `FiltreContactInvalide` (400), jamais ignorée : cf. `risqueFiltre`.
    risque: q[k.risque],
    fieldFilters,
  });
}

/** Construit un mapping par défaut depuis la reconnaissance de colonnes. */
/**
 * LE PLUS ANCIEN LAISSE SA PLACE (décision de Julien du 2026-11-24, lot 2) : de quoi dire combien des plus anciens contacts
 * l'import effacerait, selon la colonne de téléphone détectée, avant la confirmation : les numéros nouveaux du texte reçu
 * et les places libres (négatives au-delà de la limite). Les effacements valent `nouveaux - placesLibres` ; la console,
 * qui n'envoie que la tête d'un gros fichier, extrapole les nouveaux comme elle extrapole les lignes. Les mêmes comptes que
 * la garde de l'import (`placesContacts`, `verifierPlaceContacts`). Rien (aucune clé) sans l'option, sans limite, ou
 * sans colonne de téléphone : le fichier n'est alors pas relu.
 */
async function effacementsDeLImport(
  deps: DepsApercuImport, tenantId: string, csv: string, mapping: ColumnMapping,
): Promise<{ remplacement?: { nouveaux: number; placesLibres: number } }> {
  const colonne = Object.entries(mapping.columns).find(([, c]) => c.target === 'phone')?.[0];
  if (colonne === undefined) return {};
  const vide = await deps.contacts.placesContacts(tenantId, []);
  if (!vide.remplacer || vide.limite === null) return {};
  const { rows } = await parseCsvHorsBoucle(csv);
  const numeros = [...new Set(rows
    .map((r) => normalizePhone(r[colonne] ?? '', deps.defaultCountry ?? 'FR').e164)
    .filter((n): n is string => typeof n === 'string' && n !== ''))];
  const p = await deps.contacts.placesContacts(tenantId, numeros);
  if (p.limite === null) return {};
  return { remplacement: { nouveaux: numeros.filter((n) => !p.presents.has(n)).length, placesLibres: p.limite - p.comptees } };
}

/**
 * Combien des plus anciens contacts un import effacerait pour ce texte et ce mapping : 0 sans l'option « le plus ancien
 * laisse sa place », sans limite ou sans colonne de téléphone. Le compte que l'outil `import_contacts` exige d'accepter
 * avant d'écrire (B10), le même que l'aperçu annonce.
 */
export async function effacementsDeLImportPour(deps: DepsApercuImport, tenantId: string, csv: string, mapping: ColumnMapping): Promise<number> {
  const { remplacement } = await effacementsDeLImport(deps, tenantId, csv, mapping);
  return remplacement ? Math.max(0, remplacement.nouveaux - remplacement.placesLibres) : 0;
}

export function mappingFromHeaders(headers: string[]): ColumnMapping {
  const columns: ColumnMapping['columns'] = {};
  for (const s of recognizeColumns(headers)) {
    columns[s.header] =
      s.target === 'custom' ? { target: 'custom', key: s.suggestedKey } : { target: s.target };
  }
  return { columns };
}

/**
 * Le compte de chaque bouton prêt (segments Shopify enrichis, lot 4), le bouton SEUL, jamais croisé avec les autres
 * filtres du panneau (décision de Julien du 2026-11-23) : deux `count` par le même `buildContactWhere` que la liste, à
 * l'ouverture du panneau, jamais en cache. 🔴 Au mieux : une panne les omet (la console ne montre alors aucun bouton)
 * plutôt que de faire tomber cette réponse, qui est la garde de TOUS les critères de segment.
 */
async function comptesDesBoutons(contacts: ContactsListeDep, tenantId: string): Promise<BoutonsSansCommandeVue | undefined> {
  try {
    const [ecritSansCommande, clicSansCommande] = await Promise.all([
      contacts.count(tenantId, { fieldFilters: [filtreSegment(CLES_SEGMENT.ecritSansCommande, true)] }),
      contacts.count(tenantId, { fieldFilters: [filtreSegment(CLES_SEGMENT.clicSansCommande, true)] }),
    ]);
    return { ecritSansCommande, clicSansCommande };
  } catch (err) {
    journaliser('warn', 'segments_boutons_illisibles', { tenantId, erreur: messageDe(err) });
    return undefined;
  }
}

/** Ce dont l'aperçu d'un import a besoin : les places de l'offre, et le pays des numéros donnés sans indicatif. */
export type DepsApercuImport = Pick<ImportRouteDeps, 'defaultCountry'> & { contacts: Pick<ContactsListeDep, 'placesContacts'> };
/** Ce dont un import a besoin : l'upsert et la garde de l'offre (`ImportDeps`), et le journal d'audit. */
export type DepsImportCsv = ImportDeps & { audit: AuditSink };
/** L'issue d'un aperçu ou d'un import : la valeur, ou le statut et le corps que la route rend et que l'outil traduit. */
export type IssueImport<T> = { ok: true; valeur: T } | { ok: false; statut: 400 | 402; corps: Record<string, unknown> };
/** Ce que l'aperçu montre : le CSV lu comme l'import le lira, le mapping proposé, et les effacements annoncés. */
export type ApercuImport = Awaited<ReturnType<typeof apercuCsvHorsBoucle>> & {
  mapping: ColumnMapping; remplacement?: { nouveaux: number; placesLibres: number };
};
/** Ce que saisit un import : le CSV, son mapping (facultatif : celui des en-têtes), ses étiquettes, l'accord déclaré. */
export interface SaisieImport { csv: unknown; mapping?: unknown; tags?: unknown; optIn: boolean }

/**
 * L'aperçu d'un import, partagé par `POST .../contacts/import/preview` et l'outil `preview_contacts_import` (lot 1 du
 * CSM virtuel, B10) : le CSV lu par le même `parseCsv` que l'import réel (en-têtes identiques, pas de désync), le mapping
 * proposé et, quand l'espace fait de la place, ce que l'import effacerait. N'écrit rien.
 * ⚠️ L'aperçu de la console ne reçoit que la tête du fichier (`teteCsv`, 512 000 caractères) : l'identité tient tant
 * qu'elle porte les 50 rangées où `separateurCsv` cherche le séparateur (plus de 10 000 caractères par rangée en moyenne,
 * l'aperçu et l'import peuvent lire deux séparateurs).
 */
export async function apercuImport(deps: DepsApercuImport, tenantId: string, csv: unknown): Promise<IssueImport<ApercuImport>> {
  if (typeof csv !== 'string' || csv.trim() === '') return { ok: false, statut: 400, corps: { error: 'csv requis (texte brut)' } };
  const apercu = await apercuCsvHorsBoucle(csv);
  if (apercu.headers.length === 0) return { ok: false, statut: 400, corps: { error: 'aucune colonne détectée (1re ligne = en-têtes)' } };
  const mapping = mappingFromHeaders(apercu.headers);
  return { ok: true, valeur: { ...apercu, mapping, ...(await effacementsDeLImport(deps, tenantId, csv, mapping)) } };
}

/**
 * Importe un CSV, partagée par `POST .../contacts/import` et l'outil `import_contacts` (B10) : le mapping vérifié, les
 * étiquettes nettoyées (64 caractères, 50 au plus), la limite de l'offre sur TOUT le fichier (402, rien d'écrit), une
 * ligne `contact.imported` par lot au nom de l'auteur (pas une par contact : 50 000 lignes noieraient l'historique ;
 * l'accord y figure parce qu'il autorise les envois marketing derrière).
 * 🔴 L'autorité vient de l'appelant : seule la case de l'écran (`import_csv_coche`) lève un STOP ; l'outil passe `import`.
 */
export async function importerCsv(
  deps: DepsImportCsv, tenantId: string, b: SaisieImport, autorite: AutoriteImport, auteur: { auth?: { userId: string } },
): Promise<IssueImport<ImportReport>> {
  if (typeof b.csv !== 'string' || b.csv.trim() === '') return { ok: false, statut: 400, corps: { error: 'csv requis (texte brut)' } };
  // Tags : une chaîne "a, b, c" ou un tableau ; normalisés (trim, non vides, dédup) et bornés comme toute pose.
  const rawTags = Array.isArray(b.tags)
    ? (b.tags as unknown[]).map(String)
    : typeof b.tags === 'string'
      ? b.tags.split(',')
      : [];
  const tags = nettoyerEtiquettes(rawTags, 50);
  // mapping fourni mais malformé (sans `columns` objet) -> 400, sinon Object.entries lèverait une 500.
  if (b.mapping !== undefined) {
    const cols = (b.mapping as { columns?: unknown } | null)?.columns;
    if (typeof cols !== 'object' || cols === null || Array.isArray(cols)) {
      return { ok: false, statut: 400, corps: { error: 'mapping invalide (columns requis)' } };
    }
  }
  const parsed = await parseCsvHorsBoucle(b.csv);
  const mapping = (b.mapping as ColumnMapping | undefined) ?? mappingFromHeaders(parsed.headers);
  let report: ImportReport;
  try {
    report = await importContacts({ rows: parsed.rows, mapping, tenantId, optIn: b.optIn, tags, autorite }, deps);
  } catch (err) {
    // La limite de contacts de l'offre (lot 6) : le fichier entier est refusé, rien n'est écrit.
    if (err instanceof LimiteOffreError) return { ok: false, statut: STATUT_REFUS_OFFRE, corps: corpsRefusLimite(err) };
    throw err;
  }
  await makeJournal(deps.audit)(tenantId, auteur, 'contact.imported', { kind: 'contact', id: 'lot' }, {
    created: report.created, updated: report.updated, skipped: report.skipped, optIn: b.optIn, tags: tags.length,
  });
  return { ok: true, valeur: report };
}

/**
 * POST /tenants/:tenantId/contacts/import : parse un CSV brut, reconnaît les colonnes (sans mapping fourni),
 * upsert les contacts. Rend un ImportReport.
 */
export function registerImport(app: FastifyInstance, deps: ImportRouteDeps, garde: Guard, limiteCouteuse?: PreHandler): void {
  const opts = { preHandler: garde };
  // Garde des routes coûteuses : la garde habituelle plus le plafond par espace. `gardeEtendue` aplatit la
  // chaîne, parce que `gardeAdmin` est déjà un tableau et qu'un tableau imbriqué ne serait pas exécuté.
  const couteux = gardeEtendue(garde, limiteCouteuse);
  // Le CSV complet transite dans le corps. 8 Mo (environ 150 000 contacts), pas plus : le corps est parsé d'un
  // bloc (l'API ne répond à personne d'autre pendant ce temps), et 8 Mo de CSV pèsent ~150 Mo de tas en objets.
  const optsImportCouteux = { ...couteux, bodyLimit: 8 * 1024 * 1024 };
  // L'aperçu ne reçoit que la tête du fichier (cf. `TETE_APERCU_CARACTERES` côté console) : assez pour les
  // en-têtes et quatre lignes d'exemple. Le plafond reste large devant cette tête sans laisser passer un fichier.
  const optsApercuCouteux = { ...couteux, bodyLimit: 2 * 1024 * 1024 };

  app.get('/tenants/:tenantId/contacts', opts, async (req, reply) => {
    const effectiveTenant = espaceVerifie(req);
    const q = req.query as Record<string, unknown>;
    const limit = typeof q.limit === 'string' ? Number(q.limit) : undefined;
    const offset = typeof q.offset === 'string' ? Number(q.offset) : undefined;
    const filters = parseFilters(q);
    // Filtres avancés posés -> chemin requêtable (query + total pour le compteur). Sinon on garde le
    // chemin historique `listContacts` (avec le paramètre `tag` simple), rétro-compatible.
    if (filtersActive(filters)) {
      const [contacts, total] = await Promise.all([
        deps.contacts.query(effectiveTenant, filters, limit, offset),
        deps.contacts.count(effectiveTenant, filters),
      ]);
      return reply.code(200).send({ contacts, total });
    }
    const tag = typeof q.tag === 'string' && q.tag.trim() !== '' ? q.tag.trim() : undefined;
    const contacts = await deps.contacts.list(effectiveTenant, limit, offset, tag);
    return reply.code(200).send({ contacts });
  });

  /**
   * Ce que l'API sait cibler en segments (spec du 2026-10-31) : la boutique de l'espace (branchée ou coupée), sa devise et
   * ses dates de suivi, et depuis quand l'activité est complète. 🔴 Sa simple réponse est aussi une GARDE : la console ne
   * propose ces critères qu'à une API qui a répondu ici, parce qu'une API plus ancienne les jetterait sans rien dire et
   * rendrait tout l'espace à « au moins deux commandes ».
   */
  app.get('/tenants/:tenantId/contacts/segments', opts, async (req, reply) => {
    const tenantId = espaceVerifie(req);
    const { boutique } = await deps.contacts.suiviSegments(tenantId);
    // Les pastilles des deux boutons prêts (lot 4) : seulement avec une boutique, sans quoi le volet n'est pas là.
    const boutons = boutique === null ? undefined : await comptesDesBoutons(deps.contacts, tenantId);
    // La dernière commande face à la dernière analyse (lot 7b) : annoncée seulement avec une boutique ET la fonction `analyse`.
    const analyseCommandes = boutique !== null && (await deps.fonctions(tenantId)).has('analyse');
    const vue: SuiviSegmentsVue = {
      boutique: boutique === null ? null : {
        devise: boutique.devise, commandesDepuis: boutique.commandesDepuis.toISOString(), coupeeLe: boutique.coupeeLe?.toISOString() ?? null,
        // Le dernier rattrapage terminé des commandes (lot 5) : la note du volet dit depuis quand elles ont été relues.
        ...(boutique.rattrapage ? { rattrapeesDepuis: boutique.rattrapage.depuis.toISOString() } : {}),
      },
      activiteCompleteDepuis: ACTIVITE_COMPLETE_DEPUIS,
      // Les critères produit (lot 3) : la console ne les propose qu'à une API qui le dit ici.
      produits: true,
      // Le critère de collection et la liste des collections lues (lot 6a) : de même.
      collections: true,
      // Le critère d'étiquette Shopify et la liste des étiquettes lues (lot 6b) : de même.
      etiquettesShopify: true,
      // Le critère de segment Shopify et la liste des segments lus (lot 6c) : de même.
      segmentsShopify: true,
      ...(analyseCommandes ? { analyseCommandes: true } : {}),
      ...(boutons ? { boutons } : {}),
    };
    return reply.code(200).send(vue);
  });

  /**
   * Les produits déjà vus dans les commandes de l'espace (segments Shopify enrichis, lot 3), pour le sélecteur du volet
   * Shopify : jamais le catalogue, 20 au plus, les plus achetés d'abord. `q` cherche dans le titre et le SKU (80
   * caractères au plus, au-delà coupé).
   */
  app.get('/tenants/:tenantId/contacts/segments/produits', opts, async (req, reply) => {
    const q = (req.query as Record<string, unknown>).q;
    const recherche = typeof q === 'string' ? q.slice(0, 80) : undefined;
    const produits = await deps.contacts.produitsVus(espaceVerifie(req), recherche, 20);
    return reply.code(200).send({ produits });
  });

  /**
   * Les collections lues des produits achetés (segments Shopify enrichis, lot 6a), pour le critère « a acheté dans la
   * collection » : 50 au plus, celles qui portent le plus de produits commandés d'abord, avec l'état de la lecture (lue le,
   * en cours, refusée). 🔴 Une lecture LÉGÈRE qui ENFILE : un produit acheté jamais lu, ou lu il y a plus de 24 h, demande
   * une lecture des collections de la boutique branchée. `q` cherche dans le titre (80 caractères au plus, au-delà coupé).
   */
  app.get('/tenants/:tenantId/contacts/segments/collections', opts, async (req, reply) => {
    const q = (req.query as Record<string, unknown>).q;
    const recherche = typeof q === 'string' ? q.slice(0, 80) : undefined;
    return reply.code(200).send(await lireCollections(deps.collections, espaceVerifie(req), recherche));
  });

  /**
   * Les étiquettes Shopify lues sur les clients de la boutique (segments Shopify enrichis, lot 6b), pour le critère
   * « étiquette Shopify » et la carte : 50 au plus, celles que portent le plus de fiches d'abord, avec l'état de la
   * synchronisation (allumée, aboutie le, en cours, refusée). Une lecture seule. `q` cherche dans le texte (80 caractères au
   * plus, au-delà coupé).
   */
  app.get('/tenants/:tenantId/contacts/segments/etiquettes-shopify', opts, async (req, reply) => {
    const q = (req.query as Record<string, unknown>).q;
    const recherche = typeof q === 'string' ? q.slice(0, 80) : undefined;
    return reply.code(200).send(await lireEtiquettes(deps.etiquettesShopify, espaceVerifie(req), recherche));
  });

  /**
   * Les segments Shopify lus (segments Shopify enrichis, lot 6c), pour le critère « est dans le segment Shopify » et la
   * carte : tous ceux de la liste (250 au plus chez Shopify), les suivis d'abord, avec l'état de la synchronisation qui les
   * lit. Une lecture seule.
   */
  app.get('/tenants/:tenantId/contacts/segments/segments-shopify', opts, async (req, reply) => {
    return reply.code(200).send(await lireSegments(deps.etiquettesShopify, espaceVerifie(req)));
  });

  // Compteur seul (rapide) : « N contacts correspondent » avant de fixer le débit / lancer.
  app.get('/tenants/:tenantId/contacts/count', opts, async (req, reply) => {
    const effectiveTenant = espaceVerifie(req);
    const total = await deps.contacts.count(effectiveTenant, parseFilters(req.query as Record<string, unknown>));
    return reply.code(200).send({ total });
  });

  // Résolution serveur de la source « Liste de contacts » : les ids correspondant aux filtres. Plus aucun appelant
  // (l'écran envoie l'intention `contactTarget`, résolue en base) ; la route reste, primitive de lecture bornée.
  app.get('/tenants/:tenantId/contacts/ids', opts, async (req, reply) => {
    const effectiveTenant = espaceVerifie(req);
    const ids = await deps.contacts.idsForFilters(effectiveTenant, parseFilters(req.query as Record<string, unknown>));
    return reply.code(200).send({ ids });
  });

  // Aperçu : le front affiche l'écran de mapping pré-rempli (`apercuImport`, que l'outil appelle aussi).
  app.post('/tenants/:tenantId/contacts/import/preview', optsApercuCouteux, async (req, reply) => {
    const r = await apercuImport(deps, espaceVerifie(req), (req.body as { csv?: unknown } | null)?.csv);
    return r.ok ? reply.code(200).send(r.valeur) : reply.code(r.statut).send(r.corps);
  });

  app.post('/tenants/:tenantId/contacts/import', optsImportCouteux, async (req, reply) => {
    const body = (req.body ?? {}) as { csv?: unknown; optIn?: unknown; mapping?: unknown; tags?: unknown };
    // 🔴 Opt-in par défaut, aligné sur l'écran d'import (case pré-cochée) : un appel qui omet le champ chargerait
    // sinon une liste que le garde-fou de campagne écarte du marketing, sans rien signaler.
    const optIn = body.optIn !== false;
    // 🔴 La case cochée réabonne aussi qui a dit STOP : c'est le seul import qui le peut, parce que l'opérateur le
    // demande. HubSpot, le webhook entrant, la création à la main et l'outil de Claude gardent le STOP.
    const r = await importerCsv(
      deps, espaceVerifie(req), { csv: body.csv, mapping: body.mapping, tags: body.tags, optIn },
      optIn ? 'import_csv_coche' : 'import', req,
    );
    return r.ok ? reply.code(200).send(r.valeur) : reply.code(r.statut).send(r.corps);
  });
}
