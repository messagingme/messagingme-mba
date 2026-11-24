import { z } from 'zod';
import { API_VERSION_SHOPIFY } from './connexion';
import { schemaCommande } from './donnees';
import type { CommandeLue, PageCommandes } from './reprise';
import { fetchPublic } from '../lib/connexion-publique';
import { lireCorpsBorne } from '../lib/corps-borne';
import { texteDe } from '../lib/erreur';
import { journaliser } from '../lib/journal';

/**
 * UNE PAGE DES COMMANDES D'UNE BOUTIQUE, par l'API Admin GraphQL (segments Shopify enrichis, lot 5 : le rattrapage). Les
 * commandes CRÉÉES depuis `depuis`, de la plus ancienne à la plus récente, avec leurs lignes. Seules les commandes PAYÉES
 * reviennent (payée, remboursée en tout ou partie), comme `orders/paid` ; les autres sont comptées `ecartees`.
 *
 * 🔴 CHAQUE COMMANDE EST REFORMÉE EN CORPS DU WEBHOOK, puis validée par `schemaCommande` : `telephoneDeCommande`,
 * `detailsDeCommande` et `lignesDeCommande` la lisent alors comme une commande reçue, donc le même numéro, la même
 * fiche, le même montant et les mêmes lignes. Les identifiants (GID chez GraphQL) redeviennent les numériques du webhook
 * (`legacyResourceId`, la fin du GID d'une ligne) : un GID gardé ferait une seconde commande au lieu de l'upsert.
 *
 * Le frein `THROTTLED` attend que le seau se recharge (comme l'import des clients, `./clients.ts`), dans le délai de
 * l'appel : `delaiMs` borne l'appel ENTIER, attentes comprises. Un accès refusé se dit ; une page trop lourde pour
 * Shopify (5xx, `INTERNAL_SERVER_ERROR`, `MAX_COST_EXCEEDED`) rend `trop_lourd`, que l'appelant redemande plus petite. Le
 * coût compté par Shopify revient avec la page (`cout`). Passe par `fetchPublic` (inventaire de
 * `tests/lib-adresse-privee.test.ts`).
 */

/** Les lignes lues par commande ; au-delà, la commande se dit incomplète (`lignes_tronquees`). */
export const LIGNES_PAR_COMMANDE = 50;
const CORPS_MAX = 4_000_000;
const ESSAIS_FREIN = 5;
const STATUTS_PAYES = new Set(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);

const REQUETE = `query($n: Int!, $apres: String, $q: String!) {
  orders(first: $n, after: $apres, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      legacyResourceId name processedAt test displayFinancialStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      phone
      shippingAddress { phone countryCodeV2 firstName lastName }
      billingAddress { phone countryCodeV2 firstName lastName }
      customer { legacyResourceId firstName lastName defaultPhoneNumber { phoneNumber } }
      lineItems(first: ${LIGNES_PAR_COMMANDE}) {
        pageInfo { hasNextPage }
        nodes { id title variantTitle sku quantity isGiftCard product { legacyResourceId } variant { legacyResourceId } }
      }
    }
  }
}`;

const texte = z.string().nullish();
const schemaPage = z.object({
  data: z.object({
    orders: z.object({
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullish() }),
      nodes: z.array(z.unknown()),
    }),
  }).nullish(),
  errors: z.array(z.object({ message: z.string().catch(''), extensions: z.object({ code: z.string().nullish() }).nullish() })).nullish(),
  extensions: z.object({
    cost: z.object({
      requestedQueryCost: z.number().nullish(),
      actualQueryCost: z.number().nullish(),
      throttleStatus: z.object({ currentlyAvailable: z.number(), restoreRate: z.number() }).nullish(),
    }).nullish(),
  }).nullish(),
});
// Le prénom et le nom (lot 5b) : celui de la fiche que le rattrapage crée ; illisibles, absents, jamais la commande refusée.
const adresse = z.object({ phone: texte, countryCodeV2: texte, firstName: texte.catch(null), lastName: texte.catch(null) }).nullish().catch(null);
const idLegacy = z.object({ legacyResourceId: texte }).nullish().catch(null);
const schemaNoeud = z.object({
  legacyResourceId: z.string().regex(/^\d{1,19}$/),
  name: z.string(),
  processedAt: texte.catch(null),
  test: z.boolean().nullish().catch(null),
  displayFinancialStatus: texte.catch(null),
  totalPriceSet: z.object({ shopMoney: z.object({ amount: z.string(), currencyCode: z.string() }).nullish() }).nullish().catch(null),
  phone: texte.catch(null),
  shippingAddress: adresse,
  billingAddress: adresse,
  customer: z.object({
    legacyResourceId: texte, firstName: texte.catch(null), lastName: texte.catch(null),
    defaultPhoneNumber: z.object({ phoneNumber: texte }).nullish().catch(null),
  }).nullish().catch(null),
  lineItems: z.object({ pageInfo: z.object({ hasNextPage: z.boolean() }), nodes: z.array(z.unknown()) }).nullish().catch(null),
});
const schemaLigneLue = z.object({
  id: z.string(), title: texte, variantTitle: texte, sku: texte, quantity: z.number(), isGiftCard: z.boolean().nullish(),
  product: idLegacy, variant: idLegacy,
});

/** Un identifiant numérique de Shopify, en nombre sûr ; `null` sinon. */
function numerique(v: string | null | undefined): number | null {
  if (typeof v !== 'string' || !/^\d{1,19}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** La fin numérique d'un GID de ligne (`gid://shopify/LineItem/123`) ; `null` sinon. */
function idDeLigne(gid: string): string | null {
  const m = /^gid:\/\/shopify\/LineItem\/(\d{1,19})$/.exec(gid);
  return m ? m[1]! : null;
}

/** Une commande GraphQL dans la forme du corps `orders/paid` (les seuls champs que le rattrapage lit). */
export function versCorpsWebhook(n: z.infer<typeof schemaNoeud>): unknown {
  const lignes = (n.lineItems?.nodes ?? []).flatMap((brute) => {
    const l = schemaLigneLue.safeParse(brute);
    if (!l.success) return [];
    return [{
      id: idDeLigne(l.data.id), product_id: l.data.product?.legacyResourceId ?? null, variant_id: l.data.variant?.legacyResourceId ?? null,
      sku: l.data.sku ?? null, title: l.data.title ?? null, variant_title: l.data.variantTitle ?? null, quantity: l.data.quantity,
      gift_card: l.data.isGiftCard ?? null,
    }];
  });
  const adresseRest = (a: z.infer<typeof adresse>) => (a
    ? { phone: a.phone ?? null, country_code: a.countryCodeV2 ?? null, first_name: a.firstName ?? null, last_name: a.lastName ?? null }
    : null);
  return {
    id: numerique(n.legacyResourceId),
    name: n.name.slice(0, 100),
    phone: n.phone ?? null,
    customer: n.customer
      ? {
        id: numerique(n.customer.legacyResourceId), phone: n.customer.defaultPhoneNumber?.phoneNumber ?? null,
        first_name: n.customer.firstName ?? null, last_name: n.customer.lastName ?? null,
      }
      : null,
    shipping_address: adresseRest(n.shippingAddress),
    billing_address: adresseRest(n.billingAddress),
    total_price_set: n.totalPriceSet?.shopMoney
      ? { shop_money: { amount: n.totalPriceSet.shopMoney.amount, currency_code: n.totalPriceSet.shopMoney.currencyCode } }
      : null,
    processed_at: n.processedAt ?? null,
    test: n.test ?? null,
    line_items: lignes,
  };
}

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const schemaDroits = z.object({
  data: z.object({ currentAppInstallation: z.object({ accessScopes: z.array(z.object({ handle: z.string() })) }) }).nullish(),
});
const DROITS_PASSAGER = 'Shopify n’a pas rendu les droits de l’app : réessayez dans un instant.';

/**
 * LES DROITS ACCORDÉS À L'APP DE LA BOUTIQUE (`currentAppInstallation.accessScopes`), lus avant tout rattrapage :
 * les lignes d'une commande ne portent leur produit et leur variante qu'avec `read_products` (mesuré le 2026-11-24 sur la
 * boutique d'essai, où il manquait : la requête rendait ACCESS_DENIED sur `product` et `variant`), quand le webhook, lui,
 * les porte sans ce droit.
 */
export async function lireDroitsDeLApp(
  acces: { domaine: string; jeton: string }, appeler: typeof fetch = fetchPublic,
): Promise<{ ok: true; droits: string[] } | { ok: false; code: 'acces_refuse' | 'passager'; message: string }> {
  try {
    const res = await appeler(`https://${acces.domaine}/admin/api/${API_VERSION_SHOPIFY}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-shopify-access-token': acces.jeton },
      body: JSON.stringify({ query: '{ currentAppInstallation { accessScopes { handle } } }' }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: 'acces_refuse', message: `Shopify refuse l’app de la boutique (statut ${res.status}) : réinstallez-la sur la boutique.` };
    }
    const corps = await lireCorpsBorne(res, 100_000);
    if (corps.trop_gros || corps.casse || res.status !== 200) return { ok: false, code: 'passager', message: DROITS_PASSAGER };
    const lu = schemaDroits.safeParse(JSON.parse(corps.texte));
    if (!lu.success || !lu.data.data) return { ok: false, code: 'passager', message: DROITS_PASSAGER };
    return { ok: true, droits: lu.data.data.currentAppInstallation.accessScopes.map((s) => s.handle) };
  } catch {
    return { ok: false, code: 'passager', message: DROITS_PASSAGER };
  }
}

export async function lirePageCommandes(
  acces: { domaine: string; jeton: string },
  p: { depuis: Date; apres: string | null; parPage: number; delaiMs: number },
  /** `fetchPublic`, une vraie attente et la vraie heure en production ; injectables pour éprouver la lecture. */
  appeler: typeof fetch = fetchPublic,
  attendre: (ms: number) => Promise<void> = pause,
  maintenant: () => number = Date.now,
): Promise<PageCommandes> {
  const q = `created_at:>=${p.depuis.toISOString().slice(0, 10)}`;
  const fin = maintenant() + p.delaiMs;
  for (let freins = 0; ; freins += 1) {
    const reste = fin - maintenant();
    if (reste <= 0) return { ok: false, code: 'passager', message: 'Shopify n’a pas rendu la page de commandes à temps : réessayez dans un instant.' };
    let page: z.infer<typeof schemaPage>;
    let statut: number;
    try {
      const res = await appeler(`https://${acces.domaine}/admin/api/${API_VERSION_SHOPIFY}/graphql.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-shopify-access-token': acces.jeton },
        body: JSON.stringify({ query: REQUETE, variables: { n: p.parPage, apres: p.apres, q } }),
        redirect: 'manual',
        signal: AbortSignal.timeout(reste),
      });
      statut = res.status;
      if (statut === 401 || statut === 403) {
        return { ok: false, code: 'acces_refuse', message: `Shopify refuse la lecture des commandes (statut ${statut}) : l’app doit avoir les droits read_orders et read_products.` };
      }
      if (statut >= 500) return { ok: false, code: 'trop_lourd', message: `Shopify n’a pas rendu la page de commandes (statut ${statut}).` };
      const corps = await lireCorpsBorne(res, CORPS_MAX);
      if (corps.trop_gros) return { ok: false, code: 'trop_lourd', message: 'Shopify a rendu une page de commandes trop lourde.' };
      if (corps.casse) return { ok: false, code: 'passager', message: 'Shopify a rendu une page de commandes illisible : réessayez dans un instant.' };
      const lu = schemaPage.safeParse(JSON.parse(corps.texte));
      if (statut !== 200 || !lu.success) {
        return { ok: false, code: 'passager', message: `Shopify n’a pas rendu la liste des commandes (statut ${statut}) : réessayez dans un instant.` };
      }
      page = lu.data;
    } catch (err) {
      return { ok: false, code: 'passager', message: `Shopify n’a pas répondu (${texteDe(err)}) : réessayez dans un instant.` };
    }

    const codes = (page.errors ?? []).map((e) => e.extensions?.code ?? '');
    if (codes.includes('THROTTLED')) {
      const seau = page.extensions?.cost?.throttleStatus;
      const cout = page.extensions?.cost?.requestedQueryCost ?? 0;
      const attenteMs = seau && seau.restoreRate > 0 ? Math.ceil(Math.max(0, cout - seau.currentlyAvailable) / seau.restoreRate) * 1000 : 1000;
      const attente = Math.max(1000, attenteMs);
      if (freins >= ESSAIS_FREIN || maintenant() + attente >= fin) return { ok: false, code: 'passager', message: 'Shopify freine la lecture des commandes : réessayez dans une minute.' };
      await attendre(attente);
      continue;
    }
    if (codes.length > 0) {
      // Le message de Shopify dit le champ et le droit qui manquent : il est rendu tel quel, jamais deviné.
      const refus = (page.errors ?? []).find((e) => e.extensions?.code === 'ACCESS_DENIED' || /access denied/i.test(e.message));
      if (refus) return { ok: false, code: 'acces_refuse', message: `Shopify refuse la lecture des commandes (${refus.message.slice(0, 300)}).` };
      if (codes.includes('MAX_COST_EXCEEDED') || codes.includes('INTERNAL_SERVER_ERROR')) {
        return { ok: false, code: 'trop_lourd', message: `Shopify trouve la page de commandes trop lourde (${codes.join(', ')}).` };
      }
      return { ok: false, code: 'passager', message: `Shopify refuse la requête des commandes (${(page.errors ?? [])[0]?.message.slice(0, 200) ?? 'erreur'}).` };
    }
    if (!page.data) return { ok: false, code: 'passager', message: 'Shopify n’a pas rendu la liste des commandes : réessayez dans un instant.' };

    const commandes: CommandeLue[] = [];
    let ecartees = 0;
    for (const brut of page.data.orders.nodes) {
      const n = schemaNoeud.safeParse(brut);
      const corps = n.success && STATUTS_PAYES.has(n.data.displayFinancialStatus ?? '') ? schemaCommande.safeParse(versCorpsWebhook(n.data)) : null;
      if (!corps?.success) {
        ecartees += 1;
        if (n.success && corps && !corps.success) journaliser('warn', 'shopify_reprise_commande_illisible', { erreur: corps.error.issues[0]?.message ?? 'invalide' });
        continue;
      }
      commandes.push({ corps: corps.data, lignesTronquees: n.success && n.data.lineItems?.pageInfo.hasNextPage === true });
    }
    const { hasNextPage, endCursor } = page.data.orders.pageInfo;
    const cout = { demande: page.extensions?.cost?.requestedQueryCost ?? null, reel: page.extensions?.cost?.actualQueryCost ?? null };
    return { ok: true, commandes, ecartees, suivant: hasNextPage && endCursor ? endCursor : null, cout };
  }
}
