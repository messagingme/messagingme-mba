import { z } from 'zod';
import { coerceConfigAvantDate, minutesDuDelai } from '../automation/avant-date';
import type { Rayon } from '../workflow/rayon';
import type { ScenarioPublie } from '../workflow/store.pg';

/**
 * LES LIGNES HUBSPOT (menu « Scénario », lot 6b, spec § 2.2) : les automations du rayon `hubspot`, une par ligne de l'écran
 * Automation > HubSpot, chacune avec son scénario du même rayon et son interrupteur. Aucune table neuve : une ligne est une
 * ligne d'`automations` (le rendez-vous a besoin d'`automation_fires`, clé étrangère de 0052), que son déclencheur range
 * dans une famille.
 *
 * - `etape` : le changement d'étape d'un deal (`hubspot_deal_stage`), une ligne par paire pipeline et étape.
 * - `rdv` : avant ou après un rendez-vous (`avant_date`), sur une propriété date importée de HubSpot (`hs_*`).
 * - `workflow` : un scénario qu'une action de workflow HubSpot peut lancer (`hubspot_workflow`, une MARQUE hors de
 *   `kindsFor` : aucun événement ne la fait tirer, l'action la lit pour sa liste). Son scénario part comme aujourd'hui
 *   (`{ scenario }`) : il n'a pas de premier bloc verrouillé (décision 41).
 */

export const FAMILLES_HUBSPOT = ['etape', 'rdv', 'workflow'] as const;
export type FamilleLigneHubspot = (typeof FAMILLES_HUBSPOT)[number];

/** Le déclencheur de chaque famille, dans `automations.trigger_kind` (rayon `hubspot`). */
export const DECLENCHEUR_DE_LA_FAMILLE = {
  etape: 'hubspot_deal_stage',
  rdv: 'avant_date',
  workflow: 'hubspot_workflow',
} as const satisfies Record<FamilleLigneHubspot, string>;

export const DECLENCHEURS_HUBSPOT: readonly string[] = Object.values(DECLENCHEUR_DE_LA_FAMILLE);

/** La famille d'un déclencheur lu en base, ou `null` pour un déclencheur qui n'en est pas une. */
export function familleDuDeclencheur(kind: string): FamilleLigneHubspot | null {
  const trouvee = FAMILLES_HUBSPOT.find((f) => DECLENCHEUR_DE_LA_FAMILLE[f] === kind);
  return trouvee ?? null;
}

export interface ConfigEtape { pipelineId: string; stageId: string; stageLabel?: string }
export interface ConfigRdv { fieldKey: string; sens: 'avant' | 'apres'; delaiMinutes: number }
export type ConfigWorkflow = Record<string, never>;
export type ConfigLigneHubspot = ConfigEtape | ConfigRdv | ConfigWorkflow;

/** Trente jours : au-delà, ce n'est plus un rappel de rendez-vous (le déclencheur de date accepte jusqu'à 90). */
export const DELAI_RDV_MAX_MINUTES = 30 * 24 * 60;

/** Le préfixe des propriétés importées de HubSpot sur la fiche (lot 2 du 2026-11-02). */
export const PREFIXE_CHAMP_HUBSPOT = 'hs_';

/** Une ligne, telle que la base la porte. */
export interface LigneHubspot {
  id: string;
  famille: FamilleLigneHubspot;
  config: ConfigLigneHubspot;
  actif: boolean;
  workflowId: string;
  nom: string;
}

/** Une ligne, telle que la console la montre (le contrat du lot 6c). */
export interface LigneHubspotVue {
  id: string;
  famille: FamilleLigneHubspot;
  config: ConfigLigneHubspot;
  actif: boolean;
  workflowId: string;
  /** Le nom du scénario. */
  scenario: string | null;
  /** Le premier template du graphe PUBLIÉ (le bloc verrouillé, ou le modèle d'ouverture d'un scénario de workflow). */
  modele: string | null;
  langue: string | null;
  /** Son statut chez Meta (`APPROVED`, `PENDING`...) ; `null` sans template ou introuvable. */
  etatChezMeta: string | null;
  blocs: number;
  versionProgrammee: boolean;
}

// Les identifiants de HubSpot : des chiffres, ou des noms internes (`appointmentscheduled`). Jamais de deux-points : l'étape
// entre dans l'origine du parcours (`src/hubspot/origine.ts`).
const IDENTIFIANT = z.string().trim().regex(/^[A-Za-z0-9_.-]{1,100}$/);
const schemaEtape = z.object({ pipelineId: IDENTIFIANT, stageId: IDENTIFIANT, stageLabel: z.string().max(200).optional() }).strict();
const schemaRdv = z.object({
  fieldKey: z.string().trim().min(1).max(100),
  sens: z.enum(['avant', 'apres']),
  delaiMinutes: z.number().int().min(1).max(DELAI_RDV_MAX_MINUTES),
}).strict();
const schemaWorkflow = z.object({}).strict();

/** Ce que dit un refus, au client, tel que la console l'affiche. */
export const MESSAGES = {
  famille: 'Choisissez le type de ligne : changement d’étape, rendez-vous ou lancé par un workflow.',
  etape: 'Choisissez le pipeline et l’étape du deal dans la liste de HubSpot.',
  rdvChamp: 'Choisissez une propriété date importée de HubSpot : son nom commence par hs_.',
  rdvSens: 'Choisissez si le message part avant ou après le rendez-vous.',
  rdvDelai: `Réglez le délai en minutes, de 1 minute à 30 jours (${DELAI_RDV_MAX_MINUTES} minutes).`,
  workflow: 'Une ligne lancée par un workflow ne se règle pas : laissez sa configuration vide.',
  nom: 'Le nom du scénario tient en 120 caractères au plus.',
} as const;

/** La configuration reçue d'une famille, ou la phrase qui dit quoi corriger. */
export function lireConfig(famille: FamilleLigneHubspot, brut: unknown): { ok: true; config: ConfigLigneHubspot } | { ok: false; message: string } {
  if (famille === 'etape') {
    const lu = schemaEtape.safeParse(brut);
    if (!lu.success) return { ok: false, message: MESSAGES.etape };
    return { ok: true, config: { pipelineId: lu.data.pipelineId, stageId: lu.data.stageId, ...(lu.data.stageLabel !== undefined ? { stageLabel: lu.data.stageLabel } : {}) } };
  }
  if (famille === 'rdv') {
    const lu = schemaRdv.safeParse(brut);
    if (!lu.success) {
      const champ = lu.error.issues[0]?.path[0];
      return { ok: false, message: champ === 'sens' ? MESSAGES.rdvSens : champ === 'delaiMinutes' ? MESSAGES.rdvDelai : MESSAGES.rdvChamp };
    }
    if (!lu.data.fieldKey.startsWith(PREFIXE_CHAMP_HUBSPOT)) return { ok: false, message: MESSAGES.rdvChamp };
    return { ok: true, config: lu.data };
  }
  return schemaWorkflow.safeParse(brut ?? {}).success ? { ok: true, config: {} } : { ok: false, message: MESSAGES.workflow };
}

/** Ce que `automations.trigger_config` porte pour cette configuration : le rendez-vous dans la forme du déclencheur de date. */
export function configEnBase(famille: FamilleLigneHubspot, config: ConfigLigneHubspot): Record<string, unknown> {
  if (famille === 'rdv') {
    const r = config as ConfigRdv;
    return { fieldKey: r.fieldKey, delai: r.delaiMinutes, unite: 'minutes', sens: r.sens };
  }
  return { ...config };
}

/** La configuration d'une ligne relue en base, ou `null` quand elle ne se relit pas (la ligne est alors ignorée). */
export function configDeLaBase(famille: FamilleLigneHubspot, brut: Record<string, unknown>): ConfigLigneHubspot | null {
  if (famille === 'etape') {
    const pipelineId = typeof brut.pipelineId === 'string' ? brut.pipelineId : '';
    const stageId = typeof brut.stageId === 'string' ? brut.stageId : '';
    if (pipelineId === '' || stageId === '') return null;
    return { pipelineId, stageId, ...(typeof brut.stageLabel === 'string' ? { stageLabel: brut.stageLabel } : {}) };
  }
  if (famille === 'rdv') {
    const c = coerceConfigAvantDate(brut);
    return c === null ? null : { fieldKey: c.fieldKey, sens: c.sens, delaiMinutes: minutesDuDelai(c.delai, c.unite) };
  }
  return {};
}

/** Le nom du scénario d'une ligne neuve quand la console n'en donne pas. */
export function nomParDefaut(famille: FamilleLigneHubspot, config: ConfigLigneHubspot): string {
  if (famille === 'etape') {
    const e = config as ConfigEtape;
    return `Étape ${e.stageLabel?.trim() || e.stageId}`.slice(0, 120);
  }
  if (famille === 'rdv') return `Rendez-vous ${(config as ConfigRdv).fieldKey}`.slice(0, 120);
  return 'Lancé par un workflow HubSpot';
}

/**
 * LES SCÉNARIOS QU'UN WORKFLOW HUBSPOT LANCE (lot 6b, décision 41) : ceux en ligne du rayon `hubspot` que vise une ligne
 * « lancés par un workflow » allumée. La liste de l'action ET son lancement les lisent là : un scénario du Builder, ou d'une
 * ligne d'étape, n'y entre jamais. Les magasins passés ENTIERS (leurs méthodes lisent `this`).
 */
export async function scenariosLancesParWorkflow(
  workflows: { listPublies(tenantId: string, rayon: Rayon): Promise<ScenarioPublie[]> },
  lignes: { codesLancesParWorkflow(tenantId: string): Promise<ReadonlySet<string>> },
  tenantId: string,
): Promise<ScenarioPublie[]> {
  const [publies, codes] = await Promise.all([workflows.listPublies(tenantId, 'hubspot'), lignes.codesLancesParWorkflow(tenantId)]);
  return publies.filter((s) => s.code !== null && codes.has(s.code));
}
