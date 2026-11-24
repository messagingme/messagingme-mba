import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0317 : la trace des numéros effacés (segments Shopify enrichis, lot 5b ; décision de Julien du 2026-11-24 : « un contact
 * supprimé n'est JAMAIS recréé par le rattrapage »). Une table neuve et son index, dans une transaction, `lock_timeout` en
 * tête, aucune table existante modifiée. 🔴 BLOQUANTE : `purgeMany` l'écrit dans SA transaction (le même test le vérifie
 * dans le code), elle part SEULE, avant le code. 🔴 Jamais un numéro en clair : son empreinte. 🔴 Toute requête du magasin
 * nomme l'espace, sauf le balayage de rétention, tous espaces par construction (comme la liste de refus).
 */
const SQL = readFileSync(new URL('../db/migrations/0317_numeros_effaces.sql', import.meta.url), 'utf8');
const MAGASIN = readFileSync(new URL('../src/crm/contact-store.pg.ts', import.meta.url), 'utf8');
const WORKER = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');

describe('migration 0317', () => {
  it('🔴 le plafond d’attente du verrou vient en tête, dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('🔴 une table neuve et l’index de la rétention, rien d’autre (aucune table existante modifiée)', () => {
    expect(instructions.slice(1).map((i) => i.split(' (')[0])).toEqual([
      'create table if not exists numeros_effaces',
      'create index if not exists numeros_effaces_efface_le on numeros_effaces',
    ]);
    expect(sansCommentaires(SQL)).not.toMatch(/alter table|drop /i);
  });

  it('🔴 une empreinte par numéro et par espace, sa date toujours renseignée ; l’espace meurt avec ses traces', () => {
    const t = sansCommentaires(SQL).replace(/\s+/g, ' ');
    expect(t).toContain('tenant_id uuid not null references tenants(id) on delete cascade');
    expect(t).toContain("empreinte text not null constraint numeros_effaces_empreinte_check check (empreinte ~ '^[0-9a-f]{64}$')");
    expect(t).toContain('efface_le timestamptz not null default now()');
    expect(t).toContain('primary key (tenant_id, empreinte)');
    expect(t).toContain('create index if not exists numeros_effaces_efface_le on numeros_effaces (efface_le)');
  });

  it('🔴 aucune donnée personnelle en clair : ni téléphone, ni nom, ni adresse, ni fiche', () => {
    expect(sansCommentaires(SQL)).not.toMatch(/phone|telephone|e164|\bnom\b|name|adresse|address|email|commande_id|contact_id/i);
  });

  it('🔴 BLOQUANTE : la purge l’écrit dans sa transaction, pour toute fiche qui avait un numéro, par la même empreinte que la liste de refus', () => {
    // Depuis le lot 2 du 2026-11-24 (le plus ancien laisse sa place), le corps de la purge vit dans `purgerDans`, que
    // `purgeMany` appelle dans SA transaction, comme le remplacement dans la sienne : la même écriture, le même client.
    const debut = MAGASIN.indexOf('async purgeMany(');
    const transaction = MAGASIN.indexOf('enTransaction(this.pool, (client) => this.purgerDans(client, tenantId, ids))', debut);
    const corps = MAGASIN.indexOf('private async purgerDans(client: PoolClient', debut);
    const ecriture = MAGASIN.indexOf('insert into numeros_effaces', corps);
    const anonymisation = MAGASIN.indexOf("set phone_e164 = 'anon:' || gen_random_uuid()", corps);
    expect(debut).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(debut);
    expect(corps).toBeGreaterThan(transaction);
    expect(ecriture).toBeGreaterThan(corps);
    // Avant l'anonymisation : après elle, le numéro n'est plus lisible.
    expect(ecriture).toBeLessThan(anonymisation);
    expect(MAGASIN.slice(corps, anonymisation)).toContain('const effaces = [...new Set(e164)].map((tel) => empreinteRefus(tenantId, { tel }));');
    expect(MAGASIN.slice(ecriture - 120, ecriture)).toContain('await client.query(');
  });

  it('🔴 chaque requête du magasin sur la trace nomme l’espace, sauf le balayage de rétention, que le worker appelle', () => {
    const requetes = [...MAGASIN.matchAll(/query(?:<[^>]*>)?\(\s*`([\s\S]*?)`/g)].map((m) => m[1]!).filter((r) => /numeros_effaces/.test(r));
    expect(requetes).toHaveLength(3);
    const retention = requetes.filter((r) => /^\s*delete from numeros_effaces where efface_le < now\(\) - make_interval\(days => \$1::int\)\s*$/.test(r));
    expect(retention).toHaveLength(1);
    for (const r of requetes.filter((x) => !retention.includes(x))) expect(r, r).toMatch(/tenant_id = \$1|select \$1::uuid, e, now\(\)/);
    expect(WORKER).toContain('contactStore.purgerNumerosEffaces(RETENTION_NUMEROS_EFFACES_JOURS)');
  });
});
