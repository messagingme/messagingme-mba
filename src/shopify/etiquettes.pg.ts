import type { Pool, PoolClient } from 'pg';
import { enTransaction } from '../db/transaction';
import { ficheActive } from '../crm/contact-store.pg';
import { BORNES_SEGMENTS, type EtiquetteShopifyVue, type SegmentShopifyVue } from '../../web/lib/partage/segments';
import type { SegmentLu } from './segments-lues';
import { SYNCHRO_PERIMEE_MINUTES, synchroVivante, type IssueSynchro } from './etiquettes-garde';

export { SYNCHRO_PERIMEE_MINUTES, type IssueSynchro };

/**
 * LES ÉTIQUETTES DES CLIENTS SHOPIFY (segments Shopify enrichis, lot 6b, migration 0319 ; lot 6b bis, migration 0326) :
 * les LIENS entre clients Shopify et fiches (`shopify_clients`, plusieurs à plusieurs : un client relie toutes les fiches
 * de ses numéros, une fiche tous les clients qui ont son numéro), les étiquettes que le marchand a posées sur ces clients
 * DANS SHOPIFY, par couple fiche-client (`shopify_etiquettes` : les étiquettes d'une fiche sont l'union de celles de ses
 * clients, et la lecture d'un client remplace en bloc les siennes seulement ; un lien défait emporte les siennes, en
 * cascade), les fiches déjà cherchées par leur téléphone (`shopify_fiches_cherchees` : la relecture quotidienne ne cherche
 * que les autres, le geste du marchand les efface toutes), et l'état de la synchronisation de l'espace
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
 * fiche. Un lien vers une fiche qui n'existe plus se défait ; un client dont aucune fiche n'existe plus est compté puis
 * oublié : ni son identifiant ni son téléphone ne restent.
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
 * `trouvesParTelephone`, les fiches reliées à un client de plus par leur téléphone ; `sansFiche`, les clients trouvés
 * ou lus dont aucune fiche n'existe plus ; `fichesEtiquetees`, les fiches qui portent au moins une étiquette à la fin.
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
/** Un client trouvé par le téléphone d'une fiche (l'un de ses numéros chez Shopify). */
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
  aChercher(tenantId: string, n: number, apres: string | null): Promise<FicheACherche[]>;
  ecrireRecherche(tenantId: string, jeton: string, r: { cherchees: readonly string[]; trouves: readonly ClientTrouve[]; complete: boolean }): Promise<{ relies: number } | null>;
  clientsALire(tenantId: string, curseur: string | null, n: number): Promise<string[]>;
  ecrireClients(tenantId: string, jeton: string, r: { lus: readonly ClientLu[]; curseur: string }): Promise<boolean>;
  finir(tenantId: string, jeton: string, issue: IssueSynchro, message: string | null): Promise<boolean>;
  etiquettes(tenantId: string, recherche: string | undefined, limite: number): Promise<EtiquetteShopifyVue[]>;
  /** Lot 6c : la liste des segments, écrite sous le jeton ; `complete` : un segment absent a disparu chez Shopify. */
  ecrireSegments(tenantId: string, jeton: string, r: { segments: readonly SegmentLu[]; complete: boolean }): Promise<boolean>;
  /** Le choix du marchand : les segments suivis, connus et encore chez Shopify ; un segment inconnu refuse tout le choix. */
  suivreSegments(tenantId: string, segmentIds: readonly string[]): Promise<{ inconnus: string[] }>;
  /**
   * Le prochain segment suivi à lire dans cette synchronisation, sous le jeton, hors `sauf` (ceux que le passage a laissés de
   * côté) ; `null` : tous lus ; `perdu` : le jeton ne tient plus.
   */
  prochainSegment(tenantId: string, jeton: string, sauf: readonly string[]): Promise<SegmentALire | null | 'perdu'>;
  /** La requête asynchrone d'un segment (son identifiant chez Shopify, ou `null` pour l'oublier), sous le jeton. */
  noterRequeteSegment(tenantId: string, jeton: string, segmentId: string, requete: string | null): Promise<boolean>;
  /**
   * Une page de membres écrite sous le jeton, seulement si la lecture en est à cette page (`apres`, le curseur lu) ; la
   * dernière (`suivant` nul) clôt la lecture du segment.
   */
  ecrirePageSegment(tenantId: string, jeton: string, segmentId: string, p: { apres: string | null; clients: readonly string[]; suivant: string | null }): Promise<boolean>;
  /** Les segments lus de l'espace, pour la carte, le volet et l'outil. */
  segments(tenantId: string): Promise<SegmentShopifyVue[]>;
}

/**
 * Un segment suivi à lire : son nom, où sa lecture en était (curseur de page, requête asynchrone) et quand elle a commencé
 * (la création de sa première requête asynchrone, ou sa première page), qui borne l'attente d'une requête.
 */
export interface SegmentALire { segmentId: string; nom: string; curseur: string | null; requete: string | null; lectureDebut: Date | null }

/** Le début de la synchronisation tenue : une lecture de segment plus ancienne appartient à une synchronisation morte. */
const DEBUT_SYNCHRO = `(select e.en_cours_depuis from shopify_etiquettes_synchro e where e.tenant_id = $1)`;
/** Un segment qui n'est plus lu : ni lecture en cours, ni membres comptés. */
const SANS_LECTURE = `lecture_debut = null, curseur = null, requete_asynchrone = null, lecture_membres = 0`;

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

/**
 * Les étiquettes de ces couples fiche-client, REMPLACÉES en bloc : celles que CE client avait données à CETTE fiche
 * partent, celles lues entrent ; celles des autres clients de la fiche restent. Le lien doit exister (clé étrangère de la
 * 0326). Jamais `contacts.tags`.
 */
async function remplacerEtiquettes(
  client: PoolClient, tenantId: string, couples: ReadonlyArray<{ contactId: string; clientId: string; etiquettes: readonly string[] }>,
): Promise<void> {
  if (couples.length === 0) return;
  await client.query(
    `delete from shopify_etiquettes e
      using jsonb_to_recordset($2::jsonb) as x(contact_id uuid, client_id text)
      where e.tenant_id = $1 and e.contact_id = x.contact_id and e.client_id = x.client_id`,
    [tenantId, JSON.stringify(couples.map((c) => ({ contact_id: c.contactId, client_id: c.clientId })))],
  );
  const lignes = couples.flatMap((c) => c.etiquettes.map((etiquette) => ({ contact_id: c.contactId, client_id: c.clientId, etiquette })));
  if (lignes.length === 0) return;
  await client.query(
    `insert into shopify_etiquettes (tenant_id, contact_id, client_id, etiquette)
     select $1, x.contact_id, x.client_id, x.etiquette from jsonb_to_recordset($2::jsonb) as x(contact_id uuid, client_id text, etiquette text)
     on conflict (tenant_id, contact_id, client_id, etiquette) do nothing`,
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
   * LE GESTE DU MARCHAND (allumer, « maintenant », `sync_shopify_customer_tags` : seuls appelants) demande une
   * synchronisation : la commence et rend sa date, À MOINS qu'une autre vive encore (une seule à la fois), ou,
   * `auPlusUneFoisParJour` (la Free), qu'une demande date de moins de 24 h. `null` : rien à enfiler. 🔴 Acceptée, elle
   * efface les marques des fiches déjà cherchées (lot 6b bis, décision de Julien du 2026-11-25) : toutes les fiches qui ont
   * un numéro sont cherchées de nouveau, un numéro corrigé chez Shopify se relie. Refusée, elle n'efface rien. La relecture
   * quotidienne (`dues`) ne les efface jamais : elle ne cherche que les fiches jamais cherchées.
   */
  async demander(tenantId: string, o: { auPlusUneFoisParJour: boolean }): Promise<Date | null> {
    const res = await this.pool.query<{ demandee_le: Date }>(
      `with demande as (
         insert into shopify_etiquettes_synchro as e (tenant_id, demandee_le, en_cours_depuis, maj_le) values ($1, now(), now(), now())
         on conflict (tenant_id) do update set ${RECOMMENCER}
          where not ${synchroVivante('e')}
            and (not $2::boolean or e.demandee_le is null or e.demandee_le < now() - make_interval(hours => $3))
         returning demandee_le
       ), marques as (
         delete from shopify_fiches_cherchees where tenant_id = $1 and exists (select 1 from demande)
       )
       select demandee_le from demande`,
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
   * Les fiches ACTIVES à chercher chez Shopify par leur téléphone : un téléphone, pas encore cherchées depuis le dernier
   * geste du marchand, reliées ou non (une fiche reliée peut avoir d'autres clients), après `apres` (le dernier téléphone
   * du lot précédent du même passage : le balayage ne repasse pas sur les fiches qu'il vient de marquer ; nul au début
   * d'un passage). Chaque lot cherché les marque. 🔴 Le prédicat de l'index partiel `contacts_tenant_phone_uidx`
   * (migration 0001, `phone_e164 is not null`) est repris mot pour mot ; l'index sert l'ordre et le curseur.
   */
  async aChercher(tenantId: string, n: number, apres: string | null): Promise<FicheACherche[]> {
    const res = await this.pool.query<{ id: string; phone_e164: string }>(
      `select x.id, x.phone_e164 from contacts x
        where x.tenant_id = $1 and x.phone_e164 is not null and ${ficheActive('x')}
          and ($3::text is null or x.phone_e164 > $3)
          and not exists (select 1 from shopify_fiches_cherchees m where m.tenant_id = $1 and m.contact_id = x.id)
        order by x.phone_e164
        limit $2`,
      [tenantId, Math.max(1, Math.round(n)), apres],
    );
    return res.rows.map((r) => ({ contactId: r.id, telephone: r.phone_e164 }));
  }

  /**
   * Écrit un lot cherché par téléphone, dans UNE transaction tenue par le jeton : chaque fiche ACTIVE cherchée est marquée,
   * chaque client trouvé est relié à chaque fiche ACTIVE de ses numéros (un client, plusieurs fiches ; une fiche, plusieurs
   * clients) et ses étiquettes sont écrites pour ce couple. 🔴 Une recherche COMPLÈTE (`complete`) dit TOUS les clients du
   * numéro d'une fiche cherchée : ses liens vers les autres clients se défont, avec leurs étiquettes (en cascade) ; une
   * page incomplète n'en défait aucun. Un client trouvé dont aucune fiche n'existe plus est compté puis oublié. `null` : le
   * jeton ne tient plus la synchronisation, rien n'est écrit.
   */
  async ecrireRecherche(
    tenantId: string, jeton: string, r: { cherchees: readonly string[]; trouves: readonly ClientTrouve[]; complete: boolean },
  ): Promise<{ relies: number } | null> {
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
      const couples = JSON.stringify(aRelier.map((t) => ({ client_id: t.clientId, contact_id: t.contactId })));
      if (r.complete && marquees.length > 0) {
        await client.query(
          `delete from shopify_clients l
            where l.tenant_id = $1 and l.contact_id = any($2::uuid[])
              and not exists (select 1 from jsonb_to_recordset($3::jsonb) as x(client_id text, contact_id uuid)
                               where x.client_id = l.client_id and x.contact_id = l.contact_id)`,
          [tenantId, marquees, couples],
        );
      }
      let fichesReliees = 0;
      if (aRelier.length > 0) {
        const nouveaux = (await client.query<{ contact_id: string }>(
          `insert into shopify_clients (tenant_id, client_id, contact_id, vu_le)
           select $1, x.client_id, x.contact_id, now() from jsonb_to_recordset($2::jsonb) as x(client_id text, contact_id uuid)
           on conflict (tenant_id, client_id, contact_id) do nothing
           returning contact_id`,
          [tenantId, couples],
        )).rows;
        fichesReliees = new Set(nouveaux.map((x) => x.contact_id)).size;
        await client.query(
          `update shopify_clients l set vu_le = now()
             from jsonb_to_recordset($2::jsonb) as x(client_id text, contact_id uuid)
            where l.tenant_id = $1 and l.client_id = x.client_id and l.contact_id = x.contact_id`,
          [tenantId, couples],
        );
        await remplacerEtiquettes(client, tenantId, aRelier);
      }
      // `clients_lus` ne compte pas ici : un client relié sera lu par son identifiant dans le même passage, et compté là,
      // une fois. Un client trouvé dont aucune fiche n'existe plus n'est compté que « sans fiche ».
      const relies = new Set(aRelier.map((t) => t.clientId));
      const sansFiche = new Set(r.trouves.filter((t) => !relies.has(t.clientId)).map((t) => t.clientId)).size;
      await avancer(client, tenantId, jeton, { clientsLus: 0, trouves: fichesReliees, sansFiche });
      return { relies: fichesReliees };
    });
  }

  /**
   * Les clients reliés à lire après `curseur`, dans l'ordre de leur identifiant, chacun une fois quel que soit son nombre de
   * fiches (la clé primaire, qui commence par `tenant_id, client_id`, sert la requête).
   */
  async clientsALire(tenantId: string, curseur: string | null, n: number): Promise<string[]> {
    const res = await this.pool.query<{ client_id: string }>(
      `select distinct l.client_id from shopify_clients l
        where l.tenant_id = $1 and ($2::text is null or l.client_id > $2)
        order by l.client_id
        limit $3`,
      [tenantId, curseur, Math.max(1, Math.round(n))],
    );
    return res.rows.map((r) => r.client_id);
  }

  /**
   * Écrit un lot de clients lus par leur identifiant, dans UNE transaction tenue par le jeton : pour chaque client, ses
   * étiquettes sur CHACUNE de ses fiches ACTIVES sont REMPLACÉES en bloc (celles des autres clients d'une fiche restent).
   * Un client qui n'existe plus chez Shopify perd tous ses liens (ses étiquettes partent avec, en cascade), et ses fiches
   * redeviennent à chercher par leur téléphone. Un lien vers une fiche qui n'existe plus se défait ; un client dont aucune
   * fiche n'existe plus est compté puis oublié. Le dernier client lu avance. `false` : le jeton ne tient plus.
   */
  async ecrireClients(tenantId: string, jeton: string, r: { lus: readonly ClientLu[]; curseur: string }): Promise<boolean> {
    return enTransaction(this.pool, async (client) => {
      if (!(await tenir(client, tenantId, jeton))) return false;
      const liens = r.lus.length === 0 ? [] : (await client.query<{ client_id: string; contact_id: string }>(
        `select l.client_id, l.contact_id from shopify_clients l where l.tenant_id = $1 and l.client_id = any($2::text[])`,
        [tenantId, r.lus.map((c) => c.clientId)],
      )).rows;
      const fichesDe = new Map<string, string[]>();
      for (const l of liens) fichesDe.set(l.client_id, [...(fichesDe.get(l.client_id) ?? []), l.contact_id]);
      const vivantes = await verrouillerFiches(client, tenantId, liens.map((l) => l.contact_id));
      const relies = r.lus.filter((c) => fichesDe.has(c.clientId));
      const disparus = relies.filter((c) => c.etiquettes === null);
      const presents = relies.filter((c) => c.etiquettes !== null);
      if (disparus.length > 0) {
        await client.query(`delete from shopify_clients where tenant_id = $1 and client_id = any($2::text[])`, [tenantId, disparus.map((c) => c.clientId)]);
        await client.query(
          `delete from shopify_fiches_cherchees where tenant_id = $1 and contact_id = any($2::uuid[])`,
          [tenantId, disparus.flatMap((c) => fichesDe.get(c.clientId)!)],
        );
      }
      const mortes = presents.flatMap((c) => fichesDe.get(c.clientId)!.filter((f) => !vivantes.has(f)).map((f) => ({ client_id: c.clientId, contact_id: f })));
      if (mortes.length > 0) {
        await client.query(
          `delete from shopify_clients l
             using jsonb_to_recordset($2::jsonb) as x(client_id text, contact_id uuid)
            where l.tenant_id = $1 and l.client_id = x.client_id and l.contact_id = x.contact_id`,
          [tenantId, JSON.stringify(mortes)],
        );
      }
      const couples = presents.flatMap((c) => fichesDe.get(c.clientId)!.filter((f) => vivantes.has(f))
        .map((f) => ({ contactId: f, clientId: c.clientId, etiquettes: c.etiquettes! })));
      const lus = new Set(couples.map((x) => x.clientId));
      if (couples.length > 0) {
        await client.query(`update shopify_clients set vu_le = now() where tenant_id = $1 and client_id = any($2::text[])`, [tenantId, [...lus]]);
        await remplacerEtiquettes(client, tenantId, couples);
      }
      await avancer(client, tenantId, jeton, { clientsLus: lus.size, trouves: 0, sansFiche: presents.length - lus.size, curseur: r.curseur });
      return true;
    });
  }

  /**
   * L'issue de la synchronisation, qui la clôt et rend son bail ; `lue` pose aussi la date et compte les fiches qui portent
   * au moins une étiquette. `false` : le jeton ne tient plus. 🔴 Une mise à jour, jamais une création : un job qui finit
   * après l'effacement du branchement ne ressuscite pas la ligne.
   */
  async finir(tenantId: string, jeton: string, issue: IssueSynchro, message: string | null): Promise<boolean> {
    // Lot 6c : un segment dont la lecture n'a pas abouti se dit partiel ; ses membres d'avant restent.
    if (issue !== 'lue') {
      await this.pool.query(
        `update shopify_segments s set partiel = true
          where s.tenant_id = $1 and s.lecture_debut is not null
            and exists (select 1 from shopify_etiquettes_synchro e where e.tenant_id = $1 and e.jeton = $2)`,
        [tenantId, jeton],
      );
    }
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

  /**
   * LOT 6c. La liste des segments lue chez Shopify, sous le jeton : chaque segment écrit (nom, requête, vu le) ; une liste
   * COMPLÈTE dit aussi les disparus : marqués `absent_le`, leurs membres et leur lecture partent, leur nom reste pour le
   * refus du critère. Une liste incomplète ne fait disparaître personne. `false` : le jeton ne tient plus.
   */
  async ecrireSegments(tenantId: string, jeton: string, r: { segments: readonly SegmentLu[]; complete: boolean }): Promise<boolean> {
    return enTransaction(this.pool, async (client) => {
      if (!(await tenir(client, tenantId, jeton))) return false;
      if (r.segments.length > 0) {
        await client.query(
          `insert into shopify_segments (tenant_id, segment_id, nom, requete, vu_le)
           select $1, x.segment_id, x.nom, x.requete, now() from jsonb_to_recordset($2::jsonb) as x(segment_id text, nom text, requete text)
           on conflict (tenant_id, segment_id) do update set nom = excluded.nom, requete = excluded.requete, vu_le = excluded.vu_le, absent_le = null`,
          [tenantId, JSON.stringify([...r.segments].sort((a, b) => (a.segmentId < b.segmentId ? -1 : a.segmentId > b.segmentId ? 1 : 0))
            .map((x) => ({ segment_id: x.segmentId, nom: x.nom, requete: x.requete })))],
        );
      }
      if (r.complete) {
        await client.query(
          `with disparus as (
             update shopify_segments s set absent_le = coalesce(s.absent_le, now()), lu_le = null, partiel = false, membres = 0, fiches = 0, ${SANS_LECTURE}
              where s.tenant_id = $1 and not (s.segment_id = any($2::text[])) and s.absent_le is null
              returning s.segment_id
           )
           delete from shopify_segment_membres m using disparus d where m.tenant_id = $1 and m.segment_id = d.segment_id`,
          [tenantId, r.segments.map((x) => x.segmentId)],
        );
      }
      return true;
    });
  }

  /**
   * LE CHOIX DU MARCHAND : les segments suivis deviennent exactement `segmentIds` (`segmentsShopifyMax` au plus, la route et
   * l'outil le vérifient avant), chacun connu et encore chez Shopify, sinon rien ne change et les inconnus sont rendus. Un
   * segment qui n'est plus suivi perd ses membres et sa lecture : le suivre de nouveau le relit. Le verrou de la ligne du
   * segment sérialise ce choix avec l'écriture d'une page (`ecrirePageSegment` ne l'écrit que suivi).
   */
  async suivreSegments(tenantId: string, segmentIds: readonly string[]): Promise<{ inconnus: string[] }> {
    const ids = [...new Set(segmentIds)].slice(0, BORNES_SEGMENTS.segmentsShopifyMax);
    return enTransaction(this.pool, async (client) => {
      const connus = new Set((await client.query<{ segment_id: string }>(
        `select segment_id from shopify_segments where tenant_id = $1 and segment_id = any($2::text[]) and absent_le is null
          order by segment_id for update`,
        [tenantId, ids],
      )).rows.map((x) => x.segment_id));
      const inconnus = ids.filter((id) => !connus.has(id));
      if (inconnus.length > 0) return { inconnus };
      await client.query(
        `with quittes as (
           update shopify_segments s set suivi = false, lu_le = null, partiel = false, membres = 0, fiches = 0, ${SANS_LECTURE}
            where s.tenant_id = $1 and s.suivi and not (s.segment_id = any($2::text[]))
            returning s.segment_id
         )
         delete from shopify_segment_membres m using quittes q where m.tenant_id = $1 and m.segment_id = q.segment_id`,
        [tenantId, ids],
      );
      await client.query(`update shopify_segments set suivi = true where tenant_id = $1 and segment_id = any($2::text[])`, [tenantId, ids]);
      return { inconnus: [] };
    });
  }

  /**
   * Le prochain segment SUIVI, encore chez Shopify, que cette synchronisation n'a pas encore lu en entier (lu avant son
   * début), dans l'ordre de son identifiant. Une lecture commencée par une synchronisation précédente repart de zéro.
   */
  async prochainSegment(tenantId: string, jeton: string, sauf: readonly string[]): Promise<SegmentALire | null | 'perdu'> {
    return enTransaction(this.pool, async (client) => {
      if (!(await tenir(client, tenantId, jeton))) return 'perdu' as const;
      await client.query(
        `update shopify_segments set ${SANS_LECTURE} where tenant_id = $1 and lecture_debut < ${DEBUT_SYNCHRO}`,
        [tenantId],
      );
      const res = await client.query<{ segment_id: string; nom: string; curseur: string | null; requete_asynchrone: string | null; lecture_debut: Date | null }>(
        `select s.segment_id, s.nom, s.curseur, s.requete_asynchrone, s.lecture_debut from shopify_segments s
          where s.tenant_id = $1 and s.suivi and s.absent_le is null and (s.lu_le is null or s.lu_le < ${DEBUT_SYNCHRO})
            and not (s.segment_id = any($2::text[]))
          order by s.segment_id limit 1`,
        [tenantId, [...sauf]],
      );
      const x = res.rows[0];
      return x ? { segmentId: x.segment_id, nom: x.nom, curseur: x.curseur, requete: x.requete_asynchrone, lectureDebut: x.lecture_debut } : null;
    });
  }

  /**
   * La requête asynchrone d'un segment suivi, sous le jeton ; la lecture reprend à sa première page, son compte à zéro.
   * Une requête créée date le début de la lecture (s'il n'est pas déjà daté) : c'est lui qui borne l'attente, même quand
   * une requête perdue est oubliée (`null`) puis recréée.
   */
  async noterRequeteSegment(tenantId: string, jeton: string, segmentId: string, requete: string | null): Promise<boolean> {
    return enTransaction(this.pool, async (client) => {
      if (!(await tenir(client, tenantId, jeton))) return false;
      await client.query(
        `update shopify_segments
            set requete_asynchrone = $3, curseur = null, lecture_membres = 0,
                lecture_debut = case when $3::text is null then lecture_debut else coalesce(lecture_debut, now()) end
          where tenant_id = $1 and segment_id = $2 and suivi and absent_le is null`,
        [tenantId, segmentId, requete],
      );
      return true;
    });
  }

  /**
   * UNE PAGE DE MEMBRES, sous le jeton : les fiches ACTIVES de ses clients (les liens de la synchronisation, tous leurs
   * numéros) entrent dans le segment, datées. La dernière page (`suivant` nul) CLÔT la lecture : les appartenances plus
   * anciennes que son début partent, les comptes s'écrivent. Jamais avant : une lecture inachevée ne rétrécit pas la cible.
   * Un segment qui n'est plus suivi (ou disparu) entre-temps n'est pas écrit. `false` : le jeton ne tient plus.
   */
  async ecrirePageSegment(tenantId: string, jeton: string, segmentId: string, p: { apres: string | null; clients: readonly string[]; suivant: string | null }): Promise<boolean> {
    return enTransaction(this.pool, async (client) => {
      if (!(await tenir(client, tenantId, jeton))) return false;
      const lecture = (await client.query<{ lecture_debut: Date }>(
        `update shopify_segments set lecture_debut = coalesce(lecture_debut, now()), lecture_membres = lecture_membres + $3, curseur = $4
          where tenant_id = $1 and segment_id = $2 and suivi and absent_le is null and curseur is not distinct from $5
          returning lecture_debut`,
        [tenantId, segmentId, p.clients.length, p.suivant, p.apres],
      )).rows[0];
      if (!lecture) return true;
      const fiches = p.clients.length === 0 ? [] : (await client.query<{ contact_id: string }>(
        `select distinct l.contact_id from shopify_clients l where l.tenant_id = $1 and l.client_id = any($2::text[])`,
        [tenantId, [...p.clients]],
      )).rows.map((x) => x.contact_id);
      const vivantes = [...(await verrouillerFiches(client, tenantId, fiches))];
      if (vivantes.length > 0) {
        await client.query(
          `insert into shopify_segment_membres (tenant_id, segment_id, contact_id, vu_le) select $1, $2, unnest($3::uuid[]), now()
           on conflict (tenant_id, segment_id, contact_id) do update set vu_le = excluded.vu_le`,
          [tenantId, segmentId, vivantes],
        );
      }
      if (p.suivant === null) {
        await client.query(
          `delete from shopify_segment_membres where tenant_id = $1 and segment_id = $2 and vu_le < $3`,
          [tenantId, segmentId, lecture.lecture_debut],
        );
        await client.query(
          `update shopify_segments s set lu_le = now(), partiel = false, membres = s.lecture_membres,
                  fiches = (select count(*)::int from shopify_segment_membres m where m.tenant_id = $1 and m.segment_id = $2), ${SANS_LECTURE}
            where s.tenant_id = $1 and s.segment_id = $2`,
          [tenantId, segmentId],
        );
      }
      await avancer(client, tenantId, jeton, { clientsLus: 0, trouves: 0, sansFiche: 0 });
      return true;
    });
  }

  /** Les segments lus de l'espace : suivis d'abord, puis par nom ; les disparus à la fin. */
  async segments(tenantId: string): Promise<SegmentShopifyVue[]> {
    const res = await this.pool.query<{
      segment_id: string; nom: string; requete: string | null; suivi: boolean; absent: boolean; lu_le: Date | null; partiel: boolean;
      membres: number; fiches: number;
    }>(
      `select segment_id, nom, requete, suivi, absent_le is not null as absent, lu_le, partiel or lecture_debut is not null as partiel, membres, fiches
         from shopify_segments where tenant_id = $1
        order by absent_le is not null, suivi desc, lower(nom), segment_id`,
      [tenantId],
    );
    return res.rows.map((x) => ({
      segmentId: x.segment_id, nom: x.nom, requete: x.requete, suivi: x.suivi, absent: x.absent,
      luLe: x.lu_le?.toISOString() ?? null, partiel: x.partiel, membres: x.membres, fiches: x.fiches,
    }));
  }
}
