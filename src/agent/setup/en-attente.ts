import { z } from 'zod';
import type { ContexteConstruction } from './conversation';
import { brancheables, differences, propositionSchema, type Changement, type Proposition } from './proposition';
import { champScenario, situationDuMoment, type ScenarioAPoser } from './scenarios';
import type { PropositionAffichee } from './tour-entretien';

/**
 * 🔴 LA PROPOSITION SURVIT AU TOUR QUI L'A PRODUITE (Maison Saint-Honoré, 2026-11-24). Elle ne partait que dans la
 * réponse de ce tour : un rechargement, un onglet quitté puis rouvert, ou une coupure, et l'écran relisait le fil sans
 * elle. Le dernier message disait « Relisez la proposition ci-dessous » au-dessus de rien, et aucun bouton ne
 * permettait plus d'enregistrer ni d'activer. Elle est donc gardée avec l'entretien, et la relecture la rend,
 * RECALCULÉE contre l'agent tel qu'il est : une ligne déjà enregistrée n'y figure plus. « Enregistrer » et « Tout
 * jeter » l'effacent (`DELETE /setup/proposition`).
 */
export type PropositionRetenue = Omit<Proposition, 'reponses' | 'bascules'>;

export interface PropositionEnAttente {
  proposition: PropositionRetenue;
  scenarios: ScenarioAPoser[];
  outilsAActiver: string[];
}

export interface PropositionRendue {
  proposition: PropositionAffichee;
  changements: Changement[];
}

/** Ce que l'écran reçoit d'une proposition : la même construction au tour et à la relecture. */
export function rendreProposition(
  contexte: ContexteConstruction,
  p: PropositionRetenue,
  scenarios: ScenarioAPoser[],
  outilsAActiver: string[],
): PropositionRendue {
  return {
    proposition: {
      fiche: p.fiche ?? {},
      outils: p.outils ?? [],
      connecteurs: (p.connecteurs ?? []).filter((c) => (contexte.connecteurs ?? []).some((x) => x.nom === c.nom)),
      outilsBranches: brancheables(contexte.catalogue, p.outilsBranches, false),
      outilsDebranches: brancheables(contexte.catalogue, p.outilsDebranches, true),
      scenarios,
      outilsAActiver,
    },
    changements: [
      ...differences(contexte, p, outilsAActiver),
      ...scenarios.map((s) => ({
        champ: champScenario(s.workflowId),
        label: `Outil « Lancer un scénario » : ${s.nom}, dès que le contact…`,
        avant: '',
        apres: situationDuMoment(s.moment),
      })),
    ],
  };
}

/**
 * Le jsonb de l'entretien a été écrit par notre serveur, à partir d'une sortie de modèle déjà validée : il est relu
 * par le même schéma, et une forme illisible rend `null` (pas de proposition), jamais une erreur.
 */
const enAttenteSchema = z.object({
  proposition: propositionSchema.omit({ reponses: true, bascules: true }),
  scenarios: z.array(z.object({ workflowId: z.string(), nom: z.string(), moment: z.string() })).default([]),
  outilsAActiver: z.array(z.string()).default([]),
});

/** La proposition en attente, recalculée contre l'agent actuel ; `null` s'il n'y a plus rien à enregistrer. */
export function relireEnAttente(brut: unknown, contexte: ContexteConstruction): PropositionRendue | null {
  if (brut === undefined || brut === null) return null;
  const lue = enAttenteSchema.safeParse(brut);
  if (!lue.success) return null;
  // Un scénario dont l'outil existe déjà n'est plus à poser, exactement comme au tour (`scenariosDesMoments`).
  const vises = new Set(contexte.outils.flatMap((o) => (
    o.handler === 'lancer_scenario' && o.workflowId ? [o.workflowId] : []
  )));
  const rendue = rendreProposition(
    contexte, lue.data.proposition, lue.data.scenarios.filter((s) => !vises.has(s.workflowId)), lue.data.outilsAActiver,
  );
  return rendue.changements.length > 0 ? rendue : null;
}
