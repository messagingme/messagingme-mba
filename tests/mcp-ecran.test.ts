import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { OUTILS } from '../src/mcp/outils';
import { ECRANS, LISTES, adresseEcran, lire } from '../src/mcp/ecran';

/**
 * L'ÉCRAN DE CE QU'UN OUTIL VIENT DE FAIRE (lot 1 du CSM virtuel, B0b, plan
 * `docs/superpowers/plans/2026-11-24-csm-lot1-b0-contrats.md`).
 *
 * 🔴 Un écran qui n'existe pas, ou un paramètre qu'une page ne lit pas, enverrait le client sur une page vide ou sur la
 * liste en lui laissant croire qu'il verra son objet : ce fichier relie chaque chemin à un dossier de `web/app`, et chaque
 * paramètre au code de sa page.
 */
const page = (chemin: string): string => `web/app${chemin.split('?')[0]}/page.tsx`;

describe('l’écran de ce qu’un outil vient de faire (B0b)', () => {
  it('🔴 chaque outil d’écriture déclare son écran, et aucun outil de lecture', () => {
    const sansEcran = OUTILS.filter((o) => o.scope === 'mcp:write' && o.ecran === undefined).map((o) => o.nom);
    const lectureAvecEcran = OUTILS.filter((o) => o.scope === 'mcp:read' && o.ecran !== undefined).map((o) => o.nom);
    expect({ sansEcran, lectureAvecEcran }).toEqual({ sansEcran: [], lectureAvecEcran: [] });
  });

  it('🔴 chaque liste et chaque écran mène à une page qui existe dans la console', () => {
    const chemins = [...Object.values(LISTES), ECRANS.agent('a1'), ECRANS.conversation('c1'), ECRANS.scenario('s1'), ECRANS.miseEnLigne('m1')];
    expect(chemins.filter((c) => !existsSync(page(c)))).toEqual([]);
  });

  it('🔴 les paramètres d’un écran sont ceux que lit sa page', () => {
    expect(readFileSync(page('/agents'), 'utf8')).toContain("params.get('id')");
    expect(readFileSync(page('/agents'), 'utf8')).toMatch(/ONGLETS[^\n]*'connaissance'[^\n]*'outils'/);
    expect(readFileSync(page('/workflows'), 'utf8')).toContain("searchParams.get('open')");
    expect(readFileSync(page('/inbox'), 'utf8')).toContain("searchParams.get('c')");
    // La page du oui de mise en ligne (CSM, B2) lit l'identifiant que rend `propose_go_live`.
    expect(readFileSync(page('/mise-en-ligne'), 'utf8')).toContain(".get('id')");
  });

  it('chaque outil d’écriture rend un chemin de la console, même sans arguments ni résultat lisibles', () => {
    for (const o of OUTILS) if (o.ecran !== undefined) expect(o.ecran({}, null), o.nom).toMatch(/^\/[a-z]/);
  });

  it('un identifiant s’encode, un agent garde son onglet, un résultat se lit sans rien supposer de sa forme', () => {
    expect(ECRANS.agent('a b', 'outils')).toBe('/agents?id=a%20b&tab=outils');
    expect(ECRANS.scenario(undefined)).toBe(LISTES.scenarios);
    expect(lire({ agent: { id: 'x' } }, 'agent', 'id')).toBe('x');
    expect(lire({ agent: null }, 'agent', 'id')).toBeUndefined();
    expect(lire(Object.create({ id: 'herite' }), 'id')).toBeUndefined();
    expect(adresseEcran('/widgets')).toMatch(/^https?:\/\/[^/]+\/widgets$/);
  });
});
