import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { PgLignesCreditStore } from '../src/credit-whatsapp/lignes.pg';

/**
 * LA LIGNE D'UN NUMÉRO, LUE AVANT CHAQUE ENVOI (écart 14 du plan du Crédit WhatsApp) : une lecture en vol par numéro, pour
 * qu'une rafale d'envois simultanés ne fasse qu'une requête, et jamais une valeur périmée gardée après une écriture.
 * Sur un faux pool dont les lectures attendent qu'on les libère.
 */
function poolLent() {
  const requetes: string[] = [];
  const attentes: Array<() => void> = [];
  const etat: { ligne: Record<string, unknown> | null } = { ligne: null };
  const pool = {
    query: async (sql: string) => {
      const verbe = sql.trim().split(/\s+/)[0]!.toLowerCase();
      requetes.push(verbe);
      if (verbe === 'select') {
        // La base telle qu'au début de la requête : une écriture qui arrive pendant l'attente ne la change pas.
        const lue = etat.ligne;
        await new Promise<void>((r) => attentes.push(r));
        return { rows: lue ? [lue] : [], rowCount: lue ? 1 : 0 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  return {
    pool: pool as unknown as Pool,
    requetes,
    etat,
    liberer: async (): Promise<void> => {
      await new Promise((r) => setTimeout(r, 0));
      attentes.splice(0).forEach((r) => r());
    },
  };
}

const LIGNE = { id: 'l1', tenant_id: 't1', phone_number_id: 'pn1', waba_id: 'w1', origine: 'ops', depuis: new Date('2026-10-31T10:00:00Z'), arretee_le: null };

describe('la ligne d’un numéro, lue avant chaque envoi', () => {
  it('une rafale d’envois simultanés ne fait qu’une requête, puis le cache sert', async () => {
    const p = poolLent();
    p.etat.ligne = LIGNE;
    const store = new PgLignesCreditStore(p.pool, () => 0);
    const rafale = Promise.all([store.ligneDuNumero('pn1'), store.ligneDuNumero('pn1'), store.ligneDuNumero('pn1')]);
    await p.liberer();
    const lues = await rafale;
    expect(lues.map((l) => l?.tenantId)).toEqual(['t1', 't1', 't1']);
    expect(p.requetes).toEqual(['select']);
    expect((await store.ligneDuNumero('pn1'))?.id).toBe('l1');
    expect(p.requetes).toEqual(['select']);
  });

  it('🔴 une écriture pendant une lecture : la lecture lancée avant n’est jamais gardée en cache', async () => {
    const p = poolLent();
    p.etat.ligne = LIGNE;
    const store = new PgLignesCreditStore(p.pool, () => 0);
    const avant = store.ligneDuNumero('pn1');
    // Le numéro quitte la ligne pendant que la lecture est en vol.
    expect(await store.retirer('t1', 'pn1')).toBe(true);
    p.etat.ligne = null;
    await p.liberer();
    expect((await avant)?.id).toBe('l1');
    // La lecture suivante repart de la base, au lieu de servir la ligne retirée pendant cinq secondes.
    const apres = store.ligneDuNumero('pn1');
    await p.liberer();
    expect(await apres).toBeNull();
    expect(p.requetes).toEqual(['select', 'update', 'select']);
  });
});
