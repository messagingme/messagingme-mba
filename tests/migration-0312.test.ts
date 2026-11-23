import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0312 : la dernière réponse et le dernier clic d'une fiche (segments Shopify enrichis, lot 4). Deux colonnes nullables
 * sur `contacts`, remplies par deux agrégats calculés AVANT l'`alter` (le verrou exclusif ne couvre que l'écriture), dans
 * une transaction, `lock_timeout` en tête. 🔴 Le remplissage reste dans l'espace de la fiche, ne recule jamais et ne
 * touche pas une fiche purgée : `tests/integration/migration-0312.integration.test.ts` le joue sur de vraies données.
 */
const SQL = readFileSync(new URL('../db/migrations/0312_contacts_reponse_clic.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');

describe('migration 0312', () => {
  it('🔴 le plafond d’attente du verrou vient en tête, dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('🔴 les deux agrégats AVANT l’alter, puis les deux colonnes nullables sans défaut, puis le remplissage', () => {
    expect(instructions.slice(1).map((i) => i.replace(/ (as|set) .*$/, ''))).toEqual([
      'create temp table reponses_0312 on commit drop',
      'create temp table clics_0312 on commit drop',
      'alter table contacts add column if not exists derniere_reponse_le timestamptz, add column if not exists dernier_clic_le timestamptz',
      'update contacts c',
      'update contacts c',
    ]);
  });

  it('🔴 les messages ENTRANTS seuls, les clics ATTRIBUÉS seuls, par espace', () => {
    const [, reponses, clics] = instructions;
    expect(reponses).toContain("where v.contact_id is not null and m.direction = 'in'");
    expect(reponses).toContain('group by v.tenant_id, v.contact_id');
    expect(clics).toContain('where k.contact_id is not null');
    expect(clics).toContain('group by k.tenant_id, k.contact_id');
  });

  it('🔴 le remplissage : la fiche de l’espace, jamais une fiche purgée, sans reculer', () => {
    const [reponse, clic] = instructions.slice(4);
    expect(reponse).toContain('where c.id = r.contact_id and c.tenant_id = r.tenant_id and c.anonymized_at is null');
    expect(reponse).toContain('and (c.derniere_reponse_le is null or c.derniere_reponse_le < r.le)');
    expect(clic).toContain('where c.id = k.contact_id and c.tenant_id = k.tenant_id and c.anonymized_at is null');
    expect(clic).toContain('and (c.dernier_clic_le is null or c.dernier_clic_le < k.le)');
  });
});
