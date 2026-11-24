import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { enTransaction } from '../db/transaction';
import type { CollectionLueVue } from '../../web/lib/partage/segments';

/**
 * LE CACHE DES COLLECTIONS DES PRODUITS ACHETÉS (segments Shopify enrichis, lot 6a, migration 0314) : les produits vus
 * dans les lignes des commandes payées (`shopify_produits`), leurs collections à la dernière lecture
 * (`shopify_produit_collections`, remplacées en bloc) et l'état de la lecture de l'espace (`shopify_collections_lecture`).
 * Le job (`./collections.ts`) les écrit, le critère « a acheté dans la collection » et le volet Shopify les lisent.
 *
 * 🔴 UNE LECTURE PAR LOT RÉSERVÉ, JAMAIS DEUX : pg-boss ne déduplique rien, deux jobs du même espace peuvent tourner
 * ensemble. Chacun réserve ses produits par un BAIL (`for update skip locked`, puis `bail_jusqua` et un JETON) : un
 * worker mort laisse son bail expirer et un autre passage reprend ses produits ; un porteur dont le bail a été repris
 * n'écrit plus rien, toutes ses écritures filtrant sur son jeton.
 *
 * 🔴 `tenant_id` sur CHAQUE requête et chaque sous-requête : le rôle de l'application contourne la RLS, ce filtre est le
 * seul contrôle. L'effacement du branchement (`effacerBranchement`, `./store.pg.ts`) emporte ces trois tables.
 */

/** Un produit relu au-delà de ce délai : « au plus une fois par jour et par produit » (spec, chantier 1). */
export const FRAICHEUR_COLLECTIONS_HEURES = 24;
/** Le bail d'un lot réservé : plus long que la lecture d'un lot (20 s au plus) et son écriture. */
export const BAIL_LOT_SECONDES = 180;
/** Une demande de lecture sans issue depuis ce délai est perdue (job tué, file en panne) : une nouvelle peut partir. */
export const DEMANDE_PERIMEE_MINUTES = 15;
/** Après une issue, une nouvelle demande attend ce délai : un volet rouvert en boucle ne relance pas un refus en boucle. */
export const RELANCE_APRES_ISSUE_SECONDES = 60;

/** L'identifiant d'un produit que l'on sait lire chez Shopify (un GID se reconstruit dessus), le CHECK de la table. */
const PRODUIT_LISIBLE = `'^[0-9]{1,19}$'`;

export type IssueLecture = 'lue' | 'sans_droit' | 'refusee' | 'erreur';

/** L'état de la lecture des collections d'un espace, tel que la table le garde. */
export interface EtatLectureCollections {
  /** La dernière lecture aboutie (tous les produits à lire lus) ; nulle : aucune. */
  lueLe: Date | null;
  demandeeLe: Date | null;
  issue: IssueLecture | null;
  issueLe: Date | null;
  message: string | null;
  /** Un produit du cache porte plus de 50 collections : la liste n'est pas exhaustive. */
  incompletes: boolean;
}

/** Ce qu'une lecture a rendu d'un produit : son titre, ses collections (50 au plus), et s'il en a d'autres. */
export interface ProduitLu {
  produitId: string;
  /** Nul : Shopify n'a rendu aucun titre (produit supprimé chez Shopify, ou illisible) ; le titre connu reste. */
  titre: string | null;
  collections: ReadonlyArray<{ collectionId: string; titre: string | null }>;
  incompletes: boolean;
}

/** Ce que le job et le volet demandent au cache : `PgCollectionsStore`, ou le faux des tests. */
export interface MagasinCollections {
  synchroniser(tenantId: string): Promise<number>;
  reserver(tenantId: string, n: number): Promise<{ jeton: string; produits: string[] }>;
  liberer(tenantId: string, jeton: string): Promise<void>;
  ecrire(tenantId: string, jeton: string, lus: readonly ProduitLu[]): Promise<number>;
  resteALire(tenantId: string): Promise<boolean>;
  aLire(tenantId: string): Promise<boolean>;
  demander(tenantId: string): Promise<Date | null>;
  annulerDemande(tenantId: string, le: Date): Promise<void>;
  noterIssue(tenantId: string, issue: IssueLecture, message: string | null): Promise<void>;
  etat(tenantId: string): Promise<EtatLectureCollections | null>;
  collections(tenantId: string, recherche: string | undefined, limite: number): Promise<CollectionLueVue[]>;
}

/** Un message tient dans sa colonne (1 à 500 caractères) : vide, il devient nul. */
const messageEcrit = (m: string | null): string | null => (m === null || m.trim() === '' ? null : m.slice(0, 500));

export class PgCollectionsStore implements MagasinCollections {
  constructor(private readonly pool: Pool) {}

  /**
   * Inscrit au cache les produits vus dans les lignes des commandes payées de l'espace (produit connu, hors cartes
   * cadeaux, identifiant lisible) qu'il ne connaît pas encore. Rend le nombre ajouté. 🔴 Le prédicat de l'index partiel
   * `shopify_commande_lignes_produit` (migration 0311) est repris mot pour mot.
   */
  async synchroniser(tenantId: string): Promise<number> {
    const res = await this.pool.query(
      `insert into shopify_produits (tenant_id, produit_id)
       select distinct l.tenant_id, l.produit_id from shopify_commande_lignes l
        where l.tenant_id = $1 and l.produit_id is not null and not l.carte_cadeau and l.produit_id ~ ${PRODUIT_LISIBLE}
       on conflict (tenant_id, produit_id) do nothing`,
      [tenantId],
    );
    return res.rowCount ?? 0;
  }

  /**
   * Réserve au plus `n` produits à lire (jamais lus, ou lus il y a plus de 24 h) dont le bail est libre ou mort, les
   * jamais lus d'abord : `for update skip locked`, puis un bail et un jeton neuf. Deux jobs ne prennent jamais le même.
   */
  async reserver(tenantId: string, n: number): Promise<{ jeton: string; produits: string[] }> {
    const jeton = randomUUID();
    const res = await this.pool.query<{ produit_id: string }>(
      `with choisis as (
         select p.produit_id from shopify_produits p
          where p.tenant_id = $1
            and (p.collections_lues_le is null or p.collections_lues_le < now() - make_interval(hours => $2))
            and (p.bail_jusqua is null or p.bail_jusqua < now())
          order by p.collections_lues_le nulls first, p.produit_id
          limit $3
          for update skip locked
       )
       update shopify_produits s set bail_jusqua = now() + make_interval(secs => $4), jeton = $5
         from choisis c
        where s.tenant_id = $1 and s.produit_id = c.produit_id
       returning s.produit_id`,
      [tenantId, FRAICHEUR_COLLECTIONS_HEURES, Math.max(1, Math.round(n)), BAIL_LOT_SECONDES, jeton],
    );
    return { jeton, produits: res.rows.map((r) => r.produit_id) };
  }

  /** Une panne pendant le lot : son bail tombe, un autre passage reprend ses produits. */
  async liberer(tenantId: string, jeton: string): Promise<void> {
    if (jeton === '') return;
    await this.pool.query(
      `update shopify_produits set bail_jusqua = null, jeton = null where tenant_id = $1 and jeton = $2`,
      [tenantId, jeton],
    );
  }

  /**
   * Écrit les produits lus d'un lot, dans UNE transaction : chaque produit que ce jeton tient encore reçoit son titre (le
   * connu reste si Shopify n'en rend pas), sa date de lecture, son drapeau d'incomplétude, et ses collections REMPLACÉES
   * en bloc (un produit supprimé chez Shopify est lu, sans collection). 🔴 Un produit dont le bail a été repris n'est pas
   * écrit. Rend le nombre de produits écrits.
   */
  async ecrire(tenantId: string, jeton: string, lus: readonly ProduitLu[]): Promise<number> {
    if (lus.length === 0 || jeton === '') return 0;
    return enTransaction(this.pool, async (client) => {
      const tenus = await client.query<{ produit_id: string }>(
        `update shopify_produits p
            set titre = coalesce(x.titre, p.titre), collections_lues_le = now(), collections_incompletes = x.incompletes,
                bail_jusqua = null, jeton = null
           from jsonb_to_recordset($3::jsonb) as x(produit_id text, titre text, incompletes boolean)
          where p.tenant_id = $1 and p.jeton = $2 and p.produit_id = x.produit_id
         returning p.produit_id`,
        [tenantId, jeton, JSON.stringify(lus.map((l) => ({ produit_id: l.produitId, titre: l.titre, incompletes: l.incompletes })))],
      );
      const ecrits = tenus.rows.map((r) => r.produit_id);
      if (ecrits.length === 0) return 0;
      await client.query(
        `delete from shopify_produit_collections where tenant_id = $1 and produit_id = any($2::text[])`,
        [tenantId, ecrits],
      );
      const garder = new Set(ecrits);
      const lignes = lus.filter((l) => garder.has(l.produitId))
        .flatMap((l) => l.collections.map((c) => ({ produit_id: l.produitId, collection_id: c.collectionId, titre: c.titre })));
      if (lignes.length > 0) {
        await client.query(
          `insert into shopify_produit_collections (tenant_id, produit_id, collection_id, titre)
           select $1, x.produit_id, x.collection_id, x.titre
             from jsonb_to_recordset($2::jsonb) as x(produit_id text, collection_id text, titre text)
           on conflict (tenant_id, produit_id, collection_id) do update set titre = excluded.titre`,
          [tenantId, JSON.stringify(lignes)],
        );
      }
      return ecrits.length;
    });
  }

  /** Reste-t-il un produit du cache à lire (jamais lu, ou il y a plus de 24 h), réservé ou non ? */
  async resteALire(tenantId: string): Promise<boolean> {
    const res = await this.pool.query<{ reste: boolean }>(
      `select exists (
         select 1 from shopify_produits p
          where p.tenant_id = $1 and (p.collections_lues_le is null or p.collections_lues_le < now() - make_interval(hours => $2))
       ) as reste`,
      [tenantId, FRAICHEUR_COLLECTIONS_HEURES],
    );
    return res.rows[0]?.reste === true;
  }

  /**
   * Un produit acheté attend-il une lecture ? Lu sur les LIGNES de l'espace (le cache ne connaît pas encore un produit
   * d'une commande arrivée depuis), hors cartes cadeaux : jamais lu, ou lu il y a plus de 24 h. 🔴 Le prédicat de l'index
   * partiel `shopify_commande_lignes_produit` repris mot pour mot ; les deux tables nomment l'espace.
   */
  async aLire(tenantId: string): Promise<boolean> {
    const res = await this.pool.query<{ a_lire: boolean }>(
      `select exists (
         select 1 from (select distinct l.produit_id from shopify_commande_lignes l
                         where l.tenant_id = $1 and l.produit_id is not null and not l.carte_cadeau) v
          where v.produit_id ~ ${PRODUIT_LISIBLE}
            and not exists (select 1 from shopify_produits p
                             where p.tenant_id = $1 and p.produit_id = v.produit_id
                               and p.collections_lues_le >= now() - make_interval(hours => $2))
       ) as a_lire`,
      [tenantId, FRAICHEUR_COLLECTIONS_HEURES],
    );
    return res.rows[0]?.a_lire === true;
  }

  /**
   * Demande une lecture : pose `demandee_le` et la rend, À MOINS qu'une demande vive attende encore son issue (moins de
   * 15 minutes) ou qu'une issue vienne de tomber (moins d'une minute). `null` : rien à enfiler. Ce n'est pas l'unicité
   * du travail (le bail des lots la tient), seulement de quoi ne pas enfiler un job par ouverture du volet.
   */
  async demander(tenantId: string): Promise<Date | null> {
    const res = await this.pool.query<{ demandee_le: Date }>(
      `insert into shopify_collections_lecture as e (tenant_id, demandee_le) values ($1, now())
       on conflict (tenant_id) do update set demandee_le = now()
        where e.demandee_le is null
           or e.demandee_le < now() - make_interval(mins => $2)
           or (e.issue_le is not null and e.issue_le >= e.demandee_le and e.issue_le < now() - make_interval(secs => $3))
       returning demandee_le`,
      [tenantId, DEMANDE_PERIMEE_MINUTES, RELANCE_APRES_ISSUE_SECONDES],
    );
    return res.rows[0]?.demandee_le ?? null;
  }

  /**
   * Le job de cette demande n'a pas pu être enfilé : elle s'efface, pour qu'une suivante parte tout de suite. 🔴 Comparée
   * à la MILLISECONDE : Postgres garde la microseconde de `now()`, `pg` rend une `Date` tronquée à la milliseconde ; une
   * égalité stricte ne retrouverait jamais la ligne (la lecture se dirait « en cours » un quart d'heure sans aucun job).
   */
  async annulerDemande(tenantId: string, le: Date): Promise<void> {
    await this.pool.query(
      `update shopify_collections_lecture set demandee_le = null
        where tenant_id = $1 and date_trunc('milliseconds', demandee_le) = date_trunc('milliseconds', $2::timestamptz)`,
      [tenantId, le],
    );
  }

  /**
   * L'issue d'une lecture ; `lue` pose aussi `lue_le`. 🔴 Une mise à jour, jamais une création : la ligne naît de la
   * demande, et un job qui finit après l'effacement du branchement ne la ressuscite pas.
   */
  async noterIssue(tenantId: string, issue: IssueLecture, message: string | null): Promise<void> {
    await this.pool.query(
      `update shopify_collections_lecture
          set issue = $2, issue_le = now(), message = $3, lue_le = case when $2 = 'lue' then now() else lue_le end
        where tenant_id = $1`,
      [tenantId, issue, messageEcrit(message)],
    );
  }

  async etat(tenantId: string): Promise<EtatLectureCollections | null> {
    const res = await this.pool.query<{
      lue_le: Date | null; demandee_le: Date | null; issue: IssueLecture | null; issue_le: Date | null; message: string | null; incompletes: boolean;
    }>(
      `select e.lue_le, e.demandee_le, e.issue, e.issue_le, e.message,
              exists (select 1 from shopify_produits p where p.tenant_id = $1 and p.collections_incompletes) as incompletes
         from shopify_collections_lecture e
        where e.tenant_id = $1`,
      [tenantId],
    );
    const r = res.rows[0];
    return r
      ? { lueLe: r.lue_le, demandeeLe: r.demandee_le, issue: r.issue, issueLe: r.issue_le, message: r.message, incompletes: r.incompletes }
      : null;
  }

  /**
   * Les collections lues de l'espace, celles qui portent le plus de produits commandés d'abord, au plus `limite`.
   * `recherche` cherche dans le titre (sans la casse, `%` et `_` pris à la lettre) ou désigne un identifiant. Le titre est
   * celui de la lecture la plus récente.
   */
  async collections(tenantId: string, recherche: string | undefined, limite: number): Promise<CollectionLueVue[]> {
    const brut = recherche?.trim() ?? '';
    const motif = brut === '' ? null : `%${brut.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const res = await this.pool.query<{ collection_id: string; titre: string | null; produits: number }>(
      `select pc.collection_id,
              (array_agg(pc.titre order by p.collections_lues_le desc nulls last) filter (where pc.titre is not null))[1] as titre,
              count(*)::int as produits
         from shopify_produit_collections pc
         join shopify_produits p on p.tenant_id = pc.tenant_id and p.produit_id = pc.produit_id
        where pc.tenant_id = $1 and p.tenant_id = $1
          and ($2::text is null or pc.titre ilike $2 or pc.collection_id = $3)
        group by pc.collection_id
        order by produits desc, titre nulls last, pc.collection_id
        limit $4`,
      [tenantId, motif, brut, Math.max(1, Math.round(limite))],
    );
    return res.rows.map((r) => ({ collectionId: r.collection_id, titre: r.titre, produits: r.produits }));
  }
}

/** Le nom du critère dans la phrase d'un refus, celui de la validation (`src/crm/contact-filters.ts`). */
const CRITERE = 'filtre « a acheté dans la collection »';

/** Aucune lecture n'a abouti : le critère est refusé, jamais « personne ». */
export const REFUS_SANS_LECTURE = `${CRITERE} : les collections de la boutique n’ont pas encore été lues. Ouvrez le volet `
  + 'Shopify des filtres (ou get_shopify_state depuis Claude), qui lance leur lecture, puis réessayez dans un instant.';
/** La dernière lecture s'est heurtée au droit manquant : la phrase dit comment l'ajouter. */
export const REFUS_SANS_DROIT = `${CRITERE} : les collections ne peuvent pas être lues, l’app Messaging Me de la boutique `
  + 'n’a pas le droit read_products. Ajoutez-le à ses portées, publiez sa nouvelle version, puis réinstallez-la sur la '
  + 'boutique pour l’accepter (depuis Claude Code, la skill shopify le fait).';

/**
 * 🔴 LA GARDE DU CRITÈRE DE COLLECTION, partagée par toutes les lectures par filtres (`PgContactStore`) : la phrase du
 * refus, ou `null`. Refusé si aucune lecture des collections n'a abouti pour l'espace, ou si une collection demandée
 * n'est pas connue à la dernière lecture (nommée par son identifiant : son titre partait avec elle). Jamais « personne »,
 * qui serait une campagne vide prise pour une vérité.
 */
export async function refusDesCollections(pool: Pool, tenantId: string, ids: readonly string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const etat = await pool.query<{ lue_le: Date | null; issue: IssueLecture | null }>(
    `select lue_le, issue from shopify_collections_lecture where tenant_id = $1`,
    [tenantId],
  );
  const e = etat.rows[0];
  if (!e || e.lue_le === null) return e?.issue === 'sans_droit' ? REFUS_SANS_DROIT : REFUS_SANS_LECTURE;
  const connues = await pool.query<{ collection_id: string }>(
    `select distinct collection_id from shopify_produit_collections where tenant_id = $1 and collection_id = any($2::text[])`,
    [tenantId, ids],
  );
  const vues = new Set(connues.rows.map((r) => r.collection_id));
  const inconnues = [...new Set(ids)].filter((id) => !vues.has(id));
  if (inconnues.length === 0) return null;
  const le = e.lue_le.toISOString().slice(0, 10);
  return inconnues.length === 1
    ? `${CRITERE} : la collection ${inconnues[0]} n’est pas connue, aucun produit commandé ne s’y trouvait à la lecture du ${le}. `
      + 'Retirez-la du critère, ou choisissez parmi les collections lues.'
    : `${CRITERE} : les collections ${inconnues.join(', ')} ne sont pas connues, aucun produit commandé ne s’y trouvait à la `
      + `lecture du ${le}. Retirez-les du critère, ou choisissez parmi les collections lues.`;
}
