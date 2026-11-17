import type { Locator, Page } from '@playwright/test';
import { CHAMPS_DEMO, TAGS_DEMO, capturer, communs, type Locale } from './donnees-demo';

/**
 * L'ÉDITEUR DE SCÉNARIO SIMULÉ, pour les captures des fiches par bloc (spec `2026-11-17-fiches-par-bloc-design.md`) :
 * le scénario `wf1` et les listes que l'éditeur lit. Rien n'est enregistré : toute écriture répond `{ ok: true }`.
 */
export type Graphe = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

/** Un bloc posé sur la toile, de type `type`. */
export const bloc = (id: string, type: string, x: number, y: number, data: Record<string, unknown>) =>
  ({ id, type, position: { x, y }, data: { wfType: type, ...data } });

/** Une flèche, `poignee` absente pour la sortie libre. */
export const fleche = (id: string, source: string, target: string, poignee?: string) =>
  ({ id, source, target, ...(poignee ? { sourceHandle: poignee } : {}) });

/**
 * Pose les faux de l'éditeur, AVANT `communs` (Playwright essaie la dernière route posée en premier). Rappelée pour un
 * second scénario, elle passe devant la précédente. `templates` et `indications` servent le bloc Envoi template.
 *
 * `autres` répond avant tout le reste, écritures comprises : une paire (le test de l'adresse, la réponse) par route
 * qu'un bloc lit en plus (ses formulaires, les membres, les agents, les appels, les boîtes d'envoi…), essayées dans
 * l'ordre. `scenarios` complète la liste des scénarios (la cible d'un « Aller à », la page de la liste).
 */
export type Reponse = [(url: string, methode: string) => boolean, unknown];
export async function simulerEditeur(
  page: Page, graphe: Graphe, nom: string,
  templates: unknown[] = [], indications: unknown[] = [],
  autres: Reponse[] = [], scenarios: Array<Record<string, unknown>> = [],
): Promise<void> {
  const wf = { id: 'wf1', name: nom, graph: graphe, createdAt: '2026-11-17T09:00:00.000Z', updatedAt: '2026-11-17T09:00:00.000Z' };
  await page.route('**/api/backend/**', async (route) => {
    const url = route.request().url();
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    const methode = route.request().method();
    const autre = autres.find(([test]) => test(url, methode));
    if (autre) return json(autre[1]);
    if (methode !== 'GET') return json({ ok: true });
    if (/\/workflows\/wf1$/.test(url)) return json({ workflow: wf });
    if (url.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: nom, graph: graphe }, ...scenarios] });
    if (url.includes('/email/accounts')) return json({ accounts: [] });
    if (url.includes('/email/templates')) return json({ templates: [] });
    if (url.includes('/param-hints')) return json({ hints: indications });
    if (url.includes('/templates')) return json({ templates });
    if (url.includes('/flows')) return json({ flows: [] });
    if (url.includes('/tags')) return json({ tags: TAGS_DEMO });
    if (url.includes('/user-fields/usage')) return json({ total: 0, parChamp: {} });
    if (url.includes('/user-fields')) return json({ fields: CHAMPS_DEMO });
    if (url.includes('/settings')) return json({ mbaEnabled: false, rcsEnabled: false, hubspotListsEnabled: false, campaignsPaused: false });
    return json({});
  });
  await communs(page);
}

/** Ouvre le scénario `wf1` et, si demandé, le panneau de son premier bloc. */
export async function ouvrir(page: Page, panneau = true): Promise<void> {
  await page.goto('/workflows?open=wf1');
  if (panneau) await page.locator('.react-flow__node').first().click();
}

/** Une réponse simulée pour les GET dont l'adresse contient `morceau`. */
export const sur = (morceau: string, reponse: unknown): Reponse => [(url, methode) => methode === 'GET' && url.includes(morceau), reponse];

/** Ferme le panneau du bloc : un clic dans le vide de la toile. */
export const fermerPanneau = (page: Page) => page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });

/** La poignée `id` du premier bloc de la toile. */
export const poignee = (page: Page, id: string) =>
  page.locator('.react-flow__node').first().locator(`.react-flow__handle[data-handleid="${id}"]`);

/**
 * Centre l'élément visé dans son conteneur (le panneau défile) : `scrollIntoViewIfNeeded` le laissait collé au bord,
 * où le cadre de la photo ne montrait plus ce qui l'entoure.
 */
export const centrer = (cible: Locator) => cible.evaluate((e) => e.scrollIntoView({ block: 'center' }));

/** Une étape d'une fiche : l'élément centré, puis la photo fléchée et cadrée sur lui. */
export async function etapeFlechee(page: Page, cle: string, n: number, locale: Locale, cible: Locator): Promise<void> {
  await centrer(cible);
  await capturer(page, cle, n, locale, undefined, 'haut', cible, true);
}

/** Les appels déclarés dans Tools > Connecteurs API, et le système qui les porte : de quoi dégriser le bloc. */
export const appelsDemo = (appel: string, systeme: string): Reponse[] => [
  sur('/agent-requetes', {
    requetes: [{ id: 'req1', tenantId: 't-demo', sourceId: 'src1', label: appel, methode: 'GET', chemin: '/orders/{id}', parametres: [], entetes: [], corps: { mode: 'aucun' }, variables: [], outputPaths: ['statut'], valeursTest: {}, outils: 0, scenarios: [], updatedAt: '2026-11-01T09:00:00.000Z' }],
    champs: [], catalogue: { systeme: [], entetesReserves: [] },
  }),
  sur('/agent-sources', { sources: [{ id: 'src1', kind: 'http', label: systeme }] }),
];
