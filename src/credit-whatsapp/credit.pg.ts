import type { Pool, PoolClient } from 'pg';
import type { CategorieMeta } from './grille';
import { debutDuMois, type IssueProvision, type LigneHistoriqueWa, type ProvisionDemandee, type ProvisionVue, type RaisonMouvementWa } from './credit';

/**
 * Le magasin du Crédit WhatsApp (migration 0264). Chaque écriture touche le solde ET sa trace dans la même instruction
 * ou la même transaction : l'invariant « solde = mouvements − provisions non rendues et non illimitées » ne dépend
 * d'aucun ordre d'appel. Une provision ILLIMITÉE (toute Entreprise, migration 0266) ne touche jamais le solde : ni à la
 * prise, ni au retour, ni à la correction.
 */
/**
 * Le crédit d'un paiement, sur le pool ou sur le client d'une transaction (l'achat par Stripe l'écrit dans la même
 * transaction que sa ligne de paiement, `PgStripeStore.crediterPaiementWhatsapp`). 🔴 Une fois par référence : la
 * référence (session Checkout, facture) est unique par espace, et un avis rejoué ne crédite rien de plus.
 */
export async function crediterWhatsapp(
  client: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  tenantId: string,
  deltaMicroEur: number,
  raison: Exclude<RaisonMouvementWa, 'regularisation'>,
  reference: string,
  note: string | null = null,
): Promise<{ applique: boolean; soldeMicroEur: number }> {
  const { rows } = await client.query<{ applique: string; solde: string | null }>(
    `with m as (
       insert into credit_whatsapp_mouvements (tenant_id, delta_micro_eur, raison, reference, note)
       values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, reference) where reference is not null do nothing
       returning delta_micro_eur
     ), c as (
       insert into credits_whatsapp (tenant_id, solde_micro_eur) select $1, delta_micro_eur from m
       on conflict (tenant_id) do update set solde_micro_eur = credits_whatsapp.solde_micro_eur + excluded.solde_micro_eur, maj_le = now()
       returning solde_micro_eur
     )
     select (select count(*) from m) as applique,
            coalesce((select solde_micro_eur from c), (select solde_micro_eur from credits_whatsapp where tenant_id = $1)) as solde`,
    [tenantId, deltaMicroEur, raison, reference, note],
  );
  return { applique: Number(rows[0]?.applique ?? 0) > 0, soldeMicroEur: Number(rows[0]?.solde ?? 0) };
}

export class PgCreditWhatsappStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Prend la provision d'un message avant son envoi. 🔴 Le débit est CONDITIONNEL et atomique (`solde − montant >= 0`
   * dans le `where` de l'`update`) : deux envois simultanés sur un solde qui n'en couvre qu'un, un seul passe. Et un
   * solde nul ou négatif ne laisse rien partir, pas même un message de service compté dans la franchise (à zéro) : tout
   * s'arrête à zéro, réponses comprises (décision de Julien, spec du 2026-10-30). La ligne
   * de solde existe d'abord (une instruction idempotente), sinon un espace jamais crédité ne pourrait même pas être
   * refusé proprement.
   *
   * 🔴 ILLIMITÉ (`openBar`, toute Entreprise, décision du 2026-11-02) : la provision s'écrit, MARQUÉE, pour la facture du
   * mois, et le solde ne bouge pas. Jamais refusée. Le solde d'avant reste intact : un espace qui quitte l'Entreprise le
   * retrouve tel quel, sans dette (avant la 0266, l'open bar le faisait passer en négatif).
   */
  async provisionner(p: ProvisionDemandee): Promise<IssueProvision> {
    if (p.openBar) {
      const { rows } = await this.pool.query<{ id: string; apres: string }>(
        `insert into credit_whatsapp_provisions (tenant_id, phone_number_id, pays, categorie, montant_micro_eur, illimite)
         values ($1, $2, $3, $4, $5, true)
         returning id, coalesce((select solde_micro_eur from credits_whatsapp where tenant_id = $1), 0) as apres`,
        [p.tenantId, p.phoneNumberId, p.pays, p.categorie, p.montantMicroEur],
      );
      const r = rows[0];
      if (r === undefined) throw new Error('provision illimitée non écrite');
      return { ok: true, provisionId: r.id, soldeApresMicroEur: Number(r.apres) };
    }
    await this.pool.query('insert into credits_whatsapp (tenant_id) values ($1) on conflict (tenant_id) do nothing', [p.tenantId]);
    const { rows } = await this.pool.query<{ id: string; apres: string }>(
      `with debit as (
         update credits_whatsapp set solde_micro_eur = solde_micro_eur - $2, maj_le = now()
          where tenant_id = $1 and solde_micro_eur > 0 and solde_micro_eur - $2 >= 0
          returning solde_micro_eur
       ), prov as (
         insert into credit_whatsapp_provisions (tenant_id, phone_number_id, pays, categorie, montant_micro_eur)
         select $1, $3, $4, $5, $2 from debit
         returning id
       )
       select prov.id, debit.solde_micro_eur as apres from prov, debit`,
      [p.tenantId, p.montantMicroEur, p.phoneNumberId, p.pays, p.categorie],
    );
    if (rows[0]) return { ok: true, provisionId: rows[0].id, soldeApresMicroEur: Number(rows[0].apres) };
    // Relu par une instruction À PART : sous concurrence, l'instruction refusée garde l'instantané d'avant le débit qui
    // l'a fait refuser, et dirait un solde périmé (« il vous manque » faux).
    return { ok: false, soldeMicroEur: await this.solde(p.tenantId) };
  }

  /**
   * Rattache le wamid que Meta a rendu. Seconde écriture d'une transition en deux temps : entre les deux, une provision
   * sans wamid reste « provisionnée », et c'est exactement l'état que la régularisation sait lire (un envoi qui n'est
   * jamais parti n'apparaît pas dans les volumes de Meta, l'écart est rendu).
   */
  async rattacher(provisionId: string, wamid: string): Promise<void> {
    await this.pool.query('update credit_whatsapp_provisions set wamid = $2 where id = $1 and wamid is null', [provisionId, wamid]);
  }

  /**
   * Rend une provision (refus net de Meta). Idempotent : une provision déjà rendue ne rend rien de plus. Une provision
   * illimitée est rendue sans toucher le solde, qu'elle n'avait pas touché.
   */
  async rendre(provisionId: string): Promise<void> {
    await this.pool.query(
      `with p as (
         update credit_whatsapp_provisions set etat = 'rendu' where id = $1 and etat <> 'rendu'
         returning tenant_id, montant_micro_eur, illimite
       )
       update credits_whatsapp c set solde_micro_eur = c.solde_micro_eur + p.montant_micro_eur, maj_le = now()
         from p where c.tenant_id = p.tenant_id and not p.illimite`,
      [provisionId],
    );
  }

  /** Rend la provision d'un message par son wamid (accusé « non facturable » ou échec). Idempotent ; illimitée, sans solde. */
  async rendreParWamid(tenantId: string, wamid: string): Promise<void> {
    await this.pool.query(
      `with p as (
         update credit_whatsapp_provisions set etat = 'rendu'
          where tenant_id = $1 and wamid = $2 and etat <> 'rendu'
          returning tenant_id, montant_micro_eur, illimite
       )
       update credits_whatsapp c set solde_micro_eur = c.solde_micro_eur + p.montant_micro_eur, maj_le = now()
         from p where c.tenant_id = p.tenant_id and not p.illimite`,
      [tenantId, wamid],
    );
  }

  /**
   * Corrige une provision que Meta a facturée dans une autre catégorie (un modèle « utility » reclassé en marketing) :
   * la provision prend le nouveau montant, le solde bouge de la différence. Une seule fois : seule une provision encore
   * « provisionnée » se corrige, et un rejeu de l'accusé ne bouge plus rien. Illimitée, seul son montant change.
   */
  async corrigerParWamid(tenantId: string, wamid: string, categorie: CategorieMeta, montantMicroEur: number): Promise<void> {
    await this.pool.query(
      `with ancienne as (
         select id, montant_micro_eur from credit_whatsapp_provisions
          where tenant_id = $1 and wamid = $2 and etat = 'provisionne' for update
       ), p as (
         update credit_whatsapp_provisions q set categorie = $3, montant_micro_eur = $4, etat = 'ajuste'
           from ancienne a where q.id = a.id
         returning q.tenant_id, $4::bigint - a.montant_micro_eur as ecart, q.illimite
       )
       update credits_whatsapp c set solde_micro_eur = c.solde_micro_eur - p.ecart, maj_le = now()
         from p where c.tenant_id = p.tenant_id and not p.illimite`,
      [tenantId, wamid, categorie, montantMicroEur],
    );
  }

  /** La provision d'un message, par son wamid ; `null` si ce message n'a rien provisionné (numéro hors de la ligne). */
  async provisionDuWamid(tenantId: string, wamid: string): Promise<{ categorie: CategorieMeta; pays: string | null; montantMicroEur: number; etat: 'provisionne' | 'rendu' | 'ajuste' } | null> {
    const { rows } = await this.pool.query<{ categorie: CategorieMeta; pays: string | null; montant: string; etat: 'provisionne' | 'rendu' | 'ajuste' }>(
      'select categorie, pays, montant_micro_eur as montant, etat from credit_whatsapp_provisions where tenant_id = $1 and wamid = $2',
      [tenantId, wamid],
    );
    const r = rows[0];
    return r === undefined ? null : { categorie: r.categorie, pays: r.pays, montantMicroEur: Number(r.montant), etat: r.etat };
  }

  /** L'instant où Meta a livré le message (sa facturation) : la régularisation compare par jour de livraison. */
  async marquerLivre(tenantId: string, wamid: string, livreLe: Date): Promise<void> {
    await this.pool.query(
      'update credit_whatsapp_provisions set livre_le = $3 where tenant_id = $1 and wamid = $2 and livre_le is null',
      [tenantId, wamid, livreLe],
    );
  }

  /**
   * Crédite un paiement. 🔴 Une fois par paiement : la référence (session Checkout, facture) est unique par espace, et un
   * avis rejoué par Stripe ne crédite rien de plus.
   */
  async crediter(tenantId: string, deltaMicroEur: number, raison: Exclude<RaisonMouvementWa, 'regularisation'>, reference: string, note: string | null = null): Promise<{ applique: boolean; soldeMicroEur: number }> {
    return crediterWhatsapp(this.pool, tenantId, deltaMicroEur, raison, reference, note);
  }

  /**
   * La régularisation d'un jour (UTC) : SA ligne est remplacée, et le solde bouge de la seule différence avec la valeur
   * précédente du jour. `deltaMicroEur` est l'effet sur le solde (négatif = débit). Un seul régularisateur à la fois
   * (la passe horaire du lot 3 tient un verrou) : deux passes simultanées du même jour liraient la même ancienne valeur.
   * 🔴 Jamais pour une provision illimitée (`illimite`, décision du 2026-11-02) : le solde ne l'a pas payée, son écart va
   * au montant à facturer. La règle se lit sur CHAQUE provision, jamais sur l'offre de l'espace au moment de la passe : un
   * espace sorti de l'Entreprise en cours de mois garde illimitées les provisions prises avant (relecture du lot A).
   */
  async regulariser(tenantId: string, jour: string, deltaMicroEur: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query<{ delta: string }>(
        `select delta_micro_eur as delta from credit_whatsapp_mouvements
          where tenant_id = $1 and raison = 'regularisation' and jour = $2::date for update`,
        [tenantId, jour],
      );
      const ecart = deltaMicroEur - Number(rows[0]?.delta ?? 0);
      await client.query(
        `insert into credit_whatsapp_mouvements (tenant_id, delta_micro_eur, raison, jour) values ($1, $3, 'regularisation', $2::date)
         on conflict (tenant_id, jour) where raison = 'regularisation' do update set delta_micro_eur = excluded.delta_micro_eur, le = now()`,
        [tenantId, jour, deltaMicroEur],
      );
      if (ecart !== 0) {
        await client.query(
          `insert into credits_whatsapp (tenant_id, solde_micro_eur) values ($1, $2)
           on conflict (tenant_id) do update set solde_micro_eur = credits_whatsapp.solde_micro_eur + excluded.solde_micro_eur, maj_le = now()`,
          [tenantId, ecart],
        );
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Les `n` dernières provisions d'un espace, les plus récentes d'abord (`/ops`, index `(tenant_id, cree_le desc)`). */
  async dernieresProvisions(tenantId: string, n = 50): Promise<ProvisionVue[]> {
    const { rows } = await this.pool.query<{
      id: string; cree_le: Date; phone_number_id: string; wamid: string | null; pays: string | null; categorie: CategorieMeta;
      montant: string; etat: ProvisionVue['etat']; livre_le: Date | null; illimite: boolean;
    }>(
      `select id, cree_le, phone_number_id, wamid, pays, categorie, montant_micro_eur as montant, etat, livre_le, illimite
         from credit_whatsapp_provisions where tenant_id = $1 order by cree_le desc limit $2`,
      [tenantId, n],
    );
    return rows.map((r) => ({
      id: r.id, creeLe: r.cree_le.toISOString(), phoneNumberId: r.phone_number_id, wamid: r.wamid, pays: r.pays,
      categorie: r.categorie, montantMicroEur: Number(r.montant), etat: r.etat, livreLe: r.livre_le?.toISOString() ?? null,
      illimite: r.illimite === true,
    }));
  }

  /**
   * Le dernier crédit REÇU (achat, recharge automatique) : l'occasion de l'alerte du solde bas, qu'un crédit réarme sans
   * aucun état à tenir. `null` s'il n'y en a jamais eu. 🔴 Jamais une régularisation positive (lot 3), même si elle crédite :
   * remplacée à chaque passe, elle réarmerait l'alerte sans que le client ait rien acheté.
   */
  async dernierCreditRecu(tenantId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `select id::text from credit_whatsapp_mouvements
        where tenant_id = $1 and delta_micro_eur > 0 and raison in ('achat', 'recharge_auto')
        order by le desc limit 1`,
      [tenantId],
    );
    return rows[0]?.id ?? null;
  }

  async solde(tenantId: string): Promise<number> {
    const { rows } = await this.pool.query<{ solde: string }>('select solde_micro_eur as solde from credits_whatsapp where tenant_id = $1', [tenantId]);
    return Number(rows[0]?.solde ?? 0);
  }

  /**
   * Ce qu'ont consommé les messages ILLIMITÉS du mois de Paris : les provisions `illimite` non rendues depuis le 1er.
   * L'onglet d'une Entreprise le montre à la place du solde ; c'est aussi la base de sa facture du mois. 🔴 Les provisions
   * prépayées n'y entrent pas (relecture du lot A, 2026-11-02) : celles d'un espace passé en Entreprise en cours de mois
   * ont été payées sur son solde, les compter les ferait facturer une seconde fois.
   */
  async consommationDuMois(tenantId: string): Promise<number> {
    const { rows } = await this.pool.query<{ total: string }>(
      `select coalesce(sum(montant_micro_eur), 0) as total from credit_whatsapp_provisions
        where tenant_id = $1 and illimite and etat <> 'rendu'
          and cree_le >= (date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')`,
      [tenantId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Les messages de service d'un numéro dans le mois (UTC), jusqu'à `plafond` : la franchise de Meta (1 000 par numéro
   * et par mois) n'a besoin que de savoir si on l'a dépassée, la lecture s'arrête donc au plafond. Un message rendu
   * (échec) ne compte pas : Meta ne compte que les messages livrés.
   */
  async serviceDuMois(phoneNumberId: string, mois: string, plafond: number): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `select count(*) as n from (
         select 1 from credit_whatsapp_provisions
          where phone_number_id = $1
            and cree_le >= ($2::date::timestamp at time zone 'UTC')
            and cree_le < (($2::date + interval '1 month')::timestamp at time zone 'UTC')
            and categorie = 'service' and etat <> 'rendu'
          limit $3
       ) s`,
      [phoneNumberId, debutDuMois(mois), plafond],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * L'historique des `jours` derniers jours : les envois agrégés par jour de Paris (une ligne par jour, sinon ils noient
   * tout le reste), les achats et les régularisations. Sans aucune note.
   */
  async historique(tenantId: string, jours = 90): Promise<LigneHistoriqueWa[]> {
    const { rows } = await this.pool.query<{
      id: string; raison: string; delta: string; jour: string | null; at: Date; messages: string | null; reference: string | null;
      facture: boolean;
    }>(
      `select 'envois:' || jour as id, 'envois' as raison, -sum(montant_micro_eur) as delta, jour, max(cree_le) as at,
              count(*) as messages, null::text as reference, false as facture
         from (select (cree_le at time zone 'Europe/Paris')::date::text as jour, montant_micro_eur, cree_le
                 from credit_whatsapp_provisions
                where tenant_id = $1 and etat <> 'rendu' and cree_le >= now() - make_interval(days => $2)) e
        group by jour
       union all
       select m.id::text, m.raison, m.delta_micro_eur, m.jour::text, m.le, null, m.reference, (p.facture_id is not null)
         from credit_whatsapp_mouvements m
         left join stripe_paiements p on m.raison = 'achat' and p.session_id = m.reference and p.tenant_id = m.tenant_id
        where m.tenant_id = $1 and m.le >= now() - make_interval(days => $2)
        order by at desc`,
      [tenantId, jours],
    );
    return rows.map((r) => ({
      id: r.id,
      raison: r.raison,
      deltaMicroEur: Number(r.delta),
      jour: r.jour,
      at: r.at.toISOString(),
      messages: r.messages === null ? null : Number(r.messages),
      reference: r.reference,
      facture: r.facture === true,
    }));
  }
}
