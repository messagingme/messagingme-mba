'use client';

import { request } from './http';
import { estAutomationShopify, type AutomationShopify } from './partage/shopify-messages';
import type { ApercuRepriseVue, RepriseShopifyVue } from './partage/reprise-shopify';
import type { SegmentsShopifyLusVue, SynchroEtiquettesVue } from './partage/segments';
import { etiquettesShopifyLuesDe, segmentsShopifyLusDe, synchroEtiquettesDe } from './segments';

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
  /** Un événement, ou la relance de panier avec agent IA (2026-11-20). */
  evenement: AutomationShopify;
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
  /** Le message en vigueur, pour la bulle au survol ; `null` sans message (ou une API qui ne le dit pas encore). */
  apercu: ApercuLigneShopify | null;
  /** La relance avec agent IA : l'agent de son bloc ; `null` sans bloc Agent IA, ou une API qui ne le dit pas. */
  agent: { id: string; label: string; actif: boolean } | null;
  /** La relance avec agent IA : ce qui l'empêche de servir comme prévu (seuls les codes connus). */
  avertissements: AvertissementLigneShopify[];
}

export const AVERTISSEMENTS_LIGNE = ['bouton_absent', 'agent_inactif', 'modele_en_attente', 'modele_refuse'] as const;
export type AvertissementLigneShopify = (typeof AVERTISSEMENTS_LIGNE)[number];

/**
 * Le texte du premier template : celui de la version programmée s'il y en a une, sinon du publié. `corps` porte ses
 * variables numérotées (`{{1}}`...), `exemples[0]` remplace `{{1}}` ; `enValidation` : le template attend Meta.
 */
export interface ApercuLigneShopify {
  corps: string;
  pied: string | null;
  exemples: string[];
  enValidation: boolean;
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
  /**
   * L'attestation du consentement des clients (2026-11-20) : `null`, jamais attestée ; `coche: false`, retirée.
   * `inconnue` : une API qui ne la rend pas encore (ou mal formée) ; l'écran ne montre alors pas la case.
   */
  attestation: AttestationShopify | null | 'inconnue';
}

/** La dernière attestation : cochée ou retirée, quand, par qui (`email` `null` quand le serveur ne le connaît pas), et son texte. */
export interface AttestationShopify {
  coche: boolean;
  le: string;
  email: string | null;
  texte: string;
}

const texte = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** L'aperçu lu défensivement : la console est publiée avant l'API, un champ absent ou mal formé ne montre rien. */
function lireApercu(x: unknown): ApercuLigneShopify | null {
  const a = x as Record<string, unknown> | null | undefined;
  if (!a || typeof a !== 'object' || typeof a.corps !== 'string' || a.corps.trim() === '') return null;
  return {
    corps: a.corps, pied: texte(a.pied),
    exemples: Array.isArray(a.exemples) && a.exemples.every((e) => typeof e === 'string') ? a.exemples as string[] : [],
    enValidation: a.enValidation === true,
  };
}

/** Une ligne lue défensivement : sans événement connu, interrupteur ou scénario, elle est écartée. */
function lireLigne(x: unknown): LigneShopifyVue[] {
  const l = x as Record<string, unknown> | null;
  if (!l || typeof l !== 'object' || typeof l.actif !== 'boolean' || typeof l.workflowId !== 'string') return [];
  if (!estAutomationShopify(l.evenement)) return [];
  const ag = l.agent as Record<string, unknown> | null | undefined;
  return [{
    evenement: l.evenement, actif: l.actif, workflowId: l.workflowId, scenario: texte(l.scenario),
    modele: texte(l.modele), langue: texte(l.langue), etatChezMeta: texte(l.etatChezMeta),
    blocs: typeof l.blocs === 'number' ? l.blocs : 1, versionProgrammee: l.versionProgrammee === true, apercu: lireApercu(l.apercu),
    agent: ag && typeof ag === 'object' && typeof ag.id === 'string' && typeof ag.label === 'string'
      ? { id: ag.id, label: ag.label, actif: ag.actif === true } : null,
    avertissements: Array.isArray(l.avertissements)
      ? l.avertissements.filter((a): a is AvertissementLigneShopify => (AVERTISSEMENTS_LIGNE as readonly unknown[]).includes(a)) : [],
  }];
}

/** L'attestation lue défensivement : `null` explicite = jamais attestée ; absente ou mal formée = inconnue. */
function lireAttestation(x: unknown): AttestationShopify | null | 'inconnue' {
  if (x === null) return null;
  const a = x as Record<string, unknown> | undefined;
  if (!a || typeof a !== 'object' || typeof a.coche !== 'boolean' || typeof a.le !== 'string' || typeof a.texte !== 'string') return 'inconnue';
  // L'e-mail seul est indulgent : absent (une clé `undefined` disparaît du JSON), il se lit comme inconnu du serveur.
  if (a.email !== undefined && a.email !== null && typeof a.email !== 'string') return 'inconnue';
  return { coche: a.coche, le: a.le, email: typeof a.email === 'string' ? a.email : null, texte: a.texte };
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
  return { boutique, compteurs, paniers, pageApps: texte(o.pageApps), lignes, attestation: lireAttestation(o.attestation) };
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
  tenantId: string, evenement: AutomationShopify, corps: { actif: boolean; delaiMinutes?: number; agentId?: string },
): Promise<{ ligne: unknown }> {
  return request(`${base(tenantId)}/lignes/${encodeURIComponent(evenement)}`, { method: 'PUT', body: JSON.stringify(corps) });
}

/**
 * Cocher ou retirer l'attestation du consentement des clients. Le serveur historise le texte de la langue reçue, jamais
 * un texte venu de la console ; retirer éteint les automations allumées. 409 sans boutique branchée.
 */
export async function attesterShopify(tenantId: string, coche: boolean, langue: 'fr' | 'en'): Promise<AttestationShopify | null> {
  const r = await request<{ attestation?: unknown }>(`${base(tenantId)}/attestation`, { method: 'POST', body: JSON.stringify({ coche, langue }) });
  const a = lireAttestation(r?.attestation);
  return a === 'inconnue' ? null : a;
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

/**
 * LE RATTRAPAGE DES COMMANDES DES 60 DERNIERS JOURS (segments Shopify enrichis, lot 5) : l'aperçu lit chez Shopify sans
 * rien écrire, le lancement inscrit la reprise (le worker la fait), l'état se relit. Une API plus ancienne rend 404 : la
 * carte n'en montre alors rien (`routeInconnue`).
 */
export function apercuRattrapageShopify(tenantId: string): Promise<ApercuRepriseVue> {
  return request(`${base(tenantId)}/commandes/apercu`);
}

export async function lancerRattrapageShopify(tenantId: string): Promise<RepriseShopifyVue> {
  return (await request<{ reprise: RepriseShopifyVue }>(`${base(tenantId)}/commandes/rattrapage`, { method: 'POST', body: '{}' })).reprise;
}

export async function lireRattrapageShopify(tenantId: string): Promise<RepriseShopifyVue | null> {
  return (await request<{ reprise: RepriseShopifyVue | null }>(`${base(tenantId)}/commandes/rattrapage`)).reprise ?? null;
}

/**
 * LES ÉTIQUETTES DES CLIENTS SHOPIFY (segments Shopify enrichis, lot 6b) : le réglage « Synchroniser les étiquettes »
 * (allumer lance aussitôt une synchronisation) et le bouton « maintenant ». L'état se relit par
 * `chercherEtiquettesShopify` (`@/lib/segments`). Une réponse illisible rend une vue `null` : la carte relit l'état.
 * `lancee` dit si CE geste a lancé une lecture : faux quand une synchronisation tournait déjà, la carte ne dit alors pas
 * « lancée ».
 */
export interface GesteEtiquettesShopify { vue: SynchroEtiquettesVue | null; lancee: boolean }

export function gesteEtiquettesDe(v: unknown): GesteEtiquettesShopify {
  const synchro = v && typeof v === 'object' && !Array.isArray(v) ? (v as { synchro?: unknown }).synchro : undefined;
  const lancee = synchro !== null && typeof synchro === 'object' && (synchro as { lancee?: unknown }).lancee === true;
  return { vue: synchroEtiquettesDe(synchro), lancee };
}

export async function reglerEtiquettesShopify(tenantId: string, allumee: boolean): Promise<GesteEtiquettesShopify> {
  return gesteEtiquettesDe(await request<unknown>(`${base(tenantId)}/etiquettes`, { method: 'PUT', body: JSON.stringify({ allumee }) }));
}

export async function synchroniserEtiquettesShopify(tenantId: string): Promise<GesteEtiquettesShopify> {
  return gesteEtiquettesDe(await request<unknown>(`${base(tenantId)}/etiquettes/synchro`, { method: 'POST', body: '{}' }));
}

/**
 * L'état de la synchronisation, pour la carte : la MÊME route que le volet des filtres, dont l'erreur remonte (une API plus
 * ancienne rend 404, que la carte reconnaît par `routeInconnue` pour ne rien montrer).
 */
export async function lireSynchroEtiquettesShopify(tenantId: string): Promise<SynchroEtiquettesVue | null> {
  return etiquettesShopifyLuesDe(await request<unknown>(`/tenants/${tenantId}/contacts/segments/etiquettes-shopify`))?.synchro ?? null;
}

/**
 * LES SEGMENTS SHOPIFY SUIVIS (lot 6c), pour la carte : la liste lue (son erreur remonte, une API plus ancienne rend 404) et
 * le choix, exactement ces segments, qui lance une synchronisation pour les lire.
 */
export async function lireSegmentsShopifyCarte(tenantId: string): Promise<SegmentsShopifyLusVue | null> {
  return segmentsShopifyLusDe(await request<unknown>(`/tenants/${tenantId}/contacts/segments/segments-shopify`));
}

export async function suivreSegmentsShopify(tenantId: string, segments: readonly string[]): Promise<GesteEtiquettesShopify> {
  return gesteEtiquettesDe(await request<unknown>(`${base(tenantId)}/segments`, { method: 'PUT', body: JSON.stringify({ segments }) }));
}
