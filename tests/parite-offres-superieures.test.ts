import { describe, it, expect, beforeAll } from 'vitest';
import { routesDeConsole, type RouteDeConsole } from './parite/inventaire';
import { ADRESSES } from './parite/adresses';
import { OFFRES_SUPERIEURES } from './parite/offres-superieures';

/**
 * LES ROUTES BUSINESS ET ENTREPRISE (lot 1 du CSM virtuel, plan
 * `docs/superpowers/plans/2026-11-26-csm-lot1-parite-criteres-et-offres.md`) : la table `tests/parite/offres-superieures.ts`
 * nomme EXACTEMENT les routes que l'inventaire trouve fermées au Pro, chacune avec ce qu'un outil devra en exposer au
 * lot 7. Avec `ADRESSES`, chaque route de console a désormais une ligne quelque part, et une seule.
 */

let routes: RouteDeConsole[] = [];
beforeAll(async () => {
  routes = await routesDeConsole();
}, 120_000);

const fermees = (): RouteDeConsole[] => routes.filter((r) => !r.ouverteAuPro);

describe('les routes Business et Entreprise : chacune nommée, pour le lot 7', () => {
  it('la garde de la garde : l’inventaire trouve des routes fermées au Pro', () => {
    expect(fermees().length).toBeGreaterThan(0);
  });

  it('🔴 chaque route fermée au Pro a son entrée', () => {
    const absentes = fermees().filter((r) => !Object.hasOwn(OFFRES_SUPERIEURES, r.cle)).map((r) => `${r.cle} (module ${r.module})`);
    expect(absentes, 'Une route Business ou Entreprise n’est nommée nulle part : ajoutez-la à tests/parite/offres-superieures.ts, '
      + 'avec ce qu’un outil devra en exposer.').toEqual([]);
  });

  it('🔴 aucune entrée morte : une route rouverte au Pro sort d’ici pour entrer dans ADRESSES', () => {
    const cles = new Set(fermees().map((r) => r.cle));
    expect(Object.keys(OFFRES_SUPERIEURES).filter((c) => !cles.has(c))).toEqual([]);
  });

  it('aucune route n’est à la fois dans les deux tables, et chaque entrée dit ce qu’il faudra exposer', () => {
    expect(Object.keys(OFFRES_SUPERIEURES).filter((c) => Object.hasOwn(ADRESSES, c))).toEqual([]);
    expect(Object.entries(OFFRES_SUPERIEURES).filter(([, r]) => r.quoi.trim().length < 10).map(([c]) => c)).toEqual([]);
  });
});
