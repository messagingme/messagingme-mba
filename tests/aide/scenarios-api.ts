import { vi } from 'vitest';
import type { DepsScenariosApi, LigneApi, MagasinScenariosApi } from '../../src/workflow/scenarios-api';
import type { TemplateSummary } from '../../src/meta/templates';
import type { WorkflowGraph } from '../../src/workflow/graph';

/**
 * Les dépendances simulées du service des scénarios de l'API (`src/workflow/scenarios-api.ts`), partagées par son test et
 * par celui des routes `/v1/scenarios`. Un magasin en mémoire, scopé à l'espace, assez fidèle pour que le contrôle d'un
 * remplacement tourne vraiment ; le SQL réel est prouvé en intégration.
 */
export const AGENT = '7f6b1c2e-1d2a-4b3c-8d4e-5f6a7b8c9d0e';
export const TENANT = 't-1';

export const tpl = (name: string, language: string, status: string, buttons: TemplateSummary['buttons'] = []): TemplateSummary => ({
  id: `${name}-${language}`, name, language, status, category: 'MARKETING', body: 'Bonjour {{1}}', headerFormat: null, buttons,
} as TemplateSummary);

const QR = (text: string) => ({ type: 'QUICK_REPLY' as const, text });

/** Un magasin en mémoire, assez fidèle pour que le contrôle du remplacement tourne vraiment. */
export function magasin() {
  const lignes = new Map<string, LigneApi>();
  let n = 0;
  return {
    lignes,
    creerPublieParApi: vi.fn(async (tenantId: string, nom: string, graphe: WorkflowGraph) => {
      const pris = [...lignes.values()].find((l) => l.tenantId === tenantId && l.name.trim().toLowerCase() === nom.trim().toLowerCase());
      if (pris) return { nomPris: pris.id };
      n += 1;
      const id = `00000000-0000-4000-8000-00000000000${n}`;
      lignes.set(id, { id, tenantId, name: nom, code: `scn_t1_${n}`, graph: graphe, draftGraph: null, publishedAt: 'x', createdAt: 'x', updatedAt: 'x', origine: 'api' });
      return { id, code: `scn_t1_${n}` };
    }),
    lireParApi: vi.fn(async (tenantId: string, ref: string) => [...lignes.values()].find((l) => l.tenantId === tenantId && (l.id === ref || l.code === ref)) ?? null),
    remplacerPublieParApi: vi.fn(async <R>(id: string, tenantId: string, nom: string, graphe: WorkflowGraph, controle: (l: LigneApi) => R | null) => {
      const l = lignes.get(id);
      if (!l || l.tenantId !== tenantId) return 'inconnu' as const;
      const refus = controle(l);
      if (refus !== null) return { refus };
      lignes.set(id, { ...l, name: nom, graph: graphe, draftGraph: null });
      return 'ok' as const;
    }),
    supprimerParApi: vi.fn(async () => 'ok' as const),
  };
}

export function depsScenarios(over: Partial<DepsScenariosApi> = {}) {
  const store = magasin();
  const journal = vi.fn(async () => {});
  const templates = vi.fn(async () => [
    tpl('relance', 'fr', 'APPROVED', [QR('Oui'), QR('Non')]),
    tpl('relance', 'en', 'PENDING', [QR('Yes'), QR('No')]),
  ]);
  const d: DepsScenariosApi = {
    // Le faux est générique à la main ; `vi.fn` efface le paramètre de type de `remplacerPublieParApi`.
    scenarios: store as unknown as MagasinScenariosApi,
    offres: { offreDe: async () => ({ droits: { fonctions: new Set(['scenarios']) } }) as never },
    templates,
    indices: { listerParEspace: async () => [{ name: 'relance', language: 'fr', position: 1, source: { type: 'field', key: 'prenom' } }] },
    agents: async () => [{ id: AGENT, label: 'Conseiller', actif: true, sorties: [] }],
    champs: async () => ['prenom'],
    verifierFichier: async () => null,
    tenantCode: async () => 't1',
    journal,
    ...over,
  };
  return { d, store, journal, templates };
}

export const recette = (entree: unknown = {
  template: { nom: 'relance', langue: 'fr' },
  boutons: [{ texte: 'Oui', suite: { agent: { agent_id: AGENT } } }, { texte: 'Non', suite: { message: { texte: 'Merci, à bientôt.' } } }],
}) => ({ nom: 'Relance', entree });
