import { describe, it, expect } from 'vitest';
import { champsRendezVous, delaiRendezVous, etapesAuChoix, etatDeLaLigne, libelleDeLaLigne } from './hubspot-lignes';
import { lireEtatLignesHubspot, scenarioDeLaLigneCreee, type LigneHubspotVue } from './api-hubspot-lignes';
import type { HubspotDealPipeline } from './api/compte';
import type { UserFieldDef } from './api/integrations';

const fr = (f: string): string => f;
const en = (_f: string, e: string): string => e;

const commun = {
  id: 'a1', actif: true, workflowId: 'wf-1', scenario: 'Relance devis', modele: 'relance', langue: 'fr',
  etatChezMeta: 'APPROVED', blocs: 1, versionProgrammee: false,
};
const etape = (o: Partial<LigneHubspotVue> = {}, config: Partial<{ pipelineId: string; stageId: string; stageLabel: string | null }> = {}): LigneHubspotVue => ({
  ...commun, ...o, famille: 'etape', config: { pipelineId: 'default', stageId: 'rdv', stageLabel: 'Rendez-vous', ...config },
} as LigneHubspotVue);
const rdv = (config: Partial<{ fieldKey: string; sens: 'avant' | 'apres'; delaiMinutes: number | null }> = {}): LigneHubspotVue => ({
  ...commun, famille: 'rdv', config: { fieldKey: 'hs_contact_date_rdv', sens: 'avant', delaiMinutes: 180, ...config },
});
const workflow = (o: Partial<LigneHubspotVue> = {}): LigneHubspotVue => ({ ...commun, ...o, famille: 'workflow', config: {} } as LigneHubspotVue);

const PIPELINES: HubspotDealPipeline[] = [
  { id: 'default', label: 'Pipeline de vente', stages: [{ id: 'rdv', label: 'Rendez-vous pris', closed: false }, { id: 'won', label: 'Gagné', closed: true }] },
  { id: 'renew', label: 'Renouvellement', stages: [{ id: 'relance', label: 'À relancer', closed: false }] },
];
const CHAMPS: UserFieldDef[] = [
  { key: 'hs_contact_date_rdv', label: 'Date du RDV (HubSpot)', type: 'datetime' },
  { key: 'hs_deal_closedate', label: 'Date de clôture (HubSpot)', type: 'date' },
  { key: 'hs_contact_ville', label: 'Ville (HubSpot)', type: 'text' },
  { key: 'rappel', label: 'Rappel', type: 'datetime' },
];

describe('l’état d’une automation HubSpot (menu « Scénario », lot 6c)', () => {
  it('🔴 sans premier template publié : à compléter, éteinte comme allumée (l’API refuse de l’allumer, 409)', () => {
    expect(etatDeLaLigne(etape({ actif: false, modele: null, langue: null, etatChezMeta: null }))).toBe('a_completer');
    expect(etatDeLaLigne(etape({ modele: null, langue: null, etatChezMeta: null }))).toBe('a_completer');
    // Le premier message est écrit et attend Meta (une version programmée) : en validation, pas « à compléter ».
    expect(etatDeLaLigne(etape({ actif: false, modele: null, etatChezMeta: null, versionProgrammee: true }))).toBe('en_validation');
  });

  it('🔴 avec son premier template : éteinte, puis l’état chez Meta, comme une automation Shopify', () => {
    expect(etatDeLaLigne(etape({ actif: false }))).toBe('eteinte');
    expect(etatDeLaLigne(etape({ etatChezMeta: 'PENDING' }))).toBe('en_validation');
    expect(etatDeLaLigne(etape({ etatChezMeta: 'REJECTED' }))).toBe('refuse');
    expect(etatDeLaLigne(etape())).toBe('active');
    expect(etatDeLaLigne(etape({ versionProgrammee: true }))).toBe('active_nouvelle_version');
    // Une liste de Meta illisible : « non lu », jamais « refusé ».
    expect(etatDeLaLigne(etape({ etatChezMeta: null }))).toBe('meta_non_lu');
  });
});

describe('le libellé d’une ligne, par famille', () => {
  it('🔴 une étape : « Pipeline › Étape », les libellés lus chez HubSpot (un renommage y est suivi)', () => {
    expect(libelleDeLaLigne(etape(), { pipelines: PIPELINES, champs: null }, fr)).toBe('Pipeline de vente › Rendez-vous pris');
    expect(libelleDeLaLigne(etape({}, { pipelineId: 'renew', stageId: 'relance', stageLabel: null }), { pipelines: PIPELINES, champs: null }, fr))
      .toBe('Renouvellement › À relancer');
  });

  it('une étape sans les pipelines (pas lus, ou en panne) : le libellé gardé à la création, sinon « étape configurée »', () => {
    expect(libelleDeLaLigne(etape(), { pipelines: null, champs: null }, fr)).toBe('Rendez-vous');
    // L'étape a disparu du portail : son libellé gardé à la création, dans son pipeline.
    expect(libelleDeLaLigne(etape({}, { stageId: 'disparue' }), { pipelines: PIPELINES, champs: null }, fr)).toBe('Pipeline de vente › Rendez-vous');
    expect(libelleDeLaLigne(etape({}, { stageLabel: null }), { pipelines: null, champs: null }, fr)).toBe('étape configurée');
    expect(libelleDeLaLigne(etape({}, { stageLabel: null }), { pipelines: null, champs: null }, en)).toBe('configured stage');
  });

  it('🔴 un rendez-vous : « 3 h avant « Date du RDV » », le champ par son libellé, dans la langue de la console', () => {
    expect(libelleDeLaLigne(rdv(), { pipelines: null, champs: CHAMPS }, fr)).toBe('3 h avant « Date du RDV (HubSpot) »');
    expect(libelleDeLaLigne(rdv({ sens: 'apres', delaiMinutes: 2 * 24 * 60 }), { pipelines: null, champs: CHAMPS }, fr))
      .toBe('2 jours après « Date du RDV (HubSpot) »');
    expect(libelleDeLaLigne(rdv({ delaiMinutes: 90 }), { pipelines: null, champs: CHAMPS }, en)).toBe('1 h 30 before “Date du RDV (HubSpot)”');
  });

  it('un rendez-vous dont le champ n’est plus déclaré (ou pas encore lu) : sa clé ; sans délai lisible, sans délai', () => {
    expect(libelleDeLaLigne(rdv(), { pipelines: null, champs: null }, fr)).toBe('3 h avant « hs_contact_date_rdv »');
    expect(libelleDeLaLigne(rdv({ delaiMinutes: null }), { pipelines: null, champs: CHAMPS }, fr)).toBe('avant « Date du RDV (HubSpot) »');
  });

  it('🔴 un scénario lancé par un workflow : son nom, celui que l’action de HubSpot propose', () => {
    expect(libelleDeLaLigne(workflow(), { pipelines: null, champs: null }, fr)).toBe('Relance devis');
    expect(libelleDeLaLigne(workflow({ scenario: null }), { pipelines: null, champs: null }, fr)).toBe('scénario sans nom');
  });
});

describe('le délai d’un rendez-vous en clair', () => {
  it('en jours quand il en fait un nombre rond, sinon en heures et minutes', () => {
    expect([45, 60, 90, 180, 24 * 60, 3 * 24 * 60, 36 * 60].map((m) => delaiRendezVous(m, fr)))
      .toEqual(['45 min', '1 h', '1 h 30', '3 h', '1 jour', '3 jours', '36 h']);
    expect(delaiRendezVous(24 * 60, en)).toBe('1 day');
  });
});

describe('ce que « Ajouter » propose', () => {
  it('🔴 un rendez-vous suit un champ importé de HubSpot (clé `hs_`) de type « date et heure », et aucun autre', () => {
    expect(champsRendezVous(CHAMPS).map((f) => f.key)).toEqual(['hs_contact_date_rdv']);
  });

  it('🔴 les étapes du portail dans leur ordre, une étape déjà réglée marquée (l’API refuserait la seconde)', () => {
    const choix = etapesAuChoix(PIPELINES, [etape(), rdv(), workflow()]);
    expect(choix.map((e) => [e.cle, e.pipeline, e.label, e.fin, e.dejaReglee])).toEqual([
      ['default::rdv', 'Pipeline de vente', 'Rendez-vous pris', false, true],
      ['default::won', 'Pipeline de vente', 'Gagné', true, false],
      ['renew::relance', 'Renouvellement', 'À relancer', false, false],
    ]);
    // Le même identifiant d'étape dans un autre pipeline n'est pas la même étape.
    const autre = etapesAuChoix([{ id: 'renew', label: 'R', stages: [{ id: 'rdv', label: 'Rendez-vous', closed: false }] }], [etape()]);
    expect(autre[0]!.dejaReglee).toBe(false);
  });
});

describe('la lecture des lignes', () => {
  it('🔴 lit les trois familles ; une ligne sans identifiant, d’une famille inconnue ou mal formée est écartée', () => {
    const v = lireEtatLignesHubspot({
      connecte: true,
      lignes: [
        { ...commun, id: 'e', famille: 'etape', config: { pipelineId: 'default', stageId: 'rdv', stageLabel: 'Rendez-vous' } },
        { ...commun, id: 'r', famille: 'rdv', config: { fieldKey: 'hs_contact_date_rdv', sens: 'apres', delaiMinutes: 60 } },
        { ...commun, id: 'w', famille: 'workflow', config: {} },
        { ...commun, id: 'x', famille: 'inconnue', config: {} },
        { ...commun, id: 'y', famille: 'etape', actif: 'oui', config: {} },
        { ...commun, id: undefined, famille: 'workflow', config: {} },
        null,
      ],
    });
    expect(v?.connecte).toBe(true);
    expect(v?.lignes.map((l) => [l.id, l.famille])).toEqual([['e', 'etape'], ['r', 'rdv'], ['w', 'workflow']]);
    expect(v?.lignes[1]).toEqual({ ...commun, id: 'r', famille: 'rdv', config: { fieldKey: 'hs_contact_date_rdv', sens: 'apres', delaiMinutes: 60 } });
  });

  it('🔴 une configuration qui a changé de forme garde la ligne (on doit pouvoir l’éteindre), avec un libellé incomplet', () => {
    const v = lireEtatLignesHubspot({
      connecte: true,
      lignes: [
        { ...commun, id: 'e', famille: 'etape' },
        { ...commun, id: 'r', famille: 'rdv', config: { fieldKey: 42, sens: 'pendant', delaiMinutes: -5 } },
      ],
    });
    expect(v?.lignes.map((l) => l.config)).toEqual([
      { pipelineId: '', stageId: '', stageLabel: null },
      { fieldKey: '', sens: 'avant', delaiMinutes: null },
    ]);
  });

  it('🔴 une réponse sans `connecte` (une API d’avant la route, un repli en 200) ne montre rien', () => {
    expect(lireEtatLignesHubspot({})).toBeNull();
    expect(lireEtatLignesHubspot({ lignes: [] })).toBeNull();
    expect(lireEtatLignesHubspot(null)).toBeNull();
    expect(lireEtatLignesHubspot({ connecte: false })).toEqual({ connecte: false, lignes: [] });
  });

  it('le scénario d’une ligne créée se lit dans la réponse du POST, ou rien', () => {
    expect(scenarioDeLaLigneCreee({ ligne: { id: 'a1', workflowId: 'wf-9' } })).toBe('wf-9');
    for (const r of [null, {}, { ligne: null }, { ligne: { workflowId: 9 } }, 'wf-9']) expect(scenarioDeLaLigneCreee(r)).toBeNull();
  });
});
