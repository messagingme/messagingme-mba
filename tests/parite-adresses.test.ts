import { describe, it, expect, beforeAll } from 'vitest';
import { OUTILS } from '../src/mcp/outils';
import { routesDeConsole, type RouteDeConsole } from './parite/inventaire';
import { ADRESSES, type Decision } from './parite/adresses';

/**
 * LA PARITÉ DES ADRESSES (lot 1 du CSM virtuel, brique B1, plan `docs/superpowers/plans/2026-11-24-csm-lot1-b1-parite.md`).
 *
 * 🔴 CE QUE CE TEST TIENT : chaque route de console ouverte au Pro a une décision dans `tests/parite/adresses.ts` (un
 * outil MCP, un geste humain, une exclusion motivée, ou la brique qui la couvrira). Une route ajoutée sans décision le
 * rend rouge : c'est ainsi que la liste de travail du lot 1 ne se rouvre pas en silence. Les inventaires du cadrage
 * avaient chacun oublié quelque chose ; celui-ci vient du registre et se mesure (`tests/parite/inventaire.ts`).
 */

let routes: RouteDeConsole[] = [];
beforeAll(async () => {
  routes = await routesDeConsole();
}, 120_000);

const ouvertes = (): RouteDeConsole[] => routes.filter((r) => r.ouverteAuPro);
const textes = (d: Decision): string[] =>
  'outils' in d ? [...d.outils, ...(d.reste === undefined ? [] : [d.reste])]
    : 'humain' in d ? [d.humain]
      : 'exclue' in d ? [d.exclue]
        : [d.quoi];

describe('parité des adresses : chaque route de console ouverte au Pro a son outil MCP, ou une raison écrite', () => {
  it('la garde de la garde : l’inventaire trouve des routes ouvertes au Pro ET des routes que l’offre lui refuse', () => {
    // Sans routes refusées, la mesure de l'offre ne prouverait rien : toutes passeraient pour ouvertes, et la table
    // devrait accueillir le lot 7. Sans routes ouvertes, le test vérifierait une table vide.
    expect(ouvertes().length).toBeGreaterThan(0);
    expect(routes.some((r) => !r.ouverteAuPro)).toBe(true);
  });

  it('🔴 deux routes ouvertes au Pro ne partagent jamais une clé', () => {
    const vues = new Map<string, string>();
    const doublons: string[] = [];
    for (const r of ouvertes()) {
      const deja = vues.get(r.cle);
      if (deja !== undefined) doublons.push(`${r.cle} : ${deja} et ${r.chemin}`);
      vues.set(r.cle, r.chemin);
    }
    expect(doublons).toEqual([]);
  });

  it('🔴 chaque route ouverte au Pro a sa décision dans la table', () => {
    const sansDecision = ouvertes().filter((r) => !Object.hasOwn(ADRESSES, r.cle)).map((r) => `${r.cle} (module ${r.module})`);
    expect(sansDecision, 'Une route de console ouverte au Pro n’a pas de décision : ajoutez-la à tests/parite/adresses.ts '
      + '(l’outil MCP qui la sert, un geste humain, une exclusion motivée, ou la brique qui la couvrira).').toEqual([]);
  });

  it('🔴 la table n’a aucune entrée morte, ni aucune route que l’offre refuse au Pro (lot 7)', () => {
    const cles = new Set(ouvertes().map((r) => r.cle));
    const mortes = Object.keys(ADRESSES).filter((c) => !cles.has(c));
    expect(mortes, 'Ces entrées ne désignent aucune route ouverte au Pro : route renommée, supprimée, ou réservée '
      + 'au Business et à l’Entreprise.').toEqual([]);
  });

  it('🔴 chaque outil nommé existe dans le catalogue MCP', () => {
    const connus = new Set(OUTILS.map((o) => o.nom));
    const inconnus = Object.entries(ADRESSES).flatMap(([cle, d]) =>
      'outils' in d ? d.outils.filter((o) => !connus.has(o)).map((o) => `${cle} : ${o}`) : []);
    expect(inconnus).toEqual([]);
  });

  it('chaque décision dit pourquoi, ou quoi : aucune liste d’outils vide, aucune raison vide', () => {
    const muettes = Object.entries(ADRESSES)
      .filter(([, d]) => ('outils' in d && d.outils.length === 0) || textes(d).some((t) => t.trim() === ''))
      .map(([cle]) => cle);
    expect(muettes).toEqual([]);
  });
});
