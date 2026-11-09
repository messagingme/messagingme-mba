import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { enTransaction } from '../db/transaction';
import { makeCode, deriveTenantCode } from '../ids/code';
import { resolveTenantCode } from '../ids/tenant-code';
import { sha256Hex } from '../lib/signature';
import { verifierPlaceMembre, type LimitesMembres, type RangMembre } from '../offres/membres';
import type { ConfirmationInscription, DemandeInscription, EspaceAConfirmer } from './inscriptions';
import type { AcceptationInvitation, ApercuInvitation } from './invitations';

/** Une suppression de demandes échues ne touche jamais plus de lignes que ceci par instruction. */
const PAQUET_PURGE_INSCRIPTIONS = 500;

const estDoublon = (err: unknown): boolean =>
  Boolean(err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '23505');

/** Lancées DANS une transaction pour l'annuler entière, puis traduites en statut par la méthode qui l'ouvre. */
class MotDePasseDejaPose extends Error {}
class AdresseDejaConnue extends Error {}
class InvitationRevoquee extends Error {}

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  /** Code public « usr_<client>_<ulid> ». null tant que le backfill n'a pas tourné. */
  code?: string | null;
  /** true = compte révoqué (login bloqué), réversible. */
  disabled: boolean;
  /**
   * true = invitation en attente : créée par une invitation et pas encore acceptée sur sa page (`invitation_en_attente`,
   * migration 0281). Un tel compte n'ouvre rien et ne compte pour rien tant qu'elle ne l'est pas (lot identité C).
   */
  pending: boolean;
  createdAt: string;
  /** Dernière connexion réussie (ISO). null = jamais connecté : pas de repli sur `createdAt`, une date d'inscription
   *  n'est pas une date de connexion. */
  lastLoginAt: string | null;
}

/**
 * Résultat d'une mutation de compte gardée par l'invariant « au moins un admin actif par espace ». Une invitation en
 * attente n'y compte pas (lot identité C) : elle n'ouvre rien, et un espace dont le dernier vrai admin partirait serait
 * laissé à quelqu'un qui n'y est jamais entré.
 */
export type UserMutation = 'ok' | 'last_admin' | 'not_found';

/**
 * D'où naît un espace (`tenants.origine`, migrations 0212 et 0227) : par la connexion OAuth de Claude (`claude_code`), d'un
 * autre client MCP (`client_mcp`, lot 15), ou par la console.
 * Fixée à la création, jamais recalculée. Elle ne décide plus du crédit offert (1 € pour toutes les origines depuis le
 * lot 6) : c'est une donnée d'exploitation, d'où viennent les espaces.
 */
export type OrigineEspace = 'console' | 'claude_code' | 'client_mcp';

/** Un espace qui vient de naître, tel qu'il est annoncé à l'exploitation (`annoncerEspace`). */
export interface EspaceNe {
  tenantId: string;
  nom: string;
  /** L'adresse de son premier admin. */
  email: string;
  origine: OrigineEspace;
  /** Compte Google seul (sans mot de passe), sinon inscription par e-mail. */
  parGoogle: boolean;
}

/** Email déjà pris (unicité globale de lower(email)). Traduit en 409 côté route. */
export class DuplicateEmailError extends Error {
  constructor() {
    super('email déjà utilisé');
    this.name = 'DuplicateEmailError';
  }
}

/**
 * Gestion des comptes de la console. 🔴 Toutes les opérations sont filtrées sur l'espace : un admin ne voit et ne
 * modifie que les comptes de son espace. On ne renvoie jamais le password_hash.
 */
export class PgUserStore {
  /**
   * @param limitesMembres les limites de membres de l'offre de l'espace (lot 6), vérifiées à l'invitation, au passage en
   *   administrateur et à la réactivation (`src/offres/membres.ts`). Absentes : sans limite (scripts et tests).
   */
  constructor(
    private readonly pool: Pool,
    private readonly limitesMembres?: (tenantId: string) => Promise<LimitesMembres>,
    /**
     * Prévient l'exploitation de chaque espace qui naît (Telegram en production, `src/index.ts`), APRÈS le commit : une
     * transaction annulée n'annonce rien. Une annonce qui lève ou rejette ne fait jamais échouer l'inscription.
     * Absente : aucune annonce (scripts et tests).
     */
    private readonly annoncerEspace?: (espace: EspaceNe) => unknown,
  ) {}

  /** Annonce un espace né, sans faire attendre ni échouer l'inscription qu'elle suit. */
  private annoncer(espace: EspaceNe): void {
    void Promise.resolve().then(() => this.annoncerEspace?.(espace)).catch(() => {});
  }

  /**
   * Le rang d'un membre actif dans son espace (lot 6, B2a, `limiteDepassee`) : les membres actifs du même genre créés
   * avant lui (date de création puis identifiant), et les administrateurs actifs. La même population que la limite de
   * membres (`verifierPlaceMembre` : comptes actifs, invitations en attente comprises). `null` = inconnu dans cet espace.
   * Lu seulement pour un espace dont l'offre limite les membres (`creerGelMembres`).
   */
  async rangMembre(tenantId: string, userId: string): Promise<RangMembre | null> {
    const res = await this.pool.query<{ est_admin: boolean; admins_avant: number; autres_avant: number; admins: number }>(
      `select u.role = 'admin' as est_admin,
              (select count(*) from users v where v.tenant_id = u.tenant_id and v.disabled_at is null and v.role = 'admin'
                  and (v.created_at, v.id) < (u.created_at, u.id))::int as admins_avant,
              (select count(*) from users v where v.tenant_id = u.tenant_id and v.disabled_at is null and v.role <> 'admin'
                  and (v.created_at, v.id) < (u.created_at, u.id))::int as autres_avant,
              (select count(*) from users v where v.tenant_id = u.tenant_id and v.disabled_at is null and v.role = 'admin')::int as admins
         from users u
        where u.id = $2 and u.tenant_id = $1 and u.disabled_at is null`,
      [tenantId, userId],
    );
    const r = res.rows[0];
    return r ? { estAdmin: r.est_admin, adminsAvant: r.admins_avant, autresAvant: r.autres_avant, admins: r.admins } : null;
  }

  /**
   * État d'auth courant d'un compte, relu à chaque requête par requireAuth : rôle frais et révocation. null = compte
   * supprimé. Une révocation, une suppression ou un changement de rôle prend effet tout de suite : la base fait foi,
   * pas le JWT.
   * 🔴 Un compte en attente d'invitation rend null, comme un compte supprimé (lot identité C) : c'est le filet sous toutes
   * les entrées. Un jeton de choix, de code ou d'enrôlement signé avant le lot, ou un chemin qu'on aurait oublié de
   * filtrer, n'y ouvre aucune session.
   */
  async getAuthState(userId: string): Promise<{ role: string; disabled: boolean; tenantStatus: string; sessionsDepuis: Date | null } | null> {
    // `left join` : un compte sans identité (ancien) garde sa session, sans époque.
    const res = await this.pool.query<{ role: string; disabled_at: Date | null; tenant_status: string; sessions_depuis: Date | null }>(
      `select u.role, u.disabled_at, t.status as tenant_status, i.sessions_depuis
       from users u join tenants t on t.id = u.tenant_id
       left join identities i on i.id = u.identity_id
       where u.id = $1 and not u.invitation_en_attente`,
      [userId],
    );
    const r = res.rows[0];
    return r ? { role: r.role, disabled: r.disabled_at !== null, tenantStatus: r.tenant_status, sessionsDepuis: r.sessions_depuis } : null;
  }

  /**
   * Hash de mot de passe courant d'un compte, pour vérifier l'ancien au changement. null si absent.
   * 🔴 Lu sur l'identité, comme la connexion (`PgUserAuthStore.findIdentity`) : `setPassword` écrit sur l'identité,
   * et vérifier sur une copie divergente laisserait un compte changer le mot de passe de toute l'adresse. La copie
   * ne sert qu'aux comptes sans identité.
   */
  async getPasswordHash(userId: string): Promise<string | null> {
    const res = await this.pool.query<{ password_hash: string | null }>(
      `select case when u.identity_id is null then u.password_hash else i.password_hash end as password_hash
         from users u left join identities i on i.id = u.identity_id
        where u.id = $1`,
      [userId],
    );
    return res.rows[0]?.password_hash ?? null;
  }

  /**
   * Le mot de passe de l'identité d'une adresse, pour l'inscription : `undefined` si l'adresse n'a pas d'identité,
   * `null` si elle en a une sans mot de passe (invitation en attente, compte Google).
   */
  async motDePasseDeLAdresse(email: string): Promise<string | null | undefined> {
    const res = await this.pool.query<{ password_hash: string | null }>(
      `select password_hash from identities where lower(email) = lower($1)`,
      [email],
    );
    return res.rows.length === 0 ? undefined : res.rows[0]!.password_hash;
  }

  /** Profil de l'utilisateur courant (route /me). null = compte inconnu. */
  async getById(userId: string): Promise<{ email: string; name: string | null; role: string } | null> {
    const res = await this.pool.query<{ email: string; name: string | null; role: string }>(
      `select email, name, role from users where id = $1`,
      [userId],
    );
    const r = res.rows[0];
    return r ? { email: r.email, name: r.name, role: r.role } : null;
  }

  /** Nom d'un espace, pour personnaliser l'email d'invitation. null si inconnu. */
  async getTenantName(tenantId: string): Promise<string | null> {
    const res = await this.pool.query<{ name: string }>(`select name from tenants where id = $1`, [tenantId]);
    return res.rows[0]?.name ?? null;
  }

  /** Renomme un espace (Compte & équipe). `false` = espace inconnu : rien n'a été écrit. */
  async setTenantName(tenantId: string, name: string): Promise<boolean> {
    const res = await this.pool.query(`update tenants set name = $2 where id = $1`, [tenantId, name]);
    return (res.rowCount ?? 0) > 0;
  }

  /** L'espace exige-t-il le second facteur de ses admins (migration 0230) ? `null` = espace inconnu. */
  async getSecondFacteurAdmins(tenantId: string): Promise<boolean | null> {
    const res = await this.pool.query<{ second_facteur_admins: boolean }>(
      `select second_facteur_admins from tenants where id = $1`, [tenantId]);
    return res.rows[0]?.second_facteur_admins ?? null;
  }

  /** Pose le réglage (Compte & équipe). `false` = espace inconnu : rien n'a été écrit. */
  async setSecondFacteurAdmins(tenantId: string, exige: boolean): Promise<boolean> {
    const res = await this.pool.query(`update tenants set second_facteur_admins = $2 where id = $1`, [tenantId, exige]);
    return (res.rowCount ?? 0) > 0;
  }

  async list(tenantId: string): Promise<UserRow[]> {
    const res = await this.pool.query<{ id: string; email: string; name: string | null; role: string; code: string | null; disabled_at: Date | null; pending: boolean; created_at: Date; last_login_at: Date | null }>(
      // `pending` veut dire « invitation pas encore acceptée » et se lit sur le drapeau que pose la seule invitation
      // (migration 0281), jamais sur `last_login_at` (une marque de connexion manquée n'en fait pas une invitation) ni sur
      // `password_hash` (un compte Google n'a pas de mot de passe). Trois écrans excluent les comptes en attente.
      `select id, email, name, role, code, disabled_at, invitation_en_attente as pending, created_at, last_login_at from users
       where tenant_id = $1 order by created_at asc`,
      [tenantId],
    );
    return res.rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      code: r.code,
      disabled: r.disabled_at !== null,
      pending: r.pending,
      createdAt: r.created_at.toISOString(),
      lastLoginAt: r.last_login_at?.toISOString() ?? null,
    }));
  }

  /**
   * Horodate la dernière connexion réussie, en fire-and-forget : une panne d'écriture ne doit jamais transformer
   * une authentification valide en 500.
   */
  async touchLastLogin(userId: string): Promise<void> {
    // Jamais pour une invitation en attente (lot identité C) : un jeton de choix ou de code signé avant le lot y
    // laisserait sinon une marque de connexion, que le tour de rôle et les e-mails produit lisent comme une acceptation.
    await this.pool.query(`update users set last_login_at = now() where id = $1 and not invitation_en_attente`, [userId]);
  }

  /**
   * Les comptes OUVERTS d'une adresse, révoqués compris, pour l'entrée Google (console et consentement du plugin), le
   * sélecteur d'espaces et l'autorisation OAuth. Distinct de `PgUserAuthStore.findIdentity`, qui exige un mot de passe.
   * La liste laisse la route proposer l'écran de choix, avec le même tri que `findIdentity`.
   * 🔴 Une invitation en attente n'y figure jamais (lot identité C) : elle ne s'ouvre que par sa page, et une adresse
   * qui n'a qu'elle est, pour Google, une adresse inconnue (son propre espace naît).
   */
  async getByEmail(email: string): Promise<Array<{ id: string; tenantId: string; tenantName: string; role: string; disabled: boolean }>> {
    const res = await this.pool.query<{ id: string; tenant_id: string; tenant_name: string; role: string; disabled_at: Date | null }>(
      `select u.id, u.tenant_id, t.name as tenant_name, u.role, u.disabled_at
         from users u
         join tenants t on t.id = u.tenant_id
        where lower(u.email) = lower($1) and not u.invitation_en_attente
        order by t.name, u.id`,
      [email],
    );
    return res.rows.map((r) => ({
      id: r.id, tenantId: r.tenant_id, tenantName: r.tenant_name, role: r.role, disabled: r.disabled_at !== null,
    }));
  }

  /**
   * Le compte auquel rattacher un lien de réinitialisation : une identité qui a un mot de passe, et l'un de ses comptes non
   * révoqués, invitation en attente COMPRISE (un compte ouvert d'abord). La réinitialisation prouve l'adresse et n'ouvre
   * aucun compte (`setPassword` ne lève aucun drapeau) : un membre retiré puis réinvité, qui a oublié son mot de passe, le
   * reprend ainsi avant d'accepter sur la page de l'invitation, qui lui demande l'actuel (lot identité C).
   * `null` = adresse inconnue, sans mot de passe, ou dont tous les comptes sont révoqués.
   */
  async compteAReinitialiser(email: string): Promise<string | null> {
    const res = await this.pool.query<{ id: string }>(
      `select u.id
         from identities i
         join users u on u.identity_id = i.id
        where lower(i.email) = lower($1) and i.password_hash is not null and u.disabled_at is null
        order by u.invitation_en_attente, u.id
        limit 1`,
      [email],
    );
    return res.rows[0]?.id ?? null;
  }

  /** {tenantId, role, email} d'un compte, pour émettre une session après acceptation d'invitation. */
  async getSessionUser(userId: string): Promise<{ tenantId: string; role: string; email: string } | null> {
    const res = await this.pool.query<{ tenant_id: string; role: string; email: string }>(
      `select tenant_id, role, email from users where id = $1`,
      [userId],
    );
    const r = res.rows[0];
    return r ? { tenantId: r.tenant_id, role: r.role, email: r.email } : null;
  }

  /**
   * Identité d'une adresse : la trouve, ou la crée. Rend son identifiant. Un deuxième espace avec la même adresse
   * réutilise ainsi le mot de passe existant : une adresse, un mot de passe.
   * `on conflict do nothing` puis relecture : deux inscriptions simultanées convergent vers la même identité.
   * `langue` (aide à la connexion, lot 2b) : celle de l'écran où le compte se crée, donc de ses e-mails ; posée à la
   * naissance seulement. Une identité qui existe garde la sienne : seul le choix de la personne la change (`/compte`).
   */
  private async ensureIdentity(
    client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ id: string }>; rowCount: number | null }> },
    email: string,
    passwordHash: string | null,
    langue: 'fr' | 'en' = 'fr',
  ): Promise<string> {
    await client.query(
      `insert into identities (email, password_hash, langue) values ($1, $2, $3)
       on conflict (lower(email)) do nothing`,
      [email, passwordHash, langue],
    );
    const res = await client.query(`select id from identities where lower(email) = lower($1)`, [email]);
    return res.rows[0]!.id;
  }

  /**
   * Crée un compte en attente (invitation), sans mot de passe : il n'ouvre rien avant l'acceptation sur sa page. SEULE
   * fonction qui pose `invitation_en_attente` (lot identité C) ; `invitePar`, le compte qui invite, que la page affiche.
   * DuplicateEmailError (409) si l'email est déjà pris.
   */
  async createPending(tenantId: string, email: string, role: string, name?: string, invitePar?: string | null): Promise<UserRow> {
    // Le doublon AVANT la limite (livraison 7) : sinon le refus de la limite proposerait un siège, payé, pour une adresse
    // que l'insertion refuserait ensuite. La même règle que l'index `users_tenant_email_unique` (espace, adresse sans casse).
    const deja = await this.pool.query(`select 1 from users where tenant_id = $1 and lower(email) = lower($2)`, [tenantId, email]);
    if (deja.rows.length > 0) throw new DuplicateEmailError();
    const limites = this.limitesMembres ? await this.limitesMembres(tenantId) : null;
    // En Pro, tout le monde est administrateur (spec du 2026-10-27) : l'invité l'est aussi en base, quel que soit le rôle
    // demandé, et le reste s'il remonte en Business.
    const roleEnregistre = limites?.offre === 'pro' ? 'admin' : role;
    if (limites) await verifierPlaceMembre(this.pool, tenantId, limites, roleEnregistre, null);
    const code = makeCode('usr', await resolveTenantCode(this.pool, tenantId));
    try {
      // Identité créée si l'adresse est nouvelle, réutilisée sinon : l'invité garde le mot de passe qu'il connaît.
      const identityId = await this.ensureIdentity(this.pool, email, null);
      // Le nom saisi par l'admin est posé dès l'invitation, sinon le membre apparaît sous son adresse partout.
      // Absent : `null`, donc le repli `name ?? email`.
      const res = await this.pool.query<{ id: string; email: string; name: string | null; role: string; created_at: Date }>(
        `insert into users (tenant_id, email, name, role, password_hash, code, identity_id, invitation_en_attente, invite_par)
         values ($1, $2, $6, $3, null, $4, $5, true, $7)
         returning id, email, name, role, created_at`,
        [tenantId, email, roleEnregistre, code, identityId, name?.trim() === '' ? null : (name?.trim() ?? null), invitePar ?? null],
      );
      const r = res.rows[0]!;
      return { id: r.id, email: r.email, name: r.name, role: r.role, code, disabled: false, pending: true, createdAt: r.created_at.toISOString(), lastLoginAt: null };
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '23505') throw new DuplicateEmailError();
      throw err;
    }
  }

  /**
   * Pose (ou écrase) le mot de passe : finalisation d'invitation, réinitialisation. `true` si le compte existe.
   * 🔴 Écrit sur l'identité, pas sur le compte : une adresse a un seul mot de passe, quel que soit le nombre de ses
   * espaces. `users.password_hash` est mis à jour en miroir, pour qu'un retour arrière ne prive personne du sien.
   * 🔴 Pose aussi l'époque des sessions (migration 0277) : celles de l'identité émises avant sont refusées par la garde.
   * L'heure vient de l'API, qui signe le `iat` des sessions, pas de la base.
   */
  async setPassword(userId: string, passwordHash: string): Promise<boolean> {
    return enTransaction(this.pool, async (client) => {
      const res = await client.query(
        `update identities set password_hash = $2, sessions_depuis = $3
          where id = (select identity_id from users where id = $1)`,
        [userId, passwordHash, new Date()],
      );
      const miroir = await client.query(`update users set password_hash = $2 where id = $1`, [userId, passwordHash]);
      // L'une ou l'autre écriture suffit : un compte sans identité doit pouvoir poser son mot de passe.
      return (res.rowCount ?? 0) > 0 || (miroir.rowCount ?? 0) > 0;
    });
  }

  /**
   * Ce que la page d'une invitation affiche (lot identité C), lu sans rien consommer : l'espace, l'adresse invitée,
   * l'invitant (nom et adresse ; null pour une invitation d'avant le lot ou un invitant supprimé) et si l'adresse a déjà
   * un mot de passe (la page demande alors l'actuel). null = compte inconnu, ou révoqué par son espace.
   */
  async apercuInvitation(userId: string): Promise<ApercuInvitation | null> {
    const res = await this.pool.query<{
      espace: string; adresse: string; a_un_mot_de_passe: boolean; invitant_nom: string | null; invitant_adresse: string | null;
    }>(
      `select t.name as espace, u.email as adresse,
              (case when u.identity_id is null then u.password_hash else i.password_hash end) is not null as a_un_mot_de_passe,
              p.name as invitant_nom, p.email as invitant_adresse
         from users u
         join tenants t on t.id = u.tenant_id
         left join identities i on i.id = u.identity_id
         left join users p on p.id = u.invite_par
        where u.id = $1 and u.disabled_at is null`,
      [userId],
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      espace: r.espace,
      adresse: r.adresse,
      invitant: r.invitant_adresse === null ? null : { nom: r.invitant_nom, adresse: r.invitant_adresse },
      aUnMotDePasse: r.a_un_mot_de_passe,
    };
  }

  /**
   * L'acceptation d'une invitation, en UNE transaction (lot identité C) : le jeton consommé, la ligne de l'identité
   * verrouillée (le clic d'un lien d'inscription qui s'y rattacherait attend ici), le mot de passe posé s'il est fourni,
   * le drapeau levé. Rien ne reste à moitié : un double envoi ou une acceptation Google simultanée n'a qu'un gagnant, et
   * l'autre n'a rien écrit.
   * `nouveauHash` : le mot de passe choisi par une adresse qui n'en avait pas, posé seulement si elle n'en a toujours pas
   * (sinon `mot_de_passe_existe`, tout annulé, jeton intact). null : Google, ou le mot de passe actuel déjà vérifié par
   * la route ; rien n'est alors écrit sur l'identité. Comme `setPassword`, un mot de passe posé ouvre une nouvelle époque
   * des sessions de l'identité (migration 0277).
   */
  async accepterInvitation(jeton: string, nouveauHash: string | null): Promise<AcceptationInvitation> {
    if (!jeton) return { statut: 'invalide' };
    try {
      return await enTransaction(this.pool, async (client) => {
        const t = await client.query<{ user_id: string }>(
          `update auth_tokens set used_at = now()
            where token_hash = $1 and purpose = 'invite' and used_at is null and expires_at > now()
            returning user_id`,
          [sha256Hex(jeton)],
        );
        const userId = t.rows[0]?.user_id;
        if (userId === undefined) return { statut: 'invalide' } as const;
        const u = await client.query<{ identity_id: string | null; disabled_at: Date | null }>(
          `select identity_id, disabled_at from users where id = $1`,
          [userId],
        );
        if (u.rows.length === 0) return { statut: 'invalide' } as const;
        // Une invitation révoquée par son espace ne s'accepte pas ; annulée, la consommation laisse le jeton à l'invitation
        // si l'espace la réactive.
        if (u.rows[0]!.disabled_at !== null) throw new InvitationRevoquee();
        const identityId = u.rows[0]!.identity_id;
        if (identityId !== null) await client.query(`select 1 from identities where id = $1 for update`, [identityId]);
        if (nouveauHash !== null) {
          const pose = identityId === null
            ? await client.query(`update users set password_hash = $2 where id = $1 and password_hash is null`, [userId, nouveauHash])
            : await client.query(
              `update identities set password_hash = $2, sessions_depuis = $3 where id = $1 and password_hash is null`,
              [identityId, nouveauHash, new Date()],
            );
          if ((pose.rowCount ?? 0) === 0) throw new MotDePasseDejaPose();
          // La copie sur le compte, comme `setPassword` : un retour arrière d'avant les identités ne prive personne du sien.
          if (identityId !== null) await client.query(`update users set password_hash = $2 where id = $1`, [userId, nouveauHash]);
        }
        await client.query(`update users set invitation_en_attente = false where id = $1`, [userId]);
        return { statut: 'acceptee', userId } as const;
      });
    } catch (err) {
      if (err instanceof MotDePasseDejaPose) return { statut: 'mot_de_passe_existe' };
      if (err instanceof InvitationRevoquee) return { statut: 'invalide' };
      throw err;
    }
  }

  /**
   * Inscription libre : crée un espace et son admin en une transaction (jamais d'espace sans admin).
   * `passwordHash` null = compte Google seul. 409 si l'email est déjà pris (rollback, aucun espace créé).
   * 🔴 AUCUN CRÉDIT OFFERT ICI (décision de Julien du 2026-09-29) : offert à chaque espace qui naît, sans preuve,
   * il se récoltait par script. Il s'offre au premier numéro WhatsApp que Meta dit vérifié (`offrirAuNumeroVerifie`).
   * `admin.langue` : celle de l'écran, écrite sur l'identité si elle naît ici (`ensureIdentity`), sinon sans effet.
   */
  async createTenantWithAdmin(
    workspaceName: string,
    admin: { email: string; name: string | null; passwordHash: string | null; langue?: 'fr' | 'en' },
    origine: OrigineEspace = 'console',
  ): Promise<{ tenantId: string; userId: string }> {
    let cree: { tenantId: string; userId: string };
    try {
      cree = await enTransaction(this.pool, (client) =>
        // Même adresse qu'un espace existant : on réutilise son identité, donc son mot de passe et sa langue.
        this.creerEspaceEtAdmin(client, workspaceName, admin, origine, () => this.ensureIdentity(client, admin.email, admin.passwordHash, admin.langue)),
      );
    } catch (err) {
      if (estDoublon(err)) throw new DuplicateEmailError();
      throw err;
    }
    this.annoncer({ tenantId: cree.tenantId, nom: workspaceName, email: admin.email, origine, parGoogle: admin.passwordHash === null });
    return cree;
  }

  /**
   * Le corps commun d'une création d'espace, dans la transaction de l'appelant : l'espace, son code public, l'identité
   * que rend `identite` (trouvée ou créée, selon le chemin), puis le compte admin avec la copie du hash.
   */
  private async creerEspaceEtAdmin(
    client: PoolClient,
    workspaceName: string,
    admin: { email: string; name: string | null; passwordHash: string | null },
    origine: OrigineEspace,
    identite: () => Promise<string>,
  ): Promise<{ tenantId: string; userId: string }> {
    const t = await client.query<{ id: string }>(`insert into tenants (name, origine) values ($1, $2) returning id`, [workspaceName, origine]);
    const tenantId = t.rows[0]!.id;
    // Code client posé à la création (déterministe depuis l'uuid, immuable), puis code du premier admin.
    const tcode = deriveTenantCode(tenantId);
    await client.query(`update tenants set public_code = $2 where id = $1`, [tenantId, tcode]);
    const identityId = await identite();
    const u = await client.query<{ id: string }>(
      `insert into users (tenant_id, email, name, role, password_hash, code, identity_id) values ($1, $2, $3, 'admin', $4, $5, $6) returning id`,
      [tenantId, admin.email, admin.name, admin.passwordHash, makeCode('usr', tcode), identityId],
    );
    return { tenantId, userId: u.rows[0]!.id };
  }

  /**
   * La demande d'inscription d'une adresse INCONNUE (lot identité B, migration 0279) : rien ne se crée avant le clic.
   * Rend le jeton en clair, pour le lien de l'e-mail ; la base n'en garde que le sha256 (256 bits aléatoires, pas un
   * secret humain : sha256 suffit, comme `PgAuthTokenStore`). Plusieurs demandes vivantes par adresse, bornées par le
   * plafond de la route : un tiers qui redemande ne tue pas le lien que le titulaire tient déjà.
   */
  async demanderInscription(demande: DemandeInscription, ttlMs: number): Promise<string> {
    const jeton = randomBytes(32).toString('base64url');
    await this.pool.query(
      `insert into inscriptions_attente (jeton_hash, email, langue, offre_pro, application, pub_fbc, pub_fbp, expire_le)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [sha256Hex(jeton), demande.email, demande.langue, demande.offrePro, demande.application, demande.pubFbc, demande.pubFbp, new Date(Date.now() + ttlMs)],
    );
    return jeton;
  }

  /**
   * Le jeton désigne-t-il une demande vivante ? Une requête indexée, lue AVANT le hachage du mot de passe choisi au clic :
   * un jeton inventé ne coûte jamais un scrypt. La réponse ne vaut qu'un instant : `confirmerInscription` relit tout
   * dans sa transaction.
   */
  async inscriptionVivante(jeton: string): Promise<boolean> {
    if (!jeton) return false;
    const r = await this.pool.query(
      `select 1 from inscriptions_attente where jeton_hash = $1 and expire_le > now()`,
      [sha256Hex(jeton)],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Efface la demande d'un lien qui n'est pas parti : il ne doit rien confirmer. */
  async oublierDemande(jeton: string): Promise<void> {
    await this.pool.query(`delete from inscriptions_attente where jeton_hash = $1`, [sha256Hex(jeton)]);
  }

  /**
   * Le clic sur le lien, en UNE transaction : la demande vivante verrouillée, puis l'espace, l'identité PROUVÉE
   * (`adresse_prouvee_le`, avec le mot de passe choisi au clic) et son compte admin, puis l'effacement de TOUTES les
   * demandes de l'adresse.
   * 🔴 L'identité de l'adresse naît ici, ou, si elle existe déjà, n'est reprise QUE si elle n'a ni mot de passe ni compte
   * ouvert : née d'une invitation jamais acceptée (lot identité C), elle reçoit le mot de passe choisi et la preuve, et
   * l'invitation reste en attente, à part. Toute autre (Google, mot de passe, compte ouvert) ne se rattache jamais en
   * silence : tout est annulé, la demande reste, et la route rend `adresse_connue`. Sa ligne est verrouillée avant la
   * relecture : l'acceptation d'une invitation, qui verrouille la même, se sérialise avec ce clic.
   * 🔴 Les verrous se prennent sur TOUTES les demandes de l'adresse, dans l'ordre de leur id, AVANT de créer quoi que ce
   * soit : deux liens de la même adresse cliqués en même temps se sérialisent ici. Verrouiller la seule demande du lien
   * ferait s'attendre l'un sur l'index unique de l'identité, l'autre sur la suppression des demandes : un interblocage.
   * Le second relit ensuite sa demande, que le premier a effacée : `lien_invalide`.
   * Une identité née entre la relecture et l'insertion (23505) : UNE reprise, qui la relit et s'y rattache si elle est
   * née d'une invitation.
   */
  async confirmerInscription(jeton: string, espace: EspaceAConfirmer): Promise<ConfirmationInscription> {
    if (!jeton) return { statut: 'lien_invalide' };
    const r = await this.confirmerAvecUneReprise(jeton, espace);
    // L'annonce d'un espace né, APRÈS le commit : une transaction annulée n'annonce rien.
    if (r.statut === 'cree') {
      this.annoncer({ tenantId: r.tenantId, nom: espace.workspaceName, email: r.email, origine: 'console', parGoogle: false });
    }
    return r;
  }

  private async confirmerAvecUneReprise(jeton: string, espace: EspaceAConfirmer): Promise<ConfirmationInscription> {
    for (let essai = 0; ; essai += 1) {
      try {
        return await this.confirmerUneFois(jeton, espace);
      } catch (err) {
        if (err instanceof AdresseDejaConnue) return { statut: 'adresse_connue' };
        if (estDoublon(err) && essai === 0) continue;
        if (estDoublon(err)) return { statut: 'adresse_connue' };
        throw err;
      }
    }
  }

  private async confirmerUneFois(jeton: string, espace: EspaceAConfirmer): Promise<ConfirmationInscription> {
    const hash = sha256Hex(jeton);
    return enTransaction(this.pool, async (client) => {
      const vise = await client.query<{ email: string }>(
        `select email from inscriptions_attente where jeton_hash = $1 and expire_le > now()`,
        [hash],
      );
      const adresse = vise.rows[0]?.email;
      if (adresse === undefined) return { statut: 'lien_invalide' } as const;
      await client.query(`select id from inscriptions_attente where lower(email) = lower($1) order by id for update`, [adresse]);
      const d = await client.query<{
        email: string; langue: 'fr' | 'en'; offre_pro: boolean; application: boolean; pub_fbc: string | null; pub_fbp: string | null;
      }>(
        `select email, langue, offre_pro, application, pub_fbc, pub_fbp from inscriptions_attente
          where jeton_hash = $1 and expire_le > now()`,
        [hash],
      );
      const demande = d.rows[0];
      if (!demande) return { statut: 'lien_invalide' } as const;
      const { tenantId, userId } = await this.creerEspaceEtAdmin(
        client,
        espace.workspaceName,
        { email: demande.email, name: espace.name, passwordHash: espace.passwordHash },
        'console',
        async () => {
          const existante = await client.query<{ id: string; password_hash: string | null }>(
            `select id, password_hash from identities where lower(email) = lower($1) for update`,
            [demande.email],
          );
          const deja = existante.rows[0];
          if (deja) {
            const ouvert = await client.query(
              `select 1 from users where identity_id = $1 and not invitation_en_attente limit 1`,
              [deja.id],
            );
            if (deja.password_hash !== null || (ouvert.rowCount ?? 0) > 0) throw new AdresseDejaConnue();
            // La langue de la demande aussi (lot 2b) : sans mot de passe ni compte ouvert, l'identité n'a plus d'autre
            // titulaire que la personne qui prouve l'adresse à ce clic, et l'écran d'où elle a demandé le lien dit sa langue.
            await client.query(
              `update identities set password_hash = $2, adresse_prouvee_le = now(), sessions_depuis = $3, langue = $4 where id = $1`,
              [deja.id, espace.passwordHash, new Date(), demande.langue],
            );
            return deja.id;
          }
          // Elle naît dans la langue de l'écran qui a demandé le lien (`inscriptions_attente.langue`) : ses e-mails aussi.
          const i = await client.query<{ id: string }>(
            `insert into identities (email, password_hash, adresse_prouvee_le, langue) values ($1, $2, now(), $3) returning id`,
            [demande.email, espace.passwordHash, demande.langue],
          );
          return i.rows[0]!.id;
        },
      );
      await client.query(`delete from inscriptions_attente where lower(email) = lower($1)`, [demande.email]);
      return {
        statut: 'cree', tenantId, userId, email: demande.email, langue: demande.langue, offrePro: demande.offre_pro,
        application: demande.application, pubFbc: demande.pub_fbc, pubFbp: demande.pub_fbp,
      } as const;
    });
  }

  /** La rétention (worker) : les demandes échues, par paquets bornés. Rend le nombre de lignes effacées. */
  async purgerInscriptionsEchues(): Promise<number> {
    let total = 0;
    for (;;) {
      const n = (await this.pool.query(
        `delete from inscriptions_attente where id in (
           select id from inscriptions_attente where expire_le <= now() limit $1)`,
        [PAQUET_PURGE_INSCRIPTIONS],
      )).rowCount ?? 0;
      total += n;
      if (n < PAQUET_PURGE_INSCRIPTIONS) break;
    }
    return total;
  }

  /**
   * Pose (ou efface) le nom affiché d'un membre, celui que tous les écrans montrent (`name ?? email`).
   * Une chaîne vide efface (`null`) : un nom vide ferait afficher du blanc au lieu de l'adresse. Aucun invariant
   * d'admin en jeu ici ; la seule garde est l'espace.
   */
  async setName(tenantId: string, userId: string, name: string): Promise<UserMutation> {
    const propre = name.trim();
    const upd = await this.pool.query(
      `update users set name = $3 where id = $1 and tenant_id = $2`,
      [userId, tenantId, propre === '' ? null : propre],
    );
    return (upd.rowCount ?? 0) > 0 ? 'ok' : 'not_found';
  }

  /**
   * Change le rôle d'un compte de l'espace, en préservant « au moins un admin actif ». L'UPDATE est gardé : le
   * sous-select compte les admins en base, donc l'invariant tient même avec un JWT admin périmé. Rend 'ok',
   * 'last_admin' (dernier admin rétrogradé) ou 'not_found' (id inconnu ou autre espace).
   * Course théorique : deux rétrogradations croisées simultanées pourraient toutes deux voir count > 1.
   */
  async setRole(tenantId: string, userId: string, role: string): Promise<UserMutation | 'roles_en_business'> {
    const limites = this.limitesMembres ? await this.limitesMembres(tenantId) : null;
    // En Pro, tout le monde est administrateur (spec du 2026-10-27, `roleEffectif`) : un rôle n'y changerait rien.
    if (limites?.offre === 'pro') return 'roles_en_business';
    // Passer administrateur compte dans la limite des administrateurs de l'offre (lot 6) ; le compte ne se compte pas.
    if (role === 'admin' && limites) {
      await verifierPlaceMembre(this.pool, tenantId, { utilisateurs: null, admins: limites.admins }, role, userId);
    }
    const upd = await this.pool.query(
      // `role <> 'admin'` et non `role = 'agent'` : un compte non admin peut changer de rôle sans toucher au nombre
      // d'admins, quel que soit son rôle actuel.
      `update users set role = $3
         where id = $1 and tenant_id = $2
           and ($3 = 'admin' or role <> 'admin' or disabled_at is not null or invitation_en_attente
                or (select count(*) from users where tenant_id = $2 and role = 'admin' and disabled_at is null and not invitation_en_attente) > 1)`,
      [userId, tenantId, role],
    );
    if ((upd.rowCount ?? 0) > 0) return 'ok';
    // rowCount 0 : id inconnu (ou autre espace), ou invariant qui a bloqué.
    const exists = await this.pool.query(`select 1 from users where id = $1 and tenant_id = $2`, [userId, tenantId]);
    return (exists.rowCount ?? 0) > 0 ? 'last_admin' : 'not_found';
  }

  /**
   * Révoque ou réactive un compte de l'espace. Révoquer le dernier admin actif est refusé (compté en base) ;
   * réactiver est toujours permis. Même course théorique que setRole.
   */
  async setDisabled(tenantId: string, userId: string, disabled: boolean): Promise<UserMutation> {
    // Réactiver un compte lui rend sa place : elle compte dans les limites de l'offre (lot 6), avec son rôle actuel.
    if (!disabled && this.limitesMembres) {
      const role = (await this.pool.query<{ role: string }>(`select role from users where id = $1 and tenant_id = $2`, [userId, tenantId])).rows[0]?.role;
      if (role !== undefined) await verifierPlaceMembre(this.pool, tenantId, await this.limitesMembres(tenantId), role, userId);
    }
    if (!disabled) {
      const upd = await this.pool.query(`update users set disabled_at = null where id = $1 and tenant_id = $2`, [userId, tenantId]);
      return (upd.rowCount ?? 0) > 0 ? 'ok' : 'not_found';
    }
    const upd = await this.pool.query(
      `update users set disabled_at = now()
         where id = $1 and tenant_id = $2
           and (role <> 'admin' or disabled_at is not null or invitation_en_attente
                or (select count(*) from users where tenant_id = $2 and role = 'admin' and disabled_at is null and not invitation_en_attente) > 1)`,
      [userId, tenantId],
    );
    if ((upd.rowCount ?? 0) > 0) return 'ok';
    const exists = await this.pool.query(`select 1 from users where id = $1 and tenant_id = $2`, [userId, tenantId]);
    return (exists.rowCount ?? 0) > 0 ? 'last_admin' : 'not_found';
  }

  /**
   * 🔴 Supprime définitivement un compte de l'espace, sauf le dernier admin actif.
   *
   * Toute clé étrangère vers `users` doit déclarer son comportement de suppression, sinon ce delete échouera.
   * `on delete set null` ne suffit pas quand la table porte un CHECK sur la colonne mise à null : le consentement
   * d'un outil (`agent_tool_consommateurs`) exige `actif = false or active_par is not null`, et le `set null`
   * ferait échouer tout le delete en 23514. Les consentements de ce compte sont donc éteints d'abord, dans la même
   * transaction ; un admin les réactive depuis l'onglet Outils.
   */
  async deleteUser(tenantId: string, userId: string): Promise<UserMutation> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // Le CHECK du consentement ferait échouer le delete : on éteint d'abord ce que ce compte avait autorisé.
      const liaisonsActives = await client.query(
        `update agent_tool_consommateurs
            set actif = false, active_par = null, active_le = null, updated_at = now()
          where tenant_id = $2 and active_par = $1 and actif`,
        [userId, tenantId],
      );
      const liaisonsAutonomes = await client.query(
        `update agent_tool_consommateurs
            set autonome = false, autonome_par = null, autonome_le = null, updated_at = now()
          where tenant_id = $2 and autonome_par = $1 and autonome`,
        [userId, tenantId],
      );
      const del = await client.query(
        `delete from users
           where id = $1 and tenant_id = $2
             and (role <> 'admin' or disabled_at is not null or invitation_en_attente
                  or (select count(*) from users where tenant_id = $2 and role = 'admin' and disabled_at is null and not invitation_en_attente) > 1)`,
        [userId, tenantId],
      );
      if ((del.rowCount ?? 0) === 0) {
        // Refus ou compte inexistant : rien n'est éteint, un refus ne laisse pas d'outils éteints derrière lui.
        await client.query('rollback');
        const exists = await this.pool.query(`select 1 from users where id = $1 and tenant_id = $2`, [userId, tenantId]);
        return (exists.rowCount ?? 0) > 0 ? 'last_admin' : 'not_found';
      }
      await client.query('commit');
      const eteints = (liaisonsActives.rowCount ?? 0) + (liaisonsAutonomes.rowCount ?? 0);
      // Journalisé : c'est le seul lien entre un départ et un agent devenu muet.
      if (eteints > 0) {
        console.warn(`[users] suppression de ${userId} (tenant ${tenantId}) : ${eteints} reglage(s) d outil d agent desactive(s)`);
      }
      return 'ok';
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
