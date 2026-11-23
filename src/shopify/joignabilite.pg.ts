import type { Pool, PoolClient } from 'pg';
import { BOUNDS_CTE, STATS_TZ, type DateRange } from '../stats/range';
import { CODE_SANS_WHATSAPP } from '../meta/errors';
import { journaliser } from '../lib/journal';
import { messageDe } from '../lib/erreur';
import type { JoignabiliteShopify } from '../../web/lib/partage/joignabilite-shopify';
import type { ClassementTelephone } from './donnees';

/**
 * LA JOIGNABILITÉ WHATSAPP DES COMMANDES SHOPIFY (segments Shopify enrichis, lot 2b, migration 0310). Deux tables sans
 * téléphone, nom ni adresse : `shopify_joignabilite` (une ligne par commande : classement à `orders/paid`, date de la
 * première expédition) et `shopify_envois` (la campagne d'un message de confirmation ou d'expédition vers sa commande).
 *
 * 🔴 RIEN N'EST ÉCRIT DANS LE TRAITEMENT DES ACCUSÉS : « livrée » et « contact supprimé » se LISENT au moment de la carte
 * sur `campaign_recipients` (l'accusé `delivered` ou `read` ; un `failed` 131026 dont la ligne a été anonymisée par la
 * purge de la fiche). Le chemin chaud des accusés ne porte donc aucune écriture de plus.
 *
 * 🔴 UNE COMMANDE NE COMPTE QU'UNE FOIS SON PAIEMENT VU (relecture du lot) : son classement ne se pose qu'à `orders/paid`.
 * Une commande payée avant la mise en service (ou avant le branchement), puis expédiée, naît à l'expédition SANS
 * classement, et la carte l'ignore : sa confirmation, partie sans lien vers elle, l'aurait rangée « en attente » et fait
 * lire un taux proche de 0 % pendant des semaines. Une commande payée à la livraison (expédiée d'abord) entre à son paiement.
 *
 * 🔴 Chaque requête porte `tenant_id = $1` : le rôle de l'application contourne la RLS, ce filtre est le seul contrôle.
 * Une seule exception, le ménage (`purger`), qui balaie tous les espaces par nature.
 */
export class PgJoignabiliteStore {
  constructor(private readonly pool: Pool) {}

  /** Le classement et le drapeau test d'une commande payée (rejoué : réécrit, la date d'expédition gardée). */
  async noterCommande(tenantId: string, commandeId: string, classement: ClassementTelephone, test: boolean): Promise<void> {
    await this.pool.query(
      `insert into shopify_joignabilite (tenant_id, commande_id, classement, test) values ($1, $2, $3, $4)
       on conflict (tenant_id, commande_id) do update set classement = excluded.classement, test = excluded.test`,
      [tenantId, commandeId, classement, test],
    );
  }

  /**
   * La PREMIÈRE expédition d'une commande (un second colis ne la déplace pas). Une commande dont le paiement n'a pas été
   * vu naît ici SANS classement : la carte ne la compte qu'une fois `orders/paid` arrivé (`noterCommande`).
   */
  async noterExpedition(tenantId: string, commandeId: string): Promise<void> {
    await this.pool.query(
      `insert into shopify_joignabilite (tenant_id, commande_id, expediee_le) values ($1, $2, now())
       on conflict (tenant_id, commande_id) do update
         set expediee_le = coalesce(shopify_joignabilite.expediee_le, excluded.expediee_le)`,
      [tenantId, commandeId],
    );
  }

  /** La campagne d'un message Shopify vers sa commande (un webhook rejoué rend la même campagne : rien de plus). */
  async noterEnvoi(tenantId: string, campaignId: string, commandeId: string): Promise<void> {
    await this.pool.query(
      `insert into shopify_envois (campaign_id, tenant_id, commande_id) values ($1, $2, $3) on conflict (campaign_id) do nothing`,
      [campaignId, tenantId, commandeId],
    );
  }

  /** `customers/redact` : les lignes des commandes que la demande cite. */
  async effacerCommandes(tenantId: string, commandeIds: readonly string[]): Promise<void> {
    if (commandeIds.length === 0) return;
    await this.pool.query('delete from shopify_envois where tenant_id = $1 and commande_id = any($2::text[])', [tenantId, commandeIds]);
    await this.pool.query('delete from shopify_joignabilite where tenant_id = $1 and commande_id = any($2::text[])', [tenantId, commandeIds]);
  }

  /**
   * Le ménage, TOUS ESPACES (l'exception au filtre d'espace) : une commande jamais expédiée, ou jamais vue payée, à 60
   * jours ; toute ligne 400 jours après son expédition (la plus longue période lue), pas après son paiement : une
   * précommande payée il y a plus d'un an mais expédiée dans l'année se lit encore. Les campagnes reliées partent avec
   * leur commande, ou à 400 jours quand elles n'en ont plus.
   */
  async purger(): Promise<{ commandes: number; envois: number }> {
    const commandes = await this.pool.query(
      `delete from shopify_joignabilite
        where ((expediee_le is null or classement is null) and cree_le < now() - interval '60 days')
           or coalesce(expediee_le, cree_le) < now() - interval '400 days'`,
    );
    const envois = await this.pool.query(
      `delete from shopify_envois e
        where e.cree_le < now() - interval '400 days'
          and not exists (select 1 from shopify_joignabilite j where j.tenant_id = e.tenant_id and j.commande_id = e.commande_id)`,
    );
    return { commandes: commandes.rowCount ?? 0, envois: envois.rowCount ?? 0 };
  }

  /**
   * LA CARTE D'UNE PÉRIODE : les commandes expédiées (première expédition dans la période, jour de Paris) dont le paiement
   * a été vu, leurs messages livrés, et la répartition en cinq parts sans recouvrement, la première qui s'applique gagnant
   * (spec, « La répartition ») : livrée, contact supprimé, sans numéro, invalide, en attente. Les accusés se lisent par
   * une campagne DE L'ESPACE : la clé étrangère seule ne le garantirait pas à un futur écrivain de `shopify_envois`.
   */
  async lire(tenantId: string, range: DateRange): Promise<JoignabiliteShopify> {
    const res = await this.pool.query<{
      test: boolean; expediees: number; messages: number; livrees: number; supprimees: number; sans_numero: number;
      invalides: number; en_attente: number; pas_livrable: number;
    }>(
      `with ${BOUNDS_CTE},
       expediees as (
         select j.commande_id, j.classement, j.test
           from shopify_joignabilite j, bounds b
          where j.tenant_id = $1 and j.classement is not null and j.expediee_le >= b.start_ts and j.expediee_le < b.end_ts
       ),
       messages as (
         select e.commande_id,
                count(*) filter (where r.delivery_status in ('delivered', 'read')) as livres,
                bool_or(r.delivery_status = 'failed' and r.error_code = $5::integer and r.to_e164 = 'anonyme') as supprimee,
                -- Encore en vol : pas encore parti, ou parti sans accusé définitif (un simple « sent »).
                bool_or(r.status in ('pending', 'sending')
                        or (r.status = 'sent' and (r.delivery_status is null or r.delivery_status = 'sent'))) as en_vol
           from shopify_envois e
           join campaigns c on c.id = e.campaign_id and c.tenant_id = $1
           join campaign_recipients r on r.campaign_id = e.campaign_id
          where e.tenant_id = $1 and e.commande_id in (select commande_id from expediees)
          group by e.commande_id
       ),
       issues as (
         select x.test, coalesce(m.livres, 0) as livres,
                case when coalesce(m.livres, 0) > 0 then 'livree'
                     when coalesce(m.supprimee, false) then 'supprimee'
                     when x.classement = 'sans_numero' then 'sans_numero'
                     when x.classement = 'invalide' then 'invalide'
                     when coalesce(m.en_vol, false) then 'en_attente'
                     else 'pas_livrable' end as issue
           from expediees x left join messages m on m.commande_id = x.commande_id
       )
       select test,
              count(*)::int as expediees,
              coalesce(sum(livres), 0)::int as messages,
              count(*) filter (where issue = 'livree')::int as livrees,
              count(*) filter (where issue = 'supprimee')::int as supprimees,
              count(*) filter (where issue = 'sans_numero')::int as sans_numero,
              count(*) filter (where issue = 'invalide')::int as invalides,
              count(*) filter (where issue = 'en_attente')::int as en_attente,
              count(*) filter (where issue = 'pas_livrable')::int as pas_livrable
         from issues
        group by test`,
      [tenantId, range.from, range.to, STATS_TZ, CODE_SANS_WHATSAPP],
    );
    const reel = res.rows.find((r) => !r.test);
    const test = res.rows.find((r) => r.test);
    return {
      expediees: reel?.expediees ?? 0,
      messagesLivres: reel?.messages ?? 0,
      livrees: reel?.livrees ?? 0,
      supprimees: reel?.supprimees ?? 0,
      sansNumero: reel?.sans_numero ?? 0,
      invalides: reel?.invalides ?? 0,
      enAttente: reel?.en_attente ?? 0,
      pasLivrable: reel?.pas_livrable ?? 0,
      testExpediees: test?.expediees ?? 0,
    };
  }
}

/**
 * 🔴 LA JOIGNABILITÉ PART AVEC LE BRANCHEMENT (`effacerBranchement`, `./store.pg.ts` : `shop/redact`, la désinstallation
 * d'une boutique de la console, la reprise d'une boutique coupée par un autre espace), DANS sa transaction mais derrière
 * un point de reprise : une panne (la table pas encore créée, la migration 0310 n'étant pas bloquante) n'annule que ces
 * deux instructions, se journalise, et l'effacement du reste aboutit.
 */
export async function effacerJoignabiliteDuBranchement(client: PoolClient, tenantId: string): Promise<void> {
  await client.query('savepoint joignabilite');
  try {
    await client.query('delete from shopify_envois where tenant_id = $1', [tenantId]);
    await client.query('delete from shopify_joignabilite where tenant_id = $1', [tenantId]);
    await client.query('release savepoint joignabilite');
  } catch (err) {
    await client.query('rollback to savepoint joignabilite');
    journaliser('warn', 'shopify_joignabilite_en_echec', { tenantId, quoi: 'effacement', erreur: messageDe(err) });
  }
}
