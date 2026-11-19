import type { LigneHubspotVue } from './api-hubspot-lignes';
import type { HubspotDealPipeline } from './api/compte';
import type { UserFieldDef } from './api/integrations';
import { delaiEnClair, etatDUneLigne, type EtatAutomation } from './shopify-lignes';

/**
 * LES AUTOMATIONS HUBSPOT DE LA CONSOLE, LEUR PARTIE SANS ÉCRAN (menu « Scénario », lot 6c) : l'état d'une ligne, son
 * libellé selon sa famille, les étapes et les champs que « Ajouter » propose. Le message lui-même se règle dans son
 * scénario (le premier bloc, verrouillé), jamais ici.
 */

/** Une ligne HubSpot existe toujours : « Ajouter » la crée, éteinte, avec son scénario. */
export type EtatLigneHubspot = Exclude<EtatAutomation, 'a_creer'>;

/**
 * L'état d'une ligne : celui d'une automation Shopify (`etatDUneLigne`, les statuts de Meta lus une seule fois), sauf sans
 * premier template publié. 🔴 L'API refuse alors de l'allumer (409, `a_completer`) : la ligne le dit, éteinte comme
 * allumée, plutôt qu'un « éteinte » qui laisserait croire que l'interrupteur suffit. Un premier message écrit et en
 * attente de Meta (une version programmée) se dit en validation.
 */
export function etatDeLaLigne(l: LigneHubspotVue): EtatLigneHubspot {
  if (l.modele === null) return l.versionProgrammee ? 'en_validation' : 'a_completer';
  return etatDUneLigne(l);
}

/** Les unités du délai d'un rendez-vous, en minutes. */
export const MINUTES_PAR_UNITE = { minutes: 1, heures: 60, jours: 24 * 60 } as const;
export type UniteDelai = keyof typeof MINUTES_PAR_UNITE;

/** Le délai d'un rendez-vous en clair : en jours quand il en fait un nombre rond (« 2 jours »), sinon « 3 h », « 45 min ». */
export function delaiRendezVous(minutes: number, t: (fr: string, en: string) => string): string {
  const jours = minutes / MINUTES_PAR_UNITE.jours;
  if (Number.isInteger(jours) && jours > 0) return jours === 1 ? t('1 jour', '1 day') : t(`${jours} jours`, `${jours} days`);
  return delaiEnClair(minutes);
}

/**
 * Le libellé d'une ligne, selon sa famille :
 * - une étape : « Pipeline › Étape », les libellés lus chez HubSpot (un renommage y est suivi), sinon celui gardé à la
 *   création, sinon « étape configurée » plutôt qu'un identifiant opaque ;
 * - un rendez-vous : « 3 h avant « Date du RDV » », le champ par son libellé (sa clé s'il n'est plus déclaré) ;
 * - un workflow : le nom du scénario, celui que l'action des workflows HubSpot propose.
 * `pipelines` et `champs` à `null` : pas (encore) lus, le libellé fait sans eux.
 */
export function libelleDeLaLigne(
  l: LigneHubspotVue,
  lus: { pipelines: readonly HubspotDealPipeline[] | null; champs: readonly UserFieldDef[] | null },
  t: (fr: string, en: string) => string,
): string {
  if (l.famille === 'etape') {
    const pipeline = lus.pipelines?.find((p) => p.id === l.config.pipelineId);
    const etape = pipeline?.stages.find((s) => s.id === l.config.stageId)?.label ?? l.config.stageLabel;
    if (etape === null || etape.trim() === '') return t('étape configurée', 'configured stage');
    return pipeline ? `${pipeline.label} › ${etape}` : etape;
  }
  if (l.famille === 'rdv') {
    const champ = lus.champs?.find((f) => f.key === l.config.fieldKey)?.label ?? l.config.fieldKey;
    const delai = l.config.delaiMinutes === null ? '' : `${delaiRendezVous(l.config.delaiMinutes, t)} `;
    return l.config.sens === 'apres'
      ? t(`${delai}après « ${champ} »`, `${delai}after “${champ}”`)
      : t(`${delai}avant « ${champ} »`, `${delai}before “${champ}”`);
  }
  return l.scenario ?? t('scénario sans nom', 'unnamed scenario');
}

/**
 * Les champs qu'un rendez-vous peut suivre : importés de HubSpot (clé `hs_`) et de type « date et heure », le seul qui
 * porte une échéance (le déclencheur de date d'aujourd'hui refuse les autres).
 */
export function champsRendezVous(champs: readonly UserFieldDef[]): UserFieldDef[] {
  return champs.filter((f) => f.key.startsWith('hs_') && f.type === 'datetime');
}

/** Une étape proposée par « Ajouter » : sa clé de choix, son pipeline, et si une ligne la règle déjà. */
export interface EtapeAuChoix {
  cle: string;
  pipelineId: string;
  pipeline: string;
  stageId: string;
  label: string;
  /** Étape de fin (gagné, perdu). */
  fin: boolean;
  /** Une ligne règle déjà cette étape : l'API refuserait la seconde (409). */
  dejaReglee: boolean;
}

/** Les étapes du portail, groupées par pipeline dans leur ordre, chacune marquée si une ligne la règle déjà. */
export function etapesAuChoix(pipelines: readonly HubspotDealPipeline[], lignes: readonly LigneHubspotVue[]): EtapeAuChoix[] {
  const reglees = new Set(lignes.flatMap((l) => (l.famille === 'etape' ? [`${l.config.pipelineId}::${l.config.stageId}`] : [])));
  return pipelines.flatMap((p) => p.stages.map((s) => {
    const cle = `${p.id}::${s.id}`;
    return { cle, pipelineId: p.id, pipeline: p.label, stageId: s.id, label: s.label, fin: s.closed, dejaReglee: reglees.has(cle) };
  }));
}
