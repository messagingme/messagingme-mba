import { describe, it, expect } from 'vitest';
import type { WorkflowGraph } from '../src/workflow/graph';
import type { Lanceur } from '../web/lib/partage/fenetre-scenario';
import type { LigneModeleDeBloc } from '../src/workflow/modeles-de-bloc.pg';
import type { WorkflowRow } from '../src/workflow/store.pg';
import {
  jugerPublication, relireModelesDeBloc, surStatutDesModeles, tenterMiseEnLigne, trancherModeleDeBloc,
  type DepsPublication, type ProgrammationDeScenario,
} from '../src/workflow/modeles-de-bloc';

/**
 * Publier ou programmer, la mise en ligne à l'approbation, le statut tranché par Meta et le filet (menu « Scénario »,
 * lot 3, décision 18). Le SQL (une seule mise en ligne, à sa date) est prouvé en intégration ; ici, les décisions.
 */
const tpl = (id: string, nom: string, langue = 'fr') => ({ id, type: 'template', position: { x: 0, y: 0 }, data: { templateName: nom, language: langue } });
const graphe = (...nodes: Array<Record<string, unknown>>): WorkflowGraph => ({ nodes: nodes as unknown as WorkflowGraph['nodes'], edges: [] });
const ligneDe = (modele: string, etat: LigneModeleDeBloc['etat'], raison: string | null = null): LigneModeleDeBloc => ({
  workflowId: 'wf1', modele, langue: 'fr', etat, raison, creeLe: '2026-11-18T10:00:00.000Z', trancheLe: null,
});
const LE = '2026-11-18T15:00:00.123Z';
const programmation = (g: WorkflowGraph, id = 'wf1'): ProgrammationDeScenario => ({ id, nom: 'Relance', rayon: 'general', graphe: g, le: LE, par: 'u1' });

function monter(o: {
  lignes?: LigneModeleDeBloc[];
  meta?: Record<string, { statut: string; raison: string | null } | 'panne'>;
  campagnes?: string[];
  programmees?: ProgrammationDeScenario[];
  anciennes?: Array<ProgrammationDeScenario & { tenantId: string }>;
  miseEnLigne?: boolean;
  annulation?: boolean;
  activationQuiLeve?: string;
} = {}) {
  const lignes = new Map((o.lignes ?? []).map((l) => [`${l.modele}|${l.langue}`, { ...l }]));
  const appels = {
    meta: [] as string[], tranches: [] as string[], lanceurs: 0, misEnLigne: [] as string[], annules: [] as Array<string | null>,
    emails: [] as Array<{ cle: string; occasion: string; valeurs: Record<string, string> }>, audit: [] as Array<{ action: string; detail: unknown }>,
  };
  const deps: DepsPublication = {
    lignes: {
      desModeles: async (_t, paires) => paires.flatMap((p) => { const l = lignes.get(`${p.modele}|${p.langue}`); return l ? [{ ...l }] : []; }),
      trancher: async (_t, modele, langue, etat, raison) => {
        appels.tranches.push(`${modele}:${etat}`);
        const l = lignes.get(`${modele}|${langue}`);
        if (!l || l.etat !== 'en_validation') return null;
        l.etat = etat; l.raison = raison;
        return { ...l };
      },
      attentesAnciennes: async () => [...lignes.values()].filter((l) => l.etat === 'en_validation').map((l) => ({ tenantId: 't1', modele: l.modele, langue: l.langue })),
    },
    scenarios: {
      lanceursDuScenario: async (): Promise<Lanceur[]> => { appels.lanceurs += 1; return (o.campagnes ?? []).map((nom) => ({ type: 'campagne', nom, declencheur: null, blocDeDepart: null })); },
      list: async () => [],
      programmeesDeLEspace: async () => o.programmees ?? [],
      programmeesAnciennes: async () => o.anciennes ?? [],
      mettreEnLigneLaVersionProgrammee: async (id, _t, le) => {
        if (o.activationQuiLeve === id) throw new Error('panne');
        appels.misEnLigne.push(`${id}@${le}`);
        return o.miseEnLigne === false ? null : ({ id, graph: graphe(tpl('n1', 'x')) } as WorkflowRow);
      },
      annulerProgrammation: async (_id, _t, le) => { appels.annules.push(le); return o.annulation !== false; },
    },
    statutModele: async (_t, modele) => {
      appels.meta.push(modele);
      const r = o.meta?.[modele];
      if (r === 'panne') throw new Error('Meta injoignable');
      return r ?? null;
    },
    emails: { emettre: async (e) => { appels.emails.push({ cle: e.cle, occasion: e.occasion, valeurs: e.valeurs as Record<string, string> }); } },
    audit: async (_t, _acteur, action, _cible, detail) => { appels.audit.push({ action, detail }); },
    lienScenario: (id) => `https://console.test/workflows?open=${id}`,
  };
  return { deps, appels, lignes };
}

describe('jugerPublication', () => {
  it('🔴 un brouillon sans template de bloc se publie comme avant, sans lire Meta ni les campagnes', async () => {
    const { deps, appels } = monter();
    expect(await jugerPublication(deps, 't1', 'wf1', graphe(tpl('n1', 'choisi_dans_la_liste')))).toEqual({ type: 'publier' });
    expect(appels.meta).toEqual([]);
    expect(appels.lanceurs).toBe(0);
  });

  it('tous les templates de bloc approuvés : publier', async () => {
    const { deps } = monter({ lignes: [ligneDe('a', 'approuve')] });
    expect(await jugerPublication(deps, 't1', 'wf1', graphe(tpl('n1', 'a')))).toEqual({ type: 'publier' });
  });

  it('🔴 un template encore en validation chez Meta, relu hors cache : programmer', async () => {
    const { deps, appels } = monter({ lignes: [ligneDe('a', 'en_validation')], meta: { a: { statut: 'PENDING', raison: null } } });
    expect(await jugerPublication(deps, 't1', 'wf1', graphe(tpl('n1', 'a')))).toEqual({ type: 'programmer', attend: [{ modele: 'a', langue: 'fr' }] });
    expect(appels.meta).toEqual(['a']);
  });

  it('approuvé entre-temps (statut pas encore arrivé) : la relecture tranche, et l’on publie', async () => {
    const { deps, appels } = monter({ lignes: [ligneDe('a', 'en_validation')], meta: { a: { statut: 'APPROVED', raison: null } } });
    expect(await jugerPublication(deps, 't1', 'wf1', graphe(tpl('n1', 'a')))).toEqual({ type: 'publier' });
    expect(appels.tranches).toEqual(['a:approuve']);
  });

  it('🔴 refusé par Meta (à la relecture, ou déjà tranché) : refus avec sa raison', async () => {
    const relu = monter({ lignes: [ligneDe('a', 'en_validation')], meta: { a: { statut: 'REJECTED', raison: 'INVALID_FORMAT' } } });
    const j = await jugerPublication(relu.deps, 't1', 'wf1', graphe(tpl('n1', 'a')));
    expect(j).toMatchObject({ type: 'refus', code: 'modele_refuse' });
    expect((j as { erreur: string }).erreur).toContain('INVALID_FORMAT');
    const deja = monter({ lignes: [ligneDe('a', 'refuse', 'TAG_CONTENT_MISMATCH')] });
    expect(await jugerPublication(deja.deps, 't1', 'wf1', graphe(tpl('n1', 'a')))).toMatchObject({ type: 'refus', code: 'modele_refuse' });
  });

  it('🔴 en validation sous une campagne active : refus qui nomme la campagne', async () => {
    const { deps } = monter({ lignes: [ligneDe('a', 'en_validation')], campagnes: ['Soldes'] });
    const j = await jugerPublication(deps, 't1', 'wf1', graphe(tpl('n1', 'a')));
    expect(j).toMatchObject({ type: 'refus', code: 'campagne_active' });
    expect((j as { erreur: string }).erreur).toContain('Soldes');
  });

  it('Meta injoignable à la relecture : le template reste en validation, on programme', async () => {
    const { deps } = monter({ lignes: [ligneDe('a', 'en_validation')], meta: { a: 'panne' } });
    expect(await jugerPublication(deps, 't1', 'wf1', graphe(tpl('n1', 'a')))).toMatchObject({ type: 'programmer' });
  });
});

describe('tenterMiseEnLigne', () => {
  it('🔴 tout approuvé, aucune campagne : mise en ligne À SA DATE, e-mail « en ligne » une fois, journal', async () => {
    const { deps, appels } = monter({ lignes: [ligneDe('a', 'approuve')] });
    expect(await tenterMiseEnLigne(deps, 't1', programmation(graphe(tpl('n1', 'a'))))).toBe('en_ligne');
    expect(appels.misEnLigne).toEqual([`wf1@${LE}`]);
    expect(appels.emails).toEqual([{ cle: 'scenario_programme_en_ligne', occasion: `wf1:${LE}`, valeurs: { scenario: 'Relance', lien_scenario: 'https://console.test/workflows?open=wf1' } }]);
    expect(appels.audit).toEqual([{ action: 'workflow.published', detail: { blocs: 1, programmee: true } }]);
  });

  it('un template encore en validation : on attend, rien n’est écrit', async () => {
    const { deps, appels } = monter({ lignes: [ligneDe('a', 'approuve'), ligneDe('b', 'en_validation')] });
    expect(await tenterMiseEnLigne(deps, 't1', programmation(graphe(tpl('n1', 'a'), tpl('n2', 'b'))))).toBe('attend_modeles');
    expect(appels.misEnLigne).toEqual([]);
    expect(appels.emails).toEqual([]);
  });

  it('🔴 une campagne active : on attend sa fin, sans annuler ni prévenir', async () => {
    const { deps, appels } = monter({ lignes: [ligneDe('a', 'approuve')], campagnes: ['Soldes'] });
    expect(await tenterMiseEnLigne(deps, 't1', programmation(graphe(tpl('n1', 'a'))))).toBe('attend_campagne');
    expect(appels.misEnLigne).toEqual([]);
    expect(appels.annules).toEqual([]);
    expect(appels.emails).toEqual([]);
  });

  it('🔴 un template refusé : la programmation tombe À SA DATE, e-mail « refusé » avec la raison bornée', async () => {
    const { deps, appels } = monter({ lignes: [ligneDe('a', 'refuse', 'R'.repeat(400))] });
    expect(await tenterMiseEnLigne(deps, 't1', programmation(graphe(tpl('n1', 'a'))))).toBe('annulee');
    expect(appels.annules).toEqual([LE]);
    expect(appels.emails).toHaveLength(1);
    expect(appels.emails[0]!.cle).toBe('scenario_programme_refuse');
    expect(appels.emails[0]!.valeurs.raison!.length).toBeLessThanOrEqual(300);
    expect(appels.misEnLigne).toEqual([]);
  });

  it('une publication explicite entre-temps (mise en ligne ou annulation sans effet) : aucun e-mail', async () => {
    const enLigne = monter({ lignes: [ligneDe('a', 'approuve')], miseEnLigne: false });
    expect(await tenterMiseEnLigne(enLigne.deps, 't1', programmation(graphe(tpl('n1', 'a'))))).toBe('rien');
    expect(enLigne.appels.emails).toEqual([]);
    const refuse = monter({ lignes: [ligneDe('a', 'refuse', 'x')], annulation: false });
    expect(await tenterMiseEnLigne(refuse.deps, 't1', programmation(graphe(tpl('n1', 'a'))))).toBe('rien');
    expect(refuse.appels.emails).toEqual([]);
  });

  it('les contrôles de publication se rejouent : un refus annule la programmation et le dit', async () => {
    const question = { id: 'q', type: 'question', position: { x: 0, y: 0 }, data: { body: 'Votre pièce ?', attendreFichier: true } };
    const { deps, appels } = monter({ lignes: [ligneDe('a', 'approuve')] });
    expect(await tenterMiseEnLigne(deps, 't1', programmation(graphe(tpl('n1', 'a'), question)))).toBe('annulee');
    expect(appels.emails[0]!.valeurs.raison).toContain('Fichier reçu');
    expect(appels.misEnLigne).toEqual([]);
  });
});

describe('trancherModeleDeBloc', () => {
  it('🔴 APPROVED : tranche, puis tente la mise en ligne des seules programmations qui nomment ce template', async () => {
    const { deps, appels } = monter({
      lignes: [ligneDe('a', 'en_validation')],
      programmees: [programmation(graphe(tpl('n1', 'a')), 'wf1'), programmation(graphe(tpl('n1', 'autre')), 'wf2')],
    });
    expect(await trancherModeleDeBloc(deps, 't1', { modele: 'a', langue: 'fr', statut: 'APPROVED', raison: null })).toBe('approuve');
    expect(appels.misEnLigne).toEqual([`wf1@${LE}`]);
  });

  it('🔴 statut rejoué (déjà tranché) : rien, ni mise en ligne ni e-mail', async () => {
    const { deps, appels } = monter({ lignes: [ligneDe('a', 'approuve')], programmees: [programmation(graphe(tpl('n1', 'a')))] });
    expect(await trancherModeleDeBloc(deps, 't1', { modele: 'a', langue: 'fr', statut: 'APPROVED', raison: null })).toBe('rien');
    expect(appels.misEnLigne).toEqual([]);
    expect(appels.emails).toEqual([]);
  });

  it('un statut qui ne tranche pas (PENDING, PAUSED) : rien, aucune écriture', async () => {
    const { deps, appels } = monter({ lignes: [ligneDe('a', 'en_validation')] });
    expect(await trancherModeleDeBloc(deps, 't1', { modele: 'a', langue: 'fr', statut: 'PENDING', raison: null })).toBe('rien');
    expect(await trancherModeleDeBloc(deps, 't1', { modele: 'a', langue: 'fr', statut: 'paused', raison: null })).toBe('rien');
    expect(appels.tranches).toEqual([]);
  });

  it('une mise en ligne qui lève n’empêche pas les suivantes', async () => {
    const { deps, appels } = monter({
      lignes: [ligneDe('a', 'en_validation')],
      programmees: [programmation(graphe(tpl('n1', 'a')), 'wf1'), programmation(graphe(tpl('n1', 'a')), 'wf2')],
      activationQuiLeve: 'wf1',
    });
    expect(await trancherModeleDeBloc(deps, 't1', { modele: 'a', langue: 'fr', statut: 'approved', raison: null })).toBe('approuve');
    expect(appels.misEnLigne).toEqual([`wf2@${LE}`]);
  });
});

describe('relireModelesDeBloc (le filet)', () => {
  it('relit chez Meta les attentes anciennes, puis retente les programmations anciennes', async () => {
    const { deps, appels } = monter({
      lignes: [ligneDe('a', 'en_validation'), ligneDe('b', 'en_validation')],
      meta: { a: { statut: 'APPROVED', raison: null }, b: 'panne' },
      anciennes: [{ ...programmation(graphe(tpl('n1', 'a')), 'wf3'), tenantId: 't1' }],
    });
    expect(await relireModelesDeBloc(deps, 10, 20)).toBe(2);
    expect(appels.tranches).toEqual(['a:approuve']);
    expect(appels.misEnLigne).toEqual([`wf3@${LE}`]);
  });
});

describe('surStatutDesModeles (le worker)', () => {
  it('🔴 un consommateur qui lève n’empêche pas le suivant, et rien ne remonte à la file', async () => {
    const vus: string[] = [];
    const surStatut = surStatutDesModeles([
      { nom: 'shopify', traiter: async () => { throw new Error('panne'); } },
      { nom: 'bloc', traiter: async (t, s) => { vus.push(`${t}:${s.modele}:${s.statut}`); } },
    ]);
    await expect(surStatut('t1', { modele: 'a', langue: 'fr', statut: 'APPROVED', raison: null })).resolves.toBeUndefined();
    expect(vus).toEqual(['t1:a:APPROVED']);
  });
});
