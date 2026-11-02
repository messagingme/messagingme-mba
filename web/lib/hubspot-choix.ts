import type { ChoixHubspot, TenantSettings } from './api';
import { phraseInclusDans, type FonctionOffre, type VueOffre } from './offre';

/**
 * LE CHOIX DES FONCTIONS HUBSPOT (lot 1bis, `components/ReglageHubspot.tsx`) : la logique de l'écran, en fonctions
 * pures, testées dans `hubspot-choix.test.ts`.
 */

/**
 * Où en est l'écran : lecture, connecteur qui se réveille (on ne sait pas encore), rien de relié, étape de choix à
 * valider, ou choix déjà fait.
 */
export type EtapeHubspot = 'lecture' | 'reveil' | 'echec' | 'connecter' | 'choisir' | 'regle';

export function etapeHubspot(p: { lecture: 'en_cours' | 'ok' | 'echec'; relie: boolean | undefined; valideLe: string | null | undefined; reveil?: boolean }): EtapeHubspot {
  if (p.lecture === 'en_cours') return 'lecture';
  if (p.lecture === 'ok' && p.reveil === true && p.relie === undefined) return 'reveil';
  if (p.lecture === 'echec' || p.relie === undefined) return 'echec';
  if (!p.relie) return 'connecter';
  // Une API antérieure au lot 1bis ne rend pas la date (`undefined`) : on ne propose pas une étape qu'elle ne sait
  // pas enregistrer, on montre le choix tel qu'il est.
  return p.valideLe === null ? 'choisir' : 'regle';
}

/** La fonction d'offre qu'il faut pour ALLUMER une ligne. Éteindre n'en demande jamais. */
export const FONCTION_REQUISE: Partial<Record<keyof ChoixHubspot, FonctionOffre>> = {
  analyse: 'analyse',
  listes: 'crm',
  reponse: 'inbox',
  modeles: 'inbox',
  workflows: 'crm',
  automations: 'crm',
};

/** La ligne est-elle fermée par l'offre ? `fonctions` absente (offre inconnue) : tout est ouvert, le serveur tranche. */
export function fermeeParLOffre(champ: keyof ChoixHubspot, fonctions: ReadonlySet<FonctionOffre> | null | undefined): boolean {
  const f = FONCTION_REQUISE[champ];
  return f !== undefined && !!fonctions && !fonctions.has(f);
}

/** Pourquoi une ligne est fermée : l'offre qui l'ouvre, lue dans la grille du serveur (Pro pour la réponse). */
export function phraseDeLOffre(vue: VueOffre, champ: keyof ChoixHubspot, t: (fr: string, en: string) => string): string {
  const f = FONCTION_REQUISE[champ];
  return f ? phraseInclusDans(vue, f, t) : t('Pas dans votre offre.', 'Not in your plan.');
}

/**
 * Le choix proposé à l'étape de choix : ce qui écrit dans HubSpot sans rien ouvrir est coché, ce qui ouvre une porte
 * est décoché (décision 2 du cadrage). Une fonction que l'offre n'ouvre pas est décochée (le serveur refuserait).
 * 🔴 « Automations HubSpot » se LIT dans les réglages : la migration 0270 l'allume pour un espace qui a déjà une automation
 * « deal », et un espace qui n'a jamais validé l'étape de choix l'éteindrait sinon en validant (lot 3a).
 */
export function choixParDefaut(p: {
  routingMode: 'mm_routing' | 'hubspot_native' | undefined;
  fonctions: ReadonlySet<FonctionOffre> | null | undefined;
  reglages: TenantSettings;
}): ChoixHubspot {
  return {
    analyse: !fermeeParLOffre('analyse', p.fonctions),
    passage: true,
    injoignable: true,
    reponse: false,
    modeles: false,
    workflows: false,
    automations: p.reglages.hubspotAutomations === true && !fermeeParLOffre('automations', p.fonctions),
    listes: false,
    taches: p.routingMode !== 'hubspot_native',
  };
}

/**
 * Le choix en vigueur, lu dans les réglages et le portail. Un champ absent prend le défaut de la migration 0251. Une
 * fonction que l'offre ne permet plus (espace descendu d'offre) se lit éteinte : elle ne marche pas, l'écran ne doit
 * pas la dire allumée.
 */
export function choixActuel(s: TenantSettings, routingMode: 'mm_routing' | 'hubspot_native' | undefined, fonctions?: ReadonlySet<FonctionOffre> | null): ChoixHubspot {
  const reponse = s.hubspotReponse === true && !fermeeParLOffre('reponse', fonctions);
  return {
    analyse: s.hubspotAnalyse !== false && !fermeeParLOffre('analyse', fonctions),
    passage: s.hubspotPassage !== false,
    injoignable: s.hubspotInjoignable !== false,
    reponse,
    modeles: reponse && s.hubspotModeles === true && !fermeeParLOffre('modeles', fonctions),
    workflows: s.hubspotWorkflows === true && !fermeeParLOffre('workflows', fonctions),
    automations: s.hubspotAutomations === true && !fermeeParLOffre('automations', fonctions),
    listes: s.hubspotListsEnabled === true && !fermeeParLOffre('listes', fonctions),
    taches: routingMode !== 'hubspot_native',
  };
}

/**
 * La ligne suivante après une bascule : éteindre la réponse éteint les modèles (le serveur l'écrit aussi), pour qu'aucune
 * ligne ne se lise allumée sans pouvoir servir.
 */
export function choixApresBascule(choix: ChoixHubspot, champ: keyof ChoixHubspot): ChoixHubspot {
  const suivant = { ...choix, [champ]: !choix[champ] };
  return suivant.reponse ? suivant : { ...suivant, modeles: false };
}

/**
 * Le corps à envoyer. 🔴 « Créer des tâches » vaut pour tout le PORTAIL et n'est connu que par une lecture qui peut
 * échouer : il ne part qu'à la validation de l'étape de choix s'il est connu, ou quand c'est SA ligne qu'on bascule.
 * Le renvoyer à chaque bascule d'une autre ligne l'écraserait depuis une valeur devinée ou périmée (relecture du lot
 * 1bis, le seul rouge).
 * 🔴 « Automations HubSpot » ne part que si l'API la connaît (`envoyerAutomations` : les réglages lus la rendent) : la
 * console part au push, avant l'API, et une API d'avant le lot 3a refuse en 400 une clé qu'elle ne connaît pas (corps
 * strict). Absente, le serveur garde la valeur.
 */
/**
 * « Automations HubSpot » part-elle avec cet enregistrement ? 🔴 Seulement quand on bascule SA ligne, ou à la validation
 * de l'étape de choix si l'offre ne la ferme pas, et toujours si l'API la connaît. Un espace dont l'offre ferme la ligne
 * la lit à faux : la renvoyer à chaque bascule d'une autre ligne éteindrait ses automations « deal » sans que personne
 * l'ait demandé (relecture du lot 3a, le modèle de « tâches »).
 */
export function envoyerAutomations(
  quoi: { bascule: keyof ChoixHubspot } | { validation: true },
  fonctions: ReadonlySet<FonctionOffre> | null | undefined,
  connue: boolean,
): boolean {
  if (!connue) return false;
  return 'bascule' in quoi ? quoi.bascule === 'automations' : !fermeeParLOffre('automations', fonctions);
}

export function corpsDuChoix(
  choix: ChoixHubspot,
  p: { envoyerTaches: boolean; envoyerAutomations: boolean },
): Omit<ChoixHubspot, 'taches' | 'automations'> & { taches?: boolean; automations?: boolean } {
  const { taches, automations, ...reste } = choix;
  return { ...reste, ...(p.envoyerTaches ? { taches } : {}), ...(p.envoyerAutomations ? { automations } : {}) };
}

/**
 * Le déclencheur « un deal HubSpot atteint une étape » est-il grisé dans Automations ? Seulement ligne « Automations
 * HubSpot » ÉTEINTE (`false` : une API d'avant le lot 3a ne la rend pas, et on montre alors comme avant), et jamais pour
 * l'automation en cours de modification qui l'a déjà (le formulaire doit pouvoir afficher et garder sa valeur).
 */
export function declencheurDealGrise(hubspotAutomations: boolean | null | undefined, enEdition: { triggerKind: string } | null): boolean {
  return hubspotAutomations === false && enEdition?.triggerKind !== 'hubspot_deal_stage';
}
