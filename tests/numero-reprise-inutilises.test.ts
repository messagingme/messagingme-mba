import { describe, it, expect } from 'vitest';
import { DELAI_NUMERO_INUTILISE_HEURES, reprendreLesNumerosInutilises, type DepsRepriseInutilises } from '../src/numero/reprise-inutilises';
import { TACHES_PAR_ROLE } from '../src/worker/roles';
import type { NumeroRepris } from '../src/otp/store.pg';

/**
 * LA REPRISE DES NUMÉROS FOURNIS QUI N'ONT JAMAIS SERVI (plan `docs/superpowers/plans/2026-11-18-numeros-fournis-retour-
 * au-stock.md`). La condition elle-même (24 h, aucun code qui a pu être lu, pas d'abonné, rien qui le porte) est
 * exécutée par Postgres : `tests/integration/numeros-fournis.integration.test.ts`. Ici, le tour : ce qu'il fait d'un
 * numéro repris, d'un numéro qui a servi entre-temps, et d'un échec.
 */

const ATTRIBUE_LE = new Date('2026-11-16T01:06:00Z');

function banc(o: {
  candidats: Array<{ id: string; tenantId: string }>;
  /** Ce que rend la reprise de chaque numéro : repris, `null` (il a servi entre-temps), ou une erreur. */
  issues: Record<string, NumeroRepris | null | Error>;
  servi?: { tenantId: string; numero: string | null } | null;
}) {
  const cap = { delais: [] as number[], servis: [] as string[], alertes: [] as string[] };
  const d: DepsRepriseInutilises = {
    numeros: {
      numerosInutilises: async (delai) => { cap.delais.push(delai); return o.candidats; },
      reprendreSiInutilise: async (id, _tenantId, delai) => {
        cap.delais.push(delai);
        const issue = o.issues[id];
        if (issue instanceof Error) throw issue;
        return issue ?? null;
      },
    },
    servirLAttente: async (sauf) => { cap.servis.push(sauf); return o.servi ?? null; },
    alerter: async (texte) => { cap.alertes.push(texte); return true; },
  };
  return { d, cap };
}

describe('la reprise des numéros fournis inutilisés', () => {
  it('🔴 un numéro repris va d’abord à l’abonné qui attend, jamais à l’espace qui l’a rendu, et Julien a sa ligne', async () => {
    const { d, cap } = banc({
      candidats: [{ id: 'n1', tenantId: 't-zigi' }],
      issues: { n1: { numero: '442837619069', tenantId: 't-zigi', attribueLe: ATTRIBUE_LE } },
      servi: { tenantId: 't-abonne', numero: '442837619069' },
    });
    expect(await reprendreLesNumerosInutilises(d)).toBe(1);
    expect(cap.servis).toEqual(['t-zigi']);
    expect(cap.alertes).toHaveLength(1);
    expect(cap.alertes[0]).toMatch(/rendu au stock.*\+442837619069.*t-zigi.*2026-11-16.*t-abonne/);
  });

  it('le délai est celui de la décision de Julien, 24 h, à la lecture comme à la reprise', async () => {
    const { d, cap } = banc({ candidats: [{ id: 'n1', tenantId: 't1' }], issues: { n1: null } });
    await reprendreLesNumerosInutilises(d);
    expect(DELAI_NUMERO_INUTILISE_HEURES).toBe(24);
    expect(cap.delais).toEqual([24, 24]);
  });

  it('🔴 un numéro qui a servi entre la lecture et le verrou : rien, ni abonné servi ni alerte', async () => {
    const { d, cap } = banc({ candidats: [{ id: 'n1', tenantId: 't1' }], issues: { n1: null } });
    expect(await reprendreLesNumerosInutilises(d)).toBe(0);
    expect([cap.servis, cap.alertes]).toEqual([[], []]);
  });

  it('🔴 un numéro en échec n’arrête pas les suivants', async () => {
    const { d, cap } = banc({
      candidats: [{ id: 'n1', tenantId: 't1' }, { id: 'n2', tenantId: 't2' }],
      issues: { n1: new Error('verrou impossible'), n2: { numero: '441301548023', tenantId: 't2', attribueLe: ATTRIBUE_LE } },
    });
    expect(await reprendreLesNumerosInutilises(d)).toBe(1);
    expect(cap.servis).toEqual(['t2']);
    expect(cap.alertes[0]).toContain('+441301548023');
    expect(cap.alertes[0]).not.toContain('abonné');
  });

  it('🔴 une alerte qui lève ne fait pas perdre le compte ni les numéros suivants : ils sont déjà au stock', async () => {
    const { d, cap } = banc({
      candidats: [{ id: 'n1', tenantId: 't1' }, { id: 'n2', tenantId: 't2' }],
      issues: {
        n1: { numero: '441301548023', tenantId: 't1', attribueLe: ATTRIBUE_LE },
        n2: { numero: '442837619069', tenantId: 't2', attribueLe: ATTRIBUE_LE },
      },
    });
    let premier = true;
    d.alerter = async (texte) => {
      if (premier) { premier = false; throw new Error('Telegram injoignable'); }
      cap.alertes.push(texte);
      return true;
    };
    expect(await reprendreLesNumerosInutilises(d)).toBe(2);
    expect(cap.alertes).toHaveLength(1);
    expect(cap.alertes[0]).toContain('+442837619069');
  });

  it('la tâche tourne sur le rôle principal du worker', () => {
    expect(TACHES_PAR_ROLE['numeros-inutilises']).toBe('principal');
  });
});
