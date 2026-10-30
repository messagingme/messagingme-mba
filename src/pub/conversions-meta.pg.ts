import type { Pool } from 'pg';
import { enTransaction } from '../db/transaction';
import { roleAdminEffectifSql } from '../offres/membres';
import type { ConversionAEnvoyer, EvenementMeta, Fait } from './conversions-meta';

/** Ce que la console a transmis avec l'accord : les identifiants de Meta, déjà validés (`lireChampPub`). */
export interface ChampPub {
  fbc?: string;
  fbp?: string;
}

/**
 * Le journal des conversions (migration 0265) et l'accord de la personne (`identities.pub_*`). Le modèle est celui des
 * e-mails du produit (`PgEmailsProduitStore`) : la réservation est le dédoublonnage, la prise pose un bail, le balayage
 * reprend ce qui reste dû.
 */
export class PgConversionsMetaStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Réserve le fait. 🔴 C'est le dédoublonnage : une clé déjà prise ne rend rien, quel que soit le nombre de copies
   * qui réservent en même temps. Rend la ligne créée, `null` si le fait est déjà réservé ou si sa personne est
   * introuvable (adresse inconnue, espace sans admin). `cree_le`, l'heure du fait, est celle de la base.
   */
  async reserver(f: Fait): Promise<string | null> {
    if (f.evenement === 'CompleteRegistration') {
      const res = await this.pool.query<{ id: string }>(
        `insert into conversions_meta (cle, evenement, identity_id, ip, navigateur)
         select 'inscription:' || i.id, 'CompleteRegistration', i.id, left(nullif($2, ''), 64), left(nullif($3, ''), 1000)
           from identities i where lower(i.email) = lower($1)
         on conflict on constraint conversions_meta_cle_unique do nothing
         returning id`,
        [f.adresse, f.ip ?? null, f.navigateur ?? null],
      );
      return res.rows[0]?.id ?? null;
    }
    const prefixe = f.evenement === 'NumeroConnecte' ? 'numero' : 'pro';
    const valeur = f.evenement === 'Subscribe' ? f.valeurCentimes : null;
    const devise = f.evenement === 'Subscribe' ? f.devise : null;
    const res = await this.pool.query<{ id: string }>(
      `insert into conversions_meta (cle, evenement, identity_id, tenant_id, valeur_centimes, devise)
       select $1 || ':' || u.tenant_id, $2, u.identity_id, u.tenant_id, $4, $5
         from users u
        where u.tenant_id = $3 and ${roleAdminEffectifSql('u')} and u.disabled_at is null and u.identity_id is not null
        order by u.created_at
        limit 1
       on conflict on constraint conversions_meta_cle_unique do nothing
       returning id`,
      [prefixe, f.evenement, f.tenantId, valeur, devise],
    );
    return res.rows[0]?.id ?? null;
  }

  /** Une conversion, relue avec l'accord et la preuve d'adresse de sa personne À CET INSTANT. */
  async pourEnvoi(id: string): Promise<ConversionAEnvoyer | null> {
    const res = await this.pool.query<{
      id: string; cle: string; evenement: EvenementMeta; statut: ConversionAEnvoyer['statut']; tentatives: number;
      cree_le: Date; identity_id: string; email: string; adresse_prouvee_le: Date | null; pub_consenti_le: Date | null;
      pub_fbc: string | null; pub_fbp: string | null; pub_navigateur: string | null; valeur_centimes: number | null;
      devise: string | null; ip: string | null; navigateur: string | null;
    }>(
      `select c.id, c.cle, c.evenement, c.statut, c.tentatives, c.cree_le, c.identity_id, i.email, i.adresse_prouvee_le,
              i.pub_consenti_le, i.pub_fbc, i.pub_fbp, i.pub_navigateur, c.valeur_centimes, c.devise, c.ip, c.navigateur
         from conversions_meta c
         join identities i on i.id = c.identity_id
        where c.id = $1`,
      [id],
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id, cle: r.cle, evenement: r.evenement, statut: r.statut, tentatives: Number(r.tentatives), creeLe: r.cree_le,
      identityId: r.identity_id, email: r.email, adresseProuvee: r.adresse_prouvee_le !== null,
      consentiLe: r.pub_consenti_le, fbc: r.pub_fbc, fbp: r.pub_fbp, navigateurAccord: r.pub_navigateur,
      valeurCentimes: r.valeur_centimes === null ? null : Number(r.valeur_centimes), devise: r.devise,
      ip: r.ip, navigateur: r.navigateur,
    };
  }

  /**
   * Prend la conversion pour UNE tentative : seul le travail qui porte le bon numéro la prend, et la prise pose un BAIL
   * de dix minutes (`prochain_essai_le`) pendant lequel le balayage ne la renfile pas. Un worker tué en plein envoi
   * laisse le bail expirer, et l'envoi est repris (l'`event_id` fixe fait fusionner un doublon chez Meta).
   */
  async prendre(id: string, tentative: number): Promise<boolean> {
    const res = await this.pool.query(
      `update conversions_meta set tentatives = tentatives + 1, prochain_essai_le = now() + interval '10 minutes'
        where id = $1 and statut = 'a_envoyer' and tentatives = $2`,
      [id, tentative],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** Parti chez Meta : l'IP et le navigateur, qui ne servaient qu'à l'envoi, sont effacés. */
  async noterEnvoye(id: string): Promise<void> {
    await this.pool.query(
      `update conversions_meta set statut = 'envoye', envoye_le = now(), raison = null, ip = null, navigateur = null
        where id = $1`,
      [id],
    );
  }

  /** Un échec. `reessayerLe` : l'envoi reste à faire et le balayage le reprendra à cette heure ; `null` = définitif. */
  async noterEchec(id: string, raison: string, reessayerLe: Date | null): Promise<void> {
    await this.pool.query(
      `update conversions_meta
          set statut = case when $3::timestamptz is null then 'echec' else 'a_envoyer' end,
              prochain_essai_le = $3::timestamptz,
              raison = left($2, 300),
              ip = case when $3::timestamptz is null then null else ip end,
              navigateur = case when $3::timestamptz is null then null else navigateur end
        where id = $1`,
      [id, raison, reessayerLe],
    );
  }

  /** Rien n'est parti, volontairement (pas d'accord, fait trop ancien, fonction éteinte). */
  async noterIgnore(id: string, raison: string): Promise<void> {
    await this.pool.query(
      `update conversions_meta set statut = 'ignore', raison = $2, ip = null, navigateur = null
        where id = $1 and statut = 'a_envoyer'`,
      [id, raison],
    );
  }

  /**
   * Les conversions à (re)mettre en file : jamais enfilées (plus de cinq minutes après leur réservation), ou dont
   * l'heure du prochain essai est passée. 🔴 Le `where` commence par le prédicat exact de l'index partiel
   * `conversions_meta_a_envoyer_idx`.
   */
  async aReprendre(limite: number): Promise<Array<{ id: string; tentatives: number }>> {
    const res = await this.pool.query<{ id: string; tentatives: number }>(
      `select id, tentatives from conversions_meta
        where statut = 'a_envoyer' and cree_le < now() - interval '5 minutes'
          and (prochain_essai_le is null or prochain_essai_le <= now())
        order by cree_le
        limit $1`,
      [limite],
    );
    return res.rows.map((r) => ({ id: r.id, tentatives: Number(r.tentatives) }));
  }

  /**
   * L'accord donné à la création d'un compte (la case cochée), par l'adresse que la route connaît. Un accord déjà
   * présent garde sa date ; des identifiants de Meta neufs remplacent les anciens. `navigateur` : celui de la requête,
   * que Meta exige pour un événement de site web, et qui servira aux faits suivants de la personne.
   */
  async enregistrerConsentement(adresse: string, pub: ChampPub, navigateur: string | null): Promise<void> {
    await this.pool.query(
      `update identities set pub_consenti_le = coalesce(pub_consenti_le, now()),
              pub_fbc = coalesce($2, pub_fbc), pub_fbp = coalesce($3, pub_fbp),
              pub_navigateur = coalesce(left(nullif($4, ''), 1000), pub_navigateur)
        where lower(email) = lower($1)`,
      [adresse, pub.fbc ?? null, pub.fbp ?? null, navigateur],
    );
  }

  /** L'accord de la personne, pour l'interrupteur de sa page de compte. */
  async consentement(identityId: string): Promise<{ accord: boolean; depuis: Date | null } | null> {
    const res = await this.pool.query<{ pub_consenti_le: Date | null }>(
      'select pub_consenti_le from identities where id = $1',
      [identityId],
    );
    const r = res.rows[0];
    return r ? { accord: r.pub_consenti_le !== null, depuis: r.pub_consenti_le } : null;
  }

  /**
   * L'interrupteur. Accorder pose la date (sans la déplacer si elle existe) : seuls les faits qui suivent partiront.
   * 🔴 Retirer efface la date et les identifiants de Meta, et abandonne dans la même transaction ce qui attendait
   * encore pour cette personne : rien ne part après le retrait.
   */
  async poserConsentement(identityId: string, accord: boolean, navigateur: string | null): Promise<void> {
    if (accord) {
      await this.pool.query(
        `update identities set pub_consenti_le = coalesce(pub_consenti_le, now()),
                pub_navigateur = coalesce(left(nullif($2, ''), 1000), pub_navigateur)
          where id = $1`,
        [identityId, navigateur],
      );
      return;
    }
    await enTransaction(this.pool, async (client) => {
      await client.query('update identities set pub_consenti_le = null, pub_fbc = null, pub_fbp = null, pub_navigateur = null where id = $1', [identityId]);
      await client.query(
        `update conversions_meta set statut = 'ignore', raison = 'retrait', ip = null, navigateur = null
          where identity_id = $1 and statut = 'a_envoyer'`,
        [identityId],
      );
    });
  }

  /**
   * Google a prouvé cette adresse : son empreinte pourra partir. Seule la PREMIÈRE preuve écrit (une connexion Google
   * ne réécrit pas la ligne à chaque fois). 🔴 Et elle efface l'accord donné avant elle : une inscription par e-mail
   * peut avoir été faite, case cochée, par quelqu'un d'autre que le titulaire, qui entre maintenant par Google. Si
   * cette entrée coche la case, l'accord se réenregistre juste après (`apresEntree`).
   */
  async marquerAdresseProuvee(adresse: string): Promise<void> {
    await this.pool.query(
      `update identities set adresse_prouvee_le = now(),
              pub_consenti_le = null, pub_fbc = null, pub_fbp = null, pub_navigateur = null
        where lower(email) = lower($1) and adresse_prouvee_le is null`,
      [adresse],
    );
  }
}
