import type { Pool } from 'pg';

/**
 * LA GARDE DU CRITÈRE D'ÉTIQUETTE SHOPIFY (segments Shopify enrichis, lot 6b, migration 0319), et ce qu'elle partage avec le
 * magasin des étiquettes (`./etiquettes.pg.ts`) : ce qu'est une synchronisation vivante. Un module à part, sans autre
 * dépendance : `PgContactStore` l'importe, et le magasin des étiquettes importe `PgContactStore` (la définition d'une fiche
 * active), un cycle d'imports sinon.
 */

/** Une synchronisation sans progrès depuis ce délai, bail mort, est perdue (job tué, file en panne) : une nouvelle peut partir. */
export const SYNCHRO_PERIMEE_MINUTES = 15;

export type IssueSynchro = 'lue' | 'sans_droit' | 'refusee' | 'erreur';

/**
 * Une synchronisation vivante : commencée, et un bail qui court ou un progrès récent. Le même texte partout (la garde du
 * critère, `demander`, `dues`).
 *
 * 🔴 TOUJOURS VRAI OU FAUX, JAMAIS NUL : chaque comparaison passe par `coalesce(..., false)`. Toute panne rend le bail
 * (`relacher` le met à nul) ; sans `coalesce`, une synchronisation périmée au bail nul valait NULL, `not NULL` aussi, et
 * `demander` comme `dues` ne la relançaient plus jamais : le critère restait refusé, la Free recevait un 429 sans fin.
 */
export const synchroVivante = (alias: string): string =>
  `(${alias}.en_cours_depuis is not null and (coalesce(${alias}.maj_le >= now() - make_interval(mins => ${SYNCHRO_PERIMEE_MINUTES}), false) `
  + `or coalesce(${alias}.bail_jusqua > now(), false)))`;

/** Le nom du critère dans la phrase d'un refus, celui de la validation (`src/crm/contact-filters.ts`). */
const CRITERE = 'filtre « étiquette Shopify »';

/** Aucune synchronisation n'a abouti : le critère est refusé, jamais « personne ». */
export const REFUS_SANS_SYNCHRO = `${CRITERE} : les étiquettes de vos clients Shopify n’ont pas encore été lues. Allumez `
  + '« Synchroniser les étiquettes » sur la carte Shopify (Intégrations), ou sync_shopify_customer_tags depuis Claude, puis '
  + 'réessayez quand la synchronisation a abouti.';
/** La première synchronisation tourne : réessayer dans quelques minutes. */
export const REFUS_SYNCHRO_EN_COURS = `${CRITERE} : la première synchronisation des étiquettes Shopify est en cours. `
  + 'Réessayez dans quelques minutes.';
/** La dernière synchronisation a échoué, sans qu'aucune n'ait abouti avant : la phrase dit pourquoi. */
export const refusSynchroEchouee = (raison: string): string => `${CRITERE} : la synchronisation des étiquettes Shopify a échoué `
  + `(${raison}). Relancez-la depuis la carte Shopify (Intégrations), ou sync_shopify_customer_tags depuis Claude.`;

/**
 * 🔴 LA GARDE DU CRITÈRE D'ÉTIQUETTE SHOPIFY, partagée par toutes les lectures par filtres (`PgContactStore`) : la phrase du
 * refus, ou `null`. Refusé tant qu'aucune synchronisation des étiquettes n'a abouti pour l'espace : jamais « personne », qui
 * serait une campagne vide prise pour une vérité. Une fois une synchronisation aboutie, le critère s'applique, même à une
 * étiquette que personne ne porte (plan, règle 4) : la date de la synchronisation est dans la réponse. Aucune étiquette
 * visée, aucune requête.
 */
export async function refusDesEtiquettesShopify(pool: Pool, tenantId: string, etiquettes: readonly string[]): Promise<string | null> {
  if (etiquettes.length === 0) return null;
  const res = await pool.query<{ synchro_le: Date | null; vivante: boolean; issue: IssueSynchro | null; message: string | null }>(
    `select e.synchro_le, ${synchroVivante('e')} as vivante, e.issue, e.message from shopify_etiquettes_synchro e where e.tenant_id = $1`,
    [tenantId],
  );
  const e = res.rows[0];
  if (e?.synchro_le) return null;
  if (e?.vivante) return REFUS_SYNCHRO_EN_COURS;
  if (e?.issue && e.issue !== 'lue') return refusSynchroEchouee(e.message ?? e.issue);
  return REFUS_SANS_SYNCHRO;
}
