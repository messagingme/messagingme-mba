'use client';

import { request } from './http';
import { EVENEMENTS_SHOPIFY, type EvenementShopify } from './partage/shopify-messages';

/**
 * LE CONNECTEUR SHOPIFY : la carte de Tools > Intégrations (plan 2026-10-21, lot 1 ; conception 2026-10-22) et la section
 * Shopify de l'écran Automation (menu « Scénario », lot 5). La console lit l'état, branche une boutique (l'app créée à la
 * main sur le tableau de bord de Shopify), allume ses automations, la met en pause, importe ses clients abonnés et coupe.
 * Le message d'une automation se règle dans son scénario, plus par un assistant.
 *
 * ⚠️ Importé EN DIRECT (`@/lib/api-shopify`), jamais ajouté au barrel `lib/api.ts`, comme `api-salesforce`.
 */

const base = (tenantId: string): string => `/tenants/${tenantId}/integrations/shopify`;

/** Une automation Shopify : sa ligne, son scénario et son premier template chez Meta (`etatDesLignes` côté serveur). */
export interface LigneShopifyVue {
  evenement: EvenementShopify;
  actif: boolean;
  workflowId: string;
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

export interface EtatShopifyVue {
  boutique: {
    domaine: string;
    nom: string | null;
    etat: 'connectee' | 'coupee';
    dernierEvenementLe: string | null;
    delaiPanierMinutes: number | null;
    /** `console` : branchée par la carte ; `claude_code` : par la skill du plugin. */
    origine: 'console' | 'claude_code';
    /** La pause (décision 15) : rien ne part ; `null` = active. */
    pauseLe: string | null;
  } | null;
  compteurs: Record<string, number>;
  /**
   * Les paniers des 7 derniers jours, leur durée de vie (lot 2) ; et, sur la date de RELANCE, les relances parties et les
   * récupérés, leur montant par devise, les tests à part (plan 2026-10-30) : à comparer entre eux, pas aux premiers.
   */
  paniers: {
    relances: Record<string, number>; fermesATemps: number; enAttente: number;
    relancesParties: number; recuperes: number; montantsRecuperes: Array<{ devise: string; montant: string }>; recuperesTest: number;
  };
  pageApps: string | null;
  /** Les automations réglées, une par événement ; un événement sans ligne n'a jamais été allumé. */
  lignes: LigneShopifyVue[];
}

const texte = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Une ligne lue défensivement : sans événement connu, interrupteur ou scénario, elle est écartée. */
function lireLigne(x: unknown): LigneShopifyVue[] {
  const l = x as Record<string, unknown> | null;
  if (!l || typeof l !== 'object' || typeof l.actif !== 'boolean' || typeof l.workflowId !== 'string') return [];
  if (!(EVENEMENTS_SHOPIFY as readonly unknown[]).includes(l.evenement)) return [];
  return [{
    evenement: l.evenement as EvenementShopify, actif: l.actif, workflowId: l.workflowId, scenario: texte(l.scenario),
    modele: texte(l.modele), langue: texte(l.langue), etatChezMeta: texte(l.etatChezMeta),
    blocs: typeof l.blocs === 'number' ? l.blocs : 1, versionProgrammee: l.versionProgrammee === true,
  }];
}

/** Lu défensivement : une réponse d'une API plus ancienne ou plus récente que la console ne casse pas l'écran. */
export function lireEtatShopify(brut: unknown): EtatShopifyVue | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const o = brut as Record<string, unknown>;
  const b = o.boutique as Record<string, unknown> | null | undefined;
  const boutique = b && typeof b === 'object' && typeof b.domaine === 'string' && (b.etat === 'connectee' || b.etat === 'coupee')
    ? {
      domaine: b.domaine, nom: texte(b.nom), etat: b.etat === 'coupee' ? 'coupee' as const : 'connectee' as const,
      dernierEvenementLe: texte(b.dernierEvenementLe),
      delaiPanierMinutes: typeof b.delaiPanierMinutes === 'number' ? b.delaiPanierMinutes : null,
      origine: b.origine === 'console' ? 'console' as const : 'claude_code' as const,
      pauseLe: texte(b.pauseLe),
    }
    : null;
  const compteurs: Record<string, number> = {};
  if (o.compteurs && typeof o.compteurs === 'object') {
    for (const [k, v] of Object.entries(o.compteurs as Record<string, unknown>)) if (typeof v === 'number') compteurs[k] = v;
  }
  const p = (o.paniers ?? {}) as Record<string, unknown>;
  const relances: Record<string, number> = {};
  if (p.relances && typeof p.relances === 'object') {
    for (const [k, v] of Object.entries(p.relances as Record<string, unknown>)) if (typeof v === 'number') relances[k] = v;
  }
  const nombre = (v: unknown): number => (typeof v === 'number' ? v : 0);
  const montantsRecuperes = (Array.isArray(p.montantsRecuperes) ? p.montantsRecuperes : []).flatMap((m: unknown) => {
    const x = m as Record<string, unknown> | null;
    return x && typeof x.devise === 'string' && /^[A-Z]{3}$/.test(x.devise) && typeof x.montant === 'string' && /^\d+(\.\d+)?$/.test(x.montant)
      ? [{ devise: x.devise, montant: x.montant }]
      : [];
  });
  const paniers = {
    relances, fermesATemps: nombre(p.fermesATemps), enAttente: nombre(p.enAttente),
    relancesParties: nombre(p.relancesParties), recuperes: nombre(p.recuperes), montantsRecuperes, recuperesTest: nombre(p.recuperesTest),
  };
  const lignes = Array.isArray(o.lignes) ? o.lignes.flatMap(lireLigne) : [];
  return { boutique, compteurs, paniers, pageApps: texte(o.pageApps), lignes };
}

export async function lireShopify(tenantId: string): Promise<EtatShopifyVue | null> {
  return lireEtatShopify(await request<unknown>(base(tenantId)));
}

export function couperShopify(tenantId: string): Promise<{ dejaCoupee: boolean; pageApps: string | null }> {
  return request(base(tenantId), { method: 'DELETE' });
}

export function brancherShopify(tenantId: string, corps: { boutique: string; clientId: string; secret: string }): Promise<unknown> {
  return request(base(tenantId), { method: 'POST', body: JSON.stringify(corps) });
}

/** La pause de la boutique (décision 15) : ses parcours s'arrêtent, rien ne part ; la reprise ne rattrape rien. */
export function reglerPauseShopify(tenantId: string, pause: boolean): Promise<{ changee: boolean }> {
  return request(base(tenantId), { method: 'PATCH', body: JSON.stringify({ pause }) });
}

/**
 * L'interrupteur d'une automation : le premier allumage crée son scénario (un premier bloc verrouillé, sans template),
 * éteindre arrête ses parcours. Le délai du panier se règle avec sa ligne.
 */
export function reglerLigneShopify(
  tenantId: string, evenement: EvenementShopify, corps: { actif: boolean; delaiMinutes?: number },
): Promise<{ ligne: unknown }> {
  return request(`${base(tenantId)}/lignes/${encodeURIComponent(evenement)}`, { method: 'PUT', body: JSON.stringify(corps) });
}

export interface ApercuClientsShopify {
  abonnes: number;
  sansTelephone: number;
  dejaDansLEspace: number;
  nouveaux: number;
  placesLibres: number | null;
  importables: number;
  complet: boolean;
}

export function apercuClientsShopify(tenantId: string): Promise<ApercuClientsShopify> {
  return request(`${base(tenantId)}/clients/apercu`);
}

export function importerClientsShopify(
  tenantId: string, maximum: number,
): Promise<{ importes: number; retablis: number; restent: number; placesLibres: number | null; etiquette: string; complet: boolean }> {
  return request(`${base(tenantId)}/clients/import`, { method: 'POST', body: JSON.stringify({ maximum }) });
}
