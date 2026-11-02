import type { Pool } from 'pg';
import { MATCH_BY_WAID_SQL } from '../crm/contact-store.pg';

/**
 * LES PIÈCES REÇUES PAR UN BLOC QUESTION (migration 0269, spec du 2026-11-02) : quel message de Meta se cache derrière
 * la mention écrite dans un champ. Une ligne par contact et par champ ; une nouvelle pièce sur le même champ remplace la
 * précédente. Le contact se résout par son numéro DANS l'espace, exactement comme l'écriture du champ
 * (`mergeFieldsByPhone`, `MATCH_BY_WAID_SQL`) : la pièce et la mention désignent toujours la même fiche.
 */
export interface PieceNotee {
  cle: string;
  metaMessageId: string;
  mention: string;
}

export class PgPiecesQuestion {
  constructor(private readonly pool: Pool) {}

  /** Note la pièce rangée dans le champ `cle`. Un numéro inconnu de l'espace n'écrit rien. Rejouée, elle ne double rien. */
  async noter(tenantId: string, waId: string, cle: string, metaMessageId: string, mention: string): Promise<void> {
    await this.pool.query(
      `insert into pieces_question (tenant_id, contact_id, cle_champ, meta_message_id, mention)
       select $1, c.id, $3, $4, $5 from (
         select id from contacts where tenant_id = $1
         ${MATCH_BY_WAID_SQL}
       ) c
       on conflict (tenant_id, contact_id, cle_champ)
         do update set meta_message_id = excluded.meta_message_id, mention = excluded.mention, cree_le = now()`,
      [tenantId, waId, cle, metaMessageId, mention],
    );
  }

  /**
   * Les pièces notées pour ce contact, champ par champ. Le lien ne se fabrique qu'en comparant chaque mention à la
   * valeur ACTUELLE du champ : cette lecture ne décide rien seule.
   */
  async liensPossibles(tenantId: string, waId: string): Promise<PieceNotee[]> {
    const res = await this.pool.query<{ cle_champ: string; meta_message_id: string; mention: string }>(
      `select p.cle_champ, p.meta_message_id, p.mention
         from pieces_question p
        where p.tenant_id = $1 and p.contact_id = (
          select id from contacts where tenant_id = $1
          ${MATCH_BY_WAID_SQL}
        )`,
      [tenantId, waId],
    );
    return res.rows.map((r) => ({ cle: r.cle_champ, metaMessageId: r.meta_message_id, mention: r.mention }));
  }
}
