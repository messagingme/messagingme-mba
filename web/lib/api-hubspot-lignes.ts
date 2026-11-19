'use client';

import { request } from './http';

/**
 * LES AUTOMATIONS HUBSPOT (menu « Scénario », lot 6c) : la section HubSpot de l'écran Automation lit les lignes, en crée,
 * les allume, les éteint et les supprime. Trois familles, chacune une automation du rayon `hubspot` et son scénario, dont
 * le premier bloc (un template verrouillé) est le message envoyé : le changement d'étape d'un deal, le rendez-vous (une
 * date importée de HubSpot et un délai), le scénario lancé par un workflow HubSpot. Le contrat est celui du plan
 * (`docs/superpowers/plans/2026-11-19-menu-scenario-lot-6-hubspot.md`, 6b, tâche 4).
 *
 * ⚠️ Importé EN DIRECT (`@/lib/api-hubspot-lignes`), jamais ajouté au barrel `lib/api.ts`, comme `api-shopify`.
 */

const base = (tenantId: string): string => `/tenants/${tenantId}/hubspot/lignes`;

export const FAMILLES_HUBSPOT = ['etape', 'rdv', 'workflow'] as const;
export type FamilleHubspot = (typeof FAMILLES_HUBSPOT)[number];

/** Le côté d'une date où part le message d'un rendez-vous. */
export type SensRendezVous = 'avant' | 'apres';

/**
 * Une automation HubSpot, telle que la console la lit. La configuration est lue SANS exigence : elle ne sert qu'au
 * libellé, et une ligne qu'on ne pourrait plus éteindre ni supprimer parce que sa configuration a changé de forme serait
 * pire qu'un libellé incomplet.
 */
interface LigneCommune {
  /** L'automation (rayon `hubspot`) : c'est elle que l'on allume, éteint ou supprime. */
  id: string;
  actif: boolean;
  workflowId: string;
  /** Le nom du scénario. */
  scenario: string | null;
  /** Le premier template, publié ; `null` tant qu'il n'est pas choisi dans le scénario. */
  modele: string | null;
  langue: string | null;
  /** Son statut chez Meta (`APPROVED`, `PENDING`, `REJECTED`...) ; `null` sans template, ou la liste de Meta illisible. */
  etatChezMeta: string | null;
  /** Le nombre de blocs du scénario publié. */
  blocs: number;
  /** Une nouvelle version du scénario attend Meta pour sa mise en ligne. */
  versionProgrammee: boolean;
}

export type LigneHubspotVue = LigneCommune & (
  | { famille: 'etape'; config: { pipelineId: string; stageId: string; stageLabel: string | null } }
  | { famille: 'rdv'; config: { fieldKey: string; sens: SensRendezVous; delaiMinutes: number | null } }
  | { famille: 'workflow'; config: Record<string, never> }
);

export interface EtatLignesHubspot {
  /** Un portail HubSpot est relié : sans lui, la section ne se montre pas. */
  connecte: boolean;
  lignes: LigneHubspotVue[];
}

/** Ce que « Ajouter » envoie : la famille et son réglage. */
export type CreationLigneHubspot =
  | { famille: 'etape'; config: { pipelineId: string; stageId: string; stageLabel?: string } }
  | { famille: 'rdv'; config: { fieldKey: string; sens: SensRendezVous; delaiMinutes: number } }
  | { famille: 'workflow'; config: Record<string, never> };

const texte = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Une ligne lue défensivement : sans identifiant, famille connue, interrupteur ou scénario, elle est écartée. */
function lireLigne(x: unknown): LigneHubspotVue[] {
  if (x === null || typeof x !== 'object') return [];
  const l = x as Record<string, unknown>;
  const famille = FAMILLES_HUBSPOT.find((f) => f === l.famille);
  if (famille === undefined || typeof l.id !== 'string' || typeof l.actif !== 'boolean' || typeof l.workflowId !== 'string') return [];
  const commun: LigneCommune = {
    id: l.id, actif: l.actif, workflowId: l.workflowId, scenario: texte(l.scenario),
    modele: texte(l.modele), langue: texte(l.langue), etatChezMeta: texte(l.etatChezMeta),
    blocs: typeof l.blocs === 'number' ? l.blocs : 1, versionProgrammee: l.versionProgrammee === true,
  };
  // La configuration, lue sans rien exiger (cf. `LigneHubspotVue`).
  const c = (l.config !== null && typeof l.config === 'object' ? l.config : {}) as Record<string, unknown>;
  if (famille === 'etape') {
    return [{ ...commun, famille, config: { pipelineId: texte(c.pipelineId) ?? '', stageId: texte(c.stageId) ?? '', stageLabel: texte(c.stageLabel) } }];
  }
  if (famille === 'rdv') {
    const d = c.delaiMinutes;
    return [{
      ...commun, famille,
      config: {
        fieldKey: texte(c.fieldKey) ?? '',
        // Comme le déclencheur de date d'aujourd'hui : un sens absent ou aberrant se lit « avant ».
        sens: c.sens === 'apres' ? 'apres' : 'avant',
        delaiMinutes: typeof d === 'number' && Number.isInteger(d) && d > 0 ? d : null,
      },
    }];
  }
  return [{ ...commun, famille, config: {} }];
}

/**
 * Lu défensivement : une réponse sans `connecte` (une API d'avant la route, que le repli d'un mock ou d'un proxy rendrait
 * en 200) ne montre rien, comme une route inconnue.
 */
export function lireEtatLignesHubspot(brut: unknown): EtatLignesHubspot | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const o = brut as Record<string, unknown>;
  if (typeof o.connecte !== 'boolean') return null;
  return { connecte: o.connecte, lignes: Array.isArray(o.lignes) ? o.lignes.flatMap(lireLigne) : [] };
}

export async function lireLignesHubspot(tenantId: string): Promise<EtatLignesHubspot | null> {
  return lireEtatLignesHubspot(await request<unknown>(base(tenantId)));
}

/** Crée l'automation ET son scénario (un premier bloc template verrouillé, vide), ligne éteinte : `201 { ligne }`. */
export function creerLigneHubspot(tenantId: string, corps: CreationLigneHubspot): Promise<unknown> {
  return request(base(tenantId), { method: 'POST', body: JSON.stringify(corps) });
}

/** Le scénario de la ligne qu'un `POST` vient de créer, que la console ouvre aussitôt ; `null` si la réponse ne le dit pas. */
export function scenarioDeLaLigneCreee(reponse: unknown): string | null {
  const ligne = reponse !== null && typeof reponse === 'object' && 'ligne' in reponse ? reponse.ligne : null;
  return ligne !== null && typeof ligne === 'object' && 'workflowId' in ligne && typeof ligne.workflowId === 'string' ? ligne.workflowId : null;
}

/** L'interrupteur d'une ligne. Allumer sans premier template publié est refusé (409, `a_completer`). */
export function reglerLigneHubspot(tenantId: string, id: string, corps: { actif: boolean }): Promise<{ ligne: unknown }> {
  return request(`${base(tenantId)}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(corps) });
}

/** Supprime la ligne : ses parcours s'arrêtent, son scénario reste en base, hors de toute liste. */
export function supprimerLigneHubspot(tenantId: string, id: string): Promise<unknown> {
  return request(`${base(tenantId)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
