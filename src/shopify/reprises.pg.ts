import type { Pool } from 'pg';

/**
 * LES REPRISES DE L'HISTORIQUE SHOPIFY (segments Shopify enrichis, lot 5, migration 0313) : une ligne par rattrapage
 * lancé. Le job du worker la tient par un BAIL (`bail_jusqua`) et un JETON DE GARDE (`jeton`), renouvelés à chaque page :
 * un worker tué laisse le bail mourir et un autre reprend au curseur ; le porteur d'un bail périmé ne peut plus rien
 * écrire, toutes ses écritures filtrant sur son jeton. Pas de drapeau de relance : un second lancement est REFUSÉ tant
 * qu'une reprise vit (index unique partiel `shopify_reprises_vivante`), il ne s'empile pas. La reprise garde le domaine de
 * sa boutique : elle ne continue jamais sur une autre.
 *
 * 🔴 Chaque requête nomme `tenant_id` : le rôle de l'application contourne la RLS, ce filtre est le seul contrôle.
 */

export type StatutReprise = 'en_attente' | 'en_cours' | 'termine' | 'refuse' | 'erreur';
export interface ComptesReprise { lues: number; rattachees: number; deja: number; sansFiche: number; sansNumero: number }
export interface Reprise {
  id: string;
  statut: StatutReprise;
  /** La boutique lue (son domaine `.myshopify.com`), fixée au lancement. */
  domaine: string;
  fenetreDebut: Date;
  curseur: string | null;
  comptes: ComptesReprise;
  erreur: string | null;
  par: string | null;
  commenceLe: Date;
  majLe: Date;
  finiLe: Date | null;
  /** Le bail court-il encore ? (un worker la tient) */
  tenue: boolean;
}

/** Le bail d'un passage : plus long qu'un passage (2 min) et qu'une page, renouvelé à chaque page. */
export const BAIL_REPRISE_SECONDES = 180;
/** Une reprise vivante dont rien n'a bougé depuis ce délai, bail mort, est close en `erreur` au lancement suivant. */
export const REPRISE_ABANDONNEE_MINUTES = 15;
/** L'erreur écrite sur une reprise abandonnée : le worker qui la tenait est mort sans relance. */
export const ERREUR_ABANDON = 'rattrapage interrompu : aucun passage depuis 15 minutes, relancez-le';
const AUCUN: ComptesReprise = { lues: 0, rattachees: 0, deja: 0, sansFiche: 0, sansNumero: 0 };

const COLONNES = `id, statut, domaine, fenetre_debut, curseur, lues, rattachees, deja, sans_fiche, sans_numero, erreur, par,
  commence_le, maj_le, fini_le, (bail_jusqua is not null and bail_jusqua > now()) as tenue`;

interface Ligne {
  id: string; statut: StatutReprise; domaine: string; fenetre_debut: Date; curseur: string | null; lues: number;
  rattachees: number; deja: number; sans_fiche: number; sans_numero: number; erreur: string | null; par: string | null;
  commence_le: Date; maj_le: Date; fini_le: Date | null; tenue: boolean;
}
const reprise = (l: Ligne): Reprise => ({
  id: l.id, statut: l.statut, domaine: l.domaine, fenetreDebut: l.fenetre_debut, curseur: l.curseur, erreur: l.erreur, par: l.par,
  comptes: { lues: l.lues, rattachees: l.rattachees, deja: l.deja, sansFiche: l.sans_fiche, sansNumero: l.sans_numero },
  commenceLe: l.commence_le, majLe: l.maj_le, finiLe: l.fini_le, tenue: l.tenue,
});
const estUnicite = (err: unknown): boolean => (err as { code?: string }).code === '23505';
/** Une erreur écrite tient dans sa colonne (1 à 500 caractères) : vide, elle devient nulle. */
const erreurEcrite = (e: string | null): string | null => (e === null || e.trim() === '' ? null : e.slice(0, 500));

export class PgReprisesStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Lance une reprise des commandes : clôt d'abord une reprise vivante ABANDONNÉE (bail mort, rien depuis 15 min),
   * puis insère. Une reprise encore vivante fait refuser le lancement : elle est rendue, pour que l'écran la montre.
   */
  async lancer(tenantId: string, fenetreDebut: Date, domaine: string, par: string | null): Promise<{ ok: true; reprise: Reprise } | { ok: false; vivante: Reprise }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update shopify_reprises set statut = 'erreur', erreur = $2, fini_le = now(), maj_le = now(), bail_jusqua = null, jeton = null
          where tenant_id = $1 and genre = 'commandes' and statut in ('en_attente', 'en_cours')
            and maj_le < now() - make_interval(mins => $3) and (bail_jusqua is null or bail_jusqua < now())`,
        [tenantId, ERREUR_ABANDON, REPRISE_ABANDONNEE_MINUTES],
      );
      const res = await client.query<Ligne>(
        `insert into shopify_reprises (tenant_id, genre, domaine, fenetre_debut, par) values ($1, 'commandes', $2, $3, $4)
         returning ${COLONNES}`,
        [tenantId, domaine, fenetreDebut, par === null ? null : par.slice(0, 200)],
      );
      await client.query('commit');
      return { ok: true, reprise: reprise(res.rows[0]!) };
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      if (!estUnicite(err)) throw err;
      const vivante = await client.query<Ligne>(
        `select ${COLONNES} from shopify_reprises where tenant_id = $1 and genre = 'commandes' and statut in ('en_attente', 'en_cours')`,
        [tenantId],
      );
      if (!vivante.rows[0]) throw err;
      return { ok: false, vivante: reprise(vivante.rows[0]) };
    } finally {
      client.release();
    }
  }

  /** Prend le bail d'une reprise vivante dont le bail est libre ou mort ; `null` sinon (finie, ou tenue par un autre). */
  async prendre(id: string, tenantId: string): Promise<{ jeton: string; reprise: Reprise } | null> {
    const res = await this.pool.query<Ligne & { jeton: string }>(
      `update shopify_reprises set statut = 'en_cours', jeton = gen_random_uuid(), maj_le = now(),
              bail_jusqua = now() + make_interval(secs => $3)
        where id = $1 and tenant_id = $2 and statut in ('en_attente', 'en_cours')
          and (bail_jusqua is null or bail_jusqua < now())
       returning ${COLONNES}, jeton`,
      [id, tenantId, BAIL_REPRISE_SECONDES],
    );
    const l = res.rows[0];
    return l ? { jeton: l.jeton, reprise: reprise(l) } : null;
  }

  /**
   * Une page faite : le curseur de la suivante, les comptes ajoutés, le bail renouvelé. `false` si le jeton n'est plus
   * le bon (bail perdu, reprise close ailleurs) : le passage s'arrête sans rien écrire de plus.
   */
  async avancer(id: string, tenantId: string, jeton: string, curseur: string, ajout: ComptesReprise): Promise<boolean> {
    const res = await this.pool.query(
      `update shopify_reprises set curseur = $4, lues = lues + $5, rattachees = rattachees + $6, deja = deja + $7,
              sans_fiche = sans_fiche + $8, sans_numero = sans_numero + $9, maj_le = now(),
              bail_jusqua = now() + make_interval(secs => $10)
        where id = $1 and tenant_id = $2 and jeton = $3 and statut = 'en_cours'`,
      [id, tenantId, jeton, curseur, ajout.lues, ajout.rattachees, ajout.deja, ajout.sansFiche, ajout.sansNumero, BAIL_REPRISE_SECONDES],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** La fin d'un passage dont la suite est déjà réenfilée, ou une panne : le bail se libère, la reprise reste vivante. */
  async relacher(id: string, tenantId: string, jeton: string): Promise<void> {
    await this.pool.query(
      `update shopify_reprises set bail_jusqua = null, jeton = null, maj_le = now() where id = $1 and tenant_id = $2 and jeton = $3`,
      [id, tenantId, jeton],
    );
  }

  /**
   * Clôt la reprise (`termine`, `refuse` ou `erreur`), en ajoutant les comptes de sa dernière page dans la MÊME écriture
   * (un échec entre « avancer » et « finir » ferait relire et recompter cette page) ; `false` si le jeton n'est plus le bon.
   */
  async finir(
    id: string, tenantId: string, jeton: string, statut: 'termine' | 'refuse' | 'erreur', erreur: string | null, ajout: ComptesReprise = AUCUN,
  ): Promise<boolean> {
    const res = await this.pool.query(
      `update shopify_reprises set statut = $4, erreur = $5, fini_le = now(), maj_le = now(), bail_jusqua = null, jeton = null,
              lues = lues + $6, rattachees = rattachees + $7, deja = deja + $8, sans_fiche = sans_fiche + $9,
              sans_numero = sans_numero + $10
        where id = $1 and tenant_id = $2 and jeton = $3 and statut = 'en_cours'`,
      [id, tenantId, jeton, statut, erreurEcrite(erreur), ajout.lues, ajout.rattachees, ajout.deja, ajout.sansFiche, ajout.sansNumero],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Clôt en `erreur` une reprise qui n'a jamais été prise (son job n'a pas pu être enfilé) : vivante, elle refuserait tout
   * lancement pendant 15 minutes. Une reprise déjà prise n'est jamais touchée.
   */
  async annuler(id: string, tenantId: string, erreur: string): Promise<void> {
    await this.pool.query(
      `update shopify_reprises set statut = 'erreur', erreur = $3, fini_le = now(), maj_le = now()
        where id = $1 and tenant_id = $2 and statut = 'en_attente' and jeton is null`,
      [id, tenantId, erreurEcrite(erreur)],
    );
  }

  /** Une reprise de l'espace, par son identifiant. */
  async lire(id: string, tenantId: string): Promise<Reprise | null> {
    const res = await this.pool.query<Ligne>(`select ${COLONNES} from shopify_reprises where id = $1 and tenant_id = $2`, [id, tenantId]);
    return res.rows[0] ? reprise(res.rows[0]) : null;
  }

  /** La dernière reprise des commandes de l'espace, vivante ou finie : l'état que la carte et l'outil montrent. */
  async derniere(tenantId: string): Promise<Reprise | null> {
    const res = await this.pool.query<Ligne>(
      `select ${COLONNES} from shopify_reprises where tenant_id = $1 and genre = 'commandes' order by commence_le desc limit 1`,
      [tenantId],
    );
    return res.rows[0] ? reprise(res.rows[0]) : null;
  }
}
