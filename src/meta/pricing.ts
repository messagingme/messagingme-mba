import type { FetchLike } from './templates';

/** Prix agrégé pour une catégorie (sur les lignes facturées REGULAR). */
export interface CategoryPricing {
  category: string; // lowercase : marketing | utility | authentication | service | ...
  cost: number; // charges approximatives (devise du WABA)
  volume: number; // messages facturés
  ratePerMessage: number; // cost / volume (0 si volume nul)
}

export interface PricingSummary {
  /** Clé = catégorie en minuscule. */
  byCategory: Record<string, CategoryPricing>;
  /** Somme des coûts facturés sur la période. */
  totalCost: number;
  /**
   * Devise du WABA (ISO 4217, ex. 'EUR'), rendue par Meta sur le même appel. `null` si absente : on affiche
   * alors le nombre nu, une devise supposée serait pire que pas de devise.
   */
  currency: string | null;
}

/**
 * Lit `pricing_analytics` (Graph API, niveau WABA) : le coût réel approximatif par catégorie, dans la devise du
 * WABA, sans table de tarifs à maintenir. Seules les lignes facturées (REGULAR) dérivent un tarif par message,
 * les FREE_* ont un coût nul. Tout échec rend `null` : le tableau de bord affiche le volume seul, jamais un faux prix.
 */
export class MetaPricingClient {
  constructor(
    private readonly token: string,
    private readonly version = 'v23.0',
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = 'https://graph.facebook.com',
  ) {}

  /** startTs/endTs en secondes Unix. */
  async getPricingAnalytics(wabaId: string, startTs: number, endTs: number): Promise<PricingSummary | null> {
    const field =
      `pricing_analytics.start(${startTs}).end(${endTs}).granularity(DAILY)` +
      `.metric_types(["COST","VOLUME"]).dimensions(["PRICING_CATEGORY","PRICING_TYPE"])`;
    // `currency` part sur le même appel : la devise est un champ du WABA.
    const url = `${this.baseUrl}/${this.version}/${wabaId}?fields=${encodeURIComponent(`currency,${field}`)}`;
    try {
      const res = await this.fetchImpl(url, { method: 'GET', headers: { authorization: `Bearer ${this.token}` } });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as unknown;
      return parsePricing(json);
    } catch {
      return null;
    }
  }

  /**
   * Les VOLUMES d'un compte par demi-heure (la régularisation du Crédit WhatsApp, lot E) : par numéro, pays, catégorie,
   * type et palier. Le coût n'est pas demandé : Meta le refuse sur un compte client (code 10, mesuré le 2026-11-03).
   * `null` sur tout échec ou toute réponse inattendue : la régularisation attend au lieu de comparer à une lecture vide.
   */
  async volumesDemiHeure(wabaId: string, debutS: number, finS: number): Promise<PointVolumeBrut[] | null> {
    const field = `pricing_analytics.start(${debutS}).end(${finS}).granularity(HALF_HOUR)`
      + '.metric_types(["VOLUME"]).dimensions(["PHONE","COUNTRY","PRICING_CATEGORY","PRICING_TYPE","TIER"])';
    const url = `${this.baseUrl}/${this.version}/${wabaId}?fields=${encodeURIComponent(field)}`;
    try {
      const res = await this.fetchImpl(url, { method: 'GET', headers: { authorization: `Bearer ${this.token}` } });
      if (!res.ok) return null;
      return lirePointsVolume((await res.json().catch(() => null)) as unknown);
    } catch {
      return null;
    }
  }
}

/**
 * Un point de volume par demi-heure (`MetaPricingClient.volumesDemiHeure`) : la forme mesurée le 2026-11-03 sur notre
 * compte et sur un compte client (`start` et `end` en secondes Unix, `phone_number` en chiffres, `tier` « 0:100000 »).
 */
export interface PointVolumeBrut {
  debut: number;
  numero: string | null;
  pays: string | null;
  categorie: string | null;
  type: string;
  palier: string | null;
  volume: number;
}

/** Les points de volume d'une réponse Graph ; `null` si sa forme n'est pas celle attendue (rien n'est deviné). */
export function lirePointsVolume(json: unknown): PointVolumeBrut[] | null {
  if (typeof json !== 'object' || json === null || typeof (json as { id?: unknown }).id !== 'string') return null;
  const analytics = (json as { pricing_analytics?: { data?: Array<{ data_points?: unknown }> } }).pricing_analytics;
  // Un compte sans aucun envoi sur la période rend `{ "id": ... }` seul, sans `pricing_analytics` (mesuré le 2026-11-03
  // sur deux comptes calmes) : zéro point, pas une erreur.
  if (analytics === undefined) return [];
  // Une réponse paginée ou en plusieurs séries n'a jamais été vue : refusée plutôt que lue à moitié (relecture du lot E).
  if ((analytics as { paging?: { next?: unknown } }).paging?.next !== undefined) return null;
  if (Array.isArray(analytics?.data) && analytics.data.length > 1) return null;
  const points = analytics?.data?.[0]?.data_points ?? (Array.isArray(analytics?.data) && analytics.data.length === 0 ? [] : undefined);
  if (!Array.isArray(points)) return null;
  const texte = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  const lus: PointVolumeBrut[] = [];
  for (const raw of points) {
    const p = raw as { start?: unknown; end?: unknown; phone_number?: unknown; country?: unknown; pricing_category?: unknown; pricing_type?: unknown; tier?: unknown; volume?: unknown };
    const debut = Number(p.start);
    const volume = Number(p.volume);
    const type = texte(p.pricing_type);
    if (!Number.isInteger(debut) || !Number.isFinite(volume) || volume < 0 || type === null) return null;
    // Une demi-heure, rien d'autre : un point d'une autre durée (un jour) serait rangé dans la mauvaise demi-heure.
    if (Number(p.end) - debut !== 1800) return null;
    lus.push({ debut, numero: texte(p.phone_number), pays: texte(p.country), categorie: texte(p.pricing_category), type, palier: texte(p.tier), volume });
  }
  return lus;
}

/** Parse la réponse Graph { currency, pricing_analytics: { data: [ { data_points: [...] } ] } }. */
export function parsePricing(json: unknown): PricingSummary | null {
  const racine = json as { currency?: unknown; pricing_analytics?: { data?: Array<{ data_points?: unknown }> } } | null;
  const points = racine?.pricing_analytics?.data?.[0]?.data_points;
  if (!Array.isArray(points)) return null;
  // ISO 4217 seulement : la valeur part dans `Intl.NumberFormat`, qui lève sur un code invalide, et une donnée
  // externe ne doit pas faire tomber l'écran qui l'affiche.
  const currency = typeof racine?.currency === 'string' && /^[A-Za-z]{3}$/.test(racine.currency)
    ? racine.currency.toUpperCase()
    : null;

  const byCategory: Record<string, CategoryPricing> = {};
  let totalCost = 0;
  let facturesSansCout = 0;
  let facturesAvecCout = 0;
  for (const raw of points) {
    const p = raw as { pricing_type?: unknown; pricing_category?: unknown; cost?: unknown; volume?: unknown };
    const lue = typeof p.pricing_category === 'string' ? p.pricing_category.toLowerCase() : '';
    // Un envoi par la Marketing Messages API remonte en MARKETING_LITE, au même prix que le marketing de la Cloud API :
    // compté à part, il laisserait les écrans de coût sans tarif marketing (`byCategory['marketing']`).
    const category = lue === 'marketing_lite' ? 'marketing' : lue;
    if (!category) continue;
    // Seul le facturé (REGULAR) dérive un tarif effectif ; les FREE_* ont cost 0.
    if (p.pricing_type !== 'REGULAR') continue;
    if (typeof p.cost === 'number' || typeof p.cost === 'string') facturesAvecCout += 1; else facturesSansCout += 1;
    const cost = Number(p.cost) || 0;
    const volume = Number(p.volume) || 0;
    const acc = byCategory[category] ?? { category, cost: 0, volume: 0, ratePerMessage: 0 };
    acc.cost += cost;
    acc.volume += volume;
    byCategory[category] = acc;
    totalCost += cost;
  }
  // 🔴 Un coût ABSENT n'est pas un coût nul : Meta ne rend pas le COST d'un compte payé par la ligne de crédit d'un
  // partenaire (le VOLUME seul). Sans AUCUN coût facturé, le résumé est inconnu, comme un échec : l'écran montre le volume
  // seul, jamais « 0 € » ni « gratuit ». Un compte qui reçoit des coûts garde la lecture d'avant, point par point.
  if (facturesSansCout > 0 && facturesAvecCout === 0) return null;
  for (const c of Object.values(byCategory)) {
    c.ratePerMessage = c.volume > 0 ? c.cost / c.volume : 0;
  }
  return { byCategory, totalCost, currency };
}
