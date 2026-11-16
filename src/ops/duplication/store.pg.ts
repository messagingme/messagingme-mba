import type { Pool } from 'pg';
import { PgWorkflowStore, grapheEditable, insererBrouillon, nomPrisSousVerrou } from '../../workflow/store.pg';
import { PgAutomationStore } from '../../automation/store.pg';
import { PgUserFieldStore } from '../../crm/field-store.pg';
import { resolveTenantCode } from '../../ids/tenant-code';
import type { UserFieldDef } from '../../crm/types';
import type { EtatDuplication, PlanDuplication } from './plan';

/**
 * LA BASE D'UNE DUPLICATION DE SCÉNARIO ENTRE ESPACES (duplication depuis /ops, lot 1 ; spec
 * `docs/superpowers/specs/2026-11-16-duplication-scenario-entre-espaces-design.md`).
 *
 * 🔴 ISOLATION. Le rôle de l'application possède les tables (la RLS est contournée) : le filtre d'espace en SQL est le
 * seul contrôle. Chaque lecture de la source passe par `source`, chaque écriture par `destination`. Le scénario se lit
 * par `getById(scenarioId, source)` : celui d'un autre espace, ou le scénario système du répondeur, rend `null`.
 *
 * 🔴 UNE TRANSACTION. `ecrire` pose les champs, le scénario et ses déclencheurs sur le client qui tient la transaction,
 * jamais sur le pool : un échec en route n'en laisse rien. Le nom « X (copie) » se choisit sous le verrou de nom de la
 * destination (`nomPrisSousVerrou`), tenu jusqu'au `commit`.
 */

/** Ce que la base dit de la duplication ; la route y ajoute la WABA (Meta) et l'offre. */
export type EtatEnBase = Omit<EtatDuplication, 'templatesDestination' | 'offreOuvreScenarios'>;

export interface EspaceDuplication { id: string; nom: string; waba: boolean }

export interface CopieEcrite {
  scenarioId: string;
  /** Le nom choisi sous le verrou : il fait foi, l'aperçu n'en donnait qu'une estimation. */
  nom: string;
  champsCrees: string[];
  declencheursCopies: number;
}

/** La définition d'un champ, sans son code public : il change au backfill et ne dit rien de ce qu'on recrée. */
const definition = ({ key, label, type }: UserFieldDef): UserFieldDef => ({ key, label, type });

export class PgDuplicationStore {
  constructor(private readonly pool: Pool) {}

  /** Tous les espaces, pour les deux listes de l'onglet, avec la présence d'une WABA (sans elle, la copie est refusée). */
  async espaces(): Promise<EspaceDuplication[]> {
    const r = await this.pool.query<{ id: string; name: string; waba: boolean }>(
      `select t.id, t.name, exists (select 1 from waba w where w.tenant_id = t.id) as waba
         from tenants t order by lower(t.name), t.id`,
    );
    return r.rows.map((x) => ({ id: x.id, nom: x.name, waba: x.waba }));
  }

  /** Les scénarios publics d'un espace (jamais celui du répondeur), par nom. */
  async scenarios(tenantId: string): Promise<Array<{ id: string; nom: string }>> {
    const rows = await new PgWorkflowStore(this.pool).listResume(tenantId);
    return rows.map((w) => ({ id: w.id, nom: w.name })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }

  /** `null` = un des deux espaces est inconnu, ou le scénario n'est pas un scénario public de la source. */
  async lireEtat(source: string, scenarioId: string, destination: string): Promise<EtatEnBase | null> {
    const t = await this.pool.query<{ id: string; name: string }>(
      'select id, name from tenants where id = any($1::uuid[])', [[source, destination]],
    );
    const src = t.rows.find((x) => x.id === source);
    const dst = t.rows.find((x) => x.id === destination);
    if (!src || !dst) return null;
    const workflows = new PgWorkflowStore(this.pool);
    const row = await workflows.getById(scenarioId, source);
    if (!row) return null;
    const automations = new PgAutomationStore(this.pool);
    const champs = new PgUserFieldStore(this.pool);
    const [autoSource, autoDestination, champsSource, champsDestination, nomsPris, codeClient] = await Promise.all([
      automations.toutesPourLaDuplication(source),
      automations.toutesPourLaDuplication(destination),
      champs.list(source),
      champs.list(destination),
      workflows.listResume(destination),
      resolveTenantCode(this.pool, destination),
    ]);
    return {
      source: { id: src.id, nom: src.name },
      destination: { id: dst.id, nom: dst.name, codeClient },
      // Ce que l'auteur voit : le brouillon s'il existe. La copie naît en brouillon et ne publie rien.
      scenario: { id: row.id, nom: row.name, graphe: grapheEditable(row) },
      automationsDuScenario: autoSource.filter((a) => a.workflowId === row.id),
      automationsDeLaDestination: autoDestination,
      champsSource: champsSource.map(definition),
      champsDestination: champsDestination.map(definition),
      nomsPrisDestination: nomsPris.map((w) => w.name),
    };
  }

  /** Écrit le plan dans la destination, en une transaction. `nomSource` : le nom du scénario copié. */
  async ecrire(destination: string, nomSource: string, plan: PlanDuplication): Promise<CopieEcrite> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      let nom = `${nomSource} (copie)`;
      for (let n = 2; (await nomPrisSousVerrou(c, destination, nom, null)) !== null; n += 1) nom = `${nomSource} (copie ${n})`;
      const champs = new PgUserFieldStore(c);
      const champsCrees: string[] = [];
      for (const def of plan.champsACreer) {
        if ((await champs.create(destination, def)) === 'created') champsCrees.push(def.key);
      }
      const { id } = await insererBrouillon(c, destination, nom, plan.graphe.graphe);
      const automations = new PgAutomationStore(c);
      for (const d of plan.declencheurs.copies) await automations.create(destination, { ...d, workflowId: id });
      await c.query('commit');
      return { scenarioId: id, nom, champsCrees, declencheursCopies: plan.declencheurs.copies.length };
    } catch (err) {
      await c.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }
}
