/**
 * LES PLACES DE L'OPTION DU CRÉDIT WHATSAPP (lot 4a, décision de Julien du 2026-11-03 : une place est un NUMÉRO). Une ligne
 * `'option'` couvre tout le compte WhatsApp de son numéro (Meta attache la ligne au compte), mais seuls autant de ses
 * numéros que l'espace a de places payées envoient : les numéros couverts se rangent (le numéro d'une ligne d'abord, puis
 * par ancienneté dans l'espace, `numerosCouvertsParOption`) et ceux au-delà des places sont refusés, sans provision.
 *
 * Lu avant chaque envoi d'un numéro d'une ligne `'option'` : gardé cinq secondes par espace, comme la ligne d'un numéro.
 * Une Entreprise (illimitée) et une ligne posée par `/ops` (un essai forcé) n'y passent pas : la garde ne le demande pas.
 */
const CACHE_MS = 5_000;

export interface DepsPlacesOption {
  /** Les places payées de l'option vivante (`PgOptionsCreditStore.placesPayees`), 0 sans option. */
  placesPayees(tenantId: string): Promise<number>;
  /** Les numéros couverts par les lignes `'option'`, rangés (`PgLignesCreditStore.numerosCouvertsParOption`). */
  numerosCouvertsParOption(tenantId: string): Promise<string[]>;
  maintenant?: () => number;
}

export interface PlacesOption {
  /** Le numéro tient-il dans les places payées de l'espace ? */
  couvre(tenantId: string, phoneNumberId: string): Promise<boolean>;
}

export function creerPlacesOption(d: DepsPlacesOption): PlacesOption {
  const maintenant = d.maintenant ?? (() => Date.now());
  const cache = new Map<string, { lue: number; places: number; ordre: string[] }>();
  return {
    async couvre(tenantId, phoneNumberId) {
      const t = maintenant();
      let c = cache.get(tenantId);
      if (c === undefined || t - c.lue >= CACHE_MS) {
        const [places, ordre] = await Promise.all([d.placesPayees(tenantId), d.numerosCouvertsParOption(tenantId)]);
        c = { lue: t, places, ordre };
        cache.set(tenantId, c);
      }
      const rang = c.ordre.indexOf(phoneNumberId);
      return rang >= 0 && rang < c.places;
    },
  };
}
