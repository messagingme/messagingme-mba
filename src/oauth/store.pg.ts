import type { Pool, PoolClient } from 'pg';
import { DUREE_CODE_S } from './jetons';
import { roleAdminEffectifSql, type HorsOffreMembre } from '../offres/membres';
import { enTransaction } from '../db/transaction';

/**
 * Les autorisations OAuth et leurs codes (migration 0204).
 *
 * 🔴 `tenant_id = $1` SUR CHAQUE REQUÊTE D'UN ESPACE (`lister`, `revoquer`) : le pooler contourne la RLS, ce filtre
 * est le seul contrôle d'isolation. Les autres requêtes partent d'une EMPREINTE (jeton, code) : comme `parCode` des
 * widgets, c'est l'empreinte qui désigne la ligne, et la ligne qui rend l'espace.
 * 🔴 Seules des empreintes entrent et sortent d'ici : jamais un jeton, un code ni un vérificateur PKCE.
 */

/** Ce que la garde de `/mcp` lit d'un jeton d'accès, en une requête. */
export interface AccesOauth {
  autorisationId: string;
  tenantId: string;
  userId: string;
  scopes: string[];
  tenantStatus: string;
  /**
   * Faux si l'autorisation est révoquée, son jeton d'accès échu, le compte désactivé ou plus admin. Le rôle est
   * relu ici à chaque appel, jamais figé dans le jeton : un admin rétrogradé perd l'accès à l'appel suivant.
   */
  valide: boolean;
}

/**
 * Un accès résolu, avec le gel des membres (lot 6, B2a) : `horsOffre` dit si la personne du jeton dépasse les limites de
 * l'offre de son espace. Le magasin ne le sait pas (il faut l'offre) : l'API l'enveloppe (`src/index.ts`), et le
 * compilateur refuse de monter la garde sur le magasin seul.
 */
export type AccesOauthResolu = AccesOauth & { horsOffre: HorsOffreMembre | null };

/** L'interface étroite de la garde (`makeRequireApiKey`), comme `ApiKeyLookup` pour les clés. */
export interface AccesOauthLookup {
  resoudreAcces(empreinte: string): Promise<AccesOauthResolu | null>;
}

export interface NouvelleAutorisation {
  tenantId: string;
  userId: string;
  clientId: string;
  scopes: readonly string[];
  resource: string;
  code: { empreinte: string; challenge: string; redirectUri: string };
  /** Lot 15 : le client affiché, pour la liste des applications autorisées. Absent pour Claude et Claude Code. */
  client?: { nom: string; marque: 'domaine' | 'declaree'; hote: string };
}

export interface CodeConsomme {
  autorisationId: string;
  tenantId: string;
  clientId: string;
  challenge: string;
  redirectUri: string;
  scopes: string[];
  resource: string;
}

/** Les empreintes d'une paire de jetons neuve, et leurs échéances. */
export interface NouveauxJetons {
  acces: string;
  refresh: string;
  accesExpireLe: Date;
  refreshExpireLe: Date;
}

/** Une ligne de « Applications autorisées » : ni empreinte, ni échéance de jeton. */
export interface AutorisationListee {
  id: string;
  clientId: string;
  userId: string;
  email: string;
  nom: string | null;
  scopes: string[];
  creeLe: string;
  dernierUsageLe: string | null;
  /** Lot 15 : le nom, la marque et l'hôte de retour d'un client non épinglé ; `null` pour Claude et Claude Code. */
  clientNom: string | null;
  clientMarque: 'domaine' | 'declaree' | null;
  clientHote: string | null;
  /** Ce que l'application a créé et qui vit encore : la révocation par un admin le coupe (lot D de l'audit). */
  creations: CreationsDeLApplication;
  /**
   * Faux pour une application dont l'accès est fini (déconnectée par elle-même, jeton rejoué, fin de vie) et qui reste
   * listée parce que ce qu'elle a créé vit encore : un admin peut encore le couper (décision de Julien du 2026-11-06).
   */
  connectee: boolean;
}

/** Une création refusée parce que l'autorisation de l'application qui la demande vient d'être révoquée (lot D de l'audit). */
export const AUTORISATION_REVOQUEE = 'autorisation_revoquee' as const;

/**
 * Une autorisation vivante : non révoquée, avec un renouvellement encore valide. Celles dont le code n'a jamais été
 * échangé ne servent à rien. Écrite une fois, pour la liste et le drapeau `connectee`.
 */
const VIVANTE = `(a.revoque_le is null and a.refresh_hash is not null and least(a.refresh_expire_le, a.refresh_max_le) > now())`;

/**
 * L'autorisation `a` porte-t-elle encore une création vivante (une clé active, une adresse active) ? `tenant_id` y est
 * reposé : le lien seul ne suffit pas à l'isolation. Servi par les index partiels de 0282.
 */
const CREATIONS_VIVANTES = `(exists (select 1 from api_keys k where k.tenant_id = a.tenant_id and k.oauth_autorisation_id = a.id and k.revoked_at is null)
  or exists (select 1 from adresses_evenements e where e.tenant_id = a.tenant_id and e.oauth_autorisation_id = a.id and e.active))`;

/**
 * Ce qu'une application connectée a créé d'accès durable sous son autorisation (lot D de l'audit, migration 0282) : ses
 * clés d'API actives et ses adresses de webhook actives. La liste des applications le nomme avant la révocation, la
 * révocation rend ce qu'elle a effectivement coupé.
 */
export interface CreationsDeLApplication {
  cles: Array<{ id: string; name: string }>;
  adresses: Array<{ id: string; url: string }>;
}

/**
 * 🔴 LE CONTRAT ENTRE UNE CRÉATION ET LA RÉVOCATION (lot D de l'audit). Une clé ou une adresse créée sous une
 * autorisation passe ici, dans la transaction de son insertion et AVANT elle : l'autorisation est verrouillée en partage
 * si elle vit encore dans l'espace. `false` = révoquée, ou d'un autre espace : rien ne doit être créé.
 * Le verrou `FOR SHARE` bloque l'`update` de la révocation (un `FOR NO KEY UPDATE`) jusqu'à la fin de la création, qui
 * la coupe alors dans sa seconde instruction (nouvel instantané en `read committed`) ; une création qui arrive après la
 * révocation ne retrouve plus la ligne. Le verrou que pose la clé étrangère à l'insertion (`FOR KEY SHARE`) ne bloque
 * PAS cet `update` : sans celui-ci, une création en vol survivrait à la révocation.
 */
export async function verrouillerAutorisationVivante(client: Pick<PoolClient, 'query'>, tenantId: string, autorisationId: string): Promise<boolean> {
  const res = await client.query(
    `select 1 from oauth_autorisations where id = $1 and tenant_id = $2 and revoque_le is null for share`,
    [autorisationId, tenantId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** La purge efface par paquets : une rafale de lignes mortes ne tient jamais un verrou long. */
const PAQUET_PURGE = 1000;

/**
 * Une autorisation morte : révoquée, ou dont le renouvellement est échu (30 jours sans usage ou 90 jours au plus),
 * ou dont le code n'a jamais été échangé (`cree_le`). `least` ignore un nul : sans jetons, on retombe sur `cree_le`.
 */
const FIN_DE_VIE = `coalesce(revoque_le, least(refresh_expire_le, refresh_max_le), cree_le)`;

export class PgOauthStore {
  constructor(private readonly pool: Pool) {}

  /** L'autorisation et son code, ensemble ou pas du tout : un code sans autorisation, ou l'inverse, ne sert à rien. */
  async creerAutorisation(e: NouvelleAutorisation): Promise<{ autorisationId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const res = await client.query<{ id: string }>(
        `insert into oauth_autorisations (tenant_id, user_id, client_id, scopes, resource, client_nom, client_marque, client_hote)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [e.tenantId, e.userId, e.clientId, e.scopes, e.resource, e.client?.nom ?? null, e.client?.marque ?? null, e.client?.hote ?? null],
      );
      const autorisationId = res.rows[0]!.id;
      await client.query(
        `insert into oauth_codes (hash, autorisation_id, code_challenge, redirect_uri, expire_le)
         values ($1, $2, $3, $4, now() + make_interval(secs => $5::float8))`,
        [e.code.empreinte, autorisationId, e.code.challenge, e.code.redirectUri, DUREE_CODE_S],
      );
      await client.query('commit');
      return { autorisationId };
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Consomme un code : une seule fois, même en concurrence (l'`update` conditionnel ne fait gagner qu'un des
   * deux), et seulement avant son échéance. Le code est brûlé même si l'échange échoue ensuite (PKCE faux) : un
   * vérificateur ne se devine pas en plusieurs essais. `null` aussi pour une autorisation déjà révoquée.
   */
  async consommerCode(empreinte: string): Promise<CodeConsomme | null> {
    const res = await this.pool.query<{
      autorisation_id: string; tenant_id: string; client_id: string; code_challenge: string; redirect_uri: string;
      scopes: string[]; resource: string;
    }>(
      `with c as (
         update oauth_codes set utilise_le = now()
          where hash = $1 and utilise_le is null and expire_le > now()
         returning autorisation_id, code_challenge, redirect_uri
       )
       select c.autorisation_id, a.tenant_id, a.client_id, c.code_challenge, c.redirect_uri, a.scopes, a.resource
         from c join oauth_autorisations a on a.id = c.autorisation_id
        where a.revoque_le is null`,
      [empreinte],
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      autorisationId: r.autorisation_id, tenantId: r.tenant_id, clientId: r.client_id, challenge: r.code_challenge,
      redirectUri: r.redirect_uri, scopes: r.scopes, resource: r.resource,
    };
  }

  /**
   * Pose la première paire de jetons d'une autorisation, au premier échange de son code. `false` si elle en porte
   * déjà une ou si elle a été révoquée entre-temps. `refreshMaxLe` est fixé ici, une fois : le renouvellement ne le
   * repousse jamais.
   */
  async poserJetons(autorisationId: string, j: NouveauxJetons & { refreshMaxLe: Date }): Promise<boolean> {
    const res = await this.pool.query(
      `update oauth_autorisations
          set acces_hash = $2, acces_expire_le = $3, refresh_hash = $4,
              refresh_expire_le = least($5::timestamptz, $6::timestamptz), refresh_max_le = $6
        where id = $1 and revoque_le is null and refresh_hash is null`,
      [autorisationId, j.acces, j.accesExpireLe, j.refresh, j.refreshExpireLe, j.refreshMaxLe],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Renouvelle : le jeton présenté passe en `refresh_precedent_hash`, une paire neuve prend sa place.
   *
   * 🔴 UN ANCIEN JETON PRÉSENTÉ RÉVOQUE TOUTE L'AUTORISATION (RFC 9700, 4.14) et rend `rejeu` : c'est le signe qu'il
   * a fui. Deux renouvellements simultanés du même jeton y mènent aussi : le second attend le verrou de ligne du
   * premier, ne retrouve plus son empreinte en cours, et la trouve en précédente. Accepté par la spec.
   *
   * Refusé (`inconnu`) : un jeton inconnu, échu, d'un autre client, ou dont la personne n'est plus admin, est
   * désactivée, ou n'a pas accepté son invitation (lot identité C : une autorisation donnée avant le lot à un compte
   * jamais accepté ne survit pas). Un espace suspendu n'est PAS refusé ici : `/mcp` lui rend 403, et refuser le
   * renouvellement relancerait la connexion en boucle.
   */
  async renouveler(empreinteRefresh: string, clientId: string, nouveaux: NouveauxJetons): Promise<'ok' | 'rejeu' | 'inconnu'> {
    const tourne = await this.pool.query(
      `update oauth_autorisations a
          set refresh_precedent_hash = a.refresh_hash, refresh_hash = $3,
              acces_hash = $4, acces_expire_le = $5, refresh_expire_le = least($6::timestamptz, a.refresh_max_le),
              dernier_usage_le = now()
         from users u
        where a.refresh_hash = $1 and a.client_id = $2 and a.revoque_le is null
          and a.refresh_expire_le > now() and a.refresh_max_le > now()
          and u.id = a.user_id and u.tenant_id = a.tenant_id and ${roleAdminEffectifSql('u')} and u.disabled_at is null
          and not u.invitation_en_attente`,
      [empreinteRefresh, clientId, nouveaux.refresh, nouveaux.acces, nouveaux.accesExpireLe, nouveaux.refreshExpireLe],
    );
    if ((tourne.rowCount ?? 0) > 0) return 'ok';
    const rejeu = await this.pool.query(
      `update oauth_autorisations set revoque_le = coalesce(revoque_le, now())
        where refresh_precedent_hash = $1`,
      [empreinteRefresh],
    );
    return (rejeu.rowCount ?? 0) > 0 ? 'rejeu' : 'inconnu';
  }

  /**
   * Le jeton d'accès, sa personne et son espace, en une requête : la garde la fait à chaque appel. Le dernier usage
   * s'écrit dans la même requête, au plus une fois par minute, et seulement pour un accès valide. Un compte qui n'a pas
   * accepté son invitation n'en a aucun (lot identité C).
   */
  async resoudreAcces(empreinte: string): Promise<AccesOauth | null> {
    const res = await this.pool.query<{
      id: string; tenant_id: string; user_id: string; scopes: string[]; tenant_status: string; valide: boolean;
    }>(
      `with a as (
         select a.id, a.tenant_id, a.user_id, a.scopes, t.status as tenant_status, a.dernier_usage_le,
                coalesce(a.revoque_le is null and a.acces_expire_le > now()
                         and u.disabled_at is null and not u.invitation_en_attente and ${roleAdminEffectifSql('u')}, false) as valide
           from oauth_autorisations a
           join users u on u.id = a.user_id and u.tenant_id = a.tenant_id
           join tenants t on t.id = a.tenant_id
          where a.acces_hash = $1
       ), touche as (
         update oauth_autorisations o set dernier_usage_le = now()
           from a
          where o.id = a.id and a.valide
            and (a.dernier_usage_le is null or a.dernier_usage_le < now() - interval '1 minute')
       )
       select id, tenant_id, user_id, scopes, tenant_status, valide from a`,
      [empreinte],
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      autorisationId: r.id, tenantId: r.tenant_id, userId: r.user_id, scopes: r.scopes, tenantStatus: r.tenant_status,
      valide: r.valide,
    };
  }

  /**
   * La révocation par le client (RFC 7009) : son jeton d'accès ou de renouvellement révoque toute l'autorisation.
   * `false` pour un jeton inconnu ou déjà révoqué ; la route rend 200 dans les deux cas.
   */
  async revoquerParJeton(empreinte: string): Promise<boolean> {
    const res = await this.pool.query(
      `update oauth_autorisations set revoque_le = now()
        where (acces_hash = $1 or refresh_hash = $1) and revoque_le is null`,
      [empreinte],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Les applications de l'espace, la plus récente d'abord : les autorisations vivantes, et celles dont l'accès est fini
   * (déconnectée par elle-même, jeton rejoué, fin de vie) tant qu'une de leurs créations vit encore (`connectee` faux).
   * 🔴 Sans ces dernières, une application malveillante qui se déconnecte juste après avoir créé sa clé disparaîtrait de
   * la liste, et l'admin ne pourrait plus couper ce qu'elle a laissé (critique du lot D, décision de Julien du
   * 2026-11-06). Celles dont le code n'a jamais été échangé ne créent rien et n'y figurent pas.
   */
  async lister(tenantId: string): Promise<AutorisationListee[]> {
    const res = await this.pool.query<{
      id: string; client_id: string; user_id: string; email: string; name: string | null; scopes: string[];
      cree_le: Date; dernier_usage_le: Date | null; client_nom: string | null; client_marque: 'domaine' | 'declaree' | null;
      client_hote: string | null; cles: Array<{ id: string; name: string }>; adresses: Array<{ id: string; url: string }>;
      connectee: boolean;
    }>(
      // Les créations vivantes de chaque autorisation, servies par les index partiels de 0282 ; `tenant_id` y est
      // reposé, le lien seul ne suffit pas à l'isolation.
      `select a.id, a.client_id, a.user_id, u.email, u.name, a.scopes, a.cree_le, a.dernier_usage_le,
              a.client_nom, a.client_marque, a.client_hote, ${VIVANTE} as connectee,
              coalesce((select json_agg(json_build_object('id', k.id, 'name', k.name) order by k.created_at, k.id)
                          from api_keys k
                         where k.tenant_id = a.tenant_id and k.oauth_autorisation_id = a.id and k.revoked_at is null), '[]'::json) as cles,
              coalesce((select json_agg(json_build_object('id', e.id, 'url', e.url) order by e.cree_le, e.id)
                          from adresses_evenements e
                         where e.tenant_id = a.tenant_id and e.oauth_autorisation_id = a.id and e.active), '[]'::json) as adresses
         from oauth_autorisations a join users u on u.id = a.user_id and u.tenant_id = a.tenant_id
        where a.tenant_id = $1 and (${VIVANTE} or ${CREATIONS_VIVANTES})
        order by a.cree_le desc`,
      [tenantId],
    );
    return res.rows.map((r) => ({
      id: r.id, clientId: r.client_id, userId: r.user_id, email: r.email, nom: r.name, scopes: r.scopes,
      creeLe: r.cree_le.toISOString(), dernierUsageLe: r.dernier_usage_le ? r.dernier_usage_le.toISOString() : null,
      clientNom: r.client_nom, clientMarque: r.client_marque, clientHote: r.client_hote,
      creations: { cles: r.cles, adresses: r.adresses }, connectee: r.connectee,
    }));
  }

  /**
   * Révoque une autorisation de l'espace, et dans la MÊME transaction ce que l'application a créé sous elle (lot D de
   * l'audit, migration 0282) : ses clés d'API actives sont révoquées, ses adresses de webhook actives mises en pause.
   * L'autorisation peut être déjà finie (déconnectée par l'application, jeton rejoué, fin de vie) : la liste la montre tant
   * qu'une création vit, et la révoquer coupe celles-ci. Rend ce qui a été coupé ; `null` si l'autorisation est inconnue,
   * d'un autre espace, ou déjà révoquée sans plus rien à couper.
   * 🔴 C'est le SEUL geste qui coupe les créations (décision de Julien du 2026-11-06) : `revoquerParJeton`, le rejeu de
   * `renouveler` et `purger` les laissent vivre. Une déconnexion par le client ou une course entre deux sessions de Claude
   * Code ne doit jamais arrêter l'application d'un client ; un admin, lui, a vu leurs noms dans la boîte de confirmation.
   * 🔴 `tenant_id = $2` partout. Le verrou de la ligne (`for no key update`, celui d'un `update`) se prend d'abord : une
   * création en vol attend ou est refusée (`verrouillerAutorisationVivante`).
   */
  async revoquer(tenantId: string, id: string): Promise<CreationsDeLApplication | null> {
    return enTransaction(this.pool, async (client) => {
      const avant = await client.query<{ deja: boolean }>(
        `select revoque_le is not null as deja from oauth_autorisations where id = $1 and tenant_id = $2 for no key update`,
        [id, tenantId],
      );
      const ligne = avant.rows[0];
      if (!ligne) return null;
      if (!ligne.deja) {
        await client.query(`update oauth_autorisations set revoque_le = now() where id = $1 and tenant_id = $2`, [id, tenantId]);
      }
      const cles = await client.query<{ id: string; name: string }>(
        `update api_keys set revoked_at = now()
          where oauth_autorisation_id = $1 and tenant_id = $2 and revoked_at is null
          returning id, name`,
        [id, tenantId],
      );
      const adresses = await client.query<{ id: string; url: string }>(
        `update adresses_evenements set active = false, maj_le = now()
          where oauth_autorisation_id = $1 and tenant_id = $2 and active
          returning id, url`,
        [id, tenantId],
      );
      // Déjà révoquée et plus rien à couper : la réponse d'avant le lot, 404 (un double clic, un onglet en retard).
      if (ligne.deja && cles.rows.length === 0 && adresses.rows.length === 0) return null;
      return { cles: cles.rows, adresses: adresses.rows };
    });
  }

  /**
   * La purge (worker) : les codes échus depuis une heure, et les autorisations mortes depuis 30 jours (leurs codes
   * partent avec elles, en cascade). Rend le nombre de lignes effacées.
   * 🔴 Sauf une autorisation dont une création vit encore (lot D de l'audit) : l'effacer remettrait le lien à vide, la
   * provenance s'effacerait, et l'admin ne pourrait plus couper d'un geste ce que l'application a laissé.
   */
  async purger(): Promise<number> {
    const requetes = [
      `delete from oauth_codes where hash in (
         select hash from oauth_codes where expire_le < now() - interval '1 hour' limit $1)`,
      `delete from oauth_autorisations where id in (
         select a.id from oauth_autorisations a
          where ${FIN_DE_VIE} < now() - interval '30 days' and not ${CREATIONS_VIVANTES} limit $1)`,
    ];
    let total = 0;
    for (const sql of requetes) {
      for (;;) {
        const n = (await this.pool.query(sql, [PAQUET_PURGE])).rowCount ?? 0;
        total += n;
        if (n < PAQUET_PURGE) break;
      }
    }
    return total;
  }
}
