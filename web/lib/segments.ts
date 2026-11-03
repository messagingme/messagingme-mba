import { request } from './http';
import { BORNES_SEGMENTS, type PlageSurJours, type SuiviSegmentsVue } from './partage/segments';

/**
 * Ce que l'API sait cibler en segments (`GET /tenants/:id/contacts/segments`, spec du 2026-10-31). 🔴 `null` quand la
 * route ne répond pas, ou répond quelque chose d'illisible : le panneau ne propose alors AUCUN critère de segment. Une
 * API plus ancienne les jetterait sans rien dire, et « au moins deux commandes » rendrait tout l'espace.
 */
export function suiviSegmentsDe(v: unknown): SuiviSegmentsVue | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.activiteCompleteDepuis !== 'string') return null;
  if (o.boutique === null) return { boutique: null, activiteCompleteDepuis: o.activiteCompleteDepuis };
  const b = o.boutique as Record<string, unknown> | undefined;
  if (!b || typeof b !== 'object' || typeof b.commandesDepuis !== 'string') return null;
  return {
    boutique: {
      devise: typeof b.devise === 'string' ? b.devise : null,
      commandesDepuis: b.commandesDepuis,
      coupeeLe: typeof b.coupeeLe === 'string' ? b.coupeeLe : null,
    },
    activiteCompleteDepuis: o.activiteCompleteDepuis,
  };
}

const enCours = new Map<string, Promise<SuiviSegmentsVue | null>>();

/** Une lecture par espace et par chargement de la console ; une panne se relit à la prochaine demande. */
export function chargerSegments(tenantId: string): Promise<SuiviSegmentsVue | null> {
  const deja = enCours.get(tenantId);
  if (deja) return deja;
  const p = request<unknown>(`/tenants/${tenantId}/contacts/segments`)
    .then(suiviSegmentsDe)
    .catch(() => { enCours.delete(tenantId); return null; });
  enCours.set(tenantId, p);
  return p;
}

/** Ce que l'écran a saisi pour une plage : des textes, vides tant que rien n'est tapé. */
export interface SaisiePlage { min: string; max: string; jours: string }

export type LecturePlage = { plage: PlageSurJours | undefined } | { erreur: 'nombre' | 'ordre' | 'zero' };

/**
 * Une saisie de plage, lue comme le serveur la lira. Rien de posé (ou « au moins 0 » sans maximum, qui ne restreint
 * rien) : pas de critère. 🔴 Une saisie invalide n'envoie RIEN au serveur (il la refuserait en 400) : l'écran dit
 * pourquoi, et la liste reste celle des autres critères.
 */
export function lirePlageSaisie(s: SaisiePlage, o: { max: number; entier: boolean; avecJours: boolean; restreint: boolean }): LecturePlage {
  const nombre = (t: string, max: number, entier: boolean): number | undefined | null => {
    if (t.trim() === '') return undefined;
    const n = Number(t.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 && n <= max && (!entier || Number.isInteger(n)) ? n : null;
  };
  const min = nombre(s.min, o.max, o.entier);
  const max = nombre(s.max, o.max, o.entier);
  const jours = o.avecJours ? nombre(s.jours, BORNES_SEGMENTS.joursMax, true) : undefined;
  if (min === null || max === null || jours === null || jours === 0) return { erreur: 'nombre' };
  if (min === undefined && max === undefined) return { plage: undefined };
  if (min !== undefined && max !== undefined && min > max) return { erreur: 'ordre' };
  if (o.restreint && (min ?? 0) === 0 && max === undefined) return { erreur: 'zero' };
  return { plage: { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(jours !== undefined ? { jours } : {}) } };
}

/** La saisie qui affiche une plage déjà posée (reprise d'un brouillon, retour sur l'écran). */
export function saisieDePlage(p: PlageSurJours | undefined): SaisiePlage {
  const t = (n: number | undefined): string => (n === undefined ? '' : String(n));
  return { min: t(p?.min), max: t(p?.max), jours: t(p?.jours) };
}
