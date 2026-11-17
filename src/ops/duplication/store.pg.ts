import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PgWorkflowStore, grapheEditable, insererBrouillon, nomPrisSousVerrou } from '../../workflow/store.pg';
import { PgAutomationStore } from '../../automation/store.pg';
import { PgUserFieldStore } from '../../crm/field-store.pg';
import { resolveTenantCode } from '../../ids/tenant-code';
import type { UserFieldDef } from '../../crm/types';
import type { EtatDuplication, PlanDuplication } from './plan';
import { debrancherTemplates, rebrancher, referencesDuGraphe, type BlocDebranche } from './graphe';
import { rebrancherCible } from './dependances';
import type { FlowSource } from './meta';
import {
  copierAgent, copierModeleEmail, copierOutil, copierRequete, copierSource, lierOutil, lireDependances, lireFlowsSource, nomsPris,
} from './dependances.pg';

/**
 * LA BASE D'UNE DUPLICATION DE SCÉNARIO ENTRE ESPACES (duplication depuis /ops, lots 1 et 2 ; spec
 * `docs/superpowers/specs/2026-11-16-duplication-scenario-entre-espaces-design.md`).
 *
 * 🔴 ISOLATION. Le rôle de l'application possède les tables (la RLS est contournée) : le filtre d'espace en SQL est le
 * seul contrôle. Chaque lecture de la source passe par `source`, chaque écriture par `destination`. Le scénario se lit
 * par `getById(scenarioId, source)` : celui d'un autre espace, ou le scénario système du répondeur, rend `null`. Ses
 * dépendances se lisent par `lireDependances`, filtrées sur la source, et se copient par `INSERT … SELECT` qui portent les
 * deux filtres (`dependances.pg.ts`).
 *
 * 🔴 UNE TRANSACTION. `ecrire` pose les champs, les dépendances cochées, le scénario et ses déclencheurs sur le client
 * qui tient la transaction, jamais sur le pool : un échec en route n'en laisse rien. Le nom « X (copie) » se choisit sous
 * le verrou de nom de la destination (`nomPrisSousVerrou`), tenu jusqu'au `commit`. L'id du scénario est tiré d'avance :
 * les outils d'un agent copié qui visent le scénario visent sa copie, écrite après eux.
 */

/**
 * Ce que la base dit de la duplication. La route y ajoute les templates (Meta), puis les Flows et les indications de
 * variables qu'ils désignent (lus après eux, `flowsSource`), l'offre et le crédit IA de la destination.
 */
export type EtatEnBase = Omit<
  EtatDuplication, 'templatesDestination' | 'modelesSource' | 'flowsSource' | 'indicesSource' | 'offreOuvreScenarios' | 'creditIaOuvert'
>;

export interface EspaceDuplication { id: string; nom: string; waba: boolean }

export interface CopieEcrite {
  scenarioId: string;
  /** Le nom choisi sous le verrou : il fait foi, l'aperçu n'en donnait qu'une estimation. */
  nom: string;
  champsCrees: string[];
  declencheursCopies: number;
  /** Ce qui a été copié avec le scénario, par nom (lot 2). `sourcesAvecSecret` : les sources dont le chiffré a suivi. */
  dependancesCopiees: { agents: string[]; requetes: string[]; modelesEmail: string[]; sourcesAvecSecret: string[] };
  /** Les blocs restés débranchés APRÈS le rebranchement sur les copies : ceux à rebrancher à la main. */
  debranches: BlocDebranche[];
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

  /** Les scénarios publics d'un espace (jamais celui du répondeur), par nom, sans leurs graphes. */
  async scenarios(tenantId: string): Promise<Array<{ id: string; nom: string }>> {
    return (await new PgWorkflowStore(this.pool).listNoms(tenantId)).map((w) => ({ id: w.id, nom: w.name }));
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
    // Ce que l'auteur voit : le brouillon s'il existe. La copie naît en brouillon et ne publie rien.
    const graphe = grapheEditable(row);
    const automations = new PgAutomationStore(this.pool);
    const champs = new PgUserFieldStore(this.pool);
    const [autoSource, autoDestination, champsSource, champsDestination, noms, codeClient, dependances, pris] = await Promise.all([
      automations.toutesPourLaDuplication(source),
      automations.toutesPourLaDuplication(destination),
      champs.list(source),
      champs.list(destination),
      workflows.listNoms(destination),
      resolveTenantCode(this.pool, destination),
      lireDependances(this.pool, source, referencesDuGraphe(graphe)),
      nomsPris(this.pool, destination),
    ]);
    return {
      source: { id: src.id, nom: src.name },
      destination: { id: dst.id, nom: dst.name, codeClient },
      scenario: { id: row.id, nom: row.name, graphe },
      automationsDuScenario: autoSource.filter((a) => a.workflowId === row.id),
      automationsDeLaDestination: autoDestination,
      champsSource: champsSource.map(definition),
      champsDestination: champsDestination.map(definition),
      nomsPrisDestination: noms.map((w) => w.name),
      dependances,
      nomsPris: pris,
    };
  }

  /** Les Flows de la source que le scénario ouvre, par leurs ids Meta, dans l'espace source seulement (lot 3). */
  async flowsSource(source: string, ids: readonly string[]): Promise<FlowSource[]> {
    return lireFlowsSource(this.pool, source, ids);
  }

  /**
   * Écrit le plan dans la destination, en une transaction. `scenario` : le scénario copié (son id et son nom). `flows` :
   * les Flows déjà recréés chez Meta (lot 3), de l'id de la source vers la copie, sur lesquels ses blocs Flow se rebranchent.
   */
  async ecrire(
    destination: string,
    sourceTenant: string,
    scenario: { id: string; nom: string },
    plan: PlanDuplication,
    flows: ReadonlyMap<string, { id: string; nom: string }> = new Map(),
  ): Promise<CopieEcrite> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const scenarioCopie = randomUUID();
      let nom = `${scenario.nom} (copie)`;
      for (let n = 2; (await nomPrisSousVerrou(c, destination, nom, null)) !== null; n += 1) nom = `${scenario.nom} (copie ${n})`;
      const champs = new PgUserFieldStore(c);
      const champsCrees: string[] = [];
      for (const def of plan.champsACreer) {
        if ((await champs.create(destination, def)) === 'created') champsCrees.push(def.key);
      }

      // Les dépendances cochées : sources, requêtes, modèles d'e-mail, puis les agents et leurs outils.
      const sources = new Map<string, string>();
      for (const s of plan.copies.sources) sources.set(s.id, await copierSource(c, sourceTenant, destination, s.id, s.label));
      const requetes = new Map<string, { id: string; nom: string }>();
      for (const r of plan.copies.requetes) {
        const copieSource = sources.get(r.sourceId);
        if (!copieSource) throw new Error('duplication : la source d’une requête n’a pas été copiée');
        requetes.set(r.id, { id: await copierRequete(c, sourceTenant, destination, r.id, r.label, copieSource), nom: r.label });
      }
      const modelesEmail = new Map<string, string>();
      for (const m of plan.copies.modelesEmail) modelesEmail.set(m.id, await copierModeleEmail(c, sourceTenant, destination, m.id, m.nom));
      const agents = new Map<string, { id: string; nom: string }>();
      // Un outil de l'espace consommé par deux agents cochés n'est copié qu'UNE fois, puis lié à chacun : deux copies
      // homonymes heurteraient l'index de l'espace (`agent_tools_nom_espace_uidx`) et annuleraient toute la copie.
      const outilsEspace = new Map<string, string>();
      for (const a of plan.copies.agents) {
        const copie = await copierAgent(c, sourceTenant, destination, a.id, a.label);
        agents.set(a.id, { id: copie, nom: a.label });
        for (const o of a.outils) {
          let outil = o.proprietaire ? undefined : outilsEspace.get(o.id);
          if (outil === undefined) {
            outil = await copierOutil(c, sourceTenant, destination, o.id, {
              nom: o.nom,
              agentProprietaire: o.proprietaire ? copie : null,
              requeteCopiee: o.requeteId === null ? null : (requetes.get(o.requeteId)?.id ?? null),
              sourceCopiee: o.sourceId === null ? null : (sources.get(o.sourceId) ?? null),
              binding: o.proprietaire ? rebrancherCible(o.binding, scenario.id, scenarioCopie, plan.graphe.codes) : o.binding,
            });
            if (!o.proprietaire) outilsEspace.set(o.id, outil);
          }
          await lierOutil(c, destination, outil, copie, o.nom);
        }
      }

      const rebranche = debrancherTemplates(
        rebrancher(plan.graphe, plan.references, { agents, requetes, modelesEmail, flows }),
        new Set(plan.templatesADebrancher),
      );
      const { id } = await insererBrouillon(c, destination, nom, rebranche.graphe, scenarioCopie);
      const automations = new PgAutomationStore(c);
      for (const d of plan.declencheurs.copies) await automations.create(destination, { ...d, workflowId: id });
      await c.query('commit');
      const secrets = new Set(plan.dependances.requetes.filter((r) => r.source.secret).map((r) => r.source.nomCopie));
      return {
        scenarioId: id, nom, champsCrees, declencheursCopies: plan.declencheurs.copies.length,
        dependancesCopiees: {
          agents: plan.copies.agents.map((a) => a.label),
          requetes: plan.copies.requetes.map((r) => r.label),
          modelesEmail: plan.copies.modelesEmail.map((m) => m.nom),
          sourcesAvecSecret: plan.copies.sources.map((s) => s.label).filter((l) => secrets.has(l)),
        },
        debranches: rebranche.debranches,
      };
    } catch (err) {
      await c.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }
}
