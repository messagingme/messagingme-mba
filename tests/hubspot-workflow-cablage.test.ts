import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * LES GARDES DE L'ACTION DE WORKFLOW HUBSPOT, LUES DANS LE CÂBLAGE (cadrage du 2026-10-27, relecture du lot 1). Le test de
 * route monte de fausses dépendances : il prouve que la route APPELLE ses gardes, pas que la production les BRANCHE. Une
 * flèche à trois paramètres reste assignable à `EnvoyerPublic` : `(t, c, compter) => lancerEnvoiPublic(...)` compilerait,
 * passerait la suite et perdrait `serviceSeulement`, donc un modèle devenu Marketing partirait aux fiches `opted_in`
 * (décision 3). De même `workflowsBranches: async () => true`. Ce test lit ce que `src/index.ts` branche.
 */
const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Le bloc `hubspotWorkflow: { ... } satisfies HubspotWorkflowDeps`, seul lieu où ces gardes se branchent. */
const bloc = (() => {
  const debut = index.indexOf('hubspotWorkflow: {');
  const fin = index.indexOf('} satisfies HubspotWorkflowDeps', debut);
  expect(debut).toBeGreaterThan(0);
  expect(fin).toBeGreaterThan(debut);
  return index.slice(debut, fin);
})();

describe('le câblage de l’action de workflow HubSpot', () => {
  it('🔴 l’envoi est le cœur public, et ses options (Service seulement, sans campagne vide, le nom) arrivent jusqu’à lui', () => {
    expect(bloc).toContain('envoyer: (tenant, corps, compter, options) => lancerEnvoiPublic(depsEnvois, tenant, corps, undefined, compter, options),');
  });

  it('🔴 l’offre et le réglage sont ceux de l’espace, relus à chaque appel, jamais une constante', () => {
    expect(bloc).toContain('fonctions: async (t: string) => (await offres.offreDe(t)).droits.fonctions,');
    expect(bloc).toContain('workflowsBranches: async (t: string) => (await settingsStore.lireChoixHubspot(t)).workflows,');
  });

  it('🔴 la ligne et la filière sont lues sur l’espace', () => {
    expect(bloc).toContain('ligneHubspot: async (t: string) => etatLigneHubspot(await phoneStatusStore.getPhoneNumber(t)),');
    expect(bloc).toContain('filiere: (t: string) => comptesApplication.filiereDe(t),');
  });

  it('🔴 les plafonds comptent au total des copies, sur leurs propres réglages', () => {
    expect(bloc).toContain('plafonds: plafondsDesWorkflows(compteurDebit, { parMinute: config.HUBSPOT_WORKFLOWS_PAR_MINUTE, parJour: config.HUBSPOT_WORKFLOWS_PAR_JOUR }),');
  });

  it('le catalogue est celui de `GET /v1/templates`, le nom de l’espace celui de `/ops`', () => {
    expect(bloc).toContain('catalogue: listerModeles,');
    expect(bloc).toContain('nomEspace: (t: string) => opsStore.getTenantName(t),');
  });

  it('🔴 l’action scénario : les scénarios en ligne de l’espace, et la conversation tenue par un opérateur, relue', () => {
    // `conseillerEnMain: async () => false` compilerait : l'historique du workflow mentirait (relecture du 2026-10-29).
    expect(bloc).toContain('scenariosPublies: (t: string) => workflowStore.listPublies(t),');
    expect(bloc).toContain("conseillerEnMain: async (t: string, waId: string) => (await inboxStore.getControlOwner(t, waId)) === 'app_human',");
  });

  it('🔴 l’action transaction : les sources du modèle et la fiche réelles', () => {
    // `sourcesDuModele: async () => []` compilerait, et tout lancement finirait en `valeur_invalide` ; une fiche jamais lue
    // ferait oublier aux variables les champs que le client a déjà sur la fiche (cadrage du 2026-10-29, décision 8).
    expect(bloc).toContain('sourcesDuModele: (t: string, name: string, language: string) => templateHintStore.get(t, name, language),');
    expect(bloc).toContain('ficheParNumero: (t: string, waId: string) => contactStore.getResolvableByPhone(t, waId),');
  });

  it('🔴 les champs HubSpot choisis : les clés déclarées lues dans l’espace, jamais une liste fixe', () => {
    // `champsDeclares: async () => []` compilerait, et plus aucun champ ne s'écrirait (lot 2 du 2026-11-02).
    // La clé ET le type : une date reçue de HubSpot s'écrit en ISO sur un champ date (plan du 2026-11-12).
    expect(bloc).toContain('champsDeclares: (t: string) => fieldStore.list(t),');
  });
});

/**
 * La route des champs à importer (lot 2 du 2026-11-02) : son test monte de fausses dépendances, il prouve l'ordre
 * « déclarer, puis poser », pas que la production branche la vraie déclaration ni le vrai connecteur.
 */
describe('le câblage des champs HubSpot à importer', () => {
  const champs = (() => {
    const debut = index.indexOf('hubspotChamps: {');
    const fin = index.indexOf('} satisfies HubspotChampsRouteDeps', debut);
    expect(debut).toBeGreaterThan(0);
    expect(fin).toBeGreaterThan(debut);
    return index.slice(debut, fin);
  })();

  it('🔴 la déclaration est la vraie, sur le store des champs ; la lecture et la pose passent par le connecteur', () => {
    expect(champs).toContain('declarer: (t: string, champs: readonly ChampLibelle[]) => declarerChampsHubspot(fieldStore, t, champs),');
    expect(champs).toContain('lire: (t: string) => lireChampsHubspot(hubspotSuppression, t),');
    expect(champs).toContain('poser: (t: string, champs: readonly ChampChoisi[]) => poserChampsHubspot(hubspotSuppression, t, champs),');
  });
});

/**
 * Le changement d'étape d'un deal (lot 3a du 2026-11-02) : le test de la route monte de fausses dépendances. Ici, ce que
 * la production branche : `automationsBranchees: async () => true` ou `automationCorrespond: async () => true`
 * compileraient, et chaque changement d'étape de chaque deal créerait une fiche.
 */
describe('le câblage du changement d’étape d’un deal HubSpot', () => {
  const evenements = (() => {
    const debut = index.indexOf('hubspotEvents: {');
    const fin = index.indexOf('} satisfies HubspotEventRouteDeps', debut);
    expect(debut).toBeGreaterThan(0);
    expect(fin).toBeGreaterThan(debut);
    return index.slice(debut, fin);
  })();

  it('🔴 la ligne lue sur l’espace ; la correspondance par la définition du runner, gel de l’offre compris', () => {
    expect(evenements).toContain('automationsBranchees: async (t: string) => (await settingsStore.lireChoixHubspot(t)).automations,');
    expect(evenements).toContain('(await automationsCandidates(t, ev, { automations: automationStore, offres })).length > 0,');
  });

  it('🔴 la fiche par `resoudreFiche` (limite de contacts, liste de refus), les champs déclarés de l’espace, le blocage relu', () => {
    expect(evenements).toContain("resoudreFiche: (t: string, e164: string) => resoudreFiche(contactStore, t, { phone: e164 }, { creer: 'phone' }),");
    expect(evenements).toContain('champsDeclares: (t: string) => fieldStore.list(t),');
    expect(evenements).toContain('ecrireChamps: (t: string, contactId: string, champs: ChampsFiche) => contactStore.ecrireChampsFiche(t, contactId, champs),');
    expect(evenements).toContain('estBloque: (t: string, waId: string) => contactStore.isBlockedByWaId(t, waId),');
  });
});
