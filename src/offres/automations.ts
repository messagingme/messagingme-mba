import type { Pool } from 'pg';
import { LimiteOffreError } from './refus';

/**
 * LA POPULATION QUE COMPTE LA LIMITE D'AUTOMATIONS DE L'OFFRE : les automations ALLUMÉES du client, celles qu'aucun lien de
 * chaîne, aucune publicité, aucun widget ne possède (`possede_par` vide), du rayon général. Celles des webhooks entrants
 * comptent : c'est précisément l'usage de la Base (un déclencheur de chez le client qui envoie un modèle). Les lignes
 * HubSpot (rayon `hubspot`, menu « Scénario », lot 6) ne comptent pas : elles ont leur plafond par ligne (décision 36).
 *
 * Un seul texte, lu par la garde (`verifierPlaceAutomation`), le gel au retour en Base (`PgAutomationStore.plusAnciennes`)
 * et l'usage affiché (`PgOffresStore.usage`) : trois copies finiraient par compter trois populations. `alias` : celui de la
 * table dans la requête, ou rien.
 */
export function automationComptee(alias?: string): string {
  const a = alias === undefined ? '' : `${alias}.`;
  return `${a}enabled and ${a}possede_par is null and ${a}rayon = 'general'`;
}

/**
 * LA LIMITE D'AUTOMATIONS DE L'OFFRE (lot 6 des offres, spec § 4), sur la population de `automationComptee`. Vérifiée à la
 * création d'une automation allumée et au rallumage, par les deux magasins qui en écrivent (`PgAutomationStore`,
 * `PgWebhookStore`).
 *
 * ⚠️ Lecture puis écriture, sans verrou : deux allumages simultanés à la dernière place peuvent passer tous les deux. Une
 * limite commerciale tolère ce dépassement.
 */
export async function verifierPlaceAutomation(
  q: Pick<Pool, 'query'>,
  tenantId: string,
  limite: number | null,
  /** L'automation qu'on rallume : elle ne se compte pas elle-même. */
  exclure: string | null,
): Promise<void> {
  if (limite === null) return;
  const r = await q.query<{ n: number }>(
    `select count(*)::int as n from automations
      where tenant_id = $1 and ${automationComptee()} and ($2::uuid is null or id <> $2::uuid)`,
    [tenantId, exclure],
  );
  if ((r.rows[0]?.n ?? 0) >= limite) throw new LimiteOffreError(tenantId, 'automations', limite);
}
