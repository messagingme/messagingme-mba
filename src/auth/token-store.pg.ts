import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { sha256Hex } from '../lib/signature';
import { enTransaction } from '../db/transaction';

export type TokenPurpose = 'invite' | 'reset';

/** Lève dans la transaction de `remplacerInvitation` pour annuler l'annulation des jetons : rien n'est écrit. */
class PasUneInvitationEnAttente extends Error {}

/**
 * Jetons à usage unique (invitation d'équipe, réinitialisation de mot de passe). `create` rend le jeton en
 * clair (pour le lien d'e-mail) et 🔴 ne stocke que son hash : sha256 suffit, le jeton étant 256 bits
 * aléatoires, pas un secret humain. `consume` valide et marque utilisé atomiquement (`used_at is null` dans
 * l'UPDATE) : pas de double consommation, même en concurrence.
 */
export class PgAuthTokenStore {
  constructor(private readonly pool: Pool) {}

  async create(purpose: TokenPurpose, userId: string, ttlMs: number): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.pool.query(
      `insert into auth_tokens (purpose, token_hash, user_id, expires_at) values ($1, $2, $3, $4)`,
      [purpose, sha256Hex(raw), userId, expiresAt],
    );
    return raw;
  }

  /**
   * LE LIEN D'UNE INVITATION COPIÉ DEPUIS LA CONSOLE (migration 0301) : l'e-mail n'arrive pas, l'admin fait passer le lien
   * autrement. En une transaction : les jetons d'invitation vivants du compte annulés (un lien de plus, jamais deux
   * vivants), puis la ligne du compte verrouillée et exigée invitation en attente de CET espace, non révoquée (sinon tout
   * est annulé et `null`), puis un jeton neuf marqué `partage`, que `accepterInvitation` garde.
   * ⚠️ L'ORDRE DES VERROUS est celui de `accepterInvitation` (le jeton, puis le compte) : l'ordre inverse interbloquerait
   * un clic pendant une acceptation (relecture du lot). Une acceptation en vol tient le jeton : ce clic l'attend, puis
   * relit le compte, qui n'est plus en attente. Un refus (autre espace, compte ouvert ou révoqué) LÈVE : la transaction
   * entière est annulée, l'annulation des jetons comprise, et le lien de l'e-mail reste valable.
   */
  async remplacerInvitation(tenantId: string, userId: string, ttlMs: number): Promise<string | null> {
    try {
      return await enTransaction(this.pool, async (client) => {
        await client.query(
          `update auth_tokens set used_at = now() where user_id = $1 and purpose = 'invite' and used_at is null`,
          [userId],
        );
        const u = await client.query(
          `select 1 from users where id = $1 and tenant_id = $2 and invitation_en_attente and disabled_at is null for update`,
          [userId, tenantId],
        );
        if ((u.rowCount ?? 0) === 0) throw new PasUneInvitationEnAttente();
        const raw = randomBytes(32).toString('base64url');
        await client.query(
          `insert into auth_tokens (purpose, token_hash, user_id, expires_at, partage) values ('invite', $1, $2, $3, true)`,
          [sha256Hex(raw), userId, new Date(Date.now() + ttlMs)],
        );
        return raw;
      });
    } catch (err) {
      if (err instanceof PasUneInvitationEnAttente) return null;
      throw err;
    }
  }

  /**
   * Le user_id d'un token valide, SANS le consommer (lot identité C) : la page d'une invitation l'affiche, et la preuve
   * (mot de passe actuel, adresse Google) se vérifie avant de le consommer, pour qu'un échec le laisse intact.
   */
  async lire(purpose: TokenPurpose, raw: string): Promise<string | null> {
    if (!raw) return null;
    const res = await this.pool.query<{ user_id: string }>(
      `select user_id from auth_tokens
        where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()`,
      [sha256Hex(raw), purpose],
    );
    return res.rows[0]?.user_id ?? null;
  }

  /** Renvoie le user_id si le token est valide (bon purpose, non expiré, non déjà utilisé), sinon null. */
  async consume(purpose: TokenPurpose, raw: string): Promise<string | null> {
    if (!raw) return null;
    const res = await this.pool.query<{ user_id: string }>(
      `update auth_tokens set used_at = now()
       where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
       returning user_id`,
      [sha256Hex(raw), purpose],
    );
    return res.rows[0]?.user_id ?? null;
  }
}
