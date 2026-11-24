import { describe, it, expect } from 'vitest';
import { CODES_REFUS, RefusOutil, familleDuRefus, refusDuCoeur, refusDuPlafond, valeurOuRefus } from '../src/mcp/saisie';
import { refus, type StatutRefus } from '../src/lib/issue';
import { MESSAGE_OPERATIONS_LOURDES } from '../src/auth/plafond-partage';
import { refusFonction } from '../src/offres/refus';
import { rendreRefus } from '../src/mcp/serveur';

/**
 * LA CAUSE D'UN REFUS D'OUTIL (lot 1 du CSM virtuel, B0a, plan `docs/superpowers/plans/2026-11-24-csm-lot1-b0-contrats.md`).
 *
 * Le type force chaque `new RefusOutil` à dire sa famille ; ce fichier tient les traductions : un statut d'issue métier,
 * une cause fine de l'API publique, le plafond des opérations lourdes. Le rendu au client est dans `tests/mcp-serveur.test.ts`.
 */
describe('la famille d’un refus', () => {
  // L'exhaustivité sur `StatutRefus` tient au TYPE de la table (`Record<StatutRefus | 429, CodeRefus>`, saisie.ts) ; ce cas
  // fixe la famille de chacun, et qu'elle appartient à la liste fermée.
  it('🔴 chaque statut d’une issue métier a la famille attendue, dans la liste fermée', () => {
    const statuts: StatutRefus[] = [400, 402, 403, 404, 409, 413, 415, 422, 503];
    const familles = statuts.map((s) => familleDuRefus(s));
    expect(familles).toEqual(['invalid_args', 'plan_required', 'forbidden', 'not_found', 'conflict', 'too_large', 'unsupported', 'invalid_args', 'unavailable']);
    for (const f of familles) expect(CODES_REFUS).toContain(f);
  });

  it('la cause fine de l’API passe avant le statut ; un statut inconnu tombe sur invalid_args, une panne sur unavailable', () => {
    expect(familleDuRefus(402, 'plan_limit_reached')).toBe('plan_limit');
    expect(familleDuRefus(409, 'opted_out')).toBe('opted_out');
    expect(familleDuRefus(429, 'quota_exceeded')).toBe('quota_exceeded');
    expect(familleDuRefus(429)).toBe('rate_limited');
    expect(familleDuRefus(418)).toBe('invalid_args');
    expect(familleDuRefus(502)).toBe('unavailable');
  });

  it('🔴 une issue métier refusée garde sa phrase, et part avec sa famille, sa cause et l’adresse de l’offre', () => {
    const offre = refusFonction('analyse');
    const r = (() => { try { valeurOuRefus(offre); } catch (e) { return e; } return null; })();
    expect(r).toBeInstanceOf(RefusOutil);
    const e = r as RefusOutil;
    expect(e.code).toBe('plan_required');
    expect(e.precisions.cause).toBe('plan_feature_unavailable');
    expect(e.precisions.action).toMatch(/\/offre/);
    expect(() => valeurOuRefus(refus(404, 'agent inconnu'))).toThrow(expect.objectContaining({ code: 'not_found', message: 'agent inconnu' }));
  });

  it('un refus de l’API publique garde sa cause et son délai', () => {
    const e = refusDuCoeur({ statut: 429, code: 'rate_limited', message: 'Meta limite', reessayerDansS: 30 });
    expect([e.code, e.precisions]).toEqual(['rate_limited', { cause: 'rate_limited', reessayerDansS: 30 }]);
  });

  it('🔴 le plafond des opérations lourdes dit son délai en chiffres, et sa phrase reste celle de la console', () => {
    const e = refusDuPlafond(1500);
    expect([e.code, e.precisions.reessayerDansS]).toEqual(['rate_limited', 2]);
    expect(e.message).toBe(`${MESSAGE_OPERATIONS_LOURDES} (réessayer dans 2 s)`);
  });
});

describe('le rendu d’un refus au client (B0a)', () => {
  it('🔴 la phrase d’abord, puis la cause en JSON, avec le délai, le geste et la cause fine sous leurs noms', () => {
    const r = rendreRefus('patientez', 'rate_limited', { reessayerDansS: 3, action: 'https://x/offre', cause: 'rate_limited' });
    expect(r.content[0]!.text).toBe('patientez');
    expect(r.structuredContent).toEqual({ code: 'rate_limited', message: 'patientez', retry_after_s: 3, action: 'https://x/offre', cause: 'rate_limited' });
    expect(JSON.parse(r.content[1]!.text)).toEqual(r.structuredContent);
  });

  it('une cause héritée d’un objet (constructor, __proto__) n’est pas une famille', () => {
    expect(familleDuRefus(400, 'constructor')).toBe('invalid_args');
    expect(familleDuRefus(409, '__proto__')).toBe('conflict');
    expect(familleDuRefus(402, 'whatsapp_credit_exhausted')).toBe('credit_required');
    expect(familleDuRefus(422, 'paiement_impossible')).toBe('unavailable');
  });
});
