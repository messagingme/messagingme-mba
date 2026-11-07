import type { AuditSink } from '../audit/journal';
import { AUTORISATION_REVOQUEE, type PlafondCles } from './api-key-store.pg';
import { API_SCOPES, DROIT_RELAIS } from '../../web/lib/partage/droits-api';
import { LimiteOffreError, STATUT_REFUS_OFFRE, corpsRefusLimite } from '../offres/refus';
import { refus, type Issue } from '../lib/issue';
import { tenter } from '../lib/tenter';

/**
 * LA CRÉATION D'UNE CLÉ D'API, UNE FOIS (spec offres v2) : la route de la console et l'outil MCP `create_api_key`
 * passent ici, donc par les mêmes contrôles, le même plafond de l'offre et la même trace.
 */
export interface DepsCreationCle {
  cles: {
    /**
     * `null` = plafond atteint, rien n'est créé. `autorisationId` rattache la clé à l'application qui la crée (`null`
     * pour la console) ; `AUTORISATION_REVOQUEE` = cette autorisation vient d'être révoquée, rien n'est créé.
     */
    creerSousPlafond(
      tenantId: string, name: string, scopes: string[], plafond: PlafondCles, autorisationId: string | null,
    ): Promise<{ id: string; key: string } | null | typeof AUTORISATION_REVOQUEE>;
  };
  /** Les clés actives que l'offre de l'espace permet (`Limites.clesApi`) ; `null` = sans limite. */
  limiteCles(tenantId: string): Promise<number | null>;
  audit: AuditSink;
}

/** Qui crée la clé, tel que le journal le garde. */
export interface AuteurCle {
  userId: string | null;
  email: string | null;
}

export interface CleCreee {
  id: string;
  /** En clair, rendue UNE fois : seul son hash est gardé. */
  key: string;
  name: string;
  scopes: string[];
}

/**
 * Par où la clé est créée, que la trace d'audit nomme : la console, ou une application connectée (`create_api_key`,
 * sous son autorisation OAuth). 🔴 L'autorisation voyage avec l'origine, jamais à côté : une clé créée par une application
 * lui reste rattachée et meurt quand un admin la révoque dans la console (lot D de l'audit).
 */
export type OrigineCle = { via: 'console' } | { via: 'mcp'; autorisationId: string };

export async function creerCleApi(
  deps: DepsCreationCle, tenantId: string, nom: string, scopes: readonly string[], auteur: AuteurCle, origine: OrigineCle,
): Promise<Issue<CleCreee>> {
  const name = nom.trim().slice(0, 100);
  if (name === '') return refus(400, 'name requis');
  const droits = [...new Set(scopes)];
  if (droits.length === 0) return refus(400, 'au moins un scope requis');
  // `mba:relais` n'est pas dans la liste : seule la publication chez Meta pose cette clé.
  const inconnus = droits.filter((s) => !(API_SCOPES as readonly string[]).includes(s));
  if (inconnus.length > 0) return refus(400, `scope(s) inconnu(s) : ${inconnus.join(', ')}`);
  const max = await deps.limiteCles(tenantId);
  const autorisationId = origine.via === 'mcp' ? origine.autorisationId : null;
  const creee = await deps.cles.creerSousPlafond(tenantId, name, droits, { max, horsDroit: DROIT_RELAIS }, autorisationId);
  if (creee === AUTORISATION_REVOQUEE) {
    return refus(403, 'cette connexion de l’application vient d’être révoquée par un administrateur : aucune clé n’a été créée');
  }
  if (creee === null) {
    // `max` ne peut être `null` ici : sans limite, le magasin crée toujours.
    const c = corpsRefusLimite(new LimiteOffreError(tenantId, 'clesApi', max ?? 0));
    return refus(STATUT_REFUS_OFFRE, c.error, { code: c.code, limite: c.limite, max: c.max, upgradeUrl: c.upgradeUrl });
  }
  // Best-effort, comme `makeJournal` : la clé existe, un journal en panne ne doit pas faire croire le contraire.
  // 🔴 Le détail porte les droits accordés, jamais la clé ni son empreinte (ce journal n'est pas purgé).
  const detail = origine.via === 'mcp' ? { scopes: droits, via: 'mcp', autorisation: origine.autorisationId } : { scopes: droits };
  await tenter('audit ignoré:', () => deps.audit(tenantId, auteur, 'cle_api.creee', { kind: 'api_key', id: creee.id }, detail));
  return { ok: true, valeur: { id: creee.id, key: creee.key, name, scopes: droits } };
}
