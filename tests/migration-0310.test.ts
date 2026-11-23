import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0310 : la joignabilité WhatsApp des commandes Shopify (segments Shopify enrichis, lot 2b). Deux tables neuves, dans une
 * transaction, `lock_timeout` en tête. 🔴 Aucune colonne de téléphone, de nom ni d'adresse : la carte se calcule sans
 * conserver ce qu'on ne peut pas écrire.
 */
const SQL = readFileSync(new URL('../db/migrations/0310_shopify_joignabilite.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');

describe('migration 0310', () => {
  it('🔴 le plafond d’attente du verrou vient en tête, dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('🔴 deux tables neuves et leurs index, rien d’autre (aucune table existante modifiée)', () => {
    expect(instructions.slice(1).map((i) => i.split(' (')[0])).toEqual([
      'create table if not exists shopify_joignabilite',
      'create index if not exists shopify_joignabilite_expediee on shopify_joignabilite',
      'create table if not exists shopify_envois',
      'create index if not exists shopify_envois_commande on shopify_envois',
    ]);
  });

  it('🔴 le classement est fermé à ses trois valeurs, sous un nom de contrainte lisible', () => {
    expect(sansCommentaires(SQL)).toMatch(
      /constraint shopify_joignabilite_classement_check\s+check \(classement in \('sans_numero', 'invalide', 'utilisable'\)\)/,
    );
  });

  it('🔴 aucune donnée personnelle : ni téléphone, ni nom, ni adresse', () => {
    expect(sansCommentaires(SQL)).not.toMatch(/phone|telephone|e164|nom\b|name|adresse|address/i);
  });
});
