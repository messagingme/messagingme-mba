/**
 * LE LIEN DU PORTAIL HUBSPOT, DANS LES TESTS : une fixture qui DIT son hypothèse (lot 9, 2026-09-23).
 *
 * 🔴 POURQUOI DEUX CONSTANTES PLUTÔT QU'UN `async () => false` RECOPIÉ. `hubspotPortalConnecte` est une
 * dépendance REQUISE de `SettingsRouteDeps` : chaque câblage de test doit donc la fournir, et la recopier
 * à quatre endroits ferait quatre `false` muets dont personne ne saurait s'ils sont un CHOIX ou un défaut
 * de frappe. Nommées, elles se lisent : ce test-là parle d'un espace SANS HubSpot.
 *
 * C'est exactement le remède que le dépôt a déjà appliqué à `jamaisDesabonne` (`tests/consentement.ts`)
 * quand `estDesabonne` est devenue requise, et pour la même raison : une fixture qui ment au compilateur
 * (`as never`, `Record<string, unknown>`) ne casse pas au typecheck, elle casse au RUNTIME.
 */

/** L'espace n'a AUCUN portail lié : les fonctions HubSpot doivent être masquées. C'est le défaut. */
export const sansPortailHubspot = async (): Promise<boolean> => false;

/** L'espace a un portail lié : les fonctions HubSpot sont offertes (l'interrupteur décide ensuite). */
export const avecPortailHubspot = async (): Promise<boolean> => true;

/**
 * L'option « le plus ancien laisse sa place » des réglages (lot 2 du 2026-11-24), pour les tests de la route des réglages
 * qui ne parlent pas d'elle : décochée, sur une Free, rien n'est écrit.
 */
export const remplacementInerte = {
  lire: async (): Promise<boolean> => false,
  ecrire: async (): Promise<void> => {},
  offreDe: async (): Promise<'base'> => 'base',
};
