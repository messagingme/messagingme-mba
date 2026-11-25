import { z } from 'zod';
import { API_VERSION_SHOPIFY } from './connexion';
import { telephoneE164 } from './donnees';
import type { CoutRequete } from './reprise';
import type { ClientLu } from './etiquettes.pg';
import { fetchPublic } from '../lib/connexion-publique';
import { lireCorpsBorne } from '../lib/corps-borne';
import { texteDe } from '../lib/erreur';
import { journaliser } from '../lib/journal';
import { BORNES_SEGMENTS } from '../../web/lib/partage/segments';

/**
 * LES ÉTIQUETTES DES CLIENTS, LUES CHEZ SHOPIFY par l'API Admin GraphQL (segments Shopify enrichis, lot 6b). Deux lectures,
 * le droit `read_customers` seul (aucun droit nouveau) :
 * - par identifiant : `nodes(ids:)` sur les GID des clients déjà reliés à une fiche, 250 au plus par appel (le plafond
 *   d'un argument liste de l'API) ; un nœud `null` est un client qui n'existe plus chez Shopify (supprimé, fusionné) ;
 * - par téléphone : `customers(query: "phone:+33... OR phone:+33...")`, pour les fiches à chercher. Un client se relie
 *   par TOUS les numéros que Shopify connaît pour lui (lot 6b bis, décision de Julien du 2026-11-25, « le max de
 *   numéros ») : ses coordonnées (`defaultPhoneNumber`) et ses adresses enregistrées (`addressesV2`,
 *   `ADRESSES_PAR_CLIENT` au plus). Mesuré le 2026-11-25 : la plupart des clients n'ont leur numéro que sur une adresse,
 *   souvent au format national, et la recherche `phone:` de Shopify les trouve par elle, sous l'écriture E.164 ; la
 *   dernière commande n'apporte aucun numéro que les adresses n'ont pas (Shopify range celles du paiement dans le carnet
 *   du client), elle n'est donc pas lue : elle aurait demandé `read_orders` et coûté sans rien ajouter. 🔴 Le filtre de
 *   recherche n'est jamais cru : chaque client rendu est revérifié sur ses numéros, chacun normalisé au pays de SON
 *   adresse, à défaut à celui de la boutique (`telephoneE164`), et une recherche dont la page n'est pas complète
 *   (`hasNextPage`) ne dit pas « absent ».
 *
 * 🔴 Une réponse dont la liste n'a pas un nœud par identifiant demandé ne s'écrit pas : elle dirait supprimés des clients
 * qui ne le sont pas. Une réponse qui porte une erreur ne s'écrit pas non plus : un nœud nul n'y prouve rien.
 *
 * Le frein `THROTTLED` attend que le seau se recharge, dans le délai de l'appel (`delaiMs` borne l'appel ENTIER, attentes
 * comprises), comme les collections (`./collections-lues.ts`). Un accès refusé se dit avec le message de Shopify ; un lot
 * trop lourd (5xx, `INTERNAL_SERVER_ERROR`, `MAX_COST_EXCEEDED`, corps trop gros) rend `trop_lourd`, que le job redemande
 * plus petit. Le coût compté par Shopify revient avec le lot. Passe par `fetchPublic` (inventaire de
 * `tests/lib-adresse-privee.test.ts`).
 */

/** Les clients d'un lot lu par identifiant : le plafond d'un argument liste de l'API Admin GraphQL. */
export const CLIENTS_PAR_LOT = 250;
/** Les téléphones d'une recherche : une requête courte, et au plus deux clients rendus par téléphone avant le plafond de page. */
export const TELEPHONES_PAR_RECHERCHE = 25;
/** Les adresses enregistrées lues par client trouvé : assez pour un carnet d'adresses, sous le plafond de coût. */
export const ADRESSES_PAR_CLIENT = 10;
/**
 * Les clients rendus par une recherche : deux par téléphone, dix au moins (un numéro partagé par plusieurs clients),
 * cinquante au plus. 🔴 Le plafond est celui du COÛT : un client coûte 4 points plus un par adresse demandée
 * (`COUT_PAR_CLIENT`), et Shopify refuse une requête de plus de 1 000 points (`MAX_COST_EXCEEDED`, que le job rattrape
 * en coupant le lot) ; `tests/shopify-etiquettes.test.ts` dérive la borne des deux constantes.
 */
export const CLIENTS_PAR_RECHERCHE = 50;
const CLIENTS_PAR_RECHERCHE_MIN = 10;
/** Le coût demandé d'un client trouvé : le nœud, ses coordonnées, la connexion de ses adresses (2) et chaque adresse. */
export const COUT_PAR_CLIENT = 4 + ADRESSES_PAR_CLIENT;
/** Les étiquettes d'un client : le plafond de Shopify (REST Admin 2026-10, Customer : « A customer can have up to 250 tags »). */
export const ETIQUETTES_PAR_CLIENT = 250;
const CORPS_MAX = 4_000_000;
const ESSAIS_FREIN = 5;
const ID = /^\d{1,19}$/;
const E164 = /^\+[1-9]\d{6,14}$/;

const REQUETE_IDS = `query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Customer { legacyResourceId tags } }
}`;

const REQUETE_TELEPHONES = `query($q: String!, $n: Int!) {
  customers(first: $n, query: $q) {
    pageInfo { hasNextPage }
    nodes {
      legacyResourceId tags defaultPhoneNumber { phoneNumber }
      addressesV2(first: ${ADRESSES_PAR_CLIENT}) { nodes { phone countryCodeV2 } }
    }
  }
}`;

const schemaReponse = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string().catch(''), extensions: z.object({ code: z.string().nullish() }).nullish() })).nullish(),
  extensions: z.object({
    cost: z.object({
      requestedQueryCost: z.number().nullish(),
      actualQueryCost: z.number().nullish(),
      throttleStatus: z.object({ currentlyAvailable: z.number(), restoreRate: z.number() }).nullish(),
    }).nullish(),
  }).nullish(),
});
const schemaNoeuds = z.object({ nodes: z.array(z.unknown()) });
const schemaClient = z.object({ legacyResourceId: z.string().regex(ID), tags: z.array(z.unknown()) });
const schemaRecherche = z.object({
  customers: z.object({ pageInfo: z.object({ hasNextPage: z.boolean() }), nodes: z.array(z.unknown()) }),
});
/** Une adresse dont seul le numéro et le pays servent ; illisible, elle ne donne aucun numéro (le client reste lu). */
const schemaAdresse = z.object({ phone: z.string().nullish(), countryCodeV2: z.string().nullish() }).nullish().catch(null);
const schemaTrouve = schemaClient.extend({
  defaultPhoneNumber: z.object({ phoneNumber: z.string().nullish() }).nullish().catch(null),
  addressesV2: z.object({ nodes: z.array(schemaAdresse) }).nullish().catch(null),
});

/**
 * Tous les numéros qu'un client trouvé porte chez Shopify, en E.164 : ses coordonnées (au pays de la boutique) et chacune
 * de ses adresses (au pays de SON adresse).
 */
export function numerosDuClient(c: z.infer<typeof schemaTrouve>, paysBoutique: string | null): Set<string> {
  const candidats = [
    { brut: c.defaultPhoneNumber?.phoneNumber, pays: null },
    ...(c.addressesV2?.nodes ?? []).map((a) => ({ brut: a?.phone, pays: a?.countryCodeV2 })),
  ];
  const numeros = new Set<string>();
  for (const candidat of candidats) {
    const e164 = telephoneE164([candidat], paysBoutique);
    if (e164 !== null) numeros.add(e164);
  }
  return numeros;
}

type Echec = { ok: false; code: 'acces_refuse' | 'passager' | 'trop_lourd'; message: string };
/** Un lot de clients lus par identifiant, ou la raison de son refus. `illisibles` : des nœuds qui ne se lisent pas, laissés tels quels. */
export type LotClients = { ok: true; clients: ClientLu[]; illisibles: number; cout: CoutRequete } | Echec;
/**
 * Une recherche par téléphones : chaque couple (téléphone demandé, client qui le porte parmi ses numéros revérifiés),
 * TOUS les clients d'un téléphone (plusieurs clients au même numéro se relient tous à sa fiche), et si la page était
 * complète (`complete` : alors seulement, un client absent n'a pas ce numéro).
 */
export type RechercheTelephones =
  | { ok: true; trouves: Array<{ telephone: string; clientId: string; etiquettes: string[] }>; complete: boolean; cout: CoutRequete }
  | Echec;

/**
 * Les étiquettes utiles d'un client : un texte de 1 à 255 caractères (la borne de Shopify, en points de code, comme le CHECK
 * de la migration 0319), sans ses espaces de bord, dédupliqué, 250 au plus. 🔴 Jamais tronquée (une étiquette coupée serait
 * une autre étiquette) : au-delà de la borne, elle est écartée et le compte le dit. Un caractère nul et une moitié de paire
 * (que le `jsonb` de l'écriture refuse) ne passent pas : le lot entier échouerait à chaque passage.
 */
export function etiquettesUtiles(brutes: readonly unknown[]): { etiquettes: string[]; ecartees: number } {
  const vues = new Set<string>();
  const etiquettes: string[] = [];
  let ecartees = 0;
  for (const b of brutes) {
    if (typeof b !== 'string') { ecartees += 1; continue; }
    const t = b.split('\u0000').join('').replace(/[\uD800-\uDFFF]/gu, '�').trim();
    if (t === '') continue;
    if (Array.from(t).length > BORNES_SEGMENTS.etiquetteShopifyMax) { ecartees += 1; continue; }
    if (vues.has(t)) continue;
    if (etiquettes.length >= ETIQUETTES_PAR_CLIENT) { ecartees += 1; continue; }
    vues.add(t);
    etiquettes.push(t);
  }
  return { etiquettes, ecartees };
}

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Un appel GraphQL et son frein, borné à `delaiMs` attentes comprises : ses données, ou la raison de son refus. */
async function appelerGraphql(
  acces: { domaine: string; jeton: string }, corps: { query: string; variables: Record<string, unknown> }, delaiMs: number, quoi: string,
  appeler: typeof fetch, attendre: (ms: number) => Promise<void>, maintenant: () => number,
): Promise<{ ok: true; data: unknown; cout: CoutRequete } | Echec> {
  const fin = maintenant() + delaiMs;
  for (let freins = 0; ; freins += 1) {
    const reste = fin - maintenant();
    if (reste <= 0) return { ok: false, code: 'passager', message: `Shopify n’a pas rendu ${quoi} à temps : réessayez dans un instant.` };
    let reponse: z.infer<typeof schemaReponse>;
    try {
      const res = await appeler(`https://${acces.domaine}/admin/api/${API_VERSION_SHOPIFY}/graphql.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-shopify-access-token': acces.jeton },
        body: JSON.stringify(corps),
        redirect: 'manual',
        signal: AbortSignal.timeout(reste),
      });
      const statut = res.status;
      if (statut === 401 || statut === 403) {
        return { ok: false, code: 'acces_refuse', message: `Shopify refuse la lecture des clients (statut ${statut}) : l’app doit avoir le droit read_customers.` };
      }
      if (statut >= 500) return { ok: false, code: 'trop_lourd', message: `Shopify n’a pas rendu ${quoi} (statut ${statut}).` };
      const lu = await lireCorpsBorne(res, CORPS_MAX);
      if (lu.trop_gros) return { ok: false, code: 'trop_lourd', message: `Shopify a rendu ${quoi} trop lourds.` };
      if (lu.casse) return { ok: false, code: 'passager', message: `Shopify a rendu ${quoi} illisibles : réessayez dans un instant.` };
      const r = schemaReponse.safeParse(JSON.parse(lu.texte));
      if (statut !== 200 || !r.success) {
        return { ok: false, code: 'passager', message: `Shopify n’a pas rendu ${quoi} (statut ${statut}) : réessayez dans un instant.` };
      }
      reponse = r.data;
    } catch (err) {
      return { ok: false, code: 'passager', message: `Shopify n’a pas répondu (${texteDe(err)}) : réessayez dans un instant.` };
    }

    const codes = (reponse.errors ?? []).map((e) => e.extensions?.code ?? '');
    if (codes.includes('THROTTLED')) {
      const seau = reponse.extensions?.cost?.throttleStatus;
      const cout = reponse.extensions?.cost?.requestedQueryCost ?? 0;
      const attenteMs = seau && seau.restoreRate > 0 ? Math.ceil(Math.max(0, cout - seau.currentlyAvailable) / seau.restoreRate) * 1000 : 1000;
      const attente = Math.max(1000, attenteMs);
      if (freins >= ESSAIS_FREIN || maintenant() + attente >= fin) return { ok: false, code: 'passager', message: 'Shopify freine la lecture des clients : réessayez dans une minute.' };
      await attendre(attente);
      continue;
    }
    if (codes.length > 0) {
      // Le message de Shopify dit le champ et le droit qui manquent : il est rendu tel quel, jamais deviné.
      const refus = (reponse.errors ?? []).find((e) => e.extensions?.code === 'ACCESS_DENIED' || /access denied/i.test(e.message));
      if (refus) return { ok: false, code: 'acces_refuse', message: `Shopify refuse la lecture des clients (${refus.message.slice(0, 300)}).` };
      if (codes.includes('MAX_COST_EXCEEDED') || codes.includes('INTERNAL_SERVER_ERROR')) {
        return { ok: false, code: 'trop_lourd', message: `Shopify trouve le lot de clients trop lourd (${codes.join(', ')}).` };
      }
      return { ok: false, code: 'passager', message: `Shopify refuse la requête des clients (${(reponse.errors ?? [])[0]?.message.slice(0, 200) ?? 'erreur'}).` };
    }
    const cout = { demande: reponse.extensions?.cost?.requestedQueryCost ?? null, reel: reponse.extensions?.cost?.actualQueryCost ?? null };
    return { ok: true, data: reponse.data, cout };
  }
}

/** Un lot de clients reliés, lus par leur identifiant : leurs étiquettes, ou `null` pour un client qui n'existe plus. */
export async function lireClientsParIds(
  acces: { domaine: string; jeton: string },
  p: { ids: readonly string[]; delaiMs: number },
  /** `fetchPublic`, une vraie attente et la vraie heure en production ; injectables pour éprouver la lecture. */
  appeler: typeof fetch = fetchPublic,
  attendre: (ms: number) => Promise<void> = pause,
  maintenant: () => number = Date.now,
): Promise<LotClients> {
  if (p.ids.length === 0 || p.ids.length > CLIENTS_PAR_LOT || !p.ids.every((id) => ID.test(id))) {
    return { ok: false, code: 'passager', message: 'Un lot de clients illisible : lot ignoré.' };
  }
  const r = await appelerGraphql(acces, { query: REQUETE_IDS, variables: { ids: p.ids.map((id) => `gid://shopify/Customer/${id}`) } },
    p.delaiMs, 'les clients', appeler, attendre, maintenant);
  if (!r.ok) return r;
  const d = schemaNoeuds.safeParse(r.data);
  if (!d.success || d.data.nodes.length !== p.ids.length) {
    return { ok: false, code: 'passager', message: 'Shopify n’a pas rendu un nœud par client demandé : réessayez dans un instant.' };
  }
  const clients: ClientLu[] = [];
  let illisibles = 0;
  let ecartees = 0;
  p.ids.forEach((clientId, i) => {
    const noeud = d.data.nodes[i];
    // Supprimé ou fusionné chez Shopify : le lien se perd (la fiche sera cherchée une fois de plus par son téléphone).
    if (noeud === null) { clients.push({ clientId, etiquettes: null }); return; }
    const c = schemaClient.safeParse(noeud);
    if (!c.success || c.data.legacyResourceId !== clientId) { illisibles += 1; return; }
    const u = etiquettesUtiles(c.data.tags);
    ecartees += u.ecartees;
    clients.push({ clientId, etiquettes: u.etiquettes });
  });
  if (illisibles > 0 || ecartees > 0) journaliser('warn', 'shopify_etiquettes_illisibles', { clients: illisibles, etiquettes: ecartees });
  return { ok: true, clients, illisibles, cout: r.cout };
}

/**
 * Les clients de ces téléphones (E.164), cherchés par le filtre `phone:` et REVÉRIFIÉS sur tous leurs numéros
 * (`numerosDuClient`). Un client qui porte plusieurs des téléphones demandés est rendu pour chacun ; un téléphone porté
 * par plusieurs clients les rend tous.
 */
export async function chercherParTelephones(
  acces: { domaine: string; jeton: string },
  p: { telephones: readonly string[]; pays: string | null; delaiMs: number },
  appeler: typeof fetch = fetchPublic,
  attendre: (ms: number) => Promise<void> = pause,
  maintenant: () => number = Date.now,
): Promise<RechercheTelephones> {
  const demandes = [...new Set(p.telephones.filter((t) => E164.test(t)))];
  if (demandes.length === 0) return { ok: true, trouves: [], complete: true, cout: { demande: null, reel: null } };
  if (demandes.length > TELEPHONES_PAR_RECHERCHE) return { ok: false, code: 'passager', message: 'Une recherche de téléphones trop longue : lot ignoré.' };
  const q = demandes.map((t) => `phone:${t}`).join(' OR ');
  const n = Math.min(CLIENTS_PAR_RECHERCHE, Math.max(CLIENTS_PAR_RECHERCHE_MIN, demandes.length * 2));
  const r = await appelerGraphql(acces, { query: REQUETE_TELEPHONES, variables: { q, n } }, p.delaiMs, 'les clients', appeler, attendre, maintenant);
  if (!r.ok) return r;
  const d = schemaRecherche.safeParse(r.data);
  if (!d.success) return { ok: false, code: 'passager', message: 'Shopify n’a pas rendu la recherche des clients : réessayez dans un instant.' };
  const voulus = new Set(demandes);
  const couples = new Map<string, { telephone: string; clientId: string; etiquettes: string[] }>();
  // 🔴 Un client illisible rend la page INCOMPLÈTE : il pourrait porter un numéro demandé, et une page complète défait les
  // liens qu'elle ne rend pas.
  let illisible = false;
  for (const brut of d.data.customers.nodes) {
    const c = schemaTrouve.safeParse(brut);
    if (!c.success) { illisible = true; continue; }
    const etiquettes = etiquettesUtiles(c.data.tags).etiquettes;
    for (const telephone of numerosDuClient(c.data, p.pays)) {
      if (!voulus.has(telephone)) continue;
      const cle = `${telephone} ${c.data.legacyResourceId}`;
      if (!couples.has(cle)) couples.set(cle, { telephone, clientId: c.data.legacyResourceId, etiquettes });
    }
  }
  if (illisible) journaliser('warn', 'shopify_etiquettes_illisibles', { clients: 1, etiquettes: 0 });
  return { ok: true, trouves: [...couples.values()], complete: !d.data.customers.pageInfo.hasNextPage && !illisible, cout: r.cout };
}
