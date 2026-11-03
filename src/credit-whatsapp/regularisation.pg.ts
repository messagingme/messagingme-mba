import type { Pool } from 'pg';
import { regulariserWhatsapp, verrouRegularisation } from './credit.pg';
import type { EspaceARegulariser, JourDeParis, NosDemiHeures, RegularisationAEcrire } from './regularisation';

/**
 * Le magasin de la régularisation sur les volumes de Meta (migration 0274, `credit_whatsapp_regularisations` ; lot E du
 * plan `2026-11-03-credit-whatsapp-fiabilite.md`). Les jours se calculent en base, au fuseau de Paris, comme l'historique
 * du client et le mois à facturer ; les demi-heures en secondes Unix, comme `pricing_analytics`.
 */
export class PgRegularisationStore {
  constructor(private readonly pool: Pool) {}

  /**
   * La veille et l'avant-veille de Paris, la veille d'abord, avec leurs bornes en secondes Unix (UTC), chacune seulement si
   * elle a fini depuis au moins `margeS` secondes (`MARGE_FRAICHEUR_S` : ses volumes sont alors complets chez Meta).
   */
  async joursClos(margeS: number): Promise<JourDeParis[]> {
    const { rows } = await this.pool.query<{ jour: string; debut: string; fin: string }>(
      `select j::text as jour,
              extract(epoch from (j::timestamp at time zone 'Europe/Paris'))::bigint as debut,
              extract(epoch from ((j + 1)::timestamp at time zone 'Europe/Paris'))::bigint as fin
         from (select (now() at time zone 'Europe/Paris')::date - k as j from generate_series(1, 2) k) s
        where ((j + 1)::timestamp at time zone 'Europe/Paris') <= now() - make_interval(secs => $1)
        order by j desc`,
      [margeS],
    );
    return rows.map((r) => ({ jour: r.jour, debutS: Number(r.debut), finS: Number(r.fin) }));
  }

  /**
   * Les espaces qu'une ligne couvrait au moins un instant depuis `depuisS` (en cours, ou retirée après), chacun avec les
   * comptes WhatsApp de ses lignes et leurs périodes : une ligne couvre tout son compte (`PgLignesCreditStore`).
   */
  async espacesARegulariser(depuisS: number): Promise<EspaceARegulariser[]> {
    const { rows } = await this.pool.query<{ tenant_id: string; nom: string; waba_id: string; depuis: Date; retiree_le: Date | null }>(
      `select l.tenant_id, t.name as nom, l.waba_id, l.depuis, l.retiree_le
         from lignes_credit_whatsapp l join tenants t on t.id = l.tenant_id
        where l.waba_id is not null and (l.retiree_le is null or l.retiree_le > to_timestamp($1))
        order by l.tenant_id, l.waba_id, l.depuis`,
      [depuisS],
    );
    const espaces = new Map<string, EspaceARegulariser>();
    for (const r of rows) {
      const e = espaces.get(r.tenant_id) ?? { tenantId: r.tenant_id, nom: r.nom, comptes: [] };
      let compte = e.comptes.find((c) => c.wabaId === r.waba_id);
      if (compte === undefined) {
        compte = { wabaId: r.waba_id, couvertures: [] };
        e.comptes.push(compte);
      }
      compte.couvertures.push({ depuis: r.depuis, jusqua: r.retiree_le });
      espaces.set(r.tenant_id, e);
    }
    return [...espaces.values()];
  }

  /**
   * Nos provisions non rendues de l'espace sur `[debutS, finS)`, par demi-heure de leur livraison (Meta facture à la
   * livraison), à défaut de leur création. La borne sur la création (31 jours avant, la fin de vie d'un message chez Meta)
   * garde la lecture sur l'index de l'espace.
   */
  async nosDemiHeures(tenantId: string, debutS: number, finS: number): Promise<NosDemiHeures[]> {
    const { rows } = await this.pool.query<{ debut: string; montant: string; messages: string; livres: string }>(
      `select (floor(extract(epoch from coalesce(livre_le, cree_le)) / 1800) * 1800)::bigint as debut,
              sum(montant_micro_eur) as montant, count(*) as messages, count(livre_le) as livres
         from credit_whatsapp_provisions
        where tenant_id = $1 and etat <> 'rendu'
          and cree_le >= to_timestamp($2) - interval '31 days'
          and coalesce(livre_le, cree_le) >= to_timestamp($2) and coalesce(livre_le, cree_le) < to_timestamp($3)
        group by 1`,
      [tenantId, debutS, finS],
    );
    return rows.map((r) => ({
      debut: Number(r.debut), montantMicroEur: Number(r.montant), messages: Number(r.messages), livres: Number(r.livres),
    }));
  }

  /**
   * Écrit, ou REMPLACE, la régularisation d'un jour, dans une transaction sous le verrou de l'espace et du jour. Un
   * prépayé reçoit le mouvement `regularisation` du jour (la valeur opposée de l'écart : Meta a facturé plus, on débite),
   * et le solde bouge de la différence avec l'ancien ; une Entreprise n'en a aucun (un mouvement d'avant, du temps où
   * l'espace prépayait, est ramené à zéro). Rend si l'alerte de ce jour est déjà partie, et le solde après l'écriture.
   */
  async enregistrer(r: RegularisationAEcrire): Promise<{ alerteDejaPartie: boolean; soldeMicroEur: number }> {
    const c = r.calcul;
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await verrouRegularisation(client, r.tenantId, r.jour);
      const { rows } = await client.query<{ alerte_le: Date | null }>(
        `insert into credit_whatsapp_regularisations
           (tenant_id, jour, meta_micro_eur, nous_micro_eur, ecart_micro_eur, illimite, detail)
         values ($1, $2::date, $3, $4, $5, $6, $7::jsonb)
         on conflict (tenant_id, jour) do update set
           meta_micro_eur = excluded.meta_micro_eur, nous_micro_eur = excluded.nous_micro_eur,
           ecart_micro_eur = excluded.ecart_micro_eur, illimite = excluded.illimite, detail = excluded.detail, calcule_le = now()
         returning alerte_le`,
        [
          r.tenantId, r.jour, Math.round(c.metaMicroEur), Math.round(c.nousMicroEur), Math.round(c.ecartMicroEur), r.illimite,
          JSON.stringify({ meta: c.detail, messagesMeta: c.messagesMeta, messagesNous: c.messagesNous, demiHeures: c.demiHeures }),
        ],
      );
      await regulariserWhatsapp(client, r.tenantId, r.jour, r.illimite ? 0 : -Math.round(c.ecartMicroEur));
      const solde = await client.query<{ solde: string | null }>(
        'select solde_micro_eur as solde from credits_whatsapp where tenant_id = $1',
        [r.tenantId],
      );
      await client.query('commit');
      return { alerteDejaPartie: rows[0]?.alerte_le != null, soldeMicroEur: Number(solde.rows[0]?.solde ?? 0) };
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** L'alerte « envois hors Messaging Me » de ce jour est partie : la passe suivante ne la renvoie pas. */
  async marquerAlerte(tenantId: string, jour: string): Promise<void> {
    await this.pool.query(
      'update credit_whatsapp_regularisations set alerte_le = now() where tenant_id = $1 and jour = $2::date',
      [tenantId, jour],
    );
  }
}
