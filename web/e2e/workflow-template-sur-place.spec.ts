import { test, expect } from './aide/test';

/**
 * Écrire ou modifier le template d'un bloc sans quitter le scénario, et la publication programmée (menu « Scénario »,
 * lot 3, décisions 6, 18, 19, 27). Ce que seul un test de bout en bout peut voir :
 *  - le formulaire du bloc part SANS nom (le serveur le donne) et le bloc envoie ensuite le nouveau template, même tant
 *    qu'il n'est pas approuvé (sinon « Choisir… » ferait croire que le bloc n'envoie rien) ;
 *  - les flèches suivent le TEXTE des boutons quand le template change : retirer le bouton du milieu ne décale pas la
 *    branche du suivant ;
 *  - « Publier » pendant la validation programme la mise en ligne (202), et le bandeau le dit, avec de quoi l'annuler.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

const qr = (text: string) => ({ type: 'QUICK_REPLY', text });
const TROIS_BOUTONS = [qr('Oui'), qr('Peut-être'), qr('Non')];
const tpl = (name: string, status: string, buttons: unknown[] = TROIS_BOUTONS) => ({
  id: `id-${name}`, name, status, category: 'UTILITY', language: 'fr', body: `Corps de ${name}`, headerFormat: null,
  isCarousel: false, editable: true, buttons,
});

/** Un bloc template à trois boutons, la flèche de « Oui » vers n2 et celle de « Non » vers n3. */
const GRAPHE: Graph = {
  nodes: [
    { id: 'n1', type: 'template', position: { x: 0, y: 0 }, data: { wfType: 'template', templateName: 'relance', language: 'fr', templateButtons: TROIS_BOUTONS } },
    { id: 'n2', type: 'tag', position: { x: 360, y: -80 }, data: { wfType: 'tag', tag: 'oui' } },
    { id: 'n3', type: 'tag', position: { x: 360, y: 80 }, data: { wfType: 'tag', tag: 'non' } },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'btn:0' },
    { id: 'e2', source: 'n1', target: 'n3', sourceHandle: 'btn:2' },
  ],
};

interface Etat {
  templates: Array<ReturnType<typeof tpl>>;
  modeles: Array<{ modele: string; langue: string; etat: string; raison: string | null; creeLe: string }>;
  programmee: null | { le: string; attend: Array<{ modele: string; langue: string; etat: string; raison: string | null }>; campagnes: string[] };
  publication: { statut: number; corps: unknown };
}

async function monter(page: import('@playwright/test').Page, etat: Etat) {
  const recus = { creations: [] as Array<Record<string, unknown>>, graphes: [] as Graph[], annulations: 0, publications: 0 };
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  const wf = { id: 'wf1', name: 'Relance panier', graph: GRAPHE, draftGraph: GRAPHE, createdAt: '', updatedAt: '' };
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const json = (b: unknown, statut = 200) => route.fulfill({ status: statut, contentType: 'application/json', body: JSON.stringify(b) });
    if (req.method() === 'POST' && /\/workflows\/wf1\/blocs\/n1\/modele$/.test(url)) {
      const corps = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      recus.creations.push(corps);
      etat.templates.push(tpl('relance_panier_mi3k2x1a', 'PENDING', corps.buttons as unknown[]));
      etat.modeles = [{ modele: 'relance_panier_mi3k2x1a', langue: 'fr', etat: 'en_validation', raison: null, creeLe: '2026-11-18T15:00:00.000Z' }];
      return json({ modele: 'relance_panier_mi3k2x1a', langue: 'fr', etat: 'en_validation', categorie: 'UTILITY', boutons: corps.buttons ?? [] }, 201);
    }
    if (req.method() === 'GET' && /\/workflows\/wf1\/modeles$/.test(url)) {
      // Comme le serveur : l'état des templates que NOMME le dernier brouillon enregistré, rien d'autre.
      const graphe = recus.graphes.at(-1) ?? GRAPHE;
      const nommes = new Set(graphe.nodes.map((n) => String((n.data as { templateName?: unknown } | undefined)?.templateName ?? '')));
      return json({ modeles: etat.modeles.filter((m) => nommes.has(m.modele)), programmee: etat.programmee });
    }
    if (req.method() === 'DELETE' && /\/workflows\/wf1\/programmation$/.test(url)) {
      recus.annulations += 1;
      etat.programmee = null;
      return route.fulfill({ status: 204, body: '' });
    }
    if (req.method() === 'POST' && /\/workflows\/wf1\/publish$/.test(url)) {
      recus.publications += 1;
      if (etat.publication.statut === 202) etat.programmee = { le: '2026-11-18T15:00:00.000Z', attend: [{ modele: 'relance_panier_mi3k2x1a', langue: 'fr', etat: 'en_validation', raison: null }], campagnes: [] };
      return json(etat.publication.corps, etat.publication.statut);
    }
    if (req.method() === 'PATCH' && /\/workflows\/wf1$/.test(url)) {
      const corps = (req.postDataJSON() ?? {}) as { graph?: Graph };
      if (corps.graph) recus.graphes.push(corps.graph);
      return json({ ok: true, brouillon: true });
    }
    if (/\/workflows\/wf1$/.test(url)) return json({ workflow: wf });
    if (url.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: 'Relance panier', graph: GRAPHE }] });
    if (url.includes('/param-hints')) return json({ hints: [] });
    if (url.includes('/email/accounts')) return json({ accounts: [] });
    if (url.includes('/email/templates')) return json({ templates: [] });
    if (url.includes('/templates')) return json({ templates: etat.templates });
    if (url.includes('/flows')) return json({ flows: [] });
    if (url.includes('/tags')) return json({ tags: [] });
    if (url.includes('/user-fields/usage')) return json({ total: 0, parChamp: {} });
    if (url.includes('/user-fields')) return json({ fields: [] });
    if (url.includes('/settings')) return json({ mbaEnabled: false, rcsEnabled: false, hubspotListsEnabled: false, campaignsPaused: false });
    if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });
  return recus;
}

const etatDeDepart = (): Etat => ({
  templates: [tpl('relance', 'APPROVED'), tpl('autre', 'APPROVED', [qr('Non'), qr('Oui')])],
  modeles: [],
  programmee: null,
  publication: { statut: 200, corps: { id: 'wf1', graph: GRAPHE, publishedAt: '2026-11-18T15:00:00.000Z' } },
});

/** Le dernier graphe enregistré : les flèches qui partent de n1, poignée et cible. */
const flechesDeN1 = (graphes: Graph[]) => (graphes.at(-1)?.edges ?? [])
  .filter((e) => e.source === 'n1').map((e) => `${String(e.sourceHandle)}>${String(e.target)}`).sort();

test.describe('Éditeur : écrire ou modifier le template d’un bloc (lot 3)', () => {
  test('🔴 « Modifier ce template » : formulaire sans nom, puis le bloc envoie le nouveau, en validation, et « Non » garde SA branche', async ({ page }) => {
    const recus = await monter(page, etatDeDepart());
    await page.goto('/workflows?open=wf1');
    await page.locator('.react-flow__node').first().click();
    await page.getByTestId('template-modifier').click();
    const modale = page.getByTestId('modele-du-bloc');
    await expect(modale).toBeVisible();
    await expect(modale.getByTestId('template-nom')).toHaveCount(0);
    await expect(modale.getByTestId('template-bloc-bandeau')).toContainText('relance');
    // Retirer « Peut-être », le bouton du milieu.
    await modale.getByRole('button', { name: 'Retirer', exact: true }).nth(1).click();
    await modale.getByTestId('template-soumettre').click();
    await expect(modale).toHaveCount(0);

    expect(recus.creations).toHaveLength(1);
    expect(recus.creations[0]).not.toHaveProperty('name');
    await expect(page.getByTestId('template-du-bloc')).toHaveValue('relance_panier_mi3k2x1a');
    await expect(page.getByTestId('template-du-bloc-etat')).toHaveAttribute('data-etat', 'en_validation');
    await expect(page.locator('.react-flow__node').first().getByTestId('node-etat-modele')).toBeVisible();
    await expect.poll(() => flechesDeN1(recus.graphes), { timeout: 10_000 }).toEqual(['btn:0>n2', 'btn:1>n3']);
  });

  test('🔴 « Modifier » sur le message déplié du bloc : le même formulaire que « Modifier ce template » (2026-11-20)', async ({ page }) => {
    await monter(page, etatDeDepart());
    await page.goto('/workflows?open=wf1');
    const bloc = page.locator('.react-flow__node').first();
    // Replié, pas de « Modifier » ; déplié (l'interrupteur de la barre), il est là.
    await expect(bloc.getByTestId('node-apercu-texte-modifier')).toHaveCount(0);
    await page.getByTestId('workflow-messages-en-entier').check();
    await bloc.getByTestId('node-apercu-texte-modifier').click();
    const modale = page.getByTestId('modele-du-bloc');
    await expect(modale).toBeVisible();
    await expect(modale.getByTestId('template-nom')).toHaveCount(0);
    await expect(modale.getByTestId('template-bloc-bandeau')).toContainText('relance');
  });

  test('🔴 un autre template choisi dans la liste : chaque flèche suit le texte de son bouton', async ({ page }) => {
    const recus = await monter(page, etatDeDepart());
    await page.goto('/workflows?open=wf1');
    await page.locator('.react-flow__node').first().click();
    await page.getByTestId('template-du-bloc').selectOption('autre');
    // « autre » porte [Non, Oui] : « Oui » passe en btn:1, « Non » en btn:0 ; « Peut-être » n'avait pas de flèche.
    await expect.poll(() => flechesDeN1(recus.graphes), { timeout: 10_000 }).toEqual(['btn:0>n3', 'btn:1>n2']);
  });

  test('🔴 « Publier » pendant la validation : la mise en ligne est programmée, le bandeau le dit et sait l’annuler', async ({ page }) => {
    const etat = etatDeDepart();
    etat.publication = { statut: 202, corps: { id: 'wf1', programmee: { le: '2026-11-18T15:00:00.000Z', attend: [{ modele: 'relance_panier_mi3k2x1a', langue: 'fr' }] } } };
    const recus = await monter(page, etat);
    await page.goto('/workflows?open=wf1');
    await page.getByTestId('workflow-publier').click();
    const bandeau = page.getByTestId('workflow-programmee');
    await expect(bandeau).toContainText('relance_panier_mi3k2x1a');
    await expect(page.getByTestId('workflow-publier-erreur')).toHaveCount(0);
    // Rien de neuf n'est en ligne : le brouillon reste à publier (un 202 lu comme un 200 dirait « En ligne »).
    await expect(page.getByTestId('workflow-publier')).toBeVisible();
    await expect(page.getByTestId('workflow-publie')).toHaveCount(0);
    await bandeau.getByTestId('workflow-programmee-annuler').click();
    await expect(bandeau).toHaveCount(0);
    expect(recus.annulations).toBe(1);
  });

  test('un template refusé : « Publier » dit pourquoi, et rien n’est programmé', async ({ page }) => {
    const etat = etatDeDepart();
    etat.publication = { statut: 422, corps: { code: 'modele_refuse', error: 'Publication refusée : Meta a refusé le template « relance » (raison : INVALID_FORMAT) : écrivez-en un autre dans le bloc, ou choisissez un template approuvé.' } };
    await monter(page, etat);
    await page.goto('/workflows?open=wf1');
    await page.getByTestId('workflow-publier').click();
    await expect(page.getByTestId('workflow-publier-erreur')).toContainText('INVALID_FORMAT');
    await expect(page.getByTestId('workflow-programmee')).toHaveCount(0);
  });
});
