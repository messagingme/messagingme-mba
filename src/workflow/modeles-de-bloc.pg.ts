import type { Pool } from 'pg';
import type { EtatModeleDeBloc } from './modeles-de-bloc';

/**
 * Le magasin de `modeles_de_bloc` (migration 0296) : un template écrit depuis un bloc du constructeur, et son état
 * tranché par Meta. `tenant_id = $1` sur chaque requête, sauf `attentesAnciennes`, la lecture transverse du filet, nommée
 * comme celle de l'assistant Shopify (`src/shopify/store.pg.ts`). Aucune lecture de `workflows` ici : le scénario se lit
 * par `PgWorkflowStore`.
 */
export interface LigneModeleDeBloc {
  workflowId: string;
  modele: string;
  langue: string;
  etat: EtatModeleDeBloc;
  raison: string | null;
  creeLe: string;
  trancheLe: string | null;
}

/** La raison d'un refus, bornée comme le CHECK de la table et comme les e-mails. */
export const RAISON_MAX = 300;

interface Ligne {
  workflow_id: string; modele: string; langue: string; etat: EtatModeleDeBloc; raison: string | null;
  cree_le: Date; tranche_le: Date | null;
}
const COLONNES = 'workflow_id, modele, langue, etat, raison, cree_le, tranche_le';
const versLigne = (r: Ligne): LigneModeleDeBloc => ({
  workflowId: r.workflow_id,
  modele: r.modele,
  langue: r.langue,
  etat: r.etat,
  raison: r.raison,
  creeLe: r.cree_le.toISOString(),
  trancheLe: r.tranche_le ? r.tranche_le.toISOString() : null,
});

export class PgModelesDeBloc {
  constructor(private readonly pool: Pool) {}

  /** Une ligne par template créé depuis un bloc. Son nom est neuf (horodaté côté serveur) : un conflit ne remplace rien. */
  async inserer(
    tenantId: string,
    l: { workflowId: string; modele: string; langue: string; etat: EtatModeleDeBloc; par: string | null },
  ): Promise<void> {
    await this.pool.query(
      `insert into modeles_de_bloc (tenant_id, workflow_id, modele, langue, etat, par, tranche_le)
       values ($1, $2, $3, $4, $5, $6, case when $5 = 'en_validation' then null else now() end)
       on conflict (tenant_id, modele, langue) do nothing`,
      [tenantId, l.workflowId, l.modele, l.langue, l.etat, l.par],
    );
  }

  /** Ceux de ces templates (nom, langue) qui ont été écrits depuis un bloc ; les autres n'ont pas de ligne. */
  async desModeles(tenantId: string, paires: ReadonlyArray<{ modele: string; langue: string }>): Promise<LigneModeleDeBloc[]> {
    if (paires.length === 0) return [];
    const r = await this.pool.query<Ligne>(
      `select ${COLONNES} from modeles_de_bloc
        where tenant_id = $1 and (modele, langue) in (select * from unnest($2::text[], $3::text[]))`,
      [tenantId, paires.map((p) => p.modele), paires.map((p) => p.langue)],
    );
    return r.rows.map(versLigne);
  }

  /**
   * Tranche UNE fois : seule une ligne encore en validation change, et `returning` dit qui a gagné. Le statut rejoué par
   * Meta, le filet et la relecture avant publication ne trouvent ensuite plus rien.
   */
  async trancher(
    tenantId: string, modele: string, langue: string, etat: 'approuve' | 'refuse', raison: string | null,
  ): Promise<LigneModeleDeBloc | null> {
    const r = await this.pool.query<Ligne>(
      `update modeles_de_bloc set etat = $4, raison = $5, tranche_le = now()
        where tenant_id = $1 and modele = $2 and langue = $3 and etat = 'en_validation'
        returning ${COLONNES}`,
      [tenantId, modele, langue, etat, raison === null ? null : raison.slice(0, RAISON_MAX)],
    );
    return r.rows[0] ? versLigne(r.rows[0]) : null;
  }

  /**
   * Un template REFUSÉ que Meta approuve ensuite (un appel gagné, une correction dans Contenu > Templates) : la ligne
   * redevient approuvée, sa raison s'efface. Seule une ligne refusée change (relecture de 3a) : sans ce chemin, la clé
   * (espace, nom, langue) gardait le refus à jamais, et tout scénario qui nomme ce template restait impubliable.
   */
  async rehabiliter(tenantId: string, modele: string, langue: string): Promise<LigneModeleDeBloc | null> {
    const r = await this.pool.query<Ligne>(
      `update modeles_de_bloc set etat = 'approuve', raison = null, tranche_le = now()
        where tenant_id = $1 and modele = $2 and langue = $3 and etat = 'refuse'
        returning ${COLONNES}`,
      [tenantId, modele, langue],
    );
    return r.rows[0] ? versLigne(r.rows[0]) : null;
  }

  /**
   * LECTURE TRANSVERSE (tous espaces), pour le filet seulement : les templates encore en validation depuis plus de
   * `minutes`, tirés au hasard. 🔴 Son `where` reprend mot pour mot le prédicat de `modeles_de_bloc_en_validation_idx`.
   */
  async attentesAnciennes(minutes: number, limite: number): Promise<Array<{ tenantId: string; modele: string; langue: string }>> {
    const r = await this.pool.query<{ tenant_id: string; modele: string; langue: string }>(
      `select tenant_id, modele, langue from modeles_de_bloc
        where etat = 'en_validation' and cree_le <= now() - make_interval(mins => $1::int)
        order by random() limit $2`,
      [minutes, limite],
    );
    return r.rows.map((x) => ({ tenantId: x.tenant_id, modele: x.modele, langue: x.langue }));
  }
}
