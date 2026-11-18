/**
 * Les templates écrits ou modifiés depuis un bloc du constructeur (menu « Scénario », lot 3, spec
 * `docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md`, décisions 18, 19 et 27). Une ligne de
 * `modeles_de_bloc` (migration 0296) par template créé ainsi : la marque « créé par le builder » et son état tranché par
 * Meta. `etat` n'avance qu'une fois (`en_validation` vers `approuve` ou `refuse`) : le statut rejoué par Meta et le filet
 * ne trouvent plus rien à trancher.
 */
export const ETATS_MODELE_DE_BLOC = ['en_validation', 'approuve', 'refuse'] as const;
export type EtatModeleDeBloc = (typeof ETATS_MODELE_DE_BLOC)[number];
