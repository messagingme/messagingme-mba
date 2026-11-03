import type { Pool } from 'pg';
import { regulariserWhatsapp, verrouRegularisation } from './credit.pg';
import type { ConditionsDuJour, EcritureRegularisation, EspaceARegulariser, JourDeParis, NosDemiHeures, RegularisationAEcrire } from './regularisation';

/**
 * La demi-heure (secondes Unix) d'une provision pour la régularisation : celle de sa livraison (Meta facture à la
 * livraison), à défaut de sa création...
 */
const TRANCHE_BRUTE = '(floor(extract(epoch from coalesce(livre_le, cree_le)) / 1800) * 1800)::bigint';
/**
 * ... sauf si une régularisation l'a déjà comptée (migration 0275) : elle reste dans la demi-heure où elle l'a été, pour
 * toujours. Une livraison connue plus tard ne la fait plus changer de jour : la veille l'avait rendue, faute de facture
 * de Meta, et le jour de sa livraison la compterait encore face à la facture, au détriment de Messaging Me.
 */
const TRANCHE = `coalesce(tranche_regularisee, ${TRANCHE_BRUTE})`;

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
   * Nos provisions non rendues de l'espace sur `[debutS, finS)`, par demi-heure (`TRANCHE`). La borne sur la création
   * (31 jours avant, la fin de vie d'un message chez Meta) garde la lecture sur l'index de l'espace ; `enregistrer` la
   * reprend telle quelle (`lectureDepuisS`) pour relire exactement les mêmes.
   */
  async nosDemiHeures(tenantId: string, debutS: number, finS: number): Promise<NosDemiHeures[]> {
    const { rows } = await this.pool.query<{ debut: string; montant: string; messages: string; livres: string }>(
      `select ${TRANCHE} as debut, sum(montant_micro_eur) as montant, count(*) as messages, count(livre_le) as livres
         from credit_whatsapp_provisions
        where tenant_id = $1 and etat <> 'rendu'
          and cree_le >= to_timestamp($2) - interval '31 days'
          and ${TRANCHE} >= $2 and ${TRANCHE} < $3
        group by 1`,
      [tenantId, debutS, finS],
    );
    return rows.map((r) => ({
      debut: Number(r.debut), montantMicroEur: Number(r.montant), messages: Number(r.messages), livres: Number(r.livres),
    }));
  }

  /**
   * Les conditions sous lesquelles la plupart des provisions du jour ont été chiffrées (illimitée ou non, et la
   * commission), rendues comprises : la régularisation chiffre les volumes de Meta du jour avec elles, pas avec celles du
   * moment où elle tourne (une Entreprise d'aujourd'hui qui prépayait hier règle hier sur son solde). `null` quand aucune
   * provision du jour ne les porte (avant la 0275, ou aucun envoi par Messaging Me) : la passe prend celles du moment.
   */
  async conditionsDuJour(tenantId: string, debutS: number, finS: number): Promise<ConditionsDuJour | null> {
    const { rows } = await this.pool.query<{ illimite: boolean; commission_pct: number }>(
      `select illimite, commission_pct
         from credit_whatsapp_provisions
        where tenant_id = $1 and commission_pct is not null
          and cree_le >= to_timestamp($2) - interval '31 days'
          and ${TRANCHE} >= $2 and ${TRANCHE} < $3
        group by illimite, commission_pct
        order by count(*) desc, sum(montant_micro_eur) desc, illimite desc, commission_pct desc
        limit 1`,
      [tenantId, debutS, finS],
    );
    const r = rows[0];
    return r === undefined ? null : { openBar: r.illimite, commissionPct: Number(r.commission_pct) };
  }

  /**
   * Écrit, ou REMPLACE, la régularisation d'un jour, dans une transaction sous le verrou de l'espace et du jour. Un
   * prépayé reçoit le mouvement `regularisation` du jour (la valeur opposée de l'écart : Meta a facturé plus, on débite),
   * et le solde bouge de la différence avec l'ancien ; un jour illimité n'en a aucun (un mouvement d'avant, du temps où
   * ce jour se comptait prépayé, est ramené à zéro).
   *
   * 🔴 Les provisions comptées sont FIGÉES dans leur demi-heure (`tranche_regularisee`), puis leur somme est relue :
   * si elle n'est plus celle du calcul (un accusé a rendu, corrigé ou daté une provision entre la lecture de la passe et
   * cette transaction), rien n'est écrit et la passe suivante recalcule. Sinon une provision rendue après la lecture
   * serait rendue deux fois, ou une provision datée d'un autre jour comptée dans les deux.
   */
  async enregistrer(r: RegularisationAEcrire): Promise<EcritureRegularisation> {
    const c = r.calcul;
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await verrouRegularisation(client, r.tenantId, r.jour);
      await client.query(
        `update credit_whatsapp_provisions set tranche_regularisee = ${TRANCHE_BRUTE}
          where tenant_id = $1 and tranche_regularisee is null and etat <> 'rendu'
            and cree_le >= to_timestamp($3) - interval '31 days'
            and ${TRANCHE_BRUTE} = any($2::bigint[])`,
        [r.tenantId, r.tranches, r.lectureDepuisS],
      );
      const relu = await client.query<{ nous: string }>(
        `select coalesce(sum(montant_micro_eur), 0) as nous from credit_whatsapp_provisions
          where tenant_id = $1 and etat <> 'rendu' and tranche_regularisee = any($2::bigint[])
            and cree_le >= to_timestamp($3) - interval '31 days'`,
        [r.tenantId, r.tranches, r.lectureDepuisS],
      );
      if (Number(relu.rows[0]?.nous ?? 0) !== Math.round(c.nousMicroEur)) {
        await client.query('rollback');
        return { ecrit: false };
      }
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
      const bouge = await regulariserWhatsapp(client, r.tenantId, r.jour, r.illimite ? 0 : -Math.round(c.ecartMicroEur));
      const solde = await client.query<{ solde: string | null }>(
        'select solde_micro_eur as solde from credits_whatsapp where tenant_id = $1',
        [r.tenantId],
      );
      await client.query('commit');
      const apres = Number(solde.rows[0]?.solde ?? 0);
      // Le solde juste avant CE mouvement : celui d'après, moins ce que la régularisation vient de bouger (lus sous le
      // verrou de ligne que son écriture tient, un envoi simultané ne s'intercale pas entre les deux).
      return { ecrit: true, alerteDejaPartie: rows[0]?.alerte_le != null, soldeAvantMicroEur: apres - bouge, soldeMicroEur: apres };
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
