import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * L'INVENTAIRE DE CEUX QUI LISENT LE SOLDE DU CRÉDIT IA (Entreprise illimitée, lot B ; décision de Julien du 2026-11-02).
 *
 * Une Entreprise est illimitée : son solde ne bouge plus, il ne dit plus rien. 🔴 Un chemin qui déciderait encore sur lui
 * arrêterait l'IA d'une Entreprise à solde nul (Groupama PJ en tête), ou la laisserait tourner sans son plafond de
 * sécurité. « Cet espace peut-il consommer de l'IA ? » passe donc par `acces_credit_ia` (migration 0268), lue par
 * `src/agent/acces-credit.ts` ou dans la requête elle-même. Ce test oblige un nouveau lecteur du solde à se déclarer
 * ici, avec la raison pour laquelle il ne décide pas de l'accès.
 */
const AUTORISES: Record<string, string> = {
  'src/agent/credits.pg.ts': 'le store du solde : débits, crédits, historique',
  'src/agent/acces-credit.ts': 'le point de passage de l’accès, et l’état montré aux écrans',
  'src/agent/cles-gateway.pg.ts': 'la cible du plafond Vercel : ce qui a été crédité depuis l’ouverture de la clé, plus la marge d’une Entreprise',
  'src/agent/provisionner-cle.ts': 'le plafond de naissance d’une clé : le solde, plus la marge d’une Entreprise (`margeDeCle`)',
  'src/emails-produit/store.pg.ts': 'le récapitulatif de la semaine, qui ne va qu’à la Free (`estFree`), donc à un prépayé',
  'src/ops/credits.pg.ts': 'la vue « Crédits » de `/ops`, un affichage (le plafond atteint se lit par `acces_credit_ia`)',
  'src/ops/suppression-espace.pg.ts': 'le bilan avant la suppression d’un espace, un affichage',
};

/** Les six chemins qui décidaient sur le solde avant le lot B : chacun lit l'accès, jamais le solde. */
const DECIDEURS = [
  'src/agent/run-turn.ts',
  'src/agent/essai.ts',
  'src/repondeur/demarrer.ts',
  'src/traduction/traduire.ts',
  'src/inbox/transcrire.ts',
  'src/agent/knowledge.pg.ts',
];

const RACINE = resolve(__dirname, '..');

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiers(chemin);
    return nom.endsWith('.ts') ? [chemin] : [];
  });
}

const lire = (chemin: string): string => readFileSync(join(RACINE, chemin), 'utf8');

/** La table du solde IA (pas celle de ses mouvements), ou la lecture du solde par son store (`credits.solde(`). */
const LIT_LE_SOLDE = /\bagent_credits\b|\bcredits\.solde\(/;

describe('qui lit le solde du Crédit IA', () => {
  it('🔴 seuls les fichiers inventoriés lisent le solde, chacun pour une raison qui n’est pas l’accès', () => {
    const lecteurs = fichiers(join(RACINE, 'src'))
      .filter((f) => LIT_LE_SOLDE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(RACINE, f).split('\\').join('/'))
      .sort();
    expect(lecteurs).toEqual(Object.keys(AUTORISES).sort());
  });

  it('🔴 les six chemins qui consomment de l’IA lisent l’accès (`acces_credit_ia`), et aucun le solde', () => {
    for (const f of DECIDEURS) {
      const texte = lire(f);
      expect(texte, f).not.toMatch(LIT_LE_SOLDE);
      expect(texte, f).toMatch(/\.acces\(|acces_credit_ia\(/);
    }
  });

  it('la règle vit dans une migration, et le store la lit sans la recopier', () => {
    const migrations = readdirSync(join(RACINE, 'db/migrations')).filter((n) => /^\d+_.*\.sql$/.test(n));
    const definie = migrations.filter((n) => /create or replace function acces_credit_ia\(/i.test(lire(`db/migrations/${n}`)));
    expect(definie).toEqual(['0268_credit_ia_illimite.sql']);
    expect(lire('src/agent/acces-credit.ts')).toMatch(/acces_credit_ia\(\$1::uuid, \$2::bigint\)/);
  });
});
