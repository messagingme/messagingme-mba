import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';

/**
 * 0273 : les segments sur les commandes, le pays et l'activité (spec du 2026-10-31). Ce que seul son texte peut dire avant
 * la production : l'ancien code survit (aucune colonne exigée sans défaut), l'existant est rempli avant la contrainte,
 * l'activité ne passe jamais d'un espace à l'autre, et les verrous se prennent dans l'ordre de `purgeMany`.
 */
const SQL = readFileSync(new URL('../db/migrations/0273_segments.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL).map(sansCommentaires).map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()).filter((i) => i !== '');
const indice = (debut: string): number => instructions.findIndex((i) => i.startsWith(debut));

describe('migration 0273', () => {
  it('🔴 dans une transaction, sous un délai de verrou, sans accent grave', () => {
    expect(veutHorsTransaction(SQL)).toBe(false);
    expect(SQL).not.toContain('`');
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
  });

  it('🔴 contacts avant shopify_commandes, l’ordre de purgeMany, et l’agrégat calculé avant le verrou de contacts', () => {
    const agregat = indice('create temp table activite_0273 on commit drop as');
    const contacts = indice('alter table contacts add column if not exists derniere_activite_le timestamptz');
    const commandes = indice('alter table shopify_commandes add column');
    expect([agregat, contacts, commandes].every((i) => i >= 0)).toBe(true);
    expect(agregat).toBeLessThan(contacts);
    expect(contacts).toBeLessThan(commandes);
  });

  it('🔴 la date de paiement est remplie AVANT de devenir obligatoire, et garde un défaut pour l’ancien code', () => {
    const ajout = indice('alter table shopify_commandes add column');
    const remplissage = indice('update shopify_commandes set payee_le = cree_le where payee_le is null');
    const defaut = indice('alter table shopify_commandes alter column payee_le set default now()');
    const obligatoire = indice('alter table shopify_commandes alter column payee_le set not null');
    expect([ajout, remplissage, defaut, obligatoire].every((i) => i >= 0)).toBe(true);
    expect(ajout).toBeLessThan(remplissage);
    expect(remplissage).toBeLessThan(obligatoire);
    expect(defaut).toBeLessThan(obligatoire);
  });

  it('les montants et devises bornés, le drapeau test par défaut faux', () => {
    const ajout = instructions[indice('alter table shopify_commandes add column')];
    expect(ajout).toContain('montant numeric(18,3) check (montant is null or montant >= 0)');
    expect(ajout).toContain("devise text check (devise is null or devise ~ '^[A-Z]{3}$')");
    expect(ajout).toContain('test boolean not null default false');
  });

  it('la colonne des boutiques ne réécrit rien', () => {
    expect(instructions).toContain('alter table shopify_boutiques add column if not exists commandes_depuis timestamptz not null default now()');
  });

  it('🔴 l’activité remplie par espace, sans jamais reculer', () => {
    const agregat = instructions[indice('create temp table activite_0273')] ?? '';
    expect(agregat).toContain("m.direction = 'in'");
    expect(agregat).toContain('k.contact_id is not null');
    expect(agregat).toContain('group by s.tenant_id, s.contact_id');
    const maj = instructions[indice('update contacts c set derniere_activite_le')] ?? '';
    expect(maj).toContain('where c.id = a.contact_id and c.tenant_id = a.tenant_id');
    expect(maj).toContain('c.derniere_activite_le is null or c.derniere_activite_le < a.le');
  });
});
