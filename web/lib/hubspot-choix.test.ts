import { describe, it, expect } from 'vitest';
import { etapeHubspot, fermeeParLOffre, phraseDeLOffre, choixParDefaut, choixActuel, corpsDuChoix, choixApresBascule, declencheurDealGrise, envoyerAutomations } from './hubspot-choix';
import type { TenantSettings } from './api';
import type { FonctionOffre, VueOffre } from './offre';

const ENTREPRISE = new Set<FonctionOffre>(['analyse', 'crm', 'inbox']);
const PRO = new Set<FonctionOffre>(['inbox']);
const VIDE = {} as TenantSettings;

describe('etapeHubspot (lot 1bis)', () => {
  it('🔴 relié et jamais validé : l’étape de choix ; validé : le réglage', () => {
    expect(etapeHubspot({ lecture: 'ok', relie: true, valideLe: null })).toBe('choisir');
    expect(etapeHubspot({ lecture: 'ok', relie: true, valideLe: '2026-10-23T18:00:00.000Z' })).toBe('regle');
  });
  it('une API antérieure (date absente) ne propose pas une étape qu’elle ne saurait pas enregistrer', () => {
    expect(etapeHubspot({ lecture: 'ok', relie: true, valideLe: undefined })).toBe('regle');
  });
  it('rien de relié : connecter ; lecture en cours ou ratée : jamais un faux « non relié »', () => {
    expect(etapeHubspot({ lecture: 'ok', relie: false, valideLe: null })).toBe('connecter');
    expect(etapeHubspot({ lecture: 'en_cours', relie: undefined, valideLe: undefined })).toBe('lecture');
    expect(etapeHubspot({ lecture: 'echec', relie: undefined, valideLe: undefined })).toBe('echec');
    expect(etapeHubspot({ lecture: 'ok', relie: undefined, valideLe: null })).toBe('echec');
  });

  it('🔴 un connecteur qui se réveille : « connexion en cours », jamais « Connecter HubSpot » (2026-10-27)', () => {
    expect(etapeHubspot({ lecture: 'ok', relie: undefined, valideLe: null, reveil: true })).toBe('reveil');
    // Une réponse qui dit relié ou délié l'emporte sur un réveil : il est fini.
    expect(etapeHubspot({ lecture: 'ok', relie: true, valideLe: '2026-10-20', reveil: true })).toBe('regle');
    expect(etapeHubspot({ lecture: 'ok', relie: false, valideLe: null, reveil: true })).toBe('connecter');
  });
});

describe('fermeeParLOffre', () => {
  it('l’analyse et les listes demandent l’Entreprise, la tâche immédiate rien', () => {
    expect(fermeeParLOffre('analyse', PRO)).toBe(true);
    expect(fermeeParLOffre('listes', PRO)).toBe(true);
    expect(fermeeParLOffre('passage', PRO)).toBe(false);
    expect(fermeeParLOffre('analyse', ENTREPRISE)).toBe(false);
  });
  it('offre inconnue : rien n’est fermé ici, le serveur tranche', () => {
    expect(fermeeParLOffre('analyse', null)).toBe(false);
    expect(fermeeParLOffre('analyse', undefined)).toBe(false);
  });
});

describe('choixParDefaut (décision 2 du cadrage)', () => {
  it('🔴 coche ce qui écrit dans HubSpot, décoche ce qui ouvre une porte, et suit le mode du portail', () => {
    expect(choixParDefaut({ routingMode: 'mm_routing', fonctions: ENTREPRISE, reglages: VIDE }))
      .toEqual({ analyse: true, passage: true, injoignable: true, reponse: false, modeles: false, workflows: false, automations: false, listes: false, taches: true });
    expect(choixParDefaut({ routingMode: 'hubspot_native', fonctions: ENTREPRISE, reglages: VIDE }).taches).toBe(false);
  });
  it('🔴 une fonction fermée par l’offre est décochée (le serveur refuserait de l’allumer)', () => {
    expect(choixParDefaut({ routingMode: undefined, fonctions: PRO, reglages: VIDE }).analyse).toBe(false);
  });
});

describe('choixActuel', () => {
  it('lit les réglages, et un champ absent (API antérieure) prend le défaut de la migration', () => {
    const vide = {} as TenantSettings;
    expect(choixActuel(vide, undefined)).toEqual({ analyse: true, passage: true, injoignable: true, reponse: false, modeles: false, workflows: false, automations: false, listes: false, taches: true });
    const s = { hubspotAnalyse: false, hubspotPassage: true, hubspotInjoignable: false, hubspotReponse: true, hubspotListsEnabled: true } as TenantSettings;
    expect(choixActuel(s, 'hubspot_native')).toEqual({ analyse: false, passage: true, injoignable: false, reponse: true, modeles: false, workflows: false, automations: false, listes: true, taches: false });
  });
});

describe('les correctifs de la relecture du lot 1bis', () => {
  const choix = { analyse: true, passage: false, injoignable: true, reponse: false, modeles: false, workflows: false, automations: false, listes: false, taches: true };
  it('🔴 « Créer des tâches » ne part QUE si on le demande (sa ligne basculée, ou la validation avec un mode connu)', () => {
    expect(corpsDuChoix(choix, { envoyerTaches: false, envoyerAutomations: true })).toEqual({ analyse: true, passage: false, injoignable: true, reponse: false, modeles: false, workflows: false, automations: false, listes: false });
    expect(corpsDuChoix(choix, { envoyerTaches: false, envoyerAutomations: true })).not.toHaveProperty('taches');
    expect(corpsDuChoix(choix, { envoyerTaches: true, envoyerAutomations: true })).toEqual(choix);
  });
  it('🟡 un espace descendu d’offre lit éteint ce que l’offre ne permet plus', () => {
    const s = { hubspotAnalyse: true, hubspotListsEnabled: true } as TenantSettings;
    expect(choixActuel(s, 'mm_routing', PRO)).toMatchObject({ analyse: false, listes: false });
    expect(choixActuel(s, 'mm_routing', ENTREPRISE)).toMatchObject({ analyse: true, listes: true });
  });
});

describe('lot 3 : « Répondre aux clients depuis HubSpot » (décision D)', () => {
  const FREE = new Set<FonctionOffre>(['aide']);
  const vue = { grille: { free: { fonctions: FREE }, pro: { fonctions: PRO }, entreprise: { fonctions: ENTREPRISE } } } as unknown as VueOffre;
  const t = (fr: string) => fr;
  it('🔴 ouverte par l’offre qui ouvre l’Inbox : Pro suffit, Free la ferme', () => {
    expect(fermeeParLOffre('reponse', PRO)).toBe(false);
    expect(fermeeParLOffre('reponse', FREE)).toBe(true);
  });
  it('éteinte par défaut, même quand l’offre l’ouvre', () => {
    expect(choixParDefaut({ routingMode: 'mm_routing', fonctions: ENTREPRISE, reglages: VIDE }).reponse).toBe(false);
  });
  it('🔴 un espace descendu sous l’Inbox la lit éteinte', () => {
    const s = { hubspotReponse: true } as TenantSettings;
    expect(choixActuel(s, 'mm_routing', FREE).reponse).toBe(false);
    expect(choixActuel(s, 'mm_routing', PRO).reponse).toBe(true);
  });
  it('la raison d’une ligne fermée nomme l’offre qui l’ouvre, d’après la grille du serveur', () => {
    expect(phraseDeLOffre(vue, 'reponse', t)).toBe('Inclus dans l’offre Pro.');
    expect(phraseDeLOffre(vue, 'analyse', t)).toBe('Inclus dans l’offre Entreprise.');
    expect(phraseDeLOffre(vue, 'passage', t)).toBe('Pas dans votre offre.');
  });
});

describe('sous-lot « relancer » : « Envoyer des modèles depuis HubSpot » (décision E)', () => {
  const choix = { analyse: true, passage: true, injoignable: true, reponse: true, modeles: true, workflows: false, automations: false, listes: false, taches: true };
  it('🔴 éteindre la réponse éteint les modèles ; basculer une autre ligne ne les touche pas', () => {
    expect(choixApresBascule(choix, 'reponse')).toMatchObject({ reponse: false, modeles: false });
    expect(choixApresBascule(choix, 'passage')).toMatchObject({ passage: false, reponse: true, modeles: true });
    expect(choixApresBascule({ ...choix, modeles: false }, 'modeles')).toMatchObject({ modeles: true });
  });
  it('🔴 lus allumés seulement avec la réponse, et l’offre qui ouvre l’Inbox ; éteints par défaut', () => {
    const s = { hubspotReponse: true, hubspotModeles: true } as TenantSettings;
    expect(choixActuel(s, 'mm_routing', PRO).modeles).toBe(true);
    expect(choixActuel({ ...s, hubspotReponse: false }, 'mm_routing', PRO).modeles).toBe(false);
    expect(choixActuel(s, 'mm_routing', new Set<FonctionOffre>(['aide'])).modeles).toBe(false);
    expect(choixParDefaut({ routingMode: 'mm_routing', fonctions: ENTREPRISE, reglages: VIDE }).modeles).toBe(false);
    expect(fermeeParLOffre('modeles', PRO)).toBe(false);
  });
});

describe('lot 2 de l’action de workflow : « Workflows HubSpot : envoyer des modèles WhatsApp » (décision 8)', () => {
  const FREE = new Set<FonctionOffre>(['aide']);
  it('🔴 éteint par défaut ; ouvert par l’offre qui relie HubSpot (`crm`), fermé sans', () => {
    expect(choixParDefaut({ routingMode: 'mm_routing', fonctions: ENTREPRISE, reglages: VIDE }).workflows).toBe(false);
    expect(fermeeParLOffre('workflows', ENTREPRISE)).toBe(false);
    expect(fermeeParLOffre('workflows', PRO)).toBe(true);
  });
  it('🔴 lu allumé avec l’offre, INDÉPENDANT de la réponse ; un espace descendu d’offre le lit éteint', () => {
    const s = { hubspotWorkflows: true, hubspotReponse: false } as TenantSettings;
    expect(choixActuel(s, 'mm_routing', ENTREPRISE).workflows).toBe(true);
    expect(choixActuel(s, 'mm_routing', FREE).workflows).toBe(false);
    expect(choixActuel({} as TenantSettings, 'mm_routing', ENTREPRISE).workflows).toBe(false);
  });
  it('éteindre la réponse ne touche pas les workflows, et il part dans le corps du choix', () => {
    const choix = { analyse: true, passage: true, injoignable: true, reponse: true, modeles: true, workflows: true, automations: false, listes: false, taches: true };
    expect(choixApresBascule(choix, 'reponse')).toMatchObject({ reponse: false, modeles: false, workflows: true });
    expect(corpsDuChoix(choix, { envoyerTaches: false, envoyerAutomations: true })).toMatchObject({ workflows: true });
  });
});

describe('lot 3a : « Automations HubSpot : lancer un scénario quand un deal atteint une étape » (décision 5)', () => {
  const FREE = new Set<FonctionOffre>(['aide']);
  const repris = { hubspotAutomations: true } as TenantSettings;

  it('🔴 l’étape de choix la propose telle que les réglages la disent : un espace repris allumé ne s’éteint pas en validant', () => {
    expect(choixParDefaut({ routingMode: 'mm_routing', fonctions: ENTREPRISE, reglages: repris }).automations).toBe(true);
    expect(choixParDefaut({ routingMode: 'mm_routing', fonctions: ENTREPRISE, reglages: VIDE }).automations).toBe(false);
    expect(choixParDefaut({ routingMode: 'mm_routing', fonctions: ENTREPRISE, reglages: { hubspotAutomations: false } as TenantSettings }).automations).toBe(false);
    // Fermée par l'offre : décochée, comme les autres lignes (le serveur refuserait de l'allumer).
    expect(choixParDefaut({ routingMode: 'mm_routing', fonctions: PRO, reglages: repris }).automations).toBe(false);
  });

  it('🔴 ouverte par l’offre qui relie HubSpot (`crm`) ; lue dans les réglages, éteinte si l’offre ne la permet plus', () => {
    expect(fermeeParLOffre('automations', ENTREPRISE)).toBe(false);
    expect(fermeeParLOffre('automations', PRO)).toBe(true);
    expect(choixActuel(repris, 'mm_routing', ENTREPRISE).automations).toBe(true);
    expect(choixActuel(repris, 'mm_routing', FREE).automations).toBe(false);
    expect(choixActuel(VIDE, 'mm_routing', ENTREPRISE).automations).toBe(false);
  });

  it('🔴 elle ne part dans le corps que si l’API la connaît (une API d’avant refuserait la clé en 400)', () => {
    const choix = { analyse: true, passage: true, injoignable: true, reponse: false, modeles: false, workflows: false, automations: true, listes: false, taches: true };
    expect(corpsDuChoix(choix, { envoyerTaches: false, envoyerAutomations: true })).toMatchObject({ automations: true });
    expect(corpsDuChoix(choix, { envoyerTaches: false, envoyerAutomations: false })).not.toHaveProperty('automations');
    expect(choixApresBascule({ ...choix, automations: false }, 'automations')).toMatchObject({ automations: true, workflows: false });
  });

  it('🔴 le déclencheur « deal » de l’écran Automations : grisé seulement ligne ÉTEINTE, jamais pour l’automation modifiée qui l’a déjà', () => {
    expect(declencheurDealGrise(false, null)).toBe(true);
    expect(declencheurDealGrise(false, { triggerKind: 'keyword' })).toBe(true);
    expect(declencheurDealGrise(false, { triggerKind: 'hubspot_deal_stage' })).toBe(false);
    expect(declencheurDealGrise(true, null)).toBe(false);
    // Inconnue (lecture en cours, ou API d'avant le lot 3a) : montré, comme avant.
    expect(declencheurDealGrise(null, null)).toBe(false);
    expect(declencheurDealGrise(undefined, null)).toBe(false);
  });
});

describe('« Automations HubSpot » dans le corps du choix (relecture du lot 3a)', () => {
  it('🔴 ne part qu’avec la bascule de SA ligne : une autre ligne basculée ne l’éteint jamais, offre fermée comprise', () => {
    expect(envoyerAutomations({ bascule: 'automations' }, ENTREPRISE, true)).toBe(true);
    expect(envoyerAutomations({ bascule: 'workflows' }, ENTREPRISE, true)).toBe(false);
    // L'espace descendu sous l'offre qui ouvre la ligne : la console la lit à faux, elle ne doit pas la renvoyer.
    expect(envoyerAutomations({ bascule: 'reponse' }, PRO, true)).toBe(false);
  });

  it('à la validation de l’étape de choix : envoyée, sauf si l’offre la ferme ; jamais si l’API ne la connaît pas', () => {
    expect(envoyerAutomations({ validation: true }, ENTREPRISE, true)).toBe(true);
    expect(envoyerAutomations({ validation: true }, PRO, true)).toBe(false);
    expect(envoyerAutomations({ bascule: 'automations' }, ENTREPRISE, false)).toBe(false);
    expect(envoyerAutomations({ validation: true }, ENTREPRISE, false)).toBe(false);
  });
});
