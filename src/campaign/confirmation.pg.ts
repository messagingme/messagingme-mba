import type { Pool } from 'pg';
import { DUREE_CODE_MS, empreinteCode, nouveauCode, type ConfirmationStore } from './confirmation';

/**
 * Les codes de confirmation des campagnes préparées par l'assistant (`campagne_confirmations`, migration 0245).
 * 🔴 `tenant_id = $n` sur chaque requête : le pooler contourne la RLS, ce filtre est le seul contrôle d'isolation.
 * L'expiration se compte sur l'horloge de la BASE, aux deux bouts : une copie de l'API à l'heure fausse ne prolonge
 * ni n'abrège un code.
 */
export class PgConfirmations implements ConfirmationStore {
  constructor(private readonly pool: Pool) {}

  async poser(tenantId: string, campaignId: string, etat: string): Promise<{ code: string; expireLe: Date } | null> {
    const code = nouveauCode();
    // La ligne n'est créée que pour une campagne de l'espace : un identifiant d'ailleurs ne reçoit rien.
    const res = await this.pool.query<{ expire_le: Date }>(
      `insert into campagne_confirmations (campaign_id, tenant_id, code_empreinte, etat_empreinte, expire_le)
       select c.id, c.tenant_id, $3, $4, now() + make_interval(secs => $5)
       from campaigns c where c.id = $1 and c.tenant_id = $2
       on conflict (campaign_id) do update
         set code_empreinte = excluded.code_empreinte, etat_empreinte = excluded.etat_empreinte,
             expire_le = excluded.expire_le, utilise_le = null, cree_le = now()
         where campagne_confirmations.tenant_id = excluded.tenant_id
       returning expire_le`,
      [campaignId, tenantId, empreinteCode(code), etat, DUREE_CODE_MS / 1000],
    );
    const r = res.rows[0];
    return r ? { code, expireLe: r.expire_le } : null;
  }

  async existe(tenantId: string, campaignId: string): Promise<boolean> {
    const res = await this.pool.query(
      `select 1 from campagne_confirmations where campaign_id = $1 and tenant_id = $2`,
      [campaignId, tenantId],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
