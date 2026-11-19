import { describe, it, expect, vi } from 'vitest';
import { programmerMenage, type DepsMenage } from '../src/workflow/modeles-de-bloc';
import { DELAI_OUBLI_MS, REESSAI_OUBLI_MS, traiterOubli, type JobOubli } from '../src/shopify/preparation';
import type { LigneModeleDeBloc } from '../src/workflow/modeles-de-bloc.pg';
import type { WorkflowGraph } from '../src/workflow/graph';

/**
 * LE MÉNAGE DES TEMPLATES REMPLACÉS DANS UN SCÉNARIO D'AUTOMATION (spec § 5.1, menu « Scénario », lot 5, tâche 9) : à la
 * mise en ligne d'un scénario du rayon Shopify, un template que l'ancienne version envoyait, que la nouvelle ne nomme plus
 * ET qui a été écrit depuis un bloc (une ligne de `modeles_de_bloc`), est programmé à l'oubli un quart d'heure plus tard ;
 * le travail relit tout avant de supprimer. Jamais au rayon général (décision 14).
 */

const T = 't1';
const MAINTENANT = Date.UTC(2026, 10, 19, 12);
const graphe = (...modeles: string[]): WorkflowGraph => ({
  nodes: modeles.map((m, i) => ({ id: `b${i}`, type: 'template' as const, position: { x: 0, y: i }, data: { templateName: m, language: 'fr' } })),
  edges: [],
});
const ligne = (modele: string): LigneModeleDeBloc => ({
  workflowId: 'wf-1', modele, langue: 'fr', etat: 'approuve', raison: null, creeLe: '2026-11-19T10:00:00.000Z', trancheLe: null,
});

function monter(o: { marques?: string[]; leve?: boolean } = {}) {
  const programmes: Array<{ job: JobOubli; quand: Date }> = [];
  const lus: Array<Array<{ modele: string; langue: string }>> = [];
  const deps: DepsMenage = {
    lignes: {
      desModeles: async (_t, paires) => {
        lus.push([...paires]);
        if (o.leve) throw new Error('base indisponible');
        return paires.filter((p) => (o.marques ?? []).includes(p.modele)).map((p) => ligne(p.modele));
      },
    },
    programmerOubli: async (job, quand) => { programmes.push({ job, quand }); },
    maintenant: () => MAINTENANT,
  };
  return { deps, programmes, lus };
}

describe('programmer le ménage à la mise en ligne', () => {
  it('🔴 un template remplacé, écrit depuis un bloc, est programmé à l’oubli dans un quart d’heure', async () => {
    const { deps, programmes } = monter({ marques: ['commande_payee_mh1'] });
    await programmerMenage(deps, T, 'shopify', graphe('commande_payee_mh1'), graphe('commande_payee_mh2'));
    expect(programmes).toEqual([{ job: { type: 'bloc', tenantId: T, modele: 'commande_payee_mh1', langue: 'fr', essai: 0 }, quand: new Date(MAINTENANT + DELAI_OUBLI_MS) }]);
  });

  it('un template gardé, ou choisi à la main (sans ligne de bloc), n’est jamais visé', async () => {
    const garde = monter({ marques: ['commande_payee_mh1'] });
    await programmerMenage(garde.deps, T, 'shopify', graphe('commande_payee_mh1'), graphe('commande_payee_mh1', 'suite'));
    expect(garde.programmes).toEqual([]);
    expect(garde.lus, 'rien de remplacé : la base n’est pas lue').toEqual([]);
    const main = monter({ marques: [] });
    await programmerMenage(main.deps, T, 'shopify', graphe('commande_payee'), graphe('commande_payee_mh2'));
    expect(main.programmes).toEqual([]);
  });

  it('🔴 jamais au rayon général (décision 14), ni sans version précédente', async () => {
    const { deps, programmes, lus } = monter({ marques: ['commande_payee_mh1'] });
    await programmerMenage(deps, T, 'general', graphe('commande_payee_mh1'), graphe('autre'));
    await programmerMenage(deps, T, 'shopify', null, graphe('autre'));
    expect([programmes, lus]).toEqual([[], []]);
  });

  it('une panne se journalise : la mise en ligne passe', async () => {
    const { deps } = monter({ leve: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(programmerMenage(deps, T, 'shopify', graphe('a'), graphe('b'))).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe('le travail du ménage d’un template de bloc (worker)', () => {
  const job: JobOubli = { type: 'bloc', tenantId: T, modele: 'commande_payee_mh1', langue: 'fr', essai: 0 };
  function monterOubli(o: { marque?: boolean; nomme?: boolean; issue?: { ok: true } | { ok: false; message: string } } = {}) {
    const journal = { supprimes: [] as string[], programmes: [] as Array<{ job: JobOubli; quand: Date }>, nommes: [] as string[] };
    const deps = {
      store: { messages: async () => [], attentes: async () => [] },
      blocs: { desModeles: async (_t: string, paires: ReadonlyArray<{ modele: string; langue: string }>) => (o.marque === false ? [] : paires.map((p) => ligne(p.modele))) },
      scenarios: { nommeLeModele: async (_t: string, modele: string) => { journal.nommes.push(modele); return o.nomme === true; } },
      supprimerModele: async (_t: string, nom: string) => { journal.supprimes.push(nom); return o.issue ?? { ok: true as const }; },
      programmerOubli: async (j: JobOubli, quand: Date) => { journal.programmes.push({ job: j, quand }); },
      maintenant: () => MAINTENANT,
    };
    return { deps, journal };
  }

  it('🔴 encore nommé par un graphe de l’espace (publié, brouillon ou programmé) : gardé, rien de supprimé', async () => {
    const { deps, journal } = monterOubli({ nomme: true });
    expect(await traiterOubli(deps, job)).toBe('garde');
    expect([journal.nommes, journal.supprimes]).toEqual([['commande_payee_mh1'], []]);
  });

  it('un template de bloc qui ne sert plus est supprimé', async () => {
    const { deps, journal } = monterOubli();
    expect(await traiterOubli(deps, job)).toBe('supprime');
    expect(journal.supprimes).toEqual(['commande_payee_mh1']);
  });

  it('🔴 sans sa marque (aucune ligne de bloc), rien ne se supprime ; un travail sans langue non plus', async () => {
    const sans = monterOubli({ marque: false });
    expect(await traiterOubli(sans.deps, job)).toBe('ignore');
    expect(await traiterOubli(sans.deps, { tenantId: T, modele: 'commande_payee_mh1', essai: 0, type: 'bloc' })).toBe('ignore');
    expect(sans.journal.supprimes).toEqual([]);
  });

  it('🔴 un refus (campagne active) se retente une heure plus tard, avec son type et sa langue', async () => {
    const { deps, journal } = monterOubli({ issue: { ok: false, message: 'template utilisé par une campagne active' } });
    expect(await traiterOubli(deps, job)).toBe('reessai');
    expect(journal.programmes).toEqual([{ job: { ...job, essai: 1 }, quand: new Date(MAINTENANT + REESSAI_OUBLI_MS) }]);
  });
});
