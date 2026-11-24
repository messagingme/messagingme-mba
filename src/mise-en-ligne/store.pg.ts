import type { Pool } from 'pg';
import { roleAdminEffectifSql } from '../offres/membres';
import type { ActionGardee, ResultatAction } from './mise-en-ligne';

/**
 * LES MISES EN LIGNE EN BASE (`mises_en_ligne`, migration 0316 ; lot 1 du CSM virtuel, B2). 🔴 Chaque requête filtre
 * `tenant_id` : c'est le seul contrôle d'isolation. Chaque transition est UNE requête conditionnelle, jamais une
 * transaction qui tiendrait un verrou pendant d'autres lectures : deux clics simultanés, une seule acceptation ; deux
 * exécutions, un seul bail.
 */

export const ETATS_MISE_EN_LIGNE = ['proposee', 'acceptee', 'faite', 'echouee'] as const;
export type EtatEnBase = (typeof ETATS_MISE_EN_LIGNE)[number];

export interface LigneMiseEnLigne {
  id: string;
  libelle: string;
  recapitulatif: string[];
  actions: ActionGardee[];
  empreinte: string;
  etat: EtatEnBase;
  /** ISO 8601. */
  expireLe: string;
  /** Proposée et échue : le bouton ne sert plus. */
  expiree: boolean;
  /** Acceptée et son bail court : une exécution est en cours. */
  enCours: boolean;
  proposeePar: string;
  accepteePar: string | null;
  accepteeLe: string | null;
  resultat: ResultatAction[];
  termineeLe: string | null;
}

export type IssueAcceptation = 'ok' | 'inconnue' | 'expiree' | 'deja' | 'modifiee';

/** Ce que l'exécution reçoit en prenant le bail : quoi faire, ce qui est déjà fait, et si les accès tiennent encore. */
export interface Reclamation {
  actions: ActionGardee[];
  resultat: ResultatAction[];
  accepteePar: string;
  /** L'admin qui a cliqué l'est encore (actif, administrateur de l'espace). */
  clicValide: boolean;
  /** La personne qui a préparé l'est encore, et l'accès par lequel elle l'a fait n'est pas révoqué. */
  accesValide: boolean;
}

interface Ligne {
  id: string;
  libelle: string;
  recapitulatif: string[];
  actions: ActionGardee[];
  empreinte: string;
  etat: EtatEnBase;
  expire_le: Date;
  expiree: boolean;
  en_cours: boolean;
  proposee_par: string;
  acceptee_par: string | null;
  acceptee_le: Date | null;
  resultat: ResultatAction[];
  terminee_le: Date | null;
}

const COLONNES = `id, libelle, recapitulatif, actions, empreinte, etat, expire_le,
  (etat = 'proposee' and expire_le <= now()) as expiree,
  (etat = 'acceptee' and execution_bail is not null and execution_bail > now()) as en_cours,
  proposee_par, acceptee_par, acceptee_le, resultat, terminee_le`;

/** Un administrateur actif de l'espace de la ligne `m` : la règle du jeton OAuth (`src/oauth/store.pg.ts`). */
const ADMIN_ACTIF = (colonne: string): string => `exists (select 1 from users u
  where u.id = ${colonne} and u.tenant_id = m.tenant_id and u.disabled_at is null and not u.invitation_en_attente
    and ${roleAdminEffectifSql('u')})`;

const vue = (l: Ligne): LigneMiseEnLigne => ({
  id: l.id,
  libelle: l.libelle,
  recapitulatif: l.recapitulatif,
  actions: l.actions,
  empreinte: l.empreinte,
  etat: l.etat,
  expireLe: l.expire_le.toISOString(),
  expiree: l.expiree,
  enCours: l.en_cours,
  proposeePar: l.proposee_par,
  accepteePar: l.acceptee_par,
  accepteeLe: l.acceptee_le?.toISOString() ?? null,
  resultat: l.resultat,
  termineeLe: l.terminee_le?.toISOString() ?? null,
});

export class PgMisesEnLigne {
  constructor(private readonly pool: Pool) {}

  async inserer(tenantId: string, m: {
    proposeePar: string; autorisationId: string | null; libelle: string; recapitulatif: string[];
    actions: ActionGardee[]; empreinte: string; expireLe: Date;
  }): Promise<{ id: string }> {
    const r = await this.pool.query<{ id: string }>(
      `insert into mises_en_ligne (tenant_id, proposee_par, autorisation_id, libelle, recapitulatif, actions, empreinte, expire_le)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
       returning id`,
      [tenantId, m.proposeePar, m.autorisationId, m.libelle, JSON.stringify(m.recapitulatif), JSON.stringify(m.actions), m.empreinte, m.expireLe],
    );
    return { id: r.rows[0]!.id };
  }

  /** Une mise en ligne de l'espace, ou `null` (inconnue, ou d'un autre espace). L'appelant a vérifié la forme de l'id. */
  async lire(tenantId: string, id: string): Promise<LigneMiseEnLigne | null> {
    const r = await this.pool.query<Ligne>(`select ${COLONNES} from mises_en_ligne where id = $1 and tenant_id = $2`, [id, tenantId]);
    const l = r.rows[0];
    return l ? vue(l) : null;
  }

  /**
   * 🔴 Le clic, en UNE requête : proposée, pas échue, et sur l'empreinte recalculée par l'appelant. Deux clics simultanés :
   * le second attend le verrou de la ligne, la relit acceptée, et ne passe pas. Sinon, la cause, relue.
   */
  async accepter(tenantId: string, id: string, par: string, empreinte: string): Promise<IssueAcceptation> {
    const r = await this.pool.query(
      `update mises_en_ligne set etat = 'acceptee', acceptee_par = $3, acceptee_le = now()
        where id = $1 and tenant_id = $2 and etat = 'proposee' and expire_le > now() and empreinte = $4`,
      [id, tenantId, par, empreinte],
    );
    if ((r.rowCount ?? 0) > 0) return 'ok';
    const l = await this.lire(tenantId, id);
    if (l === null) return 'inconnue';
    if (l.etat !== 'proposee') return 'deja';
    if (l.expiree) return 'expiree';
    return 'modifiee';
  }

  /**
   * Prend le bail de l'exécution d'une mise en ligne acceptée, si personne ne le tient (jamais pris, ou échu). `null` :
   * une exécution vivante le tient, ou il n'y a rien à exécuter. Les accès se relisent ICI, dans la même requête : un
   * admin retiré ou un accès révoqué avant l'exécution la bloque.
   */
  async reclamer(tenantId: string, id: string, jeton: string, bailS: number): Promise<Reclamation | null> {
    const r = await this.pool.query<{
      actions: ActionGardee[]; resultat: ResultatAction[]; acceptee_par: string; clic_valide: boolean; acces_valide: boolean;
    }>(
      `update mises_en_ligne m set execution_jeton = $3, execution_bail = now() + make_interval(secs => $4)
        where m.id = $1 and m.tenant_id = $2 and m.etat = 'acceptee'
          and (m.execution_bail is null or m.execution_bail <= now())
        returning m.actions, m.resultat, m.acceptee_par,
          ${ADMIN_ACTIF('m.acceptee_par')} as clic_valide,
          (${ADMIN_ACTIF('m.proposee_par')}
            and (m.autorisation_id is null or exists (select 1 from oauth_autorisations a
                  where a.id = m.autorisation_id and a.tenant_id = m.tenant_id and a.revoque_le is null))) as acces_valide`,
      [id, tenantId, jeton, Math.max(1, Math.ceil(bailS))],
    );
    const l = r.rows[0];
    if (!l) return null;
    return { actions: l.actions, resultat: l.resultat, accepteePar: l.acceptee_par, clicValide: l.clic_valide, accesValide: l.acces_valide };
  }

  /** Ajoute le résultat de l'action suivante et repousse le bail. `false` : on ne tient plus le bail, il faut s'arrêter. */
  async noterResultat(tenantId: string, id: string, jeton: string, resultat: ResultatAction, bailS: number): Promise<boolean> {
    const r = await this.pool.query(
      `update mises_en_ligne set resultat = resultat || jsonb_build_array($4::jsonb), execution_bail = now() + make_interval(secs => $5)
        where id = $1 and tenant_id = $2 and etat = 'acceptee' and execution_jeton = $3`,
      [id, tenantId, jeton, JSON.stringify(resultat), Math.max(1, Math.ceil(bailS))],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Rend le bail sans rien conclure (une panne) : la mise en ligne reste acceptée, et se reprend tout de suite. */
  async relacher(tenantId: string, id: string, jeton: string): Promise<void> {
    await this.pool.query(
      `update mises_en_ligne set execution_jeton = null, execution_bail = null
        where id = $1 and tenant_id = $2 and etat = 'acceptee' and execution_jeton = $3`,
      [id, tenantId, jeton],
    );
  }

  /** Clôt l'exécution (sous le jeton) : `faite` ou `echouee`. `false` : le bail était perdu, un autre a la main. */
  async terminer(tenantId: string, id: string, jeton: string, etat: 'faite' | 'echouee'): Promise<boolean> {
    const r = await this.pool.query(
      `update mises_en_ligne set etat = $4, terminee_le = now(), execution_jeton = null, execution_bail = null
        where id = $1 and tenant_id = $2 and etat = 'acceptee' and execution_jeton = $3`,
      [id, tenantId, jeton, etat],
    );
    return (r.rowCount ?? 0) > 0;
  }
}
