import type { Pool, PoolClient } from 'pg';
import { enTransaction } from '../db/transaction';
import { ficheActive } from '../crm/contact-store.pg';
import type { EtiquetteShopifyVue } from '../../web/lib/partage/segments';
import { SYNCHRO_PERIMEE_MINUTES, synchroVivante, type IssueSynchro } from './etiquettes-garde';

export { SYNCHRO_PERIMEE_MINUTES, type IssueSynchro };

/**
 * LES ÉTIQUETTES DES CLIENTS SHOPIFY (segments Shopify enrichis, lot 6b, migration 0319) : le lien d'un client Shopify à
 * sa fiche (`shopify_clients`), les étiquettes que le marchand a posées sur ce client DANS SHOPIFY, sur sa fiche
 * (`shopify_etiquettes`, remplacées en bloc à chaque lecture réussie), les fiches déjà cherchées par leur téléphone
 * (`shopify_fiches_cherchees`, une fois chacune), et l'état de la synchronisation de l'espace
 * (`shopify_etiquettes_synchro`). Le job (`./etiquettes.ts`) les écrit ; le critère d'étiquette Shopify, le volet Shopify
 * des filtres, la carte Shopify et l'onglet Shopify de la fiche les lisent.
 *
 * 🔴 TROIS LISTES QUI NE SE MÉLANGENT PAS : ce magasin n'écrit JAMAIS `contacts.tags` (les étiquettes Messaging Me). Le
 * seul pont est la copie explicite (une action en masse ou `tag_contacts`, sur la cible du critère), jamais la synchro.
 *
 * 🔴 UNE SYNCHRONISATION À LA FOIS : pg-boss ne déduplique rien, deux jobs du même espace peuvent tourner ensemble. Le job
 * prend la synchronisation par un BAIL (`for update skip locked`, puis `bail_jusqua` et un JETON) ; toute écriture se fait
 * dans une transaction qui verrouille d'abord la ligne d'état PAR CE JETON : un porteur dont le bail a été repris n'écrit
 * plus rien. Un worker mort laisse son bail expirer, et un autre passage reprend au dernier client lu.
 *
 * 🔴 AUCUNE FICHE SUPPRIMÉE N'EST TOUCHÉE, AUCUNE FICHE N'EST CRÉÉE : avant d'écrire, la transaction verrouille les fiches
 * visées (`for key share`, en conflit avec le `for update` de `purgeMany`) et ne garde que les fiches ACTIVES ; une purge
 * en cours attend la fin de l'écriture puis efface ce qu'elle a écrit, ou l'écriture attend la purge et ne voit plus la
 * fiche. Un client dont la fiche n'existe plus est compté puis oublié : ni son identifiant ni son téléphone ne restent.
 *
 * 🔴 `tenant_id` sur CHAQUE requête et chaque sous-requête : le rôle de l'application contourne la RLS, ce filtre est le
 * seul contrôle. UNE EXCEPTION TRANSVERSE, nommée : `dues`, le balayage horaire des espaces dont la synchronisation est
 * ALLUMÉE (jamais de toutes les boutiques), qui joint chaque état à SA boutique par `tenant_id`.
 */

/** Le bail d'une synchronisation tenue : plus long qu'un lot lu (20 s au plus) et son écriture ; renouvelé à chaque écriture. */
export const BAIL_SYNCHRO_SECONDES = 180;
/** Pro et au-dessus : une relecture au plus toutes les 24 h ; Free : une demande au plus toutes les 24 h (plan, règle 3). */
export const RELECTURE_HEURES = 24;

/**
 * Les comptes d'une synchronisation : `clientsLus`, les clients lus par leur identifiant, chacun une fois ;
 * `trouvesParTelephone`, ceux reliés à une fiche par leur téléphone ; `sansFiche`, ceux trouvés ou lus dont la fiche
 * n'existe pas ou plus ; `fichesEtiquetees`, les fiches qui portent au moins une étiquette à la fin.
 */
export interface ComptesSynchro { clientsLus: number; trouvesParTelephone: number; sansFiche: number; fichesEtiquetees: number }

/** L'état de la synchronisation d'un espace, tel que la table le garde. */
export interface EtatSynchroEtiquettes {
  allumee: boolean;
  /** La dernière synchronisation aboutie ; nulle : aucune (le critère est refusé). */
  synchroLe: Date | null;
  demandeeLe: Date | null;
  /** Le début de la synchronisation en cours ; nul : aucune. */
  enCoursDepuis: Date | null;
  /** Le dernier progrès de la synchronisation en cours. */
  majLe: Date | null;
  issue: IssueSynchro | null;
  issueLe: Date | null;
  message: string | null;
  comptes: ComptesSynchro;
  /** Un job tient la synchronisation : son bail court encore. */
  tenue: boolean;
}

/** Un client lu chez Shopify par son identifiant : ses étiquettes, ou `null` s'il n'existe plus (supprimé, fusionné). */
export interface ClientLu { clientId: string; etiquettes: string[] | null }
/** Un client trouvé par le téléphone d'une fiche. */
export interface ClientTrouve { contactId: string; clientId: string; etiquettes: string[] }
/** Une fiche à chercher chez Shopify par son téléphone (E.164). */
export interface FicheACherche { contactId: string; telephone: string }

/** Ce que le job, la carte, le volet et l'outil demandent au magasin : `PgEtiquettesStore`, ou le faux des tests. */
export interface MagasinEtiquettes {
  etat(tenantId: string): Promise<EtatSynchroEtiquettes | null>;
  regler(tenantId: string, allumee: boolean): Promise<void>;
  demander(tenantId: string, o: { auPlusUneFoisParJour: boolean }): Promise<Date | null>;
  annulerDemande(tenantId: string, le: Date): Promise<void>;
  dues(limite: number): Promise<Array<{ tenantId: string; le: Date }>>;
  prendre(tenantId: string): Promise<{ jeton: string; curseur: string | null } | null>;
  relacher(tenantId: string, jeton: string): Promise<void>;
  aChercher(tenantId: string, n: number): Promise<FicheACherche[]>;
  ecrireRecherche(tenantId: string, jeton: string, r: { cherchees: readonly string[]; trouves: readonly ClientTrouve[] }): Promise<{ relies: number } | null>;
  clientsALire(tenantId: string, curseur: string | null, n: number): Promise<string[]>;
  ecrireClients(tenantId: string, jeton: string, r: { lus: readonly ClientLu[]; curseur: string }): Promise<boolean>;
  finir(tenantId: string, jeton: string, issue: IssueSynchro, message: string | null): Promise<boolean>;
  etiquettes(tenantId: string, recherche: string | undefined, limite: number): Promise<EtiquetteShopifyVue[]>;
}

/** Un message tient dans sa colonne (1 à 500 caractères) : vide, il devient nul. */
const messageEcrit = (m: string | null): string | null => (m === null || m.trim() === '' ? null : m.slice(0, 500));

/** Une synchronisation qui (re)commence : ses comptes de passage repartent de zéro, le dernier client lu aussi. */
const RECOMMENCER = `demandee_le = now(), en_cours_depuis = now(), maj_le = now(), curseur = null,
       clients_lus = 0, trouves_par_telephone = 0, sans_fiche = 0`;

interface LigneEtat {
  allumee: boolean; synchro_le: Date | null; demandee_le: Date | null; en_cours_depuis: Date | null; maj_le: Date | null;
  issue: IssueSynchro | null; issue_le: Date | null; message: string | null; clients_lus: number; trouves_par_telephone: number;
  sans_fiche: number; fiches_etiquetees: number; tenue: boolean;
}

/**
 * La ligne d'état tenue par CE jeton, verrouillée pour la transaction : sans elle (bail repris, synchronisation close ou
 * effacée avec le branchement), rien ne s'écrit.
 */
async function tenir(client: PoolClient, tenantId: string, jeton: string): Promise<boolean> {
  const r = await client.query(`select 1 from shopify_etiquettes_synchro where tenant_id = $1 and jeton = $2 for update`, [tenantId, jeton]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * Les fiches ACTIVES parmi `ids`, verrouillées (`for key share`) jusqu'à la fin de la transaction. 🔴 En conflit avec le
 * `for update` de `purgeMany` : une fiche purgée pendant l'écriture n'est pas rendue (le verrou attend la purge et relit la
 * ligne), et une purge qui arrive attend que l'écriture soit validée pour l'effacer.
 */
async function verrouillerFiches(client: PoolClient, tenantId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const r = await client.query<{ id: string }>(
    `select x.id from contacts x where x.tenant_id = $1 and x.id = any($2::uuid[]) and ${ficheActive('x')} order by x.id for key share`,
    [tenantId, [...new Set(ids)]],
  );
  return new Set(r.rows.map((x) => x.id));
}

/** Les étiquettes de ces fiches, REMPLACÉES en bloc : celles d'avant partent, celles lues entrent. Jamais `contacts.tags`. */
async function remplacerEtiquettes(client: PoolClient, tenantId: string, paires: ReadonlyArray<{ contactId: string; etiquettes: readonly string[] }>): Promise<void> {
  if (paires.length === 0) return;
  await client.query(`delete from shopify_etiquettes where tenant_id = $1 and contact_id = any($2::uuid[])`, [tenantId, paires.map((p) => p.contactId)]);
  const lignes = paires.flatMap((p) => p.etiquettes.map((etiquette) => ({ contact_id: p.contactId, etiquette })));
  if (lignes.length === 0) return;
  await client.query(
    `insert into shopify_etiquettes (tenant_id, contact_id, etiquette)
     select $1, x.contact_id, x.etiquette from jsonb_to_recordset($2::jsonb) as x(contact_id uuid, etiquette text)
     on conflict (tenant_id, contact_id, etiquette) do nothing`,
    [tenantId, JSON.stringify(lignes)],
  );
}

/** Le progrès d'une écriture : comptes ajoutés, bail renouvelé, dernier client lu s'il est donné. */
async function avancer(
  client: PoolClient, tenantId: string, jeton: string, p: { clientsLus: number; trouves: number; sansFiche: number; curseur?: string },
): Promise<void> {
  await client.query(
    `update shopify_etiquettes_synchro
        set clients_lus = clients_lus + $3, trouves_par_telephone = trouves_par_telephone + $4, sans_fiche = sans_fiche + $5,
            curseur = coalesce($6, curseur), maj_le = now(), bail_jusqua = now() + make_interval(secs => $7)
      where tenant_id = $1 and jeton = $2`,
    [tenantId, jeton, p.clientsLus, p.trouves, p.sansFiche, p.curseur ?? null, BAIL_SYNCHRO_SECONDES],
  );
}

export class PgEtiquettesStore implements MagasinEtiquettes {
  constructor(private readonly pool: Pool) {}

  async etat(tenantId: string): Promise<EtatSynchroEtiquettes | null> {
    const res = await this.pool.query<LigneEtat>(
      `select e.allumee, e.synchro_le, e.demandee_le, e.en_cours_depuis, e.maj_le, e.issue, e.issue_le, e.message, e.clients_lus,
              e.trouves_par_telephone, e.sans_fiche, e.fiches_etiquetees, (e.bail_jusqua is not null and e.bail_jusqua > now()) as tenue
         from shopify_etiquettes_synchro e
        where e.tenant_id = $1`,
      [tenantId],
    );
    const r = res.rows[0];
    return r ? {
      allumee: r.allumee, synchroLe: r.synchro_le, demandeeLe: r.demandee_le, enCoursDepuis: r.en_cours_depuis, majLe: r.maj_le,
      issue: r.issue, issueLe: r.issue_le, message: r.message, tenue: r.tenue,
      comptes: { clientsLus: r.clients_lus, trouvesParTelephone: r.trouves_par_telephone, sansFiche: r.sans_fiche, fichesEtiquetees: r.fiches_etiquetees },
    } : null;
  }

  /** Allume ou éteint la synchronisation (le réglage du marchand). Éteindre ne touche ni une synchronisation en cours, ni ce qui a été lu. */
  async regler(tenantId: string, allumee: boolean): Promise<void> {
    await this.pool.query(
      `insert into shopify_etiquettes_synchro (tenant_id, allumee) values ($1, $2)
       on conflict (tenant_id) do update set allumee = excluded.allumee`,
      [tenantId, allumee],
    );
  }

  /**
   * Demande une synchronisation : la commence et rend sa date, À MOINS qu'une autre vive encore (une seule à la fois), ou,
   * `auPlusUneFoisParJour` (la Free), qu'une demande date de moins de 24 h. `null` : rien à enfiler.
   */
  async demander(tenantId: string, o: { auPlusUneFoisParJour: boolean }): Promise<Date | null> {
    const res = await this.pool.query<{ demandee_le: Date }>(
      `insert into shopify_etiquettes_synchro as e (tenant_id, demandee_le, en_cours_depuis, maj_le) values ($1, now(), now(), now())
       on conflict (tenant_id) do update set ${RECOMMENCER}
        where not ${synchroVivante('e')}
          and (not $2::boolean or e.demandee_le is null or e.demandee_le < now() - make_interval(hours => $3))
       returning demandee_le`,
      [tenantId, o.auPlusUneFoisParJour, RELECTURE_HEURES],
    );
    return res.rows[0]?.demandee_le ?? null;
  }

  /**
   * Le job de cette demande n'a pas pu être enfilé : elle s'efface, et ne compte pas dans les 24 h de la Free. Comparée à
   * la MILLISECONDE (Postgres garde la microseconde de `now()`, `pg` rend une `Date` à la milliseconde), et seulement si
   * aucun job ne l'a prise.
   */
  async annulerDemande(tenantId: string, le: Date): Promise<void> {
    await this.pool.query(
      `update shopify_etiquettes_synchro set en_cours_depuis = null, demandee_le = null
        where tenant_id = $1 and jeton is null and date_trunc('milliseconds', demandee_le) = date_trunc('milliseconds', $2::timestamptz)`,
      [tenantId, le],
    );
  }

  /**
   * EXCEPTION TRANSVERSE : la relecture quotidienne (plan, règle 3), par le balayage horaire du worker. Seuls les espaces
   * dont la synchronisation est ALLUMÉE, dont la boutique est branchée, en Pro, Business ou Entreprise (jamais la Free, qui
   * lit à la demande), dont la dernière demande date de plus de 24 h et sans synchronisation vivante : chacun recommence
   * et rend sa date. `for update skip locked` : deux copies du worker ne prennent jamais le même espace.
   */
  async dues(limite: number): Promise<Array<{ tenantId: string; le: Date }>> {
    const res = await this.pool.query<{ tenant_id: string; demandee_le: Date }>(
      `with dues as (
         select e.tenant_id from shopify_etiquettes_synchro e
           join shopify_boutiques b on b.tenant_id = e.tenant_id
          where e.allumee and b.etat = 'connectee' and offre_de_l_espace(e.tenant_id) <> 'base'
            and (e.demandee_le is null or e.demandee_le < now() - make_interval(hours => $1))
            and not ${synchroVivante('e')}
          order by e.demandee_le nulls first
          limit $2
          for update of e skip locked
       )
       update shopify_etiquettes_synchro s set ${RECOMMENCER}
         from dues where s.tenant_id = dues.tenant_id
       returning s.tenant_id, s.demandee_le`,
      [RELECTURE_HEURES, Math.max(1, Math.round(limite))],
    );
    return res.rows.map((r) => ({ tenantId: r.tenant_id, le: r.demandee_le }));
  }

  /**
   * Prend le bail d'une synchronisation commencée dont le bail est libre ou mort : un jeton neuf, et le dernier client lu
   * pour reprendre. `null` : aucune synchronisation commencée, ou tenue par un autre passage. `skip locked` : le job ne
   * s'arrête jamais derrière une écriture en cours.
   */
  async prendre(tenantId: string): Promise<{ jeton: string; curseur: string | null } | null> {
    const res = await this.pool.query<{ jeton: string; curseur: string | null }>(
      `with libre as (
         select tenant_id from shopify_etiquettes_synchro
          where tenant_id = $1 and en_cours_depuis is not null and (bail_jusqua is null or bail_jusqua < now())
          for update skip locked
       )
       update shopify_etiquettes_synchro e set jeton = gen_random_uuid(), bail_jusqua = now() + make_interval(secs => $2), maj_le = now()
         from libre
        where e.tenant_id = $1 and e.tenant_id = libre.tenant_id
       returning e.jeton, e.curseur`,
      [tenantId, BAIL_SYNCHRO_SECONDES],
    );
    return res.rows[0] ?? null;
  }

  /** La fin d'un passage dont la suite est réenfilée, ou une panne : le bail se libère, la synchronisation reste commencée. */
  async relacher(tenantId: string, jeton: string): Promise<void> {
    await this.pool.query(
      `update shopify_etiquettes_synchro set bail_jusqua = null, jeton = null, maj_le = now() where tenant_id = $1 and jeton = $2`,
      [tenantId, jeton],
    );
  }

  /**
   * Les fiches ACTIVES à chercher chez Shopify par leur téléphone : un téléphone, aucun client relié, jamais cherchées.
   * Chaque lot cherché les relie ou les marque : la liste rétrécit, sans curseur. 🔴 Le prédicat de l'index partiel
   * `contacts_tenant_phone_uidx` (migration 0001, `phone_e164 is not null`) est repris mot pour mot.
   */
  async aChercher(tenantId: string, n: number): Promise<FicheACherche[]> {
    const res = await this.pool.query<{ id: string; phone_e164: string }>(
      `select x.id, x.phone_e164 from contacts x
        where x.tenant_id = $1 and x.phone_e164 is not null and ${ficheActive('x')}
          and not exists (select 1 from shopify_clients l where l.tenant_id = $1 and l.contact_id = x.id)
          and not exists (select 1 from shopify_fiches_cherchees m where m.tenant_id = $1 and m.contact_id = x.id)
        order by x.phone_e164
        limit $2`,
      [tenantId, Math.max(1, Math.round(n))],
    );
    return res.rows.map((r) => ({ contactId: r.id, telephone: r.phone_e164 }));
  }

  /**
   * Écrit un lot cherché par téléphone, dans UNE transaction tenue par le jeton : chaque fiche ACTIVE cherchée est marquée
   * (une fois suffit), chaque client trouvé est relié à sa fiche ACTIVE (s'il n'est pas déjà celui d'une autre fiche) et ses
   * étiquettes sont écrites. Un client trouvé dont la fiche n'existe plus est compté puis oublié. `null` : le jeton ne tient
   * plus la synchronisation, rien n'est écrit.
   */
  async ecrireRecherche(tenantId: string, jeton: string, r: { cherchees: readonly string[]; trouves: readonly ClientTrouve[] }): Promise<{ relies: number } | null> {
    return enTransaction(this.pool, async (client) => {
      if (!(await tenir(client, tenantId, jeton))) return null;
      const vivantes = await verrouillerFiches(client, tenantId, [...r.cherchees, ...r.trouves.map((t) => t.contactId)]);
      const marquees = r.cherchees.filter((id) => vivantes.has(id));
      if (marquees.length > 0) {
        await client.query(
          `insert into shopify_fiches_cherchees (tenant_id, contact_id) select $1, unnest($2::uuid[])
           on conflict (tenant_id, contact_id) do nothing`,
          [tenantId, marquees],
        );
      }
      const aRelier = r.trouves.filter((t) => vivantes.has(t.contactId));
      const relies = aRelier.length === 0 ? [] : (await client.query<{ client_id: string; contact_id: string }>(
        `insert into shopify_clients (tenant_id, client_id, contact_id, vu_le)
         select $1, x.client_id, x.contact_id, now() from jsonb_to_recordset($2::jsonb) as x(client_id text, contact_id uuid)
         on conflict do nothing
         returning client_id, contact_id`,
        [tenantId, JSON.stringify(aRelier.map((t) => ({ client_id: t.clientId, contact_id: t.contactId })))],
      )).rows;
      const etiquettesDe = new Map(aRelier.map((t) => [t.contactId, t.etiquettes]));
      await remplacerEtiquettes(client, tenantId, relies.map((x) => ({ contactId: x.contact_id, etiquettes: etiquettesDe.get(x.contact_id) ?? [] })));
      // `clients_lus` ne compte pas ici : un client relié sera lu par son identifiant dans le même passage, et compté là,
      // une fois. Un client trouvé sans fiche n'est compté que « sans fiche ».
      await avancer(client, tenantId, jeton, { clientsLus: 0, trouves: relies.length, sansFiche: r.trouves.length - aRelier.length });
      return { relies: relies.length };
    });
  }

  /** Les clients reliés à lire après `curseur`, dans l'ordre de leur identifiant (la clé primaire sert la requête). */
  async clientsALire(tenantId: string, curseur: string | null, n: number): Promise<string[]> {
    const res = await this.pool.query<{ client_id: string }>(
      `select l.client_id from shopify_clients l
        where l.tenant_id = $1 and ($2::text is null or l.client_id > $2)
        order by l.client_id
        limit $3`,
      [tenantId, curseur, Math.max(1, Math.round(n))],
    );
    return res.rows.map((r) => r.client_id);
  }

  /**
   * Écrit un lot de clients lus par leur identifiant, dans UNE transaction tenue par le jeton : les étiquettes de chaque
   * fiche ACTIVE sont REMPLACÉES en bloc ; un client qui n'existe plus chez Shopify perd son lien, ses étiquettes et la
   * marque de sa fiche (qui sera cherchée une fois de plus par son téléphone) ; un client dont la fiche n'existe plus perd
   * son lien et ses étiquettes, compté puis oublié. Le dernier client lu avance. `false` : le jeton ne tient plus.
   */
  async ecrireClients(tenantId: string, jeton: string, r: { lus: readonly ClientLu[]; curseur: string }): Promise<boolean> {
    return enTransaction(this.pool, async (client) => {
      if (!(await tenir(client, tenantId, jeton))) return false;
      const liens = r.lus.length === 0 ? [] : (await client.query<{ client_id: string; contact_id: string }>(
        `select l.client_id, l.contact_id from shopify_clients l where l.tenant_id = $1 and l.client_id = any($2::text[])`,
        [tenantId, r.lus.map((c) => c.clientId)],
      )).rows;
      const ficheDe = new Map(liens.map((l) => [l.client_id, l.contact_id]));
      const vivantes = await verrouillerFiches(client, tenantId, [...ficheDe.values()]);
      const relies = r.lus.filter((c) => ficheDe.has(c.clientId));
      const disparus = relies.filter((c) => c.etiquettes === null);
      const sansFiche = relies.filter((c) => c.etiquettes !== null && !vivantes.has(ficheDe.get(c.clientId)!));
      const presents = relies.filter((c) => c.etiquettes !== null && vivantes.has(ficheDe.get(c.clientId)!));
      const oublies = [...disparus, ...sansFiche];
      if (oublies.length > 0) {
        const fiches = oublies.map((c) => ficheDe.get(c.clientId)!);
        await client.query(`delete from shopify_clients where tenant_id = $1 and client_id = any($2::text[])`, [tenantId, oublies.map((c) => c.clientId)]);
        await client.query(`delete from shopify_fiches_cherchees where tenant_id = $1 and contact_id = any($2::uuid[])`, [tenantId, fiches]);
        await client.query(`delete from shopify_etiquettes where tenant_id = $1 and contact_id = any($2::uuid[])`, [tenantId, fiches]);
      }
      if (presents.length > 0) {
        await client.query(`update shopify_clients set vu_le = now() where tenant_id = $1 and client_id = any($2::text[])`, [tenantId, presents.map((c) => c.clientId)]);
        await remplacerEtiquettes(client, tenantId, presents.map((c) => ({ contactId: ficheDe.get(c.clientId)!, etiquettes: c.etiquettes! })));
      }
      await avancer(client, tenantId, jeton, { clientsLus: presents.length, trouves: 0, sansFiche: sansFiche.length, curseur: r.curseur });
      return true;
    });
  }

  /**
   * L'issue de la synchronisation, qui la clôt et rend son bail ; `lue` pose aussi la date et compte les fiches qui portent
   * au moins une étiquette. `false` : le jeton ne tient plus. 🔴 Une mise à jour, jamais une création : un job qui finit
   * après l'effacement du branchement ne ressuscite pas la ligne.
   */
  async finir(tenantId: string, jeton: string, issue: IssueSynchro, message: string | null): Promise<boolean> {
    const res = await this.pool.query(
      `update shopify_etiquettes_synchro
          set issue = $3, issue_le = now(), message = $4,
              synchro_le = case when $3 = 'lue' then now() else synchro_le end,
              fiches_etiquetees = case when $3 = 'lue'
                then (select count(distinct t.contact_id)::int from shopify_etiquettes t where t.tenant_id = $1)
                else fiches_etiquetees end,
              en_cours_depuis = null, curseur = null, maj_le = now(), bail_jusqua = null, jeton = null
        where tenant_id = $1 and jeton = $2`,
      [tenantId, jeton, issue, messageEcrit(message)],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Les étiquettes lues de l'espace, celles que portent le plus de fiches d'abord, au plus `limite`, regroupées sans la
   * casse (l'écriture la plus fréquente est rendue). `recherche` cherche dans le texte, sans la casse, ses `%` et `_` pris
   * à la lettre.
   */
  async etiquettes(tenantId: string, recherche: string | undefined, limite: number): Promise<EtiquetteShopifyVue[]> {
    const brut = recherche?.trim() ?? '';
    const motif = brut === '' ? null : `%${brut.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const res = await this.pool.query<{ etiquette: string; fiches: number }>(
      `select mode() within group (order by e.etiquette) as etiquette, count(distinct e.contact_id)::int as fiches
         from shopify_etiquettes e
        where e.tenant_id = $1 and ($2::text is null or e.etiquette ilike $2)
        group by lower(e.etiquette)
        order by fiches desc, lower(e.etiquette)
        limit $3`,
      [tenantId, motif, Math.max(1, Math.round(limite))],
    );
    return res.rows.map((r) => ({ etiquette: r.etiquette, fiches: r.fiches }));
  }
}
