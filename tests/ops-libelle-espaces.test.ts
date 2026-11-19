import { describe, it, expect, vi, afterEach } from 'vitest';
import { creerLibelleurEspaces } from '../src/ops/libelle-espaces';
import { deriveTenantCode } from '../src/ids/code';

/**
 * Le libelleur des alertes (spec 2026-11-19, code d'espace visible) : un UUID d'espace cité dans une alerte reçoit
 * « Nom » (code). Il ne doit jamais perdre ni retarder une alerte au-delà de son plafond.
 */

const A = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const B = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a';
const INCONNU = '11111111-2222-4333-8444-555555555555';

interface Ligne { id: string; name: string; public_code: string | null }

function fauxPool(lignes: Ligne[]) {
  const appels: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    appels.push({ sql, params });
    const ids = (params[0] as string[]).map((s) => s.toLowerCase());
    return { rows: lignes.filter((l) => ids.includes(l.id)), rowCount: 0 };
  });
  return { pool: { query } as never, appels, query };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('creerLibelleurEspaces', () => {
  it('ajoute « Nom » (code) après un UUID d\'espace, et garde l\'UUID', async () => {
    const { pool } = fauxPool([{ id: A, name: 'Acme', public_code: 'k7m2p3' }]);
    const libeller = creerLibelleurEspaces(pool);
    expect(await libeller(`Numéro déconnecté (espace ${A})`)).toBe(`Numéro déconnecté (espace ${A} « Acme » (k7m2p3))`);
  });

  it('un UUID qui n\'est pas un espace reste tel quel', async () => {
    const { pool } = fauxPool([{ id: A, name: 'Acme', public_code: 'k7m2p3' }]);
    const texte = `campagne ${INCONNU} sur l'espace ${A}`;
    expect(await creerLibelleurEspaces(pool)(texte)).toBe(`campagne ${INCONNU} sur l'espace ${A} « Acme » (k7m2p3)`);
  });

  it('un texte sans UUID ne fait aucune requête', async () => {
    const { pool, query } = fauxPool([]);
    expect(await creerLibelleurEspaces(pool)('worker redémarré')).toBe('worker redémarré');
    expect(query).not.toHaveBeenCalled();
  });

  it('le même UUID deux fois : une seule requête, un seul identifiant demandé, les deux occurrences libellées', async () => {
    const { pool, appels } = fauxPool([{ id: A, name: 'Acme', public_code: 'k7m2p3' }]);
    const sortie = await creerLibelleurEspaces(pool)(`${A} puis ${A.toUpperCase()}`);
    expect(appels).toHaveLength(1);
    expect(appels[0]!.params[0]).toEqual([A]);
    expect(sortie).toBe(`${A} « Acme » (k7m2p3) puis ${A.toUpperCase()} « Acme » (k7m2p3)`);
  });

  it('au plus 10 identifiants distincts par requête', async () => {
    const ids = Array.from({ length: 12 }, (_v, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const { pool, appels } = fauxPool([]);
    await creerLibelleurEspaces(pool)(ids.join(' '));
    expect((appels[0]!.params[0] as string[]).length).toBe(10);
  });

  it('un espace sans code stocké est libellé avec le code calculé', async () => {
    const { pool } = fauxPool([{ id: B, name: 'Ancien', public_code: null }]);
    expect(await creerLibelleurEspaces(pool)(`espace ${B}`)).toBe(`espace ${B} « Ancien » (${deriveTenantCode(B)})`);
  });

  it('une base en panne laisse le texte inchangé, sans lever', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('connexion refusée'); }) } as never;
    await expect(creerLibelleurEspaces(pool)(`espace ${A}`)).resolves.toBe(`espace ${A}`);
  });

  it('une base qui ne répond pas laisse partir le texte inchangé au plafond', async () => {
    vi.useFakeTimers();
    const pool = { query: vi.fn(() => new Promise(() => { /* jamais */ })) } as never;
    const promesse = creerLibelleurEspaces(pool, { plafondMs: 1000 })(`espace ${A}`);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promesse).resolves.toBe(`espace ${A}`);
  });
});
